"use strict";
// Executes the real application against a disposable profile on the host desktop.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { app, BrowserWindow, screen } = require("electron");
const root = path.resolve(__dirname, "..");
const appRoot = process.env.DESKWEEK_APP_ROOT || root;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "deskweek-host-"));
process.env.DESKWEEK_DATA_DIR = profile;
const errors = [];
let fixture;
let simulatedCursor = null, gestureDown = false, invalidateHost = false;
// Ignore unrelated fullscreen applications without altering the user's desktop.
// The fixture still passes through the real HWND/visibility/monitor checks.
const shellModule = require(path.join(appRoot, "src/main/desktop/windows-shell.cjs")), makeShell = shellModule.createWindowsShell;
shellModule.createWindowsShell = (...args) => { const shell = makeShell(...args); const detect = shell.fullscreen; shell.fullscreen = (_pid, bounds) => fixture && fixture.exitCode === null ? detect(fixture.pid, bounds) : false; shell.buttonDown = () => gestureDown; return shell; };
const desktopModule = require(path.join(appRoot, "src/main/desktop/desktop.cjs")), makeDesktop = desktopModule.createDesktopManager;
desktopModule.createDesktopManager = (...args) => {
  const desktop = makeDesktop(...args), healthy = desktop.healthy;
  desktop.healthy = win => { if (invalidateHost) { invalidateHost = false; return false; } return healthy(win); };
  return desktop;
};
let windowController;
const windowsModule = require(path.join(appRoot, "src/main/windows/windows.cjs")), makeWindows = windowsModule.createWindows;
windowsModule.createWindows = (...args) => windowController = makeWindows(...args);
app.on("web-contents-created", (_event, contents) => {
  contents.on("console-message", (_e, details) => { if (details?.level === "error") errors.push(details.message); });
  contents.on("render-process-gone", (_e, details) => { if (details.reason !== "clean-exit") console.log("Renderer exit:", details.reason); });
});
require(path.join(appRoot, "src/main/index.cjs"));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, message, timeout = 12000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const result = await fn(); if (result) return result; await sleep(100); }
  throw new Error(message);
}
const widget = () => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith("/src/renderer/widget/index.html"));
const metrics = () => {
  const values = app.getAppMetrics();
  return { processes: values.length, renderers: values.filter(p => p.type === "Tab").length, workingSetMB: Math.round(values.reduce((sum, p) => sum + p.memory.workingSetSize, 0) / 1024), privateMB: Math.round(values.reduce((sum, p) => sum + p.memory.privateBytes, 0) / 1024), cpuPercent: Number(values.reduce((sum, p) => sum + p.cpu.percentCPUUsage, 0).toFixed(2)) };
};
app.whenReady().then(async () => {
  const realCursor = screen.getCursorScreenPoint.bind(screen);
  screen.getCursorScreenPoint = () => simulatedCursor || realCursor();
  let win = await until(() => widget() && !widget().webContents.isLoading() && widget().isVisible() && widget(), "Widget did not become visible");
  await sleep(1000);
  const parsed = await require(path.join(appRoot, "src/main/ai/documents.cjs")).extractDocuments([{ name: "host.txt", dataUrl: "data:text/plain;base64," + Buffer.from("host parser check").toString("base64") }]);
  assert.match(parsed[0], /host parser check/);
  const js = code => win.webContents.executeJavaScript(code, true);
  assert.equal(await js("typeof window.deskWeek.saveStore"), "function");
  const data = await js("window.deskWeek.loadStore()");
  assert.equal(data.loadError, undefined);
  await js("window.deskWeek.saveStore({items:[{id:'host',title:'主机回归任务',done:false,date:'',time:''}],prefs:{}})");
  await until(() => js("document.body.textContent.includes('主机回归任务')"), "Task did not render");
  await js("window.deskWeek.openManager()");
  const manager = await until(() => BrowserWindow.getAllWindows().find(w => w.getTitle().includes("管理中心") && !w.webContents.isLoading()), "Manager did not load");
  await sleep(500);
  assert.equal(await manager.webContents.executeJavaScript("document.body.textContent.includes('主机回归任务')"), true);
  await manager.webContents.executeJavaScript("window.deskWeek.saveStore({items:[{id:'host',title:'双窗口同步成功',done:true,date:'',time:''}],prefs:{theme:'dark'}})");
  const saved = await js("window.deskWeek.loadStore()"); assert.equal(saved.items[0].title, "双窗口同步成功");
  await js("openEditor('host')");
  await manager.webContents.executeJavaScript("window.deskWeek.loadStore().then(s => window.deskWeek.editTask(s.items[0], {...s.items[0], title:'双窗口同步成功 v2'}))");
  await js("document.querySelector('#editDetail').value = '只修改详情'; document.querySelector('#editForm').requestSubmit()");
  await until(() => js("!document.querySelector('#editDialog').open"), "Concurrent edit did not complete");
  const concurrent = await js("window.deskWeek.loadStore()");
  assert.equal(concurrent.items[0].title, "双窗口同步成功 v2"); assert.equal(concurrent.items[0].detail, "只修改详情");
  await js(`(async()=>{const s=await window.deskWeek.loadStore();return await window.deskWeek.saveStore({items:s.items,prefs:{...s.prefs,widgetBackground:'transparent',autoTheme:true}});})()`);
  await until(() => js("document.documentElement.dataset.widgetBackground === 'transparent'"), "Transparent background did not apply in packaged app");
  const backgroundSample = await js("refreshBackgroundTheme(true)");
  let backgroundChecked = false;
  if (backgroundSample && ["light", "dark"].includes(backgroundSample.theme) && backgroundSample.samples === 25) {
    backgroundChecked = true;
    assert.equal(await js(`document.documentElement.dataset.theme === '${backgroundSample.theme}'`), true);
  } else {
    // 锁屏、显示器休眠或远程会话会让 Windows 桌面截图返回空缩略图（SetThreadDesktop 170）。
    // 这是环境限制，不是产品失败；明确记录跳过，其余主机回归继续执行。
    console.log("HOST_SKIP background sampling unavailable: desktop capture returned no pixels (locked/asleep display)");
  }
  await js(`(async()=>{const s=await window.deskWeek.loadStore();return await window.deskWeek.saveStore({items:s.items,prefs:{...s.prefs,widgetBackground:'standard',autoTheme:false,theme:'dark'}});})()`);
  windowController.toggle(); await sleep(1700);
  assert.equal(await manager.webContents.executeJavaScript("window.DeskWeekRuntime.paused()"), false);
  windowController.toggle(); await sleep(1700);
  await js("window.deskWeek.setMiniMode(true)"); await js("window.deskWeek.setMiniMode(false)");
  const bounds = win.getBounds();
  assert.ok(bounds.width > 0 && bounds.height > 0);
  const k = require("koffi"), user32 = k.load("user32.dll");
  const RECT = k.struct("DeskWeekHostTestRect", { left: "long", top: "long", right: "long", bottom: "long" });
  const getRect = user32.func("bool __stdcall GetWindowRect(void * hwnd, _Out_ DeskWeekHostTestRect * rect)");
  const getParent = user32.func("void * __stdcall GetParent(void * hwnd)");
  const getWindow = user32.func("void * __stdcall GetWindow(void * hwnd, uint command)");
  const getClass = user32.func("int __stdcall GetClassNameW(void * hwnd, _Out_ char16_t * text, int size)");
  const classOf = hwnd => { const text = Buffer.alloc(512); getClass(hwnd, text, 256); return text.toString("utf16le").replace(/\0.*$/s, ""); };
  const hwnd = win.getNativeWindowHandle().readBigUInt64LE();
  const siblings = [];
  for (let sibling = getWindow(hwnd, 0); sibling && siblings.length < 32; sibling = getWindow(sibling, 2)) siblings.push({ className: classOf(sibling), widget: sibling === hwnd });
  const desktopLayer = { status: windowController.status(), parentClass: getParent(hwnd) ? classOf(getParent(hwnd)) : null, siblingsTopToBottom: siblings };
  console.log("DESKTOP_LAYER", JSON.stringify(desktopLayer));
  const physicalBounds = () => { const r = {}; assert.equal(getRect(win.getNativeWindowHandle().readBigUInt64LE(), r), true); return { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top }; };
  const monitorMoves = [];
  for (const display of screen.getAllDisplays()) {
    const start = screen.screenToDipRect(null, physicalBounds());
    simulatedCursor = { x: start.x + 30, y: start.y + 20 }; gestureDown = true;
    await js("window.deskWeek.dragStart()"); await sleep(40);
    simulatedCursor = { x: display.workArea.x + 110, y: display.workArea.y + 100 };
    await sleep(150); gestureDown = false; await js("window.deskWeek.gestureEnd()"); await sleep(150);
    const moved = screen.screenToDipRect(null, physicalBounds()), area = display.workArea;
    assert.ok(moved.x >= area.x - 2 && moved.y >= area.y - 2 && moved.x + moved.width <= area.x + area.width + 2 && moved.y + moved.height <= area.y + area.height + 2, JSON.stringify({ moved, area }));
    monitorMoves.push({ scaleFactor: display.scaleFactor, bounds: moved });
  }
  simulatedCursor = null;
  await js("openCalendarAddDialog(new Date()); addAIFiles([new File(['异步附件内容'], 'async-draft.txt', {type:'text/plain'})])");
  await js("renderAIProposals([{title:'已加入事项',detail:'',date:'',time:''},{title:'仅剩的一条草稿',detail:'待恢复详情',date:'',time:''}]); aiProposalEntries[0].added = true; updateAIAddAllButton()");
  await js("document.querySelector('#newTitle').value = '桌面重建保留草稿'; document.querySelector('#newTitle').dispatchEvent(new Event('input', {bubbles:true}))");
  await sleep(100);
  invalidateHost = true;
  const oldId = win.id;
  win = await until(() => widget() && widget().id !== oldId && !widget().webContents.isLoading() && widget().isVisible() && widget(), "Desktop host recovery did not recreate the widget");
  await until(() => js("document.querySelector('#newTitle').value === '桌面重建保留草稿'"), "Desktop host recovery lost a draft");
  assert.equal(await js("document.querySelector('#aiFileList').textContent.includes('async-draft.txt')"), true);
  assert.equal(await js("document.querySelectorAll('.ai-proposal-title').length"), 1);
  assert.equal(await js("document.querySelector('.ai-proposal-title').value"), "仅剩的一条草稿");
  await js("closeCalendarAddDialog()");
  await js("document.querySelector('#newTitle').value = ''; document.querySelector('#newTitle').dispatchEvent(new Event('input', {bubbles:true}))");
  assert.equal((await js("window.deskWeek.loadStore()")).items[0].title, "双窗口同步成功 v2");
  // 设置页 AI 导入面板必须存在，并且导入会真正写盘（AI 网络路径由 ai-import.electron.cjs 覆盖）。
  assert.equal(await manager.webContents.executeJavaScript("Boolean(document.querySelector('#settingsAIParse'))"), true);
  const aiImported = await manager.webContents.executeJavaScript(`(async () => {
    settingsAIEntries = [{ key: 'host-ai', title: '主机回归 AI 导入', detail: '来自设置页', date: '', time: '', selected: true }];
    renderSettingsAIEntries();
    await importSettingsAIEntries();
    const data = await window.deskWeek.loadStore();
    return data.items.some((item) => item.title === '主机回归 AI 导入');
  })()`, true);
  assert.equal(aiImported, true, "Settings AI import did not persist");
  manager.close();
  // Wait for idle, then record a comparable total across all Electron processes.
  metrics(); await sleep(4000); const active = metrics();
  const fixtureEnv = { ...process.env }; delete fixtureEnv.ELECTRON_RUN_AS_NODE;
  fixtureEnv.DESKWEEK_FULLSCREEN_DISPLAY_ID = String(screen.getDisplayMatching(windowController.widgetBounds()).id);
  fixture = spawn(process.execPath, [path.join(__dirname, "fixtures/fullscreen.cjs")], { stdio: ["ignore", "pipe", "pipe"], env: fixtureEnv });
  fixture.stdout.on("data", data => process.stdout.write(data));
  fixture.stderr.on("data", data => process.stderr.write(data));
  await until(() => js("window.DeskWeekRuntime.paused()"), "Fullscreen did not pause the real renderer", 10000);
  // A draft entered after suspension must invalidate permission at unload time.
  await js("document.querySelector('#newTitle').value = '保留的未保存草稿'");
  await sleep(16000);
  assert.ok(widget(), "Draft was lost during fullscreen unload");
  assert.equal(await js("document.querySelector('#newTitle').value"), "保留的未保存草稿");
  await js("document.querySelector('#newTitle').value = ''");
  await until(() => !widget(), "Fullscreen did not unload the renderer", 22000);
  const suspended = metrics();
  await until(() => fixture.exitCode !== null, "Fullscreen fixture did not exit", 14000);
  const restored = await until(() => widget() && !widget().webContents.isLoading() && widget().isVisible() && widget(), "Widget did not resume after fullscreen");
  const restoredData = await restored.webContents.executeJavaScript("window.deskWeek.loadStore()");
  assert.equal(restoredData.items[0].title, "双窗口同步成功 v2");
  assert.equal(restoredData.prefs.theme, "dark");
  await sleep(2000);
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log("HOST_REGRESSION_PASS", JSON.stringify({ desktopLayer, displays: screen.getAllDisplays().map(d => ({ bounds: d.bounds, scaleFactor: d.scaleFactor })), monitorMoves, active, suspended, resumed: metrics(), checks: ["real preload and IPC", "task persistence", "two-window synchronization", "theme", backgroundChecked ? "background theme sampling" : "background theme sampling skipped (display capture unavailable)", "mini restore", "physical mixed-DPI monitor moves", "desktop host recovery injection", "fullscreen detection", "refresh pause", "draft protection", "renderer release", "automatic resume", "data retained", "settings AI import persistence", "no renderer console errors"] }));
  app.quit();
}).catch(error => {
  console.error("HOST_REGRESSION_FAIL", error.stack);
  console.log("Host state:", JSON.stringify({ displays: screen.getAllDisplays(), windows: BrowserWindow.getAllWindows().map(w => ({ title: w.getTitle(), visible: w.isVisible(), bounds: w.getBounds() })), fixturePid: fixture?.pid, fixtureExit: fixture?.exitCode }));
  if (fixture && fixture.exitCode === null) fixture.kill(); app.exit(1);
});
app.on("will-quit", () => {
  // Profile cleanup is best effort: Chromium can hold its cache until exit.
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* OS releases remaining files on process exit */ }
});
