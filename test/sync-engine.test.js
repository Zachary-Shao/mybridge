import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SyncEngine, listFiles } from "../src/sync-engine.js";

async function eventually(check, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for condition");
}

test("sync engine sends new and changed files", async () => {
  const source = await fs.mkdtemp(path.join(os.tmpdir(), "mybridge-source-"));
  const sent = [];
  const engine = new SyncEngine({
    getSourceFolder: () => source,
    getPairedDevice: () => ({ baseUrl: "http://127.0.0.1:1", token: "test", sourceDeviceId: "source" }),
    debounceMs: 15,
    stabilityMs: 10,
    transport: async (_device, filePath, relativePath) => {
      sent.push({ relativePath, contents: await fs.readFile(filePath, "utf8") });
    }
  });

  await engine.start();
  try {
    await fs.mkdir(path.join(source, "reports"));
    await fs.writeFile(path.join(source, "reports", "today.txt"), "first");
    await eventually(() => sent.some((item) => item.relativePath === "reports/today.txt"));
    assert.equal(sent.at(-1).contents, "first");

    await fs.writeFile(path.join(source, "reports", "today.txt"), "updated");
    await eventually(() => sent.filter((item) => item.relativePath === "reports/today.txt").length >= 2);
    assert.equal(sent.at(-1).contents, "updated");
  } finally {
    await engine.stop();
    await fs.rm(source, { recursive: true, force: true });
  }
});

test("pause holds file changes and resume resyncs them", async () => {
  const source = await fs.mkdtemp(path.join(os.tmpdir(), "mybridge-paused-"));
  const sent = [];
  const engine = new SyncEngine({
    getSourceFolder: () => source,
    getPairedDevice: () => ({ baseUrl: "http://127.0.0.1:1", token: "test", sourceDeviceId: "source" }),
    debounceMs: 15,
    stabilityMs: 10,
    transport: async (_device, filePath, relativePath) => sent.push({ relativePath, contents: await fs.readFile(filePath, "utf8") })
  });

  await engine.start();
  try {
    await engine.setPaused(true);
    await fs.writeFile(path.join(source, "paused.txt"), "held");
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(sent.length, 0);

    await engine.setPaused(false);
    await eventually(() => sent.some((item) => item.relativePath === "paused.txt"));
    assert.equal(sent[0].contents, "held");
  } finally {
    await engine.stop();
    await fs.rm(source, { recursive: true, force: true });
  }
});

test("full scans and watcher events skip default and custom ignored paths", async () => {
  const source = await fs.mkdtemp(path.join(os.tmpdir(), "mybridge-ignore-"));
  await fs.mkdir(path.join(source, ".git"));
  await fs.mkdir(path.join(source, "node_modules", "pkg"), { recursive: true });
  await fs.mkdir(path.join(source, "cache"));
  await fs.mkdir(path.join(source, "reports"));
  await fs.writeFile(path.join(source, ".git", "config"), "ignore");
  await fs.writeFile(path.join(source, "node_modules", "pkg", "index.js"), "ignore");
  await fs.writeFile(path.join(source, "cache", "state.json"), "ignore");
  await fs.writeFile(path.join(source, "reports", "draft.bak"), "ignore");
  await fs.writeFile(path.join(source, "reports", "latest.csv"), "keep");
  try {
    assert.deepEqual(await listFiles(source, { ignoreRules: ["*.bak"] }), ["reports/latest.csv"]);
  } finally {
    await fs.rm(source, { recursive: true, force: true });
  }
});

test("waits for a changing file to settle before uploading", async () => {
  const source = await fs.mkdtemp(path.join(os.tmpdir(), "mybridge-stable-"));
  const sent = [];
  const engine = new SyncEngine({
    getSourceFolder: () => source,
    getPairedDevice: () => ({ baseUrl: "http://127.0.0.1:1", token: "test", sourceDeviceId: "source" }),
    debounceMs: 10,
    stabilityMs: 30,
    transport: async (_device, filePath, relativePath) => sent.push({ relativePath, contents: await fs.readFile(filePath, "utf8") })
  });

  await engine.start();
  try {
    const filePath = path.join(source, "report.md");
    await fs.writeFile(filePath, "partial");
    setTimeout(() => { void fs.writeFile(filePath, "complete"); }, 20);
    await eventually(() => sent.some((item) => item.relativePath === "report.md"));
    assert.equal(sent[0].contents, "complete");
  } finally {
    await engine.stop();
    await fs.rm(source, { recursive: true, force: true });
  }
});
