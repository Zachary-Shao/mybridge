import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createMirror, normalizeIgnoreRules, sanitizeFolderName } from "./mirror-utils.js";

function platformDataDir() {
  if (process.env.MYBRIDGE_DATA_DIR) {
    return path.resolve(process.env.MYBRIDGE_DATA_DIR);
  }

  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "MyBridge");
  }

  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "MyBridge");
  }

  return path.join(os.homedir(), ".mybridge");
}

function validPort(value, fallback, { allowZero = false } = {}) {
  const port = Number(value);
  const minimum = allowZero ? 0 : 1;
  return Number.isInteger(port) && port >= minimum && port <= 65535 ? port : fallback;
}

function defaultConfig({ deviceName, httpPort, udpPort, mybridgeRoot }) {
  return {
    version: 3,
    deviceId: randomUUID(),
    deviceName: deviceName || os.hostname(),
    httpPort: validPort(httpPort ?? 39875, 39875, { allowZero: true }),
    udpPort: validPort(udpPort ?? 39876, 39876),
    mybridgeRoot: path.resolve(mybridgeRoot || path.join(os.homedir(), "MyBridge")),
    ignoreRules: normalizeIgnoreRules(),
    mirrors: [],
    sourceFolder: "",
    destinationFolder: "",
    pairedDevice: null,
    pairedSource: null,
    activity: []
  };
}

function normalizeMirror(raw) {
  if (!raw || typeof raw !== "object" || !raw.sourcePath) return null;
  const mirror = createMirror(raw);
  return {
    ...mirror,
    name: String(raw.name || mirror.name).trim() || mirror.name,
    sourceDeviceName: String(raw.sourceDeviceName || ""),
    targetFolderName: sanitizeFolderName(raw.targetFolderName || mirror.targetFolderName),
    enabled: raw.enabled !== false
  };
}

function normalizeConfig(raw, defaults) {
  return {
    ...defaults,
    ...raw,
    version: 3,
    deviceId: raw?.deviceId || defaults.deviceId,
    deviceName: raw?.deviceName || defaults.deviceName,
    httpPort: validPort(raw?.httpPort ?? defaults.httpPort, defaults.httpPort, { allowZero: true }),
    udpPort: validPort(raw?.udpPort ?? defaults.udpPort, defaults.udpPort),
    mybridgeRoot: raw?.mybridgeRoot ? path.resolve(String(raw.mybridgeRoot)) : defaults.mybridgeRoot,
    ignoreRules: normalizeIgnoreRules(raw?.ignoreRules),
    mirrors: Array.isArray(raw?.mirrors) ? raw.mirrors.map(normalizeMirror).filter(Boolean) : [],
    sourceFolder: typeof raw?.sourceFolder === "string" ? raw.sourceFolder : "",
    destinationFolder: typeof raw?.destinationFolder === "string" ? raw.destinationFolder : "",
    pairedDevice: raw?.pairedDevice || null,
    pairedSource: raw?.pairedSource || null,
    activity: Array.isArray(raw?.activity) ? raw.activity.slice(0, 50) : []
  };
}

export class ConfigStore {
  constructor(options = {}) {
    this.dataDir = path.resolve(options.dataDir || platformDataDir());
    this.filePath = path.join(this.dataDir, "config.json");
    this.defaults = defaultConfig(options);
    this.config = null;
    this.activitySaveTimer = null;
    this.lastActivitySaveAt = 0;
    this.activitySaveDelayMs = Number(options.activitySaveDelayMs ?? 100);
  }

  load() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    let raw = null;

    if (fs.existsSync(this.filePath)) {
      try {
        raw = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      } catch (error) {
        throw new Error(`Cannot read MyBridge config: ${error.message}`);
      }
    }

    this.config = normalizeConfig(raw, this.defaults);
    this.save();
    return this.config;
  }

  get() {
    if (!this.config) {
      return this.load();
    }
    return this.config;
  }

  update(patch) {
    this.config = normalizeConfig({ ...this.get(), ...patch }, this.defaults);
    this.save();
    return this.config;
  }

  addActivity(event) {
    const activity = {
      id: randomUUID(),
      at: new Date().toISOString(),
      ...event
    };
    this.config = this.get();
    this.config.activity = [activity, ...this.config.activity].slice(0, 50);
    this.scheduleActivitySave();
    return activity;
  }

  scheduleActivitySave() {
    const elapsed = Date.now() - this.lastActivitySaveAt;
    if (elapsed >= this.activitySaveDelayMs) {
      this.save();
      return;
    }
    if (this.activitySaveTimer) return;
    this.activitySaveTimer = setTimeout(() => {
      this.activitySaveTimer = null;
      this.save();
    }, this.activitySaveDelayMs - elapsed);
  }

  flush() {
    if (this.activitySaveTimer) clearTimeout(this.activitySaveTimer);
    this.activitySaveTimer = null;
    if (this.config) this.save();
  }

  save() {
    fs.mkdirSync(this.dataDir, { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(this.config, null, 2)}\n`, "utf8");
    fs.renameSync(temporaryPath, this.filePath);
    this.lastActivitySaveAt = Date.now();
  }
}

export { platformDataDir };
