"use strict";
const path = require("node:path");
const fs = require("node:fs");
const { fileURLToPath } = require("node:url");
const { createPaths } = require("../paths.cjs");

function registerIPC({ electron, windows, store, aiConfig, ai, updates, runtime, dataDir, root }) {
  const { app, ipcMain, BrowserWindow, shell, desktopCapturer } = electron;
  const paths = createPaths(root);
  function trusted(event) {
    try {
      const frame = event.senderFrame;
      return frame === event.sender.mainFrame && [paths.widget, paths.manager].includes(path.resolve(fileURLToPath(frame.url)));
    } catch { return false; }
  }
  const handle = (name, fn) => ipcMain.handle(`deskweek:${name}`, (event, ...args) => {
    if (!trusted(event)) throw new Error("不受信任的窗口");
    return fn(event, ...args);
  });
  const on = (name, fn) => ipcMain.on(`deskweek:${name}`, (event, ...args) => { if (trusted(event)) fn(event, ...args); });
  handle("store-load", () => store.load());
  handle("store-save", (_event, request) => store.save(request));
  handle("store-edit", (_event, before, after) => store.edit(before, after));
  handle("draft-load", event => windows.isWidgetSender(event.sender) ? windows.loadDraft() : null);
  on("draft-save", (event, value) => { if (windows.isWidgetSender(event.sender)) windows.saveDraft(value); });
  handle("set-mini-mode", (event, enabled) => windows.isWidgetSender(event.sender) ? windows.setMini(Boolean(enabled)) : { enabled: false });
  handle("sample-background", event => windows.isWidgetSender(event.sender) ? windows.sampleBackground(desktopCapturer) : null);
  on("quit", () => app.quit());
  on("drag-start", event => { if (windows.isWidgetSender(event.sender)) windows.beginGesture("move"); });
  on("resize-start", (event, edge) => { if (windows.isWidgetSender(event.sender)) windows.beginGesture(edge); });
  on("gesture-end", event => { if (windows.isWidgetSender(event.sender)) windows.endGesture(); });
  on("runtime-ready", (event, data) => runtime.ready(event, data));
  on("open-manager", () => windows.showManager());
  on("manager-minimize", event => BrowserWindow.fromWebContents(event.sender)?.minimize());
  on("manager-close", event => BrowserWindow.fromWebContents(event.sender)?.close());
  handle("manager-toggle-maximize", event => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return false;
    if (win.isMaximized()) win.unmaximize(); else win.maximize();
    return win.isMaximized();
  });
  handle("ai-config-get", () => aiConfig.publicAIConfig());
  handle("ai-config-save", (_event, next) => aiConfig.saveAIConfig(next));
  handle("ai-summarize", (_event, payload) => ai.summarizeWithAI(payload));
  handle("update-state", () => updates.state());
  handle("update-check", () => updates.check());
  handle("update-download", event => updates.install(event));
  handle("open-external", async (_event, value) => {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:" || !["github.com", "space.bilibili.com"].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) throw new Error("链接地址不受支持");
    await shell.openExternal(url.toString()); return true;
  });
  handle("show-update-file", (_event, file) => {
    const dir = path.resolve(dataDir, "updates") + path.sep, resolved = path.resolve(String(file || ""));
    if (!resolved.startsWith(dir) || !fs.existsSync(resolved)) throw new Error("更新文件不存在");
    shell.showItemInFolder(resolved); return true;
  });
  handle("get-autostart", () => app.getLoginItemSettings().openAtLogin);
  handle("set-autostart", (_event, enabled) => {
    if (!app.isPackaged) throw new Error("开发模式不设置开机启动，请使用打包版本");
    app.setLoginItemSettings({ openAtLogin: Boolean(enabled), path: process.execPath });
    return app.getLoginItemSettings().openAtLogin;
  });
  handle("open-data-folder", async () => { fs.mkdirSync(dataDir, { recursive: true }); return await shell.openPath(dataDir) || ""; });
  ipcMain.on("deskweek:focus-sync", event => { if (trusted(event)) windows.focusSync(event.sender); event.returnValue = true; });
}
module.exports = { registerIPC };
