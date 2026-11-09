"use strict";
const path = require("node:path");
const fs = require("node:fs");
const { createPaths } = require("../paths.cjs");
const { createDesktopManager } = require("../desktop/desktop.cjs");
const { fitBounds, resizeBounds, RESIZE_EDGES } = require("./geometry.cjs");
const { writeAtomic } = require("../storage/store.cjs");
const { liveContents, sendToWindow, onWindowLoaded } = require("./lifecycle.cjs");
function managerRuntimeState(state) { return { ...state, paused: state.paused && state.reason !== "hidden", releaseRequested: false }; }

function createWindows({ app, BrowserWindow, screen, shell, root, dataDir, onStatus = () => {}, onWidgetLoaded = () => {}, onManagerLoaded = () => {} }) {
  const paths = createPaths(root);
  const desktop = createDesktopManager();
  const stateFile = path.join(dataDir, "window-state.json");
  let widget, mini = false, preMini, normalBounds, hidden = false, gesture, gestureTimer, displayTimer;
  let stopping = false, status = "正在启动", fallbackRetry = 0, draft = null;
  const managers = new Set();
  function fit(bounds, manager = false) {
    const primary = screen.getPrimaryDisplay();
    const displays = [primary, ...screen.getAllDisplays().filter(display => display.id !== primary.id)];
    if (manager) return fitBounds(bounds, displays, { x: displays[0].workArea.x + 40, y: displays[0].workArea.y + 40, width: 1120, height: 760 }, { minWidth: 900, minHeight: 620, maxWidth: 10000, maxHeight: 10000 });
    return fitBounds(bounds, displays, { x: primary.workArea.x + 80, y: primary.workArea.y + 80, width: 880, height: 690 });
  }
  function getBounds() {
    try { return desktop.getBounds(widget, screen); } catch { return normalBounds; }
  }
  function persist() {
    if (widget && !widget.isDestroyed() && !mini) normalBounds = fit(getBounds());
    try { if (normalBounds) writeAtomic(stateFile, JSON.stringify(normalBounds)); } catch (error) { console.warn("Window state:", error.message); }
  }
  function attach() {
    if (!widget || widget.isDestroyed()) return;
    const result = desktop.apply(widget, "desktop", { initialShape: "card" });
    status = result.desktopStatus === "attached" ? "桌面层" : `兼容窗口：${result.desktopMessage}`;
    onStatus(status);
    fallbackRetry = Date.now() + 30000;
  }
  function createWidget() {
    if (stopping || hidden || (widget && !widget.isDestroyed())) return widget;
    if (!normalBounds) {
      try { normalBounds = JSON.parse(fs.readFileSync(stateFile, "utf8")); } catch { /* first run */ }
      normalBounds = fit(normalBounds);
    }
    mini = false; preMini = null;
    const bounds = fit(normalBounds);
    widget = new BrowserWindow({ ...bounds, minWidth: Math.min(420, bounds.width), minHeight: Math.min(280, bounds.height), maxWidth: 1600, maxHeight: 1000,
      frame: false, thickFrame: false, transparent: true, backgroundColor: "#00000000", resizable: false, maximizable: false, minimizable: false, fullscreenable: false,
      hasShadow: false, skipTaskbar: true, show: false, title: "DeskWeek",
      webPreferences: { preload: paths.preload, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: true },
    });
    const win = widget;
    win.setMenu(null);
    win.loadFile(paths.widget);
    onWindowLoaded(win, () => !stopping && widget === win, onWidgetLoaded);
    win.once("ready-to-show", () => {
      if (stopping || widget !== win || !liveContents(win) || hidden) return;
      win.showInactive(); attach();
      // Restore using physical geometry after SetParent, including negative origins.
      desktop.setBounds(win, fit(mini ? getBounds() : normalBounds), screen);
    });
    win.on("closed", () => { desktop.release(win); if (widget === win) widget = null; });
    win.webContents.on("render-process-gone", () => {
      if (stopping || widget !== win) return;
      releaseWidget();
      setTimeout(() => createWidget(), 1000).unref();
    });
    return win;
  }
  function releaseWidget(preserve = true) {
    endGesture();
    if (!widget || widget.isDestroyed()) return;
    if (preserve) persist();
    const win = widget; widget = null;
    desktop.release(win); win.destroy();
  }
  function setMini(enabled) {
    if (!widget || widget.isDestroyed() || mini === enabled) return { enabled: mini };
    if (enabled) {
      preMini = fit(getBounds()); normalBounds = preMini; mini = true;
      const a = screen.getDisplayMatching(preMini).workArea;
      desktop.setBounds(widget, fitBounds({ x: a.x + a.width - 436, y: a.y + a.height - 316, width: 420, height: 300 }, [{ workArea: a }]), screen);
    } else {
      mini = false;
      desktop.setBounds(widget, fit(preMini || normalBounds), screen); preMini = null;
    }
    persist();
    return { enabled: mini };
  }
  function showManager() {
    let win = [...managers].find(w => !w.isDestroyed() && shell.isCurrent(w) !== false);
    if (!win) {
      const bounds = fit(null, true);
      win = new BrowserWindow({ ...bounds, minWidth: Math.min(900, bounds.width), minHeight: Math.min(620, bounds.height), frame: false, thickFrame: true,
        backgroundColor: "#f5f7fa", show: false, title: "DeskWeek 管理中心",
        webPreferences: { preload: paths.preload, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: true },
      });
      const created = win;
      managers.add(created); created.setMenu(null); created.loadFile(paths.manager);
      onWindowLoaded(created, () => !stopping && managers.has(created), onManagerLoaded);
      const emit = () => { if (liveContents(created)) sendToWindow(created, "deskweek:manager-window-state", { maximized: created.isMaximized() }); };
      created.on("maximize", emit); created.on("unmaximize", emit);
      created.once("ready-to-show", () => { if (!stopping && managers.has(created) && liveContents(created)) created.show(); });
      created.on("closed", () => managers.delete(created));
    } else { if (!win.isMaximized()) win.setBounds(fit(win.getBounds(), true)); win.show(); win.focus(); }
    return win;
  }
  function endGesture() {
    clearInterval(gestureTimer); gestureTimer = null;
    if (gesture && widget && !widget.isDestroyed()) {
      try { desktop.setShape(widget, "card"); sendToWindow(widget, "deskweek:gesture-ended"); } catch { /* desktop can disappear mid-drag */ }
      persist();
    }
    gesture = null;
  }
  function beginGesture(kind) {
    if (!widget || widget.isDestroyed() || (kind !== "move" && !RESIZE_EDGES.has(kind))) return;
    endGesture();
    gesture = { kind, bounds: getBounds(), cursor: screen.getCursorScreenPoint(), last: null };
    if (kind !== "move") { try { desktop.setShape(widget, "rect"); } catch { endGesture(); return; } }
    gestureTimer = setInterval(() => {
      try {
        if (!widget || widget.isDestroyed() || !shell.buttonDown()) return endGesture();
        const cursor = screen.getCursorScreenPoint(), g = gesture;
        if (g.last && cursor.x === g.last.x && cursor.y === g.last.y) return;
        g.last = cursor;
        const delta = { x: cursor.x - g.cursor.x, y: cursor.y - g.cursor.y };
        const bounds = kind === "move" ? fitBounds({ ...g.bounds, x: g.bounds.x + delta.x, y: g.bounds.y + delta.y }, [screen.getDisplayNearestPoint(cursor)]) : resizeBounds(g.bounds, delta, kind, screen.getAllDisplays());
        desktop.setBounds(widget, bounds, screen, { reshape: false });
        if (!mini) normalBounds = bounds;
      } catch (error) { console.warn("Gesture:", error.message); endGesture(); }
    }, 16);
  }
  function recoverDisplays() {
    endGesture();
    normalBounds = fit(normalBounds);
    if (preMini) preMini = fit(preMini);
    if (widget && !widget.isDestroyed()) {
      if (!desktop.healthy(widget)) { releaseWidget(false); createWidget(); }
      else desktop.setBounds(widget, fit(getBounds()), screen);
    }
    for (const win of managers) if (!win.isDestroyed() && !win.isMaximized()) win.setBounds(fit(win.getBounds(), true));
    persist();
  }
  const displayChanged = () => { clearTimeout(displayTimer); displayTimer = setTimeout(recoverDisplays, 300); };
  return {
    createWidget, showManager, setMini, beginGesture, endGesture, releaseWidget,
    restoreWidget: createWidget,
    status: () => status,
    managerRuntimeState,
    saveDraft(value) { draft = value ? { ...value, assets: value.assets || draft?.assets } : null; },
    loadDraft: () => draft,
    widget: () => widget,
    isWidgetSender: sender => Boolean(widget && !widget.isDestroyed() && widget.webContents === sender),
    isHidden: () => hidden,
    init() { for (const event of ["display-added", "display-removed", "display-metrics-changed"]) screen.on(event, displayChanged); createWidget(); },
    toggle() { hidden = !hidden; if (hidden) { endGesture(); widget?.hide(); } else { createWidget(); if (widget) { shell.moveToCurrent(widget); widget.showInactive(); } } },
    reset() { normalBounds = fit(null); preMini = normalBounds; if (widget) desktop.setBounds(widget, normalBounds, screen); else createWidget(); persist(); },
    focus() { hidden = false; createWidget(); if (widget) { shell.moveToCurrent(widget); widget.showInactive(); desktop.focus(widget); } },
    notifyRuntime(state) {
      for (const win of [widget, ...managers]) sendToWindow(win, "deskweek:runtime-state", win === widget ? state : managerRuntimeState(state));
    },
    broadcast(channel, payload) {
      for (const win of [widget, ...managers]) sendToWindow(win, channel, payload);
    },
    focusSync(sender) { if (widget && !widget.isDestroyed() && widget.webContents === sender) { desktop.focus(widget); widget.webContents.focus(); } },
    checkDesktop() {
      if (!widget || widget.isDestroyed()) return;
      if (!desktop.healthy(widget)) { releaseWidget(false); createWidget(); }
      else if (!desktop.isAttached(widget)) {
        if (shell.isCurrent(widget) === false) shell.moveToCurrent(widget);
        if (Date.now() > fallbackRetry) attach();
      }
    },
    stop() {
      stopping = true; persist(); endGesture(); clearTimeout(displayTimer);
      for (const event of ["display-added", "display-removed", "display-metrics-changed"]) screen.removeListener(event, displayChanged);
    },
  };
}
module.exports = { createWindows, managerRuntimeState };
