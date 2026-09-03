import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { DEFAULT_IGNORE_RULES, isIgnoredPath, normalizeIgnoreRules } from "./mirror-utils.js";
import { normalizeRelativePath, resolveInside, toRelativePath } from "./path-utils.js";

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function listFiles(rootFolder, { ignoreRules = DEFAULT_IGNORE_RULES } = {}) {
  const files = [];
  const rules = normalizeIgnoreRules(ignoreRules);
  async function visit(folder, relativeFolder = "") {
    let entries;
    try {
      entries = await fsp.readdir(folder, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const fullPath = path.join(folder, entry.name);
      const relativePath = relativeFolder ? path.posix.join(relativeFolder, entry.name) : entry.name;
      if (isIgnoredPath(relativePath, rules)) continue;
      if (entry.isDirectory()) {
        await visit(fullPath, relativePath);
      } else if (entry.isFile()) {
        files.push(toRelativePath(rootFolder, fullPath));
      }
    }
  }
  await visit(rootFolder);
  return files.sort();
}

async function waitForStableFile(filePath, stabilityMs, maxChecks = 5) {
  let previous = await fsp.stat(filePath);
  for (let check = 0; check < maxChecks; check += 1) {
    await sleep(stabilityMs);
    const current = await fsp.stat(filePath);
    if (previous.size === current.size && previous.mtimeMs === current.mtimeMs) return current;
    previous = current;
  }
  return previous;
}

function uploadFile({ baseUrl, token, sourceDeviceId }, filePath, relativePath, mirror) {
  const endpoint = new URL("/api/files", baseUrl);
  endpoint.searchParams.set("path", relativePath);
  if (mirror?.id) endpoint.searchParams.set("mirrorId", mirror.id);

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
  constructor({ getSourceFolder, getPairedDevice, getMirror = () => null, getIgnoreRules = () => DEFAULT_IGNORE_RULES, onStatus, onActivity, transport = uploadFile, debounceMs = 250, stabilityMs = 120, stabilityChecks = 5 }) {
    this.getSourceFolder = getSourceFolder;
    this.getPairedDevice = getPairedDevice;
    this.getMirror = getMirror;
    this.getIgnoreRules = getIgnoreRules;
    this.onStatus = onStatus;
    this.onActivity = onActivity;
    this.transport = transport;
    this.debounceMs = debounceMs;
    this.stabilityMs = stabilityMs;
    this.stabilityChecks = stabilityChecks;
    this.watcher = null;
    this.timers = new Map();
    this.queue = [];
    this.queued = new Set();
    this.running = false;
    this.paused = false;
    this.syncAllPromise = null;
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
    this.queued.clear();
    while (this.running) await sleep(5);
  }

  async syncAll() {
    if (this.syncAllPromise) return this.syncAllPromise;
    this.syncAllPromise = this.performSyncAll();
    try {
      return await this.syncAllPromise;
    } finally {
      this.syncAllPromise = null;
    }
  }

  async performSyncAll() {
    if (this.paused) return;
    const sourceFolder = this.getSourceFolder();
    if (!sourceFolder) return;
    const files = await listFiles(sourceFolder, { ignoreRules: this.getIgnoreRules() });
    const mirror = this.getMirror();
    this.onStatus?.({ mirrorId: mirror?.id, status: "syncing", total: files.length, completed: 0, pendingCount: files.length });
    let failed = null;
    let completed = 0;
    for (const relativePath of files) {
      const result = await this.syncOne(relativePath);
      if (!result.ok && !result.skipped) failed = result.error || failed;
      completed += 1;
      this.onStatus?.({
        mirrorId: mirror?.id,
        status: "syncing",
        completed,
        total: files.length,
        fileCount: files.length,
        pendingCount: files.length - completed
      });
    }
    if (failed) this.onStatus?.({ mirrorId: mirror?.id, status: "error", error: failed.message, pendingCount: 0 });
    else this.onStatus?.({ mirrorId: mirror?.id, status: "success", fileCount: files.length, pendingCount: 0 });
  }

  enqueue(relativePath) {
    if (this.paused) return;
    const normalized = normalizeRelativePath(relativePath);
    if (isIgnoredPath(normalized, this.getIgnoreRules())) return;
    const existing = this.timers.get(normalized);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.timers.delete(normalized);
      if (!this.queued.has(normalized)) {
        this.queue.push(normalized);
        this.queued.add(normalized);
      }
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
        const relativePath = this.queue.shift();
        this.queued.delete(relativePath);
        await this.syncOne(relativePath);
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
      this.queued.clear();
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
    if (isIgnoredPath(relativePath, this.getIgnoreRules())) return { skipped: true };

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

    const mirror = this.getMirror();
    this.onStatus?.({ mirrorId: mirror?.id, status: "syncing", currentFile: relativePath, pendingCount: this.pendingCount() });
    try {
      await waitForStableFile(filePath, this.stabilityMs, this.stabilityChecks);
      await this.transport(pairedDevice, filePath, relativePath, mirror);
      this.onStatus?.({ mirrorId: mirror?.id, status: "success", currentFile: relativePath, pendingCount: this.pendingCount() });
      this.onActivity?.({ type: "send", status: "success", path: relativePath, mirrorId: mirror?.id, mirrorName: mirror?.name, direction: "out" });
      return { ok: true };
    } catch (error) {
      if (error.code === "ENOENT") return { skipped: true };
      this.onStatus?.({ mirrorId: mirror?.id, status: "error", currentFile: relativePath, error: error.message, pendingCount: this.pendingCount() });
      this.onActivity?.({ type: "send", status: "failed", path: relativePath, mirrorId: mirror?.id, mirrorName: mirror?.name, direction: "out", error: error.message });
      return { ok: false, error };
    }
  }

  pendingCount() {
    return this.queue.length + this.timers.size + (this.running ? 1 : 0);
  }
}

export { listFiles, uploadFile, waitForStableFile };
