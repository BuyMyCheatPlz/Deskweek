"use strict";

const { app, BrowserWindow, ipcMain, screen, shell, Tray, Menu, nativeImage, safeStorage } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { performance } = require("node:perf_hooks");
const koffi = require("koffi");
const { createDesktopManager } = require("./lib/desktop.cjs");

app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");

const desktop = createDesktopManager();
let mainWindow = null;
let managerWindow = null;
let tray = null;
let storeCache = null;
let gesture = null;
let gestureImmediate = null;
let miniMode = false;
let preMiniBounds = null;
const user32 = koffi.load("user32.dll");
const GetAsyncKeyState = user32.func("short __stdcall GetAsyncKeyState(int vKey)");

const openManagerOnStart = process.argv.includes("--open-manager");
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      desktop.focus(mainWindow);
    }
    if (Array.isArray(argv) && argv.includes("--open-manager")) createManagerWindow();
  });
}

function portableDataDir() {
  return app.isPackaged ? path.join(path.dirname(process.execPath), "data") : path.join(__dirname, "data");
}

function stateFile() {
  return path.join(portableDataDir(), "window-state.json");
}

function dataFile() {
  return path.join(portableDataDir(), "data.json");
}

const DEFAULT_AI_CONFIG = {
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o-mini",
};

function aiConfigFile() {
  return path.join(portableDataDir(), "ai-config.json");
}

function readAIConfigFile() {
  try {
    const parsed = JSON.parse(fs.readFileSync(aiConfigFile(), "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function aiKeyStatus(config) {
  if (typeof config?.keyEncrypted !== "string" || !config.keyEncrypted) {
    return { hasKey: false, keyInvalid: false };
  }
  if (!safeStorage.isEncryptionAvailable()) {
    return { hasKey: false, keyInvalid: true };
  }
  try {
    return { hasKey: Boolean(decryptAIKey(config)), keyInvalid: false };
  } catch {
    return { hasKey: false, keyInvalid: true };
  }
}

function publicAIConfig() {
  const config = readAIConfigFile();
  const keyStatus = aiKeyStatus(config);
  return {
    baseUrl: typeof config.baseUrl === "string" && config.baseUrl.trim() ? config.baseUrl.trim() : DEFAULT_AI_CONFIG.baseUrl,
    model: typeof config.model === "string" && config.model.trim() ? config.model.trim() : DEFAULT_AI_CONFIG.model,
    hasKey: keyStatus.hasKey,
    keyInvalid: keyStatus.keyInvalid,
    autoTranslate: Boolean(config.autoTranslate),
  };
}

function writeAIConfig(config) {
  fs.mkdirSync(path.dirname(aiConfigFile()), { recursive: true });
  const temp = `${aiConfigFile()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(config), "utf8");
  fs.renameSync(temp, aiConfigFile());
}

function saveAIConfig(next = {}) {
  const current = readAIConfigFile();
  const baseUrl = String(next.baseUrl || DEFAULT_AI_CONFIG.baseUrl).trim().replace(/\/+$/, "");
  let parsed;
  try { parsed = new URL(baseUrl); } catch { throw new Error("接口地址格式不正确"); }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("接口地址必须是 http 或 https");
  const model = String(next.model || DEFAULT_AI_CONFIG.model).trim();
  if (!model) throw new Error("请填写模型名称");
  let keyEncrypted = typeof current.keyEncrypted === "string" ? current.keyEncrypted : "";
  if (next.clearKey) keyEncrypted = "";
  else if (String(next.apiKey || "").trim()) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("当前系统无法安全保存 API Key");
    keyEncrypted = safeStorage.encryptString(String(next.apiKey).trim()).toString("base64");
  }
  const autoTranslate = typeof next.autoTranslate === "boolean" ? next.autoTranslate : Boolean(current.autoTranslate);
  writeAIConfig({ baseUrl, model, keyEncrypted, autoTranslate, updatedAt: new Date().toISOString() });
  return publicAIConfig();
}

function decryptAIKey(config) {
  if (!config.keyEncrypted) return "";
  if (!safeStorage.isEncryptionAvailable()) throw new Error("当前系统无法读取 API Key，请在设置中重新填写");
  try {
    const value = safeStorage.decryptString(Buffer.from(config.keyEncrypted, "base64"));
    if (!value) throw new Error("empty key");
    return value;
  } catch {
    throw new Error("AI 密钥已失效，请在设置中重新填写 API Key");
  }
}

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function validDateKey(value) {
  const text = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [year, month, day] = text.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function parseAIJson(content) {
  const text = String(content || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI 返回内容不是有效 JSON");
  return JSON.parse(text.slice(start, end + 1));
}

async function summarizeWithAI(payload = {}) {
  const config = readAIConfigFile();
  const publicConfig = publicAIConfig();
  if (publicConfig.keyInvalid) throw new Error("AI 密钥已失效，请在设置中重新填写 API Key");
  const apiKey = decryptAIKey(config);
  if (!apiKey) throw new Error("请先在管理中心配置 AI 接口");
  const sourceText = String(payload.text || "").trim();
  const images = Array.isArray(payload.images) ? payload.images.slice(0, 4) : [];
  if (!sourceText && !images.length) throw new Error("先粘贴文字或添加图片");
  for (const image of images) {
    if (typeof image !== "string" || !/^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(image)) throw new Error("图片格式不支持");
    if (image.length > 9_000_000) throw new Error("单张图片不能超过 6MB");
  }
  const baseUrl = publicConfig.baseUrl.replace(/\/+$/, "");
  const endpoint = baseUrl.endsWith("/chat/completions") ? baseUrl : `${baseUrl}/chat/completions`;
  const today = localDateKey();
  const isChineseOutput = publicConfig.autoTranslate;
  const firstPromptLine = isChineseOutput
    ? "你是 DeskWeek 的任务整理助手。请从用户提供的邮件、通知、聊天文字或图片中提取待办事项。若用户给出的内容不是中文，则先翻译成中文，再进行总结，其中所有的人名保留原文，地名、专有名词和专业性名词等以类似apple（苹果）的形式给出。"
    : "你是 DeskWeek 的任务整理助手。请从用户提供的邮件、通知、聊天文字或图片中提取待办事项。保留用户原文的主要语言，不要自行翻译。";
  const titleRule = isChineseOutput
    ? "title：使用中文，不超过 30 个汉字，直接说明要做什么，不要照抄整段原文。"
    : "title：保留原文主要语言，直接说明要做什么，保持简短，不要翻译，不要照抄整段原文。";
  const detailRule = isChineseOutput
    ? "detail：只保留会直接影响执行的重要、明确信息，删掉寒暄、重复和无关内容。每项信息单独一行，统一写成“字段：内容”；字段名按内容命名，例如发布机构、客户公式、官网、文件格式、截止时间、地点、提交方式、注意事项。没有的字段不要输出，不要把多项信息挤成一段，也不要编造。JSON 字符串内用 \\n 表示换行。"
    : "detail：只保留会直接影响执行的重要、明确信息，删掉寒暄、重复和无关内容。每项信息单独一行，统一写成“字段：内容”；字段名和内容都保留原文主要语言，不要翻译；字段名按内容命名。没有的字段不要输出，不要把多项信息挤成一段，也不要编造。JSON 字符串内用 \\n 表示换行。";
  const detailExample = isChineseOutput
    ? 'detail 示例："发布机构：…\\n客户公式：…\\n官网：…\\n文件格式：…"'
    : 'detail 示例（仅表示格式，字段名和内容使用原文语言）："<field>: <value>\\n<field>: <value>"';
  const systemPrompt = [
    firstPromptLine,
    "只输出一个合法 JSON 对象，不要 Markdown、代码块或额外解释。",
    'JSON 格式：{"title":"主标题","detail":"详细信息","date":"YYYY-MM-DD或空字符串","time":"HH:mm或空字符串","defer":"none|7d|1m或Nd"}',
    titleRule,
    detailRule,
    detailExample,
    "date 和 time：只填原文明确给出的值；只有时间没有日期时 date 留空；无法确定的相对日期不要猜；两者都没有时都为空。",
    "defer：没有明确要求时固定填 none。",
  ].join("\n");
  const content = [{ type: "text", text: sourceText || "请整理图片中的任务信息。" }];
  images.forEach((url) => content.push({ type: "image_url", image_url: { url } }));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: publicConfig.model,
        temperature: 0.1,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const errorText = (await response.text()).slice(0, 600).replace(/\s+/g, " ").trim();
      throw new Error(`AI 接口请求失败（${response.status}）${errorText ? "：" + errorText : ""}`);
    }
    const data = await response.json();
    const raw = data?.choices?.[0]?.message?.content;
    const text = Array.isArray(raw) ? raw.map((part) => part?.text || "").join("") : raw;
    const result = parseAIJson(text);
    let date = validDateKey(result.date) ? result.date : "";
    let time = /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(result.time || "")) ? String(result.time) : "";
    if (time && !date) date = today;
    const deferText = String(result.defer || "none").toLowerCase();
    const defer = deferText === "1m" || /^[1-9]\d*d$/.test(deferText) ? deferText : "none";
    return {
      title: String(result.title || "").trim().slice(0, 60),
      detail: String(result.detail || "").trim().slice(0, 4000),
      date,
      time,
      defer,
    };
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("AI 请求超时");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
function migrateLegacyStore() {
  try {
    if (fs.existsSync(dataFile())) return;
    const legacy = path.join(app.getPath("userData"), "data.json");
    if (!fs.existsSync(legacy)) return;
    fs.mkdirSync(portableDataDir(), { recursive: true });
    fs.copyFileSync(legacy, dataFile());
  } catch { /* portable data migration is best effort */ }
}

function emptyStore() {
  return { initialized: false, items: [], prefs: {} };
}

function readStore() {
  if (!fs.existsSync(dataFile())) return emptyStore();
  let raw;
  try {
    raw = fs.readFileSync(dataFile(), "utf8");
  } catch {
    return { ...emptyStore(), loadError: "unreadable" };
  }
  try {
    const parsed = JSON.parse(raw);
    return {
      initialized: true,
      items: Array.isArray(parsed.items) ? parsed.items : [],
      prefs: parsed.prefs && typeof parsed.prefs === "object" ? parsed.prefs : {},
    };
  } catch {
    let preserved = "";
    try {
      preserved = `${dataFile()}.corrupt-${Date.now()}`;
      fs.copyFileSync(dataFile(), preserved);
    } catch { /* keep the original in place when it cannot be copied */ }
    return { ...emptyStore(), loadError: "invalid-json", preserved };
  }
}

function writeStore(next) {
  const payload = {
    initialized: true,
    items: Array.isArray(next?.items) ? next.items : [],
    prefs: next?.prefs && typeof next.prefs === "object" ? next.prefs : {},
    updatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(dataFile()), { recursive: true });
  try {
    if (fs.existsSync(dataFile())) fs.copyFileSync(dataFile(), `${dataFile()}.backup`);
  } catch { /* best effort */ }
  const temp = `${dataFile()}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(payload), "utf8");
  fs.copyFileSync(temp, dataFile());
  try { fs.unlinkSync(temp); } catch { /* best effort */ }
  storeCache = payload;
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send("deskweek:store-changed", payload);
  }
  return payload;
}

function readWindowState() {
  try {
    const value = JSON.parse(fs.readFileSync(stateFile(), "utf8"));
    if (["x", "y", "width", "height"].every((key) => Number.isFinite(value[key]))) return value;
  } catch { /* first run */ }
  return null;
}

function persistWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    const bounds = desktop.getBounds(mainWindow, screen);
    fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
    fs.writeFileSync(stateFile(), JSON.stringify(bounds), "utf8");
  } catch { /* cosmetics only */ }
}

function defaultBounds(area) {
  const width = 880;
  const height = 690;
  return {
    width,
    height,
    x: Math.round(area.x + Math.min(110, Math.max(20, area.width - width - 20))),
    y: Math.round(area.y + Math.min(240, Math.max(20, area.height - height - 20))),
  };
}

function validBounds(bounds) {
  const area = screen.getPrimaryDisplay().workArea;
  return Boolean(bounds)
    && bounds.x + 80 > area.x && bounds.x < area.x + area.width - 80
    && bounds.y + 50 > area.y && bounds.y < area.y + area.height - 50;
}

function createWindow() {
  const area = screen.getPrimaryDisplay().workArea;
  const saved = readWindowState();
  const initial = validBounds(saved) ? saved : defaultBounds(area);

  mainWindow = new BrowserWindow({
    x: initial.x,
    y: initial.y,
    width: Math.max(420, initial.width),
    height: Math.max(280, initial.height),
    minWidth: 420,
    minHeight: 280,
    maxWidth: 1600,
    maxHeight: 1000,
    frame: false,
    thickFrame: false,
    transparent: true,
    backgroundColor: "#00000000",
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    hasShadow: false,
    skipTaskbar: true,
    show: false,
    title: "DeskWeek",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  mainWindow.setMenu(null);
  try { mainWindow.setBackgroundMaterial("acrylic"); } catch { /* CSS glass fallback */ }
  mainWindow.setAlwaysOnTop(false);
  mainWindow.loadFile("index.html");

  mainWindow.once("ready-to-show", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.showInactive();
    try {
      desktop.apply(mainWindow, "desktop", { initialShape: "card" });
      setTimeout(persistWindowState, 500);
    } catch (error) {
      console.warn("desktop attach failed:", error.message);
      mainWindow.show();
      mainWindow.setAlwaysOnTop(true, "normal");
    }
  });

  mainWindow.on("closed", () => {
    persistWindowState();
    mainWindow = null;
  });
}

function createManagerWindow() {
  if (managerWindow && !managerWindow.isDestroyed()) {
    managerWindow.show();
    managerWindow.focus();
    return managerWindow;
  }
  managerWindow = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 900,
    minHeight: 620,
    center: true,
    frame: false,
    thickFrame: true,
    transparent: false,
    backgroundColor: "#f5f7fa",
    resizable: true,
    maximizable: true,
    minimizable: true,
    fullscreenable: false,
    show: false,
    title: "DeskWeek 管理中心",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
managerWindow.setMenu(null);
  managerWindow.loadFile("manager.html");
  const sendManagerWindowState = () => {
    if (!managerWindow || managerWindow.isDestroyed()) return;
    managerWindow.webContents.send("deskweek:manager-window-state", { maximized: managerWindow.isMaximized() });
  };
  managerWindow.on("maximize", sendManagerWindowState);
  managerWindow.on("unmaximize", sendManagerWindowState);
  managerWindow.once("ready-to-show", () => {
    if (managerWindow && !managerWindow.isDestroyed()) managerWindow.show();
  });
  managerWindow.on("closed", () => { managerWindow = null; });
  return managerWindow;
}

function setMiniMode(enabled) {
  if (!mainWindow || mainWindow.isDestroyed()) return { enabled: false };
  if (enabled && !miniMode) {
    preMiniBounds = desktop.getBounds(mainWindow, screen);
    miniMode = true;
    try { mainWindow.setResizable(false); } catch { /* best effort */ }
    const display = screen.getDisplayMatching(preMiniBounds);
    const area = display.workArea;
    const width = Math.min(420, Math.max(360, area.width - 24));
    const height = Math.min(300, Math.max(250, area.height - 24));
    const bounds = {
      x: area.x + area.width - width - 16,
      y: area.y + area.height - height - 16,
      width,
      height,
    };
    desktop.setBounds(mainWindow, bounds, screen, { reshape: true });
    try { desktop.setShape(mainWindow, "card"); } catch { /* best effort */ }
  } else if (!enabled && miniMode) {
    miniMode = false;
    try { mainWindow.setResizable(true); } catch { /* best effort */ }
    if (preMiniBounds) desktop.setBounds(mainWindow, preMiniBounds, screen, { reshape: true });
    preMiniBounds = null;
    try { desktop.setShape(mainWindow, "card"); } catch { /* best effort */ }
  }
  return { enabled: miniMode };
}

function toggleWidgetVisibility() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isVisible()) { mainWindow.hide(); return; }
  mainWindow.show();
  try { desktop.focus(mainWindow); } catch { /* best effort */ }
}

function createTray() {
  if (tray && !tray.isDestroyed()) return tray;
  const icon = nativeImage.createFromPath(path.join(__dirname, "tray.png")).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip("DeskWeek");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "管理中心", click: () => createManagerWindow() },
    { label: "显示/隐藏浮窗", click: () => toggleWidgetVisibility() },
    { type: "separator" },
    { label: "退出", click: () => app.quit() },
  ]));
  tray.on("click", () => createManagerWindow());
  return tray;
}

function beginGesture(kind) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (kind !== "move") { try { desktop.setShape(mainWindow, "rect"); } catch { /* best effort */ } }
  if (gestureImmediate) clearImmediate(gestureImmediate);
  gesture = {
    kind,
    startBounds: desktop.getBounds(mainWindow, screen),
    startCursor: screen.getCursorScreenPoint(),
  };
  gesture.lastMove = 0;
  const tick = () => {
    if (!gesture || !mainWindow || mainWindow.isDestroyed()) return endGesture();
    const down = (Number(GetAsyncKeyState(1)) & 0x8000) !== 0;
    if (!down) return endGesture();
    const now = performance.now();
    if (now - gesture.lastMove >= 4) {
      gesture.lastMove = now;
      moveGesture();
    }
    gestureImmediate = setImmediate(tick);
  };
  gestureImmediate = setImmediate(tick);
}

function moveGesture() {
  if (!gesture || !mainWindow || mainWindow.isDestroyed()) return;
  const cursor = screen.getCursorScreenPoint();
  const dx = cursor.x - gesture.startCursor.x;
  const dy = cursor.y - gesture.startCursor.y;
  const start = gesture.startBounds;
  if (gesture.kind === "move") {
    const display = screen.getDisplayNearestPoint(cursor);
    const area = display.workArea;
    const x = Math.max(area.x - start.width + 100, Math.min(area.x + area.width - 100, start.x + dx));
    const y = Math.max(area.y, Math.min(area.y + area.height - 80, start.y + dy));
    desktop.setBounds(mainWindow, { x, y, width: start.width, height: start.height }, screen, { reshape: false });
  } else {
    const edge = gesture.kind;
    let width = start.width;
    let height = start.height;
    let x = start.x;
    let y = start.y;
    if (edge.includes("e")) width = start.width + dx;
    if (edge.includes("w")) width = start.width - dx;
    if (edge.includes("s")) height = start.height + dy;
    if (edge.includes("n")) height = start.height - dy;
    width = Math.max(420, Math.min(1600, width));
    height = Math.max(280, Math.min(1000, height));
    if (edge.includes("w")) x = start.x + (start.width - width);
    if (edge.includes("n")) y = start.y + (start.height - height);
    desktop.setBounds(mainWindow, { x, y, width, height }, screen, { reshape: false });
  }
}

function endGesture() {
  if (gestureImmediate) { clearImmediate(gestureImmediate); gestureImmediate = null; }
  if (gesture && mainWindow && !mainWindow.isDestroyed()) {
    try { desktop.setShape(mainWindow, "card"); } catch { /* best effort */ }
    try { mainWindow.webContents.send("deskweek:gesture-ended"); } catch { /* best effort */ }
  }
  if (gesture) persistWindowState();
  gesture = null;
}

app.whenReady().then(() => {
  app.setAppUserModelId("com.xiaoxia.deskweek.float");
  migrateLegacyStore();
  storeCache = readStore();
  createTray();
  createWindow();
  if (openManagerOnStart) setTimeout(() => createManagerWindow(), 350);
});

app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => { if (tray && !tray.isDestroyed()) { tray.destroy(); tray = null; } });

ipcMain.on("deskweek:quit", () => app.quit());
ipcMain.on("deskweek:drag-start", () => beginGesture("move"));
ipcMain.on("deskweek:resize-start", (_event, edge) => beginGesture(edge || "se"));
ipcMain.on("deskweek:gesture-end", () => endGesture());

ipcMain.handle("deskweek:store-load", () => {
  if (!storeCache) storeCache = readStore();
  return storeCache;
});

ipcMain.handle("deskweek:store-save", (_event, next) => writeStore(next));
ipcMain.handle("deskweek:set-mini-mode", (_event, enabled) => setMiniMode(Boolean(enabled)));

ipcMain.on("deskweek:open-manager", () => createManagerWindow());

ipcMain.on("deskweek:manager-minimize", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) win.minimize();
});

ipcMain.handle("deskweek:manager-toggle-maximize", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return false;
  if (win.isMaximized()) win.unmaximize(); else win.maximize();
  return win.isMaximized();
});

ipcMain.on("deskweek:manager-close", (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) win.close();
});

ipcMain.handle("deskweek:ai-config-get", () => publicAIConfig());
ipcMain.handle("deskweek:ai-config-save", (_event, next) => saveAIConfig(next));
ipcMain.handle("deskweek:ai-summarize", (_event, payload) => summarizeWithAI(payload));

ipcMain.handle("deskweek:get-autostart", () => app.getLoginItemSettings().openAtLogin);

ipcMain.handle("deskweek:set-autostart", (_event, enabled) => {
  app.setLoginItemSettings({ openAtLogin: Boolean(enabled), path: process.execPath });
  return app.getLoginItemSettings().openAtLogin;
});

ipcMain.handle("deskweek:open-data-folder", async () => {
  const result = await shell.openPath(portableDataDir());
  return result || "";
});

ipcMain.on("deskweek:focus-sync", (event) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    desktop.focus(mainWindow);
    mainWindow.webContents.focus();
  }
  event.returnValue = true;
});























