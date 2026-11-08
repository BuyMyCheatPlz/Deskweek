"use strict";

const STORAGE_KEY = "deskweek.items.v1";
const PREF_KEY = "deskweek.prefs.v1";
const THEME_KEY = "deskweek.theme.v1";
const COLORS = ["#9bd3c7", "#e7bd82", "#f39aa4", "#90b8ee", "#c8a6ef", "#a7d48d"];
const WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

const $ = (selector) => document.querySelector(selector);
const els = {
  rangeTitle: $("#rangeTitle"),
  weekSubtitle: $("#weekSubtitle"),
  weekGrid: $("#weekGrid"),
  openCount: $("#openCount"),
  deferredCount: $("#deferredCount"),
  taskList: $("#taskList"),
  taskListTitle: $("#taskListTitle"),
  addForm: $("#addForm"),
  newTitle: $("#newTitle"),
  newDetailButton: $("#newDetailButton"),
  newDate: $("#newDate"),
  newTime: $("#newTime"),
  newDefer: $("#newDefer"),
  prevWeek: $("#prevWeek"),
  nextWeek: $("#nextWeek"),
  todayButton: $("#todayButton"),
  calendarQuickAddButton: $("#calendarQuickAddButton"),
  calendarAddDialog: $("#calendarAddDialog"),
  calendarAddForm: $("#calendarAddForm"),
  calendarNewTitle: $("#calendarNewTitle"),
  calendarNewDetail: $("#calendarNewDetail"),
  calendarNewDate: $("#calendarNewDate"),
  calendarNewTime: $("#calendarNewTime"),
  calendarNewDefer: $("#calendarNewDefer"),
  closeCalendarAddDialog: $("#closeCalendarAddDialog"),
  calendarCancelAdd: $("#calendarCancelAdd"),
  aiConfigHint: $("#aiConfigHint"),
  aiSourceText: $("#aiSourceText"),
  aiExtraPrompt: $("#aiExtraPrompt"),
  aiImageInput: $("#aiImageInput"),
  aiFileInput: $("#aiFileInput"),
  aiFileList: $("#aiFileList"),
  aiImageList: $("#aiImageList"),
  aiSummarizeButton: $("#aiSummarizeButton"),
  aiSummaryStatus: $("#aiSummaryStatus"),
  aiProposals: $("#calendarAIProposals"),
  singleTaskFields: $("#calendarSingleTaskFields"),
  addAllButton: $("#calendarAddAllButton"),
  calendarAddSubmit: $("#calendarAddSubmit"),
  toggleDone: $("#toggleDone"),
  manageButton: $("#manageButton"),
  calendarToggle: $("#calendarToggle"),
  calendarModeMenu: $("#calendarModeMenu"),
  tasksToggle: $("#tasksToggle"),
  fishWidget: $("#fishWidget"),
  collapseButton: $("#collapseButton"),
  dialog: $("#editDialog"),
  editForm: $("#editForm"),
  editTitle: $("#editTitle"),
  editDetail: $("#editDetail"),
  editDate: $("#editDate"),
  editTime: $("#editTime"),
  editDefer: $("#editDefer"),
  editDone: $("#editDone"),
  deleteTask: $("#deleteTask"),
  closeDialog: $("#closeDialog"),
  cancelEdit: $("#cancelEdit"),
  toast: $("#toast"),
  confirmDialog: $("#confirmDialog"),
  confirmTitle: $("#confirmTitle"),
  confirmMessage: $("#confirmMessage"),
  confirmCancel: $("#confirmCancel"),
  confirmAccept: $("#confirmAccept"),
  brandRow: $(".brand-row"),
  resizeGrip: $("#resizeGrip"),
  splitter: $("#splitter"),
  taskCard: $(".task-card"),
};

let calendarWheelLock = false;
let selectedDate = todayKey();
let editingId = null;
let toastTimer = null;
let confirmResolver = null;
let calendarAddWillCommit = false;
let calendarAddOrigin = "calendar";
let aiImageAttachments = [];
let aiFileAttachments = [];
let aiProposalEntries = [];
const AI_MAX_FILES = 5;
const AI_MAX_FILE_BYTES = 20 * 1024 * 1024;
const AI_FILE_EXTENSIONS = new Set([".pdf", ".doc", ".docx", ".xls", ".xlsx", ".xlsm", ".ods", ".csv", ".pptx", ".odt", ".rtf", ".txt", ".md", ".markdown", ".json", ".xml", ".yaml", ".yml", ".log"]);
let aiConfigAvailable = false;
let aiKeyInvalid = false;
let aiSummaryBusy = false;
let state = loadState();
let miniModeActive = false;
let layoutRevealTimer = 0;
let calendarFocusDate = new Date();
let hoveredDateKey = "";
let calendarDateClickTimer = 0;
function normalizedTheme(value) { return value === "dark" ? "dark" : "light"; }
function applyTheme(theme) {
  const value = normalizedTheme(theme);
  state.theme = value;
  document.documentElement.dataset.theme = value;
  document.body.classList.toggle("theme-dark", value === "dark");
  document.body.classList.toggle("theme-light", value === "light");
  document.querySelectorAll("#dwDatePopover, #dwTimePopover, #dwDeferPopover").forEach((popover) => { popover.dataset.theme = value; });
  const meta = document.querySelector("meta[name=\"color-scheme\"]");
  if (meta) meta.setAttribute("content", value);
  try { localStorage.setItem(THEME_KEY, value); } catch { /* optional */ }
}

function pad(value) { return String(value).padStart(2, "0"); }
function dateKey(date) { return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; }
function todayKey() { return dateKey(new Date()); }
function fromKey(key) {
  const [year, month, day] = String(key).split("-").map(Number);
  return new Date(year, month - 1, day);
}
function isValidDateKey(value) {
  const text = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  return dateKey(fromKey(text)) === text;
}
function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}
function startOfWeek(date) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = (next.getDay() + 6) % 7;
  next.setDate(next.getDate() - day);
  return next;
}
function sameDay(a, b) { return dateKey(a) === dateKey(b); }
function clampText(value, max = 100) { return String(value || "").trim().slice(0, max); }
function normalizeCalendarMode(value) { return ["month", "week", "day"].includes(value) ? value : "week"; }
function normalizeDefer(value) { const text = String(value || "none").toLowerCase(); return text === "1m" || /^[1-9]\d*d$/.test(text) ? text : "none"; }
function subtractMonthsClamped(date, months) {
  const day = date.getDate();
  const target = new Date(date.getFullYear(), date.getMonth() - months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, lastDay));
  return target;
}
function visibleFromKey(item) {
  if (!isValidDateKey(item.date)) return "";
  const date = fromKey(item.date);
  const defer = normalizeDefer(item.defer);
  if (defer.endsWith("m")) return dateKey(subtractMonthsClamped(date, Number(defer.slice(0, -1)) || 1));
  if (defer.endsWith("d")) return dateKey(addDays(date, -(Number(defer.slice(0, -1)) || 0)));
  return item.date;
}
function isTaskVisible(item) {
  if (!isValidDateKey(item.date)) return true;
  return normalizeDefer(item.defer) === "none" || todayKey() >= visibleFromKey(item);
}
function isTaskDeferred(item) { return !isTaskVisible(item); }
function deferLabel(item) { const value = normalizeDefer(item.defer); if (value === "none") return "立即显示"; if (value === "1m") return "提前1个月"; return "提前" + value.slice(0, -1) + "天"; }
function uid() { return (crypto.randomUUID && crypto.randomUUID()) || `item-${Date.now()}-${Math.random().toString(16).slice(2)}`; }

function demoItems() {
  const base = new Date();
  const at = (offset, hour, minute, title, color) => {
    const d = addDays(base, offset);
    return normalizeItem({ id: `demo-${offset}-${hour}-${minute}`, title, date: dateKey(d), time: `${pad(hour)}:${pad(minute)}`, color, done: false, createdAt: new Date().toISOString() });
  };
  return [
    at(0, 18, 0, "数据结构课程报告", COLORS[0]),
    at(1, 10, 0, "神经网络作业提交", COLORS[2]),
    at(3, 14, 30, "小组项目同步", COLORS[3]),
    at(6, 20, 0, "本周复盘", COLORS[1]),
  ];
}

function loadState() {
  if (new URLSearchParams(location.search).get("demo") === "1") return { items: demoItems(), showDone: false };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { items: [], showDone: false };
    const parsed = JSON.parse(raw);
    return { items: normalizeItems(parsed.items), showDone: false };
  } catch { return { items: [], showDone: false }; }
}
function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREF_KEY) || "{}"); } catch { return {}; }
}
function storePayload() {
  return {
    items: state.items,
    prefs: { showDone: state.showDone, taskPanelHeight: state.taskPanelHeight, theme: state.theme, showCalendar: state.showCalendar, showTasks: state.showTasks, calendarMode: state.calendarMode },
  };
}

function persistStore() {
  const result = window.deskWeek?.saveStore?.(storePayload());
  if (result?.catch) result.catch(() => toast("数据保存失败"));
}

function applyStore(data) {
  if (!data || !Array.isArray(data.items)) return;
  state.items = normalizeItems(data.items);
  if (data.prefs && typeof data.prefs === "object") {
    state.showDone = Boolean(data.prefs.showDone);
    state.taskPanelHeight = Number(data.prefs.taskPanelHeight) || null;
    if (typeof data.prefs.showCalendar === "boolean") state.showCalendar = data.prefs.showCalendar;
    if (typeof data.prefs.showTasks === "boolean") state.showTasks = data.prefs.showTasks;
    state.calendarMode = normalizeCalendarMode(data.prefs.calendarMode);
    if (data.prefs.theme === "light" || data.prefs.theme === "dark") applyTheme(data.prefs.theme);
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ items: state.items }));
    localStorage.setItem(PREF_KEY, JSON.stringify({ showDone: state.showDone, taskPanelHeight: state.taskPanelHeight, theme: state.theme, showCalendar: state.showCalendar, showTasks: state.showTasks, calendarMode: state.calendarMode }));
  } catch { /* local backup is optional */ }
  applyViewState(false);
  renderAll();
  applyTaskPanelHeight(state.taskPanelHeight || 292, false, false);
}

function saveState() {
  reconcileTaskColors(state.items);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ items: state.items })); } catch { toast("浏览器没有开放本地存储"); }
  persistStore();
}
function savePrefs() {
  try { localStorage.setItem(PREF_KEY, JSON.stringify({ showDone: state.showDone, taskPanelHeight: state.taskPanelHeight, theme: state.theme, showCalendar: state.showCalendar, showTasks: state.showTasks, calendarMode: state.calendarMode })); } catch { /* ignore */ }
  persistStore();
}
function applyTaskPanelHeight(height, persist = false, updateState = true) {
  if (document.body.classList.contains("mini-mode")) return;
  const value = Number(height);
  if (!Number.isFinite(value)) return;
  const desk = document.querySelector(".desk");
  const available = (desk?.clientHeight || window.innerHeight) - 230;
  const safe = Math.round(Math.min(Math.max(170, available), Math.max(170, value)));
  desk?.style.setProperty("--task-panel-height", `${safe}px`);
  if (updateState) state.taskPanelHeight = safe;
  if (persist) savePrefs();
}
function validItem(item) {
  const dateOk = !item?.date || isValidDateKey(item.date);
  return item && typeof item.id === "string" && typeof item.title === "string" && dateOk;
}
function normalizeItem(item) {
  const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(item.time || "") ? item.time : "";
  const date = isValidDateKey(item.date) ? item.date : time ? todayKey() : "";
  const createdAt = typeof item.createdAt === "string" && !Number.isNaN(Date.parse(item.createdAt)) ? item.createdAt : new Date().toISOString();
  const completedAt = Boolean(item.done) ? (typeof item.completedAt === "string" && !Number.isNaN(Date.parse(item.completedAt)) ? item.completedAt : createdAt) : "";
  return {
    id: item.id || uid(),
    title: clampText(item.title) || "未命名事项",
    detail: typeof item.detail === "string" ? clampText(item.detail, 4000) : "",
    date,
    time,
    done: Boolean(item.done),
    completedAt,
    deleted: Boolean(item.deleted),
    deletedAt: typeof item.deletedAt === "string" ? item.deletedAt : "",
    color: COLORS.includes(item.color) ? item.color : COLORS[0],
    defer: date ? normalizeDefer(item.defer) : "none",
    createdAt,
  };
}
function setItemDoneState(item, done) {
  item.done = Boolean(done);
  item.completedAt = item.done ? (item.completedAt || new Date().toISOString()) : "";
}
function nextTaskColor(date) {
  const count = state.items.filter((item) => !item.deleted && item.date === date).length;
  return COLORS[count % COLORS.length];
}
function reconcileTaskColors(items) {
  const used = new Map();
  (Array.isArray(items) ? items : [])
    .filter((item) => !item.deleted && isValidDateKey(item.date))
    .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")) || String(a.id || "").localeCompare(String(b.id || "")))
    .forEach((item) => {
      const index = used.get(item.date) || 0;
      item.color = COLORS[index % COLORS.length];
      used.set(item.date, index + 1);
    });
  return items;
}
function normalizeItems(items) {
  const ids = new Set();
  const normalizedItems = (Array.isArray(items) ? items : []).filter(validItem).map((item) => {
    const normalized = normalizeItem(item);
    while (ids.has(normalized.id)) normalized.id = uid();
    ids.add(normalized.id);
    return normalized;
  });
  reconcileTaskColors(normalizedItems);
  return normalizedItems;
}
function readOptionalTime(input) {
  if (!input) return "";
  const valid = window.DeskWeekTime?.commit ? window.DeskWeekTime.commit(input) : true;
  if (!valid) { input.reportValidity?.(); return null; }
  return window.DeskWeekTime?.read?.(input) ?? (input.value || "");
}
function readTaskDate(input) {
  if (!input) return "";
  if (!String(input.value || "").trim()) { input.setCustomValidity?.(""); return ""; }
  const valid = window.DeskWeekDate?.commit ? window.DeskWeekDate.commit(input) : isValidDateKey(input.value);
  if (!valid) { input.reportValidity?.(); return null; }
  const value = window.DeskWeekDate?.normalize?.(input.value) ?? input.value;
  return isValidDateKey(value) ? value : null;
}
function resolveTaskDate(date, time) {
  if (isValidDateKey(date)) return date;
  return time ? todayKey() : "";
}

const prefs = loadPrefs();
state.showDone = Boolean(prefs.showDone);
state.taskPanelHeight = Number(prefs.taskPanelHeight) || null;
state.theme = normalizedTheme(prefs.theme || document.documentElement.dataset.theme || window.DeskWeekThemeBootstrap?.get?.() || "light");
state.showCalendar = prefs.showCalendar !== false;
state.showTasks = prefs.showTasks !== false;
state.calendarMode = normalizeCalendarMode(prefs.calendarMode);
state.calDate = new Date();
calendarFocusDate = new Date(state.calDate);
state.items = normalizeItems(state.items);
applyTheme(state.theme);

function isoWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}
function weekDates() {
  const start = startOfWeek(state.calDate);
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}
function calendarInfo(value) {
  return window.DeskWeekCalendarInfo?.get?.(value) || { events: [], primary: null, lunarText: "" };
}
function calendarEventNode(event, extraClass = "") {
  if (!event) return null;
  const node = document.createElement("span");
  const seasonClass = event.kind === "term" && event.season ? ` term-${event.season}` : "";
  const holidayClass = event.kind === "legal" && event.major ? " legal-major" : "";
  node.className = `calendar-event ${event.kind}${holidayClass}${seasonClass}${extraClass ? " " + extraClass : ""}`;
  node.textContent = event.label;
  return node;
}
function formatRange(dates) {
  const first = dates[0];
  const last = dates[6];
  const left = first.getMonth() === last.getMonth()
    ? `${first.getMonth() + 1}月${first.getDate()}日`
    : `${first.getMonth() + 1}月${first.getDate()}日`;
  const right = first.getMonth() === last.getMonth()
    ? `${last.getDate()}日`
    : `${last.getMonth() + 1}月${last.getDate()}日`;
  return `${left} — ${right}`;
}
function taskSortRank(item) {
  const dated = isValidDateKey(item.date);
  if (!item.done && dated && item.date < todayKey()) return 0;
  if (!dated) return 1;
  return 2;
}
function sortItems(a, b) {
  const rank = taskSortRank(a) - taskSortRank(b);
  if (rank) return rank;
  if (taskSortRank(a) === 1) return a.createdAt.localeCompare(b.createdAt);
  const ak = `${a.date}T${a.time || "00:00"}`;
  const bk = `${b.date}T${b.time || "00:00"}`;
  return ak.localeCompare(bk) || a.createdAt.localeCompare(b.createdAt);
}
function sortCompletedItems(a, b) {
  return String(b.completedAt || b.createdAt || "").localeCompare(String(a.completedAt || a.createdAt || ""));
}
function itemsOn(key) {
  return state.items.filter((item) => !item.deleted && item.date === key).sort(sortItems);
}
function dueInfo(item) {
  if (item.done) return { text: item.time || "已完成", className: "" };
  if (!item.date) return { text: "", className: "default" };
  const today = fromKey(todayKey());
  const date = fromKey(item.date);
  const diff = Math.round((date - today) / 86400000);
  const time = item.time ? ` ${item.time}` : "";
  if (diff < 0) return { text: `已逾期 · ${date.getMonth() + 1}月${date.getDate()}日${time}`, className: "overdue" };
  if (diff === 0) return { text: `今天${time}`, className: "today" };
  if (diff === 1) return { text: `明天${time}`, className: "" };
  if (diff > 1 && diff < 7) return { text: `${WEEKDAYS[(date.getDay() + 6) % 7]}${time}`, className: "" };
  return { text: `${date.getMonth() + 1}月${date.getDate()}日${time}`, className: "" };
}

function setAIStatus(message = "", isError = false) {
  if (!els.aiSummaryStatus) return;
  els.aiSummaryStatus.textContent = message;
  els.aiSummaryStatus.hidden = !message;
  els.aiSummaryStatus.classList.toggle("error", isError);
}

function renderAIImageList() {
  if (!els.aiImageList) return;
  els.aiImageList.replaceChildren();
  aiImageAttachments.forEach((image, index) => {
    const item = document.createElement("span");
    item.className = "ai-image-item";
    const preview = document.createElement("img");
    preview.src = image.dataUrl;
    preview.alt = image.name;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "ai-image-remove";
    remove.setAttribute("aria-label", `移除 ${image.name}`);
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      aiImageAttachments.splice(index, 1);
      renderAIImageList();
    });
    item.append(preview, remove);
    els.aiImageList.append(item);
  });
}

function renderAIFileList() {
  if (!els.aiFileList) return;
  els.aiFileList.replaceChildren();
  aiFileAttachments.forEach((file, index) => {
    const item = document.createElement("span");
    item.className = "ai-file-item";
    const name = document.createElement("span");
    name.className = "ai-file-name";
    name.textContent = file.name;
    name.title = file.name;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "ai-file-remove";
    remove.setAttribute("aria-label", `移除 ${file.name}`);
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      aiFileAttachments.splice(index, 1);
      renderAIFileList();
    });
    item.append(name, remove);
    els.aiFileList.append(item);
  });
}

function clearAIProposalResults() {
  aiProposalEntries = [];
  if (els.aiProposals) {
    els.aiProposals.replaceChildren();
    els.aiProposals.hidden = true;
  }
  if (els.singleTaskFields) els.singleTaskFields.hidden = false;
  if (els.calendarAddSubmit) els.calendarAddSubmit.hidden = false;
  if (els.addAllButton) els.addAllButton.hidden = true;
}

function clearAIDraft() {
  aiImageAttachments = [];
  aiFileAttachments = [];
  if (els.aiSourceText) els.aiSourceText.value = "";
  if (els.aiExtraPrompt) els.aiExtraPrompt.value = "";
  if (els.aiImageInput) els.aiImageInput.value = "";
  if (els.aiFileInput) els.aiFileInput.value = "";
  renderAIImageList();
  renderAIFileList();
  clearAIProposalResults();
  setAIStatus("");
}

function autoResizeTextarea(input) {
  if (!(input instanceof HTMLTextAreaElement)) return;
  input.style.height = "auto";
  const style = getComputedStyle(input);
  const minHeight = Number.parseFloat(style.minHeight) || 0;
  const parsedMaxHeight = Number.parseFloat(style.maxHeight);
  const maxHeight = Number.isFinite(parsedMaxHeight) ? parsedMaxHeight : Number.POSITIVE_INFINITY;
  const nextHeight = Math.min(maxHeight, Math.max(minHeight, input.scrollHeight + 2));
  input.style.height = nextHeight + "px";
  input.style.overflowY = input.scrollHeight > nextHeight + 1 ? "auto" : "hidden";
}

function fileExtension(name) {
  const match = String(name || "").toLowerCase().match(/\.([^.]+)$/);
  return match ? "." + match[1] : "";
}

function readFileDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error(`无法读取文件：${file.name}`));
    reader.readAsDataURL(file);
  });
}

async function addAIFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  const room = Math.max(0, AI_MAX_FILES - aiFileAttachments.length);
  if (!room) { setAIStatus("最多添加 5 个文件", true); return; }
  const accepted = [];
  for (const file of files.slice(0, room)) {
    if (!AI_FILE_EXTENSIONS.has(fileExtension(file.name))) { setAIStatus(`暂不支持：${file.name}`, true); continue; }
    if (file.size > AI_MAX_FILE_BYTES) { setAIStatus(`文件不能超过 20MB：${file.name}`, true); continue; }
    accepted.push(file);
  }
  try {
    const entries = await Promise.all(accepted.map(async (file) => ({ name: file.name, size: file.size, dataUrl: await readFileDataUrl(file) })));
    aiFileAttachments.push(...entries);
    renderAIFileList();
    if (files.length > room) setAIStatus("最多添加 5 个文件", true);
    else if (entries.length) setAIStatus("");
  } catch (error) {
    setAIStatus(error.message || "文件读取失败", true);
  } finally {
    if (els.aiFileInput) els.aiFileInput.value = "";
  }
}

function updateAIAddAllButton() {
  if (!els.addAllButton) return;
  const pending = aiProposalEntries.filter((entry) => !entry.added).length;
  els.addAllButton.hidden = aiProposalEntries.length < 2 || pending === 0;
  els.addAllButton.disabled = pending === 0;
  els.addAllButton.textContent = `一键添加（${pending}）`;
}

function readAIProposal(entry) {
  const title = clampText(entry.titleInput.value);
  if (!title) {
    entry.titleInput.focus();
    toast("还有事项没写标题");
    return null;
  }
  const rawDate = readTaskDate(entry.dateInput);
  if (rawDate === null) return null;
  const time = readOptionalTime(entry.timeInput);
  if (time === null) return null;
  const date = resolveTaskDate(rawDate, time);
  return {
    title,
    detail: clampText(entry.detailInput.value, 4000),
    date,
    time,
    defer: date ? window.DeskWeekDefer?.read?.(entry.deferPicker) || "none" : "none",
  };
}

function insertAIProposal(entry, proposal) {
  state.showDone = false;
  state.items.push(normalizeItem({
    id: uid(),
    title: proposal.title,
    detail: proposal.detail,
    date: proposal.date,
    time: proposal.time,
    defer: proposal.defer || "none",
    done: false,
    color: nextTaskColor(proposal.date),
    createdAt: new Date().toISOString(),
  }));
  entry.added = true;
  entry.card.classList.add("is-added");
  entry.addButton.disabled = true;
  entry.addButton.textContent = "已添加";
  updateAIAddAllButton();
}

function addAIProposal(entry) {
  if (entry.added) return true;
  const proposal = readAIProposal(entry);
  if (!proposal) return false;
  insertAIProposal(entry, proposal);
  saveState();
  renderTasks();
  renderCalendarView();
  toast("已添加");
  return true;
}

function addAllAIProposals() {
  const pending = aiProposalEntries.filter((entry) => !entry.added);
  if (!pending.length) return;
  const prepared = [];
  for (const entry of pending) {
    const proposal = readAIProposal(entry);
    if (!proposal) return;
    prepared.push({ entry, proposal });
  }
  for (const item of prepared) insertAIProposal(item.entry, item.proposal);
  saveState();
  renderAll();
  calendarAddWillCommit = true;
  closeCalendarAddDialog();
  toast(`已添加 ${prepared.length} 项`);
}

function renderAIProposals(items) {
  aiProposalEntries = [];
  if (!els.aiProposals) return;
  els.aiProposals.replaceChildren();
  const multiple = items.length > 1;
  els.aiProposals.hidden = !multiple;
  if (els.singleTaskFields) els.singleTaskFields.hidden = multiple;
  if (els.calendarAddSubmit) els.calendarAddSubmit.hidden = multiple;
  if (!multiple) {
    updateAIAddAllButton();
    return;
  }
  items.forEach((item, index) => {
    const card = document.createElement("article");
    card.className = "ai-proposal-card";
    card.innerHTML = `
      <div class="ai-proposal-head"><strong>事项${["一","二","三","四","五","六","七","八","九","十"][index] || index + 1}</strong><button class="ai-proposal-add" type="button">添加</button></div>
      <label class="field"><span>标题</span><input class="ai-proposal-title" type="text" maxlength="100"></label>
      <label class="field"><span>详情</span><textarea class="ai-proposal-detail" rows="2" maxlength="4000"></textarea></label>
      <div class="field-row ai-proposal-schedule-row"><label class="field"><span>日期</span><input class="ai-proposal-date" type="text" inputmode="numeric" maxlength="10" placeholder="日期" data-date-picker></label><label class="field"><span>时间</span><input class="ai-proposal-time" type="text" inputmode="numeric" maxlength="5" placeholder="12:00" data-time-picker></label><div class="field ai-proposal-defer-field"><span>延后显示</span><div class="ai-proposal-defer defer-picker" data-defer-picker data-defer-value="none"><button class="defer-trigger" type="button" aria-label="延后显示：立即显示" aria-expanded="false"><span class="defer-clock-icon" aria-hidden="true"></span><span class="defer-trigger-badge" hidden></span></button></div></div></div>`;
    const entry = {
      added: false,
      card,
      titleInput: card.querySelector(".ai-proposal-title"),
      detailInput: card.querySelector(".ai-proposal-detail"),
      dateInput: card.querySelector(".ai-proposal-date"),
      timeInput: card.querySelector(".ai-proposal-time"),
      deferPicker: card.querySelector(".ai-proposal-defer"),
      addButton: card.querySelector(".ai-proposal-add"),
    };
    entry.titleInput.value = item.title || "";
    entry.detailInput.value = item.detail || "";
    entry.dateInput.value = item.date || "";
    entry.timeInput.value = item.time || "";
    window.DeskWeekDate?.attach?.(entry.dateInput);
    window.DeskWeekTime?.attach?.(entry.timeInput);
    window.DeskWeekDefer?.attach?.(entry.deferPicker);
    window.DeskWeekDefer?.set?.(entry.deferPicker, item.defer || "none");
    entry.addButton.addEventListener("click", () => addAIProposal(entry));
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && event.target.tagName !== "TEXTAREA") {
        event.preventDefault();
        addAIProposal(entry);
      }
    });
    aiProposalEntries.push(entry);
    els.aiProposals.append(card);
    entry.detailInput.addEventListener("input", () => autoResizeTextarea(entry.detailInput));
    requestAnimationFrame(() => autoResizeTextarea(entry.detailInput));
  });
  updateAIAddAllButton();
}

function applyAIItems(items) {
  const normalized = Array.isArray(items) ? items.filter((item) => item && (item.title || item.detail)) : [];
  if (!normalized.length) {
    setAIStatus("AI 没有提取到待办事项", true);
    return;
  }
  if (normalized.length === 1) {
    const item = normalized[0];
    els.calendarNewTitle.value = item.title || "";
    els.calendarNewDetail.value = item.detail || "";
    requestAnimationFrame(() => autoResizeTextarea(els.calendarNewDetail));
    els.calendarNewDate.value = item.date || "";
    els.calendarNewTime.value = item.time || "";
    window.DeskWeekDefer?.set?.(els.calendarNewDefer, item.defer || "none");
    renderAIProposals([]);
    setAIStatus("已填入");
    return;
  }
  renderAIProposals(normalized);
  setAIStatus(`已提取 ${normalized.length} 项事项`);
}

async function addAIImageFiles(fileList) {
  const files = Array.from(fileList || []).filter((file) => file.type.startsWith("image/"));
  if (!files.length) return;
  const room = Math.max(0, 4 - aiImageAttachments.length);
  if (!room) { setAIStatus("最多添加 4 张图片", true); return; }
  const accepted = [];
  for (const file of files.slice(0, room)) {
    if (file.size > 6 * 1024 * 1024) { setAIStatus("单张图片不能超过 6MB", true); continue; }
    accepted.push(file);
  }
  try {
    const images = await Promise.all(accepted.map(async (file) => ({ name: file.name, dataUrl: await readFileDataUrl(file) })));
    aiImageAttachments.push(...images);
    renderAIImageList();
    if (files.length > room) setAIStatus("最多添加 4 张图片", true);
    else if (images.length) setAIStatus("");
  } catch (error) {
    setAIStatus(error.message || "图片读取失败", true);
  } finally {
    if (els.aiImageInput) els.aiImageInput.value = "";
  }
}

async function refreshAIConfigHint() {
  try {
    const config = await window.deskWeek?.getAIConfig?.();
    aiConfigAvailable = Boolean(config?.hasKey);
    aiKeyInvalid = Boolean(config?.keyInvalid);
  } catch {
    aiConfigAvailable = false;
    aiKeyInvalid = false;
  }
  if (!els.aiConfigHint) return;
  els.aiConfigHint.hidden = aiConfigAvailable;
  els.aiConfigHint.textContent = aiConfigAvailable ? "" : aiKeyInvalid ? "密钥失效，请重新填写" : "未配置接口";
}

function readableAIError(error) {
  return String(error?.message || error || "AI 总结失败")
    .replace(/^Error invoking remote method '[^']+':\s*/i, "")
    .replace(/^Error:\s*/i, "");
}

async function summarizeAISource() {
  if (aiSummaryBusy) return;
  const text = String(els.aiSourceText?.value || "").trim();
  const extraPrompt = String(els.aiExtraPrompt?.value || "").trim();
  if (!text && !aiImageAttachments.length && !aiFileAttachments.length) { setAIStatus("先粘贴文字、添加图片或文件", true); return; }
  if (aiKeyInvalid) { setAIStatus("AI 密钥已失效，请到管理中心重新填写 API Key", true); return; }
  if (!aiConfigAvailable || !window.deskWeek?.summarizeTask) { setAIStatus("先在管理中心配置 AI 接口", true); return; }
  aiSummaryBusy = true;
  els.aiSummarizeButton.disabled = true;
  els.aiSummarizeButton.textContent = "整理中…";
  setAIStatus("正在读取资料并整理…");
  try {
    const result = await window.deskWeek.summarizeTask({
      text,
      extraPrompt,
      images: aiImageAttachments.map((image) => image.dataUrl),
      files: aiFileAttachments.map((file) => ({ name: file.name, dataUrl: file.dataUrl })),
    });
    applyAIItems(result?.items || (result?.title ? [result] : []));
  } catch (error) {
    setAIStatus(readableAIError(error), true);
  } finally {
    aiSummaryBusy = false;
    els.aiSummarizeButton.disabled = false;
    els.aiSummarizeButton.textContent = "总结并填入";
  }
}

function resetCalendarAddDefaults() {
  const today = todayKey();
  selectedDate = today;
  hoveredDateKey = "";
  els.newDate.value = today;
  els.newTime.value = "";
  els.calendarNewDate.value = today;
  els.calendarNewTime.value = "";
  els.calendarNewDetail.value = "";
  els.newTime.setCustomValidity?.("");
  els.calendarNewTime.setCustomValidity?.("");
  window.DeskWeekDefer?.set?.(els.newDefer, "none");
  window.DeskWeekDefer?.set?.(els.calendarNewDefer, "none");
  clearAIDraft();
  renderCalendarView();
}

function openCalendarAddDialog(date, options = {}) {
  const fallback = fromKey(selectedDate) || state.calDate || new Date();
  const target = date instanceof Date && !Number.isNaN(date.getTime()) ? date : fallback;
  const key = dateKey(target);
  const origin = options.origin === "form" ? "form" : "calendar";
  calendarAddWillCommit = false;
  calendarAddOrigin = origin;
  selectedDate = key;
  state.calDate = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  calendarFocusDate = new Date(state.calDate);
  if (origin === "form") {
    els.calendarNewDate.value = String(options.dateValue || "");
  } else {
    els.newDate.value = key;
    els.calendarNewDate.value = key;
  }
  if (!els.calendarAddDialog.open) {
    clearAIDraft();
    els.calendarNewTitle.value = origin === "form" ? clampText(options.title || "") : "";
    els.calendarNewDetail.value = origin === "form" ? clampText(options.detail || "", 4000) : "";
    els.calendarNewTime.value = origin === "form" ? String(options.time || "") : "";
    window.DeskWeekDefer?.set?.(els.calendarNewDefer, origin === "form" ? options.defer || "none" : "none");
    els.calendarAddDialog.showModal();
  } else if (origin === "form") {
    els.calendarNewTitle.value = clampText(options.title || "");
    els.calendarNewDetail.value = clampText(options.detail || "", 4000);
    els.calendarNewTime.value = String(options.time || "");
    window.DeskWeekDefer?.set?.(els.calendarNewDefer, options.defer || "none");
  }
  refreshAIConfigHint();
  renderCalendarView();
  requestAnimationFrame(() => autoResizeTextarea(els.calendarNewDetail));
  setTimeout(() => els.calendarNewTitle.focus({ preventScroll: true }), 30);
}

function closeCalendarAddDialog() {
  const wasOpen = Boolean(els.calendarAddDialog?.open);
  const origin = calendarAddOrigin;
  if (wasOpen) els.calendarAddDialog.close();
  if (wasOpen) (origin === "form" ? els.newDetailButton : els.calendarQuickAddButton)?.focus({ preventScroll: true });
}

function selectFloatingDate(key, date) {
  if (state.showCalendar && !state.showTasks) {
    openCalendarAddDialog(date);
    return;
  }
  selectedDate = key;
  state.calDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  calendarFocusDate = new Date(state.calDate);
  hoveredDateKey = key;
  els.newDate.value = key;
  renderCalendarView();
  renderTasks();
  els.newTitle.focus();
  toast("已选 " + (date.getMonth() + 1) + "月" + date.getDate() + "日");
}

function scheduleCalendarDateSelect(key, date) {
  clearTimeout(calendarDateClickTimer);
  calendarDateClickTimer = setTimeout(() => {
    calendarDateClickTimer = 0;
    selectFloatingDate(key, date);
  }, 260);
}

function bindCalendarDateInteraction(node, key, date) {
  node.addEventListener("pointerenter", () => { hoveredDateKey = key; });
  node.addEventListener("focusin", () => { hoveredDateKey = key; });
  node.addEventListener("click", (event) => {
    if (event.target.closest(".calendar-task-toggle")) return;
    scheduleCalendarDateSelect(key, date);
  });
  node.addEventListener("dblclick", (event) => {
    if (event.target.closest(".calendar-task-toggle")) return;
    event.preventDefault();
    event.stopPropagation();
    openCalendarDay(date);
  });
}

function renderWeek() {
  const dates = weekDates();
  els.rangeTitle.textContent = formatRange(dates);
  els.weekSubtitle.textContent = dates[0].getFullYear() + "年 · 第" + isoWeek(dates[0]) + "周";
  els.weekGrid.className = "week-grid";
  els.weekGrid.replaceChildren();
  const today = new Date();
  const todayK = todayKey();
  dates.forEach((date) => {
    const key = dateKey(date);
    const column = document.createElement("article");
    column.className = "day-column";
    column.style.setProperty("--cell-index", dates.indexOf(date));
    if (key === todayK) column.classList.add("today");
    if (key === selectedDate) column.classList.add("selected-day");
    if (key < todayK) column.classList.add("past");
    column.dataset.date = key;
    column.title = "单击选择日期，双击进入当天";
    column.tabIndex = 0;
    column.setAttribute("role", "button");
    column.setAttribute("aria-label", (date.getMonth() + 1) + "月" + date.getDate() + "日，单击选择，双击进入当天");
    const head = document.createElement("div");
    head.className = "day-head";
    const info = calendarInfo(date);
    const weekday = document.createElement("span");
    weekday.className = "weekday";
    weekday.append(document.createTextNode(WEEKDAYS[(date.getDay() + 6) % 7]));
    if (info.events.length) {
      weekday.append(document.createTextNode("·"));
      info.events.forEach((event, index) => {
        if (index) weekday.append(document.createTextNode("·"));
        weekday.append(calendarEventNode(event));
      });
    }
    weekday.title = window.DeskWeekCalendarInfo?.eventTitle?.(date) || "";
    const number = document.createElement("span");
    number.className = "day-number";
    number.textContent = String(date.getDate());
    head.append(weekday, number);
    const items = document.createElement("div");
    items.className = "day-items";
    const dayItems = itemsOn(key);
    if (!dayItems.length) {
      const empty = document.createElement("div");
      empty.className = "empty-day";
      empty.textContent = "—";
      items.append(empty);
    } else {
      dayItems.slice(0, 4).forEach((item) => items.append(weekItem(item)));
      if (dayItems.length > 4) {
        const more = document.createElement("div");
        more.className = "more-items";
        more.textContent = "还有 " + (dayItems.length - 4) + " 项";
        items.append(more);
      }
    }
    column.append(head, items);
    bindCalendarDateInteraction(column, key, date);
    column.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectFloatingDate(key, date); } });
    els.weekGrid.append(column);
  });
  els.weekGrid.classList.remove("week-animating");
  void els.weekGrid.offsetWidth;
  els.weekGrid.classList.add("week-animating");
}

function renderMonth() {
  const anchor = state.calDate;
  els.rangeTitle.textContent = anchor.getFullYear() + "年" + (anchor.getMonth() + 1) + "月";
  els.weekSubtitle.textContent = "";
  els.weekGrid.className = "floating-month-view";
  els.weekGrid.replaceChildren();
  const weekdays = document.createElement("div");
  weekdays.className = "floating-month-weekdays";
  WEEKDAYS.forEach((name) => { const node = document.createElement("span"); node.textContent = name; weekdays.append(node); });
  const grid = document.createElement("div");
  grid.className = "floating-month-grid";
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const start = startOfWeek(first);
  const todayK = todayKey();
  for (let index = 0; index < 42; index += 1) {
    const date = addDays(start, index);
    const key = dateKey(date);
    const outside = date.getMonth() !== anchor.getMonth();
    const cell = document.createElement("div");
    cell.className = "floating-month-day";
    cell.style.setProperty("--cell-index", index);
    if (outside) cell.classList.add("outside");
    if (key === todayK) cell.classList.add("today");
    if (key === selectedDate) cell.classList.add("selected");
    cell.dataset.date = key;
    if (outside) {
      cell.setAttribute("aria-disabled", "true");
    } else {
      cell.tabIndex = 0;
      cell.setAttribute("role", "button");
      cell.title = "单击选择日期，双击进入当天";
      cell.setAttribute("aria-label", (date.getMonth() + 1) + "月" + date.getDate() + "日，单击选择，双击进入当天");
      bindCalendarDateInteraction(cell, key, date);
      cell.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectFloatingDate(key, date); } });
    }
    const info = calendarInfo(date);
    const head = document.createElement("span");
    head.className = "floating-month-head";
    const number = document.createElement("span");
    number.className = "floating-month-number";
    number.textContent = String(date.getDate());
    head.append(number);
    if (info.events.length) {
      const holidays = document.createElement("span");
      holidays.className = "floating-month-holidays";
      info.events.forEach((event) => holidays.append(calendarEventNode(event)));
      head.append(holidays);
      cell.title = window.DeskWeekCalendarInfo?.eventTitle?.(date) || info.events.map((event) => event.label).join(" · ");
    }
    cell.append(head);
    const dayItems = itemsOn(key);
    const list = document.createElement("span");
    list.className = "floating-month-tasks";
    dayItems.slice(0, 2).forEach((item) => {
      const row = document.createElement("span");
      row.className = "floating-month-task" + (item.done ? " done" : "");
      row.style.setProperty("--item-color", item.color);
      const text = document.createElement("span");
      text.className = "floating-month-task-text";
      text.textContent = (isTaskDeferred(item) ? "◷ " : "") + (item.time ? item.time + " " : "") + item.title;
      row.title = item.title + (isTaskDeferred(item) ? "（延后显示：" + deferLabel(item) + "）" : "");
      row.append(text, calendarDoneToggle(item, "floating-month-task-toggle"));
      list.append(row);
    });
    if (dayItems.length > 2) { const more = document.createElement("span"); more.className = "floating-month-more"; more.textContent = "还有 " + (dayItems.length - 2) + " 项"; list.append(more); }
    cell.append(list);
    grid.append(cell);
  }
  const panel = document.createElement("div");
  panel.className = "floating-month-panel";
  panel.append(weekdays, grid);
  els.weekGrid.append(panel);
  els.weekGrid.classList.remove("week-animating");
  void els.weekGrid.offsetWidth;
  els.weekGrid.classList.add("week-animating");
}

function renderDay() {
  const date = state.calDate;
  const key = dateKey(date);
  const tasks = itemsOn(key);
  els.rangeTitle.textContent = (date.getMonth() + 1) + "月" + date.getDate() + "日";
  els.weekSubtitle.textContent = date.getFullYear() + "年 · " + WEEKDAYS[(date.getDay() + 6) % 7] + " · " + tasks.length + " 项";
  els.weekGrid.className = "floating-day-view";
  els.weekGrid.replaceChildren();
  const panel = document.createElement("div");
  panel.className = "floating-day-panel";
  const head = document.createElement("div");
  head.className = "floating-day-head";
  const copy = document.createElement("div");
  const info = calendarInfo(date);
  const number = document.createElement("strong");
  number.textContent = String(date.getDate());
  const meta = document.createElement("span");
  meta.append(document.createTextNode(WEEKDAYS[(date.getDay() + 6) % 7]));
  if (info.events.length) {
    meta.append(document.createTextNode(" · "));
    info.events.forEach((event, index) => {
      if (index) meta.append(document.createTextNode(" · "));
      meta.append(calendarEventNode(event));
    });
  }
  meta.append(document.createTextNode(" · " + tasks.length + " 项"));
  meta.title = window.DeskWeekCalendarInfo?.eventTitle?.(date) || "";
  copy.append(number, meta);
  const add = document.createElement("button");
  add.type = "button";
  add.className = "floating-day-add";
  add.textContent = "＋ 添加";
  add.addEventListener("click", () => selectFloatingDate(key, date));
  head.append(copy, add);
  panel.append(head);
  const list = document.createElement("div");
  list.className = "floating-day-list";
  if (!tasks.length) {
    const empty = document.createElement("div");
    empty.className = "floating-day-empty";
    empty.textContent = "没有安排";
    list.append(empty);
  } else {
    tasks.forEach((item) => list.append(weekItem(item)));
  }
  panel.append(list);
  els.weekGrid.append(panel);
  els.weekGrid.classList.remove("week-animating");
  void els.weekGrid.offsetWidth;
  els.weekGrid.classList.add("week-animating");
}

function renderCalendarView() {
  document.querySelectorAll("[data-floating-cal-mode]").forEach((button) => {
    const active = button.dataset.floatingCalMode === state.calendarMode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  const unit = state.calendarMode === "year" ? "年" : state.calendarMode === "month" ? "月" : state.calendarMode === "week" ? "周" : "天";
  els.prevWeek.title = state.calendarMode === "day" ? "前一天" : "上一" + unit;
  els.prevWeek.setAttribute("aria-label", els.prevWeek.title);
  els.nextWeek.title = state.calendarMode === "day" ? "后一天" : "下一" + unit;
  els.nextWeek.setAttribute("aria-label", els.nextWeek.title);
  if (state.calendarMode === "month") renderMonth();
  else if (state.calendarMode === "day") renderDay();
  else renderWeek();
  els.calendarModeMenu.hidden = !state.showCalendar;
  const head = document.querySelector(".week-head");
  if (head) { head.classList.remove("calendar-head-swapping"); void head.offsetWidth; head.classList.add("calendar-head-swapping"); }
}

function sameCalendarMonth(a, b) {
  return Boolean(a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth());
}

function sameCalendarWeek(a, b) {
  return Boolean(a && b && dateKey(startOfWeek(a)) === dateKey(startOfWeek(b)));
}

function transitionTargetDate(nextMode, previousMode) {
  const hovered = fromKey(hoveredDateKey);
  const selected = fromKey(selectedDate);
  const anchor = state.calDate;
  if (nextMode === "week" && previousMode === "month") {
    if (hovered && sameCalendarMonth(hovered, anchor)) return hovered;
    if (sameCalendarMonth(calendarFocusDate, anchor)) return calendarFocusDate;
    return anchor;
  }
  if (nextMode === "day" && previousMode === "month") {
    if (hovered && sameCalendarMonth(hovered, anchor)) return hovered;
    if (sameCalendarMonth(calendarFocusDate, anchor)) return calendarFocusDate;
    return anchor;
  }
  if (previousMode === "week" && (nextMode === "day" || nextMode === "month")) {
    if (hovered && sameCalendarWeek(hovered, anchor)) return hovered;
    if (sameCalendarWeek(calendarFocusDate, anchor)) return calendarFocusDate;
    if (selected && sameCalendarWeek(selected, anchor)) return selected;
  }
  return anchor;
}

function openCalendarDay(date) {
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  clearTimeout(calendarDateClickTimer);
  calendarDateClickTimer = 0;
  selectedDate = dateKey(target);
  calendarFocusDate = target;
  state.calDate = target;
  hoveredDateKey = "";
  state.calendarMode = "day";
  if (els.calendarAddDialog?.open) closeCalendarAddDialog();
  renderCalendarView();
  savePrefs();
}

function changeCalendarPeriod(direction) {
  if (state.calendarMode === "month") state.calDate = new Date(state.calDate.getFullYear(), state.calDate.getMonth() + direction, 1);
  else if (state.calendarMode === "day") state.calDate = addDays(state.calDate, direction);
  else state.calDate = addDays(state.calDate, direction * 7);
  calendarFocusDate = new Date(state.calDate);
  hoveredDateKey = "";
  renderCalendarView();
}

function setFloatingCalendarMode(mode) {
  const previousMode = state.calendarMode;
  const nextMode = normalizeCalendarMode(mode);
  if (nextMode === previousMode) return;
  const focus = transitionTargetDate(nextMode, previousMode);
  state.calendarMode = nextMode;
  calendarFocusDate = new Date(focus);
  if (nextMode === "month") {
    state.calDate = new Date(focus.getFullYear(), focus.getMonth(), 1);
  } else if (nextMode === "week") {
    state.calDate = startOfWeek(focus);
  } else {
    state.calDate = new Date(focus.getFullYear(), focus.getMonth(), focus.getDate());
  }
  renderCalendarView();
  savePrefs();
}

function playLayoutReveal() {
  clearTimeout(layoutRevealTimer);
  document.body.classList.remove("layout-reveal");
  void document.body.offsetWidth;
  requestAnimationFrame(() => document.body.classList.add("layout-reveal"));
  layoutRevealTimer = setTimeout(() => document.body.classList.remove("layout-reveal"), 380);
}

function applyViewState(persist = false, animate = false) {
  const calendarOn = Boolean(state.showCalendar);
  const tasksOn = Boolean(state.showTasks);
  const mini = !calendarOn && !tasksOn;
  document.body.classList.toggle("view-both", calendarOn && tasksOn);
  document.body.classList.toggle("view-calendar-only", calendarOn && !tasksOn);
  document.body.classList.toggle("view-tasks-only", !calendarOn && tasksOn);
  document.body.classList.toggle("mini-mode", mini);
  if (tasksOn || !calendarOn || mini) closeCalendarAddDialog();
  els.calendarToggle.classList.toggle("active", calendarOn);
  els.calendarToggle.setAttribute("aria-pressed", String(calendarOn));
  els.calendarToggle.setAttribute("aria-expanded", String(calendarOn));
  els.tasksToggle.classList.toggle("active", tasksOn);
  els.tasksToggle.setAttribute("aria-pressed", String(tasksOn));
  els.calendarModeMenu.hidden = !calendarOn;
  if (calendarOn) renderCalendarView();
  if (mini !== miniModeActive) {
    miniModeActive = mini;
    const result = window.deskWeek?.setMiniMode?.(mini);
    result?.catch?.(() => {});
  }
  if (!mini) requestAnimationFrame(() => applyTaskPanelHeight(state.taskPanelHeight || 292, false, false));
  if (persist) savePrefs();
  if (animate) playLayoutReveal();
}

function calendarDoneToggle(item, extraClass = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "calendar-task-toggle" + (item.done ? " done" : "") + (extraClass ? " " + extraClass : "");
  button.textContent = item.done ? "✓" : "";
  button.setAttribute("aria-pressed", String(item.done));
  button.setAttribute("aria-label", item.done ? "标记为未完成：" + item.title : "标记为完成：" + item.title);
  button.title = item.done ? "标记为未完成" : "标记为完成";
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setItemDoneState(item, !item.done);
    saveState();
    renderAll();
    toast(item.done ? "已完成" : "已恢复");
  });
  button.addEventListener("keydown", (event) => event.stopPropagation());
  return button;
}

function weekItem(item) {
  const node = document.createElement("div");
  node.className = "week-item" + (item.done ? " done" : "");
  node.dataset.date = item.date;
  node.dataset.time = item.time || "";
  node.style.setProperty("--item-color", item.color);
  node.tabIndex = 0;
  node.setAttribute("role", "button");
  node.setAttribute("aria-label", `编辑：${item.title}`);
  node.title = (isTaskDeferred(item) ? "延后显示：" + deferLabel(item) + " · " : "") + "编辑";
  if (isTaskDeferred(item)) node.classList.add("deferred");
  const copy = document.createElement("div");
  copy.className = "week-item-copy";
  const title = document.createElement("span");
  title.className = "week-item-title";
  title.textContent = item.title;
  copy.append(title);
  if (item.time) {
    const time = document.createElement("span");
    time.className = "week-item-time";
    time.textContent = item.time;
    copy.append(time);
  }
  node.append(copy, calendarDoneToggle(item));
  const open = (event) => { event.stopPropagation(); openEditor(item.id); };
  node.addEventListener("click", open);
  node.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") open(event); });
  return node;
}

function renderTasks() {
  const doneView = Boolean(state.showDone);
  const sorted = state.items
    .filter((item) => !item.deleted && (doneView ? item.done : !item.done && isTaskVisible(item)))
    .sort(doneView ? sortCompletedItems : sortItems);
  const open = state.items.filter((item) => !item.deleted && !item.done && isTaskVisible(item)).length;
  const done = state.items.filter((item) => !item.deleted && item.done).length;
  const deferred = state.items.filter((item) => !item.deleted && !item.done && isTaskDeferred(item)).length;
  els.taskListTitle.textContent = doneView ? "已完成" : "最近要做";
  els.addForm.hidden = doneView;
  els.openCount.textContent = doneView ? `${done} 项已完成` : `${open} 项待办`;
  els.deferredCount.hidden = doneView || deferred === 0;
  els.deferredCount.textContent = deferred ? `◷ ${deferred} 项稍后` : "";
  els.deferredCount.title = deferred ? "到时间后再出现" : "";
  els.toggleDone.classList.toggle("active", doneView);
  els.toggleDone.textContent = "已完成";
  els.toggleDone.title = doneView ? "返回待办" : "查看已完成";
  els.toggleDone.setAttribute("aria-pressed", String(doneView));
  els.taskList.replaceChildren();

  if (!sorted.length) {
    const empty = document.createElement("div");
    empty.className = "task-empty";
    const hidden = state.items.filter((item) => !item.deleted && !item.done && isTaskDeferred(item)).length;
    empty.textContent = doneView ? "还没有完成的事" : hidden > 0 ? "还有 " + hidden + " 项稍后出现" : "都做完了";
    els.taskList.append(empty);
    return;
  }

  sorted.forEach((item) => {
    const row = document.createElement("div");
    row.className = "task-row" + (item.done ? " done" : "");
    row.dataset.date = item.date;
    row.dataset.time = item.time || "";
    row.dataset.id = item.id;
    row.style.setProperty("--item-color", item.color);

    const check = document.createElement("input");
    check.className = "task-check";
    check.type = "checkbox";
    check.checked = item.done;
    check.title = item.done ? "恢复" : "完成";
    check.addEventListener("change", () => {
      setItemDoneState(item, check.checked);
      saveState();
      renderAll();
      toast(item.done ? "已完成" : "已恢复");
    });

    const main = document.createElement("div");
    main.className = "task-main";
    const title = document.createElement("span");
    title.className = "task-title";
    title.textContent = item.title;
    title.title = item.title;
    title.addEventListener("click", () => openEditor(item.id));
    main.append(title);

    const info = dueInfo(item);
    if (info.text) {
      const due = document.createElement("span");
      due.className = `task-due ${info.className}`;
      due.textContent = info.text;
      due.title = "编辑";
      due.addEventListener("click", () => openEditor(item.id));
      row.append(check, main, due);
    } else {
      row.append(check, main);
    }
    els.taskList.append(row);
  });
}

function renderAll() { renderCalendarView(); renderTasks(); }

function openEditor(id) {
  const item = state.items.find((entry) => entry.id === id);
  if (!item) return;
  editingId = id;
  els.editTitle.value = item.title;
  els.editDetail.value = item.detail || "";
  els.editDate.value = item.date;
  els.editTime.value = item.time || "";
  window.DeskWeekDefer?.set?.(els.editDefer, normalizeDefer(item.defer));
  els.editDone.checked = item.done;
  els.dialog.showModal();
  setTimeout(() => { els.editTitle.focus(); els.editTitle.select(); }, 30);
}

function closeEditor() {
  editingId = null;
  if (els.dialog.open) els.dialog.close();
}

function toast(message) {
  clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.add("show");
  toastTimer = setTimeout(() => els.toast.classList.remove("show"), 1800);
}

function finishConfirm(result) {
  const resolve = confirmResolver;
  confirmResolver = null;
  if (els.confirmDialog.open) els.confirmDialog.close();
  resolve?.(result);
}

function requestConfirm({ title, message, okText = "确认" }) {
  els.confirmTitle.textContent = title;
  els.confirmMessage.textContent = message;
  els.confirmAccept.textContent = okText;
  return new Promise((resolve) => {
    confirmResolver = resolve;
    els.confirmDialog.showModal();
  });
}

els.weekGrid.addEventListener("wheel", (event) => {
  const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
  if (Math.abs(delta) < 4) return;
  event.preventDefault();
  if (calendarWheelLock) return;
  calendarWheelLock = true;
  if (event.ctrlKey) {
    const levels = ["month", "week", "day"];
    const current = levels.indexOf(state.calendarMode);
    const next = Math.max(0, Math.min(levels.length - 1, current + (delta < 0 ? 1 : -1)));
    if (next !== current) setFloatingCalendarMode(levels[next]);
  } else {
    changeCalendarPeriod(delta > 0 ? 1 : -1);
  }
  setTimeout(() => { calendarWheelLock = false; }, 180);
}, { passive: false });

els.prevWeek.addEventListener("click", () => changeCalendarPeriod(-1));
els.nextWeek.addEventListener("click", () => changeCalendarPeriod(1));
els.todayButton.addEventListener("click", () => {
  state.calDate = new Date();
  calendarFocusDate = new Date(state.calDate);
  hoveredDateKey = "";
  selectedDate = todayKey();
  els.newDate.value = selectedDate;
  renderCalendarView();
  renderTasks();
});
els.calendarToggle.addEventListener("click", () => {
  state.showCalendar = !state.showCalendar;
  applyViewState(true, true);
});
els.tasksToggle.addEventListener("click", () => {
  state.showTasks = !state.showTasks;
  applyViewState(true, true);
});
document.querySelectorAll("[data-floating-cal-mode]").forEach((button) => button.addEventListener("click", () => setFloatingCalendarMode(button.dataset.floatingCalMode)));
els.newDetailButton?.addEventListener("click", () => {
  const rawDate = readTaskDate(els.newDate);
  if (rawDate === null) return;
  const time = readOptionalTime(els.newTime);
  if (time === null) return;
  const targetDate = rawDate ? fromKey(rawDate) : state.calDate;
  openCalendarAddDialog(targetDate, {
    origin: "form",
    title: els.newTitle.value,
    detail: "",
    time,
    dateValue: rawDate,
    defer: window.DeskWeekDefer?.read?.(els.newDefer) || "none",
  });
});
els.aiSummarizeButton?.addEventListener("click", summarizeAISource);
els.aiImageInput?.addEventListener("change", () => addAIImageFiles(els.aiImageInput.files));
els.aiFileInput?.addEventListener("change", () => addAIFiles(els.aiFileInput.files));
els.addAllButton?.addEventListener("click", addAllAIProposals);
els.calendarNewDetail?.addEventListener("input", () => autoResizeTextarea(els.calendarNewDetail));
els.aiSourceText?.addEventListener("paste", (event) => {
  const images = [...(event.clipboardData?.items || [])]
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter(Boolean);
  if (!images.length) return;
  event.preventDefault();
  addAIImageFiles(images);
});
els.calendarQuickAddButton?.addEventListener("click", () => openCalendarAddDialog(state.calDate));
els.closeCalendarAddDialog?.addEventListener("click", closeCalendarAddDialog);
els.calendarCancelAdd?.addEventListener("click", closeCalendarAddDialog);
els.calendarAddDialog?.addEventListener("click", (event) => { if (event.target === els.calendarAddDialog) closeCalendarAddDialog(); });
els.calendarAddDialog?.addEventListener("close", () => {
  if (calendarAddWillCommit) {
    calendarAddWillCommit = false;
    calendarAddOrigin = "calendar";
    return;
  }
  if (calendarAddOrigin === "calendar") resetCalendarAddDefaults();
  else clearAIDraft();
  calendarAddOrigin = "calendar";
});
els.fishWidget.addEventListener("click", () => {
  state.showCalendar = true;
  state.showTasks = true;
  applyViewState(true, true);
});
els.collapseButton.addEventListener("click", () => {
  state.showCalendar = false;
  state.showTasks = false;
  applyViewState(true, true);
});

els.toggleDone.addEventListener("click", () => {
  state.showDone = !state.showDone;
  if (!state.showTasks) {
    state.showTasks = true;
    applyViewState(true, true);
  } else {
    savePrefs();
    renderTasks();
  }
});

els.manageButton?.addEventListener("click", () => {
  window.deskWeek?.openManager?.();
});

els.addForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const title = clampText(els.newTitle.value);
  const rawDate = readTaskDate(els.newDate);
  if (rawDate === null) return;
  if (!title) {
    toast("还差事项");
    return;
  }
  const time = readOptionalTime(els.newTime);
  if (time === null) return;
  const date = resolveTaskDate(rawDate, time);
  state.showDone = false;
  state.items.push(normalizeItem({
    id: uid(),
    title,
    detail: "",
    date,
    time,
    defer: date ? window.DeskWeekDefer?.read?.(els.newDefer) || "none" : "none",
    done: false,
    color: nextTaskColor(date),
    createdAt: new Date().toISOString(),
  }));
  saveState();
  els.newTitle.value = "";
  els.newDate.value = date;
  els.newTime.value = "";
  window.DeskWeekDefer?.set?.(els.newDefer, "none");
  selectedDate = date || todayKey();
  renderAll();
  els.newTitle.focus();
  toast("已添加");
});

els.calendarAddForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (els.singleTaskFields?.hidden) { addAllAIProposals(); return; }
  const addedFromForm = calendarAddOrigin === "form";
  const title = clampText(els.calendarNewTitle.value);
  const rawDate = readTaskDate(els.calendarNewDate);
  if (rawDate === null) return;
  if (!title) {
    toast("还差事项");
    return;
  }
  const time = readOptionalTime(els.calendarNewTime);
  if (time === null) return;
  const date = resolveTaskDate(rawDate, time);
  state.showDone = false;
  state.items.push(normalizeItem({
    id: uid(),
    title,
    detail: clampText(els.calendarNewDetail.value, 4000),
    date,
    time,
    defer: date ? window.DeskWeekDefer?.read?.(els.calendarNewDefer) || "none" : "none",
    done: false,
    color: nextTaskColor(date),
    createdAt: new Date().toISOString(),
  }));
  saveState();
  selectedDate = date || todayKey();
  if (date) {
    state.calDate = fromKey(date);
    calendarFocusDate = new Date(state.calDate);
    hoveredDateKey = date;
  }
  els.newDate.value = date;
  if (addedFromForm) {
    els.newTitle.value = "";
    els.newTime.value = "";
    window.DeskWeekTime?.commit?.(els.newTime);
    window.DeskWeekDefer?.set?.(els.newDefer, "none");
  }
  renderAll();
  calendarAddWillCommit = true;
  closeCalendarAddDialog();
  toast("已添加");
});

els.editForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const item = state.items.find((entry) => entry.id === editingId);
  if (!item) return closeEditor();
  item.title = clampText(els.editTitle.value) || item.title;
  item.detail = clampText(els.editDetail.value, 4000);
  const rawDate = readTaskDate(els.editDate);
  if (rawDate === null) return;
  const time = readOptionalTime(els.editTime); if (time === null) return; item.time = time;
  item.date = resolveTaskDate(rawDate, time);
  item.defer = item.date ? window.DeskWeekDefer?.read?.(els.editDefer) || "none" : "none";
  setItemDoneState(item, els.editDone.checked);
  saveState();
  closeEditor();
  renderAll();
  toast("已保存");
});

els.deleteTask.addEventListener("click", async () => {
  const item = state.items.find((entry) => entry.id === editingId);
  if (!item) return closeEditor();
  const confirmed = await requestConfirm({ title: "移到垃圾箱？", message: `“${item.title}”`, okText: "移到垃圾箱" });
  if (!confirmed) return;
  item.deleted = true;
  item.deletedAt = new Date().toISOString();
  saveState();
  closeEditor();
  renderAll();
  toast("已移到垃圾箱");
});

els.closeDialog.addEventListener("click", closeEditor);
els.cancelEdit.addEventListener("click", closeEditor);
els.dialog.addEventListener("click", (event) => { if (event.target === els.dialog) closeEditor(); });
els.confirmCancel.addEventListener("click", () => finishConfirm(false));
els.confirmAccept.addEventListener("click", () => finishConfirm(true));
els.confirmDialog.addEventListener("click", (event) => { if (event.target === els.confirmDialog) finishConfirm(false); });
els.confirmDialog.addEventListener("close", () => {
  const resolve = confirmResolver;
  confirmResolver = null;
  resolve?.(false);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && els.confirmDialog.open) return;
  if (event.key === "Escape" && els.dialog.open) closeEditor();
  if (event.key.toLowerCase() === "n" && event.ctrlKey && !event.altKey && !event.shiftKey && !els.dialog.open && !els.calendarAddDialog?.open && !els.confirmDialog.open) {
    event.preventDefault();
    if (state.showCalendar && !state.showTasks) {
      openCalendarAddDialog(state.calDate);
    } else {
      state.showDone = false;
      state.showTasks = true;
      applyViewState(true, true);
      requestAnimationFrame(() => els.newTitle.focus({ preventScroll: true }));
    }
  }
});


document.addEventListener("pointerdown", (event) => {
  if (window.deskWeek?.focusSync) window.deskWeek.focusSync();
  const edit = event.target?.closest?.("input, textarea");
  if (edit) setTimeout(() => edit.focus({ preventScroll: true }), 0);
}, true);

let activeGesture = null;


document.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  const resizeHandle = event.target.closest("[data-resize-edge]");
  if (resizeHandle) {
    event.preventDefault();
    activeGesture = "resize";
    const compactLayout = window.innerWidth <= 760 || window.innerHeight <= 560;
    document.body.classList.add("gesturing", "resizing", compactLayout ? "layout-compact" : "layout-regular");
    try { event.target.setPointerCapture?.(event.pointerId); } catch { /* optional */ }
    window.deskWeek?.resizeStart?.(resizeHandle.dataset.resizeEdge);
    return;
  }
  const inTopDragStrip = event.clientY <= 50;
  if (!inTopDragStrip || event.target.closest("button, input, textarea, select, dialog")) return;
  event.preventDefault();
  activeGesture = "move";
  document.body.classList.add("gesturing", "moving");
  try { event.target.setPointerCapture?.(event.pointerId); } catch { /* optional */ }
  window.deskWeek?.dragStart?.();
});


function clearGestureVisuals() {
  const wasResize = document.body.classList.contains("resizing");
  document.body.classList.remove("gesturing", "moving", "resizing", "layout-compact", "layout-regular");
  if (wasResize) {
    requestAnimationFrame(() => {
      renderAll();
      applyTaskPanelHeight(state.taskPanelHeight || 292, false, false);
    });
  }
}

function finishGesture() {
  if (!activeGesture) return;
  activeGesture = null;
  clearGestureVisuals();
  window.deskWeek?.gestureEnd?.();
}
window.deskWeek?.onGestureEnded?.(clearGestureVisuals);
document.addEventListener("pointerup", finishGesture);
document.addEventListener("pointercancel", finishGesture);

let splitterDrag = null;
els.splitter?.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  event.preventDefault();
  splitterDrag = {
    startY: event.screenY,
    startHeight: els.taskCard.getBoundingClientRect().height,
  };
  try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* optional */ }
});
els.splitter?.addEventListener("pointermove", (event) => {
  if (!splitterDrag) return;
  const nextHeight = splitterDrag.startHeight - (event.screenY - splitterDrag.startY);
  applyTaskPanelHeight(nextHeight, false);
});
function finishSplitterDrag() {
  if (!splitterDrag) return;
  splitterDrag = null;
  savePrefs();
}
els.splitter?.addEventListener("pointerup", finishSplitterDrag);
els.splitter?.addEventListener("pointercancel", finishSplitterDrag);
window.addEventListener("resize", () => applyTaskPanelHeight(state.taskPanelHeight || 292, false, false));



const initialDate = todayKey();
els.newDate.value = initialDate;
selectedDate = initialDate;
applyViewState(false);
renderAll();
applyTaskPanelHeight(state.taskPanelHeight || 292, false, false);
if (window.deskWeek?.loadStore) {
  window.deskWeek.loadStore().then((data) => {
    if (data?.loadError) { toast("数据没读出来，原文件还在"); return; }
    if (data?.initialized && Array.isArray(data.items)) applyStore(data);
    else persistStore();
  }).catch(() => {});
  window.deskWeek.onStoreChanged?.((data) => applyStore(data));
}
setInterval(() => {
  const today = todayKey();
  if (selectedDate < today && els.newDate.value === selectedDate) { selectedDate = today; els.newDate.value = today; }
  renderAll();
}, 60000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) renderAll(); });




















