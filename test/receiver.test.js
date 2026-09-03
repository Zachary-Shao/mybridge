import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { FileReceiver } from "../src/receiver.js";

function fakeResponse() {
  return {
    statusCode: null,
    body: "",
    headersSent: false,
    writeHead(statusCode) {
      this.statusCode = statusCode;
      this.headersSent = true;
    },
    end(body = "") {
      this.body = body;
    }
  };
}

function fakeRequest(token, sourceId = "source") {
  const request = new PassThrough();
  request.headers = { "x-mybridge-token": token, "x-mybridge-source-id": sourceId };
  return request;
}

test("receiver writes nested files only with the paired token", async () => {
  const destination = await fs.mkdtemp(path.join(os.tmpdir(), "mybridge-destination-"));
  const activities = [];
  const receiver = new FileReceiver({
    getConfig: () => ({ destinationFolder: destination, pairedSource: { deviceId: "source", token: "secret" } }),
    onActivity: (event) => activities.push(event)
  });

  const request = fakeRequest("secret");
  const response = fakeResponse();
  const receiving = receiver.receive(request, response, "reports/today.csv");
  request.end("price,close\nA,10\n");
  await receiving;

  assert.equal(response.statusCode, 200);
  assert.equal(await fs.readFile(path.join(destination, "reports/today.csv"), "utf8"), "price,close\nA,10\n");
  assert.equal(activities[0].status, "success");

  const rejectedRequest = fakeRequest("wrong");
  const rejectedResponse = fakeResponse();
  const rejected = receiver.receive(rejectedRequest, rejectedResponse, "bad.txt");
  rejectedRequest.end("nope");
  await rejected;
  assert.equal(rejectedResponse.statusCode, 401);
  assert.equal(await fs.access(path.join(destination, "bad.txt")).then(() => true).catch(() => false), false);

  const traversalRequest = fakeRequest("secret");
  const traversalResponse = fakeResponse();
  const traversal = receiver.receive(traversalRequest, traversalResponse, "../outside.txt");
  traversalRequest.end("nope");
  await traversal;
  assert.equal(traversalResponse.statusCode, 400);

  await fs.rm(destination, { recursive: true, force: true });
});
