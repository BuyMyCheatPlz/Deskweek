"use strict";
// Force a second pause while the restored page dispatches did-finish-load.
// This reaches the original main-process callback using real Electron windows.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { app } = require("electron");
const appRoot = process.env.DESKWEEK_APP_ROOT || path.resolve(__dirname, "..");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "deskweek-resume-"));
process.env.DESKWEEK_DATA_DIR = profile;
let controller, interrupted = 0, finalLoaded = false;
const repetitions = 20;
function fail(error) { console.error("RESUME_REGRESSION_FAIL", error.stack || error); app.exit(1); }
process.on("uncaughtException", fail);
process.on("unhandledRejection", fail);
const mod = require(path.join(appRoot, "src/main/windows/windows.cjs")), create = mod.createWindows;
mod.createWindows = (...args) => controller = create(...args);
app.on("browser-window-created", (_event, win) => {
  win.webContents.prependOnceListener("did-finish-load", () => {
    if (interrupted < repetitions) {
      interrupted++;
      controller.releaseWidget();
      setImmediate(() => controller.restoreWidget());
    } else finalLoaded = true;
  });
});
require(path.join(appRoot, "src/main/index.cjs"));
app.whenReady().then(async () => {
  const end = Date.now() + 45000;
  while (!finalLoaded && Date.now() < end) await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(interrupted, repetitions);
  assert.equal(finalLoaded, true, "Restored widget did not finish loading");
  await new Promise(resolve => setTimeout(resolve, 2000));
  const win = controller.widget();
  assert.ok(win && !win.isDestroyed() && win.isVisible());
  assert.equal(await win.webContents.executeJavaScript("typeof window.deskWeek.loadStore"), "function");
  console.log("RESUME_REGRESSION_PASS", JSON.stringify({ interruptedLoads: interrupted, restoredVisible: true, desktopStatus: controller.status() }));
  app.quit();
}).catch(fail);
