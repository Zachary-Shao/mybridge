import dgram from "node:dgram";

const ANNOUNCE_TYPE = "mybridge-discovery";

export class Discovery {
  constructor({ port, getHttpPort, deviceId, getDeviceName, getRole, onDevice, intervalMs = 2_000, broadcastAddress = "255.255.255.255" }) {
    this.port = Number(port) || 39876;
    this.getHttpPort = getHttpPort;
    this.deviceId = deviceId;
    this.getDeviceName = getDeviceName;
    this.getRole = getRole;
    this.onDevice = onDevice;
    this.intervalMs = intervalMs;
    this.broadcastAddress = broadcastAddress;
    this.socket = null;
    this.timer = null;
  }

  async start() {
    if (this.socket) return;
    this.socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    this.socket.on("message", (message, remote) => {
      try {
        const packet = JSON.parse(message.toString("utf8"));
        if (packet.type !== ANNOUNCE_TYPE || packet.deviceId === this.deviceId) return;
        if (!packet.httpPort || !packet.deviceName) return;
        this.onDevice?.({
          deviceId: packet.deviceId,
          deviceName: packet.deviceName,
          role: packet.role || "unconfigured",
          baseUrl: `http://${remote.address}:${packet.httpPort}`
        });
      } catch {
        // Ignore unrelated UDP broadcast traffic.
      }
    });
    this.socket.on("error", () => {
      // Discovery is best-effort. The HTTP manual-pair flow remains available.
    });

    await new Promise((resolve, reject) => {
      const onError = (error) => {
        this.socket?.off("listening", onListening);
        const failedSocket = this.socket;
        this.socket = null;
        try {
          failedSocket?.close();
        } catch {
          // The socket may never have reached the bound state.
        }
        reject(error);
      };
      const onListening = () => {
        this.socket?.off("error", onError);
        this.socket?.setBroadcast(true);
        resolve();
      };
      this.socket.once("error", onError);
      this.socket.once("listening", onListening);
      this.socket.bind(this.port, "0.0.0.0");
    });

    this.broadcast();
    this.timer = setInterval(() => this.broadcast(), this.intervalMs);
  }

  broadcast() {
    if (!this.socket) return;
    const packet = Buffer.from(JSON.stringify({
      type: ANNOUNCE_TYPE,
      version: 1,
      deviceId: this.deviceId,
      deviceName: this.getDeviceName(),
      httpPort: this.getHttpPort(),
      role: this.getRole(),
      at: Date.now()
    }));
    this.socket.send(packet, 0, packet.length, this.port, this.broadcastAddress, () => {});
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (!this.socket) return;
    const socket = this.socket;
    this.socket = null;
    await new Promise((resolve) => socket.close(() => resolve()));
  }
}
