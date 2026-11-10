"use strict";

// P2 正确性核心：操作日志 + 合并投影。
//
// 语义来自 docs/lan-sync-protocol.md §4/§5：
// - 唯一键 (groupId, actorId, seq)，重复接收幂等
// - seq 必须连续；缺前序则暂存，补齐后按序推进，不能越过缺口
// - 字段组按业务原子合并；并发冲突记录候选，用 (seq, actorId) 确定性选出临时值
// - trash 优先于并发 restore；purge 终结 taskId，之后任何操作都不复活
// - 同日分色是确定性投影：按 taskId 升序取色板，不生成额外操作

const { canonicalize } = require("./canonical.cjs");

const PALETTE = ["#9bd3c7", "#e7bd82", "#f39aa4", "#90b8ee", "#c8a6ef", "#a7d48d"];

const GROUPS = {
  title: ["title"],
  detail: ["detail"],
  schedule: ["date", "time", "defer"],
  done: ["done", "completedAt"],
  lifecycle: ["deleted", "deletedAt"],
};

const DEFAULTS = {
  title: "",
  detail: "",
  date: "",
  time: "",
  defer: "none",
  done: false,
  completedAt: "",
  deleted: false,
  deletedAt: "",
  createdAt: "",
};

function groupsOf(changes) {
  const found = [];
  for (const [group, fields] of Object.entries(GROUPS)) {
    if (fields.some((field) => Object.prototype.hasOwnProperty.call(changes, field))) found.push(group);
  }
  return found;
}

function observed(context, actorId, seq) {
  if (!context || typeof context !== "object") return false;
  const value = context[actorId];
  return Number.isSafeInteger(value) && value >= seq;
}

class Projection {
  constructor() {
    this.tasks = new Map();
    this.conflicts = [];
    this.tombstones = new Set();
  }

  get size() {
    return this.tasks.size;
  }

  apply(op) {
    const { taskId, kind, changes = {}, context = {} } = op;
    if (this.tombstones.has(taskId)) return;

    if (kind === "purge") {
      this.tasks.delete(taskId);
      this.tombstones.add(taskId);
      return;
    }

    let task = this.tasks.get(taskId);
    if (!task) {
      if (kind !== "create") {
        // 未见过 create 的 patch 不能凭空建任务；留待 create 补齐后重放
        return;
      }
      task = { taskId, meta: {}, ...DEFAULTS };
      this.tasks.set(taskId, task);
    }

    if (kind === "create") {
      Object.assign(task, DEFAULTS, changes, { taskId });
      task.createdAt = changes.createdAt || op.recordedAt || "";
      for (const group of Object.keys(GROUPS)) {
        task.meta[group] = { actorId: op.actorId, seq: op.seq };
      }
      return;
    }

    if (kind === "patch") {
      for (const group of groupsOf(changes)) {
        this.writeGroup(task, group, changes, op, context);
      }
      return;
    }

    if (kind === "trash") {
      const last = task.meta.lifecycle;
      const concurrent = last && !observed(context, last.actorId, last.seq);
      if (concurrent) {
        this.conflicts.push({
          taskId,
          group: "lifecycle",
          winner: "trash",
          candidates: [
            { actorId: last.actorId, seq: last.seq },
            { actorId: op.actorId, seq: op.seq },
          ],
        });
      }
      task.deleted = true;
      task.deletedAt = changes.deletedAt || op.recordedAt || "";
      task.meta.lifecycle = { actorId: op.actorId, seq: op.seq };
      return;
    }

    if (kind === "restore") {
      const last = task.meta.lifecycle;
      // 只有观察到 trash 之后的 restore 才有效；并发 restore 让位给 trash
      if (last && !observed(context, last.actorId, last.seq)) return;
      task.deleted = false;
      task.deletedAt = "";
      task.meta.lifecycle = { actorId: op.actorId, seq: op.seq };
      return;
    }
  }

  writeGroup(task, group, changes, op, context) {
    const last = task.meta[group];
    const concurrent = last && !observed(context, last.actorId, last.seq);
    if (concurrent) {
      const incomingWins =
        op.seq > last.seq || (op.seq === last.seq && op.actorId > last.actorId);
      this.conflicts.push({
        taskId: task.taskId,
        group,
        winner: incomingWins ? op.actorId : last.actorId,
        candidates: [
          { actorId: last.actorId, seq: last.seq },
          { actorId: op.actorId, seq: op.seq },
        ],
      });
      if (!incomingWins) return;
    }
    for (const field of GROUPS[group]) {
      if (Object.prototype.hasOwnProperty.call(changes, field)) task[field] = changes[field];
    }
    task.meta[group] = { actorId: op.actorId, seq: op.seq };
  }

  /** 稳定序列化：任务按 taskId 升序，冲突按 (taskId, group) 排序 */
  snapshot() {
    const tasks = [...this.tasks.values()]
      .sort((a, b) => (a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0))
      .map((task) => {
        const { meta, ...fields } = task;
        return fields;
      });

    const byDate = new Map();
    for (const task of tasks) {
      if (!task.date) continue;
      const list = byDate.get(task.date) || [];
      list.push(task);
      byDate.set(task.date, list);
    }
    for (const list of byDate.values()) {
      list.sort((a, b) => (a.taskId < b.taskId ? -1 : 1));
      list.forEach((task, index) => {
        task.color = PALETTE[index % PALETTE.length];
      });
    }
    for (const task of tasks) {
      if (!task.color) task.color = PALETTE[0];
    }

    const conflicts = [...this.conflicts].sort((a, b) =>
      a.taskId === b.taskId ? a.group.localeCompare(b.group) : a.taskId < b.taskId ? -1 : 1,
    );

    return { tasks, conflicts };
  }

  canonical() {
    return canonicalize(this.snapshot());
  }
}

class OpLog {
  constructor({ groupId }) {
    this.groupId = groupId;
    this.projection = new Projection();
    this.seen = new Set();
    this.contiguous = new Map();
    this.buffer = new Map();
    this.history = new Map();
  }

  vectors() {
    return Object.fromEntries([...this.contiguous.entries()].sort(([a], [b]) => (a < b ? -1 : 1)));
  }

  /** 每个作者还缺哪些 seq（从 next 开始到已知最大） */
  gaps() {
    const out = {};
    for (const [actorId, pending] of this.buffer) {
      const next = (this.contiguous.get(actorId) || 0) + 1;
      const seqs = [...pending.keys()].sort((a, b) => a - b);
      out[actorId] = { from: next, to: Math.max(...seqs) };
    }
    return out;
  }

  /** 接收一批操作，返回本次真正应用的条数 */
  receive(ops) {
    let applied = 0;
    for (const op of ops) {
      if (op.groupId !== this.groupId) continue;
      const key = `${op.actorId}:${op.seq}`;
      if (this.seen.has(key)) continue;
      const expected = (this.contiguous.get(op.actorId) || 0) + 1;
      if (op.seq === expected) {
        this.applyOne(op);
        applied++;
        this.drain(op.actorId);
      } else if (op.seq > expected) {
        const pending = this.buffer.get(op.actorId) || new Map();
        pending.set(op.seq, op);
        this.buffer.set(op.actorId, pending);
      }
    }
    return applied;
  }

  drain(actorId) {
    const pending = this.buffer.get(actorId);
    if (!pending) return;
    let next = (this.contiguous.get(actorId) || 0) + 1;
    while (pending.has(next)) {
      this.applyOne(pending.get(next));
      pending.delete(next);
      next++;
    }
    if (pending.size === 0) this.buffer.delete(actorId);
  }

  /** 取某作者 [from, to] 区间的原始操作，供 WANT 补齐 */
  opsInRange(actorId, from, to) {
    const out = [];
    for (let seq = from; seq <= to; seq++) {
      const op = this.history.get(`${actorId}:${seq}`);
      if (op) out.push(op);
    }
    return out;
  }

  allOps() {
    return [...this.history.values()];
  }

  applyOne(op) {
    this.projection.apply(op);
    this.seen.add(`${op.actorId}:${op.seq}`);
    this.history.set(`${op.actorId}:${op.seq}`, op);
    this.contiguous.set(op.actorId, op.seq);
  }

  /** 本机新建操作：自动补 seq / opId，调用方负责签名 */
  nextOp({ actorId, taskId, kind, changes, context = {}, recordedAt }) {
    const seq = (this.contiguous.get(actorId) || 0) + 1;
    return {
      protocolVersion: 1,
      groupId: this.groupId,
      opId: `${actorId}:${seq}`,
      actorId,
      seq,
      context,
      taskId,
      kind,
      changes,
      recordedAt: recordedAt || new Date().toISOString(),
    };
  }
}

module.exports = { OpLog, Projection, PALETTE, GROUPS, groupsOf, observed };
