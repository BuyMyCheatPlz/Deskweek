"use strict";
const { app, BrowserWindow } = require("electron");
app.whenReady().then(() => {
  const win = new BrowserWindow({ title: "DeskWeek fullscreen regression fixture", fullscreen: true, backgroundColor: "#172033", webPreferences: { sandbox: true } });
  win.loadURL("data:text/html,<body style='color:white;font:24px sans-serif;padding:60px'>DeskWeek fullscreen regression test</body>");
  win.once("ready-to-show", () => {
    win.show(); win.focus();
    const k = require("koffi"), u = k.load("user32.dll");
    const r = k.struct("DeskWeekFixtureRect", { left: "long", top: "long", right: "long", bottom: "long" });
    const getForeground = u.func("void * __stdcall GetForegroundWindow()");
    const getRect = u.func("bool __stdcall GetWindowRect(void * hwnd, _Out_ DeskWeekFixtureRect * rect)");
    const value = {}; const hwnd = getForeground(); getRect(hwnd, value);
    console.log("FULLSCREEN_FIXTURE", JSON.stringify({ pid: process.pid, fullscreen: win.isFullScreen(), bounds: win.getBounds(), foregroundRect: value, ownHandle: win.getNativeWindowHandle().readBigUInt64LE().toString(), foreground: String(hwnd) }));
  });
  setTimeout(() => app.quit(), 26000);
});
