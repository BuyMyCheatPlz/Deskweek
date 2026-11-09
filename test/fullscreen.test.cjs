"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

// Exercise the real native detector with captured Win32 window properties.
function detect(windows, foreground = 1) {
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
    getAllDisplays: () => [{ bounds: { x: 0, y: 0, width: 2560, height: 1440 } }],
    dipToScreenRect: (_, bounds) => bounds,
  });
  return shell.fullscreen();
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
