import path from "node:path";
import { randomUUID } from "node:crypto";

export const DEFAULT_IGNORE_RULES = Object.freeze([
  ".git",
  "node_modules",
  ".DS_Store",
  "cache",
  ".cache",
  "log",
  "logs",
  "*.log",
  "*.tmp",
  "*.temp",
  "*.part",
  "*.swp",
  "~$*",
  ".mybridge-part-*"
]);

function normalizeRule(value) {
  const rule = String(value ?? "").replaceAll("\\", "/").trim().replace(/^\.\//, "");
  return rule.replace(/^\/+|\/+$/g, "");
}

export function normalizeIgnoreRules(value) {
  const customRules = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[\n,]/)
      : [];
  return [...new Set([...DEFAULT_IGNORE_RULES, ...customRules].map(normalizeRule).filter(Boolean))];
}

function globRegExp(pattern) {
  let expression = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "*" && pattern[index + 1] === "*") {
      expression += ".*";
      index += 1;
    } else if (character === "*") {
      expression += "[^/]*";
    } else if (character === "?") {
      expression += "[^/]";
    } else {
      expression += character.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${expression}$`, "i");
}

export function isIgnoredPath(relativePath, rules = DEFAULT_IGNORE_RULES) {
  const normalizedPath = String(relativePath ?? "").replaceAll("\\", "/").replace(/^\.\//, "").replace(/^\/+|\/+$/g, "");
  if (!normalizedPath) return false;
  const segments = normalizedPath.split("/");
  return normalizeIgnoreRules(rules).some((rule) => {
    if (rule.includes("/")) {
      if (rule.endsWith("/**") && normalizedPath === rule.slice(0, -3)) return true;
      return globRegExp(rule).test(normalizedPath);
    }
    const matcher = globRegExp(rule);
    return segments.some((segment) => matcher.test(segment));
  });
}

export function sourceFolderName(sourcePath) {
  const normalized = String(sourcePath ?? "").replaceAll("\\", "/").replace(/\/+$/, "");
  const basename = normalized.split("/").filter(Boolean).at(-1) || "mirror";
  return sanitizeFolderName(basename);
}

export function sanitizeFolderName(value, fallback = "mirror") {
  const raw = String(value ?? "").trim();
  if (!raw || raw.split(/[\\/]/).some((part) => part === "." || part === "..")) return fallback;

  const cleaned = raw
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/^\.+|\.+$/g, "")
    .trim()
    .slice(0, 120)
    .trim();
  if (!cleaned || cleaned === "." || cleaned === "..") return fallback;
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(cleaned)) return `${cleaned}-folder`;
  return cleaned;
}

export function uniqueFolderName(value, existingNames = []) {
  const base = sanitizeFolderName(value);
  const taken = new Set(existingNames.map((name) => String(name).toLocaleLowerCase()));
  if (!taken.has(base.toLocaleLowerCase())) return base;
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = `${base} (${index})`;
    if (!taken.has(candidate.toLocaleLowerCase())) return candidate;
  }
  return `${base}-${randomUUID().slice(0, 8)}`;
}

export function createMirror({ id = randomUUID(), name, sourceDeviceId, sourcePath, targetDeviceId = "", targetDeviceName = "", targetFolderName } = {}) {
  const mirrorName = String(name || sourceFolderName(sourcePath)).trim() || sourceFolderName(sourcePath);
  return {
    id: String(id),
    name: mirrorName,
    sourceDeviceId: String(sourceDeviceId || ""),
    sourcePath: path.resolve(String(sourcePath || ".")),
    targetDeviceId: String(targetDeviceId || ""),
    targetDeviceName: String(targetDeviceName || ""),
    targetFolderName: sanitizeFolderName(targetFolderName || mirrorName),
    enabled: true
  };
}
