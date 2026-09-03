import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { ConfigStore } from "./config.js";
import { Discovery } from "./discovery.js";
import { MyBridgeHttpServer } from "./http-server.js";
import { createMirror, normalizeIgnoreRules, sanitizeFolderName, sourceFolderName, uniqueFolderName } from "./mirror-utils.js";
import { FileReceiver, sameSecret } from "./receiver.js";
import { RuntimeState } from "./state.js";
import { SyncEngine } from "./sync-engine.js";

function requestJson(baseUrl, route, payload, { headers = {} } = {}) {
  const endpoint = new URL(route, baseUrl);
  const body = JSON.stringify(payload);
  return new Promise((resolve, reject) => {
    const request = http.request(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
        ...headers
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
    this.globalPaused = false;
    this.syncEngines = new Map();
    this.registeredMirrorIds = new Set();

    this.receiver = new FileReceiver({
      getConfig: () => this.store.get(),
      onActivity: (event) => this.recordActivity(event),
      onStatus: (details) => this.handleMirrorStatus(details.mirrorId, details)
    });
    this.syncEngine = new SyncEngine({
      getSourceFolder: () => this.store.get().sourceFolder,
      getPairedDevice: () => this.sourceConnection(),
      getIgnoreRules: () => this.store.get().ignoreRules,
      onStatus: (details) => this.handleMirrorStatus(null, details),
      onActivity: (event) => this.recordActivity(event)
    });
    this.httpServer = new MyBridgeHttpServer({ agent: this, receiver: this.receiver });
    this.recoveryTimer = null;
    this.recoveryInFlight = false;
    this.discovery = new Discovery({
      port: this.store.get().udpPort,
      getHttpPort: () => this.port,
      deviceId: this.store.get().deviceId,
      getDeviceName: () => this.store.get().deviceName,
      getRole: () => this.getRole(),
      onDevice: (device) => this.handleDiscoveredDevice(device)
    });
    this.enableDiscovery = options.enableDiscovery !== false;
  }

  sourceConnection() {
    const pairedDevice = this.store.get().pairedDevice;
    return pairedDevice ? { ...pairedDevice, sourceDeviceId: this.store.get().deviceId } : null;
  }

  sourceMirrors(config = this.store.get()) {
    return (config.mirrors || []).filter((mirror) => mirror.sourceDeviceId === config.deviceId);
  }

  targetMirrors(config = this.store.get()) {
    return (config.mirrors || []).filter((mirror) => mirror.targetDeviceId === config.deviceId && mirror.sourceDeviceId !== config.deviceId);
  }

  findMirror(mirrorId) {
    return this.store.get().mirrors.find((mirror) => mirror.id === mirrorId) || null;
  }

  getRole() {
    const config = this.store.get();
    if (config.sourceFolder || this.sourceMirrors(config).length) return "source";
    if (config.destinationFolder || this.targetMirrors(config).length || config.pairedSource || process.platform === "darwin") return "destination";
    return "unconfigured";
  }

  async start() {
    await fs.mkdir(this.store.get().mybridgeRoot, { recursive: true });
    this.port = await this.httpServer.start();
    if (this.store.get().httpPort !== this.port) this.store.update({ httpPort: this.port });
    if (this.enableDiscovery) {
      try {
        await this.discovery.start();
      } catch (error) {
        this.runtime.setSyncStatus("waiting", { error: `局域网发现暂不可用：${error.message}` });
      }
    }

    const config = this.store.get();
    if (config.sourceFolder) await this.syncEngine.start({ initialScan: Boolean(config.pairedDevice) });
    for (const mirror of this.sourceMirrors(config)) {
      let registered = this.registeredMirrorIds.has(mirror.id);
      if (!registered && config.pairedDevice) {
        registered = await this.registerMirror(mirror).then(() => true).catch((error) => {
          this.handleMirrorStatus(mirror.id, { status: "error", error: error.message });
          return false;
        });
      }
      await this.startMirrorEngine(mirror, { initialScan: registered });
    }
    if (!config.sourceFolder && !config.destinationFolder && !this.sourceMirrors(config).length && !this.targetMirrors(config).length) {
      this.runtime.setSyncStatus("waiting");
    }
    return this;
  }

  async stop() {
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
    this.recoveryTimer = null;
    for (const engine of this.syncEngines.values()) await engine.stop();
    this.syncEngines.clear();
    await this.syncEngine.stop();
    await this.discovery.stop();
    await this.httpServer.stop();
    this.store.flush();
  }

  getPublicState() {
    return this.runtime.publicState(this.store.get(), this.getRole());
  }

  isPaused() {
    return this.globalPaused;
  }

  async setPaused(paused) {
    this.globalPaused = Boolean(paused);
    await this.syncEngine.setPaused(this.globalPaused);
    for (const mirror of this.sourceMirrors()) {
      const engine = this.syncEngines.get(mirror.id);
      if (engine && mirror.enabled !== false) await engine.setPaused(this.globalPaused);
    }
    this.runtime.setPaused(this.globalPaused);
    return this.globalPaused;
  }

  handleMirrorStatus(mirrorId, details = {}) {
    this.runtime.setMirrorStatus(mirrorId, details);
  }

  recordActivity(event) {
    this.store.addActivity(event);
  }

  createMirrorEngine(mirrorId) {
    return new SyncEngine({
      getSourceFolder: () => this.findMirror(mirrorId)?.sourcePath,
      getPairedDevice: () => this.sourceConnection(),
      getMirror: () => this.findMirror(mirrorId),
      getIgnoreRules: () => this.store.get().ignoreRules,
      onStatus: (details) => this.handleMirrorStatus(mirrorId, details),
      onActivity: (event) => this.recordActivity(event)
    });
  }

  async startMirrorEngine(mirror, { initialScan = false } = {}) {
    if (!mirror.enabled) return null;
    let engine = this.syncEngines.get(mirror.id);
    if (!engine) {
      engine = this.createMirrorEngine(mirror.id);
      this.syncEngines.set(mirror.id, engine);
    }
    await engine.start({ initialScan: initialScan && !this.globalPaused });
    if (this.globalPaused) await engine.setPaused(true);
    return engine;
  }

  async stopMirrorEngine(mirrorId) {
    const engine = this.syncEngines.get(mirrorId);
    if (!engine) return;
    await engine.stop();
    this.syncEngines.delete(mirrorId);
  }

  handleDiscoveredDevice(device) {
    const wasOnline = this.runtime.isOnline(device.deviceId);
    this.runtime.rememberDevice(device);
    const config = this.store.get();
    const pairedDevice = config.pairedDevice;
    const isPaired = pairedDevice?.deviceId === device.deviceId
      || config.pairedSource?.deviceId === device.deviceId
      || config.mirrors.some((mirror) => mirror.targetDeviceId === device.deviceId || mirror.sourceDeviceId === device.deviceId);
    if (!isPaired) return;

    if (pairedDevice?.deviceId === device.deviceId && pairedDevice.baseUrl !== device.baseUrl) {
      this.store.update({ pairedDevice: { ...pairedDevice, baseUrl: device.baseUrl } });
    }
    if (!wasOnline && this.sourceMirrors(config).length && !this.isPaused()) this.scheduleRecovery();
  }

  scheduleRecovery() {
    if (this.recoveryTimer || this.recoveryInFlight) return;
    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = null;
      void this.recoverSync();
    }, 250);
  }

  async recoverSync() {
    if (this.recoveryInFlight || this.isPaused()) return;
    const config = this.store.get();
    if (!config.sourceFolder && !this.sourceMirrors(config).length) return;
    this.recoveryInFlight = true;
    try {
      for (const mirror of this.sourceMirrors()) {
        if (!mirror.enabled) continue;
        const registered = await this.registerMirror(mirror).then(() => true).catch((error) => {
          this.handleMirrorStatus(mirror.id, { status: "error", error: error.message });
          return false;
        });
        const engine = await this.startMirrorEngine(this.findMirror(mirror.id) || mirror, { initialScan: false });
        if (registered && engine) await engine.syncAll();
      }
      if (config.sourceFolder) await this.syncEngine.syncAll();
    } catch (error) {
      this.runtime.setSyncStatus("error", { error: error.message });
    } finally {
      this.recoveryInFlight = false;
    }
  }

  async handleResume() {
    this.runtime.setSyncStatus("waiting");
    await this.recoverSync();
  }

  async updateSettings(payload = {}) {
    const current = this.store.get();
    const sourceFolder = payload.sourceFolder === undefined ? current.sourceFolder : String(payload.sourceFolder).trim();
    const destinationFolder = payload.destinationFolder === undefined ? current.destinationFolder : String(payload.destinationFolder).trim();
    const deviceName = payload.deviceName === undefined ? current.deviceName : String(payload.deviceName).trim();
    const mybridgeRoot = payload.mybridgeRoot === undefined ? current.mybridgeRoot : path.resolve(String(payload.mybridgeRoot).trim());
    const ignoreRules = normalizeIgnoreRules(payload.ignoreRules === undefined ? current.ignoreRules : payload.ignoreRules);

    if (sourceFolder) {
      const sourceStat = await fs.stat(path.resolve(sourceFolder)).catch(() => null);
      if (!sourceStat?.isDirectory()) throw new Error("Source Folder must be an existing directory");
    }
    if (destinationFolder) await fs.mkdir(path.resolve(destinationFolder), { recursive: true });
    await fs.mkdir(mybridgeRoot, { recursive: true });

    this.store.update({
      deviceName: deviceName || current.deviceName,
      mybridgeRoot,
      ignoreRules,
      sourceFolder: sourceFolder ? path.resolve(sourceFolder) : "",
      destinationFolder: destinationFolder ? path.resolve(destinationFolder) : ""
    });
    if (sourceFolder) await this.syncEngine.start({ initialScan: Boolean(this.store.get().pairedDevice) });
    else await this.syncEngine.stop();
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
    for (const mirror of this.sourceMirrors()) {
      const registered = await this.registerMirror(mirror).then(() => true).catch((error) => {
        this.handleMirrorStatus(mirror.id, { status: "error", error: error.message });
        return false;
      });
      const engine = await this.startMirrorEngine(this.findMirror(mirror.id) || mirror, { initialScan: false });
      if (registered && engine) await engine.syncAll();
    }
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

  async registerMirror(mirror) {
    const pairedDevice = this.store.get().pairedDevice;
    if (!pairedDevice?.baseUrl || !pairedDevice?.token) throw new Error("No paired destination device");
    const response = await requestJson(pairedDevice.baseUrl, "/api/mirrors/accept", {
      mirrorId: mirror.id,
      name: mirror.name,
      sourceDeviceId: this.store.get().deviceId,
      sourceDeviceName: this.store.get().deviceName,
      sourcePath: mirror.sourcePath
    }, {
      headers: {
        "x-mybridge-token": pairedDevice.token,
        "x-mybridge-source-id": this.store.get().deviceId
      }
    });
    const targetFolderName = sanitizeFolderName(response.targetFolderName || mirror.targetFolderName || mirror.name);
    const updatedMirror = {
      ...mirror,
      targetDeviceId: response.deviceId || pairedDevice.deviceId,
      targetDeviceName: response.deviceName || pairedDevice.deviceName,
      targetFolderName
    };
    this.store.update({ mirrors: this.store.get().mirrors.map((item) => item.id === mirror.id ? updatedMirror : item) });
    this.registeredMirrorIds.add(mirror.id);
    this.handleMirrorStatus(mirror.id, { status: "waiting" });
    return updatedMirror;
  }

  async acceptMirror(payload = {}, { token, sourceId } = {}) {
    const config = this.store.get();
    if (!sameSecret(token, config.pairedSource?.token)) throw new Error("Pairing token rejected");
    if (config.pairedSource?.deviceId && sourceId !== config.pairedSource.deviceId) throw new Error("Unknown source device");
    if (!payload.mirrorId || !payload.sourceDeviceId || !payload.sourcePath) throw new Error("Mirror details are required");
    if (payload.sourceDeviceId !== config.pairedSource?.deviceId) throw new Error("Unknown source device");

    const existing = config.mirrors.find((mirror) => mirror.id === String(payload.mirrorId) && mirror.sourceDeviceId === payload.sourceDeviceId);
    const usedNames = config.mirrors.filter((mirror) => mirror.id !== existing?.id).map((mirror) => mirror.targetFolderName);
    const targetFolderName = existing?.targetFolderName || uniqueFolderName(payload.name || sourceFolderName(payload.sourcePath), usedNames);
    const mirror = {
      ...createMirror({
        id: String(payload.mirrorId),
        name: String(payload.name || sourceFolderName(payload.sourcePath)),
        sourceDeviceId: String(payload.sourceDeviceId),
        sourcePath: String(payload.sourcePath),
        targetDeviceId: config.deviceId,
        targetDeviceName: config.deviceName,
        targetFolderName
      }),
      sourceDeviceName: String(payload.sourceDeviceName || config.pairedSource.deviceName || "Windows source")
    };
    await fs.mkdir(path.join(config.mybridgeRoot, targetFolderName), { recursive: true });
    this.store.update({ mirrors: [...config.mirrors.filter((item) => item.id !== mirror.id), mirror] });
    this.handleMirrorStatus(mirror.id, { status: mirror.enabled ? "waiting" : "paused" });
    return {
      ok: true,
      mirrorId: mirror.id,
      deviceId: config.deviceId,
      deviceName: config.deviceName,
      targetFolderName,
      targetPath: path.join(config.mybridgeRoot, targetFolderName)
    };
  }

  async addMirror(payload = {}) {
    const current = this.store.get();
    if (!current.pairedDevice?.baseUrl || !current.pairedDevice?.token) throw new Error("请先连接 Mac 设备");
    const sourcePath = path.resolve(String(payload.sourcePath || "").trim());
    const sourceStat = await fs.stat(sourcePath).catch(() => null);
    if (!sourceStat?.isDirectory()) throw new Error("Project Folder must be an existing directory");
    const name = String(payload.name || sourceFolderName(sourcePath)).trim() || sourceFolderName(sourcePath);
    const targetFolderName = uniqueFolderName(name, current.mirrors.map((mirror) => mirror.targetFolderName));
    const mirror = createMirror({
      name,
      sourceDeviceId: current.deviceId,
      sourcePath,
      targetDeviceId: current.pairedDevice.deviceId,
      targetDeviceName: current.pairedDevice.deviceName,
      targetFolderName
    });
    this.store.update({ mirrors: [...current.mirrors, mirror] });
    await this.startMirrorEngine(mirror);
    try {
      await this.registerMirror(mirror);
      const engine = this.syncEngines.get(mirror.id);
      if (engine) await engine.syncAll();
      return this.getPublicState();
    } catch (error) {
      this.handleMirrorStatus(mirror.id, { status: "error", error: error.message });
      this.recordActivity({ type: "mirror", status: "failed", path: mirror.name, direction: "local", error: error.message });
      return this.getPublicState();
    }
  }

  async setMirrorPaused(mirrorId, paused) {
    const mirror = this.findMirror(mirrorId);
    if (!mirror) throw new Error("Mirror not found");
    const enabled = !Boolean(paused);
    this.store.update({ mirrors: this.store.get().mirrors.map((item) => item.id === mirror.id ? { ...item, enabled } : item) });
    if (enabled) {
      const updated = this.findMirror(mirror.id);
      await this.startMirrorEngine(updated, { initialScan: true });
      this.handleMirrorStatus(mirror.id, { status: "waiting" });
    } else {
      await this.stopMirrorEngine(mirror.id);
      this.handleMirrorStatus(mirror.id, { status: "paused" });
    }
    return this.getPublicState();
  }

  async removeMirror(mirrorId, { notifyRemote = true } = {}) {
    const mirror = this.findMirror(mirrorId);
    if (!mirror) throw new Error("Mirror not found");
    let remoteError = null;
    if (notifyRemote && mirror.sourceDeviceId === this.store.get().deviceId && this.store.get().pairedDevice) {
      try {
        const paired = this.store.get().pairedDevice;
        await requestJson(paired.baseUrl, "/api/mirrors/remove", { mirrorId: mirror.id }, {
          headers: { "x-mybridge-token": paired.token, "x-mybridge-source-id": this.store.get().deviceId }
        });
      } catch (error) {
        remoteError = error;
      }
    }
    await this.stopMirrorEngine(mirror.id);
    this.registeredMirrorIds.delete(mirror.id);
    this.store.update({ mirrors: this.store.get().mirrors.filter((item) => item.id !== mirror.id) });
    this.runtime.removeMirror(mirror.id);
    this.recordActivity({ type: "mirror", status: remoteError ? "failed" : "success", path: mirror.name, direction: "local", error: remoteError?.message });
    return this.getPublicState();
  }

  async resync() {
    const config = this.store.get();
    if (!config.sourceFolder && !this.sourceMirrors(config).length) throw new Error("Source Folder is not configured");
    await this.recoverSync();
    return this.getPublicState();
  }
}

export { isHttpUrl, requestJson };
