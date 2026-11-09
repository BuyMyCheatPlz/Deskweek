"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");

test("successful verified download starts installer and calls the actual app quit", async () => {
  const payload = Buffer.from("fixture update");
  let quit = 0, timer, spawned = false, spawnedCommand = "", spawnedArgs = [];
  const io = { mkdirSync() {}, writeFileSync() {}, renameSync() {}, unlinkSync() {}, existsSync: path => String(path).endsWith(".started"),
    readFileSync: (...args) => fs.readFileSync(...args),
    promises: { open: async () => ({ write: async () => {}, close: async () => {} }) },
  };
  const sandbox = { module: { exports: {} }, __dirname: require("node:path").resolve(__dirname, "../src/main/updates"), Buffer, Date, AbortSignal, process: { execPath: "C:\\DeskWeek\\DeskWeek.exe", pid: 123 },
    setTimeout(fn) { timer = fn; },
    clearTimeout() {},
    fetch: async url => url.includes("releases/latest") ? { ok: true, json: async () => ({ tag_name: "9.0.0", assets: [{ name: "portable.zip", digest: "sha256:" + crypto.createHash("sha256").update(payload).digest("hex"), browser_download_url: "https://example.invalid/portable.zip" }] }) } : {
      ok: true, headers: { get: () => payload.length }, body: { getReader() { let done = false; return { read: async () => { const result = done ? { done: true } : { done: false, value: payload }; done = true; return result; } }; } },
    },
    require(name) {
      if (name === "electron") return { app: { isPackaged: true, getVersion: () => "1.2.2", quit: () => quit++ } };
      if (name === "node:fs") return io;
      if (name === "node:child_process") return { spawn(command, args) { spawned = true; spawnedCommand = command; spawnedArgs = args; const child = new EventEmitter(); child.unref = () => {}; child.kill = () => {}; queueMicrotask(() => child.emit("spawn")); return child; } };
      return require(name);
    },
  };
  vm.createContext(sandbox); vm.runInContext(fs.readFileSync(require.resolve("../src/main/updates/updater.cjs"), "utf8"), sandbox);
  const result = await sandbox.module.exports.downloadAndInstallUpdate({ sender: { isDestroyed: () => false, send() { throw new Error("manager closed"); } } }, "memory-data");
  assert.equal(result.updated, true); assert.equal(spawned, true);
  assert.equal(spawnedCommand, path.join("C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"));
  assert.equal(spawnedArgs.at(-1).endsWith(".started"), true);
  timer(); assert.equal(quit, 1);
});
test("developer runtime cannot replace its Electron installation", async () => {
  const sandbox = { module: { exports: {} }, require: name => name === "electron" ? { app: { isPackaged: false } } : require(name) };
  vm.createContext(sandbox); vm.runInContext(fs.readFileSync(require.resolve("../src/main/updates/updater.cjs"), "utf8"), sandbox);
  await assert.rejects(sandbox.module.exports.downloadAndInstallUpdate({}, "unused"), /开发模式/);
});
test("updater launch handshake times out instead of quitting blindly", async () => {
  const { EventEmitter } = require("node:events");
  const { waitForUpdaterStarted } = require("../src/main/updates/updater.cjs");
  const child = new EventEmitter();
  await assert.rejects(waitForUpdaterStarted(child, path.join(require("node:os").tmpdir(), `missing-update-marker-${Date.now()}`), 80), /启动超时/);
});
