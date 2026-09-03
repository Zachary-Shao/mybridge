const ONLINE_WINDOW_MS = 6_000;

export class RuntimeState {
  constructor() {
    this.syncStatus = "idle";
    this.currentFile = null;
    this.lastError = null;
    this.lastSyncAt = null;
    this.devices = new Map();
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

  rememberDevice(device) {
    this.devices.set(device.deviceId, { ...device, lastSeen: Date.now() });
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

  publicState(config) {
    const devices = this.listDevices();
    const pairedId = config.pairedDevice?.deviceId || config.pairedSource?.deviceId;
    const pairedDevice = devices.find((device) => device.deviceId === pairedId);

    return {
      device: {
        id: config.deviceId,
        name: config.deviceName,
        httpPort: config.httpPort,
        role: config.sourceFolder ? "source" : config.destinationFolder ? "destination" : "unconfigured"
      },
      config: {
        sourceFolder: config.sourceFolder,
        destinationFolder: config.destinationFolder,
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
        currentFile: this.currentFile,
        lastError: this.lastError,
        lastSyncAt: this.lastSyncAt
      },
      discoveredDevices: devices,
      activity: config.activity
    };
  }
}
