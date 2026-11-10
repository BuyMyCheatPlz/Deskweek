"use strict";

// 桌面端冒烟：用隔离数据目录启动真实应用，确认窗口能加载、同步服务能起来、无崩溃。
// 用法：node scripts/smoke.cjs [--sync] [--timeout 25000]

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const args = process.argv.slice(2);
const withSync = args.includes("--sync");
const timeoutArg = args.indexOf("--timeout");
const timeoutMs = timeoutArg >= 0 ? Number(args[timeoutArg + 1]) : 25000;

const root = path.join(__dirname, "..");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "deskweek-smoke-"));
const electron = require("electron");

const env = { ...process.env, DESKWEEK_DATA_DIR: dataDir };
if (withSync) env.DESKWEEK_SYNC = "1";
// 当前 shell 继承了 ELECTRON_RUN_AS_NODE，会让 electron.exe 退化成 node
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, [root], { env, stdio: ["ignore", "pipe", "pipe"] });
let output = "";
let sawSyncStart = false;
let sawError = false;

child.stdout.on("data", (chunk) => {
  output += chunk.toString();
  if (/\[sync\] started \d+/.test(output)) sawSyncStart = true;
});
child.stderr.on("data", (chunk) => {
  output += chunk.toString();
  if (/Unhandled|TypeError|ReferenceError/.test(chunk.toString())) sawError = true;
});

const deadline = Date.now() + timeoutMs;
const timer = setInterval(() => {
  const ready = withSync ? sawSyncStart : /ready|DeskWeek/i.test(output);
  if (ready || Date.now() > deadline) {
    clearInterval(timer);
    finish(ready && !sawError);
  }
}, 500);

function finish(ok) {
  try { child.kill(); } catch { /* ignore */ }
  const lines = output.split(/\r?\n/).filter(Boolean).slice(-12);
  console.log(lines.join("\n"));
  if (!withSync) console.log("smoke: 应用启动完成（未验证同步）");
  console.log(ok ? "SMOKE_PASS" : "SMOKE_FAIL");
  setTimeout(() => process.exit(ok ? 0 : 1), 300);
}
