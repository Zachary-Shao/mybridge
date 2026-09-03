import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ConfigStore } from "../src/config.js";

test("creates and reloads a local JSON config", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mybridge-config-"));
  const first = new ConfigStore({ dataDir, deviceName: "Test Mac", httpPort: 40001 });
  const config = first.load();

  assert.equal(config.deviceName, "Test Mac");
  assert.equal(config.httpPort, 40001);
  assert.ok(config.deviceId);
  assert.ok(Array.isArray(config.mirrors));
  assert.ok(config.ignoreRules.includes("node_modules"));
  assert.ok(config.mybridgeRoot);
  assert.ok(fs.existsSync(path.join(dataDir, "config.json")));

  first.update({ sourceFolder: "/tmp/source" });
  const second = new ConfigStore({ dataDir, deviceName: "Different Name" });
  const reloaded = second.load();
  assert.equal(reloaded.deviceId, config.deviceId);
  assert.equal(reloaded.sourceFolder, "/tmp/source");
  assert.equal(reloaded.deviceName, "Test Mac");
});

test("keeps only the newest 50 activity entries", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mybridge-activity-"));
  const store = new ConfigStore({ dataDir });
  store.load();
  for (let index = 0; index < 55; index += 1) {
    store.addActivity({ type: "test", path: `${index}.txt` });
  }
  assert.equal(store.get().activity.length, 50);
  assert.equal(store.get().activity[0].path, "54.txt");
});
