"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { isDeepStrictEqual: equal } = require("node:util");

function normalizeStore(value) {
  if (!value || !Array.isArray(value.items) || !value.items.every(item => item && typeof item.id === "string" && typeof item.title === "string")) throw new Error("任务数据格式无效");
  if (new Set(value.items.map(item => item.id)).size !== value.items.length) throw new Error("任务 ID 重复");
  const items = value.items.map(item => ({ detail: "", date: "", time: "", defer: "none", done: false, completedAt: "", deleted: false, deletedAt: "", ...item }));
  return { initialized: true, items, prefs: value.prefs && typeof value.prefs === "object" && !Array.isArray(value.prefs) ? value.prefs : {}, revision: Number.isSafeInteger(value.revision) ? value.revision : 0 };
}

// Compare the sender's base with its next state, then apply only changed fields.
// A stale whole-window snapshot must never delete another window's additions.
function mergeFields(base, next, current) {
  const result = { ...current };
  for (const key of new Set([...Object.keys(base), ...Object.keys(next)])) {
    if (["__proto__", "constructor", "prototype"].includes(key)) continue;
    if (equal(base[key], next[key])) continue;
    if (!equal(current[key], base[key]) && !equal(current[key], next[key])) throw new Error("另一窗口已修改同一内容，请重试");
    if (Object.hasOwn(next, key)) result[key] = next[key]; else delete result[key];
  }
  return result;
}

function mergeStore(current, base, next) {
  const previous = new Map(base.items.map(item => [item.id, item]));
  const incoming = new Map(next.items.map(item => [item.id, item]));
  const merged = new Map(current.items.map(item => [item.id, item]));
  for (const [id, before] of previous) {
    const after = incoming.get(id);
    if (equal(before, after)) continue;
    const actual = merged.get(id);
    if (!after) {
      if (actual && !equal(actual, before)) throw new Error("另一窗口已修改该任务，无法删除，请重试");
      merged.delete(id);
    } else {
      if (!actual) throw new Error("该任务已被另一窗口删除");
      merged.set(id, mergeFields(before, after, actual));
    }
  }
  for (const [id, item] of incoming) {
    if (previous.has(id)) continue;
    if (merged.has(id) && !equal(merged.get(id), item)) throw new Error("任务 ID 冲突");
    merged.set(id, item);
  }
  return { items: [...merged.values()], prefs: mergeFields(base.prefs, next.prefs, current.prefs) };
}

function writeAtomic(file, text, io = fs) {
  io.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  let fd;
  try {
    fd = io.openSync(temp, "w");
    io.writeFileSync(fd, text, "utf8");
    io.fsyncSync(fd);
    io.closeSync(fd); fd = undefined;
    io.renameSync(temp, file);
  } finally {
    if (fd !== undefined) io.closeSync(fd);
    try { io.unlinkSync(temp); } catch { /* already renamed */ }
  }
}

function createStore({ file, io = fs, onChange = () => {} }) {
  let cache;
  function load() {
    if (cache) return structuredClone(cache);
    let damaged = false;
    for (const candidate of [file, `${file}.backup`]) {
      try {
        cache = normalizeStore(JSON.parse(io.readFileSync(candidate, "utf8")));
        if (candidate !== file) {
          cache.recovered = true;
          if (io.existsSync(file)) io.copyFileSync(file, `${file}.corrupt-${Date.now()}`);
          writeAtomic(file, JSON.stringify(cache), io);
        }
        return structuredClone(cache);
      } catch (error) {
        if (io.existsSync(candidate) || error.code !== "ENOENT") damaged = true;
        cache = null;
      }
    }
    cache = { initialized: false, items: [], prefs: {}, revision: 0, ...(damaged ? { loadError: "unreadable-or-invalid" } : {}) };
    return structuredClone(cache);
  }
  function save(request) {
    const current = load();
    if (current.loadError) throw new Error("数据损坏且备份不可用，请先从数据目录恢复文件；已阻止覆盖");
    const next = normalizeStore(request?.next);
    const base = normalizeStore(request?.base || { items: [], prefs: {} });
    if (request.replace && base.revision !== current.revision) throw new Error("导入期间数据已变化，请重新导入");
    const merged = request.replace ? next : mergeStore(current, base, next);
    const payload = { initialized: true, items: merged.items, prefs: merged.prefs, revision: current.revision + 1, updatedAt: new Date().toISOString() };
    // Only a validated primary can replace the last known good backup.
    if (io.existsSync(file)) {
      normalizeStore(JSON.parse(io.readFileSync(file, "utf8")));
      writeAtomic(`${file}.backup`, io.readFileSync(file, "utf8"), io);
    }
    writeAtomic(file, JSON.stringify(payload), io);
    cache = payload;
    onChange(structuredClone(payload));
    return structuredClone(payload);
  }
  return { load, save, edit: (before, after) => save({ base: { items: [before], prefs: {} }, next: { items: [after], prefs: {} } }) };
}

module.exports = { createStore, mergeStore, writeAtomic, normalizeStore };
