"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function harness({ fullscreen = () => false } = {}) {
  const all = [], loaded = [];
  class Window extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.dead = false; this.messages = [];
      this.contents = new EventEmitter(); this.contents.dead = false;
      this.contents.isDestroyed = () => this.contents.dead;
      this.contents.send = (channel, payload) => { if (this.dead || this.contents.dead) throw new TypeError("Object has been destroyed"); this.messages.push({ channel, payload }); };
      all.push(this);
    }
    get webContents() { if (this.dead) throw new TypeError("Object has been destroyed"); return this.contents; }
    isDestroyed() { return this.dead; }
    setMenu() {}
    loadFile() { return Promise.resolve(); }
    showInactive() {}
    show() {}
    getBounds() { const { x, y, width, height } = this.options; return { x, y, width, height }; }
    destroy() { this.dead = true; this.contents.dead = true; this.emit("closed"); }
  }
  const desktop = { apply: () => ({ desktopStatus: "attached" }), release() {}, setBounds: (win, bounds) => Object.assign(win.options, bounds), getBounds: win => win.getBounds(), healthy: () => false };
  const base = path.resolve(__dirname, "../src/main/windows");
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(base, "windows.cjs"), "utf8"), {
    module, console, Buffer, Date, setTimeout, clearTimeout, setInterval, clearInterval,
    require: name => name === "../desktop/desktop.cjs" ? { createDesktopManager: () => desktop }
      : name === "node:fs" ? { readFileSync() { throw new Error("First run"); } }
      : name === "../storage/store.cjs" ? { writeAtomic() {} }
      : name.startsWith(".") ? require(path.resolve(base, name)) : require(name),
  });
  const display = { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1080 } };
  const windows = module.exports.createWindows({ app: {}, BrowserWindow: Window, root: path.resolve(__dirname, ".."), dataDir: "unused",
    screen: { getPrimaryDisplay: () => display, getAllDisplays: () => [display], removeListener() {}, getDisplayMatching: () => display }, shell: { isCurrent: () => true, fullscreen },
    onWidgetLoaded: win => { win.webContents.send("state"); loaded.push(win); },
    onManagerLoaded: win => { win.webContents.send("state"); loaded.push(win); },
  });
  return { windows, all, loaded };
}

test("resume load callback is ignored after a reentrant pause destroys its window", () => {
  const { windows, loaded } = harness();
  const win = windows.createWidget(), contents = win.webContents;
  // EventEmitter snapshots listeners: removing one during dispatch alone does
  // not prevent an already queued load callback from firing.
  contents.prependOnceListener("did-finish-load", () => windows.releaseWidget());
  assert.doesNotThrow(() => contents.emit("did-finish-load"));
  assert.equal(loaded.length, 0);
});

test("destroyed renderer and stopped controller do not receive load notifications", () => {
  for (const mode of ["renderer", "stop"]) {
    const { windows, loaded } = harness();
    const win = windows.createWidget(), contents = win.webContents;
    if (mode === "renderer") contents.dead = true;
    else windows.stop();
    assert.doesNotThrow(() => contents.emit("did-finish-load"));
    assert.equal(loaded.length, 0);
  }
});

test("late old-window load cannot interfere with the replacement widget", () => {
  const { windows, loaded } = harness();
  const old = windows.createWidget(), pending = old.webContents.listeners("did-finish-load")[0];
  windows.releaseWidget();
  const current = windows.restoreWidget();
  assert.doesNotThrow(() => pending());
  current.webContents.emit("did-finish-load");
  assert.deepEqual(loaded, [current]);
});

test("manager close during load is guarded too", () => {
  const { windows, loaded } = harness();
  const manager = windows.showManager(), contents = manager.webContents;
  contents.prependOnceListener("did-finish-load", () => manager.destroy());
  assert.doesNotThrow(() => contents.emit("did-finish-load"));
  assert.equal(loaded.length, 0);
});

test("runtime and store broadcasts skip a destroyed renderer", () => {
  const { windows } = harness();
  const win = windows.createWidget();
  win.webContents.dead = true;
  assert.doesNotThrow(() => windows.notifyRuntime({ paused: true, reason: "fullscreen" }));
  assert.doesNotThrow(() => windows.broadcast("deskweek:store-changed", {}));
});

test("each manager follows its own monitor even when the widget state stays unchanged", () => {
  const { windows } = harness({ fullscreen: (_pid, bounds) => bounds.x >= 0 });
  const widget = windows.createWidget(), manager = windows.showManager();
  const state = { paused: true, reason: "fullscreen", token: 1 };
  manager.options.x = -1800;
  windows.notifyRuntime(state);
  assert.equal(widget.messages.at(-1).payload.paused, true);
  assert.equal(manager.messages.at(-1).payload.paused, false);
  assert.equal(windows.managerRuntimeState(state, manager).paused, false, "Initial manager load also uses its own screen");
  manager.options.x = 80;
  windows.notifyRuntime(state);
  assert.equal(manager.messages.at(-1).payload.paused, true);
  const count = manager.messages.length;
  windows.notifyRuntime(state);
  assert.equal(manager.messages.length, count, "Unchanged states do not spam IPC");
  windows.notifyRuntime({ paused: false, reason: "active", token: 2 });
  assert.equal(manager.messages.at(-1).payload.paused, true, "Widget activity must not resume a covered manager");
  windows.notifyRuntime({ paused: true, reason: "locked", token: 3 });
  assert.equal(manager.messages.at(-1).payload.reason, "locked");
  assert.equal(manager.messages.at(-1).payload.releaseRequested, false);
});

test("released widget retains its current monitor including a moved mini window", () => {
  const { windows } = harness();
  const win = windows.createWidget();
  windows.setMini(true);
  win.options.x = 1200; win.options.y = 80;
  const before = windows.widgetBounds();
  windows.releaseWidget();
  assert.equal(windows.widget(), null);
  assert.deepEqual(windows.widgetBounds(), before);
});
