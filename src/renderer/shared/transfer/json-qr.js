(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.DeskWeekJsonQr = api;
})(globalThis, function () {
  "use strict";
  const FORMAT = "deskweek-json-qr", MAX_BYTES = 1048576, QR_BYTES = 650, CHUNK_BYTES = 300, MAX_PARTS = Math.ceil(MAX_BYTES / CHUNK_BYTES);
  const COMPRESSED_CHUNK_BYTES = 600, MAX_COMPRESSED_PARTS = Math.ceil(MAX_BYTES / COMPRESSED_CHUNK_BYTES);
  const encode = text => new TextEncoder().encode(text);
  const decode = bytes => new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const base64 = bytes => { let s = ""; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); };
  function unbase64(text, max = CHUNK_BYTES) {
    if (typeof text !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) throw new Error("二维码分片编码无效");
    const s = atob(text), bytes = Uint8Array.from(s, c => c.charCodeAt(0));
    if (base64(bytes) !== text || !bytes.length || bytes.length > max) throw new Error("二维码分片大小无效");
    return bytes;
  }
  async function hash(bytes) { return [...new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes))].map(b => b.toString(16).padStart(2, "0")).join(""); }
  async function transform(bytes, inflate, limit) {
    const codec = inflate ? new DecompressionStream("deflate") : new CompressionStream("deflate");
    const reader = new Blob([bytes]).stream().pipeThrough(codec).getReader(), chunks = [];
    let length = 0;
    try {
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        length += value.length;
        if (length > limit) { await reader.cancel(); throw new Error("解压数据超过声明长度，请重新生成二维码"); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const result = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
    return result;
  }
  function validate(text) {
    if (typeof text !== "string") throw new Error("JSON 内容无效");
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || !Array.isArray(value.items)) throw new Error("没有有效的 items 任务数组");
    const ids = new Set();
    for (const task of value.items) {
      if (!task || typeof task.id !== "string" || !task.id.trim() || ids.has(task.id) || typeof task.title !== "string" || !task.title.trim()) throw new Error("任务 ID 缺失、重复或标题无效");
      ids.add(task.id);
      for (const k of ["detail", "date", "time", "defer", "completedAt", "deletedAt", "createdAt", "color"]) if (task[k] !== undefined && typeof task[k] !== "string") throw new Error(`任务 ${k} 类型无效`);
      for (const k of ["done", "deleted"]) if (task[k] !== undefined && typeof task[k] !== "boolean") throw new Error(`任务 ${k} 类型无效`);
      if (task.date && (!/^\d{4}-\d{2}-\d{2}$/.test(task.date) || Number.isNaN(Date.parse(`${task.date}T00:00:00Z`)) || new Date(`${task.date}T00:00:00Z`).toISOString().slice(0, 10) !== task.date)) throw new Error("任务日期无效");
      if (task.time && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(task.time)) throw new Error("任务时间无效");
    }
    if (value.prefs !== undefined && (!value.prefs || typeof value.prefs !== "object" || Array.isArray(value.prefs))) throw new Error("prefs 格式无效");
    return value;
  }
  async function legacyFrames(text) {
    const compact = JSON.stringify(validate(text)), bytes = encode(compact);
    if (bytes.length > MAX_BYTES) throw new Error("JSON 超过 1 MiB，请使用文件导入");
    if (bytes.length <= QR_BYTES) return [compact];
    const sha256 = await hash(bytes), total = Math.ceil(bytes.length / CHUNK_BYTES), result = [];
    for (let i = 0; i < total; i++) result.push(JSON.stringify({ format: FORMAT, version: 1, id: sha256.slice(0, 16), part: i + 1, total, bytes: bytes.length, sha256, data: base64(bytes.slice(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES)) }));
    return result;
  }
  async function frames(text, { legacy = false } = {}) {
    const compact = JSON.stringify(validate(text)), bytes = encode(compact);
    if (bytes.length > MAX_BYTES) throw new Error("JSON 超过 1 MiB，请使用文件导入");
    if (legacy) return await legacyFrames(compact);
    const oldCount = bytes.length <= QR_BYTES ? 1 : Math.ceil(bytes.length / CHUNK_BYTES);
    const zipped = await transform(bytes, false, MAX_BYTES + 4096);
    if (zipped.length > MAX_BYTES) return await legacyFrames(compact);
    const h = await hash(zipped), n = Math.ceil(zipped.length / COMPRESSED_CHUNK_BYTES), result = [];
    for (let i = 0; i < n; i++) result.push(JSON.stringify({ f: "DWQ", v: 2, p: i + 1, n, b: zipped.length, u: bytes.length, h, d: base64(zipped.slice(i * COMPRESSED_CHUNK_BYTES, (i + 1) * COMPRESSED_CHUNK_BYTES)) }));
    if (result.length < oldCount) return result;
    const old = await legacyFrames(compact);
    return result.length === oldCount && encode(result.join("")).length < encode(old.join("")).length ? result : old;
  }
  class Collector {
    constructor() { this.reset(); }
    reset() { this.epoch = (this.epoch || 0) + 1; this.meta = null; this.parts = new Map(); }
    get progress() { return { received: this.parts.size, total: this.meta?.total || 0 }; }
    async accept(text) {
      const epoch = this.epoch;
      if (typeof text !== "string" || encode(text).length > 2048) throw new Error("二维码内容过大或不是 DeskWeek 数据");
      const p = JSON.parse(text);
      if (p?.f === "DWQ") return await this.acceptCompressed(p, epoch);
      if (p?.format !== FORMAT) {
        if (this.meta) throw new Error("正在接收另一份数据，请先清空进度");
        validate(text); return { received: 1, total: 1, text };
      }
      if (p.version !== 1 || !Number.isInteger(p.total) || p.total < 2 || p.total > MAX_PARTS || !Number.isInteger(p.part) || p.part < 1 || p.part > p.total || !Number.isInteger(p.bytes) || p.bytes <= QR_BYTES || p.bytes > MAX_BYTES || p.total !== Math.ceil(p.bytes / CHUNK_BYTES) || typeof p.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(p.sha256) || p.id !== p.sha256.slice(0, 16)) throw new Error("二维码分片格式无效");
      const bytes = unbase64(p.data), expected = p.part === p.total ? p.bytes - (p.total - 1) * CHUNK_BYTES : CHUNK_BYTES;
      if (bytes.length !== expected) throw new Error("二维码分片长度无效");
      const meta = JSON.stringify([p.id, p.total, p.bytes, p.sha256]);
      if (this.meta && this.meta.key !== meta) throw new Error("扫到了另一份数据，请先清空进度");
      if (this.parts.has(p.part) && base64(this.parts.get(p.part)) !== p.data) throw new Error("重复分片内容冲突，请重新扫描");
      this.meta = { key: meta, total: p.total }; this.parts.set(p.part, bytes);
      if (this.parts.size !== p.total) return this.progress;
      const all = new Uint8Array(p.bytes); let offset = 0;
      for (let i = 1; i <= p.total; i++) { const part = this.parts.get(i); all.set(part, offset); offset += part.length; }
      if (await hash(all) !== p.sha256) throw new Error("完整性校验失败，请清空后重扫");
      if (epoch !== this.epoch) throw new Error("接收进度已清空，请重新扫描");
      const result = decode(all); validate(result); return { ...this.progress, text: result };
    }
    async acceptCompressed(p, epoch) {
      if (p.v !== 2) throw new Error("二维码版本不兼容，请更新两端应用");
      if (!Number.isInteger(p.n) || p.n < 1 || p.n > MAX_COMPRESSED_PARTS || !Number.isInteger(p.p) || p.p < 1 || p.p > p.n || !Number.isInteger(p.b) || p.b < 1 || p.b > MAX_BYTES || p.n !== Math.ceil(p.b / COMPRESSED_CHUNK_BYTES) || !Number.isInteger(p.u) || p.u < 1 || p.u > MAX_BYTES || typeof p.h !== "string" || !/^[a-f0-9]{64}$/.test(p.h)) throw new Error("压缩二维码格式无效");
      const bytes = unbase64(p.d, COMPRESSED_CHUNK_BYTES), expected = p.p === p.n ? p.b - (p.n - 1) * COMPRESSED_CHUNK_BYTES : COMPRESSED_CHUNK_BYTES;
      if (bytes.length !== expected) throw new Error("二维码分片长度无效");
      const meta = JSON.stringify([2, p.n, p.b, p.u, p.h]);
      if (this.meta && this.meta.key !== meta) throw new Error("扫到了另一份数据，请先清空进度");
      if (this.parts.has(p.p) && base64(this.parts.get(p.p)) !== p.d) throw new Error("重复分片内容冲突，请重新扫描");
      this.meta = { key: meta, total: p.n }; this.parts.set(p.p, bytes);
      if (this.parts.size !== p.n) return this.progress;
      const zipped = new Uint8Array(p.b); let offset = 0;
      for (let i = 1; i <= p.n; i++) { const part = this.parts.get(i); zipped.set(part, offset); offset += part.length; }
      if (await hash(zipped) !== p.h) throw new Error("完整性校验失败，请清空后重扫");
      const raw = await transform(zipped, true, p.u);
      if (raw.length !== p.u) throw new Error("解压数据长度不符");
      if (epoch !== this.epoch) throw new Error("接收进度已清空，请重新扫描");
      const result = decode(raw); validate(result); return { ...this.progress, text: result };
    }
  }
  return { FORMAT, MAX_BYTES, QR_BYTES, CHUNK_BYTES, MAX_PARTS, COMPRESSED_CHUNK_BYTES, validate, frames, Collector };
});
