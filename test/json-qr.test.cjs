"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), QRCode = require("qrcode"), jsQR = require("jsqr");
const Q = require("../src/renderer/shared/transfer/json-qr.js");
const fixture = require("./fixtures/json-qr-v1.json");
const clone = value => JSON.parse(JSON.stringify(value));
test("single QR contains ordinary JSON and actual image decodes without network", async () => {
  const snapshot = { items: [{ id: "raw", title: "中文任务 👨‍👩‍👧‍👦", detail: "https://example.com 不打开链接" }], prefs: {} };
  const frames = await Q.frames(JSON.stringify(snapshot)); assert.equal(frames.length, 1);
  assert.deepEqual(JSON.parse(frames[0]), snapshot);
  const modules = QRCode.create(frames[0], { errorCorrectionLevel: "M" }).modules, scale = 4, size = (modules.size + 8) * scale;
  const rgba = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let y = 0; y < modules.size; y++) for (let x = 0; x < modules.size; x++) if (modules.get(y, x)) for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) { const offset = ((y * scale + 4 * scale + dy) * size + x * scale + 4 * scale + dx) * 4; rgba[offset] = rgba[offset + 1] = rgba[offset + 2] = 0; }
  const decoded = jsQR(rgba, size, size); assert.equal(decoded.data, frames[0]);
  assert.deepEqual(JSON.parse((await new Q.Collector().accept(decoded.data)).text), snapshot);
});
test("shared Android fixture, out of order, repeated frames, UTF-8 and checksum", async () => {
  assert.deepEqual(await Q.frames(JSON.stringify(fixture.snapshot), { legacy: true }), fixture.frames);
  const collector = new Q.Collector(); const order = [...fixture.frames].reverse();
  const first = await collector.accept(order[0]); assert.equal(first.received, 1); assert.equal(first.text, undefined);
  assert.equal((await collector.accept(order[0])).received, 1);
  let result; for (const frame of order) result = await collector.accept(frame);
  assert.deepEqual(JSON.parse(result.text), fixture.snapshot);
  assert.ok(fixture.frames.every(frame => Buffer.byteLength(frame) <= Q.QR_BYTES));
});
test("all multipart QR images can be decoded and reassembled", async () => {
  const collector = new Q.Collector(); let result;
  for (const frame of fixture.frames) {
    const m = QRCode.create(frame, { errorCorrectionLevel: "M" }).modules, s = (m.size + 8) * 4, rgba = new Uint8ClampedArray(s * s * 4).fill(255);
    for (let y = 0; y < m.size; y++) for (let x = 0; x < m.size; x++) if (m.get(y, x)) for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) { const offset = ((y + 4) * 4 * s + a * s + (x + 4) * 4 + b) * 4; rgba[offset] = rgba[offset + 1] = rgba[offset + 2] = 0; }
    result = await collector.accept(jsQR(rgba, s, s).data);
  }
  assert.deepEqual(JSON.parse(result.text), fixture.snapshot);
});
test("mixed exports and conflicting duplicate parts preserve collected progress", async () => {
  const collector = new Q.Collector(); await collector.accept(fixture.frames[0]);
  const other = JSON.parse(fixture.frames[1]); other.sha256 = "f".repeat(64); other.id = other.sha256.slice(0, 16);
  await assert.rejects(collector.accept(JSON.stringify(other)), /另一份/);
  const duplicate = JSON.parse(fixture.frames[0]); duplicate.data = Buffer.alloc(Q.CHUNK_BYTES, 32).toString("base64");
  await assert.rejects(collector.accept(JSON.stringify(duplicate)), /冲突/); assert.equal(collector.progress.received, 1);
  await assert.rejects(collector.accept('{"items":[]}'), /另一份/); collector.reset(); assert.equal(collector.progress.received, 0);
});
test("tampered content cannot complete or produce import payload", async () => {
  const collector = new Q.Collector(), frames = [...fixture.frames], modified = JSON.parse(frames[0]);
  const bytes = Buffer.from(modified.data, "base64"); bytes[8] ^= 1; modified.data = bytes.toString("base64"); frames[0] = JSON.stringify(modified);
  for (const frame of frames.slice(0, -1)) assert.equal((await collector.accept(frame)).text, undefined);
  await assert.rejects(collector.accept(frames.at(-1)), /校验失败/);
});
test("bad IDs, values, oversized data and invalid multipart metadata are rejected", async () => {
  for (const snapshot of [{}, { items: [{ title: "no ID" }] }, { items: [{ id: "a", title: "" }] }, { items: [{ id: "a", title: "a" }, { id: "a", title: "b" }] }, { items: [{ id: "a", title: "a", done: "false" }] }, { items: [], prefs: [] }]) assert.throws(() => Q.validate(JSON.stringify(snapshot)));
  await assert.rejects(Q.frames(JSON.stringify({ items: [], oversized: "a".repeat(Q.MAX_BYTES) })), /1 MiB/);
  for (const patch of [{ version: 2 }, { total: 999999 }, { part: 0 }, { bytes: 1 }, { sha256: "x" }, { data: "!!" }]) {
    const p = { ...JSON.parse(fixture.frames[0]), ...patch };
    const c = new Q.Collector(); await assert.rejects(c.accept(JSON.stringify(p))); assert.equal(c.progress.received, 0);
  }
});
