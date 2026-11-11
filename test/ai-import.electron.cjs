"use strict";
// Windows AI 导入回归：真实窗口 + 真实 IPC + 本地 OpenAI 兼容 mock。
// 覆盖：浮窗多条/单条导入、设置页 AI 导入与勾选、管理端逐条校验与跳过、无渲染错误。
// 用法：node scripts/run.cjs --ai-test  （或 electron test/ai-import.electron.cjs）
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const assert = require("node:assert/strict");
const { app, BrowserWindow } = require("electron");

const root = path.resolve(__dirname, "..");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "deskweek-ai-import-"));
process.env.DESKWEEK_DATA_DIR = profile;
const errors = [];

const multi = [
  { title: "整理周报", detail: "发布机构：学院", date: "2026-11-12", time: "10:00", defer: "none" },
  { title: "评审同步协议", detail: "带上接口文档", date: "2026-11-13", time: "", defer: "none" },
  { title: "备份发布签名", detail: "", date: "", time: "", defer: "none" },
];
const single = [{ title: "只有一件事", detail: "详情", date: "", time: "", defer: "none" }];
const settingsItems = [
  { title: "设置页导入一", detail: "来自文本文件", date: "2026-12-01", time: "", defer: "none" },
  { title: "设置页导入二", detail: "", date: "", time: "", defer: "none" },
];
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    const items = body.includes("WIDGET_SINGLE") ? single
      : body.includes("SETTINGS_IMPORT") ? settingsItems
        : multi;
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({
      choices: [{ message: { role: "assistant", content: JSON.stringify({ items }) } }],
    }));
  });
});

require(path.join(root, "src/main/index.cjs"));
app.on("web-contents-created", (_event, contents) => {
  contents.on("console-message", (_event2, details) => { if (details?.level === "error") errors.push(details.message); });
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(fn, message, timeout = 20000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try { const value = await fn(); if (value) return value; } catch { /* retry */ }
    await sleep(120);
  }
  throw new Error(message);
}
const widget = () => BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().endsWith("/src/renderer/widget/index.html"));
const manager = () => BrowserWindow.getAllWindows().find((win) => win.getTitle().includes("管理中心"));

app.whenReady().then(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const win = await until(() => widget() && !widget().webContents.isLoading() && widget(), "浮窗未加载");
  await sleep(1200);
  const w = async (code) => {
    try { return await win.webContents.executeJavaScript(code, true); }
    catch (error) {
      console.error("AI_IMPORT_W_FAIL", code, error.message);
      throw error;
    }
  };
  await w(`window.deskWeek.saveAIConfig({baseUrl:'http://127.0.0.1:${port}/v1',model:'mock-model',apiKey:'test-key',clearKey:false,autoTranslate:false})`);

  // 1. 浮窗多条：结果条必须可见，点结果条导入全部。
  await w("document.querySelector('#newDetailButton').click()");
  await sleep(250);
  await w("document.querySelector('#aiSourceText').value='WIDGET_MULTI 明天整理周报'; refreshAIConfigHint(); document.querySelector('#aiSummarizeButton').click()");
  await until(() => w("document.querySelectorAll('.ai-proposal-card').length === 3"), "浮窗没有生成 3 条草稿");
  const bar = await w("JSON.stringify({ hidden: document.querySelector('#aiResultBar').hidden, text: document.querySelector('#aiResultText').textContent, button: document.querySelector('#calendarAIImportResults').textContent })");
  const barState = JSON.parse(bar);
  assert.equal(barState.hidden, false, "结果条应可见");
  assert.match(barState.text, /3 项/);
  assert.match(barState.button, /全部导入（3）/);
  await w("document.querySelector('#calendarAIImportResults').click()");
  await until(async () => (await w("window.deskWeek.loadStore()")).items.length === 3, "浮窗多条没有写入任务");
  assert.equal(await w("document.querySelector('#calendarAddDialog').open"), false, "导入后浮窗新增框应关闭");

  // 2. 浮窗单条：填入表单后，结果条也能一键导入。
  await w("document.querySelector('#newDetailButton').click()");
  await sleep(250);
  await w("document.querySelector('#aiSourceText').value='WIDGET_SINGLE 只有一件事'; document.querySelector('#aiSummarizeButton').click()");
  await until(() => w("document.querySelector('#calendarNewTitle').value === '只有一件事'"), "浮窗单条没有填入");
  assert.equal(await w("document.querySelector('#aiResultBar').hidden"), false, "单条结果条应可见");
  await w("document.querySelector('#calendarAIImportResults').click()");
  await until(async () => (await w("window.deskWeek.loadStore()")).items.length === 4, "浮窗单条没有写入任务");
  await w("document.querySelector('#calendarCancelAdd').click()");
  console.log("AI_IMPORT_STEP widget multi + single ok");

  // 3. 设置页：粘贴文字 + 添加文件，拆解后取消勾选一条，只导入选中的。
  await w("window.deskWeek.openManager()");
  const mgr = await until(() => { const value = manager(); return value && !value.webContents.isLoading() ? value : null; }, "管理中心未加载");
  const m = (code) => mgr.webContents.executeJavaScript(code, true);
  await until(() => m("Boolean(document.querySelector('[data-section=settings]'))"), "管理中心界面未初始化");
  await sleep(400);
  await m("document.querySelector('[data-section=settings]').click()");
  await sleep(350);
  assert.equal(await m("document.querySelector('#settingsAIParse').disabled"), false, "已配置时拆解按钮应可用");
  await m("document.querySelector('#settingsAISource').value='SETTINGS_IMPORT 明天下午开会'; addSettingsAIFiles([new File(['会议通知：周五前提交材料'], 'meeting.txt', {type:'text/plain'})])");
  await until(() => m("document.querySelector('#settingsAIFileList').textContent.includes('meeting.txt')"), "设置页文件未加入");
  await sleep(300);
  await m("document.querySelector('#settingsAIParse').click()");
  await until(() => m("document.querySelectorAll('.ai-import-row').length === 2"), "设置页没有拆出 2 条");
  assert.equal(await m("document.querySelector('#settingsAIImport').textContent"), "导入选中（2）");
  await m("document.querySelectorAll('.ai-import-check')[1].click()");
  assert.equal(await m("document.querySelector('#settingsAIImport').textContent"), "导入选中（1）");
  await m("document.querySelector('#settingsAIImport').click()");
  await until(async () => (await m("window.deskWeek.loadStore()")).items.length === 5, "设置页没有只导入 1 条");
  const settingsTitles = (await m("window.deskWeek.loadStore()")).items.map((item) => item.title);
  assert.ok(settingsTitles.includes("设置页导入一"), "应导入勾选的事项");
  assert.ok(!settingsTitles.includes("设置页导入二"), "未勾选的事项不应导入");
  assert.equal(await m("document.querySelectorAll('.ai-import-row').length"), 1, "未勾选的事项应保留在列表");
  console.log("AI_IMPORT_STEP settings ok");

  // 4. 管理端多条：一条日期非法时不能阻塞其他事项，修好后可继续导入。
  await m("document.querySelector('[data-section=tasks]').click()");
  await m("document.querySelector('#quickFocusButton').click()");
  await sleep(300);
  await m("document.querySelector('#managerAISourceText').value='MANAGER_INVALID 资料'; refreshManagerAIConfigHint(); document.querySelector('#managerAISummarizeButton').click()");
  await until(() => m("document.querySelectorAll('.ai-proposal-card').length === 3"), "管理端没有生成 3 条草稿");
  assert.equal(await m("document.querySelector('#managerAIResultBar').hidden"), false, "管理端结果条应可见");
  await m("document.querySelector('.ai-proposal-date').value='2026-13-40'");
  await m("document.querySelector('#managerAIImportResults').click()");
  await sleep(900);
  let stored = (await m("window.deskWeek.loadStore()")).items;
  assert.equal(stored.length, 7, "应导入 2 条合法事项，跳过 1 条非法日期");
  assert.equal(await m("document.querySelector('#managerAddDialog').open"), true, "有跳过项时对话框应保持打开");
  assert.match(await m("document.querySelector('#managerAIStatus').textContent"), /跳过 1 项/);
  const invalidCard = await m("document.querySelectorAll('.ai-proposal-card.is-invalid').length");
  assert.equal(invalidCard, 1, "非法事项应被标红");
  await m("document.querySelector('.ai-proposal-card.is-invalid .ai-proposal-date').value='2026-12-01'");
  await m("document.querySelector('#managerAIImportResults').click()");
  await until(async () => (await m("window.deskWeek.loadStore()")).items.length === 8, "修正日期后没有导入最后一条");
  assert.equal(await m("document.querySelector('#managerAddDialog').open"), false, "全部导入后对话框应关闭");

  assert.deepEqual(errors, [], "不应有渲染进程控制台错误");
  console.log("AI_IMPORT_PASS", JSON.stringify({ items: 8, checks: ["widget multi", "widget single", "settings selection", "invalid row skip", "retry after fix", "no console errors"] }));
  server.close();
  app.quit();
}).catch((error) => {
  console.error("AI_IMPORT_FAIL", error.stack);
  console.log("Console errors:", JSON.stringify(errors));
  try { server.close(); } catch { /* ignore */ }
  app.exit(1);
});
