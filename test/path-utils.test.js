import test from "node:test";
import assert from "node:assert/strict";
import { normalizeRelativePath, resolveInside, toRelativePath } from "../src/path-utils.js";

test("normalizes nested paths into portable wire paths", () => {
  assert.equal(normalizeRelativePath("reports\\today\\prices.csv"), "reports/today/prices.csv");
  assert.equal(toRelativePath("/tmp/source", "/tmp/source/reports/today.csv"), "reports/today.csv");
});

test("rejects absolute and traversal paths", () => {
  assert.throws(() => normalizeRelativePath("../secret.txt"), /escapes/);
  assert.throws(() => normalizeRelativePath("/etc/passwd"), /Invalid/);
  assert.throws(() => normalizeRelativePath("C:/Windows/win.ini"), /Invalid/);
  assert.throws(() => resolveInside("/tmp/destination", "../../outside.txt"), /escapes/);
});

test("resolves safe paths below the configured root", () => {
  assert.equal(resolveInside("/tmp/destination", "nested/file.txt"), "/tmp/destination/nested/file.txt");
});
