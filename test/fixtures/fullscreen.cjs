"use strict";
const { app, BrowserWindow, screen } = require("electron");
if (process.env.DESKWEEK_DATA_DIR) {
  const profile = require("node:path").join(process.env.DESKWEEK_DATA_DIR, "fullscreen-fixture-profile");
  require("node:fs").mkdirSync(profile, { recursive: true });
  app.setPath("userData", profile);
}
app.whenReady().then(() => {
  const display = screen.getAllDisplays().find(d => String(d.id) === process.env.DESKWEEK_FULLSCREEN_DISPLAY_ID) || screen.getPrimaryDisplay();
  const win = new BrowserWindow({ ...display.bounds, title: "DeskWeek fullscreen regression fixture", fullscreen: true, backgroundColor: "#172033", webPreferences: { sandbox: true } });
  win.loadURL("data:text/html,<body style='color:white;font:24px sans-serif;padding:60px'>DeskWeek fullscreen regression test</body>");
  win.once("ready-to-show", () => {
    win.show(); win.focus();
    const k = require("koffi"), u = k.load("user32.dll");
    const r = k.struct("DeskWeekFixtureRect", { left: "long", top: "long", right: "long", bottom: "long" });
    const getForeground = u.func("void * __stdcall GetForegroundWindow()");
    const getRect = u.func("bool __stdcall GetWindowRect(void * hwnd, _Out_ DeskWeekFixtureRect * rect)");
    const value = {}, ownRect = {}; const hwnd = getForeground(); getRect(hwnd, value);
    const ownHandle = win.getNativeWindowHandle().readBigUInt64LE(); getRect(ownHandle, ownRect);
    console.log("FULLSCREEN_FIXTURE", JSON.stringify({ pid: process.pid, displayId: display.id, fullscreen: win.isFullScreen(), bounds: win.getBounds(), physicalBounds: ownRect, foregroundRect: value, ownHandle: ownHandle.toString(), foreground: String(hwnd) }));
  });
  setTimeout(() => app.quit(), Math.min(90000, Math.max(1000, Number(process.env.DESKWEEK_FULLSCREEN_LIFETIME_MS) || 26000)));
});
