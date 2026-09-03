import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { normalizeRelativePath, resolveInside, toRelativePath } from "./path-utils.js";

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function listFiles(rootFolder) {
  const files = [];
  async function visit(folder) {
    const entries = await fsp.readdir(folder, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(folder, entry.name);
      if (entry.isDirectory()) {
        await visit(fullPath);
      } else if (entry.isFile()) {
        files.push(toRelativePath(rootFolder, fullPath));
      }
    }
  }
  await visit(rootFolder);
  return files.sort();
}

async function waitForStableFile(filePath, stabilityMs) {
  const first = await fsp.stat(filePath);
  await sleep(stabilityMs);
  const second = await fsp.stat(filePath);
  if (first.size !== second.size || first.mtimeMs !== second.mtimeMs) {
    await sleep(stabilityMs);
  }
  return fsp.stat(filePath);
}

function uploadFile({ baseUrl, token, sourceDeviceId }, filePath, relativePath) {
  const endpoint = new URL("/api/files", baseUrl);
  endpoint.searchParams.set("path", relativePath);

  return new Promise((resolve, reject) => {
    const request = http.request(endpoint, {
      method: "PUT",
      headers: {
        "x-mybridge-token": token,
        "x-mybridge-source-id": sourceDeviceId,
        "content-type": "application/octet-stream"
      }
    });

    let body = "";
    request.setTimeout(15_000, () => request.destroy(new Error("Destination timed out")));
    request.on("response", (response) => {
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve();
          return;
        }
        let detail = body;
        try {
          detail = JSON.parse(body).error || body;
        } catch {
          // Keep the raw response when it is not JSON.
        }
        reject(new Error(`Destination rejected file (${response.statusCode}): ${detail}`));
      });
    });
    request.on("error", reject);

    const stream = fs.createReadStream(filePath);
    stream.on("error", (error) => request.destroy(error));
    stream.pipe(request);
  });
}

export class SyncEngine {
  constructor({ getSourceFolder, getPairedDevice, onStatus, onActivity, transport = uploadFile, debounceMs = 250, stabilityMs = 120 }) {
    this.getSourceFolder = getSourceFolder;
    this.getPairedDevice = getPairedDevice;
    this.onStatus = onStatus;
    this.onActivity = onActivity;
    this.transport = transport;
    this.debounceMs = debounceMs;
    this.stabilityMs = stabilityMs;
    this.watcher = null;
    this.timers = new Map();
    this.queue = [];
    this.running = false;
    this.paused = false;
  }

  async start({ initialScan = true } = {}) {
    await this.stop();
    const sourceFolder = this.getSourceFolder();
    if (!sourceFolder) {
      return;
    }

    await fsp.mkdir(sourceFolder, { recursive: true });
    this.watcher = fs.watch(sourceFolder, { recursive: true }, (_eventType, filename) => {
      if (!filename) return;
      try {
        this.enqueue(normalizeRelativePath(filename.toString()));
      } catch {
        // Ignore watcher noise that does not represent a safe file path.
      }
    });
    this.watcher.on("error", (error) => {
      this.onStatus?.({ status: "error", error: error.message });
    });
    if (initialScan && !this.paused) await this.syncAll();
  }

  async stop() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.queue = [];
    while (this.running) await sleep(5);
  }

  async syncAll() {
    if (this.paused) return;
    const sourceFolder = this.getSourceFolder();
    if (!sourceFolder) return;
    const files = await listFiles(sourceFolder);
    for (const relativePath of files) {
      await this.syncOne(relativePath);
    }
  }

  enqueue(relativePath) {
    if (this.paused) return;
    const normalized = normalizeRelativePath(relativePath);
    const existing = this.timers.get(normalized);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.timers.delete(normalized);
      this.queue.push(normalized);
      void this.runQueue();
    }, this.debounceMs);
    this.timers.set(normalized, timer);
  }

  async runQueue() {
    if (this.running) return;
    this.running = true;
    try {
      if (this.paused) {
        this.queue = [];
        return;
      }
      while (this.queue.length > 0) {
        await this.syncOne(this.queue.shift());
      }
    } finally {
      this.running = false;
    }
  }

  async setPaused(paused) {
    this.paused = Boolean(paused);
    if (this.paused) {
      for (const timer of this.timers.values()) clearTimeout(timer);
      this.timers.clear();
      this.queue = [];
      this.onStatus?.({ status: "paused" });
      return;
    }

    this.onStatus?.({ status: "waiting" });
    await this.syncAll();
  }

  async waitForIdle() {
    while (this.running || this.queue.length > 0 || this.timers.size > 0) {
      await sleep(10);
    }
  }

  async syncOne(relativePath) {
    if (this.paused) return { skipped: true };
    const sourceFolder = this.getSourceFolder();
    if (!sourceFolder) return { skipped: true };

    const filePath = resolveInside(sourceFolder, relativePath);
    let stat;
    try {
      stat = await fsp.stat(filePath);
    } catch (error) {
      if (error.code === "ENOENT") return { skipped: true };
      throw error;
    }
    if (!stat.isFile()) return { skipped: true };

    const pairedDevice = this.getPairedDevice();
    if (!pairedDevice?.baseUrl || !pairedDevice?.token) {
      const error = new Error("No paired destination device");
      this.onStatus?.({ status: "error", currentFile: relativePath, error: error.message });
      this.onActivity?.({ type: "send", status: "failed", path: relativePath, direction: "out", error: error.message });
      return { ok: false, error };
    }

    this.onStatus?.({ status: "syncing", currentFile: relativePath });
    try {
      await waitForStableFile(filePath, this.stabilityMs);
      await this.transport(pairedDevice, filePath, relativePath);
      this.onStatus?.({ status: "success", currentFile: relativePath });
      this.onActivity?.({ type: "send", status: "success", path: relativePath, direction: "out" });
      return { ok: true };
    } catch (error) {
      this.onStatus?.({ status: "error", currentFile: relativePath, error: error.message });
      this.onActivity?.({ type: "send", status: "failed", path: relativePath, direction: "out", error: error.message });
      return { ok: false, error };
    }
  }
}

export { listFiles, uploadFile, waitForStableFile };
