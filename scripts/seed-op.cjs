"use strict";

// 向 P0 服务端写入一条「他人」操作，用于验证 Android 的 WANT/补齐路径。
// 用法：node scripts/seed-op.cjs [port] [actorId]

const tls = require("node:tls");
const { encodeFrame, decodeFrames } = require("../src/main/sync/frame.cjs");
const { generateIdentity, sign } = require("../src/main/sync/identity.cjs");

const port = Number(process.argv[2] || 47821);
const actorId = process.argv[3] || "seed-actor";

const identity = generateIdentity();
identity.actorId = actorId;

function send(socket, message) {
  socket.write(encodeFrame(message));
}

const socket = tls.connect({ port, host: "127.0.0.1", rejectUnauthorized: false });

let buffer = Buffer.alloc(0);
let stage = 0;

socket.on("secureConnect", () => {
  const base = {
    type: "HELLO", protocolVersion: 1, groupId: "p0-group", actorId,
    nonce: "seed", capabilities: ["ops"], publicKey: identity.publicKeyB64,
  };
  send(socket, { ...base, signature: sign(base, identity.privateKey) });
});

socket.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  const decoded = decodeFrames(buffer);
  buffer = Buffer.from(decoded.rest);

  for (const message of decoded.messages) {
    if (message.type === "HELLO" && stage === 0) {
      stage = 1;
      const op = {
        protocolVersion: 1,
        groupId: "p0-group",
        opId: `${actorId}:1`,
        actorId,
        seq: 1,
        context: {},
        taskId: "seed-task",
        kind: "create",
        changes: { title: "来自另一台设备的操作", date: "2026-11-12", createdAt: new Date().toISOString() },
        recordedAt: new Date().toISOString(),
      };
      send(socket, {
        type: "OPS", protocolVersion: 1,
        ops: [{ ...op, signature: sign(op, identity.privateKey) }],
      });
    } else if (message.type === "ACK") {
      console.log("SEED_OK", JSON.stringify(message.vectors));
      socket.destroy();
      process.exit(0);
    } else if (message.type === "ERROR") {
      console.log("SEED_FAIL", message.code, message.message);
      process.exit(1);
    }
  }
});

socket.on("error", (error) => {
  console.log("SEED_ERROR", error.message);
  process.exit(1);
});

setTimeout(() => {
  console.log("SEED_TIMEOUT");
  process.exit(2);
}, 8000);
