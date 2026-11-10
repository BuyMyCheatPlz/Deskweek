"use strict";

// P2 正确性回归：操作日志、幂等、缺口、合并、墓碑。
// 与 Kotlin 侧共用 test/fixtures/merge-scenarios.json。

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { OpLog } = require("../src/main/sync/oplog.cjs");

const FIXTURE = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "merge-scenarios.json"), "utf8"));
const GROUP = "g-merge";

function log() {
  return new OpLog({ groupId: GROUP });
}

function op(actorId, seq, taskId, kind, changes, context = {}) {
  return {
    protocolVersion: 1, groupId: GROUP, opId: `${actorId}:${seq}`, actorId, seq,
    context, taskId, kind, changes, recordedAt: "2026-11-10T00:00:00Z",
  };
}

test("all scenarios reproduce the committed projection", () => {
  for (const scenario of FIXTURE.vectors) {
    const instance = log();
    instance.receive(scenario.ops);
    assert.equal(instance.projection.canonical(), scenario.expectedCanonical, "mismatch: " + scenario.name);
    assert.deepEqual(instance.vectors(), scenario.vectors, "vectors mismatch: " + scenario.name);
  }
});

test("duplicate operations are idempotent", () => {
  const instance = log();
  const create = op("A", 1, "t1", "create", { title: "x" });
  assert.equal(instance.receive([create]), 1);
  assert.equal(instance.receive([create]), 0);
  assert.equal(instance.projection.size, 1);
});

test("gap blocks later operations until the missing one arrives", () => {
  const instance = log();
  instance.receive([op("A", 1, "t1", "create", { title: "one" })]);
  instance.receive([op("A", 3, "t1", "patch", { title: "three" }, { A: 2 })]);

  assert.equal(instance.vectors().A, 1);
  assert.equal(instance.projection.snapshot().tasks[0].title, "one");
  assert.deepEqual(instance.gaps().A, { from: 2, to: 3 });

  instance.receive([op("A", 2, "t1", "patch", { title: "two" }, { A: 1 })]);
  assert.equal(instance.vectors().A, 3);
  assert.equal(instance.projection.snapshot().tasks[0].title, "three");
  assert.deepEqual(instance.gaps(), {});
});

test("trash wins over a concurrent restore", () => {
  const instance = log();
  instance.receive([
    op("A", 1, "t1", "create", { title: "x" }),
    op("A", 2, "t1", "trash", { deletedAt: "2026-11-10T01:00:00Z" }, { A: 1 }),
    op("B", 1, "t1", "restore", {}, { A: 1 }),
  ]);
  assert.equal(instance.projection.snapshot().tasks[0].deleted, true);
});

test("restore observed after trash takes effect", () => {
  const instance = log();
  instance.receive([
    op("A", 1, "t1", "create", { title: "x" }),
    op("A", 2, "t1", "trash", { deletedAt: "2026-11-10T01:00:00Z" }, { A: 1 }),
    op("A", 3, "t1", "restore", {}, { A: 2 }),
  ]);
  assert.equal(instance.projection.snapshot().tasks[0].deleted, false);
});

test("purge is terminal and blocks resurrection", () => {
  const instance = log();
  instance.receive([
    op("A", 1, "t1", "create", { title: "x" }),
    op("A", 2, "t1", "purge", {}, { A: 1 }),
    op("A", 3, "t1", "patch", { title: "复活" }, { A: 2 }),
    op("B", 1, "t1", "create", { title: "同 id 重建" }, {}),
  ]);
  assert.equal(instance.projection.size, 0);
});

test("concurrent same-group edit records a conflict and picks deterministically", () => {
  const instance = log();
  instance.receive([
    op("A", 1, "t1", "create", { title: "base" }),
    op("A", 2, "t1", "patch", { title: "from A" }, { A: 1 }),
    op("B", 1, "t1", "patch", { title: "from B" }, { A: 1 }),
  ]);
  const snapshot = instance.projection.snapshot();
  assert.equal(snapshot.tasks[0].title, "from A", "higher seq wins");
  assert.equal(snapshot.conflicts.length, 1);
  assert.equal(snapshot.conflicts[0].group, "title");
  assert.equal(snapshot.conflicts[0].winner, "A");
});

test("same-day colors are a deterministic projection by taskId", () => {
  const instance = log();
  instance.receive([
    op("A", 1, "t-b", "create", { title: "B", date: "2026-11-11" }),
    op("A", 2, "t-a", "create", { title: "A", date: "2026-11-11" }, { A: 1 }),
  ]);
  const [first, second] = instance.projection.snapshot().tasks;
  assert.equal(first.taskId, "t-a");
  assert.equal(first.color, "#9bd3c7");
  assert.equal(second.color, "#e7bd82");
});

test("nextOp assigns the next contiguous seq", () => {
  const instance = log();
  instance.receive([
    op("A", 1, "t1", "create", { title: "x" }),
    op("B", 1, "t2", "create", { title: "y" }),
  ]);
  const next = instance.nextOp({ actorId: "A", taskId: "t1", kind: "patch", changes: { done: true } });
  assert.equal(next.seq, 2);
  assert.equal(next.opId, "A:2");
});
