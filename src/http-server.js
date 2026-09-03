import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const publicDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../public");

function sendJson(response, statusCode, payload) {
  if (response.headersSent) return;
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > 1_000_000) {
        request.destroy(new Error("Request body is too large"));
        reject(new Error("Request body is too large"));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"));
      } catch {
        reject(new Error("Request body must be valid JSON"));
      }
    });
    request.on("error", reject);
  });
}

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8"
};

export class MyBridgeHttpServer {
  constructor({ agent, receiver, publicDir = publicDirectory }) {
    this.agent = agent;
    this.receiver = receiver;
    this.publicDir = publicDir;
    this.server = null;
    this.port = null;
  }

  async start() {
    if (this.server) return this.port;
    this.server = http.createServer((request, response) => {
      void this.handle(request, response);
    });

    const preferredPort = this.agent.store.get().httpPort;
    const maxAttempts = preferredPort === 0 ? 1 : 10;
    let port = preferredPort;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        await this.listen(port);
        this.port = this.server.address().port;
        return this.port;
      } catch (error) {
        if (error.code !== "EADDRINUSE" || preferredPort === 0) throw error;
        port += 1;
      }
    }
    throw new Error(`Could not find an available HTTP port near ${preferredPort}`);
  }

  listen(port) {
    return new Promise((resolve, reject) => {
      const onError = (error) => {
        this.server?.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        this.server?.off("error", onError);
        resolve();
      };
      this.server.once("error", onError);
      this.server.once("listening", onListening);
      this.server.listen(port, "0.0.0.0");
    });
  }

  async stop() {
    if (!this.server) return;
    const server = this.server;
    this.server = null;
    await new Promise((resolve) => server.close(() => resolve()));
  }

  async handle(request, response) {
    try {
      const requestUrl = new URL(request.url, "http://127.0.0.1");
      if (request.method === "GET" && requestUrl.pathname === "/api/state") {
        sendJson(response, 200, this.agent.getPublicState());
        return;
      }
      if (request.method === "GET" && requestUrl.pathname === "/api/ping") {
        sendJson(response, 200, { ok: true, deviceId: this.agent.store.get().deviceId });
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/settings") {
        const body = await readJson(request);
        sendJson(response, 200, await this.agent.updateSettings(body));
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/mirrors") {
        const body = await readJson(request);
        sendJson(response, 200, await this.agent.addMirror(body));
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/mirrors/accept") {
        const body = await readJson(request);
        sendJson(response, 200, await this.agent.acceptMirror(body, {
          token: request.headers["x-mybridge-token"],
          sourceId: request.headers["x-mybridge-source-id"]
        }));
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/mirrors/remove") {
        const body = await readJson(request);
        sendJson(response, 200, await this.agent.removeMirror(body.mirrorId, { notifyRemote: false }));
        return;
      }
      const mirrorAction = request.method === "POST" && requestUrl.pathname.match(/^\/api\/mirrors\/([^/]+)\/(pause|resume|remove)$/);
      if (mirrorAction) {
        const mirrorId = decodeURIComponent(mirrorAction[1]);
        const action = mirrorAction[2];
        if (action === "remove") {
          sendJson(response, 200, await this.agent.removeMirror(mirrorId));
        } else {
          sendJson(response, 200, await this.agent.setMirrorPaused(mirrorId, action === "pause"));
        }
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/pair") {
        const body = await readJson(request);
        sendJson(response, 200, await this.agent.pairWithRemote(body));
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/pair/accept") {
        const body = await readJson(request);
        sendJson(response, 200, await this.agent.acceptPair(body));
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/resync") {
        sendJson(response, 200, await this.agent.resync());
        return;
      }
      if (request.method === "POST" && requestUrl.pathname === "/api/pause") {
        const body = await readJson(request);
        sendJson(response, 200, { ok: true, paused: await this.agent.setPaused(body.paused) });
        return;
      }
      if (request.method === "PUT" && requestUrl.pathname === "/api/files") {
        await this.receiver.receive(request, response, requestUrl.searchParams.get("path"), requestUrl.searchParams.get("mirrorId"));
        return;
      }
      if (request.method === "GET") {
        await this.serveStatic(requestUrl.pathname, response);
        return;
      }
      sendJson(response, 404, { ok: false, error: "Not found" });
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
  }

  async serveStatic(requestPath, response) {
    const fileName = requestPath === "/" ? "index.html" : requestPath.replace(/^\//, "");
    if (!/^(index\.html|app\.js|styles\.css)$/.test(fileName)) {
      sendJson(response, 404, { ok: false, error: "Not found" });
      return;
    }
    const filePath = path.join(this.publicDir, fileName);
    const content = await fs.readFile(filePath);
    response.writeHead(200, {
      "content-type": contentTypes[path.extname(filePath)] || "application/octet-stream",
      "cache-control": "no-cache"
    });
    response.end(content);
  }
}

export { readJson, sendJson };
