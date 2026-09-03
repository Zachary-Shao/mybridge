import { readdir } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testDirectory = path.join(projectRoot, "test");
const testFiles = (await readdir(testDirectory))
  .filter((fileName) => fileName.endsWith(".test.js"))
  .sort()
  .map((fileName) => path.join(testDirectory, fileName));

for (const testFile of testFiles) {
  const result = spawnSync(process.execPath, ["--test", "--test-concurrency=1", testFile], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
