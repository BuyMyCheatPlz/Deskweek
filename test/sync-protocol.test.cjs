"use strict";

// 协议 P0：规范化 JSON、帧编解码、消息校验。
// 与 Kotlin 侧共用 test/fixtures/sync-vectors.json，任何一端改动都会让另一端失败。

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const { canonicalize } = require("../src/main/sync/canonical.cjs");
const { encodeFrame, decodeFrames, MAX_FRAME } = require("../src/main/sync/frame.cjs");
const { validate, ProtocolError } = require("../src/main/sync/messages.cjs");

const FIXTURE = path.join(__dirname, "fixtures", "sync-vectors.json");
const vectors = JSON.parse(fs.readFileSync(FIXTURE, "utf8")).vectors;

test("canonical json matches cross-language vectors", () => {
  for (const vector of vectors) {
    const canonical = canonicalize(vector.input);
    assert.equal(canonical, vector.canonical, "canonical mismatch: " + vector.name);
    const digest = crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
    assert.equal(digest, vector.sha256, "sha256 mismatch: " + vector.name);
  }
});

test("canonical json rejects values that cannot be byte-stable", () => {
  assert.throws(() => canonicalize({ n: 1.5 }), /safe integers/);
  assert.throws(() => canonicalize({ n: NaN }), /safe integers/);
  assert.throws(() => canonicalize({ n: -0 }), /negative zero/);
  assert.throws(() => canonicalize({ u: undefined }), /undefined/);
  assert.throws(() => canonicalize({ d: new Date() }), /unsupported object/);
  assert.throws(() => canonicalize({ s: "\ud800" }), /unpaired/);
});

test("canonical key order is utf-16 code unit order", () => {
  // 大写字母码元小于小写，因此 Z 在 a 前
  assert.equal(canonicalize({ a: 1, Z: 2, "0": 3 }), '{"0":3,"Z":2,"a":1}');
});

test("frame round trips multiple messages with partial tail", () => {
  const a = encodeFrame({ type: "PING", protocolVersion: 1, nonce: "1" });
  const b = encodeFrame({ type: "PONG", protocolVersion: 1, nonce: "2" });
  const all = Buffer.concat([a, b, Buffer.from([0, 0])]);

  const first = decodeFrames(all);
  assert.equal(first.messages.length, 2);
  assert.deepEqual(first.messages[0].type, "PING");
  assert.equal(first.rest.length, 2);

  const second = decodeFrames(Buffer.concat([Buffer.from([0, 0, 0, 20])]));
  assert.equal(second.messages.length, 0, "header-only buffer must wait for body");
});

test("frame rejects empty, oversized and malformed payloads", () => {
  const zeroLength = Buffer.alloc(4);
  assert.throws(() => decodeFrames(zeroLength), /empty frame/);

  const huge = { type: "ERROR", protocolVersion: 1, code: "E", message: "x".repeat(MAX_FRAME) };
  assert.throws(() => encodeFrame(huge), /too large/);

  const badHeader = Buffer.alloc(6);
  badHeader.writeUInt32BE(2, 0);
  badHeader.write("{", 4, "utf8");
  assert.throws(() => decodeFrames(badHeader), /invalid json|must be a json object/);
});

test("valid messages pass and keep shape", () => {
  const hello = validate({ type: "HELLO", protocolVersion: 1, groupId: "g", actorId: "a", nonce: "n", capabilities: [] });
  assert.equal(hello.type, "HELLO");

  const op = {
    protocolVersion: 1, groupId: "g", opId: "a:1", actorId: "a", seq: 1,
    context: {}, taskId: "t", kind: "create", changes: { title: "x", done: false },
    recordedAt: "2026-11-10T02:00:00Z", signature: "sig",
  };
  assert.equal(validate({ type: "OPS", protocolVersion: 1, ops: [op] }).ops.length, 1);
  assert.equal(validate({ type: "ACK", protocolVersion: 1, vectors: { a: 1 } }).type, "ACK");
});

test("invalid messages are rejected with protocol codes", () => {
  const cases = [
    [{ type: "NOPE", protocolVersion: 1 }, "ECONTRACT"],
    [{ type: "HELLO", protocolVersion: 2, groupId: "g", actorId: "a", nonce: "n", capabilities: [] }, "EPROTO"],
    [{ type: "HELLO", protocolVersion: 1, groupId: "", actorId: "a", nonce: "n", capabilities: [] }, "ECONTRACT"],
    [{ type: "OPS", protocolVersion: 1, ops: [] }, "ECONTRACT"],
    [{ type: "WANT", protocolVersion: 1, actorId: "a", from: 5, to: 4 }, "ECONTRACT"],
    [{ type: "ACK", protocolVersion: 1, vectors: { a: -1 } }, "ECONTRACT"],
  ];
  for (const [message, code] of cases) {
    assert.throws(() => validate(message), (error) => error instanceof ProtocolError && error.code === code);
  }
});

test("ops enforce opId equals actorId:seq", () => {
  const op = {
    protocolVersion: 1, groupId: "g", opId: "a:9", actorId: "a", seq: 1,
    context: {}, taskId: "t", kind: "patch", changes: { title: "x" },
    recordedAt: "2026-11-10T02:00:00Z", signature: "sig",
  };
  assert.throws(
    () => validate({ type: "OPS", protocolVersion: 1, ops: [op] }),
    (error) => error.code === "ECONTRACT" && /opId/.test(error.message),
  );
});
