"use strict";

// P0/P2 互通原型服务端：TLS + 帧协议 + 签名校验 + 操作日志补齐。
// 不含 mDNS 发现、配对向导与业务 UI；用于验证两端协议实现一致。

const tls = require("node:tls");
const fs = require("node:fs");
const path = require("node:path");

const { encodeFrame, decodeFrames } = require("./frame.cjs");
const { validate, ProtocolError } = require("./messages.cjs");
const { KeyRegistry, verify, sign, loadOrCreateIdentityFile } = require("./identity.cjs");
const { OpLog } = require("./oplog.cjs");

const DEFAULT_PORT = 47821;
const DEFAULT_GROUP = "p0-group";
const CERT_DIR = path.join(__dirname, "..", "..", "..", "test", "fixtures", "certs");

function defaultCredentials() {
  return {
    pfx: fs.readFileSync(path.join(CERT_DIR, "p0.p12")),
    passphrase: "changeit",
  };
}

function createSession(socket, {
  actorId = "host-actor",
  groupId = DEFAULT_GROUP,
  log = () => {},
  registry = new KeyRegistry(),
  oplog = new OpLog({ groupId }),
  identity = null,
} = {}) {
  let buffer = Buffer.alloc(0);
  const state = { peer: null };

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
        case "HELLO": {
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
          const self = identity || { actorId, publicKeyB64: null, privateKey: null };
          const helloReply = {
            type: "HELLO", protocolVersion: 1, groupId, actorId: self.actorId,
            nonce: "reply-" + message.nonce, capabilities: ["ops", "tls"],
            publicKey: self.publicKeyB64,
          };
          send(self.privateKey ? { ...helloReply, signature: sign(helloReply, self.privateKey) } : helloReply);
          send({ type: "SUMMARY", protocolVersion: 1, vectors: oplog.vectors() });
          break;
        }
        case "PING":
          send({ type: "PONG", protocolVersion: 1, nonce: message.nonce });
          break;
        case "WANT": {
          const ops = oplog.opsInRange(message.actorId, message.from, message.to);
          log("want", `${message.actorId} ${message.from}..${message.to} -> ${ops.length}`);
          if (ops.length > 0) send({ type: "OPS", protocolVersion: 1, ops });
          break;
        }
        case "OPS": {
          const rejected = message.ops.filter((op) => !registry.verifyOperation(op));
          if (rejected.length > 0) {
            log("bad-signature", "OPS " + rejected.map((op) => op.opId).join(","));
            send({
              type: "ERROR", protocolVersion: 1, code: "EBADSIG",
              message: "operation signature rejected: " + rejected.map((op) => op.opId).join(","),
            });
            break;
          }
          const applied = oplog.receive(message.ops);
          log("applied", String(applied));
          send({ type: "ACK", protocolVersion: 1, vectors: oplog.vectors() });
          break;
        }
        default:
          break;
      }
    }
  });

  socket.on("error", (error) => log("socket-error", error.message));
  return state;
}

function createServer({ pfx, passphrase, log = () => {}, groupId = DEFAULT_GROUP, identityDir } = {}) {
  const credentials = pfx ? { pfx, passphrase } : defaultCredentials();
  const registry = new KeyRegistry();
  const oplog = new OpLog({ groupId });
  // 服务端也有身份：配对时把自己的公钥发给对端，双方核对同一串短码
  const identity = loadOrCreateIdentityFile(
    identityDir || path.join(__dirname, "..", "..", "..", ".server-identity"),
  );
  const server = tls.createServer(
    { ...credentials, minVersion: "TLSv1.2" },
    (socket) => {
      log("connection", socket.remoteAddress);
      createSession(socket, { log, registry, oplog, groupId, identity });
    },
  );
  server.registry = registry;
  server.oplog = oplog;
  return server;
}

function listen(server, { port = DEFAULT_PORT, host = "127.0.0.1" } = {}) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve(server.address().port));
  });
}

module.exports = { createServer, listen, createSession, DEFAULT_PORT, DEFAULT_GROUP };
