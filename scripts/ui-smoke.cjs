"use strict";

// 桌面端 UI 冒烟：通过 Electron 远程调试读取真实 DOM，验证同步面板渲染与状态。
// 用法：node scripts/ui-smoke.cjs [--sync]

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const withSync = process.argv.includes("--sync");
const root = path.join(__dirname, "..");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "deskweek-ui-"));
const electron = require("electron");
const port = 9333;

const env = { ...process.env, DESKWEEK_DATA_DIR: dataDir };
if (withSync) env.DESKWEEK_SYNC = "1";
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, [`--remote-debugging-port=${port}`, root, "--open-manager"], {
  env,
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
child.stdout.on("data", (chunk) => (output += chunk.toString()));
child.stderr.on("data", (chunk) => (output += chunk.toString()));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function targets() {
  const response = await fetch(`http://127.0.0.1:${port}/json`);
  return response.json();
}

function evaluate(webSocketUrl, expression) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("CDP timeout"));
    }, 8000);
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({
        id: 1,
        method: "Runtime.evaluate",
        params: { expression, returnByValue: true, awaitPromise: true },
      }));
    });
    socket.addEventListener("message", (event) => {
      const payload = JSON.parse(event.data);
      if (payload.id !== 1) return;
      clearTimeout(timer);
      socket.close();
      resolve(payload.result?.result?.value);
    });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("CDP socket error"));
    });
  });
}

function finish(ok, detail) {
  try {
    child.kill();
  } catch {
    /* ignore */
  }
  console.log(detail);
  console.log(ok ? "UI_SMOKE_PASS" : "UI_SMOKE_FAIL");
  setTimeout(() => process.exit(ok ? 0 : 1), 300);
}

(async () => {
  const deadline = Date.now() + 25000;
  let manager = null;
  while (Date.now() < deadline) {
    await sleep(500);
    try {
      const list = await targets();
      manager = list.find((target) => target.url.includes("manager/index.html"));
      if (manager) break;
    } catch {
      /* electron not ready yet */
    }
  }
  if (!manager) return finish(false, "未找到管理中心页面\n" + output.split("\n").slice(-6).join("\n"));

  // 等同步服务启动 + 面板轮询至少跑一轮（面板 5s 刷新一次）
  await sleep(12000);
  const snapshot = await evaluate(manager.webSocketDebuggerUrl, `(async () => {
    const status = await window.deskWeek.syncStatus().catch(e => ({ error: e.message }));
    const card = document.querySelector('.sync-card');
    return JSON.stringify({
      card: Boolean(card),
      heading: card ? card.querySelector('h3').textContent : null,
      status: document.getElementById('syncStatusText')?.textContent || null,
      toggleChecked: document.getElementById('syncToggle')?.checked ?? null,
      pendingRows: document.querySelectorAll('#syncPendingList .sync-row').length,
      peerRows: document.querySelectorAll('#syncPeerList .sync-row').length,
      ipcRunning: status?.running ?? null,
      ipcPort: status?.port ?? null,
    });
  })()`);

  const data = JSON.parse(snapshot || "{}");
  const problems = [];
  if (!data.card) problems.push("同步卡片未渲染");
  if (data.heading !== "局域网同步") problems.push("标题异常: " + data.heading);
  if (!data.status) problems.push("状态文字为空");
  if (withSync && data.toggleChecked !== true) problems.push("已开启同步但开关未勾选");
  if (withSync && !/运行中/.test(data.status || "")) problems.push("状态未显示运行中: " + data.status);
  if (!withSync && data.toggleChecked !== false) problems.push("未开启同步但开关是勾选状态");

  finish(
    problems.length === 0,
    `UI: card=${data.card} heading=${data.heading} status=${data.status} toggle=${data.toggleChecked} ipcRunning=${data.ipcRunning} ipcPort=${data.ipcPort}\n` +
      (problems.length ? problems.join("; ") : "check ok"),
  );
})().catch((error) => finish(false, "异常: " + error.message));
