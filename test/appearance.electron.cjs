"use strict";
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const assert = require("node:assert/strict");
const { app } = require("electron");
const appRoot = process.env.DESKWEEK_APP_ROOT || path.resolve(__dirname, "..");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "deskweek-appearance-"));
process.env.DESKWEEK_DATA_DIR = profile;
const day = new Date(), key = `${day.getFullYear()}-${String(day.getMonth()+1).padStart(2,"0")}-${String(day.getDate()).padStart(2,"0")}`;
fs.writeFileSync(path.join(profile, "data.json"), JSON.stringify({ initialized: true, items: [
  { id: "design-1", title: "整理本周计划", date: key, time: "10:30", done: false },
  { id: "design-2", title: "阅读与灵感笔记", date: key, time: "15:00", done: false },
  { id: "design-3", title: "留一点时间散步", date: key, time: "18:30", done: false },
], prefs: { theme: "dark" } }));
let controller;
const windowsModule = require(path.join(appRoot,"src/main/windows/windows.cjs")), create = windowsModule.createWindows;
windowsModule.createWindows = (...args) => controller = create(...args);
// Only appearance is under test here; real fullscreen behavior has its own suite.
const shellModule = require(path.join(appRoot,"src/main/desktop/windows-shell.cjs")), shell = shellModule.createWindowsShell;
shellModule.createWindowsShell = (...args) => { const result = shell(...args); result.fullscreen = () => false; return result; };
function fail(error) { console.error("APPEARANCE_REGRESSION_FAIL", error.stack || error); app.exit(1); }
process.on("uncaughtException",fail); process.on("unhandledRejection",fail);
require(path.join(appRoot,"src/main/index.cjs"));
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
async function until(check, message) { const end = Date.now()+12000; while (Date.now()<end) { const result = await check(); if(result)return result; await sleep(60); } throw new Error(message); }
app.whenReady().then(async()=>{
  let win = await until(()=>{ const w=controller.widget(); return w&&!w.isDestroyed()&&!w.webContents.isLoading()&&w.isVisible()&&w; },"Widget did not load");
  const js = code => win.webContents.executeJavaScript(code,true);
  await until(()=>js("document.querySelectorAll('.task-row').length === 3"),"Seed tasks missing");
  const manager = controller.showManager();
  await until(()=>!manager.webContents.isLoading()&&manager.isVisible(),"Manager did not load");
  const mjs = code => manager.webContents.executeJavaScript(code,true);
  await mjs("document.querySelector('[data-section=settings]').click(); document.querySelector('[data-widget-background-choice=transparent]').click()");
  await until(()=>js("document.documentElement.dataset.widgetBackground === 'transparent'"),"Preference did not reach widget");
  async function surfaces(){
    const result=await js(`([...document.querySelectorAll('.desk,.week-card,.task-card,.day-column,.week-item,.task-row,.floating-month-day,.floating-day-panel,.calendar-task-toggle,.add-form,.add-form input,.add-form .dw-date-control,.add-form .dw-time-control')].map(el=>({name:el.className,bg:getComputedStyle(el).backgroundColor,image:getComputedStyle(el).backgroundImage,blur:getComputedStyle(el).backdropFilter})))`);
    for(const s of result){assert.equal(s.bg,"rgba(0, 0, 0, 0)",JSON.stringify(s));assert.equal(s.image,"none",JSON.stringify(s));assert.equal(s.blur,"none",JSON.stringify(s));}
  }
  const previews = new Map();
  for(const theme of ["light","dark"]){
    await mjs(`document.querySelector('[data-theme-choice=${theme}]').click()`);
    await until(()=>js(`document.body.classList.contains('theme-${theme}')`),"Theme did not synchronize");
    for(const mode of ["month","day","week"]){
      await js(`document.querySelector('[data-floating-cal-mode=${mode}]').click()`);
      await surfaces();
    }
    await js("document.body.classList.add('gesturing')"); await surfaces();
    await js("document.body.classList.remove('gesturing')");
    for(const picker of [{trigger:'.dw-date-trigger',id:'dwDatePopover',title:'.dw-date-title'}, {trigger:'.dw-time-trigger',id:'dwTimePopover',title:'.dw-time-head strong'}, {trigger:'#newDefer .defer-trigger',id:'dwDeferPopover',title:'.dw-defer-title'}]){
      await js(`document.querySelector(${JSON.stringify(picker.trigger)}).click()`);
      const colors=await js(`(()=>{const p=document.getElementById(${JSON.stringify(picker.id)});return {visible:!p.hidden,bg:getComputedStyle(p).backgroundColor,color:getComputedStyle(p.querySelector(${JSON.stringify(picker.title)})||p).color};})()`);
      assert.equal(colors.visible,true); assert.equal(colors.bg,'rgba(24, 24, 27, 0.88)');
      assert.equal(colors.color,'rgb(245, 245, 247)',JSON.stringify({picker,colors}));
      await js("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))");
    }
    if(process.env.DESKWEEK_PREVIEW){
      const background=theme==="dark" ? "radial-gradient(ellipse at 85% 12%, #416488, transparent 62%), linear-gradient(130deg,#0c1426,#20364f)" : "radial-gradient(ellipse at 85% 12%, #d2ddf0, transparent 65%), linear-gradient(130deg,#efede6,#c6d6d3)";
      await js(`document.documentElement.style.setProperty('background',${JSON.stringify(background)},'important')`);
      await sleep(150); previews.set(`/${theme}.png`,(await win.webContents.capturePage()).toPNG());
      await js("document.documentElement.style.removeProperty('background')");
    }
  }
  await js("document.querySelector('#newTitle').value='外观切换后新增';document.querySelector('#addForm').requestSubmit()");
  await until(()=>js("window.deskWeek.loadStore().then(s=>s.items.some(i=>i.title==='外观切换后新增')&&s.prefs.widgetBackground==='transparent')"),"Widget save lost background preference");
  controller.releaseWidget(); controller.restoreWidget();
  win = await until(()=>{const w=controller.widget();return w&&!w.webContents.isLoading()&&w.isVisible()&&w;},"Restored widget did not load");
  await until(()=>js("document.documentElement.dataset.widgetBackground==='transparent'"),"Recreation lost transparency");
  await surfaces();
  assert.equal(await mjs("document.querySelector('[data-widget-background-choice=transparent]').getAttribute('aria-pressed')"),"true");
  await mjs("document.querySelector('[data-widget-background-choice=standard]').click()");
  await until(()=>js("document.documentElement.dataset.widgetBackground==='standard'&&getComputedStyle(document.querySelector('.desk')).backgroundImage!=='none'"),"Standard appearance did not restore");
  console.log("APPEARANCE_REGRESSION_PASS",JSON.stringify({themes:2,calendarModes:3,synchronized:true,widgetSaveRetainedPreference:true,recreationRetainedPreference:true,reversible:true}));
  if(previews.size){
    const server=require("node:http").createServer((request,response)=>{const data=previews.get(request.url);response.writeHead(data?200:404,{"Content-Type":"image/png"});response.end(data);});
    await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
    console.log("APPEARANCE_PREVIEW_PORT",server.address().port);
    setTimeout(()=>{server.close();app.quit();},60000);
  }else app.quit();
}).catch(fail);
