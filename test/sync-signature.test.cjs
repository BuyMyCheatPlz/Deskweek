"use strict";

// P2 签名回归：ECDSA P-256 + SHA-256 + DER + 规范化 JSON。
// 与 Kotlin 侧共用 test/fixtures/signed-op.json。

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const tls = require("node:tls");

const { generateIdentity, sign, verify, loadIdentity } = require("../src/main/sync/identity.cjs");
const { createServer, listen } = require("../src/main/sync/p0-server.cjs");
const { encodeFrame, decodeFrames } = require("../src/main/sync/frame.cjs");

const FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "signed-op.json"), "utf8"));

test("sign and verify round trip", () => {
  const identity = generateIdentity();
  const op = { ...FIXTURE.op, actorId: "a", opId: "a:1" };
  const signature = sign(op, identity.privateKey);
  assert.equal(verify(op, identity.publicKeyB64, signature), true);
});

test("tampered operation fails verification", () => {
  const identity = generateIdentity();
  const op = { ...FIXTURE.op };
  const signature = sign(op, identity.privateKey);
  assert.equal(verify({ ...op, changes: { ...op.changes, title: "被篡改" } }, identity.publicKeyB64, signature), false);
  assert.equal(verify({ ...op, seq: op.seq + 1, opId: "vector-actor:2" }, identity.publicKeyB64, signature), false);
});

test("signature from another key fails verification", () => {
  const a = generateIdentity();
  const b = generateIdentity();
  const signature = sign(FIXTURE.op, a.privateKey);
  assert.equal(verify(FIXTURE.op, b.publicKeyB64, signature), false);
  assert.equal(verify(FIXTURE.op, "not-base64!!", signature), false);
});

test("shared vector verifies with the committed public key", () => {
  assert.equal(verify(FIXTURE.op, FIXTURE.publicKeyB64, FIXTURE.signature), true);
  const identity = loadIdentity(FIXTURE.privateKeyB64);
  assert.equal(identity.publicKeyB64, FIXTURE.publicKeyB64);
});

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

async function openSignedSession(socket) {
  const identity = loadIdentity(FIXTURE.privateKeyB64);
  const base = hello(identity);
  const message = { ...base, signature: sign(base, identity.privateKey) };
  socket.write(encodeFrame(message));
  return identity;
}

function hello(identity) {
  return {
    type: "HELLO",
    protocolVersion: 1,
    groupId: "p0-group",
    actorId: "vector-actor",
    nonce: "signed",
    capabilities: ["ops"],
    publicKey: identity.publicKeyB64,
  };
}

test("signed hello and signed ops are accepted", async () => {
  const server = createServer();
  const port = await listen(server, { port: 0 });
  try {
    const socket = connect(port);
    await new Promise((resolve, reject) => {
      socket.once("secureConnect", resolve);
      socket.once("error", reject);
    });
    const next = reader(socket);
    const identity = await openSignedSession(socket);

    assert.equal((await next()).type, "HELLO");
    assert.equal((await next()).type, "SUMMARY");
    assert.equal(server.registry.get("vector-actor"), identity.publicKeyB64);

    const op = { ...FIXTURE.op };
    op.signature = sign(op, identity.privateKey);
    socket.write(encodeFrame({ type: "OPS", protocolVersion: 1, ops: [op] }));

    const ack = await next();
    assert.equal(ack.type, "ACK");
    assert.equal(ack.vectors["vector-actor"], 1);
    socket.destroy();
  } finally {
    if (typeof server.closeAllConnections === "function") server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("unsigned operation from registered actor is rejected", async () => {
  const server = createServer();
  const port = await listen(server, { port: 0 });
  try {
    const socket = connect(port);
    await new Promise((resolve, reject) => {
      socket.once("secureConnect", resolve);
      socket.once("error", reject);
    });
    const next = reader(socket);
    const identity = await openSignedSession(socket);
    await next();
    await next();

    const op = { ...FIXTURE.op, signature: sign(FIXTURE.op, generateIdentity().privateKey) };
    socket.write(encodeFrame({ type: "OPS", protocolVersion: 1, ops: [op] }));

    const error = await next();
    assert.equal(error.type, "ERROR");
    assert.equal(error.code, "EBADSIG");
    socket.destroy();
  } finally {
    if (typeof server.closeAllConnections === "function") server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("hello with broken signature is rejected and connection closed", async () => {
  const server = createServer();
  const port = await listen(server, { port: 0 });
  try {
    const socket = connect(port);
    await new Promise((resolve, reject) => {
      socket.once("secureConnect", resolve);
      socket.once("error", reject);
    });
    const next = reader(socket);
    const identity = generateIdentity();
    socket.write(encodeFrame({ ...hello(identity), signature: "AAAA" }));

    const error = await next();
    assert.equal(error.type, "ERROR");
    assert.equal(error.code, "EBADSIG");
    socket.destroy();
  } finally {
    if (typeof server.closeAllConnections === "function") server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
