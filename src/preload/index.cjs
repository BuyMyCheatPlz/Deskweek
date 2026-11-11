"use strict";
const { contextBridge, ipcRenderer } = require("electron");

let base = { items: [], prefs: {}, revision: 0 }, pending = 0, failed = false, deferred = null, runtimeState = null;
const subscribers = new Set(), runtimeSubscribers = new Set();
const clone = value => JSON.parse(JSON.stringify(value));
function receive(data) {
  if (pending) { deferred = data; return; }
  base = clone(data);
  for (const callback of subscribers) callback(data);
}
ipcRenderer.on("deskweek:store-changed", (_event, data) => receive(data));
ipcRenderer.on("deskweek:runtime-state", (_event, data) => { runtimeState = data; for (const callback of runtimeSubscribers) callback(data); });
async function saveStore(data, replace = false) {
  const request = { base: clone(base), next: clone(data), replace };
  base = { ...clone(data), revision: base.revision };
  pending++;
  try {
    const saved = await ipcRenderer.invoke("deskweek:store-save", request);
    if (!deferred || saved.revision >= deferred.revision) deferred = saved;
    failed = false;
    return saved;
  } catch (error) {
    failed = true;
    const latest = await ipcRenderer.invoke("deskweek:store-load").catch(() => null);
    if (latest) deferred = latest;
    throw error;
  } finally {
    pending--;
    if (!pending && deferred) { const latest = deferred; deferred = null; receive(latest); }
  }
}

contextBridge.exposeInMainWorld("deskWeek", {
  quit: () => ipcRenderer.send("deskweek:quit"),
  setMiniMode: (enabled) => ipcRenderer.invoke("deskweek:set-mini-mode", Boolean(enabled)),
  sampleBackground: () => ipcRenderer.invoke("deskweek:sample-background"),
  focusSync: () => ipcRenderer.sendSync("deskweek:focus-sync"),
  dragStart: () => ipcRenderer.send("deskweek:drag-start"),
  resizeStart: (edge) => ipcRenderer.send("deskweek:resize-start", edge),
  gestureEnd: () => ipcRenderer.send("deskweek:gesture-end"),
  onGestureEnded: (callback) => ipcRenderer.on("deskweek:gesture-ended", () => callback()),
  openManager: () => ipcRenderer.send("deskweek:open-manager"),
  managerMinimize: () => ipcRenderer.send("deskweek:manager-minimize"),
  managerToggleMaximize: () => ipcRenderer.invoke("deskweek:manager-toggle-maximize"),
managerClose: () => ipcRenderer.send("deskweek:manager-close"),
  onManagerWindowState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("deskweek:manager-window-state", listener);
    return () => ipcRenderer.removeListener("deskweek:manager-window-state", listener);
  },
  loadStore: async () => { const data = await ipcRenderer.invoke("deskweek:store-load"); if (!pending) base = clone(data); return data; },
  startQrExport: legacy => ipcRenderer.invoke("deskweek:qr-export-start", Boolean(legacy)),
  qrExportPage: index => ipcRenderer.invoke("deskweek:qr-export-page", index),
  closeQrExport: () => ipcRenderer.invoke("deskweek:qr-export-close"),
  setQrCameraActive: enabled => ipcRenderer.invoke("deskweek:qr-camera-active", Boolean(enabled)),
  saveStore: (data) => saveStore(data),
  replaceStore: (data) => saveStore(data, true),
  editTask: async (before, after) => {
    pending++;
    try {
      const saved = await ipcRenderer.invoke("deskweek:store-edit", clone(before), clone(after));
      deferred = saved; failed = false; return saved;
    } catch (error) { failed = true; throw error; }
    finally { pending--; if (!pending && deferred) { const saved = deferred; deferred = null; receive(saved); } }
  },
  saveDraft: data => ipcRenderer.send("deskweek:draft-save", data),
  loadDraft: () => ipcRenderer.invoke("deskweek:draft-load"),
  canSuspend: () => !pending && !failed,
  runtimeReady: (data) => ipcRenderer.send("deskweek:runtime-ready", data),
  onRuntimeState: (callback) => { runtimeSubscribers.add(callback); if (runtimeState) callback(runtimeState); return () => runtimeSubscribers.delete(callback); },
  onStoreChanged: (callback) => {
    subscribers.add(callback);
    return () => subscribers.delete(callback);
  },
  getAIConfig: () => ipcRenderer.invoke("deskweek:ai-config-get"),
  syncStatus: () => ipcRenderer.invoke("deskweek:sync-status"),
  syncToggle: (enabled) => ipcRenderer.invoke("deskweek:sync-toggle", Boolean(enabled)),
  syncApprove: (actorId) => ipcRenderer.invoke("deskweek:sync-pending-approve", actorId),
  syncReject: (actorId) => ipcRenderer.invoke("deskweek:sync-pending-reject", actorId),
  syncForget: (actorId) => ipcRenderer.invoke("deskweek:sync-forget-peer", actorId),
  saveAIConfig: (config) => ipcRenderer.invoke("deskweek:ai-config-save", config),
  summarizeTask: (payload) => ipcRenderer.invoke("deskweek:ai-summarize", payload),
  openExternal: (url) => ipcRenderer.invoke("deskweek:open-external", url),
  checkForUpdates: () => ipcRenderer.invoke("deskweek:update-check"),
  getUpdateState: () => ipcRenderer.invoke("deskweek:update-state"),
  onUpdateState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("deskweek:update-state", listener);
    return () => ipcRenderer.removeListener("deskweek:update-state", listener);
  },
  downloadUpdate: () => ipcRenderer.invoke("deskweek:update-download"),
  onUpdateProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on("deskweek:update-progress", listener);
    return () => ipcRenderer.removeListener("deskweek:update-progress", listener);
  },
  getAutostart: () => ipcRenderer.invoke("deskweek:get-autostart"),
  setAutostart: (enabled) => ipcRenderer.invoke("deskweek:set-autostart", enabled),
  openDataFolder: () => ipcRenderer.invoke("deskweek:open-data-folder"),
});




