import path from "node:path";

const ONLINE_WINDOW_MS = 6_000;

export class RuntimeState {
  constructor() {
    this.syncStatus = "waiting";
    this.paused = false;
    this.currentFile = null;
    this.lastError = null;
    this.lastSyncAt = null;
    this.devices = new Map();
    this.mirrors = new Map();
  }

  setSyncStatus(status, details = {}) {
    this.syncStatus = status;
    this.currentFile = details.currentFile ?? this.currentFile;
    this.lastError = details.error ?? (status === "error" ? this.lastError : null);
    if (status === "success") {
      this.lastSyncAt = new Date().toISOString();
      this.currentFile = null;
    }
    if (status === "idle") {
      this.currentFile = null;
    }
  }

  setPaused(paused) {
    this.paused = Boolean(paused);
    if (this.paused) this.syncStatus = "paused";
    else if (this.syncStatus === "paused") this.syncStatus = "waiting";
  }

  setMirrorStatus(mirrorId, details = {}) {
    if (!mirrorId) {
      this.setSyncStatus(details.status, details);
      return;
    }
    const current = this.mirrors.get(mirrorId) || {
      status: "waiting",
      currentFile: null,
      lastError: null,
      lastSyncAt: null,
      fileCount: 0,
      pendingCount: 0,
      completed: 0,
      total: 0
    };
    if (details.status) current.status = details.status;
    if (details.currentFile !== undefined) current.currentFile = details.currentFile;
    if (details.error !== undefined) current.lastError = details.error;
    if (details.total !== undefined) current.total = details.total;
    if (details.completed !== undefined) current.completed = details.completed;
    if (details.fileCount !== undefined) current.fileCount = details.fileCount;
    if (details.pendingCount !== undefined) current.pendingCount = details.pendingCount;
    if (details.status === "success") {
      current.lastSyncAt = new Date().toISOString();
      current.currentFile = null;
      current.lastError = null;
    }
    if (details.status === "waiting") current.currentFile = null;
    this.mirrors.set(mirrorId, current);
    this.recalculateSyncStatus();
  }

  removeMirror(mirrorId) {
    this.mirrors.delete(mirrorId);
    this.recalculateSyncStatus();
  }

  recalculateSyncStatus() {
    if (this.paused) {
      this.syncStatus = "paused";
      return;
    }
    const statuses = [...this.mirrors.values()].map((mirror) => mirror.status);
    if (statuses.includes("syncing")) this.syncStatus = "syncing";
    else if (statuses.includes("error")) this.syncStatus = "error";
    else if (statuses.includes("success")) {
      this.syncStatus = "success";
      this.lastSyncAt = [...this.mirrors.values()].map((mirror) => mirror.lastSyncAt).filter(Boolean).sort().at(-1) || this.lastSyncAt;
    } else if (statuses.length) this.syncStatus = "waiting";
  }

  rememberDevice(device) {
    this.devices.set(device.deviceId, { ...device, lastSeen: Date.now() });
  }

  isOnline(deviceId) {
    const device = this.devices.get(deviceId);
    return Boolean(device && Date.now() - device.lastSeen < ONLINE_WINDOW_MS);
  }

  listDevices() {
    const now = Date.now();
    return [...this.devices.values()]
      .map((device) => ({
        deviceId: device.deviceId,
        deviceName: device.deviceName,
        role: device.role,
        baseUrl: device.baseUrl,
        isOnline: now - device.lastSeen < ONLINE_WINDOW_MS
      }))
      .sort((a, b) => a.deviceName.localeCompare(b.deviceName));
  }

  publicState(config, role) {
    const devices = this.listDevices();
    const pairedId = config.pairedDevice?.deviceId || config.pairedSource?.deviceId;
    const pairedDevice = devices.find((device) => device.deviceId === pairedId);
    const mirrorConfigs = Array.isArray(config.mirrors) ? config.mirrors : [];
    const mirrors = mirrorConfigs.map((mirror) => ({
      id: mirror.id,
      name: mirror.name,
      sourceDeviceId: mirror.sourceDeviceId,
      sourceDeviceName: mirror.sourceDeviceName || "",
      sourcePath: mirror.sourcePath,
      targetDeviceId: mirror.targetDeviceId,
      targetDeviceName: mirror.targetDeviceName,
      targetFolderName: mirror.targetFolderName,
      targetPath: mirror.targetDeviceId === config.deviceId ? path.join(config.mybridgeRoot, mirror.targetFolderName) : null,
      enabled: mirror.enabled !== false,
      ...(this.mirrors.get(mirror.id) || {
        status: mirror.enabled === false ? "paused" : "waiting",
        currentFile: null,
        lastError: null,
        lastSyncAt: null,
        fileCount: 0,
        pendingCount: 0,
        completed: 0,
        total: 0
      })
    }));

    return {
      device: {
        id: config.deviceId,
        name: config.deviceName,
        httpPort: config.httpPort,
        role: role || (config.sourceFolder ? "source" : config.destinationFolder ? "destination" : "unconfigured")
      },
      config: {
        sourceFolder: config.sourceFolder,
        destinationFolder: config.destinationFolder,
        mybridgeRoot: config.mybridgeRoot,
        ignoreRules: config.ignoreRules,
        mirrors,
        pairedDevice: config.pairedDevice
          ? { deviceId: config.pairedDevice.deviceId, deviceName: config.pairedDevice.deviceName, baseUrl: config.pairedDevice.baseUrl }
          : null,
        pairedSource: config.pairedSource
          ? { deviceId: config.pairedSource.deviceId, deviceName: config.pairedSource.deviceName }
          : null
      },
      connection: {
        isOnline: Boolean(pairedDevice?.isOnline),
        device: pairedDevice || null
      },
      sync: {
        status: this.syncStatus,
        paused: this.paused,
        currentFile: this.currentFile,
        lastError: this.lastError,
        lastSyncAt: this.lastSyncAt,
        mirrors
      },
      mirrors,
      discoveredDevices: devices,
      activity: config.activity
    };
  }
}
