import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { ConfigStore } from "./config.js";
import { Discovery } from "./discovery.js";
import { MyBridgeHttpServer } from "./http-server.js";
import { FileReceiver } from "./receiver.js";
import { RuntimeState } from "./state.js";
import { SyncEngine } from "./sync-engine.js";

function requestJson(baseUrl, route, payload) {
  const endpoint = new URL(route, baseUrl);
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const request = http.request(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body)
      }
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let parsed;
        try {
          parsed = JSON.parse(raw || "{}");
        } catch {
          reject(new Error(`Remote returned invalid JSON (${response.statusCode})`));
          return;
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(parsed.error || `Remote request failed (${response.statusCode})`));
          return;
        }
        resolve(parsed);
      });
    });
    request.setTimeout(5_000, () => request.destroy(new Error("Remote request timed out")));
    request.on("error", reject);
    request.end(body);
  });
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && Boolean(url.hostname);
  } catch {
    return false;
  }
}

export class Agent {
  constructor(options = {}) {
    this.store = new ConfigStore(options);
    this.store.load();
    this.runtime = new RuntimeState();
    this.port = this.store.get().httpPort;

    this.receiver = new FileReceiver({
      getConfig: () => this.store.get(),
      onActivity: (event) => this.recordActivity(event)
    });
    this.syncEngine = new SyncEngine({
      getSourceFolder: () => this.store.get().sourceFolder,
      getPairedDevice: () => ({ ...this.store.get().pairedDevice, sourceDeviceId: this.store.get().deviceId }),
      onStatus: (details) => this.runtime.setSyncStatus(details.status, details),
      onActivity: (event) => this.recordActivity(event)
    });
    this.httpServer = new MyBridgeHttpServer({ agent: this, receiver: this.receiver });
    this.discovery = new Discovery({
      port: this.store.get().udpPort,
      getHttpPort: () => this.port,
      deviceId: this.store.get().deviceId,
      getDeviceName: () => this.store.get().deviceName,
      getRole: () => this.getRole(),
      onDevice: (device) => this.runtime.rememberDevice(device)
    });
    this.enableDiscovery = options.enableDiscovery !== false;
  }

  getRole() {
    const config = this.store.get();
    if (config.sourceFolder) return "source";
    if (config.destinationFolder) return "destination";
    return "unconfigured";
  }

  async start() {
    this.port = await this.httpServer.start();
    if (this.store.get().httpPort !== this.port) this.store.update({ httpPort: this.port });
    if (this.enableDiscovery) await this.discovery.start();
    if (this.store.get().sourceFolder) {
      await this.syncEngine.start({ initialScan: Boolean(this.store.get().pairedDevice) });
    }
    return this;
  }

  async stop() {
    await this.syncEngine.stop();
    await this.discovery.stop();
    await this.httpServer.stop();
  }

  getPublicState() {
    return this.runtime.publicState(this.store.get());
  }

  recordActivity(event) {
    this.store.addActivity(event);
  }

  async updateSettings(payload = {}) {
    const current = this.store.get();
    const sourceFolder = payload.sourceFolder === undefined ? current.sourceFolder : String(payload.sourceFolder).trim();
    const destinationFolder = payload.destinationFolder === undefined ? current.destinationFolder : String(payload.destinationFolder).trim();
    const deviceName = payload.deviceName === undefined ? current.deviceName : String(payload.deviceName).trim();

    if (sourceFolder) {
      const sourceStat = await fs.stat(path.resolve(sourceFolder)).catch(() => null);
      if (!sourceStat?.isDirectory()) throw new Error("Source Folder must be an existing directory");
    }
    if (destinationFolder) await fs.mkdir(path.resolve(destinationFolder), { recursive: true });

    this.store.update({
      deviceName: deviceName || current.deviceName,
      sourceFolder: sourceFolder ? path.resolve(sourceFolder) : "",
      destinationFolder: destinationFolder ? path.resolve(destinationFolder) : ""
    });
    if (sourceFolder) {
      await this.syncEngine.start({ initialScan: Boolean(this.store.get().pairedDevice) });
    } else {
      await this.syncEngine.stop();
    }
    this.recordActivity({ type: "settings", status: "success", path: "folder settings", direction: "local" });
    return this.getPublicState();
  }

  async pairWithRemote(payload = {}) {
    const baseUrl = String(payload.baseUrl || "").trim().replace(/\/$/, "");
    if (!isHttpUrl(baseUrl)) throw new Error("Enter a valid http:// device address");
    const remote = await requestJson(baseUrl, "/api/pair/accept", {
      sourceDeviceId: this.store.get().deviceId,
      sourceDeviceName: this.store.get().deviceName
    });
    if (!remote.token) throw new Error("Remote did not return a pairing token");

    this.store.update({
      pairedDevice: {
        deviceId: payload.deviceId || remote.deviceId,
        deviceName: payload.deviceName || remote.deviceName || baseUrl,
        baseUrl,
        token: remote.token,
        pairedAt: new Date().toISOString()
      }
    });
    this.recordActivity({ type: "pair", status: "success", path: payload.deviceName || baseUrl, direction: "local" });
    if (this.store.get().sourceFolder) await this.syncEngine.start({ initialScan: true });
    return this.getPublicState();
  }

  async acceptPair(payload = {}) {
    if (!payload.sourceDeviceId) throw new Error("Source device ID is required");
    const token = randomBytes(24).toString("hex");
    this.store.update({
      pairedSource: {
        deviceId: String(payload.sourceDeviceId),
        deviceName: String(payload.sourceDeviceName || "Windows source"),
        token,
        pairedAt: new Date().toISOString()
      }
    });
    this.recordActivity({ type: "pair", status: "success", path: payload.sourceDeviceName || "source device", direction: "local" });
    return {
      ok: true,
      deviceId: this.store.get().deviceId,
      deviceName: this.store.get().deviceName,
      token
    };
  }

  async resync() {
    if (!this.store.get().sourceFolder) throw new Error("Source Folder is not configured");
    await this.syncEngine.syncAll();
    return this.getPublicState();
  }
}

export { isHttpUrl, requestJson };
