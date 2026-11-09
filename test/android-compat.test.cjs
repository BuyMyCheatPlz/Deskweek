"use strict";

// 跨端兼容回归：DeskWeek-Android 导出的 data.json 必须能被桌面版原样吃下，
// 并且再存一次之后结构不丢字段（Android 端反向导入才不会瞎）。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createStore, normalizeStore } = require("../src/main/storage/store.cjs");

const FIXTURE = path.join(__dirname, "fixtures", "android-export.json");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "deskweek-android-"));
}

test("accepts a data.json exported by DeskWeek-Android", () => {
  const raw = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
  const normalized = normalizeStore(raw);

  assert.equal(normalized.items.length, 3);
  const [active, done, deleted] = normalized.items;
  assert.equal(active.title, "Android 端写入的任务");
  assert.equal(active.defer, "3d");
  assert.equal(active.date, "2026-11-10");
  assert.equal(done.done, true);
  assert.ok(done.completedAt);
  assert.equal(deleted.deleted, true);
  assert.ok(deleted.deletedAt);
});

test("preserves Android-only prefs keys instead of dropping them", () => {
  const dir = tempDir();
  const file = path.join(dir, "data.json");
  fs.copyFileSync(FIXTURE, file);

  const store = createStore({ file });
  const loaded = store.load();
  assert.equal(loaded.prefs.androidOnlyKey, "should-be-preserved");
  assert.equal(loaded.prefs.widgetBackground, "transparent");

  const saved = store.save({ base: { items: [], prefs: {} }, next: { items: loaded.items, prefs: loaded.prefs } });
  const onDisk = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(onDisk.prefs.androidOnlyKey, "should-be-preserved");
  assert.equal(saved.revision, loaded.revision + 1);
});

test("round trips through desktop save and stays Android-readable", () => {
  const dir = tempDir();
  const file = path.join(dir, "data.json");
  fs.copyFileSync(FIXTURE, file);

  const store = createStore({ file });
  const loaded = store.load();
  const next = loaded.items.map((item) =>
    item.id === loaded.items[0].id ? { ...item, done: true, completedAt: new Date().toISOString() } : item,
  );
  // 与桌面版编辑器的约定一致：base 是本次编辑所基于的快照，next 是编辑后的全量
  store.save({
    base: { items: loaded.items, prefs: loaded.prefs },
    next: { items: next, prefs: loaded.prefs },
  });

  const written = JSON.parse(fs.readFileSync(file, "utf8"));
  const required = ["id", "title", "detail", "date", "time", "done", "completedAt", "deleted", "deletedAt", "color", "defer", "createdAt"];
  for (const item of written.items) {
    for (const key of required) {
      assert.ok(Object.prototype.hasOwnProperty.call(item, key), `missing field ${key}`);
    }
  }
  assert.equal(written.items[0].done, true);
  assert.ok(fs.existsSync(`${file}.backup`), "desktop should keep a .backup after saving");
});
