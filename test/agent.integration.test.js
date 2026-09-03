import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Agent } from "../src/agent.js";
import { listFiles } from "../src/sync-engine.js";

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

test("creates distinct empty mirrors and never deletes files when a mirror is removed", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mybridge-mirror-remove-"));
  const sourceFolder = path.join(root, "source");
  const mirrorRoot = path.join(root, "MyBridge");
  const sourceData = path.join(root, "source-data");
  const destinationData = path.join(root, "destination-data");
  await fs.mkdir(sourceFolder, { recursive: true });
  const destination = new Agent({ dataDir: destinationData, mybridgeRoot: mirrorRoot, deviceName: "Mac empty", httpPort: 0, enableDiscovery: false });
  const source = new Agent({ dataDir: sourceData, deviceName: "Windows empty", httpPort: 0, enableDiscovery: false });
  await destination.start();
  await source.start();
  try {
    await source.pairWithRemote({ deviceId: destination.store.get().deviceId, deviceName: "Mac empty", baseUrl: `http://127.0.0.1:${destination.port}` });
    const first = await source.addMirror({ sourcePath: sourceFolder, name: "Project" });
    const second = await source.addMirror({ sourcePath: sourceFolder, name: "Project" });
    assert.deepEqual(first.mirrors.map((mirror) => mirror.targetFolderName), ["Project"]);
    assert.deepEqual(second.mirrors.map((mirror) => mirror.targetFolderName), ["Project", "Project (2)"]);
    await fs.access(path.join(mirrorRoot, "Project"));
    await fs.access(path.join(mirrorRoot, "Project (2)"));

    await fs.writeFile(path.join(sourceFolder, "kept.txt"), "keep this file");
    await eventually(async () => (await fs.readFile(path.join(mirrorRoot, "Project", "kept.txt"), "utf8").catch(() => "")) === "keep this file");
    await source.removeMirror(first.mirrors[0].id);
    assert.equal(await fs.readFile(path.join(mirrorRoot, "Project", "kept.txt"), "utf8"), "keep this file");
    assert.equal((await getJson(`http://127.0.0.1:${destination.port}/api/state`)).mirrors.some((mirror) => mirror.targetFolderName === "Project"), false);
  } finally {
    await source.stop();
    await destination.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("pauses one folder mirror without affecting another and resumes with a rescan", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mybridge-mirror-pause-"));
  const sourceOne = path.join(root, "source-one");
  const sourceTwo = path.join(root, "source-two");
  const mirrorRoot = path.join(root, "MyBridge");
  const sourceData = path.join(root, "source-data");
  const destinationData = path.join(root, "destination-data");
  await fs.mkdir(sourceOne, { recursive: true });
  await fs.mkdir(sourceTwo, { recursive: true });
  const destination = new Agent({ dataDir: destinationData, mybridgeRoot: mirrorRoot, deviceName: "Mac pause", httpPort: 0, enableDiscovery: false });
  const source = new Agent({ dataDir: sourceData, deviceName: "Windows pause", httpPort: 0, enableDiscovery: false });
  await destination.start();
  await source.start();
  try {
    await source.pairWithRemote({ deviceId: destination.store.get().deviceId, deviceName: "Mac pause", baseUrl: `http://127.0.0.1:${destination.port}` });
    const first = await source.addMirror({ sourcePath: sourceOne, name: "Paused Project" });
    const second = await source.addMirror({ sourcePath: sourceTwo, name: "Live Project" });
    await source.setMirrorPaused(first.mirrors[0].id, true);
    await fs.writeFile(path.join(sourceOne, "held.txt"), "held");
    await fs.writeFile(path.join(sourceTwo, "live.txt"), "live");
    await eventually(async () => (await fs.readFile(path.join(mirrorRoot, "Live Project", "live.txt"), "utf8").catch(() => "")) === "live");
    assert.equal(await fs.access(path.join(mirrorRoot, "Paused Project", "held.txt")).then(() => true).catch(() => false), false);

    await source.setMirrorPaused(first.mirrors[0].id, false);
    await eventually(async () => (await fs.readFile(path.join(mirrorRoot, "Paused Project", "held.txt"), "utf8").catch(() => "")) === "held");
    assert.equal((await getJson(`http://127.0.0.1:${source.port}/api/state`)).mirrors.find((mirror) => mirror.name === "Paused Project").enabled, true);
    assert.equal(second.mirrors[1].name, "Live Project");
  } finally {
    await source.stop();
    await destination.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("syncs 1,000 small files and a 500 MB file through a folder mirror", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mybridge-mirror-volume-"));
  const sourceFolder = path.join(root, "source");
  const mirrorRoot = path.join(root, "MyBridge");
  const sourceData = path.join(root, "source-data");
  const destinationData = path.join(root, "destination-data");
  await fs.mkdir(path.join(sourceFolder, "batch"), { recursive: true });
  for (let index = 0; index < 1_000; index += 1) {
    await fs.writeFile(path.join(sourceFolder, "batch", `file-${String(index).padStart(4, "0")}.txt`), `file ${index}\n`);
  }
  const largePath = path.join(sourceFolder, "large.bin");
  const handle = await fs.open(largePath, "w");
  const chunk = Buffer.alloc(1024 * 1024, 0x5a);
  try {
    for (let index = 0; index < 500; index += 1) await handle.write(chunk);
  } finally {
    await handle.close();
  }

  const destination = new Agent({ dataDir: destinationData, mybridgeRoot: mirrorRoot, deviceName: "Mac volume", httpPort: 0, enableDiscovery: false });
  const source = new Agent({ dataDir: sourceData, deviceName: "Windows volume", httpPort: 0, enableDiscovery: false });
  await destination.start();
  await source.start();
  try {
    await source.pairWithRemote({ deviceId: destination.store.get().deviceId, deviceName: "Mac volume", baseUrl: `http://127.0.0.1:${destination.port}` });
    await source.addMirror({ sourcePath: sourceFolder, name: "Volume Project" });
    const targetFolder = path.join(mirrorRoot, "Volume Project");
    await eventually(async () => (await fs.stat(path.join(targetFolder, "large.bin")).catch(() => null))?.size === 500 * 1024 * 1024, 30_000);
    assert.equal((await listFiles(targetFolder)).length, 1_001);
    assert.equal(await fs.readFile(path.join(targetFolder, "batch", "file-0999.txt"), "utf8"), "file 999\n");
    const targetHandle = await fs.open(path.join(targetFolder, "large.bin"), "r");
    const sample = Buffer.alloc(1024);
    try {
      await targetHandle.read(sample, 0, sample.length, 123 * 1024 * 1024);
    } finally {
      await targetHandle.close();
    }
    assert.ok(sample.every((byte) => byte === 0x5a));
  } finally {
    await source.stop();
    await destination.stop();
    await fs.rm(root, { recursive: true, force: true });
  }
});
