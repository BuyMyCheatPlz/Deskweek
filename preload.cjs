"use strict";
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("deskWeek", {
  quit: () => ipcRenderer.send("deskweek:quit"),
  setMiniMode: (enabled) => ipcRenderer.invoke("deskweek:set-mini-mode", Boolean(enabled)),
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
  loadStore: () => ipcRenderer.invoke("deskweek:store-load"),
  saveStore: (data) => ipcRenderer.invoke("deskweek:store-save", data),
  onStoreChanged: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on("deskweek:store-changed", listener);
    return () => ipcRenderer.removeListener("deskweek:store-changed", listener);
  },
  getAIConfig: () => ipcRenderer.invoke("deskweek:ai-config-get"),
  saveAIConfig: (config) => ipcRenderer.invoke("deskweek:ai-config-save", config),
  summarizeTask: (payload) => ipcRenderer.invoke("deskweek:ai-summarize", payload),
  getAutostart: () => ipcRenderer.invoke("deskweek:get-autostart"),
  setAutostart: (enabled) => ipcRenderer.invoke("deskweek:set-autostart", enabled),
  openDataFolder: () => ipcRenderer.invoke("deskweek:open-data-folder"),
});




