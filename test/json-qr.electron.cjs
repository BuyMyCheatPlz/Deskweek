"use strict";
// Real Electron IPC, actual QR pixels and a synthetic camera stream; no user data/camera footage.
const fs = require("node:fs"), path = require("node:path"), assert = require("node:assert/strict");
const { app, BrowserWindow, nativeImage, session } = require("electron");
app.commandLine.appendSwitch("use-fake-device-for-media-stream");
const evidence = process.env.DESKWEEK_QR_EVIDENCE;
assert.ok(evidence, "Set DESKWEEK_QR_EVIDENCE to an isolated evidence directory");
fs.mkdirSync(evidence, { recursive: true });
process.env.DESKWEEK_DATA_DIR = fs.mkdtempSync(path.join(evidence, "desktop-profile-"));
const fixture = require("./fixtures/json-qr-v1.json"), QRCode = require("qrcode"), jsQR = require("jsqr");
const appRoot = process.env.DESKWEEK_APP_ROOT || path.resolve(__dirname, "..");
const shellModule = require(path.join(appRoot, "src/main/desktop/windows-shell.cjs")), makeShell = shellModule.createWindowsShell;
shellModule.createWindowsShell = (...args) => { const shell = makeShell(...args); shell.fullscreen = () => false; return shell; };
// Updater HTTP has separate tests; this QR test must not contact the Internet.
const updateModule = require(path.join(appRoot, "src/main/updates/update-controller.cjs")), makeUpdates = updateModule.createUpdates;
updateModule.createUpdates = (...args) => { const updates = makeUpdates(...args); updates.check = async () => updates.state(); return updates; };
process.argv.push("--open-manager"); require(path.join(appRoot, "src/main/index.cjs"));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn, label, timeout = 15000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await fn()) return; await sleep(100); } throw new Error(label); }
const errors = [];
app.on("web-contents-created", (_event, contents) => { contents.on("preload-error", (_e, _p, error) => errors.push(error.message)); contents.on("render-process-gone", (_e, details) => { if (details.reason !== "clean-exit") errors.push(details.reason); }); });
app.whenReady().then(async () => {
  await session.defaultSession.enableNetworkEmulation({ offline: true });
  let manager;
  await until(() => { manager = BrowserWindow.getAllWindows().find(w => w.getTitle().includes("管理中心")); return manager && !manager.webContents.isLoading(); }, "Manager did not load");
  const js = code => manager.webContents.executeJavaScript(code, true);
  await until(() => js("Boolean(window.DeskWeekQrUI)"), "QR UI missing");
  await js(`window.deskWeek.replaceStore(${JSON.stringify(fixture.snapshot)})`);
  await js("document.querySelector('[data-section=settings]').click(); document.querySelector('#managerQrExport').click()");
  await until(() => js("document.querySelector('#jsonQrImage').src.startsWith('data:')"), "No exported QR image");
  const imageUrl = await js("document.querySelector('#jsonQrImage').src");
  const png = require("pngjs").PNG.sync.read(Buffer.from(imageUrl.split(",")[1], "base64"));
  fs.writeFileSync(path.join(evidence, "desktop-export-qr.png"), Buffer.from(imageUrl.split(",")[1], "base64"));
  const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height); assert.ok(decoded); assert.equal(JSON.parse(decoded.data).part, 1);
  await until(() => js("document.querySelector('#jsonQrImage').complete && document.querySelector('#jsonQrImage').naturalWidth > 0"), "QR image did not load");
  let screenImage;
  await until(async () => {
    screenImage = await manager.webContents.capturePage();
    const png = require("pngjs").PNG.sync.read(screenImage.toPNG());
    return Boolean(jsQR(new Uint8ClampedArray(png.data), png.width, png.height));
  }, "Displayed QR image did not decode from actual window pixels");
  fs.writeFileSync(path.join(evidence, "desktop-qr-export.png"), screenImage.toPNG());
  const total = Number((await js("document.querySelector('#jsonQrPage').textContent")).split("/")[1]); assert.ok(total > 1);
  await js("document.querySelector('#jsonQrNext').click()"); await until(async () => (await js("document.querySelector('#jsonQrPage').textContent")).startsWith("2 /"), "Page did not change");
  await js("document.querySelector('#jsonQrExportClose').click()");
  await until(() => js("window.deskWeek.qrExportPage(0).then(()=>false,()=>true)"), "Export session was not released");
  console.log("PASS desktop QR export IPC, actual pixels, pagination and cleanup");
  assert.equal(await js("navigator.mediaDevices.getUserMedia({video:true,audio:false}).then(s=>{s.getTracks().forEach(t=>t.stop());return false},()=>true)"), true);
  await js("window.__qaRealGetUserMedia=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async c=>{window.__qaNativeStream=await __qaRealGetUserMedia(c);return __qaNativeStream};document.querySelector('#managerQrScan').click();true");
  await until(() => js("document.querySelector('#jsonQrVideo').readyState >= 2"), "Native camera permission path failed");
  await js("document.querySelector('#jsonQrScanClose').click()");
  await until(() => js("__qaNativeStream.getTracks().every(t=>t.readyState==='ended')"), "Native camera was not released");
  assert.equal(await js("__qaRealGetUserMedia({video:true,audio:false}).then(s=>{s.getTracks().forEach(t=>t.stop());return false},()=>true)"), true);
  console.log("PASS native getUserMedia permission scope and camera release (Chromium fake device)");
  await js("navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied for test','NotAllowedError'); }; document.querySelector('#managerQrScan').click()");
  await until(() => js("document.querySelector('#jsonQrScanStatus').textContent.includes('Windows 隐私设置')"), "Permission denial missing");
  await js("document.querySelector('#jsonQrScanClose').click()");
  console.log("PASS camera denial and file fallback message");
  await js(`(async()=>{ const s=await window.deskWeek.loadStore(); await window.deskWeek.replaceStore({items:[{id:'keep',title:'本机保留任务'}],prefs:{localOnly:true}}); window.__qaCanvas=document.createElement('canvas'); __qaCanvas.width=640;__qaCanvas.height=640; const ctx=__qaCanvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,640,640); navigator.mediaDevices.getUserMedia=async()=>{window.__qaStream=__qaCanvas.captureStream(8);return __qaStream;};navigator.mediaDevices.enumerateDevices=async()=>[{kind:'videoinput',deviceId:'qa',label:'QR test camera'}];document.querySelector('#managerQrScan').click(); })()`);
  await js("window.__qaFramePump=setInterval(()=>{__qaCanvas.getContext('2d').drawImage(__qaCanvas,0,0)},120)");
  try { await until(() => js("document.querySelector('#jsonQrVideo').readyState >= 2"), "Synthetic camera did not start"); }
  catch (error) { console.log(await js("({status:document.querySelector('#jsonQrScanStatus').textContent,tracks:window.__qaStream?.getTracks().map(t=>({state:t.readyState,enabled:t.enabled})),open:document.querySelector('#jsonQrScanDialog').open,videoError:document.querySelector('#jsonQrVideo').error?.message})")); throw error; }
  for (let i = 0; i < fixture.frames.length; i++) {
    const src = await QRCode.toDataURL(fixture.frames[i], { width: 640, margin: 4, errorCorrectionLevel: "M" });
    await js(`new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>{__qaCanvas.getContext('2d').drawImage(im,0,0,640,640);resolve();};im.onerror=reject;im.src=${JSON.stringify(src)};})`);
    if (i < fixture.frames.length - 1) await until(() => js(`document.querySelector('#jsonQrScanStatus').textContent.includes('已收集 ${i + 1} /')`), `Camera did not decode frame ${i + 1}`);
  }
  await until(() => js("document.querySelector('#jsonImportDialog').open"), "Camera did not reach import preview");
  await sleep(350);
  assert.equal(await js("__qaStream.getTracks().every(t=>t.readyState==='ended')"), true);
  assert.equal((await js("window.deskWeek.loadStore()")).items[0].title, "本机保留任务");
  fs.writeFileSync(path.join(evidence, "desktop-qr-import-preview.png"), (await manager.webContents.capturePage()).toPNG());
  await js("document.querySelector('#jsonImportMerge').click()");
  await until(async () => (await js("window.deskWeek.loadStore()")).items.length === fixture.snapshot.items.length + 1, "Merge did not persist");
  console.log("PASS synthetic camera actual frames, multipart collector, preview, merge and camera stop");
  const snapshotText = JSON.stringify(fixture.snapshot);
  await js(`window.DeskWeekQrUI.previewImport(${JSON.stringify(snapshotText)})`); await js("document.querySelector('#jsonImportCancel').click()");
  assert.equal((await js("window.deskWeek.loadStore()")).items.length, 4);
  await js(`importData({text:async()=>${JSON.stringify(snapshotText)}})`); await js("document.querySelector('#jsonImportReplace').click()");
  await until(async () => (await js("window.deskWeek.loadStore()")).items.length === 3, "File replace did not persist");
  const replaced = await js("window.deskWeek.loadStore()"); assert.equal(replaced.prefs.theme, "dark"); assert.ok(replaced.items.find(t => t.id === "cross-trash").deleted);
  await js("window.__qrOldCreate=URL.createObjectURL;window.__qrOldClick=HTMLAnchorElement.prototype.click;URL.createObjectURL=b=>{window.__qrExportBlob=b;return __qrOldCreate(b)};HTMLAnchorElement.prototype.click=()=>{};exportData();URL.createObjectURL=__qrOldCreate;HTMLAnchorElement.prototype.click=__qrOldClick;true");
  const exported = JSON.parse(await js("__qrExportBlob.text()")); assert.equal(exported.items.length, 3); assert.ok(exported.items.find(t => t.id === "cross-one").done);
  const beforeInvalid = await js("window.deskWeek.loadStore()");
  await js(`importData({text:async()=>'{"items":[{"id":"bad","title":"x"},{"id":"bad","title":"y"}]}'})`);
  assert.equal((await js("window.deskWeek.loadStore()")).revision, beforeInvalid.revision);
  assert.deepEqual(errors, []);
  console.log("PASS file import/export, cancel, replace, recycle bin and rejection without writes");
  console.log("QR_ELECTRON_ALL_PASS renderer network disabled; updater disabled; no real camera optical test"); app.quit();
}).catch(error => { console.error(error); app.exit(1); });
