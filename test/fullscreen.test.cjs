"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

// Exercise the real native detector with captured Win32 window properties.
function detect(windows, foreground = 1, { targetBounds, displays = [{ bounds: { x: 0, y: 0, width: 2560, height: 1440 } }], dipToScreenRect = (_, bounds) => bounds } = {}) {
  const source = fs.readFileSync(path.resolve(__dirname, "../src/main/desktop/windows-shell.cjs"), "utf8");
  const api = {
    GetForegroundWindow: () => foreground,
    GetWindowRect: (hwnd, out) => { Object.assign(out, windows[hwnd].rect || { left: 0, top: 0, right: 2559, bottom: 1440 }); return true; },
    GetWindowThreadProcessId: (hwnd, out) => { out[0] = windows[hwnd].pid || 123; },
    GetAsyncKeyState: () => 0,
    GetClassNameW: (hwnd, out) => { out.write(windows[hwnd].className || "GameWindow", "utf16le"); return 1; },
    IsWindowVisible: hwnd => windows[hwnd].visible !== false,
    IsIconic: hwnd => Boolean(windows[hwnd].iconic),
    GetWindowLongPtrW: hwnd => BigInt(windows[hwnd].exStyle || 0),
    GetLayeredWindowAttributes: (hwnd, color, alpha, flags) => {
      const w = windows[hwnd];
      if (w.alpha === undefined) return false;
      alpha[0] = w.alpha; flags[0] = w.alphaFlags ?? 2; return true;
    },
    DwmGetWindowAttribute: (hwnd, attr, out) => { out[0] = windows[hwnd].cloaked ? 1 : 0; return 0; },
    EnumWindows: callback => { for (const hwnd of Object.keys(windows).map(Number)) if (!callback(hwnd)) break; return true; },
  };
  const koffi = {
    struct: name => name,
    proto: name => name,
    load: name => {
      if (name === "ole32.dll") throw new Error("No COM needed in this test");
      return { func: signature => {
        const name = signature.match(/(\w+)\(/)[1];
        assert.ok(api[name], `Unexpected native call: ${name}`);
        return api[name];
      } };
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(source, {
    module, Buffer, process, console: { warn() {} },
    require: name => name === "koffi" ? koffi : require(path.resolve(__dirname, "../src/main/desktop", name)),
  });
  const shell = module.exports.createWindowsShell({
    getAllDisplays: () => displays,
    dipToScreenRect,
  });
  return shell.fullscreen(0, targetBounds);
}

test("invisible NVIDIA overlay does not pause the desktop widget", () => {
  assert.equal(detect({ 1: { className: "CEF-OSC-WIDGET", exStyle: 0x8080080, alpha: 0 } }), false);
});

test("DisplayFusion nonactivating overlay is not a fullscreen application", () => {
  assert.equal(detect({ 1: { className: "DFMonitorFadingWindow", exStyle: 0x80800a8 } }), false);
});

test("fully transparent layered windows are ignored even without tool styles", () => {
  assert.equal(detect({ 1: { exStyle: 0x80000, alpha: 0 } }), false);
});

test("real fullscreen apps still pause, including on an unfocused monitor", () => {
  assert.equal(detect({ 1: { rect: { left: 20, top: 20, right: 900, bottom: 700 } }, 2: {} }), true);
  assert.equal(detect({ 1: { exStyle: 0x80000, alpha: 255 } }), true);
  assert.equal(detect({ 1: { exStyle: 0x80000 } }), true, "Failed alpha query must not imply transparent");
  assert.equal(detect({ 1: { exStyle: 0x80000, alpha: 0, alphaFlags: 1 } }), true, "Color-key mode does not use the alpha byte");
});

test("hidden, minimized and cloaked windows are ignored", () => {
  for (const properties of [{ visible: false }, { iconic: true }, { cloaked: true }]) assert.equal(detect({ 1: properties }), false);
});

test("fullscreen on another monitor must not pause an uncovered calendar", () => {
  const displays = [
    { bounds: { x: 0, y: 0, width: 2560, height: 1440 } },
    { bounds: { x: -1920, y: 0, width: 1920, height: 1080 } },
  ];
  const windows = { 1: {} };
  assert.equal(detect(windows, 1, { displays, targetBounds: { x: -1800, y: 80, width: 880, height: 690 } }), false);
  assert.equal(detect(windows, 1, { displays, targetBounds: { x: 80, y: 80, width: 880, height: 690 } }), true);
});

test("monitor scoping compares DIP widget bounds with physical fullscreen bounds", () => {
  const displays = [
    { bounds: { x: -1280, y: 0, width: 1280, height: 720 } },
    { bounds: { x: 0, y: 0, width: 2560, height: 1440 } },
  ];
  const dipToScreenRect = (_, r) => r.x < 0 ? { x: -1920, y: 0, width: 1920, height: 1080 } : r;
  const windows = { 1: { rect: { left: -1920, top: 0, right: 0, bottom: 1080 } } };
  assert.equal(detect(windows, 1, { displays, dipToScreenRect, targetBounds: { x: -1200, y: 40, width: 800, height: 600 } }), true);
  assert.equal(detect(windows, 1, { displays, dipToScreenRect, targetBounds: { x: 80, y: 80, width: 880, height: 690 } }), false);
});

test("a calendar spanning monitors pauses only when every occupied display is covered", () => {
  const displays = [
    { bounds: { x: 0, y: 0, width: 2560, height: 1440 } },
    { bounds: { x: 2560, y: 0, width: 1920, height: 1080 } },
  ];
  const targetBounds = { x: 2400, y: 80, width: 880, height: 690 };
  const first = { rect: { left: 0, top: 0, right: 2560, bottom: 1440 } };
  const second = { rect: { left: 2560, top: 0, right: 4480, bottom: 1080 } };
  assert.equal(detect({ 1: first }, 1, { displays, targetBounds }), false);
  assert.equal(detect({ 1: first, 2: second }, 1, { displays, targetBounds }), true);
  assert.equal(detect({ 1: first, 2: { ...second, alpha: 0, exStyle: 0x80000 } }, 1, { displays, targetBounds }), false);
  assert.equal(detect({ 1: first }, 1, { displays, targetBounds: { x: 2560, y: 40, width: 400, height: 300 } }), false, "Touching the screen edge is not overlap");
  assert.equal(detect({ 1: first }, 1, { displays, targetBounds: { x: 9000, y: 0, width: 400, height: 300 } }), false, "Unknown/off-screen geometry must not globally pause");
});
