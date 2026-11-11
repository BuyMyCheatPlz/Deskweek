"use strict";
// Real HWND fullscreen detection and real desktop windows on two physical monitors.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { app, screen } = require("electron");
const evidence = process.env.DESKWEEK_MULTI_EVIDENCE;
assert.ok(evidence, "Set DESKWEEK_MULTI_EVIDENCE to an isolated evidence directory");
fs.mkdirSync(evidence, { recursive: true });
process.env.DESKWEEK_DATA_DIR = fs.mkdtempSync(path.join(evidence, "desktop-profile-"));
const appRoot = process.env.DESKWEEK_APP_ROOT || path.resolve(__dirname, "..");
let fixture, fixtureReady = false, windows, desktop, runtime, nativeDetect, managerForDiagnostics;
const errors = [];
const watchdog = setTimeout(() => { console.error("MULTIMONITOR_FAIL test timed out"); fixture?.kill(); app.exit(1); }, 120000);
watchdog.unref();
app.on("will-quit", () => clearTimeout(watchdog));
const shellModule = require(path.join(appRoot, "src/main/desktop/windows-shell.cjs")), makeShell = shellModule.createWindowsShell;
shellModule.createWindowsShell = (...args) => {
  const shell = makeShell(...args), detect = shell.fullscreen;
  nativeDetect = detect;
  shell.fullscreen = (_pid, bounds) => fixture && fixture.exitCode === null ? detect(fixture.pid, bounds) : false;
  return shell;
};
const desktopModule = require(path.join(appRoot, "src/main/desktop/desktop.cjs")), makeDesktop = desktopModule.createDesktopManager;
desktopModule.createDesktopManager = (...args) => desktop = makeDesktop(...args);
const windowsModule = require(path.join(appRoot, "src/main/windows/windows.cjs")), makeWindows = windowsModule.createWindows;
windowsModule.createWindows = (...args) => windows = makeWindows(...args);
const runtimeModule = require(path.join(appRoot, "src/main/runtime/runtime.cjs")), makeRuntime = runtimeModule.createRuntime;
runtimeModule.createRuntime = (...args) => runtime = makeRuntime(...args);
const updateModule = require(path.join(appRoot, "src/main/updates/update-controller.cjs")), makeUpdates = updateModule.createUpdates;
updateModule.createUpdates = (...args) => { const updates = makeUpdates(...args); updates.check = async () => updates.state(); return updates; };
app.on("web-contents-created", (_event, contents) => {
  contents.on("preload-error", (_e, _p, error) => errors.push(error.message));
  contents.on("console-message", (_e, details) => { if (details?.level === "error") errors.push(details.message); });
  contents.on("render-process-gone", (_e, details) => { if (details.reason !== "clean-exit") errors.push(details.reason); });
});
require(path.join(appRoot, "src/main/index.cjs"));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const result = await fn(); if (result) return result; await sleep(100); }
  throw new Error(label);
}
const ready = win => win && !win.isDestroyed() && !win.webContents.isLoading() && win.isVisible();
const paused = win => win.webContents.executeJavaScript("window.DeskWeekRuntime.paused()");
function boundsOn(display) {
  const a = display.workArea;
  return { x: a.x + 40, y: a.y + 40, width: Math.min(1000, a.width - 80), height: Math.min(700, a.height - 80) };
}
async function startFullscreen(display) {
  fixtureReady = false;
  const env = { ...process.env, DESKWEEK_FULLSCREEN_DISPLAY_ID: String(display.id), DESKWEEK_FULLSCREEN_LIFETIME_MS: "90000" };
  delete env.ELECTRON_RUN_AS_NODE;
  fixture = spawn(process.execPath, [path.join(__dirname, "fixtures/fullscreen.cjs")], { env, stdio: ["ignore", "pipe", "pipe"] });
  fixture.once("error", error => errors.push(error.message));
  fixture.stdout.on("data", chunk => { process.stdout.write(chunk); if (chunk.toString().includes("FULLSCREEN_FIXTURE")) fixtureReady = true; });
  fixture.stderr.on("data", chunk => process.stderr.write(chunk));
  await until(() => fixtureReady, "Fullscreen fixture did not become ready");
}
async function stopFullscreen() {
  if (fixture && fixture.exitCode === null) {
    const current = fixture;
    const exited = new Promise(resolve => current.once("exit", resolve));
    current.kill(); await exited;
  }
  fixture = null;
}
app.whenReady().then(async () => {
  const displays = screen.getAllDisplays();
  assert.ok(displays.length >= 2, "This integration test requires two physical displays");
  const first = screen.getPrimaryDisplay(), second = displays.find(d => d.id !== first.id);
  let widget = await until(() => ready(windows.widget()) && windows.widget(), "Widget did not load");
  desktop.setBounds(widget, boundsOn(second), screen);
  const widgetId = widget.id;
  let manager = windows.showManager();
  managerForDiagnostics = manager;
  await until(() => ready(manager), "Manager did not load");
  await manager.webContents.executeJavaScript("window.deskWeek.onRuntimeState(s => window.__multiRuntimeState = s); true");
  manager.setBounds(boundsOn(second));
  await manager.webContents.executeJavaScript("window.deskWeek.replaceStore({items:[{id:'multi',title:'多屏回归任务',date:'',time:'',done:false}],prefs:{}})");
  await startFullscreen(first);
  runtime.refresh();
  await until(async () => !runtime.state().paused && !(await paused(widget)) && !(await paused(manager)), "Fullscreen on another monitor paused an uncovered window");
  // Exercise the original failure beyond the actual 15-second unload threshold.
  const end = Date.now() + 17500;
  while (Date.now() < end) {
    assert.equal(windows.widget()?.id, widgetId, "Uncovered widget was unloaded");
    assert.equal(runtime.state().paused, false);
    await sleep(250);
  }
  await manager.webContents.executeJavaScript("window.deskWeek.loadStore().then(s => window.deskWeek.editTask(s.items[0], {...s.items[0], title:'副屏持续更新成功'}))");
  await until(() => widget.webContents.executeJavaScript("document.body.textContent.includes('副屏持续更新成功')"), "Uncovered widget stopped rendering store changes");
  fs.writeFileSync(path.join(evidence, "uncovered-widget.png"), (await widget.webContents.capturePage()).toPNG());
  manager.setBounds(boundsOn(first)); runtime.refresh();
  await until(() => paused(manager), "Covered manager did not pause independently");
  assert.equal(await paused(widget), false);
  manager.setBounds(boundsOn(second)); runtime.refresh();
  await until(async () => !(await paused(manager)), "Manager failed to resume after moving to an uncovered display");
  console.log("PASS other-monitor fullscreen: visible widget survives grace and updates; manager follows its own monitor");
  await stopFullscreen();
  manager.setBounds(boundsOn(first));
  await startFullscreen(second);
  // The manager must actually be visible: Chromium separately pauses an
  // occluded renderer via document.hidden, even with native pause=false.
  manager.show(); manager.focus(); runtime.refresh();
  await until(() => paused(widget), "Same-monitor fullscreen did not pause widget");
  await until(async () => !(await paused(manager)), "Uncovered manager inherited widget pause");
  // Also check the initial state sent to a newly loaded manager while widget is paused.
  const closed = new Promise(resolve => manager.once("closed", resolve));
  manager.close(); await closed;
  manager = windows.showManager();
  managerForDiagnostics = manager;
  await until(() => ready(manager), "Replacement manager did not load");
  await until(async () => !(await paused(manager)), "New manager loaded with stale global pause");
  await manager.webContents.executeJavaScript("window.deskWeek.loadStore().then(s => window.deskWeek.editTask(s.items[0], {...s.items[0], title:'同屏休眠后恢复成功'}))");
  await until(() => !windows.widget(), "Covered widget was not released after grace", 23000);
  for (let i = 0; i < 3; i++) { runtime.refresh(); await sleep(100); assert.equal(windows.widget(), null, "Lost monitor bounds caused premature recreation"); }
  console.log("PASS same-monitor fullscreen: widget pauses/releases; uncovered manager remains active");
  await stopFullscreen(); runtime.refresh();
  widget = await until(() => ready(windows.widget()) && windows.widget(), "Widget did not restore after exiting fullscreen");
  await until(async () => !(await paused(widget)), "Restored widget remained paused");
  assert.equal(screen.getDisplayMatching(windows.widgetBounds()).id, second.id);
  await until(() => widget.webContents.executeJavaScript("document.body.textContent.includes('同屏休眠后恢复成功')"), "Restored widget lost latest task data");
  fs.writeFileSync(path.join(evidence, "restored-widget.png"), (await widget.webContents.capturePage()).toPNG());
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log("MULTIMONITOR_ALL_PASS", JSON.stringify({ displays: displays.map(d => ({ id: d.id, bounds: d.bounds, scaleFactor: d.scaleFactor })), widgetBounds: windows.widgetBounds(), status: windows.status(), checks: ["real scoped Win32 detection", "uncovered widget survives 17.5 seconds", "live task updates", "independent manager pause and move", "new manager initial state", "covered widget pause and release", "retained monitor while unloaded", "automatic restore and data retention"] }));
  app.quit();
}).catch(async error => {
  console.error("MULTIMONITOR_FAIL", error.stack || error);
  for (const [name, win] of [["widget", windows?.widget()], ["manager", managerForDiagnostics]]) {
    if (win && !win.isDestroyed()) console.log("WINDOW_DIAGNOSTICS", JSON.stringify({ name, bounds: name === "widget" ? windows.widgetBounds() : win.getBounds(), nativeFullscreen: fixture && nativeDetect(fixture.pid, name === "widget" ? windows.widgetBounds() : win.getBounds()), visible: win.isVisible(), state: await win.webContents.executeJavaScript("({paused: window.DeskWeekRuntime.paused(), hidden: document.hidden, native: window.__multiRuntimeState})") }));
  }
  await stopFullscreen(); app.exit(1);
});
