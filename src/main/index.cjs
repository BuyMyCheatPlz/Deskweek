"use strict";
const electron = require("electron");
const { app, BrowserWindow, screen, safeStorage, powerMonitor, Tray, Menu, nativeImage } = electron;
const path = require("node:path");
const fs = require("node:fs");
const { createPaths } = require("./paths.cjs");
const paths = createPaths();
const { createStore } = require("./storage/store.cjs");
const { createWindows } = require("./windows/windows.cjs");
const { sendToWindow } = require("./windows/lifecycle.cjs");
const { createWindowsShell } = require("./desktop/windows-shell.cjs");
const { createRuntime } = require("./runtime/runtime.cjs");
const { createAIConfig } = require("./ai/ai-config.cjs");
const { createAIService } = require("./ai/ai-service.cjs");
const { createUpdates } = require("./updates/update-controller.cjs");
const { registerIPC } = require("./ipc/index.cjs");

// Isolated profiles keep regression runs separate from the user's tasks.
const dataDir = process.env.DESKWEEK_DATA_DIR ? path.resolve(process.env.DESKWEEK_DATA_DIR) : path.join(app.isPackaged ? path.dirname(process.execPath) : paths.root, "data");
if (process.env.DESKWEEK_DATA_DIR) app.setPath("userData", path.join(dataDir, "profile"));
let windows, runtime, nativeShell, tray, updateTimer;

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", (_event, argv) => {
    if (argv.includes("--open-manager")) windows?.showManager();
    else windows?.focus();
    runtime?.refresh();
  });
  app.whenReady().then(() => {
    app.setAppUserModelId("com.xiaoxia.deskweek.float");
    const file = path.join(dataDir, "data.json");
    const legacy = path.join(app.getPath("userData"), "data.json");
    if (!fs.existsSync(file) && fs.existsSync(legacy)) {
      fs.mkdirSync(dataDir, { recursive: true }); fs.copyFileSync(legacy, file);
    }
    nativeShell = createWindowsShell(screen);
    windows = createWindows({ app, BrowserWindow, screen, shell: nativeShell, root: paths.root, dataDir,
      onStatus: () => refreshTray(),
      onWidgetLoaded: win => sendToWindow(win, "deskweek:runtime-state", runtime.state()),
      onManagerLoaded: win => { sendToWindow(win, "deskweek:update-state", updates.state()); sendToWindow(win, "deskweek:runtime-state", windows.managerRuntimeState(runtime.state())); },
    });
    const store = createStore({ file, onChange: payload => windows.broadcast("deskweek:store-changed", payload) });
    store.load();
    const aiConfig = createAIConfig({ portableDataDir: () => dataDir, safeStorage });
    const ai = createAIService(aiConfig);
    const updates = createUpdates({ windows, dataDir });
    runtime = createRuntime({ windows, shell: nativeShell, powerMonitor, onState: () => refreshTray() });
    registerIPC({ electron, windows, store, aiConfig, ai, updates, runtime, dataDir, root: paths.root });
    tray = new Tray(nativeImage.createFromPath(paths.tray).resize({ width: 16, height: 16 }));
    tray.setToolTip("DeskWeek"); tray.on("click", () => windows.showManager());
    function refreshTray() {
      if (!tray || tray.isDestroyed()) return;
      tray.setContextMenu(Menu.buildFromTemplate([
        { label: "管理中心", click: () => windows.showManager() },
        { label: "显示/隐藏浮窗", click: () => { windows.toggle(); runtime.refresh(); } },
        { label: "找回浮窗并重置位置", click: () => { windows.focus(); windows.reset(); runtime.refresh(); } },
        { label: `浮窗状态：${runtime?.state().paused ? "暂停刷新" : windows.status()}`, enabled: false },
        { type: "separator" }, { label: "退出", click: () => app.quit() },
      ]));
    }
    windows.init(); runtime.start(); refreshTray();
    if (process.argv.includes("--open-manager")) windows.showManager();
    updateTimer = setTimeout(() => updates.check().catch(error => console.warn("Update check:", error.message)), 1800); updateTimer.unref();
  }).catch(error => { console.error("Startup failed:", error); app.quit(); });
}
// Keep the tray alive when fullscreen policy unloads the last renderer.
app.on("window-all-closed", () => {});
app.on("before-quit", () => { clearTimeout(updateTimer); runtime?.stop(); windows?.stop(); nativeShell?.dispose(); if (tray && !tray.isDestroyed()) tray.destroy(); });
