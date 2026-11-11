"use strict";

// 生成跨语言合并场景向量。
// 每个场景给出「按某种顺序投递的操作序列」和「期望的规范化投影」，
// JS 与 Kotlin 必须产出逐字节相同的结果。
//
// 用法：node scripts/gen-merge-scenarios.cjs > test/fixtures/merge-scenarios.json

const { OpLog } = require("../src/main/sync/oplog.cjs");

const GROUP = "g-merge";
const BASE = "2026-11-10T00:00:00Z";

function op(actorId, seq, taskId, kind, changes, context = {}) {
  return {
    protocolVersion: 1,
    groupId: GROUP,
    opId: `${actorId}:${seq}`,
    actorId,
    seq,
    context,
    taskId,
    kind,
    changes,
    recordedAt: BASE,
  };
}

const create = op("A", 1, "t1", "create", {
  title: "周计划", date: "2026-11-10", done: false, createdAt: BASE,
}, {});

const scenarios = [
  {
    name: "single-create",
    ops: [create],
  },
  {
    name: "concurrent-different-groups-merge",
    ops: [
      create,
      op("A", 2, "t1", "patch", { title: "周计划（改标题）" }, { A: 1 }),
      op("B", 1, "t1", "patch", { date: "2026-11-12", defer: "3d" }, { A: 1 }),
    ],
  },
  {
    name: "concurrent-same-field-conflict",
    ops: [
      create,
      op("A", 2, "t1", "patch", { title: "A 的标题" }, { A: 1 }),
      op("B", 1, "t1", "patch", { title: "B 的标题" }, { A: 1 }),
    ],
  },
  {
    name: "trash-versus-patch",
    ops: [
      create,
      op("A", 2, "t1", "trash", { deletedAt: BASE }, { A: 1 }),
      op("B", 1, "t1", "patch", { title: "删除后编辑" }, { A: 1 }),
    ],
  },
  {
    name: "trash-then-restore",
    ops: [
      create,
      op("A", 2, "t1", "trash", { deletedAt: BASE }, { A: 1 }),
      op("A", 3, "t1", "restore", {}, { A: 2 }),
    ],
  },
  {
    name: "concurrent-trash-and-restore",
    ops: [
      create,
      op("A", 2, "t1", "trash", { deletedAt: BASE }, { A: 1 }),
      op("B", 1, "t1", "restore", {}, { A: 1 }),
    ],
  },
  {
    name: "purge-is-terminal",
    ops: [
      create,
      op("A", 2, "t1", "purge", {}, { A: 1 }),
      op("A", 3, "t1", "patch", { title: "复活尝试" }, { A: 2 }),
      op("B", 1, "t1", "patch", { title: "旧设备编辑" }, { A: 1 }),
    ],
  },
  {
    name: "out-of-order-delivery",
    ops: [
      op("A", 3, "t1", "patch", { title: "第三次" }, { A: 2 }),
      op("A", 1, "t1", "create", { title: "初始", date: "2026-11-10", createdAt: BASE }, {}),
      op("A", 2, "t1", "patch", { title: "第二次" }, { A: 1 }),
    ],
  },
  {
    name: "duplicate-delivery",
    ops: [create, create, op("A", 2, "t1", "patch", { title: "只应生效一次" }, { A: 1 })],
  },
  {
    name: "gap-blocks-until-filled",
    ops: [
      create,
      op("A", 3, "t1", "patch", { title: "第三条" }, { A: 2 }),
      op("A", 2, "t1", "patch", { title: "第二条" }, { A: 1 }),
    ],
  },
  {
    name: "two-tasks-same-day-color-order",
    ops: [
      op("A", 1, "t-b", "create", { title: "B 任务", date: "2026-11-11", createdAt: BASE }, {}),
      op("A", 2, "t-a", "create", { title: "A 任务", date: "2026-11-11", createdAt: BASE }, { A: 1 }),
    ],
  },
];

const vectors = scenarios.map(({ name, ops }) => {
  const log = new OpLog({ groupId: GROUP });
  log.receive(ops);
  return {
    name,
    groupId: GROUP,
    ops,
    expected: log.projection.snapshot(),
    expectedCanonical: log.projection.canonical(),
    vectors: log.vectors(),
    gaps: log.gaps(),
  };
});

process.stdout.write(JSON.stringify({ version: 1, vectors }, null, 2) + "\n");
