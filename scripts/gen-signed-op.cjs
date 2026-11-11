"use strict";

// 生成跨语言签名向量：固定密钥 + 一条 op + 签名。
// JS 与 Kotlin 都必须能验证通过，且篡改任意字段后验证失败。
// 用法：node scripts/gen-signed-op.cjs > test/fixtures/signed-op.json

const { generateIdentity, sign } = require("../src/main/sync/identity.cjs");

const identity = generateIdentity();
const op = {
  protocolVersion: 1,
  groupId: "p0-group",
  opId: "vector-actor:1",
  actorId: "vector-actor",
  seq: 1,
  context: {},
  taskId: "task-vector",
  kind: "create",
  changes: { title: "签名向量：评审 Android 方案", done: false, defer: "3d" },
  recordedAt: "2026-11-10T02:00:00Z",
};

const signature = sign(op, identity.privateKey);
process.stdout.write(
  JSON.stringify({ version: 1, publicKeyB64: identity.publicKeyB64, privateKeyB64: identity.privateKeyB64, op, signature }, null, 2) + "\n",
);
