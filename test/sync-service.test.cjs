"use strict";

// 桌面端接入层：本机差异 → 操作、远端操作 → 投影写回、服务生命周期。
// 不启动 Electron，直接构造服务对象。

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createSyncService, diffTasks } = require("../src/main/sync/service.cjs");

function task(id, fields = {}) {
  return {
    id,
    title: "t-" + id,
    detail: "",
    date: "2026-11-10",
    time: "",
    defer: "none",
    done: false,
    completedAt: "",
    deleted: false,
    deletedAt: "",
    createdAt: "2026-11-01T00:00:00Z",
    ...fields,
  };
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "deskweek-sync-"));
}

test("new task produces a create operation", () => {
  const ops = diffTasks([], [task("a")]);
  assert.equal(ops.length, 1);
  assert.equal(ops[0].kind, "create");
  assert.equal(ops[0].taskId, "a");
});

test("field change produces a minimal patch", () => {
  const before = [task("a")];
  const after = [task("a", { title: "改过的标题" })];
  const ops = diffTasks(before, after);
  assert.equal(ops.length, 1);
  assert.equal(ops[0].kind, "patch");
  assert.deepEqual(ops[0].changes, { title: "改过的标题" });
});

test("soft delete and restore map to trash and restore", () => {
  const before = [task("a")];
  const trashed = [task("a", { deleted: true, deletedAt: "2026-11-10T01:00:00Z" })];
  assert.equal(diffTasks(before, trashed)[0].kind, "trash");
  assert.equal(diffTasks(trashed, before)[0].kind, "restore");
});

test("removing a task produces purge", () => {
  const ops = diffTasks([task("a")], []);
  assert.equal(ops.length, 1);
  assert.equal(ops[0].kind, "purge");
});

test("no change produces no operations", () => {
  assert.deepEqual(diffTasks([task("a")], [task("a")]), []);
});

test("multiple field groups merge into one patch", () => {
  const ops = diffTasks(
    [task("a")],
    [task("a", { title: "T", date: "2026-11-12", done: true, completedAt: "2026-11-10T02:00:00Z" })],
  );
  assert.equal(ops.length, 1);
  assert.deepEqual(ops[0].changes, {
    title: "T",
    date: "2026-11-12",
    done: true,
    completedAt: "2026-11-10T02:00:00Z",
  });
});

test("recordLocalChange signs and logs operations", () => {
  const dir = tempDir();
  const service = createSyncService({ dataDir: dir, groupId: "g-service" });

  const count = service.recordLocalChange([], [task("a")]);
  assert.equal(count, 1);

  const ops = service.oplog.allOps();
  assert.equal(ops.length, 1);
  assert.equal(ops[0].kind, "create");
  assert.equal(ops[0].actorId, service.identity.actorId);
  assert.ok(ops[0].signature, "operation must be signed");
  assert.equal(service.oplog.vectors()[service.identity.actorId], 1);
});

test("start and stop expose status without binding a fixed port", async () => {
  const dir = tempDir();
  const service = createSyncService({ dataDir: dir, groupId: "g-service" });

  assert.equal(service.status().running, false);
  const started = await service.start({ listenPort: 0, advertise: false });
  assert.equal(started.running, true);
  assert.ok(started.port > 0, "should bind an ephemeral port");
  assert.ok(started.actorId);

  service.stop();
  assert.equal(service.status().running, false);
  assert.equal(service.status().port, 0);
});

test("remote operations are applied through the projection callback", async () => {
  const dir = tempDir();
  const service = createSyncService({ dataDir: dir, groupId: "g-service" });
  const written = [];
  service.attachStore((tasks) => written.push(tasks));

  const op = {
    protocolVersion: 1,
    groupId: "g-service",
    opId: "peer:1",
    actorId: "peer",
    seq: 1,
    context: {},
    taskId: "t-remote",
    kind: "create",
    changes: { title: "远端任务", date: "2026-11-11", createdAt: "2026-11-10T00:00:00Z" },
    recordedAt: "2026-11-10T00:00:00Z",
  };
  const applied = service.applyRemote([op]);
  assert.equal(applied, 1);
  assert.equal(written.length, 1);
  assert.equal(written[0][0].title, "远端任务");
});
