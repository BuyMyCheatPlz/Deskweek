"use strict";

// 桌面端同步服务：把协议模块接进 Electron 应用。
//
// 职责边界（对应 docs/lan-sync-protocol.md §6）：
// - 本机编辑先走 store 的合并校验，再由这里把真实差异转成带签名的操作
// - 收到远端操作先落 OpLog，再把投影交给调用方写回 data.json（网络不直接写文件）
// - 广播只发给已连接的会话，不重放自己的操作

const path = require("node:path");
const { createServer, listen } = require("./p0-server.cjs");
const { OpLog } = require("./oplog.cjs");
const { TrustStore } = require("./trust.cjs");
const { loadOrCreateIdentityFile, sign } = require("./identity.cjs");
const { decodeFrames, encodeFrame } = require("./frame.cjs");
const { validate } = require("./messages.cjs");

/** 字段组 → 字段名，与合并投影保持一致 */
const GROUPS = {
  title: ["title"],
  detail: ["detail"],
  schedule: ["date", "time", "defer"],
  done: ["done", "completedAt"],
  lifecycle: ["deleted", "deletedAt"],
};

function sameValue(a, b) {
  return a === b || (a === undefined && b === undefined);
}

/**
 * 比较前后两份任务列表，产出最小操作集。
 * 纯函数，便于单测；不涉及签名与网络。
 */
function diffTasks(prevItems, nextItems) {
  const before = new Map((prevItems || []).map((item) => [item.id, item]));
  const after = new Map((nextItems || []).map((item) => [item.id, item]));
  const ops = [];

  for (const [id, next] of after) {
    const prev = before.get(id);
    if (!prev) {
      ops.push({ taskId: id, kind: "create", changes: { ...next } });
      continue;
    }
    if (prev.deleted !== next.deleted) {
      if (next.deleted) ops.push({ taskId: id, kind: "trash", changes: { deletedAt: next.deletedAt || "" } });
      else ops.push({ taskId: id, kind: "restore", changes: {} });
      continue;
    }
    const patch = {};
    for (const fields of Object.values(GROUPS)) {
      for (const field of fields) {
        if (!sameValue(prev[field], next[field])) patch[field] = next[field];
      }
    }
    if (Object.keys(patch).length > 0) ops.push({ taskId: id, kind: "patch", changes: patch });
  }

  for (const id of before.keys()) {
    if (!after.has(id)) ops.push({ taskId: id, kind: "purge", changes: {} });
  }

  return ops;
}

function createSyncService({ dataDir, groupId = "default", log = () => {} }) {
  const identity = loadOrCreateIdentityFile(path.join(dataDir, "sync"));
  const trust = new TrustStore(path.join(dataDir, "sync"));
  const oplog = new OpLog({ groupId });

  let server = null;
  let port = 0;
  let bonjour = null;
  let startedAt = null;
  let lastError = null;
  let applyState = null;
  const sessions = new Set();

  function status() {
    return {
      running: Boolean(server),
      port,
      actorId: identity.actorId,
      groupId,
      startedAt,
      lastError,
      vectors: oplog.vectors(),
      operations: oplog.allOps().length,
      peers: trust.all().length,
      sessions: sessions.size,
    };
  }

  /** 把一条本机操作记入日志并广播给已连接会话 */
  function publish(op) {
    const signed = { ...op, signature: sign(op, identity.privateKey) };
    oplog.receive([signed]);
    const frame = encodeFrame({ type: "OPS", protocolVersion: 1, ops: [signed] });
    for (const socket of sessions) {
      try {
        socket.write(frame);
      } catch (error) {
        log("broadcast-error", error.message);
      }
    }
    return signed;
  }

  /** 应用 store 的真实差异；返回产生的操作数 */
  function recordLocalChange(prevItems, nextItems) {
    const ops = diffTasks(prevItems, nextItems);
    for (const draft of ops) {
      const op = oplog.nextOp({
        actorId: identity.actorId,
        taskId: draft.taskId,
        kind: draft.kind,
        changes: draft.changes,
        recordedAt: new Date().toISOString(),
      });
      publish(op);
    }
    return ops.length;
  }

  function applyRemote(ops) {
    if (typeof applyState !== "function") return 0;
    const applied = oplog.receive(ops);
    if (applied === 0) return 0;
    const snapshot = oplog.projection.snapshot();
    applyState(snapshot.tasks);
    return applied;
  }

  function attachStore(handler) {
    applyState = handler;
  }

  async function start({ listenPort = 0, advertise = true } = {}) {
    if (server) return status();
    try {
      server = createServer({
        groupId,
        identityDir: path.join(dataDir, "sync"),
        log,
      });
      // 接管会话广播：记录连接并在收到 OPS 时回写投影
      server.on("secureConnection", (socket) => {
        sessions.add(socket);
        socket.on("close", () => sessions.delete(socket));
        socket.on("data", (chunk) => {
          let decoded;
          try {
            decoded = decodeFrames(chunk);
          } catch {
            return;
          }
          for (const message of decoded.messages) {
            if (message.type !== "OPS") continue;
            try {
              validate(message);
            } catch {
              continue;
            }
            // 校验签名后再应用，避免把未验证的操作写进 data.json
            const verified = message.ops.filter((op) => server.registry.verifyOperation(op));
            if (verified.length !== message.ops.length) {
              log("reject-unsigned", String(message.ops.length - verified.length));
              continue;
            }
            applyRemote(verified);
          }
        });
      });
      port = await listen(server, { port: listenPort, host: "0.0.0.0" });
      startedAt = new Date().toISOString();

      if (advertise) {
        try {
          const { Bonjour } = require("bonjour-service");
          bonjour = new Bonjour();
          bonjour.publish({
            name: `DeskWeek-${identity.actorId.slice(0, 8)}`,
            type: "deskweek-sync",
            port,
            txt: { pv: "1", group: groupId },
          });
        } catch (error) {
          log("mdns-unavailable", error.message);
        }
      }
      log("started", String(port));
      return status();
    } catch (error) {
      lastError = error.message;
      server = null;
      log("start-failed", error.message);
      return status();
    }
  }

  function stop() {
    for (const socket of sessions) {
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
    }
    sessions.clear();
    if (bonjour) {
      try {
        bonjour.destroy();
      } catch {
        /* ignore */
      }
      bonjour = null;
    }
    if (server) {
      try {
        server.close();
      } catch {
        /* ignore */
      }
      server = null;
    }
    port = 0;
    startedAt = null;
  }

  return { status, start, stop, recordLocalChange, applyRemote, attachStore, identity, trust, oplog };
}

module.exports = { createSyncService, diffTasks };
