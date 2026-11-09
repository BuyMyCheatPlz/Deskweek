"use strict";
const { coversDisplay } = require("../runtime/refresh-policy.cjs");

function windowHandle(win) {
  const b = win.getNativeWindowHandle();
  return b.length >= 8 ? b.readBigUInt64LE() : BigInt(b.readUInt32LE());
}

function createWindowsShell(screen) {
  const koffi = require("koffi");
  const user32 = koffi.load("user32.dll");
  const RECT = koffi.struct("DeskWeekShellRect", { left: "long", top: "long", right: "long", bottom: "long" });
  const foreground = user32.func("void * __stdcall GetForegroundWindow()");
  const rect = user32.func("bool __stdcall GetWindowRect(void * hwnd, _Out_ DeskWeekShellRect * rect)");
  const pid = user32.func("uint __stdcall GetWindowThreadProcessId(void * hwnd, _Out_ uint * pid)");
  const key = user32.func("short __stdcall GetAsyncKeyState(int key)");
  const className = user32.func("int __stdcall GetClassNameW(void * hwnd, _Out_ char16_t * text, int count)");
  const visible = user32.func("bool __stdcall IsWindowVisible(void * hwnd)");
  const iconic = user32.func("bool __stdcall IsIconic(void * hwnd)");
  const extendedStyle = user32.func("intptr_t __stdcall GetWindowLongPtrW(void * hwnd, int index)");
  const layeredAttributes = user32.func("bool __stdcall GetLayeredWindowAttributes(void * hwnd, _Out_ uint * color, _Out_ uchar * alpha, _Out_ uint * flags)");
  const enumCallback = koffi.proto("bool __stdcall DeskWeekEnumWindows(void * hwnd, intptr_t data)");
  const enumWindows = user32.func("bool __stdcall EnumWindows(DeskWeekEnumWindows * callback, intptr_t data)");
  const dwm = koffi.load("dwmapi.dll");
  const cloaked = dwm.func("long __stdcall DwmGetWindowAttribute(void * hwnd, uint attribute, _Out_ uint * value, uint size)");
  let com = null;
  // Only the documented IVirtualDesktopManager ABI is used. No private shell hooks.
  try {
    const ole32 = koffi.load("ole32.dll");
    const init = ole32.func("long __stdcall CoInitializeEx(void * reserved, uint flags)");
    const uninit = ole32.func("void __stdcall CoUninitialize()");
    const create = ole32.func("long __stdcall CoCreateInstance(void * clsid, void * outer, uint context, void * iid, _Out_ void ** result)");
    const guid = text => {
      const b = Buffer.alloc(16), [a, c, d, e, f] = text.split("-");
      b.writeUInt32LE(parseInt(a, 16)); b.writeUInt16LE(parseInt(c, 16), 4); b.writeUInt16LE(parseInt(d, 16), 6); Buffer.from(e + f, "hex").copy(b, 8); return b;
    };
    const initialized = init(null, 2) >= 0;
    const result = [null];
    const hr = create(guid("aa509086-5ca9-4c25-8f95-589d3c07b48a"), null, 1, guid("a5cd92ff-29be-454c-8d04-d82879fb3f1b"), result);
    if (hr >= 0 && result[0]) {
      const self = result[0];
      const vtable = koffi.decode(koffi.decode(self, "void *"), "void *", 6);
      const isCurrent = koffi.proto("long __stdcall DeskWeekIsCurrent(void * self, void * hwnd, _Out_ int * current)");
      const getId = koffi.proto("long __stdcall DeskWeekDesktopId(void * self, void * hwnd, void * id)");
      const move = koffi.proto("long __stdcall DeskWeekMoveDesktop(void * self, void * hwnd, void * id)");
      const release = koffi.proto("uint __stdcall DeskWeekRelease(void * self)");
      com = {
        isCurrent(hwnd) { const out = [0]; return koffi.call(vtable[3], isCurrent, self, hwnd, out) >= 0 ? Boolean(out[0]) : null; },
        moveToReference(hwnd, current) {
          const id = Buffer.alloc(16);
          if (!current || koffi.call(vtable[4], getId, self, current, id) < 0 || id.every(byte => byte === 0)) return false;
          return koffi.call(vtable[5], move, self, hwnd, id) >= 0;
        },
        dispose() { koffi.call(vtable[2], release, self); if (initialized) uninit(); },
      };
    } else if (initialized) uninit();
  } catch (error) { console.warn("Virtual desktop API unavailable:", error.message); }

  return {
    buttonDown: () => (Number(key(1)) & 0x8000) !== 0,
    isCurrent: win => com?.isCurrent(windowHandle(win)) ?? null,
    moveToCurrent(win) {
      if (!com) return false;
      const hwnd = windowHandle(win);
      if (com.isCurrent(hwnd) === true || com.moveToReference(hwnd, foreground())) return true;
      // A native-only probe supplies the current desktop ID when the shell has
      // no foreground HWND. BaseWindow creates no renderer process.
      let probe;
      try {
        const { BaseWindow } = require("electron");
        probe = new BaseWindow({ width: 1, height: 1, show: false, skipTaskbar: true, focusable: false });
        return com.moveToReference(hwnd, windowHandle(probe));
      } catch { return false; }
      finally { probe?.destroy(); }
    },
    fullscreen(onlyPid = 0) {
      try {
        const displays = screen.getAllDisplays().map(d => screen.dipToScreenRect(null, d.bounds));
        function isFullscreen(hwnd) {
          if (!hwnd || !visible(hwnd) || iconic(hwnd)) return false;
          const owner = [0]; pid(hwnd, owner);
          if (owner[0] === process.pid || (onlyPid && owner[0] !== onlyPid)) return false;
          const hidden = [0];
          if (cloaked(hwnd, 14, hidden, 4) >= 0 && hidden[0]) return false;
          const text = Buffer.alloc(512); className(hwnd, text, 256);
          if (["Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd"].includes(text.toString("utf16le").replace(/\0.*$/s, ""))) return false;
          const r = {}; if (!rect(hwnd, r)) return false;
          if (!coversDisplay({ x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top }, displays)) return false;
          // Visible in Win32 does not mean visible on screen: overlays often
          // retain WS_VISIBLE while fully transparent or unable to activate.
          const style = Number(extendedStyle(hwnd, -20)); // GWL_EXSTYLE
          if ((style & 0x08000000) && (style & (0x80 | 0x20))) return false;
          if (style & 0x00080000) { // WS_EX_LAYERED
            const color = [0], alpha = [255], flags = [0];
            // UpdateLayeredWindow windows can reject this query. Only a
            // successful LWA_ALPHA query proves that alpha zero is invisible.
            if (layeredAttributes(hwnd, color, alpha, flags) && (flags[0] & 2) && alpha[0] === 0) return false;
          }
          return true;
        }
        if (isFullscreen(foreground())) return true;
        // A fullscreen app on another monitor need not own keyboard focus.
        let found = false;
        enumWindows(hwnd => { if (isFullscreen(hwnd)) { found = true; return false; } return true; }, 0);
        return found;
      } catch { return false; }
    },
    dispose() { com?.dispose(); com = null; },
  };
}
module.exports = { createWindowsShell, windowHandle };
