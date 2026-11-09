"use strict";
// Runs the real Electron app against a throwaway data directory and stresses IPC/store/window races.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { app, BrowserWindow } = require("electron");

const root = path.resolve(__dirname, "..");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "deskweek-concurrency-"));
process.env.DESKWEEK_DATA_DIR = profile;

let fakeLatestVersion = "99.0.0";
const fullUpdateNotes = ["# DeskWeek v9.0.0", ...Array.from({ length: 80 }, (_, index) => `- 更新说明第 ${index + 1} 行：保留完整的更新内容，不再截断。`), `- ${"长内容".repeat(40)}LONG_LINE_END`, "- FULL_NOTES_END"].join("\n");
let fetchStarts = 0;
let activeFetches = 0;
let maxActiveFetches = 0;
global.fetch = async () => {
  fetchStarts += 1;
  activeFetches += 1;
  maxActiveFetches = Math.max(maxActiveFetches, activeFetches);
  try {
    await new Promise(resolve => setTimeout(resolve, 350));
    return {
      ok: true,
      async json() {
        return {
          tag_name: `v${fakeLatestVersion}`,
          name: "DeskWeek v1.3.0",
          html_url: "https://github.com/EasonGuuu/Deskweek/releases/tag/v1.3.0",
          published_at: new Date().toISOString(),
          body: fullUpdateNotes,
          assets: [],
        };
      },
    };
  } finally {
    activeFetches -= 1;
  }
};

const errors = [];
let windowController;
app.on("web-contents-created", (_event, contents) => {
  contents.on("console-message", (_event, details) => {
    if (details?.level === "error") errors.push(details.message);
  });
  contents.on("render-process-gone", (_event, details) => {
    if (details.reason !== "clean-exit") errors.push(`renderer-gone:${details.reason}`);
  });
});

const windowsModule = require(path.join(root, "src/main/windows/windows.cjs"));
const createWindows = windowsModule.createWindows;
windowsModule.createWindows = (...args) => {
  windowController = createWindows(...args);
  return windowController;
};
require(path.join(root, "src/main/index.cjs"));

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const widget = () => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith("/src/renderer/widget/index.html"));
const manager = () => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith("/src/renderer/manager/index.html"));

function withTimeout(promise, label, ms = 8000) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label}: timeout after ${ms}ms`)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

async function until(fn, label, ms = 12000) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      last = error;
    }
    await sleep(80);
  }
  throw new Error(`${label}${last ? `: ${last.message}` : ""}`);
}

function run(win, code, label, timeout = 8000) {
  if (!win || win.isDestroyed()) return Promise.reject(new Error(`${label}: window destroyed`));
  return withTimeout(win.webContents.executeJavaScript(code, true), label, timeout);
}

async function openManager() {
  const win = widget();
  assert.ok(win, "widget missing before opening manager");
  await run(win, "window.deskWeek.openManager()", "open manager");
  return until(() => {
    const candidate = manager();
    return candidate && !candidate.webContents.isLoading() && candidate.isVisible() && candidate;
  }, "manager did not become ready", 12000);
}

async function prepareRaceBase() {
  const script = `(async()=>{window.__raceBase=await window.deskWeek.loadStore();return {revision:window.__raceBase.revision,count:window.__raceBase.items.length};})()`;
  const [fromWidget, fromManager] = await Promise.all([
    run(widget(), script, "prepare widget base"),
    run(manager(), script, "prepare manager base"),
  ]);
  assert.equal(fromWidget.revision, fromManager.revision, "race windows did not share a revision");
  return fromWidget;
}

function addFromBase(id, title) {
  return `(async()=>{const base=window.__raceBase;const item={id:${JSON.stringify(id)},title:${JSON.stringify(title)},detail:'',date:'',time:'',defer:'none',done:false,completedAt:'',deleted:false,deletedAt:''};return await window.deskWeek.saveStore({items:[...base.items,item],prefs:base.prefs});})()`;
}

function editItemFromBase(id, changes) {
  return `(async()=>{const base=window.__raceBase;const before=base.items.find(item=>item.id===${JSON.stringify(id)});const after=Object.assign({},before,${JSON.stringify(changes)});return await window.deskWeek.editTask(before,after);})()`;
}
function itemFromBase(id, changes) {
  return `(async()=>{const base=window.__raceBase;const items=base.items.map(item=>item.id===${JSON.stringify(id)}?Object.assign({},item,${JSON.stringify(changes)}):item);return await window.deskWeek.saveStore({items,prefs:base.prefs});})()`;
}

async function seedTask(id, title = id, detail = "") {
  const win = widget();
  const item = { id, title, detail, date: "", time: "", defer: "none", done: false, completedAt: "", deleted: false, deletedAt: "" };
  return run(win, `(async()=>{const base=await window.deskWeek.loadStore();const next=base.items.some(item=>item.id===${JSON.stringify(id)})?base.items.map(item=>item.id===${JSON.stringify(id)}?Object.assign({},item,${JSON.stringify(item)}):item):[...base.items,${JSON.stringify(item)}];return await window.deskWeek.saveStore({items:next,prefs:base.prefs});})()`, `seed ${id}`);
}

async function loadFromWidget() {
  return run(widget(), "window.deskWeek.loadStore()", "load final store");
}

app.whenReady().then(async () => {
  let win = await until(() => widget() && !widget().webContents.isLoading() && widget().isVisible() && widget(), "widget did not become ready", 15000);
  await sleep(500);
  let mgr = await openManager();
  await run(win, `(async()=>{const base=await window.deskWeek.loadStore();return await window.deskWeek.saveStore({items:base.items,prefs:{...base.prefs,widgetBackground:"transparent",autoTheme:true}});})()`, "enable transparent auto theme");
  await until(() => run(win, "document.documentElement.dataset.widgetBackground === 'transparent'", "wait transparent background"), "transparent background did not apply", 5000);
  const backgroundSample = await run(win, "refreshBackgroundTheme(true)", "sample desktop background", 15000);
  assert.ok(backgroundSample && ["light", "dark"].includes(backgroundSample.theme), "background theme sample failed");
  assert.equal(backgroundSample.samples, 25);
  assert.equal(await run(win, "document.documentElement.dataset.theme === '" + backgroundSample.theme + "'", "apply sampled background theme"), true);
  await run(win, `(async()=>{const base=await window.deskWeek.loadStore();return await window.deskWeek.saveStore({items:base.items,prefs:{...base.prefs,widgetBackground:"standard",autoTheme:false,theme:"light"}});})()`, "restore standard theme");
  await until(() => run(mgr, "document.querySelector('#updateNotes').textContent.includes('FULL_NOTES_END')", "check update notes tail"), "update notes were truncated", 5000);
  assert.equal(await run(mgr, "document.querySelector('#updateNotes').textContent.includes('更新说明第 80 行')", "check update notes middle"), true);
  assert.equal(await run(mgr, "document.querySelector('#updateNotes').textContent.includes('LONG_LINE_END')", "check update notes long line"), true);
  await run(mgr, "window.deskWeek.managerMinimize()", "minimize manager");
  await until(() => mgr.isMinimized(), "manager did not minimize", 5000);
  await run(win, "window.deskWeek.openManager()", "reopen minimized manager");
  await until(() => !mgr.isMinimized() && mgr.isVisible(), "manager did not restore after reopen", 5000);
  await Promise.all(Array.from({ length: 20 }, (_, index) => run(win, "window.deskWeek.openManager()", `manager open storm ${index}`, 5000)));
  await sleep(300);
  assert.equal(BrowserWindow.getAllWindows().filter(candidate => candidate.webContents.getURL().endsWith("/src/renderer/manager/index.html")).length, 1, "manager open storm created duplicate windows");  const startedAt = Date.now();

  // 1. Both windows add different tasks from the same stale snapshot.
  const additionRounds = 12;
  for (let round = 0; round < additionRounds; round += 1) {
    await prepareRaceBase();
    const left = `concurrent-widget-${round}`;
    const right = `concurrent-manager-${round}`;
    await Promise.all([
      run(win, addFromBase(left, `并发新增 ${round} A`), `widget add ${round}`),
      run(mgr, addFromBase(right, `并发新增 ${round} B`), `manager add ${round}`),
    ]);
  }
  let store = await loadFromWidget();
  for (let round = 0; round < additionRounds; round += 1) {
    assert.ok(store.items.some(item => item.id === `concurrent-widget-${round}`), `widget addition ${round} lost`);
    assert.ok(store.items.some(item => item.id === `concurrent-manager-${round}`), `manager addition ${round} lost`);
  }

  // 2. Different fields on one task must both survive.
  await seedTask("concurrent-fields", "字段原值", "详情原值");
  await prepareRaceBase();
  await Promise.all([
    run(win, editItemFromBase("concurrent-fields", { title: "字段已修改" }), "widget field merge"),
    run(mgr, editItemFromBase("concurrent-fields", { detail: "详情已修改" }), "manager field merge"),
  ]);
  store = await loadFromWidget();
  const merged = store.items.find(item => item.id === "concurrent-fields");
  assert.equal(merged?.title, "字段已修改", "title field was lost");
  assert.equal(merged?.detail, "详情已修改", "detail field was lost");

  // 3. Same-field writes must conflict quickly instead of hanging or silently overwriting.
  await seedTask("concurrent-conflict", "冲突原值");
  await prepareRaceBase();
  const naturalBroadcast = windowController.broadcast;
  windowController.broadcast = () => {};
  let conflictResults;
  const conflictStarted = Date.now();
  try {
    conflictResults = await Promise.allSettled([
      run(win, itemFromBase("concurrent-conflict", { title: "冲突 A" }), "widget conflict"),
      run(mgr, itemFromBase("concurrent-conflict", { title: "冲突 B" }), "manager conflict"),
    ]);
  } finally {
    windowController.broadcast = naturalBroadcast;
  }
  const conflictMs = Date.now() - conflictStarted;
  assert.ok(conflictMs < 4000, `same-field conflict took ${conflictMs}ms`);
  assert.equal(conflictResults.filter(result => result.status === "fulfilled").length, 1, "expected exactly one same-field winner");
  assert.equal(conflictResults.filter(result => result.status === "rejected").length, 1, "expected exactly one same-field conflict");
  assert.match(String(conflictResults.find(result => result.status === "rejected").reason), /另一窗口已修改同一内容/);

  // 4. Delete-vs-edit race must resolve to one winner, not data corruption.
  await seedTask("concurrent-delete", "删除竞争");
  await prepareRaceBase();
  windowController.broadcast = () => {};
  let deleteResults;
  try {
    deleteResults = await Promise.allSettled([
      run(win, `(async()=>{const base=window.__raceBase;return await window.deskWeek.saveStore({items:base.items.filter(item=>item.id!=='concurrent-delete'),prefs:base.prefs});})()`, "widget delete race"),
      run(mgr, editItemFromBase("concurrent-delete", { detail: "编辑与删除竞争" }), "manager edit race"),
    ]);
  } finally {
    windowController.broadcast = naturalBroadcast;
  }
  assert.equal(deleteResults.filter(result => result.status === "fulfilled").length, 1, "expected one delete/edit winner");
  assert.equal(deleteResults.filter(result => result.status === "rejected").length, 1, "expected one delete/edit conflict");
  assert.match(String(deleteResults.find(result => result.status === "rejected").reason), /另一窗口已修改该任务|该任务已被另一窗口删除/);

  // 5. A single renderer rapidly queues many saves; preload ordering must preserve all of them.
  const rapidCount = 50;
  const rapidResults = await run(win, `(async()=>{let current=await window.deskWeek.loadStore();const jobs=[];for(let i=0;i<${rapidCount};i+=1){current={...current,items:[...current.items,{id:'rapid-'+i,title:'连续保存 '+i,detail:'',date:'',time:'',defer:'none',done:false,completedAt:'',deleted:false,deletedAt:''}]};jobs.push(window.deskWeek.saveStore({items:current.items,prefs:current.prefs}));}return await Promise.allSettled(jobs);})()`, "rapid same-window saves", 20000);
  assert.equal(rapidResults.filter(result => result.status === "fulfilled").length, rapidCount, "not every rapid save completed");
  store = await loadFromWidget();
  for (let index = 0; index < rapidCount; index += 1) assert.ok(store.items.some(item => item.id === `rapid-${index}`), `rapid save ${index} lost`);

  // 6. Close the manager while it has saves queued, then reopen and repeat.
  const closeCycles = 3;
  const closeBatch = 10;
  for (let cycle = 0; cycle < closeCycles; cycle += 1) {
    if (!manager()) mgr = await openManager();
    await run(mgr, `(async()=>{let current=await window.deskWeek.loadStore();for(let i=0;i<${closeBatch};i+=1){current={...current,items:[...current.items,{id:'close-${cycle}-'+i,title:'关窗保存 ${cycle}-'+i,detail:'',date:'',time:'',defer:'none',done:false,completedAt:'',deleted:false,deletedAt:''}]};window.deskWeek.saveStore({items:current.items,prefs:current.prefs});}return true;})()`, `queue close cycle ${cycle}`);
    await sleep(10);
    mgr.close();
    await until(() => !manager(), `manager did not close in cycle ${cycle}`, 5000);
    await sleep(150);
  }
  mgr = await openManager();
  store = await loadFromWidget();
  // Closing the manager must not silently drop already-queued saves.
  let closeSurvivors = 0;
  for (let cycle = 0; cycle < closeCycles; cycle += 1) {
    const count = store.items.filter(item => item.id.startsWith(`close-${cycle}-`)).length;
    assert.equal(count, closeBatch, `close cycle ${cycle} lost queued tasks`);
    closeSurvivors += count;
  }

  // 7. Concurrent update checks must coalesce and must not block either window's save.
  await prepareRaceBase();
  const fetchBefore = fetchStarts;
  const updateCodes = Array.from({ length: 16 }, () => run(mgr, "window.deskWeek.checkForUpdates()", "manager update check", 10000));
  const widgetItems = Array.from({ length: 8 }, (_, index) => ({ id: `update-race-w-${index}`, title: `更新并发 W${index}`, detail: "", date: "", time: "", defer: "none", done: false, completedAt: "", deleted: false, deletedAt: "" }));
  const managerItems = Array.from({ length: 8 }, (_, index) => ({ id: `update-race-m-${index}`, title: `更新并发 M${index}`, detail: "", date: "", time: "", defer: "none", done: false, completedAt: "", deleted: false, deletedAt: "" }));
  const saveCodes = [
    run(win, `(async()=>{const base=window.__raceBase;return await window.deskWeek.saveStore({items:[...base.items,...${JSON.stringify(widgetItems)}],prefs:base.prefs});})()`, "widget save during updates", 10000),
    run(mgr, `(async()=>{const base=window.__raceBase;return await window.deskWeek.saveStore({items:[...base.items,...${JSON.stringify(managerItems)}],prefs:base.prefs});})()`, "manager save during updates", 10000),
  ];
  const [updateResults] = await Promise.all([Promise.all(updateCodes), Promise.all(saveCodes)]);
  assert.ok(fetchStarts - fetchBefore <= 1, `update checks made ${fetchStarts - fetchBefore} parallel requests`);
  assert.equal(maxActiveFetches, 1, "update checks overlapped");
  assert.ok(updateResults.every(info => info.latestVersion === "99.0.0"), "update results were inconsistent");
  store = await loadFromWidget();
  for (const item of [...widgetItems, ...managerItems]) assert.ok(store.items.some(current => current.id === item.id), `${item.id} lost`);

  // 8. Recreate the manager while an update callback is still in flight.
  for (let cycle = 0; cycle < 3; cycle += 1) {
    const updateDuringClose = run(win, "window.deskWeek.checkForUpdates()", `update during close ${cycle}`, 10000);
    await sleep(40);
    mgr.close();
    await until(() => !manager(), `manager did not close during update ${cycle}`, 5000);
    mgr = await openManager();
    const info = await updateDuringClose;
    assert.equal(info.latestVersion, "99.0.0", `update result changed during close ${cycle}`);
    const state = await until(async () => {
      const current = await run(mgr, "window.deskWeek.getUpdateState()", `read update state ${cycle}`);
      return current.phase === "done" ? current : null;
    }, `recreated manager missed update state ${cycle}`, 5000);
    assert.equal(state.info?.latestVersion, "99.0.0", `recreated manager state mismatch ${cycle}`);
  }

  // 9. Toggle the widget's window mode while writes are happening.
  await Promise.all(Array.from({ length: 12 }, (_, index) => run(win, `window.deskWeek.setMiniMode(${index % 2 === 0})`, `mini toggle ${index}`, 8000)));
  await run(win, "window.deskWeek.setMiniMode(false)", "restore full widget", 8000);
  await sleep(300);
  assert.ok(widget() && !widget().isDestroyed(), "widget was lost during mode toggles");

  store = await loadFromWidget();
  assert.equal(Number.isSafeInteger(store.revision), true, "revision is not an integer");
  const dataFile = path.join(profile, "data.json");
  const backupFile = `${dataFile}.backup`;
  const disk = JSON.parse(fs.readFileSync(dataFile, "utf8"));
  assert.ok(Array.isArray(disk.items), "data.json is not a valid store");
  assert.equal(disk.revision, store.revision, "in-memory and on-disk revisions diverged");
  if (fs.existsSync(backupFile)) assert.ok(Array.isArray(JSON.parse(fs.readFileSync(backupFile, "utf8")).items), "backup JSON is invalid");
  assert.equal(errors.length, 0, errors.join("\n"));

  const metrics = app.getAppMetrics();
  console.log("CONCURRENCY_REGRESSION_PASS", JSON.stringify({
    profile,
    elapsedMs: Date.now() - startedAt,
    revision: store.revision,
    tasks: store.items.length,
    fetchStarts,
    maxActiveFetches,
    conflictMs,
    closeSurvivors,
    processes: metrics.length,
    workingSetMB: Math.round(metrics.reduce((sum, item) => sum + item.memory.workingSetSize, 0) / 1024),
    checks: [
      "two-window stale-snapshot additions",
      "different-field merge",
      "same-field conflict timeout",
      "delete/edit race",
      "50 queued same-window saves",
      "manager close during saves",
      "concurrent update-check coalescing",
      "save while update checks run",
      "full update notes",
      "manager recreation during update callback",
      "manager minimize restore",
      "manager open storm",
      "mini mode toggle storm",
      "valid primary and backup JSON",
      "no renderer console errors",
    ],
  }));
  app.quit();
}).catch(error => {
  console.error("CONCURRENCY_REGRESSION_FAIL", error.stack);
  console.log("Concurrency state:", JSON.stringify({
    profile,
    widget: Boolean(widget()),
    manager: Boolean(manager()),
    windows: BrowserWindow.getAllWindows().map(win => ({ title: win.getTitle(), url: win.webContents.getURL(), visible: win.isVisible() })),
    errors,
  }));
  app.exit(1);
});

app.on("will-quit", () => {
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Chromium may release profile files after exit */ }
});


