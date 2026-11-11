"use strict";

// 桌面端配对流程：未配对设备被拒绝并进入待确认列表，确认后可正常握手。

const test = require("node:test");
const assert = require("node:assert/strict");
const tls = require("node:tls");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createSyncService } = require("../src/main/sync/service.cjs");
const { encodeFrame, decodeFrames } = require("../src/main/sync/frame.cjs");
const { generateIdentity, sign } = require("../src/main/sync/identity.cjs");

function connect(port) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false });
    socket.once("secureConnect", () => resolve(socket));
    socket.once("error", reject);
  });
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

function signedHello(identity) {
  const base = {
    type: "HELLO",
    protocolVersion: 1,
    groupId: "g-pair",
    actorId: identity.actorId,
    nonce: "n",
    capabilities: ["ops"],
    publicKey: identity.publicKeyB64,
  };
  return { ...base, signature: sign(base, identity.privateKey) };
}

test("untrusted peer is rejected, then accepted after approval", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "deskweek-pair-"));
  const service = createSyncService({ dataDir, groupId: "g-pair" });
  const started = await service.start({ listenPort: 0, advertise: false });
  assert.equal(started.running, true);

  const peer = generateIdentity();

  try {
    // 第一次：未配对 → EPAIRING
    const first = await connect(started.port);
    const next1 = reader(first);
    first.write(encodeFrame(signedHello(peer)));
    const rejection = await next1();
    assert.equal(rejection.type, "ERROR");
    assert.equal(rejection.code, "EPAIRING");
    assert.match(rejection.message, /\d{6}/, "错误信息要带上验证码");
    first.destroy();

    const pending = service.status().pending;
    assert.equal(pending.length, 1);
    assert.equal(pending[0].actorId, peer.actorId);
    assert.equal(pending[0].publicKeyB64, peer.publicKeyB64);
    assert.match(pending[0].sas, /^\d{6}$/);

    // 确认配对
    assert.equal(service.approvePairing(peer.actorId), true);
    assert.equal(service.status().pending.length, 0);
    assert.equal(service.status().peers, 1);

    // 第二次：已配对 → 正常握手
    const second = await connect(started.port);
    const next2 = reader(second);
    second.write(encodeFrame(signedHello(peer)));
    const hello = await next2();
    assert.equal(hello.type, "HELLO");
    second.destroy();
  } finally {
    service.stop();
  }
});

test("rejected pairing leaves the peer untrusted", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "deskweek-pair2-"));
  const service = createSyncService({ dataDir, groupId: "g-pair" });
  const started = await service.start({ listenPort: 0, advertise: false });
  const peer = generateIdentity();

  try {
    const socket = await connect(started.port);
    const next = reader(socket);
    socket.write(encodeFrame(signedHello(peer)));
    await next();
    socket.destroy();

    assert.equal(service.rejectPairing(peer.actorId), true);
    assert.equal(service.status().pending.length, 0);
    assert.equal(service.status().peers, 0);
    assert.equal(service.trust.isTrusted(peer.actorId, peer.publicKeyB64), false);
  } finally {
    service.stop();
  }
});
