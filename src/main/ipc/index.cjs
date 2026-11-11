"use strict";
const path = require("node:path");
const fs = require("node:fs");
const { fileURLToPath } = require("node:url");
const { createPaths } = require("../paths.cjs");

function registerIPC({ electron, windows, store, aiConfig, ai, updates, runtime, dataDir, root, sync }) {
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
  const qrSessions = new Map();
  const cameraUsers = new Set();
  const qrContents = new Set();
  const trackQrContents = contents => {
    if (qrContents.has(contents.id)) return;
    qrContents.add(contents.id);
    contents.once("destroyed", () => { qrSessions.delete(contents.id); cameraUsers.delete(contents.id); qrContents.delete(contents.id); });
  };
  const isCameraPage = contents => {
    try { return cameraUsers.has(contents?.id) && path.resolve(fileURLToPath(contents.getURL())) === paths.manager; }
    catch { return false; }
  };
  electron.session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(permission === "media" && isCameraPage(contents) && details.mediaTypes?.length > 0 && details.mediaTypes.every(type => type === "video"));
  });
  electron.session.defaultSession.setPermissionCheckHandler((contents, permission, _origin, details) =>
    permission === "media" && isCameraPage(contents) && details.mediaType !== "audio");
  handle("qr-camera-active", (event, enabled) => {
    if (path.resolve(fileURLToPath(event.senderFrame.url)) !== paths.manager) throw new Error("只有管理中心可以使用相机");
    if (enabled) { cameraUsers.add(event.sender.id); trackQrContents(event.sender); }
    else cameraUsers.delete(event.sender.id);
    return true;
  });
  handle("qr-export-start", async (event, legacy = false) => {
    const transfer = { frames: null };
    qrSessions.set(event.sender.id, transfer);
    trackQrContents(event.sender);
    const data = store.load();
    if (data.loadError) throw new Error("任务数据损坏，请先恢复数据");
    const frames = await require("../../renderer/shared/transfer/json-qr.js").frames(JSON.stringify({ initialized: true, items: data.items, prefs: data.prefs }), { legacy: legacy === true });
    if (qrSessions.get(event.sender.id) !== transfer) throw new Error("二维码已取消或重新生成");
    transfer.frames = frames;
    return { total: frames.length, count: data.items.length };
  });
  handle("qr-export-page", async (event, index) => {
    const frames = qrSessions.get(event.sender.id)?.frames;
    if (!frames || !Number.isInteger(index) || index < 0 || index >= frames.length) throw new Error("二维码页面无效，请重新生成");
    return await require("qrcode").toDataURL(frames[index], { scale: 6, margin: 4, errorCorrectionLevel: "M" });
  });
  handle("qr-export-close", event => { qrSessions.delete(event.sender.id); return true; });
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
  handle("sync-status", () => sync ? sync.status() : { running: false });
  handle("sync-toggle", async (_event, enabled) => {
    if (!sync) return { running: false };
    if (enabled) await sync.start();
    else sync.stop();
    return sync.status();
  });
  handle("sync-pending-approve", (_event, actorId) => {
    if (!sync) return { running: false };
    sync.approvePairing(String(actorId || ""));
    return sync.status();
  });
  handle("sync-pending-reject", (_event, actorId) => {
    if (!sync) return { running: false };
    sync.rejectPairing(String(actorId || ""));
    return sync.status();
  });
  handle("sync-forget-peer", (_event, actorId) => {
    if (!sync) return { running: false };
    sync.forgetPeer(String(actorId || ""));
    return sync.status();
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
