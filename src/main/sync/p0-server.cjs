"use strict";

// P0 互通原型：TLS 服务端 + 帧协议 + HELLO/PING/OPS 最小处理。
// 不含业务合并、签名验证、发现（mDNS）与配对向导，仅用于验证
// 「两端能用同一套帧与消息跑通一条 TLS 连接」。

const tls = require("node:tls");
const fs = require("node:fs");
const path = require("node:path");

const { encodeFrame, decodeFrames } = require("./frame.cjs");
const { validate, ProtocolError } = require("./messages.cjs");
const { KeyRegistry, verify } = require("./identity.cjs");

const DEFAULT_PORT = 47821;
const CERT_DIR = path.join(__dirname, "..", "..", "..", "test", "fixtures", "certs");

function defaultCredentials() {
  return {
    pfx: fs.readFileSync(path.join(CERT_DIR, "p0.p12")),
    passphrase: "changeit",
  };
}

/** 每个连接一个协议状态机，P0 只保留最小字段 */
function createSession(socket, { actorId = "host-actor", groupId = "p0-group", log = () => {}, registry = new KeyRegistry() } = {}) {
  let buffer = Buffer.alloc(0);
  const state = { peer: null, opsApplied: 0, vectors: {} };

  function send(message) {
    validate(message);
    socket.write(encodeFrame(message));
    log("send", message.type);
  }

  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    let decoded;
    try {
      decoded = decodeFrames(buffer);
    } catch (error) {
      log("frame-error", error.message);
      send({ type: "ERROR", protocolVersion: 1, code: "EFRAME", message: error.message.slice(0, 200) });
      socket.destroy();
      return;
    }
    buffer = Buffer.from(decoded.rest);

    for (const message of decoded.messages) {
      try {
        validate(message);
      } catch (error) {
        if (error instanceof ProtocolError) {
          log("reject", error.code + " " + error.message);
          send({ type: "ERROR", protocolVersion: 1, code: error.code, message: error.message.slice(0, 200) });
          socket.destroy();
          return;
        }
        throw error;
      }

      log("recv", message.type);
      switch (message.type) {
        case "HELLO":
          state.peer = message.actorId;
          if (message.publicKey && message.signature) {
            if (verify(message, message.publicKey, message.signature)) {
              registry.put(message.actorId, message.publicKey);
              log("verified", message.actorId);
            } else {
              log("bad-signature", "HELLO " + message.actorId);
              send({ type: "ERROR", protocolVersion: 1, code: "EBADSIG", message: "HELLO signature rejected" });
              socket.destroy();
              return;
            }
          } else {
            log("unverified", message.actorId);
          }
          send({
            type: "HELLO",
            protocolVersion: 1,
            groupId,
            actorId,
            nonce: "reply-" + message.nonce,
            capabilities: ["ops", "tls"],
          });
          send({ type: "SUMMARY", protocolVersion: 1, vectors: state.vectors });
          break;
        case "PING":
          send({ type: "PONG", protocolVersion: 1, nonce: message.nonce });
          break;
        case "OPS": {
          const rejected = message.ops.filter((op) => !registry.verifyOperation(op));
          if (rejected.length > 0) {
            log("bad-signature", "OPS " + rejected.map((op) => op.opId).join(","));
            send({
              type: "ERROR",
              protocolVersion: 1,
              code: "EBADSIG",
              message: "operation signature rejected: " + rejected.map((op) => op.opId).join(","),
            });
            break;
          }
          for (const op of message.ops) state.vectors[op.actorId] = op.seq;
          send({ type: "ACK", protocolVersion: 1, vectors: state.vectors });
          break;
        }
        case "PONG":
        case "ACK":
          break;
        default:
          break;
      }
    }
  });

  socket.on("error", (error) => log("socket-error", error.message));
  return state;
}

function createServer({ pfx, passphrase, log = () => {} } = {}) {
  const credentials = pfx ? { pfx, passphrase } : defaultCredentials();
  const registry = new KeyRegistry();
  const server = tls.createServer(
    { ...credentials, minVersion: "TLSv1.2" },
    (socket) => {
      log("connection", socket.remoteAddress);
      createSession(socket, { log, registry });
    },
  );
  server.registry = registry;
  return server;
}

/** 启动监听并返回实际端口（支持 0 由系统分配） */
function listen(server, { port = DEFAULT_PORT, host = "127.0.0.1" } = {}) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve(server.address().port));
  });
}

module.exports = { createServer, listen, createSession, DEFAULT_PORT };
