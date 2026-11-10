"use strict";

// P0 互通回归：真实 TLS 连接 + 帧协议 + 签名 HELLO / 签名 OPS。
// 证书是 test-only 的自签证书，固定指纹见 test/fixtures/certs/pin.txt。

const test = require("node:test");
const assert = require("node:assert/strict");
const tls = require("node:tls");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const { createServer, listen } = require("../src/main/sync/p0-server.cjs");
const { encodeFrame, decodeFrames } = require("../src/main/sync/frame.cjs");
const { generateIdentity, sign } = require("../src/main/sync/identity.cjs");

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

async function stopServer(server) {
  if (typeof server.closeAllConnections === "function") server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}

async function open(port) {
  const socket = connect(port);
  await new Promise((resolve, reject) => {
    socket.once("secureConnect", resolve);
    socket.once("error", reject);
  });
  return socket;
}

function signedHello(identity) {
  const base = {
    type: "HELLO", protocolVersion: 1, groupId: "p0-group",
    actorId: identity.actorId, nonce: "abc", capabilities: ["ops"],
    publicKey: identity.publicKeyB64,
  };
  return { ...base, signature: sign(base, identity.privateKey) };
}

test("tls handshake presents the pinned certificate", async () => {
  const server = createServer();
  const port = await listen(server, { port: 0 });
  try {
    const socket = await open(port);
    const cert = socket.getPeerCertificate();
    assert.ok(cert && cert.raw, "peer certificate missing");
    const fingerprint = crypto.createHash("sha256").update(cert.raw).digest("hex");
    assert.equal(fingerprint, PIN, "certificate fingerprint must match the pin");
    assert.ok(["TLSv1.2", "TLSv1.3"].includes(socket.getProtocol()), "unexpected tls version " + socket.getProtocol());
    socket.destroy();
  } finally {
    await stopServer(server);
  }
});

test("signed hello, summary, ping and signed ops complete over one connection", async () => {
  const server = createServer();
  const port = await listen(server, { port: 0 });
  const identity = generateIdentity();
  try {
    const socket = await open(port);
    const next = reader(socket);

    socket.write(encodeFrame(signedHello(identity)));

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

    const op = {
      protocolVersion: 1, groupId: "p0-group", opId: identity.actorId + ":1", actorId: identity.actorId,
      seq: 1, context: {}, taskId: "t1", kind: "create",
      changes: { title: "P0 互通任务", done: false },
      recordedAt: "2026-11-10T02:00:00Z",
    };
    socket.write(encodeFrame({
      type: "OPS", protocolVersion: 1, ops: [{ ...op, signature: sign(op, identity.privateKey) }],
    }));

    const ack = await next();
    assert.equal(ack.type, "ACK");
    assert.equal(ack.vectors[identity.actorId], 1);

    socket.destroy();
  } finally {
    await stopServer(server);
  }
});

test("server rejects a message with a bad contract and closes", async () => {
  const server = createServer();
  const port = await listen(server, { port: 0 });
  try {
    const socket = await open(port);
    const next = reader(socket);
    socket.write(encodeFrame({ type: "OPS", protocolVersion: 1, ops: [] }));

    const error = await next();
    assert.equal(error.type, "ERROR");
    assert.equal(error.code, "ECONTRACT");
    socket.destroy();
  } finally {
    await stopServer(server);
  }
});
