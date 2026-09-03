import path from "node:path";

/**
 * Converts a user/file-system relative path to a portable, safe path.
 * The wire format always uses forward slashes.
 */
export function normalizeRelativePath(value) {
  if (typeof value !== "string") {
    throw new Error("Relative path must be a string");
  }

  const input = value.replaceAll("\\", "/").trim();
  if (!input || input.includes("\0") || path.posix.isAbsolute(input) || /^[a-zA-Z]:\//.test(input)) {
    throw new Error("Invalid relative path");
  }

  const normalized = path.posix.normalize(input);
  if (normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw new Error("Path escapes the folder root");
  }

  return normalized;
}

export function resolveInside(rootFolder, relativePath) {
  const root = path.resolve(rootFolder);
  const relative = normalizeRelativePath(relativePath);
  const target = path.resolve(root, relative);
  const prefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;

  if (target !== root && !target.startsWith(prefix)) {
    throw new Error("Path escapes the folder root");
  }

  return target;
}

export function toRelativePath(rootFolder, filePath) {
  return normalizeRelativePath(path.relative(path.resolve(rootFolder), path.resolve(filePath)));
}
