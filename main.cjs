"use strict";

const { app, BrowserWindow, ipcMain, screen, shell, Tray, Menu, nativeImage, safeStorage } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { performance } = require("node:perf_hooks");
const mammoth = require("mammoth");
const XLSX = require("xlsx");
const pdfParse = require("pdf-parse");
const WordExtractor = require("word-extractor");
const JSZip = require("jszip");
const koffi = require("koffi");
const { createDesktopManager } = require("./lib/desktop.cjs");
const { checkGithubUpdate, downloadAndInstallUpdate } = require("./lib/updater.cjs");

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

function aiConfigBackupFile() {
  return path.join(portableDataDir(), "ai-config.backup.json");
}

function aiKeyFile() {
  return path.join(portableDataDir(), "ai-key.dat");
}

function aiKeyBackupFile() {
  return path.join(portableDataDir(), "ai-key.backup.dat");
}

function readTextFile(file) {
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch {
    return "";
  }
}

function writeTextFileAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, String(value), "utf8");
  fs.renameSync(temp, file);
}

function readAIConfigFile() {
  for (const file of [aiConfigFile(), aiConfigBackupFile()]) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      if (parsed && typeof parsed === "object") return parsed;
    } catch { /* try the backup */ }
  }
  return {};
}

function readEncryptedAIKeyCandidates() {
  const legacy = readAIConfigFile().keyEncrypted;
  const candidates = [readTextFile(aiKeyFile()), readTextFile(aiKeyBackupFile()), typeof legacy === "string" ? legacy.trim() : ""];
  return [...new Set(candidates.filter(Boolean))];
}

function decryptAIKey(config) {
  if (!config?.keyEncrypted) return "";
  if (!safeStorage.isEncryptionAvailable()) throw new Error("当前系统无法读取 API Key，请在设置中重新填写");
  try {
    const value = safeStorage.decryptString(Buffer.from(config.keyEncrypted, "base64"));
    if (!value) throw new Error("empty key");
    return value;
  } catch {
    throw new Error("AI 密钥已失效，请在设置中重新填写 API Key");
  }
}

function readUsableAIKey() {
  const candidates = readEncryptedAIKeyCandidates();
  if (!candidates.length) return { apiKey: "", keyEncrypted: "", keyInvalid: false };
  if (!safeStorage.isEncryptionAvailable()) return { apiKey: "", keyEncrypted: candidates[0], keyInvalid: true };
  for (const keyEncrypted of candidates) {
    try {
      const apiKey = decryptAIKey({ keyEncrypted });
      if (apiKey) {
        if (readTextFile(aiKeyFile()) !== keyEncrypted) writeEncryptedAIKey(keyEncrypted);
        return { apiKey, keyEncrypted, keyInvalid: false };
      }
    } catch { /* try the backup key */ }
  }
  return { apiKey: "", keyEncrypted: candidates[0], keyInvalid: true };
}

function writeEncryptedAIKey(keyEncrypted) {
  if (!keyEncrypted) return;
  const existing = readTextFile(aiKeyFile());
  if (existing && existing !== keyEncrypted) {
    try {
      decryptAIKey({ keyEncrypted: existing });
      writeTextFileAtomic(aiKeyBackupFile(), existing);
    } catch { /* do not overwrite a valid backup with a broken key */ }
  }
  writeTextFileAtomic(aiKeyFile(), keyEncrypted);
}

function clearEncryptedAIKey() {
  for (const file of [aiKeyFile(), aiKeyBackupFile()]) {
    try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch { /* best effort */ }
  }
}

function publicAIConfig() {
  const config = readAIConfigFile();
  const keyState = readUsableAIKey();
  return {
    baseUrl: typeof config.baseUrl === "string" && config.baseUrl.trim() ? config.baseUrl.trim() : DEFAULT_AI_CONFIG.baseUrl,
    model: typeof config.model === "string" && config.model.trim() ? config.model.trim() : DEFAULT_AI_CONFIG.model,
    hasKey: Boolean(keyState.apiKey),
    keyInvalid: keyState.keyInvalid,
    autoTranslate: Boolean(config.autoTranslate),
  };
}

function writeAIConfig(config) {
  const file = aiConfigFile();
  if (fs.existsSync(file)) {
    try { fs.copyFileSync(file, aiConfigBackupFile()); } catch { /* best effort */ }
  }
  writeTextFileAtomic(file, JSON.stringify(config));
}

function saveAIConfig(next = {}) {
  readUsableAIKey();
  const current = readAIConfigFile();
  const baseUrl = String(next.baseUrl || DEFAULT_AI_CONFIG.baseUrl).trim().replace(/\/+$/, "");
  let parsed;
  try { parsed = new URL(baseUrl); } catch { throw new Error("接口地址格式不正确"); }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("接口地址必须是 http 或 https");
  const model = String(next.model || DEFAULT_AI_CONFIG.model).trim();
  if (!model) throw new Error("请填写模型名称");
  if (next.clearKey) {
    clearEncryptedAIKey();
  } else if (String(next.apiKey || "").trim()) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("当前系统无法安全保存 API Key");
    writeEncryptedAIKey(safeStorage.encryptString(String(next.apiKey).trim()).toString("base64"));
  }
  const autoTranslate = typeof next.autoTranslate === "boolean" ? next.autoTranslate : Boolean(current.autoTranslate);
  writeAIConfig({ baseUrl, model, autoTranslate, updatedAt: new Date().toISOString() });
  if (next.clearKey) {
    try { fs.copyFileSync(aiConfigFile(), aiConfigBackupFile()); } catch { /* best effort */ }
  }
  return publicAIConfig();
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

const AI_FILE_MAX_COUNT = 5;
const AI_FILE_MAX_BYTES = 20 * 1024 * 1024;
const AI_FILE_MAX_CHARS = 60_000;
const AI_FILE_TOTAL_CHARS = 120_000;
const AI_TEXT_EXTENSIONS = new Set([".txt", ".md", ".markdown", ".json", ".xml", ".yaml", ".yml", ".log"]);
const AI_WORKBOOK_EXTENSIONS = new Set([".xlsx", ".xls", ".xlsm", ".ods", ".csv"]);
const AI_SUPPORTED_EXTENSIONS = new Set([".pdf", ".doc", ".docx", ".pptx", ".odt", ".rtf", ...AI_TEXT_EXTENSIONS, ...AI_WORKBOOK_EXTENSIONS]);

function decodeDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:([^;,]*)(;base64)?,([\s\S]*)$/i);
  if (!match || !match[2]) throw new Error("文件内容格式不正确");
  return Buffer.from(match[3], "base64");
}

function decodeXmlEntities(text) {
  return String(text || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)));
}

function bufferToText(buffer) {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.subarray(2).toString("utf16le");
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const copy = Buffer.from(buffer.subarray(2));
    copy.swap16();
    return copy.toString("utf16le");
  }
  return buffer.toString("utf8");
}

function normalizeDocumentText(text) {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

async function extractPptxText(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const slides = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => Number(a.match(/slide(\d+)/i)?.[1] || 0) - Number(b.match(/slide(\d+)/i)?.[1] || 0));
  const parts = [];
  for (const name of slides) {
    const xml = await zip.file(name).async("string");
    const texts = [...xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/gi)].map((match) => decodeXmlEntities(match[1]).trim()).filter(Boolean);
    if (texts.length) parts.push(`第 ${parts.length + 1} 页\n${texts.join("\n")}`);
  }
  return parts.join("\n\n");
}

async function extractOdtText(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const file = zip.file("content.xml");
  if (!file) return "";
  const xml = await file.async("string");
  return decodeXmlEntities(xml.replace(/<text:(?:p|h)[^>]*>/gi, "\n").replace(/<[^>]+>/g, " "));
}

function extractRtfText(buffer) {
  return bufferToText(buffer)
    .replace(/\\'[0-9a-f]{2}/gi, " ")
    .replace(/\\[a-z]+-?\d* ?/gi, " ")
    .replace(/[{}]/g, " ");
}

async function extractDocumentFile(file) {
  const name = String(file?.name || "未命名文件").trim().slice(0, 180);
  const ext = path.extname(name).toLowerCase();
  if (!AI_SUPPORTED_EXTENSIONS.has(ext)) throw new Error(`暂不支持 ${ext || "该"} 文件格式`);
  const buffer = decodeDataUrl(file?.dataUrl);
  if (!buffer.length) throw new Error("文件是空的");
  if (buffer.length > AI_FILE_MAX_BYTES) throw new Error("文件不能超过 20MB");
  let text = "";
  if (ext === ".pdf") {
    const result = await pdfParse(buffer);
    text = result?.text || "";
  } else if (ext === ".docx") {
    const result = await mammoth.extractRawText({ buffer });
    text = result?.value || "";
  } else if (ext === ".doc") {
    const extractor = new WordExtractor();
    const document = await extractor.extract(buffer);
    text = document?.getBody?.() || document?.getText?.() || "";
  } else if (AI_WORKBOOK_EXTENSIONS.has(ext)) {
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false, raw: false });
    text = workbook.SheetNames.map((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      return `工作表：${sheetName}\n${XLSX.utils.sheet_to_csv(sheet, { blankrows: false })}`;
    }).join("\n\n");
  } else if (ext === ".pptx") {
    text = await extractPptxText(buffer);
  } else if (ext === ".odt") {
    text = await extractOdtText(buffer);
  } else if (ext === ".rtf") {
    text = extractRtfText(buffer);
  } else if (AI_TEXT_EXTENSIONS.has(ext)) {
    text = bufferToText(buffer);
  }
  const normalized = normalizeDocumentText(text);
  if (!normalized) {
    const hint = ext === ".pdf" ? "；如果是扫描版 PDF，请把页面截图作为图片添加" : "";
    throw new Error(`没有提取到文字${hint}`);
  }
  const clipped = normalized.slice(0, AI_FILE_MAX_CHARS);
  return { name, text: clipped, truncated: normalized.length > clipped.length };
}

async function extractDocumentFiles(files) {
  const accepted = Array.isArray(files) ? files.slice(0, AI_FILE_MAX_COUNT) : [];
  const sections = [];
  let totalChars = 0;
  for (const file of accepted) {
    let extracted;
    try {
      extracted = await extractDocumentFile(file);
    } catch (error) {
      throw new Error(`文件“${String(file?.name || "未命名文件")}”读取失败：${error.message}`);
    }
    const remaining = Math.max(0, AI_FILE_TOTAL_CHARS - totalChars);
    const text = extracted.text.slice(0, remaining);
    if (!text) break;
    totalChars += text.length;
    const truncated = extracted.truncated || text.length < extracted.text.length || totalChars >= AI_FILE_TOTAL_CHARS;
    sections.push(`文件：${extracted.name}${truncated ? "（内容过长，已截取前部）" : ""}\n${text}`);
    if (totalChars >= AI_FILE_TOTAL_CHARS) break;
  }
  return sections;
}

function parseAIJson(content) {
  const text = String(content || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI 返回内容不是有效 JSON");
  return JSON.parse(text.slice(start, end + 1));
}

async function summarizeWithAI(payload = {}) {
  const publicConfig = publicAIConfig();
  if (publicConfig.keyInvalid) throw new Error("AI 密钥已失效，请在设置中重新填写 API Key");
  const apiKey = readUsableAIKey().apiKey;
  if (!apiKey) throw new Error("请先在管理中心配置 AI 接口");
  const sourceText = String(payload.text || "").trim();
  const extraPrompt = String(payload.extraPrompt || "").trim().slice(0, 4000);
  const images = Array.isArray(payload.images) ? payload.images.slice(0, 4) : [];
  const files = Array.isArray(payload.files) ? payload.files.slice(0, AI_FILE_MAX_COUNT) : [];
  if (!sourceText && !images.length && !files.length) throw new Error("先粘贴文字、添加图片或文件");
  for (const image of images) {
    if (typeof image !== "string" || !/^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(image)) throw new Error("图片格式不支持");
    if (image.length > 9_000_000) throw new Error("单张图片不能超过 6MB");
  }
  const fileSections = await extractDocumentFiles(files);
  const fileText = fileSections.join("\n\n---\n\n");
  if (!sourceText && !images.length && !fileText) throw new Error("没有读取到可总结的内容");
  const baseUrl = publicConfig.baseUrl.replace(/\/+$/, "");
  const endpoint = baseUrl.endsWith("/chat/completions") ? baseUrl : `${baseUrl}/chat/completions`;
  const today = localDateKey();
  const isChineseOutput = publicConfig.autoTranslate;
  const firstPromptLine = isChineseOutput
    ? "你是 DeskWeek 的任务整理助手。请从用户提供的邮件、通知、聊天文字、图片或文件中提取待办事项。若用户给出的内容不是中文，则先翻译成中文，再进行总结，其中所有的人名保留原文，地名、专有名词和专业性名词等以类似apple（苹果）的形式给出。"
    : "你是 DeskWeek 的任务整理助手。请从用户提供的邮件、通知、聊天文字、图片或文件中提取待办事项。保留用户原文的主要语言，不要自行翻译。";
  const titleRule = isChineseOutput
    ? "title：使用中文，不超过 30 个汉字，直接说明要做什么，不要照抄整段原文。"
    : "title：保留原文主要语言，直接说明要做什么，保持简短，不要翻译，不要照抄整段原文。";
  const detailRule = isChineseOutput
    ? "detail：只保留会直接影响执行的重要、明确信息，删掉寒暄、重复和无关内容。每项信息单独一行，统一写成“字段：内容”；字段名按内容命名，例如发布机构、客户公式、官网、文件格式、截止时间、地点、提交方式、注意事项。没有的字段不要输出，不要把多项信息挤成一段，也不要编造。JSON 字符串内用 \\n 表示换行。"
    : "detail：只保留会直接影响执行的重要、明确信息，删掉寒暄、重复和无关内容。每项信息单独一行，统一写成“字段：内容”；字段名和内容都保留原文主要语言，不要翻译；字段名按内容命名。没有的字段不要输出，不要把多项信息挤成一段，也不要编造。JSON 字符串内用 \\n 表示换行。";
  const detailExample = isChineseOutput
    ? 'detail 示例："发布机构：…\\n客户公式：…\\n官网：…\\n文件格式：…"'
    : 'detail 示例（仅表示格式，字段名和内容使用原文语言）："<field>: <value>\\n<field>: <value>"';
  const groupingRules = [
    "items：先判断资料的整体目的，输出最小必要的事项数。一封邮件、一条通知或一段聊天记录通常只对应 1 个事项。",
    "同一目标下的报名、填写信息、上传平台、发送材料、通知同学、准备 PPT、满足积分条件、命名格式等步骤必须合并为一项，把步骤写进 detail。例如比赛报名通知里的报名、上传、提交材料、截止时间和积分说明属于同一项，不能拆成多项。",
    "只有目标不同，并且行动或截止时间明显独立时才拆分。不要因为原文出现多个动词、多个网址、多个要求或建议就拆成多个事项。",
    "条件、奖励、后果、建议、参考材料和操作说明都属于 detail，不能单独成为事项。能合并就合并，宁少勿碎。",
    extraPrompt ? "先执行用户的筛选要求，再对保留下来的内容按上述规则合并，只输出筛选后必要的独立事项。" : "",
  ];
  const systemPrompt = [
    firstPromptLine,
    "只输出一个合法 JSON 对象，不要 Markdown、代码块或额外解释。",
    'JSON 格式：{"items":[{"title":"主标题","detail":"详细信息","date":"YYYY-MM-DD或空字符串","time":"HH:mm或空字符串","defer":"none|7d|1m或Nd"}]}',
    extraPrompt ? "用户提供了额外要求。必须优先执行额外要求；如果要求按班级、人员、范围、日期或类型筛选，只输出符合条件的任务，不要输出被排除的任务。" : "",
    ...groupingRules,
    titleRule,
    detailRule,
    detailExample,
    "date 和 time：只填该项任务在原文中明确给出的值；只有时间没有日期时 date 留空；无法确定的相对日期不要猜；两者都没有时都为空。",
    "defer：没有明确要求时固定填 none。",
  ].filter(Boolean).join("\n");
  const userParts = [];
  if (sourceText) userParts.push(sourceText);
  if (fileText) userParts.push(`以下是用户提供的文件内容：\n${fileText}`);
  if (extraPrompt) userParts.push(`以下是用户的额外要求，必须优先遵守：\n${extraPrompt}`);
  const content = [{ type: "text", text: userParts.join("\n\n") || "请整理图片中的任务信息。" }];
  images.forEach((url) => content.push({ type: "image_url", image_url: { url } }));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 120000);
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
    const rawItems = Array.isArray(result?.items) ? result.items : (result?.title || result?.detail ? [result] : []);
    const items = rawItems.slice(0, 20).map((entry) => {
      const title = String(entry?.title || "").trim().slice(0, 100);
      const detail = String(entry?.detail || "").trim().slice(0, 4000);
      if (!title && !detail) return null;
      let date = validDateKey(entry?.date) ? entry.date : "";
      let time = /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(entry?.time || "")) ? String(entry.time) : "";
      if (time && !date) date = today;
      const deferText = String(entry?.defer || "none").toLowerCase();
      const defer = deferText === "1m" || /^[1-9]\d*d$/.test(deferText) ? deferText : "none";
      return { title: title || detail.slice(0, 30), detail, date, time, defer };
    }).filter(Boolean);
    if (!items.length) throw new Error("AI 没有从资料中提取到待办事项");
    return { items };
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

ipcMain.handle("deskweek:update-check", () => checkGithubUpdate());
ipcMain.handle("deskweek:update-download", (event) => downloadAndInstallUpdate(event, portableDataDir()));

ipcMain.handle("deskweek:open-external", async (_event, url) => {
  const parsed = new URL(String(url || ""));
  if (parsed.protocol !== "https:") throw new Error("只允许打开 HTTPS 链接");
  const host = parsed.hostname.toLowerCase();
  if (![ "github.com", "space.bilibili.com" ].some((allowed) => host === allowed || host.endsWith("." + allowed))) throw new Error("链接地址不受支持");
  await shell.openExternal(parsed.toString());
  return true;
});

ipcMain.handle("deskweek:show-update-file", (_event, filePath) => {
  const updatesDir = path.resolve(portableDataDir(), "updates") + path.sep;
  const resolved = path.resolve(String(filePath || ""));
  if (!resolved.startsWith(updatesDir) || !fs.existsSync(resolved)) throw new Error("更新文件不存在");
  shell.showItemInFolder(resolved);
  return true;
});

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























