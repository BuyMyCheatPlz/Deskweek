"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function harness() {
  const all = [], loaded = [];
  class Window extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.dead = false;
      this.contents = new EventEmitter(); this.contents.dead = false;
      this.contents.isDestroyed = () => this.contents.dead;
      this.contents.send = () => { if (this.dead || this.contents.dead) throw new TypeError("Object has been destroyed"); };
      all.push(this);
    }
    get webContents() { if (this.dead) throw new TypeError("Object has been destroyed"); return this.contents; }
    isDestroyed() { return this.dead; }
    setMenu() {}
    loadFile() { return Promise.resolve(); }
    showInactive() {}
    show() {}
    destroy() { this.dead = true; this.contents.dead = true; this.emit("closed"); }
  }
  const desktop = { apply: () => ({ desktopStatus: "attached" }), release() {}, setBounds() {}, getBounds: () => all.at(-1).options, healthy: () => false };
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
    screen: { getPrimaryDisplay: () => display, getAllDisplays: () => [display], removeListener() {} }, shell: { isCurrent: () => true },
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
