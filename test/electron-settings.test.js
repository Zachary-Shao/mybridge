import test from "node:test";
import assert from "node:assert/strict";
import { readAutoLaunch, setAutoLaunch } from "../src/electron-settings.js";

test("auto-launch settings stay behind a small platform adapter", () => {
  const calls = [];
  const fakeApp = {
    getLoginItemSettings: () => ({ openAtLogin: true }),
    setLoginItemSettings: (settings) => calls.push(settings)
  };

  assert.equal(readAutoLaunch(fakeApp), true);
  assert.equal(setAutoLaunch(fakeApp, false), false);
  assert.deepEqual(calls, [{ openAtLogin: false }]);
});
