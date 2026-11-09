"use strict";
// Real-desktop regression: unlike the isolated host suite, do not filter out
// other applications. Background overlays must not unload a desktop widget.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { app } = require("electron");
const root = path.resolve(__dirname, "..");
const appRoot = process.env.DESKWEEK_APP_ROOT || root;
process.env.DESKWEEK_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "deskweek-visibility-"));
const windowsModule = require(path.join(appRoot, "src/main/windows/windows.cjs"));
const makeWindows = windowsModule.createWindows;
let windows;
const events = [];
windowsModule.createWindows = (...args) => {
  windows = makeWindows(...args);
  const notify = windows.notifyRuntime, release = windows.releaseWidget;
  windows.notifyRuntime = state => { events.push({ elapsed: Date.now() - started, state }); console.log("VISIBILITY_STATE", JSON.stringify(events.at(-1))); notify(state); };
  windows.releaseWidget = (...params) => { events.push({ elapsed: Date.now() - started, released: true }); return release(...params); };
  return windows;
};
const started = Date.now();
require(path.join(appRoot, "src/main/index.cjs"));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  await sleep(18000);
  const afterIdle = Boolean(windows.widget() && !windows.widget().isDestroyed() && windows.widget().isVisible());
  // Same method as the tray's "find/show widget" action, with the real policy.
  windows.focus();
  await sleep(4000);
  const afterShow = Boolean(windows.widget() && !windows.widget().isDestroyed() && windows.widget().isVisible());
  console.log("VISIBILITY_RESULT", JSON.stringify({ afterIdle, afterShow, desktopStatus: windows.status(), events }));
  assert.equal(afterIdle, true, "Desktop widget was unloaded by an existing background application");
  assert.equal(afterShow, true, "Explicitly showing the widget only flashed before being unloaded again");
  console.log("VISIBILITY_REGRESSION_PASS");
  app.quit();
}).catch(error => { console.error("VISIBILITY_REGRESSION_FAIL", error.stack); app.exit(1); });
