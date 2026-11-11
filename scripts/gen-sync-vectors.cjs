"use strict";

// 生成跨语言测试向量：同一批输入必须在 JS 与 Kotlin 产出逐字节相同的规范化 JSON。
// 用法：node scripts/gen-sync-vectors.cjs > test/fixtures/sync-vectors.json

const crypto = require("node:crypto");
const { canonicalize } = require("../src/main/sync/canonical.cjs");

const inputs = [
  { name: "empty-object", input: {} },
  { name: "key-order", input: { b: 1, a: 2, c: 3 } },
  { name: "nested", input: { z: [1, 2, { y: true, x: null }], a: "hello" } },
  { name: "chinese", input: { title: "评审 Android 方案" } },
  { name: "escapes", input: { text: "line1\nline2\t\"quoted\"\\back" } },
  { name: "control-chars", input: { text: "\u0000\u001f" } },
  { name: "emoji", input: { text: "😀周历" } },
  { name: "negative", input: { n: -42, z: 0, big: 9007199254740991 } },
  { name: "bool-array", input: { flags: [true, false, true] } },
  { name: "sync-hello", input: {
      type: "HELLO",
      protocolVersion: 1,
      groupId: "11111111-2222-3333-4444-555555555555",
      actorId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      nonce: "n-001",
      capabilities: ["ops", "tls13"],
    } },
  { name: "sync-op", input: {
      protocolVersion: 1,
      groupId: "g-1",
      opId: "actor-1:42",
      actorId: "actor-1",
      seq: 42,
      context: { "actor-1": 41, "actor-2": 8 },
      taskId: "task-1",
      kind: "patch",
      changes: { title: "完成周计划", done: true },
      recordedAt: "2026-11-10T02:00:00Z",
      signature: "c2ln",
    } },
];

const vectors = inputs.map(({ name, input }) => {
  const canonical = canonicalize(input);
  return {
    name,
    input,
    canonical,
    sha256: crypto.createHash("sha256").update(canonical, "utf8").digest("hex"),
  };
});

process.stdout.write(JSON.stringify({ version: 1, vectors }, null, 2) + "\n");
