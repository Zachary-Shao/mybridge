import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_IGNORE_RULES,
  createMirror,
  isIgnoredPath,
  normalizeIgnoreRules,
  sanitizeFolderName,
  sourceFolderName,
  uniqueFolderName
} from "../src/mirror-utils.js";

test("creates a portable mirror name from a source folder", () => {
  assert.equal(sourceFolderName("D:\\TDX\\data"), "data");
  assert.equal(sourceFolderName("/Users/test/量价研究"), "量价研究");
  assert.equal(sanitizeFolderName("TDX Data"), "TDX Data");
  assert.equal(sanitizeFolderName("report:latest?.csv"), "report-latest-.csv");
  assert.equal(sanitizeFolderName("../../"), "mirror");
});

test("allocates a safe unique target folder name", () => {
  assert.equal(uniqueFolderName("TDX Data", []), "TDX Data");
  assert.equal(uniqueFolderName("TDX Data", ["TDX Data"]), "TDX Data (2)");
  assert.equal(uniqueFolderName("TDX Data", ["TDX Data", "TDX Data (2)"]), "TDX Data (3)");
});

test("matches default and custom ignore rules without ignoring sibling names", () => {
  const rules = normalizeIgnoreRules(["*.bak", "private/**"]);
  assert.ok(DEFAULT_IGNORE_RULES.every((rule) => rules.includes(rule)));
  assert.equal(isIgnoredPath(".git/config", rules), true);
  assert.equal(isIgnoredPath("src/node_modules/pkg/index.js", rules), true);
  assert.equal(isIgnoredPath("output/cache/data.json", rules), true);
  assert.equal(isIgnoredPath("reports/result.log", rules), true);
  assert.equal(isIgnoredPath("reports/draft.bak", rules), true);
  assert.equal(isIgnoredPath("private/notes.txt", rules), true);
  assert.equal(isIgnoredPath("reports/latest.csv", rules), false);
  assert.equal(isIgnoredPath("cacheable/latest.csv", rules), false);
});

test("creates a mirror record with stable identity and safe folder name", () => {
  const mirror = createMirror({
    id: "mirror-1",
    sourceDeviceId: "windows-1",
    sourcePath: "/work/project",
    targetDeviceId: "mac-1",
    targetDeviceName: "MacBook",
    name: "Project A"
  });
  assert.deepEqual(mirror, {
    id: "mirror-1",
    name: "Project A",
    sourceDeviceId: "windows-1",
    sourcePath: "/work/project",
    targetDeviceId: "mac-1",
    targetDeviceName: "MacBook",
    targetFolderName: "Project A",
    enabled: true
  });
});
