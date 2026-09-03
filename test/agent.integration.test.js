import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Agent } from "../src/agent.js";

async function eventually(check, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for sync");
}

async function getJson(url) {
  const response = await fetch(url);
  return response.json();
}

test("two agents pair and sync new and updated files", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mybridge-e2e-"));
  const sourceFolder = path.join(root, "windows-source");
  const destinationFolder = path.join(root, "mac-destination");
  const sourceData = path.join(root, "source-data");
  const destinationData = path.join(root, "destination-data");
  await fs.mkdir(sourceFolder);
  await fs.mkdir(destinationFolder);

  const destination = new Agent({ dataDir: destinationData, deviceName: "Mac test", httpPort: 0, enableDiscovery: false });
  const source = new Agent({ dataDir: sourceData, deviceName: "Windows test", httpPort: 0, enableDiscovery: false });

  await destination.start();
  await source.start();
  try {
    await destination.updateSettings({ destinationFolder });
    await source.updateSettings({ sourceFolder });
    const stateAfterPair = await source.pairWithRemote({
      deviceId: destination.store.get().deviceId,
      deviceName: "Mac test",
      baseUrl: `http://127.0.0.1:${destination.port}`
    });

    assert.equal(stateAfterPair.config.pairedDevice.deviceName, "Mac test");
    await fs.mkdir(path.join(sourceFolder, "reports"));
    await fs.writeFile(path.join(sourceFolder, "reports", "prices.csv"), "symbol,close\nA,10\n");
    await eventually(async () => (await fs.readFile(path.join(destinationFolder, "reports", "prices.csv"), "utf8").catch(() => "")) === "symbol,close\nA,10\n");

    await fs.writeFile(path.join(sourceFolder, "reports", "prices.csv"), "symbol,close\nA,11\n");
    await eventually(async () => (await fs.readFile(path.join(destinationFolder, "reports", "prices.csv"), "utf8")) === "symbol,close\nA,11\n");

    const sourceState = await getJson(`http://127.0.0.1:${source.port}/api/state`);
    const destinationState = await getJson(`http://127.0.0.1:${destination.port}/api/state`);
    assert.equal(sourceState.sync.status, "success");
    assert.equal(destinationState.activity[0].status, "success");
  } finally {
    await source.stop();
    await destination.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("source agent recovers after destination restarts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mybridge-reconnect-"));
  const sourceFolder = path.join(root, "source");
  const destinationFolder = path.join(root, "destination");
  const sourceData = path.join(root, "source-data");
  const destinationData = path.join(root, "destination-data");
  const udpPort = 39_500 + Math.floor(Math.random() * 300);
  await fs.mkdir(sourceFolder);
  await fs.mkdir(destinationFolder);

  const destination = new Agent({ dataDir: destinationData, deviceName: "Mac reconnect", httpPort: 0, udpPort });
  const source = new Agent({ dataDir: sourceData, deviceName: "Windows reconnect", httpPort: 0, udpPort });
  let restartedDestination;
  await destination.start();
  await source.start();
  try {
    await destination.updateSettings({ destinationFolder });
    await source.updateSettings({ sourceFolder });
    await source.pairWithRemote({
      deviceId: destination.store.get().deviceId,
      deviceName: "Mac reconnect",
      baseUrl: `http://127.0.0.1:${destination.port}`
    });
    await destination.stop();

    await fs.writeFile(path.join(sourceFolder, "after-sleep.txt"), "back online");
    restartedDestination = new Agent({ dataDir: destinationData, deviceName: "Mac reconnect", httpPort: 0, udpPort });
    await restartedDestination.start();
    await eventually(async () => (await fs.readFile(path.join(destinationFolder, "after-sleep.txt"), "utf8").catch(() => "")) === "back online", 8000);
    assert.equal((await getJson(`http://127.0.0.1:${source.port}/api/state`)).sync.status, "success");
  } finally {
    await source.stop();
    await restartedDestination?.stop();
    await destination.stop().catch(() => {});
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("adds a folder mirror, creates the Mac folder, and preserves nested paths", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mybridge-folder-mirror-"));
  const sourceFolder = path.join(root, "windows", "project");
  const mirrorRoot = path.join(root, "mac", "MyBridge");
  const sourceData = path.join(root, "source-data");
  const destinationData = path.join(root, "destination-data");
  await fs.mkdir(path.join(sourceFolder, "output"), { recursive: true });
  await fs.writeFile(path.join(sourceFolder, "README.md"), "initial project");
  await fs.writeFile(path.join(sourceFolder, "output", "报告.md"), "first report");
  await fs.mkdir(path.join(sourceFolder, ".git"));
  await fs.writeFile(path.join(sourceFolder, ".git", "config"), "must not mirror");

  const destination = new Agent({ dataDir: destinationData, mybridgeRoot: mirrorRoot, deviceName: "Mac mirror", httpPort: 0, enableDiscovery: false });
  const source = new Agent({ dataDir: sourceData, deviceName: "Windows project", httpPort: 0, enableDiscovery: false });
  await destination.start();
  await source.start();
  try {
    await source.pairWithRemote({
      deviceId: destination.store.get().deviceId,
      deviceName: "Mac mirror",
      baseUrl: `http://127.0.0.1:${destination.port}`
    });
    const state = await source.addMirror({ sourcePath: sourceFolder, name: "Project Mirror" });
    const mirror = state.mirrors[0];
    assert.equal(mirror.name, "Project Mirror");
    assert.equal(mirror.targetFolderName, "Project Mirror");

    const targetFolder = path.join(mirrorRoot, "Project Mirror");
    await eventually(async () => (await fs.readFile(path.join(targetFolder, "README.md"), "utf8").catch(() => "")) === "initial project");
    await eventually(async () => (await fs.readFile(path.join(targetFolder, "output", "报告.md"), "utf8").catch(() => "")) === "first report");
    assert.equal(await fs.access(path.join(targetFolder, ".git", "config")).then(() => true).catch(() => false), false);

    await fs.mkdir(path.join(sourceFolder, "output", "2026", "09"), { recursive: true });
    await fs.writeFile(path.join(sourceFolder, "output", "2026", "09", "latest.csv"), "A,10\n");
    await eventually(async () => (await fs.readFile(path.join(targetFolder, "output", "2026", "09", "latest.csv"), "utf8").catch(() => "")) === "A,10\n");

    await fs.writeFile(path.join(sourceFolder, "README.md"), "updated project");
    await eventually(async () => (await fs.readFile(path.join(targetFolder, "README.md"), "utf8")) === "updated project");
    assert.equal((await getJson(`http://127.0.0.1:${destination.port}/api/state`)).mirrors[0].targetPath, targetFolder);
  } finally {
    await source.stop();
    await destination.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("folder mirror reconnects and rescans after Mac restarts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mybridge-mirror-reconnect-"));
  const sourceFolder = path.join(root, "source");
  const mirrorRoot = path.join(root, "MyBridge");
  const sourceData = path.join(root, "source-data");
  const destinationData = path.join(root, "destination-data");
  const udpPort = 39_800 + Math.floor(Math.random() * 150);
  await fs.mkdir(sourceFolder, { recursive: true });

  const destination = new Agent({ dataDir: destinationData, mybridgeRoot: mirrorRoot, deviceName: "Mac mirror reconnect", httpPort: 0, udpPort });
  const source = new Agent({ dataDir: sourceData, deviceName: "Windows mirror reconnect", httpPort: 0, udpPort });
  let restartedDestination;
  await destination.start();
  await source.start();
  try {
    await source.pairWithRemote({
      deviceId: destination.store.get().deviceId,
      deviceName: "Mac mirror reconnect",
      baseUrl: `http://127.0.0.1:${destination.port}`
    });
    await source.addMirror({ sourcePath: sourceFolder, name: "Reconnect Project" });
    await destination.stop();
    await fs.writeFile(path.join(sourceFolder, "while-offline.txt"), "queued for Mac");

    restartedDestination = new Agent({ dataDir: destinationData, mybridgeRoot: mirrorRoot, deviceName: "Mac mirror reconnect", httpPort: 0, udpPort });
    await restartedDestination.start();
    await eventually(async () => (await fs.readFile(path.join(mirrorRoot, "Reconnect Project", "while-offline.txt"), "utf8").catch(() => "")) === "queued for Mac", 8_000);
  } finally {
    await source.stop();
    await restartedDestination?.stop();
    await destination.stop().catch(() => {});
    await fs.rm(root, { recursive: true, force: true });
  }
});
