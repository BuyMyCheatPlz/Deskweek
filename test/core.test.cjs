"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createStore } = require("../src/main/storage/store.cjs");
const { fitBounds, resizeBounds } = require("../src/main/windows/geometry.cjs");
const { createRefreshPolicy, coversDisplay } = require("../src/main/runtime/refresh-policy.cjs");
const { extractDocuments } = require("../src/main/ai/documents.cjs");

const primary = { workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
const secondary = { workArea: { x: 1920, y: 0, width: 1920, height: 1040 } };
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deskweek-unit-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "data.json");
  return { dir, file, store: createStore({ file }) };
}
const item = (id, title = id) => ({ id, title, done: false });
test("secondary and negative-origin monitor positions survive restart", () => {
  const b = { x: 2200, y: 150, width: 880, height: 690 };
  assert.deepEqual(fitBounds(b, [primary, secondary]), b);
  const left = { workArea: { x: -1920, y: -200, width: 1920, height: 1040 } };
  assert.equal(fitBounds({ ...b, x: -1500 }, [primary, left]).x, -1500);
});
test("default, mini restore and every resize edge remain in a small work area", () => {
  const displays = [{ workArea: { x: 0, y: 0, width: 800, height: 600 } }];
  const inside = b => { assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.width <= 800 && b.y + b.height <= 600); };
  inside(fitBounds(null, displays));
  inside(fitBounds({ x: 2200, y: 200, width: 880, height: 690 }, displays));
  for (const edge of ["n", "s", "e", "w", "ne", "nw", "se", "sw"]) for (const delta of [-5000, 5000]) inside(resizeBounds({ x: 40, y: 40, width: 600, height: 400 }, { x: delta, y: delta }, edge, displays));
});
test("two stale window snapshots keep both newly added tasks", t => {
  const { store } = fixture(t), base = store.load();
  store.save({ base, next: { items: [item("A")], prefs: {} } });
  assert.deepEqual(store.save({ base, next: { items: [item("B")], prefs: {} } }).items.map(i => i.id).sort(), ["A", "B"]);
});
test("different fields merge; conflicting field and stale import are rejected", t => {
  const { store } = fixture(t);
  const base = store.save({ base: store.load(), next: { items: [item("A")], prefs: {} } });
  store.save({ base, next: { items: [item("A", "new title")], prefs: {} } });
  const result = store.save({ base, next: { items: [{ ...item("A"), done: true }], prefs: { theme: "dark" } } });
  assert.equal(result.items[0].title, "new title"); assert.equal(result.items[0].done, true);
  assert.throws(() => store.save({ base, next: { items: [item("A", "conflict")], prefs: {} } }), /另一窗口/);
  assert.throws(() => store.save({ base, next: { items: [], prefs: {} }, replace: true }), /导入/);
});
test("stale unchanged snapshot does not resurrect a deleted task", t => {
  const { store } = fixture(t);
  const base = store.save({ base: store.load(), next: { items: [item("A")], prefs: {} } });
  store.save({ base, next: { items: [], prefs: {} } });
  const result = store.save({ base, next: { items: base.items, prefs: { theme: "dark" } } });
  assert.deepEqual(result.items, []);
});
test("damaged primary recovers the last good backup", t => {
  const { file } = fixture(t);
  fs.writeFileSync(file, "{broken"); fs.writeFileSync(`${file}.backup`, JSON.stringify({ items: [item("safe")], prefs: {} }));
  const result = createStore({ file }).load();
  assert.equal(result.items[0].id, "safe"); assert.equal(result.recovered, true);
  assert.equal(JSON.parse(fs.readFileSync(file)).items[0].id, "safe");
});
test("unrecoverable data is never overwritten", t => {
  const { file } = fixture(t); fs.writeFileSync(file, "{broken");
  const store = createStore({ file }); assert.ok(store.load().loadError);
  assert.throws(() => store.save({ next: { items: [], prefs: {} } }), /阻止覆盖/);
  assert.equal(fs.readFileSync(file, "utf8"), "{broken");
});
test("failed atomic replacement leaves the primary intact", t => {
  const { file, store } = fixture(t);
  const base = store.save({ base: store.load(), next: { items: [item("safe")], prefs: {} } });
  const io = Object.create(fs); io.renameSync = (a, b) => { if (b === file) throw new Error("simulated interruption"); fs.renameSync(a, b); };
  assert.throws(() => createStore({ file, io }).save({ base, next: { items: [], prefs: {} } }), /interruption/);
  assert.equal(JSON.parse(fs.readFileSync(file)).items[0].id, "safe");
});
test("fullscreen suspends immediately, releases after grace, resumes; drafts prevent release", () => {
  const policy = createRefreshPolicy();
  assert.equal(policy.evaluate({ now: 0, fullscreen: true }).paused, true);
  assert.equal(policy.evaluate({ now: 20000, fullscreen: true, canRelease: false }).release, false);
  assert.equal(policy.evaluate({ now: 20001, fullscreen: true, canRelease: true }).release, true);
  assert.deepEqual(policy.evaluate({ now: 21000 }), { paused: false, reason: "active", release: false });
  assert.equal(policy.evaluate({ now: 22000, hidden: true, canRelease: true }).release, false);
});
test("fullscreen detection excludes normal work-area maximization", () => {
  assert.equal(coversDisplay({ x: 0, y: 0, width: 1920, height: 1040 }, [{ x: 0, y: 0, width: 1920, height: 1080 }]), false);
  assert.equal(coversDisplay({ x: -1920, y: 0, width: 1920, height: 1080 }, [{ x: -1920, y: 0, width: 1920, height: 1080 }]), true);
});
test("document worker extracts text and releases itself after invalid files too", async () => {
  const result = await extractDocuments([{ name: "task.txt", dataUrl: "data:text/plain;base64," + Buffer.from("hello task").toString("base64") }]);
  assert.match(result[0], /hello task/);
  await assert.rejects(extractDocuments([{ name: "bad.exe", dataUrl: "data:;base64,YQ==" }]), /不支持/);
  assert.equal((await extractDocuments([{ name: "task.txt", dataUrl: "data:;base64,YQ==" }])).length, 1);
});
