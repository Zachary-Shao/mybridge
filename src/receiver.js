import fs from "node:fs";
import fsp from "node:fs/promises";
import { randomUUID, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { resolveInside } from "./path-utils.js";

function sameSecret(actual, expected) {
  if (typeof actual !== "string" || typeof expected !== "string" || !actual || !expected) {
    return false;
  }
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  response.end(`${JSON.stringify(payload)}\n`);
}

async function replaceFile(temporaryPath, targetPath) {
  try {
    await fsp.rename(temporaryPath, targetPath);
  } catch (error) {
    if (error.code !== "EEXIST" && error.code !== "EPERM") {
      throw error;
    }
    await fsp.rm(targetPath, { force: true });
    await fsp.rename(temporaryPath, targetPath);
  }
}

export class FileReceiver {
  constructor({ getConfig, onActivity, onStatus }) {
    this.getConfig = getConfig;
    this.onActivity = onActivity;
    this.onStatus = onStatus;
  }

  async receive(request, response, relativePath, mirrorId = null) {
    const config = this.getConfig();
    const token = request.headers["x-mybridge-token"];
    const pairedSource = config.pairedSource;

    if (!sameSecret(token, pairedSource?.token)) {
      sendJson(response, 401, { ok: false, error: "Pairing token rejected" });
      request.resume();
      return;
    }

    const sourceId = request.headers["x-mybridge-source-id"];
    if (pairedSource.deviceId && sourceId && sourceId !== pairedSource.deviceId) {
      sendJson(response, 403, { ok: false, error: "Unknown source device" });
      request.resume();
      return;
    }

    let destinationRoot = config.destinationFolder;
    let mirror = null;
    if (mirrorId) {
      mirror = config.mirrors?.find((item) => item.id === mirrorId && item.sourceDeviceId === pairedSource?.deviceId);
      if (!mirror) {
        sendJson(response, 404, { ok: false, error: "Mirror is not registered" });
        request.resume();
        return;
      }
      if (mirror.enabled === false) {
        sendJson(response, 409, { ok: false, error: "Mirror is paused" });
        request.resume();
        return;
      }
      if (!config.mybridgeRoot) {
        sendJson(response, 409, { ok: false, error: "MyBridge root is not configured" });
        request.resume();
        return;
      }
      destinationRoot = path.join(config.mybridgeRoot, mirror.targetFolderName);
    }
    if (!destinationRoot) {
      sendJson(response, 409, { ok: false, error: "Destination Folder is not configured" });
      request.resume();
      return;
    }

    let targetPath;
    try {
      targetPath = resolveInside(destinationRoot, relativePath);
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
      request.resume();
      return;
    }

    const temporaryPath = `${targetPath}.mybridge-part-${randomUUID()}`;
    try {
      this.onStatus?.({ mirrorId: mirror?.id, status: "syncing", currentFile: relativePath });
      await fsp.mkdir(path.dirname(targetPath), { recursive: true });
      await pipeline(request, fs.createWriteStream(temporaryPath, { flags: "wx" }));
      await replaceFile(temporaryPath, targetPath);
      this.onStatus?.({ mirrorId: mirror?.id, status: "success", currentFile: relativePath, fileCount: 1, pendingCount: 0 });
      this.onActivity?.({ type: "receive", status: "success", path: relativePath, mirrorId: mirror?.id, mirrorName: mirror?.name, direction: "in" });
      sendJson(response, 200, { ok: true, path: relativePath });
    } catch (error) {
      await fsp.rm(temporaryPath, { force: true }).catch(() => {});
      this.onStatus?.({ mirrorId: mirror?.id, status: "error", currentFile: relativePath, error: error.message });
      this.onActivity?.({ type: "receive", status: "failed", path: relativePath, mirrorId: mirror?.id, mirrorName: mirror?.name, direction: "in", error: error.message });
      if (!response.headersSent) {
        sendJson(response, 500, { ok: false, error: error.message });
      } else {
        response.destroy(error);
      }
    }
  }
}

export { sameSecret };
