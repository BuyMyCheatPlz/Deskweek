"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");

test("successful verified download starts installer and calls the actual app quit", async () => {
  const payload = Buffer.from("fixture update");
  let quit = 0, timer, spawned = false;
  const io = { mkdirSync() {}, writeFileSync() {}, renameSync() {}, existsSync: () => false,
    readFileSync: (...args) => fs.readFileSync(...args),
    promises: { open: async () => ({ write: async () => {}, close: async () => {} }) },
  };
  const sandbox = { module: { exports: {} }, __dirname: require("node:path").resolve(__dirname, "../src/main/updates"), Buffer, Date, AbortSignal, process: { execPath: "C:\\DeskWeek\\DeskWeek.exe", pid: 123 },
    setTimeout(fn) { timer = fn; },
    fetch: async url => url.includes("releases/latest") ? { ok: true, json: async () => ({ tag_name: "9.0.0", assets: [{ name: "portable.zip", digest: "sha256:" + crypto.createHash("sha256").update(payload).digest("hex"), browser_download_url: "https://example.invalid/portable.zip" }] }) } : {
      ok: true, headers: { get: () => payload.length }, body: { getReader() { let done = false; return { read: async () => { const result = done ? { done: true } : { done: false, value: payload }; done = true; return result; } }; } },
    },
    require(name) {
      if (name === "electron") return { app: { isPackaged: true, getVersion: () => "1.2.2", quit: () => quit++ } };
      if (name === "node:fs") return io;
      if (name === "node:child_process") return { spawn() { spawned = true; const child = new EventEmitter(); child.unref = () => {}; queueMicrotask(() => child.emit("spawn")); return child; } };
      return require(name);
    },
  };
  vm.createContext(sandbox); vm.runInContext(fs.readFileSync(require.resolve("../src/main/updates/updater.cjs"), "utf8"), sandbox);
  const result = await sandbox.module.exports.downloadAndInstallUpdate({ sender: { isDestroyed: () => false, send() {} } }, "memory-data");
  assert.equal(result.updated, true); assert.equal(spawned, true); timer(); assert.equal(quit, 1);
});
test("developer runtime cannot replace its Electron installation", async () => {
  const sandbox = { module: { exports: {} }, require: name => name === "electron" ? { app: { isPackaged: false } } : require(name) };
  vm.createContext(sandbox); vm.runInContext(fs.readFileSync(require.resolve("../src/main/updates/updater.cjs"), "utf8"), sandbox);
  await assert.rejects(sandbox.module.exports.downloadAndInstallUpdate({}, "unused"), /开发模式/);
});
