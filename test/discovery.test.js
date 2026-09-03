import test from "node:test";
import assert from "node:assert/strict";
import { Discovery } from "../src/discovery.js";

test("discovery announces another local agent", async () => {
  const port = 39_000 + Math.floor(Math.random() * 500);
  const discovered = [];
  const first = new Discovery({
    port,
    getHttpPort: () => 41001,
    deviceId: "device-a",
    getDeviceName: () => "Windows test",
    getRole: () => "source",
    intervalMs: 50,
    broadcastAddress: "127.0.0.1",
    onDevice: (device) => discovered.push(device)
  });
  const second = new Discovery({
    port,
    getHttpPort: () => 41002,
    deviceId: "device-b",
    getDeviceName: () => "Mac test",
    getRole: () => "destination",
    intervalMs: 50,
    broadcastAddress: "127.0.0.1"
  });

  await first.start();
  await second.start();
  try {
    await new Promise((resolve) => setTimeout(resolve, 180));
    assert.ok(discovered.some((device) => device.deviceId === "device-b"));
    assert.match(discovered.find((device) => device.deviceId === "device-b").baseUrl, /^http:\/\/[^:]+:41002$/);
  } finally {
    await second.stop();
    await first.stop();
  }
});
