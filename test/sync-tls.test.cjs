"use strict";

// P0 互通回归：真实 TLS 连接 + 帧协议 + HELLO/PING/OPS。
// 证书是 test-only 的自签证书，固定指纹见 test/fixtures/certs/pin.txt。

const test = require("node:test");
const assert = require("node:assert/strict");
const tls = require("node:tls");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const { createServer, listen } = require("../src/main/sync/p0-server.cjs");
const { encodeFrame, decodeFrames } = require("../src/main/sync/frame.cjs");

const CERT_DIR = path.join(__dirname, "fixtures", "certs");
const PIN = fs.readFileSync(path.join(CERT_DIR, "pin.txt"), "utf8").trim();

function connect(port) {
  return tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false, minVersion: "TLSv1.2" });
}

function reader(socket) {
  let buffer = Buffer.alloc(0);
  const queue = [];
  const waiters = [];
  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    const decoded = decodeFrames(buffer);
    buffer = Buffer.from(decoded.rest);
    queue.push(...decoded.messages);
    while (waiters.length && queue.length) waiters.shift()(queue.shift());
  });
  return () => new Promise((resolve) => (queue.length ? resolve(queue.shift()) : waiters.push(resolve)));
}

test("tls handshake presents the pinned certificate", async () => {
  const server = createServer();
  const port = await listen(server, { port: 0 });
  try {
    const socket = connect(port);
    await new Promise((resolve, reject) => {
      socket.once("secureConnect", resolve);
      socket.once("error", reject);
    });
    const cert = socket.getPeerCertificate();
    assert.ok(cert && cert.raw, "peer certificate missing");
    const fingerprint = crypto.createHash("sha256").update(cert.raw).digest("hex");
    assert.equal(fingerprint, PIN, "certificate fingerprint must match the pin");
    assert.ok(["TLSv1.2", "TLSv1.3"].includes(socket.getProtocol()), "unexpected tls version " + socket.getProtocol());
    socket.destroy();
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("hello, summary, ping and ops complete over one connection", async () => {
  const server = createServer();
  const port = await listen(server, { port: 0 });
  try {
    const socket = connect(port);
    await new Promise((resolve, reject) => {
      socket.once("secureConnect", resolve);
      socket.once("error", reject);
    });
    const next = reader(socket);

    socket.write(encodeFrame({
      type: "HELLO", protocolVersion: 1, groupId: "p0-group",
      actorId: "node-client", nonce: "abc", capabilities: ["ops"],
    }));

    const hello = await next();
    assert.equal(hello.type, "HELLO");
    assert.equal(hello.nonce, "reply-abc");

    const summary = await next();
    assert.equal(summary.type, "SUMMARY");
    assert.deepEqual(summary.vectors, {});

    socket.write(encodeFrame({ type: "PING", protocolVersion: 1, nonce: "p1" }));
    const pong = await next();
    assert.equal(pong.type, "PONG");
    assert.equal(pong.nonce, "p1");

    socket.write(encodeFrame({
      type: "OPS", protocolVersion: 1, ops: [{
        protocolVersion: 1, groupId: "p0-group", opId: "node-client:1", actorId: "node-client",
        seq: 1, context: {}, taskId: "t1", kind: "create",
        changes: { title: "P0 互通任务", done: false },
        recordedAt: "2026-11-10T02:00:00Z", signature: "sig",
      }],
    }));
    const ack = await next();
    assert.equal(ack.type, "ACK");
    assert.equal(ack.vectors["node-client"], 1);

    socket.destroy();
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("server rejects a message with a bad contract and closes", async () => {
  const server = createServer();
  const port = await listen(server, { port: 0 });
  try {
    const socket = connect(port);
    await new Promise((resolve, reject) => {
      socket.once("secureConnect", resolve);
      socket.once("error", reject);
    });
    const next = reader(socket);
    socket.write(encodeFrame({ type: "OPS", protocolVersion: 1, ops: [] }));

    const error = await next();
    assert.equal(error.type, "ERROR");
    assert.equal(error.code, "ECONTRACT");
    socket.destroy();
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
