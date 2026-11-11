"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), crypto = require("node:crypto"), zlib = require("node:zlib");
const QRCode = require("qrcode"), jsQR = require("jsqr"), Q = require("../src/renderer/shared/transfer/json-qr.js");
const fixture = require("./fixtures/json-qr-v2.json");
function envelopes(bytes, rawSize) {
  const h = crypto.createHash("sha256").update(bytes).digest("hex"), n = Math.ceil(bytes.length / Q.COMPRESSED_CHUNK_BYTES);
  return Array.from({ length: n }, (_, i) => JSON.stringify({ f: "DWQ", v: 2, p: i + 1, n, b: bytes.length, u: rawSize, h, d: bytes.subarray(i * Q.COMPRESSED_CHUNK_BYTES, (i + 1) * Q.COMPRESSED_CHUNK_BYTES).toString("base64") }));
}
test("20 fully populated tasks use at most 3 QR codes and preserve every field", async () => {
  const text = JSON.stringify(fixture.snapshot), frames = await Q.frames(text), old = await Q.frames(text, { legacy: true });
  assert.ok(frames.length <= 3); assert.ok(frames.length * 5 < old.length);
  const c = new Q.Collector(); let result;
  for (const f of [...frames].reverse()) result = await c.accept(f);
  assert.deepEqual(JSON.parse(result.text), fixture.snapshot);
  assert.ok(frames.every(f => Buffer.byteLength(f) <= 1100));
});
test("cross-runtime compressed fixture and duplicate scan", async () => {
  for (const frames of [fixture.desktopFrames, fixture.androidFrames].filter(Boolean)) {
    const c = new Q.Collector(); assert.equal((await c.accept(frames[0])).received, 1);
    assert.equal((await c.accept(frames[0])).received, 1);
    let result; for (const f of [...frames].reverse()) result = await c.accept(f);
    assert.deepEqual(JSON.parse(result.text), fixture.snapshot);
  }
});
test("compressed QR pixels decode with camera library", async () => {
  const c = new Q.Collector(); let result;
  for (const frame of fixture.desktopFrames) {
    const m = QRCode.create(frame, { errorCorrectionLevel: "M" }).modules, scale = 6, s = (m.size + 8) * scale;
    assert.ok(QRCode.create(frame, { errorCorrectionLevel: "M" }).version <= 27);
    const rgba = new Uint8ClampedArray(s * s * 4).fill(255);
    for (let y = 0; y < m.size; y++) for (let x = 0; x < m.size; x++) if (m.get(y, x)) for (let a = 0; a < scale; a++) for (let b = 0; b < scale; b++) { const o = ((y + 4) * scale * s + a * s + (x + 4) * scale + b) * 4; rgba[o] = rgba[o + 1] = rgba[o + 2] = 0; }
    const decoded = jsQR(rgba, s, s); assert.ok(decoded); assert.equal(decoded.data, frame);
    result = await c.accept(decoded.data);
  }
  assert.deepEqual(JSON.parse(result.text), fixture.snapshot);
});
test("reject mixing compressed and legacy batches or conflicting copies", async () => {
  const c = new Q.Collector(), frames = fixture.desktopFrames;
  await c.accept(frames[0]);
  const v1 = await Q.frames(JSON.stringify(fixture.snapshot), { legacy: true });
  await assert.rejects(c.accept(v1[0]), /另一份/);
  const conflicting = JSON.parse(frames[0]); conflicting.d = Buffer.alloc(Q.COMPRESSED_CHUNK_BYTES, 42).toString("base64");
  await assert.rejects(c.accept(JSON.stringify(conflicting)), /冲突/);
  assert.equal(c.progress.received, 1);
});
test("tampered compressed data, truncated streams, trailing data and inflate bounds", async () => {
  const raw = Buffer.from(JSON.stringify({ items: [], padding: "x".repeat(10000) })), zipped = zlib.deflateSync(raw);
  const bad = [envelopes(zipped, 100), envelopes(zipped, raw.length + 1), envelopes(zipped.subarray(0, zipped.length - 2), raw.length), envelopes(Buffer.concat([zipped, Buffer.from([0])]), raw.length), envelopes(zlib.deflateSync(Buffer.from([0xc0, 0xff])), 2)];
  for (const frames of bad) { const c = new Q.Collector(); await assert.rejects(async () => { for (const f of frames) await c.accept(f); }); }
  const frames = [...fixture.desktopFrames], part = JSON.parse(frames[0]), bytes = Buffer.from(part.d, "base64"); bytes[3] ^= 1; part.d = bytes.toString("base64"); frames[0] = JSON.stringify(part);
  const c = new Q.Collector(); await assert.rejects(async () => { for (const f of frames) await c.accept(f); }, /校验失败/);
});
test("reject unknown compressed versions and invalid lengths before buffering", async () => {
  for (const patch of [{ v: 3 }, { n: 999999 }, { p: 0 }, { b: 0 }, { u: Q.MAX_BYTES + 1 }, { d: "!!" }, { h: "x" }]) {
    const c = new Q.Collector(); await assert.rejects(c.accept(JSON.stringify({ ...JSON.parse(fixture.desktopFrames[0]), ...patch })));
    assert.equal(c.progress.received, 0);
  }
});
test("reset while decompressing must not resurrect a cancelled import", async () => {
  const raw = Buffer.from(JSON.stringify({ items: [], padding: "same".repeat(1000) })), frames = envelopes(zlib.deflateSync(raw), raw.length);
  assert.equal(frames.length, 1);
  const c = new Q.Collector(), pending = c.accept(frames[0]); c.reset();
  await assert.rejects(pending, /清空/); assert.equal(c.progress.received, 0);
});
