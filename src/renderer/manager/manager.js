"use strict";

const COLORS = ["#9bd3c7", "#e7bd82", "#f39aa4", "#90b8ee", "#c8a6ef", "#a7d48d"];
const WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const $ = (selector) => document.querySelector(selector);
const THEME_KEY = "deskweek.theme.v1";
const els = {
  minimizeWindow: $("#minimizeWindow"), maximizeWindow: $("#maximizeWindow"), closeWindow: $("#closeWindow"),
  countTodo: $("#countTodo"), countDone: $("#countDone"), countTrash: $("#countTrash"),
  tasksView: $("#tasksView"), calendarView: $("#calendarView"), settingsView: $("#settingsView"), content: $(".content"),
  taskViewTitle: $("#taskViewTitle"), deferredShelf: $("#deferredTaskShelf"), deferredShelfToggle: $("#deferredShelfToggle"), deferredShelfCount: $("#deferredShelfCount"), deferredShelfList: $("#deferredShelfList"),
  managerTaskList: $("#managerTaskList"), managerAddForm: $("#managerAddForm"),
  managerNewTitle: $("#managerNewTitle"), managerNewDate: $("#managerNewDate"), managerNewTime: $("#managerNewTime"), managerNewDefer: $("#managerNewDefer"),
  quickFocusButton: $("#quickFocusButton"), managerNewDetailButton: $("#managerNewDetailButton"),
  addDialog: $("#managerAddDialog"), detailedForm: $("#managerDetailedForm"), singleTaskFields: $("#managerSingleTaskFields"), addTitle: $("#managerAddTitle"), addDetail: $("#managerAddDetail"), addDate: $("#managerAddDate"), addTime: $("#managerAddTime"), addDefer: $("#managerAddDefer"), addSubmit: $("#managerAddSubmit"),
  closeAddDialog: $("#managerCloseAddDialog"), cancelAdd: $("#managerCancelAdd"), aiProposals: $("#managerAIProposals"), aiAddAllButton: $("#managerAddAllButton"), aiConfigHint: $("#managerAIConfigHint"), aiSourceText: $("#managerAISourceText"), aiExtraPrompt: $("#managerAIExtraPrompt"), aiImageInput: $("#managerAIImageInput"), aiImageList: $("#managerAIImageList"), aiFileInput: $("#managerAIFileInput"), aiFileList: $("#managerAIFileList"), aiSummarizeButton: $("#managerAISummarizeButton"), aiSummaryStatus: $("#managerAIStatus"),
  calendarTitle: $("#calendarTitle"), calendarBody: $("#calendarBody"), calPrev: $("#calPrev"), calNext: $("#calNext"), calToday: $("#calToday"),
  autostartToggle: $("#autostartToggle"),
  aiBaseUrl: $("#aiBaseUrl"), aiModel: $("#aiModel"), aiApiKey: $("#aiApiKey"), aiAutoTranslateToggle: $("#aiAutoTranslateToggle"), aiConfigStatus: $("#aiConfigStatus"), saveAIConfig: $("#saveAIConfig"), clearAIKey: $("#clearAIKey"),
  themeLightButton: $("#themeLightButton"), themeDarkButton: $("#themeDarkButton"),
  managerExport: $("#managerExport"), managerImport: $("#managerImport"), managerImportFile: $("#managerImportFile"),
  settingsOpenDataFolder: $("#settingsOpenDataFolder"),
  syncToggle: $("#syncToggle"), syncStatusText: $("#syncStatusText"), syncPendingList: $("#syncPendingList"), syncPeerList: $("#syncPeerList"), syncRefresh: $("#syncRefresh"),
  checkUpdateButton: $("#checkUpdateButton"), updateStatus: $("#updateStatus"), updateStatusText: $("#updateStatusText"), updateNotes: $("#updateNotes"), installUpdateButton: $("#installUpdateButton"),
  dialog: $("#managerEditDialog"), editForm: $("#managerEditForm"), editTitle: $("#managerEditTitle"), editDetail: $("#managerEditDetail"), editDate: $("#managerEditDate"), editTime: $("#managerEditTime"), editDefer: $("#managerEditDefer"), editDone: $("#managerEditDone"),
  deleteTask: $("#managerDeleteTask"), closeDialog: $("#managerCloseDialog"), cancelEdit: $("#managerCancelEdit"), toast: $("#managerToast"),
  confirmDialog: $("#managerConfirmDialog"), confirmTitle: $("#managerConfirmTitle"), confirmMessage: $("#managerConfirmMessage"), confirmCancel: $("#managerConfirmCancel"), confirmAccept: $("#managerConfirmAccept"),
};
let state = { items: [], prefs: {}, section: "tasks", filter: "todo", calMode: "month", calDate: new Date(), calFocusDate: new Date() };
let editingId = null;
let editingSnapshot = null;
let toastTimer = null;
let confirmResolver = null;
let wheelLocked = false;
let hoveredCalendarKey = "";
let monthFitFrame = 0;
let lastCalendarMode = "";
let deferredShelfOpen = false;
let managerAIImageAttachments = [];
let managerAIFileAttachments = [];
let managerAIProposalEntries = [];
const MANAGER_AI_MAX_FILES = 5;
const MANAGER_AI_MAX_FILE_BYTES = 20 * 1024 * 1024;
const MANAGER_AI_FILE_EXTENSIONS = new Set([".pdf", ".doc", ".docx", ".xls", ".xlsx", ".xlsm", ".ods", ".csv", ".pptx", ".odt", ".rtf", ".txt", ".md", ".markdown", ".json", ".xml", ".yaml", ".yml", ".log"]);
let managerAISummaryBusy = false;
let managerAIConfigAvailable = false;
let managerAIKeyInvalid = false;
let managerAddSource = "new";
let latestUpdateInfo = null;
let updateBusy = false;
function normalizedTheme(value) { return value === "dark" ? "dark" : "light"; }
function currentTheme() { return normalizedTheme(state.prefs.theme || document.documentElement.dataset.theme || window.DeskWeekThemeBootstrap?.get?.() || "light"); }
function applyTheme(theme, remember = false) {
  const value = normalizedTheme(theme);
  if (remember) state.prefs.theme = value;
  document.documentElement.dataset.theme = value;
  document.body.classList.toggle("theme-dark", value === "dark");
  document.body.classList.toggle("theme-light", value === "light");
  document.querySelectorAll("#dwDatePopover, #dwTimePopover, #dwDeferPopover").forEach((popover) => { popover.dataset.theme = value; });
  const meta = document.querySelector("meta[name=\"color-scheme\"]");
  if (meta) meta.setAttribute("content", value);
  try { localStorage.setItem(THEME_KEY, value); } catch { /* optional */ }
  renderThemeChoice(value);
}
function renderThemeChoice(theme = currentTheme()) {
  const value = normalizedTheme(theme);
  const transparent = window.DeskWeekBackground.normalize(state.prefs.widgetBackground) === "transparent";
  const autoActive = transparent && state.prefs.autoTheme !== false;
  const activeChoice = autoActive ? "auto" : value;
  document.querySelectorAll("[data-theme-choice]").forEach((button) => {
    if (button.dataset.themeChoice === "auto") button.hidden = !transparent;
    const active = button.dataset.themeChoice === activeChoice;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}
async function setThemePreference(choice) {
  if (choice === "auto") {
    state.prefs.autoTheme = true;
    renderThemeChoice(currentTheme());
    try { await persist(); toast("跟随背景亮度"); }
    catch { toast("主题保存失败"); }
    return;
  }
  const theme = normalizedTheme(choice);
  state.prefs.autoTheme = false;
  applyTheme(theme, true);
  try { await persist(); toast(theme === "dark" ? "深色" : "浅色"); }
  catch { toast("主题保存失败"); }
}

async function setWidgetBackground(value) {
  const previous = window.DeskWeekBackground.normalize(state.prefs.widgetBackground);
  state.prefs.widgetBackground = window.DeskWeekBackground.apply(value);
  renderThemeChoice(currentTheme());
  try { await persist(); toast(value === "transparent" ? "浮窗背景已透明" : "已恢复标准背景"); }
  catch {
    state.prefs.widgetBackground = window.DeskWeekBackground.apply(previous);
    toast("浮窗背景保存失败，请重试");
  }
}

function pad(value) { return String(value).padStart(2, "0"); }
function dateKey(date) { return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; }
function todayKey() { return dateKey(new Date()); }
function fromKey(key) { const [y, m, d] = String(key).split("-").map(Number); return new Date(y, m - 1, d); }
function isValidDateKey(value) { const text = String(value || ""); return /^\d{4}-\d{2}-\d{2}$/.test(text) && dateKey(fromKey(text)) === text; }
function addDays(date, days) { const n = new Date(date); n.setDate(n.getDate() + days); return n; }
function normalizeDefer(value) { const text = String(value || "none").toLowerCase(); return text === "1m" || /^[1-9]\d*d$/.test(text) ? text : "none"; }
function subtractMonthsClamped(date, months) { const day = date.getDate(); const target = new Date(date.getFullYear(), date.getMonth() - months, 1); const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate(); target.setDate(Math.min(day, lastDay)); return target; }
function visibleFromKey(item) { if (!isValidDateKey(item.date)) return ""; const date = fromKey(item.date); const defer = normalizeDefer(item.defer); if (defer.endsWith("m")) return dateKey(subtractMonthsClamped(date, Number(defer.slice(0, -1)) || 1)); if (defer.endsWith("d")) return dateKey(addDays(date, -(Number(defer.slice(0, -1)) || 0))); return item.date; }
function isTaskVisible(item) { if (!isValidDateKey(item.date)) return true; return normalizeDefer(item.defer) === "none" || todayKey() >= visibleFromKey(item); }
function isTaskDeferred(item) { return !isTaskVisible(item); }
function deferLabel(item) { const value = normalizeDefer(item.defer); if (value === "none") return "立即显示"; if (value === "1m") return "提前1个月"; return "提前" + value.slice(0, -1) + "天"; }
function addMonths(date, months) { return new Date(date.getFullYear(), date.getMonth() + months, 1); }
function addYears(date, years) { return new Date(date.getFullYear() + years, date.getMonth(), 1); }
function startOfWeek(date) { const n = new Date(date.getFullYear(), date.getMonth(), date.getDate()); n.setDate(n.getDate() - ((n.getDay() + 6) % 7)); return n; }
function uid() { return (crypto.randomUUID && crypto.randomUUID()) || `item-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function clampText(value, max = 100) { return String(value || "").trim().slice(0, max); }
function validItem(item) { const dateOk = !item?.date || isValidDateKey(item.date); return item && typeof item.id === "string" && typeof item.title === "string" && dateOk; }
function normalizeItem(item) {
  const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(item.time || "") ? item.time : "";
  const date = isValidDateKey(item.date) ? item.date : time ? todayKey() : "";
  const createdAt = typeof item.createdAt === "string" && !Number.isNaN(Date.parse(item.createdAt)) ? item.createdAt : new Date().toISOString();
  const completedAt = Boolean(item.done) ? (typeof item.completedAt === "string" && !Number.isNaN(Date.parse(item.completedAt)) ? item.completedAt : createdAt) : "";
  return {
    ...item, id: item.id || uid(), title: clampText(item.title) || "未命名事项", detail: typeof item.detail === "string" ? clampText(item.detail, 4000) : "", date, time,
    done: Boolean(item.done), completedAt, deleted: Boolean(item.deleted), deletedAt: typeof item.deletedAt === "string" ? item.deletedAt : "",
    color: COLORS.includes(item.color) ? item.color : COLORS[0], defer: date ? normalizeDefer(item.defer) : "none", createdAt,
  };
}
function setItemDoneState(item, done) { item.done = Boolean(done); item.completedAt = item.done ? (item.completedAt || new Date().toISOString()) : ""; }
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
function readTaskDate(input) { if (!input) return ""; if (!String(input.value || "").trim()) { input.setCustomValidity?.(""); return ""; } const valid = window.DeskWeekDate?.commit ? window.DeskWeekDate.commit(input) : isValidDateKey(input.value); if (!valid) { input.reportValidity?.(); return null; } const value = window.DeskWeekDate?.normalize?.(input.value) ?? input.value; return isValidDateKey(value) ? value : null; }
function resolveTaskDate(date, time) { if (isValidDateKey(date)) return date; return time ? todayKey() : ""; }
function taskSortRank(item) { const dated = isValidDateKey(item.date); if (!item.done && dated && item.date < todayKey()) return 0; if (!dated) return 1; return 2; }
function sortItems(a, b) { const rank = taskSortRank(a) - taskSortRank(b); if (rank) return rank; if (taskSortRank(a) === 1) return a.createdAt.localeCompare(b.createdAt); return `${a.date}T${a.time || "00:00"}`.localeCompare(`${b.date}T${b.time || "00:00"}`) || a.createdAt.localeCompare(b.createdAt); }
function sortCompletedItems(a, b) { return String(b.completedAt || b.createdAt || "").localeCompare(String(a.completedAt || a.createdAt || "")); }
function activeItems() { return state.items.filter((item) => !item.deleted).sort(sortItems); }
function itemsOn(key) { return activeItems().filter((item) => item.date === key); }
function dueText(item) {
  if (!item.date) return "";
  const diff = Math.round((fromKey(item.date) - fromKey(todayKey())) / 86400000);
  const time = item.time ? ` ${item.time}` : "";
  if (diff < 0) return `已逾期${time}`;
  if (diff === 0) return `今天${time}`;
  if (diff === 1) return `明天${time}`;
  return `${fromKey(item.date).getMonth() + 1}月${fromKey(item.date).getDate()}日${time}`;
}
function toast(message) { clearTimeout(toastTimer); els.toast.textContent = message; els.toast.classList.add("show"); toastTimer = setTimeout(() => els.toast.classList.remove("show"), 1800); }
function finishConfirm(result) { const resolve = confirmResolver; confirmResolver = null; if (els.confirmDialog.open) els.confirmDialog.close(); resolve?.(result); }
function requestConfirm({ title, message, okText = "确认" }) { els.confirmTitle.textContent = title; els.confirmMessage.textContent = message; els.confirmAccept.textContent = okText; return new Promise((resolve) => { confirmResolver = resolve; els.confirmDialog.showModal(); }); }
function persist() { return window.deskWeek?.saveStore?.({ items: state.items, prefs: state.prefs }) || Promise.resolve(); }
async function commit(message) { reconcileTaskColors(state.items); try { await persist(); if (message) toast(message); renderAll(); } catch (error) { toast(String(error.message || "保存失败").replace(/^Error invoking remote method[^:]+:\s*/, "")); } }
function switchSection(section) {
  state.section = section;
  document.querySelectorAll("[data-section]").forEach((node) => {
    const active = node.dataset.section === section;
    node.classList.toggle("active", active);
    node.setAttribute("aria-current", active ? "page" : "false");
  });
  els.tasksView.classList.toggle("active-view", section === "tasks");
  els.calendarView.classList.toggle("active-view", section === "calendar");
  els.settingsView.classList.toggle("active-view", section === "settings");
  els.content.classList.toggle("calendar-mode", section === "calendar");
  els.content.classList.toggle("tasks-mode", section === "tasks");
  if (section === "calendar") renderCalendar();
  if (section === "settings") { loadAutostart(); loadAIConfig(); renderThemeChoice(); }
}
function switchFilter(filter) {
  state.filter = filter;
  document.querySelectorAll("[data-filter]").forEach((node) => {
    const active = node.dataset.filter === filter;
    node.classList.toggle("active", active);
    node.setAttribute("aria-pressed", String(active));
  });
  switchSection("tasks"); renderTasks();
}
function taskFilterItems() {
  if (state.filter === "trash") return state.items.filter((item) => item.deleted).sort(sortItems);
  if (state.filter === "done") return state.items.filter((item) => !item.deleted && item.done).sort(sortCompletedItems);
  return state.items.filter((item) => !item.deleted && !item.done && isTaskVisible(item)).sort(sortItems);
}
function deferredItems() {
  return state.items.filter((item) => !item.deleted && !item.done && isTaskDeferred(item)).sort(sortItems);
}
function renderDeferredShelf() {
  const items = deferredItems();
  const visible = state.filter === "todo" && items.length > 0;
  els.deferredShelf.hidden = !visible;
  if (!visible) {
    deferredShelfOpen = false;
    els.deferredShelfToggle.setAttribute("aria-expanded", "false");
    els.deferredShelf.classList.remove("is-open");
    els.deferredShelfList.hidden = true;
    return;
  }
  els.deferredShelfCount.textContent = items.length + " 项";

  els.deferredShelfToggle.setAttribute("aria-expanded", String(deferredShelfOpen));
  els.deferredShelf.classList.toggle("is-open", deferredShelfOpen);
  els.deferredShelfList.hidden = !deferredShelfOpen;
  els.deferredShelfList.replaceChildren();
  if (!deferredShelfOpen) return;
  items.forEach((item, index) => {
    const row = makeTaskRow(item);
    row.style.setProperty("--row-index", Math.min(index, 12));
    els.deferredShelfList.append(row);
  });
}
function renderSidebarCounts() {
  if (window.DeskWeekRuntime?.paused()) return;
  els.countTodo.textContent = state.items.filter((item) => !item.deleted && !item.done && isTaskVisible(item)).length;
  els.countDone.textContent = state.items.filter((item) => !item.deleted && item.done).length;
  els.countTrash.textContent = state.items.filter((item) => item.deleted).length;
}
function renderTasks() {
  if (window.DeskWeekRuntime?.paused()) return;
  const items = taskFilterItems();
  const titles = { todo: "未完成", done: "已完成", trash: "垃圾箱" };
  els.taskViewTitle.textContent = titles[state.filter];
els.managerAddForm.hidden = state.filter !== "todo";
  els.managerTaskList.replaceChildren();
  if (!items.length) {
    const empty = document.createElement("div"); empty.className = "empty-state";
    empty.innerHTML = state.filter === "todo" ? "<strong>暂时没有待办</strong>" : state.filter === "done" ? "<strong>还没有完成的事</strong>" : "<strong>垃圾箱是空的</strong>";
    els.managerTaskList.append(empty);
  } else {
    items.forEach((item, index) => { const row = makeTaskRow(item); row.style.setProperty("--row-index", Math.min(index, 12)); els.managerTaskList.append(row); });
  }
  renderDeferredShelf();
}
function makeTaskRow(item) {
  const row = document.createElement("div"); row.className = "manager-task-row" + (item.done ? " done" : ""); row.dataset.id = item.id; row.style.setProperty("--item-color", item.color);
  const check = document.createElement("input"); check.className = "task-check"; check.type = "checkbox"; check.checked = item.done; check.disabled = state.filter === "trash"; check.title = item.done ? "标记为未完成" : "标记为完成";
  check.addEventListener("change", () => { setItemDoneState(item, check.checked); commit(item.done ? "已完成" : "已恢复"); });
  const copy = document.createElement("div"); copy.className = "task-copy"; copy.tabIndex = 0; copy.setAttribute("role", "button"); copy.setAttribute("aria-label", `编辑任务：${item.title}`);
  copy.addEventListener("click", () => openEditor(item.id));
  copy.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openEditor(item.id); } });
  const title = document.createElement("div"); title.className = "manager-task-title"; title.textContent = item.title;
  const meta = document.createElement("div"); meta.className = "manager-task-meta";
  const dueLabel = dueText(item);
  if (dueLabel) { const due = document.createElement("span"); due.className = "task-date" + (!item.done && item.date && item.date < todayKey() ? " overdue" : item.date === todayKey() ? " today" : ""); due.textContent = dueLabel; meta.append(due); }
  if (isTaskDeferred(item)) { const defer = document.createElement("span"); defer.className = "task-defer-tag"; defer.textContent = "◷ " + deferLabel(item); meta.append(defer); }
  if (meta.childElementCount) copy.append(title, meta); else copy.append(title);
  const actions = document.createElement("div"); actions.className = "task-row-actions";
  if (state.filter === "trash") {
    const restore = document.createElement("button"); restore.className = "row-action"; restore.textContent = "恢复"; restore.addEventListener("click", () => { item.deleted = false; item.deletedAt = ""; commit("已恢复"); });
    const remove = document.createElement("button"); remove.className = "row-action danger"; remove.textContent = "永久删除"; remove.addEventListener("click", async () => { if (await requestConfirm({ title: "永久删除？", message: `“${item.title}”`, okText: "永久删除" })) { state.items = state.items.filter((x) => x.id !== item.id); commit("已永久删除"); } });
    actions.append(restore, remove);
  } else { const edit = document.createElement("button"); edit.className = "row-action"; edit.textContent = "编辑"; edit.addEventListener("click", () => openEditor(item.id)); actions.append(edit); }
  row.append(check, copy, actions); return row;
}
function openEditor(id) {
  const item = state.items.find((entry) => entry.id === id); if (!item) return;
  editingId = id; editingSnapshot = structuredClone(item); els.editTitle.value = item.title; els.editDetail.value = item.detail || ""; els.editDate.value = item.date; els.editTime.value = item.time || ""; window.DeskWeekDefer?.set?.(els.editDefer, normalizeDefer(item.defer)); els.editDone.checked = item.done; els.deleteTask.textContent = item.deleted ? "永久删除" : "移到垃圾箱"; els.dialog.showModal(); setTimeout(() => { els.editTitle.focus(); els.editTitle.select(); }, 30);
}
function closeEditor() {
  editingSnapshot = null; editingId = null; if (els.dialog.open) els.dialog.close(); }
function fitMonthTaskLists() {
  monthFitFrame = 0;
  if (state.section !== "calendar" || state.calMode !== "month") return;
  document.querySelectorAll("#calendarView .calendar-day").forEach((cell) => {
    const list = cell.querySelector(".day-task-list");
    if (!list) return;
    const pills = [...list.querySelectorAll(".day-task-pill")];
    const more = list.querySelector(".day-task-more");
    const total = Number(list.dataset.total || pills.length);
    pills.forEach((pill) => { pill.hidden = false; });
    if (!more) return;
    more.hidden = true;
    more.textContent = "";
    list.classList.remove("has-overflow");
    if (!pills.length) return;
    const gap = parseFloat(getComputedStyle(list).rowGap) || 0;
    const available = list.clientHeight;
    const heights = pills.map((pill) => pill.getBoundingClientRect().height);
    const needed = (count) => heights.slice(0, count).reduce((sum, height) => sum + height, 0) + Math.max(0, count - 1) * gap;
    const allFit = total <= pills.length && needed(pills.length) <= available + 0.5;
    if (allFit) return;

    more.hidden = false;
    more.textContent = "还有 0 项";
    const moreHeight = more.getBoundingClientRect().height;
    const pillBudget = Math.max(0, available - moreHeight - gap);
    let visible = pills.length;
    while (visible > 0 && needed(visible) > pillBudget + 0.5) visible -= 1;
    const remainder = total - visible;
    pills.forEach((pill, index) => { pill.hidden = index >= visible; });
    more.textContent = "还有 " + remainder + " 项";
    list.classList.add("has-overflow");
  });
}
function scheduleMonthFit() {
  cancelAnimationFrame(monthFitFrame);
  monthFitFrame = requestAnimationFrame(fitMonthTaskLists);
}

function renderCalendar() {
  if (window.DeskWeekRuntime?.paused()) return;
  const previousMode = lastCalendarMode || state.calMode;
  lastCalendarMode = state.calMode;
  els.calendarBody.dataset.calendarMode = state.calMode;
  els.calendarBody.dataset.previousMode = previousMode;
  els.calendarTitle.textContent = calendarTitle();
  document.querySelectorAll("[data-cal-mode]").forEach((node) => {
    const active = node.dataset.calMode === state.calMode;
    node.classList.toggle("active", active);
    node.setAttribute("aria-pressed", String(active));
  });
  const unit = state.calMode === "year" ? "年" : state.calMode === "month" ? "月" : state.calMode === "week" ? "周" : "天";
  els.calPrev.setAttribute("aria-label", state.calMode === "day" ? "前一天" : "上一" + unit);
  els.calNext.setAttribute("aria-label", state.calMode === "day" ? "后一天" : "下一" + unit);
  els.calendarBody.replaceChildren();
  if (state.calMode === "day") renderDay(); else if (state.calMode === "week") renderWeek(); else if (state.calMode === "year") renderYear(); else renderMonth();
  els.calendarBody.classList.remove("calendar-animating");
  void els.calendarBody.offsetWidth;
  els.calendarBody.classList.add("calendar-animating");
  const header = document.querySelector(".calendar-header");
  if (header) { header.classList.remove("calendar-head-swapping"); void header.offsetWidth; header.classList.add("calendar-head-swapping"); }
}
function calendarTitle() {
  const d = state.calDate;
  if (state.calMode === "year") return `${d.getFullYear()}年`;
  if (state.calMode === "day") return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${WEEKDAYS[(d.getDay() + 6) % 7]}`;
  if (state.calMode === "week") { const start = startOfWeek(d); const end = addDays(start, 6); return `${start.getFullYear()}年${start.getMonth() + 1}月${start.getDate()}日 — ${end.getMonth() + 1}月${end.getDate()}日`; }
  return `${d.getFullYear()}年${d.getMonth() + 1}月`;
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
function dayCell(date, outside = false) {
  const cell = document.createElement("div"); const key = dateKey(date);
  cell.className = "calendar-day" + (outside ? " outside" : "") + (key === todayKey() ? " today" : ""); cell.dataset.date = key;
  if (outside) cell.setAttribute("aria-disabled", "true");
  else {
    cell.setAttribute("role", "button");
    cell.tabIndex = 0;
    cell.setAttribute("aria-label", `${date.getMonth() + 1}月${date.getDate()}日，点击新建任务`);
    const create = (event) => { if (event.target.closest(".day-task-pill")) return; openNewTaskForDate(key); };
    cell.addEventListener("click", create);
    cell.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); create(event); } });
    cell.addEventListener("pointerenter", () => { hoveredCalendarKey = key; });
    cell.addEventListener("focusin", () => { hoveredCalendarKey = key; });
  }
  const top = document.createElement("div"); top.className = "day-top";
  const number = document.createElement("span"); number.className = "day-number"; number.textContent = date.getDate();
  const info = calendarInfo(date);
  const tasks = itemsOn(key);
  const count = document.createElement("span"); count.className = "day-count"; count.textContent = tasks.length ? String(tasks.length) : "";
  top.append(number);
  if (info.events.length) {
    cell.classList.add("has-holiday");
    const holidays = document.createElement("span");
    holidays.className = "calendar-day-holidays";
    info.events.forEach((event) => holidays.append(calendarEventNode(event)));
    top.append(holidays);
    cell.title = window.DeskWeekCalendarInfo?.eventTitle?.(date) || info.events.map((event) => event.label).join(" · ");
  }
  top.append(count); cell.append(top);
  const list = document.createElement("div"); list.className = "day-task-list"; list.dataset.total = String(tasks.length);
  tasks.slice(0, 3).forEach((item) => {
    const pill = document.createElement("div"); pill.className = "day-task-pill" + (item.done ? " done" : "") + (isTaskDeferred(item) ? " deferred" : ""); pill.style.setProperty("--pill", item.color);
    pill.tabIndex = 0; pill.setAttribute("role", "button"); pill.setAttribute("aria-label", `编辑任务：${item.title}`);
    const dot = document.createElement("i"); const text = document.createElement("span"); text.textContent = (isTaskDeferred(item) ? "◷ " : "") + (item.time ? item.time + " " : "") + item.title;
    pill.append(dot, text); pill.title = item.title + (isTaskDeferred(item) ? "（延后显示：" + deferLabel(item) + "）" : ""); pill.addEventListener("click", (event) => { event.stopPropagation(); openEditor(item.id); }); pill.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); openEditor(item.id); } }); list.append(pill);
  });
  const more = document.createElement("div"); more.className = "day-task-more"; more.hidden = true; list.append(more);
  cell.append(list); return cell;
}
function renderMonth() {
  const weekdays = document.createElement("div"); weekdays.className = "calendar-weekdays";
  WEEKDAYS.forEach((name) => { const node = document.createElement("div"); node.className = "calendar-weekday"; node.textContent = name; weekdays.append(node); });
  const grid = document.createElement("div"); grid.className = "month-grid"; const first = new Date(state.calDate.getFullYear(), state.calDate.getMonth(), 1); const start = startOfWeek(first);
  for (let i = 0; i < 42; i += 1) { const date = addDays(start, i); const cell = dayCell(date, date.getMonth() !== state.calDate.getMonth()); cell.style.setProperty("--cell-index", i); grid.append(cell); }
  els.calendarBody.append(weekdays, grid); scheduleMonthFit();
}
function renderWeek() {
  const start = startOfWeek(state.calDate); const grid = document.createElement("div"); grid.className = "week-calendar-grid";
  for (let i = 0; i < 7; i += 1) {
    const date = addDays(start, i); const key = dateKey(date); const card = document.createElement("div"); card.className = "week-day-card" + (key === todayKey() ? " today" : ""); card.style.setProperty("--cell-index", i); card.addEventListener("pointerenter", () => { hoveredCalendarKey = key; }); card.addEventListener("focusin", () => { hoveredCalendarKey = key; });
    const head = document.createElement("button"); head.type = "button"; head.className = "week-day-head"; const info = calendarInfo(date); head.setAttribute("aria-label", `${date.getMonth() + 1}月${date.getDate()}日，点击新建任务`); head.title = window.DeskWeekCalendarInfo?.eventTitle?.(date) || ""; head.addEventListener("click", () => openNewTaskForDate(key)); const strong = document.createElement("strong"); strong.append(document.createTextNode(WEEKDAYS[i])); const number = document.createElement("span"); number.className = "week-day-number"; number.textContent = String(date.getDate()); const events = document.createElement("span"); events.className = "week-day-events"; info.events.forEach((event) => events.append(calendarEventNode(event))); const count = document.createElement("span"); count.className = "week-day-count"; count.textContent = itemsOn(key).length ? `${itemsOn(key).length} 项` : ""; head.append(strong, number, events, count); card.append(head);
    const list = document.createElement("div"); list.className = "day-task-list";
    itemsOn(key).forEach((item) => { const deferred = isTaskDeferred(item); const pill = document.createElement("div"); pill.className = "day-task-pill" + (item.done ? " done" : "") + (deferred ? " deferred" : ""); pill.style.setProperty("--pill", item.color); pill.tabIndex = 0; pill.setAttribute("role", "button"); pill.setAttribute("aria-label", `编辑任务：${item.title}`); const dot = document.createElement("i"); const text = document.createElement("span"); text.textContent = (deferred ? "◷ " : "") + (item.time ? `${item.time} ` : "") + item.title; pill.append(dot, text); pill.title = item.title + (deferred ? "（延后显示：" + deferLabel(item) + "）" : ""); pill.addEventListener("click", (event) => { event.stopPropagation(); openEditor(item.id); }); pill.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); openEditor(item.id); } }); list.append(pill); });
    if (!itemsOn(key).length) { const empty = document.createElement("div"); empty.className = "day-task-more"; empty.textContent = "—"; list.append(empty); }
    card.append(list); grid.append(card);
  }
  els.calendarBody.append(grid);
}
function renderDay() {
  const date = state.calDate; const key = dateKey(date); const wrap = document.createElement("div"); wrap.className = "day-focus";
  const head = document.createElement("div"); head.className = "day-focus-head"; const left = document.createElement("div"); const title = document.createElement("h3"); title.textContent = `${date.getMonth() + 1}月${date.getDate()}日`; const info = calendarInfo(date); const sub = document.createElement("p"); sub.append(document.createTextNode(`${itemsOn(key).length} 项`)); if (info.events.length) { sub.append(document.createTextNode(" · ")); info.events.forEach((event, index) => { if (index) sub.append(document.createTextNode(" · ")); sub.append(calendarEventNode(event)); }); } sub.title = window.DeskWeekCalendarInfo?.eventTitle?.(date) || ""; left.append(title, sub);
  const add = document.createElement("button"); add.className = "primary-button"; add.textContent = "＋ 添加"; add.addEventListener("click", () => openNewTaskForDate(key)); head.append(left, add);
  const list = document.createElement("div"); list.className = "day-focus-list"; const tasks = itemsOn(key);
  if (!tasks.length) { const empty = document.createElement("div"); empty.className = "empty-state"; empty.innerHTML = "<strong>没有安排</strong>"; list.append(empty); }
  else tasks.forEach((item) => { const deferred = isTaskDeferred(item); const row = document.createElement("div"); row.className = "day-focus-row" + (item.done ? " done" : "") + (deferred ? " deferred" : ""); row.style.setProperty("--pill", item.color); row.tabIndex = 0; row.setAttribute("role", "button"); row.setAttribute("aria-label", `编辑任务：${item.title}`); const dot = document.createElement("i"); const copy = document.createElement("div"); const t = document.createElement("strong"); t.textContent = item.title; const meta = document.createElement("span"); meta.textContent = `${item.time || "全天"} · ${item.done ? "已完成" : "待完成"}${deferred ? " · ◷ " + deferLabel(item) : ""}`; copy.append(t, meta); row.append(dot, copy); row.addEventListener("click", () => openEditor(item.id)); row.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openEditor(item.id); } }); list.append(row); });
  wrap.append(head, list); els.calendarBody.append(wrap);
}
function renderYear() {
  const grid = document.createElement("div"); grid.className = "year-grid";
  for (let month = 0; month < 12; month += 1) {
    const monthDate = new Date(state.calDate.getFullYear(), month, 1); const monthKey = dateKey(monthDate); const mini = document.createElement("div"); mini.className = "mini-month"; mini.style.setProperty("--cell-index", month); mini.dataset.date = monthKey; mini.addEventListener("pointerenter", () => { hoveredCalendarKey = monthKey; }); mini.addEventListener("focusin", () => { hoveredCalendarKey = monthKey; }); mini.addEventListener("click", () => { state.calFocusDate = monthDate; state.calDate = monthDate; state.calMode = "month"; renderCalendar(); });
    const title = document.createElement("h4"); title.textContent = `${month + 1}月`; mini.append(title);
    const weekdays = document.createElement("div"); weekdays.className = "mini-weekdays"; ["一", "二", "三", "四", "五", "六", "日"].forEach((d) => { const n = document.createElement("span"); n.textContent = d; weekdays.append(n); }); mini.append(weekdays);
    const days = document.createElement("div"); days.className = "mini-grid"; const start = startOfWeek(new Date(state.calDate.getFullYear(), month, 1));
    for (let i = 0; i < 42; i += 1) { const date = addDays(start, i); const key = dateKey(date); const n = document.createElement("div"); n.className = "mini-day" + (date.getMonth() !== month ? " outside" : "") + (itemsOn(key).length ? " has-tasks" : "") + (key === todayKey() ? " today" : ""); n.textContent = date.getDate(); days.append(n); }
    mini.setAttribute("role", "button"); mini.tabIndex = 0; mini.setAttribute("aria-label", `${month + 1}月，打开月视图`); mini.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); mini.click(); } });
    mini.append(days); grid.append(mini);
  }
  els.calendarBody.append(grid);
}
function renderAll() {
  if (window.DeskWeekRuntime?.paused()) return;
  renderSidebarCounts();
  renderTasks();
  if (state.section === "calendar") renderCalendar();
}
async function loadAIConfig() {
  if (!els.aiBaseUrl) return;
  try {
    const config = await window.deskWeek?.getAIConfig?.();
    if (!config) return;
    els.aiBaseUrl.value = config.baseUrl || "";
    els.aiModel.value = config.model || "";
    els.aiApiKey.value = "";
    els.aiAutoTranslateToggle.checked = Boolean(config.autoTranslate);
    els.aiApiKey.placeholder = config.hasKey ? "已保存，留空不修改" : config.keyInvalid ? "密钥失效，请重新填写" : "填写 API Key";
    els.aiConfigStatus.textContent = config.hasKey ? "已配置" : config.keyInvalid ? "密钥失效" : "未配置";
    els.aiConfigStatus.classList.toggle("configured", Boolean(config.hasKey));
    els.aiConfigStatus.classList.toggle("invalid", Boolean(config.keyInvalid));
  } catch {
    els.aiConfigStatus.textContent = "读取失败";
    els.aiConfigStatus.classList.remove("configured", "invalid");
  }
}

async function persistAIConfig(clearKey = false) {
  try {
    const config = await window.deskWeek?.saveAIConfig?.({
      baseUrl: els.aiBaseUrl.value,
      model: els.aiModel.value,
      apiKey: els.aiApiKey.value,
      clearKey,
      autoTranslate: Boolean(els.aiAutoTranslateToggle?.checked),
    });
    if (!config) throw new Error("AI 配置接口不可用");
    await loadAIConfig();
    toast(clearKey ? "已清除 AI 密钥" : "AI 配置已保存");
  } catch (error) {
    const message = String(error?.message || "AI 配置保存失败").replace(/^Error invoking remote method '[^']+':\s*/i, "").replace(/^Error:\s*/i, "");
    toast(message);
  }
}

function setManagerAIStatus(message = "", isError = false) {
  if (!els.aiSummaryStatus) return;
  els.aiSummaryStatus.textContent = message;
  els.aiSummaryStatus.hidden = !message;
  els.aiSummaryStatus.classList.toggle("error", isError);
}

function renderManagerAIImageList() {
  if (!els.aiImageList) return;
  els.aiImageList.replaceChildren();
  managerAIImageAttachments.forEach((image, index) => {
    const item = document.createElement("span"); item.className = "ai-image-item";
    const preview = document.createElement("img"); preview.src = image.dataUrl; preview.alt = image.name;
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "ai-image-remove"; remove.setAttribute("aria-label", "移除 " + image.name); remove.textContent = "×";
    remove.addEventListener("click", () => { managerAIImageAttachments.splice(index, 1); renderManagerAIImageList(); });
    item.append(preview, remove); els.aiImageList.append(item);
  });
}

function renderManagerAIFileList() {
  if (!els.aiFileList) return;
  els.aiFileList.replaceChildren();
  managerAIFileAttachments.forEach((file, index) => {
    const item = document.createElement("span"); item.className = "ai-file-item";
    const name = document.createElement("span"); name.className = "ai-file-name"; name.textContent = file.name; name.title = file.name;
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "ai-file-remove"; remove.setAttribute("aria-label", "移除 " + file.name); remove.textContent = "×";
    remove.addEventListener("click", () => { managerAIFileAttachments.splice(index, 1); renderManagerAIFileList(); });
    item.append(name, remove); els.aiFileList.append(item);
  });
}

function clearManagerAIProposalResults() {
  managerAIProposalEntries = [];
  if (els.aiProposals) { els.aiProposals.replaceChildren(); els.aiProposals.hidden = true; }
  if (els.singleTaskFields) els.singleTaskFields.hidden = false;
  if (els.addSubmit) els.addSubmit.hidden = false;
  if (els.aiAddAllButton) els.aiAddAllButton.hidden = true;
}

function clearManagerAIDraft() {
  managerAIImageAttachments = [];
  managerAIFileAttachments = [];
  if (els.aiSourceText) els.aiSourceText.value = "";
  if (els.aiExtraPrompt) els.aiExtraPrompt.value = "";
  if (els.aiImageInput) els.aiImageInput.value = "";
  if (els.aiFileInput) els.aiFileInput.value = "";
  renderManagerAIImageList();
  renderManagerAIFileList();
  clearManagerAIProposalResults();
  setManagerAIStatus("");
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

function managerFileExtension(name) {
  const match = String(name || "").toLowerCase().match(/\.([^.]+)$/);
  return match ? "." + match[1] : "";
}

function readManagerFileDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("无法读取文件：" + file.name));
    reader.readAsDataURL(file);
  });
}

async function addManagerAIFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  const room = Math.max(0, MANAGER_AI_MAX_FILES - managerAIFileAttachments.length);
  if (!room) { setManagerAIStatus("最多添加 5 个文件", true); return; }
  const accepted = [];
  for (const file of files.slice(0, room)) {
    if (!MANAGER_AI_FILE_EXTENSIONS.has(managerFileExtension(file.name))) { setManagerAIStatus(`暂不支持：${file.name}`, true); continue; }
    if (file.size > MANAGER_AI_MAX_FILE_BYTES) { setManagerAIStatus(`文件不能超过 20MB：${file.name}`, true); continue; }
    accepted.push(file);
  }
  try {
    const entries = await Promise.all(accepted.map(async (file) => ({ name: file.name, size: file.size, dataUrl: await readManagerFileDataUrl(file) })));
    managerAIFileAttachments.push(...entries);
    renderManagerAIFileList();
    if (files.length > room) setManagerAIStatus("最多添加 5 个文件", true);
    else if (entries.length) setManagerAIStatus("");
  } catch (error) {
    setManagerAIStatus(error.message || "文件读取失败", true);
  } finally {
    if (els.aiFileInput) els.aiFileInput.value = "";
  }
}

function updateManagerAddAllButton() {
  if (!els.aiAddAllButton) return;
  const pending = managerAIProposalEntries.filter((entry) => !entry.added).length;
  els.aiAddAllButton.hidden = managerAIProposalEntries.length < 2 || pending === 0;
  els.aiAddAllButton.disabled = pending === 0;
  els.aiAddAllButton.textContent = `一键添加（${pending}）`;
}

function readManagerAIProposal(entry) {
  const title = clampText(entry.titleInput.value);
  if (!title) { entry.titleInput.focus(); toast("还有事项没写标题"); return null; }
  const rawDate = readTaskDate(entry.dateInput);
  if (rawDate === null) return null;
  const time = readOptionalTime(entry.timeInput);
  if (time === null) return null;
  const date = resolveTaskDate(rawDate, time);
  return { title, detail: clampText(entry.detailInput.value, 4000), date, time, defer: date ? window.DeskWeekDefer?.read?.(entry.deferPicker) || "none" : "none" };
}

function insertManagerAIProposal(entry, proposal) {
  state.items.push(normalizeItem({ id: uid(), title: proposal.title, detail: proposal.detail, date: proposal.date, time: proposal.time, defer: proposal.defer || "none", done: false, color: nextTaskColor(proposal.date), createdAt: new Date().toISOString() }));
  entry.added = true;
  entry.card.classList.add("is-added");
  entry.addButton.disabled = true;
  entry.addButton.textContent = "已添加";
  updateManagerAddAllButton();
}

async function addManagerAIProposal(entry) {
  if (entry.added) return true;
  const proposal = readManagerAIProposal(entry);
  if (!proposal) return false;
  insertManagerAIProposal(entry, proposal);
  await commit("已添加");
  return true;
}

async function addAllManagerAIProposals() {
  const pending = managerAIProposalEntries.filter((entry) => !entry.added);
  if (!pending.length) return;
  const prepared = [];
  for (const entry of pending) {
    const proposal = readManagerAIProposal(entry);
    if (!proposal) return;
    prepared.push({ entry, proposal });
  }
  for (const item of prepared) insertManagerAIProposal(item.entry, item.proposal);
  if (managerAddSource === "inline") {
    els.managerNewTitle.value = "";
    els.managerNewTime.value = "";
    window.DeskWeekDefer?.set?.(els.managerNewDefer, "none");
  }
  managerAddSource = "new";
  closeManagerAddDialog();
  await commit(`已添加 ${prepared.length} 项`);
}

function renderManagerAIProposals(items) {
  managerAIProposalEntries = [];
  if (!els.aiProposals) return;
  els.aiProposals.replaceChildren();
  const multiple = items.length > 1;
  els.aiProposals.hidden = !multiple;
  if (els.singleTaskFields) els.singleTaskFields.hidden = multiple;
  if (els.addSubmit) els.addSubmit.hidden = multiple;
  if (!multiple) { updateManagerAddAllButton(); return; }
  items.forEach((item, index) => {
    const card = document.createElement("article"); card.className = "ai-proposal-card";
    card.innerHTML = `
      <div class="ai-proposal-head"><strong>事项${["一","二","三","四","五","六","七","八","九","十"][index] || index + 1}</strong><button class="ai-proposal-add" type="button">添加</button></div>
      <label class="field"><span>标题</span><input class="ai-proposal-title" type="text" maxlength="100"></label>
      <label class="field"><span>详情</span><textarea class="ai-proposal-detail" rows="2" maxlength="4000"></textarea></label>
      <div class="field-row ai-proposal-schedule-row"><label class="field"><span>日期</span><input class="ai-proposal-date" type="text" inputmode="numeric" maxlength="10" placeholder="日期" data-date-picker></label><label class="field"><span>时间</span><input class="ai-proposal-time" type="text" inputmode="numeric" maxlength="5" placeholder="12:00" data-time-picker></label><div class="field ai-proposal-defer-field"><span>延后显示</span><div class="ai-proposal-defer defer-picker" data-defer-picker data-defer-value="none"><button class="defer-trigger" type="button" aria-label="延后显示：立即显示" aria-expanded="false"><span class="defer-clock-icon" aria-hidden="true"></span><span class="defer-trigger-badge" hidden></span></button></div></div></div>`;
    const entry = { added: false, card, titleInput: card.querySelector(".ai-proposal-title"), detailInput: card.querySelector(".ai-proposal-detail"), dateInput: card.querySelector(".ai-proposal-date"), timeInput: card.querySelector(".ai-proposal-time"), deferPicker: card.querySelector(".ai-proposal-defer"), addButton: card.querySelector(".ai-proposal-add") };
    entry.titleInput.value = item.title || "";
    entry.detailInput.value = item.detail || "";
    entry.dateInput.value = item.date || "";
    entry.timeInput.value = item.time || "";
    window.DeskWeekDate?.attach?.(entry.dateInput);
    window.DeskWeekTime?.attach?.(entry.timeInput);
    window.DeskWeekDefer?.attach?.(entry.deferPicker);
    window.DeskWeekDefer?.set?.(entry.deferPicker, item.defer || "none");
    entry.addButton.addEventListener("click", () => addManagerAIProposal(entry));
    card.addEventListener("keydown", (event) => { if (event.key === "Enter" && event.target.tagName !== "TEXTAREA") { event.preventDefault(); addManagerAIProposal(entry); } });
    managerAIProposalEntries.push(entry);
    els.aiProposals.append(card);
    entry.detailInput.addEventListener("input", () => autoResizeTextarea(entry.detailInput));
    requestAnimationFrame(() => autoResizeTextarea(entry.detailInput));
  });
  updateManagerAddAllButton();
}

function applyManagerAIItems(items) {
  const normalized = Array.isArray(items) ? items.filter((item) => item && (item.title || item.detail)) : [];
  if (!normalized.length) { setManagerAIStatus("AI 没有提取到待办事项", true); return; }
  if (normalized.length === 1) {
    const item = normalized[0];
    els.addTitle.value = item.title || "";
    els.addDetail.value = item.detail || "";
    requestAnimationFrame(() => autoResizeTextarea(els.addDetail));
    els.addDate.value = item.date || "";
    els.addTime.value = item.time || "";
    window.DeskWeekDefer?.set?.(els.addDefer, item.defer || "none");
    renderManagerAIProposals([]);
    setManagerAIStatus("已填入");
    return;
  }
  renderManagerAIProposals(normalized);
  setManagerAIStatus(`已提取 ${normalized.length} 项事项`);
}

function readManagerImageDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("无法读取图片：" + file.name));
    reader.readAsDataURL(file);
  });
}

async function addManagerAIImages(fileList) {
  const files = Array.from(fileList || []).filter((file) => file.type.startsWith("image/"));
  if (!files.length) return;
  const room = Math.max(0, 4 - managerAIImageAttachments.length);
  if (!room) { setManagerAIStatus("最多添加 4 张图片", true); return; }
  const accepted = [];
  for (const file of files.slice(0, room)) {
    if (file.size > 6 * 1024 * 1024) { setManagerAIStatus("单张图片不能超过 6MB", true); continue; }
    accepted.push(file);
  }
  try {
    const images = await Promise.all(accepted.map(async (file) => ({ name: file.name, dataUrl: await readManagerImageDataUrl(file) })));
    managerAIImageAttachments.push(...images);
    renderManagerAIImageList();
    if (files.length > room) setManagerAIStatus("最多添加 4 张图片", true);
    else if (images.length) setManagerAIStatus("");
  } catch (error) {
    setManagerAIStatus(error.message || "图片读取失败", true);
  } finally {
    if (els.aiImageInput) els.aiImageInput.value = "";
  }
}

async function refreshManagerAIConfigHint() {
  try {
    const config = await window.deskWeek?.getAIConfig?.();
    managerAIConfigAvailable = Boolean(config?.hasKey);
    managerAIKeyInvalid = Boolean(config?.keyInvalid);
  } catch {
    managerAIConfigAvailable = false;
    managerAIKeyInvalid = false;
  }
  if (els.aiConfigHint) {
    els.aiConfigHint.hidden = managerAIConfigAvailable;
    els.aiConfigHint.textContent = managerAIConfigAvailable ? "" : managerAIKeyInvalid ? "密钥失效，请重新填写" : "未配置接口";
  }
}

function readableManagerAIError(error) {
  return String(error?.message || error || "AI 总结失败")
    .replace(/^Error invoking remote method '[^']+':\s*/i, "")
    .replace(/^Error:\s*/i, "");
}

async function summarizeManagerAISource() {
  if (managerAISummaryBusy) return;
  const source = String(els.aiSourceText?.value || "").trim();
  const extraPrompt = String(els.aiExtraPrompt?.value || "").trim();
  if (!source && !managerAIImageAttachments.length && !managerAIFileAttachments.length) { setManagerAIStatus("先粘贴文字、添加图片或文件", true); return; }
  if (managerAIKeyInvalid) { setManagerAIStatus("AI 密钥已失效，请在设置里重新填写 API Key", true); return; }
  if (!managerAIConfigAvailable || !window.deskWeek?.summarizeTask) { setManagerAIStatus("先在设置里配置 AI 接口", true); return; }
  managerAISummaryBusy = true; els.aiSummarizeButton.disabled = true; els.aiSummarizeButton.textContent = "整理中…"; setManagerAIStatus("正在读取资料并整理…");
  try {
    const result = await window.deskWeek.summarizeTask({
      text: source,
      extraPrompt,
      images: managerAIImageAttachments.map((image) => image.dataUrl),
      files: managerAIFileAttachments.map((file) => ({ name: file.name, dataUrl: file.dataUrl })),
    });
    applyManagerAIItems(result?.items || (result?.title ? [result] : []));
  } catch (error) {
    setManagerAIStatus(readableManagerAIError(error), true);
  } finally {
    managerAISummaryBusy = false; els.aiSummarizeButton.disabled = false; els.aiSummarizeButton.textContent = "总结并填入";
  }
}

function openManagerAddDialog(date = "", draft = {}, source = "new") {
  const key = isValidDateKey(date) ? date : "";
  managerAddSource = source;
  els.addTitle.value = clampText(draft.title || "");
  els.addDetail.value = clampText(draft.detail || "", 4000);
  els.addDate.value = key;
  els.addTime.value = String(draft.time || "");
  els.addTime.setCustomValidity?.("");
  window.DeskWeekDefer?.set?.(els.addDefer, normalizeDefer(draft.defer));
  clearManagerAIDraft();
  refreshManagerAIConfigHint();
  els.addDialog.showModal();
  requestAnimationFrame(() => autoResizeTextarea(els.addDetail));
  setTimeout(() => els.addTitle.focus({ preventScroll: true }), 30);
}

function closeManagerAddDialog() {
  if (els.addDialog.open) els.addDialog.close();
}

async function loadAutostart() {
if (!els.autostartToggle) return;
  try { const enabled = await window.deskWeek?.getAutostart?.(); els.autostartToggle.checked = Boolean(enabled); }
  catch { /* ignore */ }
}

  // ---- 局域网同步 ----
function renderSyncStatus(status) {
  if (!els.syncStatusText) return;
  if (!status || !status.running) {
    els.syncStatusText.textContent = status?.lastError ? `未运行：${status.lastError}` : "未开启";
    if (els.syncToggle) els.syncToggle.checked = false;
    if (els.syncPendingList) els.syncPendingList.innerHTML = "";
    if (els.syncPeerList) els.syncPeerList.innerHTML = "";
    return;
  }
  if (els.syncToggle) els.syncToggle.checked = true;
  const vectors = Object.entries(status.vectors || {}).map(([k, v]) => `${k.slice(0, 8)}…=${v}`).join("，") || "无";
  els.syncStatusText.textContent = `运行中 · 端口 ${status.port} · 操作 ${status.operations} 条 · 已配对 ${status.peers} 台 · 向量 ${vectors}`;

  if (els.syncPendingList) {
    els.syncPendingList.innerHTML = "";
    for (const entry of status.pending || []) {
      const row = document.createElement("div");
      row.className = "sync-row";
      const text = document.createElement("span");
      text.textContent = `待配对设备 ${entry.actorId.slice(0, 8)}… 验证码 ${entry.sas}`;
      const ok = document.createElement("button");
      ok.className = "soft-button"; ok.type = "button"; ok.textContent = "确认";
      ok.addEventListener("click", async () => { renderSyncStatus(await window.deskWeek?.syncApprove?.(entry.actorId)); });
      const no = document.createElement("button");
      no.className = "soft-button"; no.type = "button"; no.textContent = "拒绝";
      no.addEventListener("click", async () => { renderSyncStatus(await window.deskWeek?.syncReject?.(entry.actorId)); });
      row.append(text, ok, no);
      els.syncPendingList.append(row);
    }
  }

  if (els.syncPeerList) {
    els.syncPeerList.innerHTML = "";
    for (const peer of status.paired || []) {
      const row = document.createElement("div");
      row.className = "sync-row";
      const text = document.createElement("span");
      text.textContent = `已配对 ${peer.actorId.slice(0, 8)}…（验证码 ${peer.sas}）`;
      const remove = document.createElement("button");
      remove.className = "soft-button"; remove.type = "button"; remove.textContent = "移除";
      remove.addEventListener("click", async () => { renderSyncStatus(await window.deskWeek?.syncForget?.(peer.actorId)); });
      row.append(text, remove);
      els.syncPeerList.append(row);
    }
  }
}

async function refreshSyncStatus() {
  try { renderSyncStatus(await window.deskWeek?.syncStatus?.()); } catch { /* ignore */ }
}

els.syncToggle?.addEventListener("change", async event => {
  const enabled = event.target.checked;
  els.syncStatusText.textContent = enabled ? "启动中…" : "正在停止…";
  try { renderSyncStatus(await window.deskWeek?.syncToggle?.(enabled)); }
  catch (error) { els.syncStatusText.textContent = `失败：${error.message}`; }
});
els.syncRefresh?.addEventListener("click", refreshSyncStatus);
setInterval(refreshSyncStatus, 5000);
refreshSyncStatus();

function readableUpdateError(error) {
  return String(error?.message || error || "更新失败")
    .replace(/^Error invoking remote method '[^']+':\s*/i, "")
    .replace(/^Error:\s*/i, "");
}

function compactUpdateNotes(notes) {
  return String(notes || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => !/^-{3,}$/.test(line))
    .map((line) => line
      .replace(/^#{1,6}\s*/, "")
      .replace(/^>\s*/, "")
      .replace(/^[-*•]\s*/, "")
      .replace(/^\d+[.)、]\s*/, "")
      .replace(/\*\*/g, "")
      .replace(/`/g, "")
      .trim())
    .filter(Boolean)
    .filter((line) => !/^DeskWeek\s+v?\d/i.test(line));
}
function setUpdateNotes(notes) {
  if (!els.updateNotes) return;
  const entries = compactUpdateNotes(notes);
  els.updateNotes.replaceChildren();
  els.updateNotes.hidden = entries.length === 0;
  if (!entries.length) return;
  const title = document.createElement("strong");
  title.textContent = "更新内容";
  const list = document.createElement("ul");
  entries.forEach((entry) => { const item = document.createElement("li"); item.textContent = entry; list.append(item); });
  els.updateNotes.append(title, list);
}

function applyStartupUpdateState(updateState) {
  if (!updateState || updateBusy) return;
  if (updateState.phase === "checking") {
    els.checkUpdateButton.hidden = false;
    els.checkUpdateButton.disabled = true;
    els.checkUpdateButton.textContent = "检查中…";
    setUpdateStatus("检查中…", "checking");
    setUpdateNotes("");
    return;
  }
  els.checkUpdateButton.disabled = false;
  els.checkUpdateButton.textContent = "检查更新";
  if (updateState.phase === "error") {
    els.checkUpdateButton.hidden = false;
    setUpdateStatus("未检查", "idle", false, updateState.error || "");
    setUpdateNotes("");
    return;
  }
  const info = updateState.info;
  if (!info) return;
  latestUpdateInfo = info;
  if (!info.hasUpdate) {
    els.checkUpdateButton.hidden = false;
    setUpdateStatus("已是最新", "latest");
    setUpdateNotes("");
    return;
  }
  els.checkUpdateButton.hidden = true;
  setUpdateStatus(`可更新 v${info.latestVersion}`, "update", true);
  setUpdateNotes(info.notes);
}

async function syncStartupUpdateState() {
  try { applyStartupUpdateState(await window.deskWeek?.getUpdateState?.()); } catch { /* keep manual check available */ }
}

function setUpdateStatus(message, state = "idle", install = false, detail = "") {
  els.updateStatus.dataset.state = state;
  els.updateStatusText.textContent = state === "error" && detail ? `${message}：${detail}` : message;
  els.updateStatusText.title = detail;
  els.installUpdateButton.hidden = !install;
  els.installUpdateButton.disabled = state === "busy";
  els.installUpdateButton.textContent = state === "error" ? "重试" : "下载更新";
}

async function checkForManagerUpdate() {
  if (updateBusy) return;
  updateBusy = true;
  latestUpdateInfo = null;
  els.checkUpdateButton.disabled = true;
  els.checkUpdateButton.textContent = "检查中…";
  setUpdateStatus("检查中…", "checking");
  setUpdateNotes("");
  try {
    const info = await window.deskWeek?.checkForUpdates?.();
    if (!info) throw new Error("检查更新接口不可用");
    latestUpdateInfo = info;
    if (!info.hasUpdate) {
      els.checkUpdateButton.hidden = false;
      setUpdateStatus("已是最新", "latest");
      setUpdateNotes("");
      return;
    }
    els.checkUpdateButton.hidden = true;
    setUpdateStatus(`可更新 v${info.latestVersion}`, "update", true);
    setUpdateNotes(info.notes);
  } catch (error) {
    els.checkUpdateButton.hidden = false;
    setUpdateStatus("检查失败", "error", false, readableUpdateError(error));
    setUpdateNotes("");
  } finally {
    updateBusy = false;
    els.checkUpdateButton.disabled = false;
    els.checkUpdateButton.textContent = "检查更新";
  }
}

async function installManagerUpdate() {
  if (updateBusy || !latestUpdateInfo?.hasUpdate) return;
  const confirmed = await requestConfirm({
    title: `更新到 v${latestUpdateInfo.latestVersion}？`,
    message: "程序会自动下载、关闭旧版本、保留 data 中的任务和设置，然后重新启动。",
    okText: "下载并更新",
  });
  if (!confirmed) return;
  updateBusy = true;
  els.installUpdateButton.disabled = true;
  setUpdateStatus("准备下载…", "busy", true);
  try {
    const result = await window.deskWeek?.downloadUpdate?.();
    if (result?.updated === false) {
      els.checkUpdateButton.hidden = false;
      setUpdateStatus("已是最新", "latest");
      return;
    }
    setUpdateStatus("正在重启…", "busy", false);
  } catch (error) {
    setUpdateStatus("更新失败", "error", true, readableUpdateError(error));
  } finally {
    updateBusy = false;
    els.installUpdateButton.disabled = false;
  }
}

function openDataFolder() { window.deskWeek?.openDataFolder?.(); }
function exportData() {
  const payload = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), items: state.items, prefs: state.prefs }, null, 2);
  const blob = new Blob([payload], { type: "application/json" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `deskweek-${todayKey()}.json`; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast("已导出");
}
async function importData(file) {
  try {
    await window.DeskWeekQrUI.previewImport(await file.text());
  } catch (error) { toast(`导入失败：${error.message}`); }
}
function changeCalendarPeriod(direction) {
  if (state.calMode === "year") state.calDate = addYears(state.calDate, direction);
  else if (state.calMode === "week") state.calDate = addDays(state.calDate, direction * 7);
  else if (state.calMode === "day") state.calDate = addDays(state.calDate, direction);
  else state.calDate = addMonths(state.calDate, direction);
  state.calFocusDate = new Date(state.calDate);
  renderCalendar();
}
function openNewTaskForDate(key) {
  state.calFocusDate = fromKey(key);
  openManagerAddDialog(key, {}, "calendar");
}
function sameCalendarMonth(a, b) {
  return Boolean(a && b && a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth());
}
function sameCalendarWeek(a, b) {
  return Boolean(a && b && dateKey(startOfWeek(a)) === dateKey(startOfWeek(b)));
}
function transitionCalendarTarget(previousMode) {
  const fallback = state.calFocusDate instanceof Date ? state.calFocusDate : state.calDate;
  if (!isValidDateKey(hoveredCalendarKey)) return fallback;
  const hovered = fromKey(hoveredCalendarKey);
  if (previousMode === "year" && hovered.getFullYear() === state.calDate.getFullYear()) return hovered;
  if (previousMode === "month" && sameCalendarMonth(hovered, state.calDate)) return hovered;
  if (previousMode === "week" && sameCalendarWeek(hovered, state.calDate)) return hovered;
  return fallback;
}
function setCalendarMode(mode) {
  const previousMode = state.calMode;
  const focus = transitionCalendarTarget(previousMode);
  state.calMode = mode;
  state.calFocusDate = new Date(focus);
  if (mode === "year") state.calDate = new Date(focus.getFullYear(), 0, 1);
  else if (mode === "week") state.calDate = startOfWeek(focus);
  else if (mode === "day") state.calDate = new Date(focus.getFullYear(), focus.getMonth(), focus.getDate());
  else state.calDate = new Date(focus.getFullYear(), focus.getMonth(), 1);
  hoveredCalendarKey = "";
  renderCalendar();
}
function handleCalendarWheel(event) {
  event.preventDefault(); if (wheelLocked) return; wheelLocked = true; setTimeout(() => { wheelLocked = false; }, 150);
  if (event.ctrlKey) {
    const levels = ["year", "month", "week", "day"];
    const current = Math.max(0, levels.indexOf(state.calMode));
    const next = Math.max(0, Math.min(levels.length - 1, current + (event.deltaY < 0 ? 1 : -1)));
    if (next !== current) setCalendarMode(levels[next]);
    return;
  }
  changeCalendarPeriod(event.deltaY > 0 ? 1 : -1);
}
els.minimizeWindow.addEventListener("click", () => window.deskWeek?.managerMinimize?.());
function updateManagerWindowState(maximized) {
  const active = Boolean(maximized);
  els.maximizeWindow.classList.toggle("is-maximized", active);
  els.maximizeWindow.setAttribute("aria-pressed", String(active));
  els.maximizeWindow.setAttribute("aria-label", active ? "还原窗口" : "最大化");
  els.maximizeWindow.title = active ? "还原窗口" : "最大化";
}
els.maximizeWindow.addEventListener("click", async () => {
  const maximized = await window.deskWeek?.managerToggleMaximize?.();
  if (typeof maximized === "boolean") updateManagerWindowState(maximized);
});
window.deskWeek?.onManagerWindowState?.(({ maximized } = {}) => updateManagerWindowState(maximized));
els.closeWindow.addEventListener("click", () => window.deskWeek?.managerClose?.());
document.querySelectorAll("[data-section]").forEach((node) => node.addEventListener("click", () => switchSection(node.dataset.section)));
document.querySelectorAll("[data-filter]").forEach((node) => node.addEventListener("click", () => switchFilter(node.dataset.filter)));
els.deferredShelfToggle.addEventListener("click", () => { deferredShelfOpen = !deferredShelfOpen; renderDeferredShelf(); });
els.quickFocusButton.addEventListener("click", () => openManagerAddDialog("", {}, "new"));
els.managerNewDetailButton.addEventListener("click", () => {
  const dateValue = isValidDateKey(els.managerNewDate.value) ? els.managerNewDate.value : "";
  const timeValue = String(els.managerNewTime.value || "").trim();
  const deferValue = window.DeskWeekDefer?.read?.(els.managerNewDefer) || "none";
  openManagerAddDialog(dateValue, { title: els.managerNewTitle.value, time: timeValue, defer: deferValue }, "inline");
});
els.settingsOpenDataFolder.addEventListener("click", openDataFolder);
els.detailedForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (els.singleTaskFields?.hidden) { addAllManagerAIProposals(); return; }
  const title = clampText(els.addTitle.value);
  const rawDate = readTaskDate(els.addDate);
  if (rawDate === null) return;
  if (!title) { toast("还差事项"); els.addTitle.focus(); return; }
  const time = readOptionalTime(els.addTime);
  if (time === null) return;
  const date = resolveTaskDate(rawDate, time);
  const defer = date ? window.DeskWeekDefer?.read?.(els.addDefer) || "none" : "none";
  const fromInline = managerAddSource === "inline";
  state.items.push(normalizeItem({ id: uid(), title, detail: clampText(els.addDetail.value, 4000), date, time, defer, done: false, color: nextTaskColor(date), createdAt: new Date().toISOString() }));
  closeManagerAddDialog();
  if (fromInline) {
    els.managerNewTitle.value = "";
    els.managerNewDate.value = date;
    els.managerNewTime.value = "";
    window.DeskWeekDefer?.set?.(els.managerNewDefer, "none");
  }
  managerAddSource = "new";
  commit("已添加");
});
els.managerAddForm.addEventListener("submit", (event) => {
  event.preventDefault(); const title = clampText(els.managerNewTitle.value); const rawDate = readTaskDate(els.managerNewDate);
  if (rawDate === null) return; if (!title) { toast("还差事项"); return; }
  const time = readOptionalTime(els.managerNewTime);
  if (time === null) return;
  const date = resolveTaskDate(rawDate, time);
  const defer = date ? window.DeskWeekDefer?.read?.(els.managerNewDefer) || "none" : "none";
  state.items.push(normalizeItem({ id: uid(), title, detail: "", date, time, defer, done: false, color: nextTaskColor(date), createdAt: new Date().toISOString() }));
  els.managerNewTitle.value = ""; els.managerNewDate.value = date; els.managerNewTime.value = ""; window.DeskWeekDefer?.set?.(els.managerNewDefer, "none"); commit("已添加"); els.managerNewTitle.focus();
});
els.editForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!editingSnapshot) return;
  const before = structuredClone(editingSnapshot), item = structuredClone(before);
  item.title = clampText(els.editTitle.value) || item.title;
  item.detail = clampText(els.editDetail.value, 4000);
  const rawDate = readTaskDate(els.editDate); if (rawDate === null) return;
  const time = readOptionalTime(els.editTime); if (time === null) return;
  item.time = time; item.date = resolveTaskDate(rawDate, time);
  item.defer = item.date ? window.DeskWeekDefer?.read?.(els.editDefer) || "none" : "none";
  setItemDoneState(item, els.editDone.checked);
  try {
    await window.deskWeek.editTask(before, item);
    closeEditor(); renderAll(); toast("已保存");
  } catch (error) { toast(String(error.message || "保存失败").replace(/^Error invoking remote method[^:]+:\s*/, "")); }
});

els.deleteTask.addEventListener("click", async () => {
  const item = state.items.find((entry) => entry.id === editingId); if (!item) return closeEditor();
  if (item.deleted) {
    if (!(await requestConfirm({ title: "永久删除？", message: `“${item.title}”`, okText: "永久删除" }))) return;
    state.items = state.items.filter((entry) => entry.id !== item.id); closeEditor(); commit("已永久删除"); return;
  }
  if (!(await requestConfirm({ title: "移到垃圾箱？", message: `“${item.title}”`, okText: "移到垃圾箱" }))) return;
  item.deleted = true; item.deletedAt = new Date().toISOString(); closeEditor(); commit("已移到垃圾箱");
});
els.closeDialog.addEventListener("click", closeEditor); els.cancelEdit.addEventListener("click", closeEditor);
els.dialog.addEventListener("click", (event) => { if (event.target === els.dialog) closeEditor(); });
els.closeAddDialog.addEventListener("click", closeManagerAddDialog); els.cancelAdd.addEventListener("click", closeManagerAddDialog);
els.addDialog.addEventListener("click", (event) => { if (event.target === els.addDialog) closeManagerAddDialog(); });
els.aiSummarizeButton.addEventListener("click", summarizeManagerAISource);
els.aiImageInput.addEventListener("change", () => addManagerAIImages(els.aiImageInput.files));
els.aiFileInput.addEventListener("change", () => addManagerAIFiles(els.aiFileInput.files));
els.aiAddAllButton.addEventListener("click", addAllManagerAIProposals);
els.addDetail.addEventListener("input", () => autoResizeTextarea(els.addDetail));
els.aiSourceText.addEventListener("paste", (event) => {
  const images = [...(event.clipboardData?.items || [])].filter((item) => item.kind === "file" && item.type.startsWith("image/")).map((item) => item.getAsFile()).filter(Boolean);
  if (!images.length) return;
  event.preventDefault();
  addManagerAIImages(images);
});
els.confirmCancel.addEventListener("click", () => finishConfirm(false));
els.confirmAccept.addEventListener("click", () => finishConfirm(true));
els.confirmDialog.addEventListener("click", (event) => { if (event.target === els.confirmDialog) finishConfirm(false); });
els.confirmDialog.addEventListener("close", () => { const resolve = confirmResolver; confirmResolver = null; resolve?.(false); });
els.calPrev.addEventListener("click", () => changeCalendarPeriod(-1));
els.calNext.addEventListener("click", () => changeCalendarPeriod(1));
els.calToday.addEventListener("click", () => { state.calFocusDate = new Date(); state.calDate = new Date(); if (state.calMode === "week") state.calDate = startOfWeek(state.calDate); renderCalendar(); });
document.querySelectorAll("[data-cal-mode]").forEach((node) => node.addEventListener("click", () => setCalendarMode(node.dataset.calMode)));
els.calendarBody.addEventListener("wheel", handleCalendarWheel, { passive: false });
window.addEventListener("resize", scheduleMonthFit, { passive: true });
if ("ResizeObserver" in window) new ResizeObserver(scheduleMonthFit).observe(els.calendarBody);
els.managerExport.addEventListener("click", exportData);
els.managerImport.addEventListener("click", () => els.managerImportFile.click());
els.managerImportFile.addEventListener("change", () => { const file = els.managerImportFile.files?.[0]; els.managerImportFile.value = ""; if (file) importData(file); });
document.querySelectorAll("[data-theme-choice]").forEach((button) => button.addEventListener("click", () => setThemePreference(button.dataset.themeChoice)));
document.querySelectorAll("[data-widget-background-choice]").forEach(button => button.addEventListener("click", () => setWidgetBackground(button.dataset.widgetBackgroundChoice)));
els.saveAIConfig?.addEventListener("click", () => persistAIConfig(false));
els.clearAIKey?.addEventListener("click", () => persistAIConfig(true));
document.querySelectorAll("[data-external-url]").forEach((link) => link.addEventListener("click", (event) => { event.preventDefault(); window.deskWeek?.openExternal?.(link.dataset.externalUrl); }));
els.checkUpdateButton.addEventListener("click", checkForManagerUpdate);
els.installUpdateButton.addEventListener("click", installManagerUpdate);
window.deskWeek?.onUpdateState?.((updateState) => applyStartupUpdateState(updateState));
window.deskWeek?.onUpdateProgress?.((progress) => {
  if (!progress || !latestUpdateInfo) return;
  const percent = Number(progress.percent) || 0;
  if (progress.phase === "ready") setUpdateStatus("正在重启…", "busy", false);
  else setUpdateStatus(`下载中 ${percent}%`, "busy", true);
});

els.aiAutoTranslateToggle?.addEventListener("change", async () => {
  const enabled = Boolean(els.aiAutoTranslateToggle.checked);
  try {
    const config = await window.deskWeek?.saveAIConfig?.({ baseUrl: els.aiBaseUrl.value, model: els.aiModel.value, apiKey: "", clearKey: false, autoTranslate: enabled });
    if (!config) throw new Error("AI 配置接口不可用");
    els.aiAutoTranslateToggle.checked = Boolean(config.autoTranslate);
    toast(enabled ? "自动翻译已开启" : "自动翻译已关闭");
  } catch (error) {
    els.aiAutoTranslateToggle.checked = !enabled;
    const message = String(error?.message || "自动翻译设置保存失败").replace(/^Error invoking remote method '[^']+:\s*/i, "").replace(/^Error:\s*/i, "");
    toast(message);
  }
});
els.autostartToggle.addEventListener("change", async () => { try { const enabled = await window.deskWeek?.setAutostart?.(els.autostartToggle.checked); els.autostartToggle.checked = Boolean(enabled); toast(enabled ? "已开启开机启动" : "已关闭开机启动"); } catch { toast("开机启动设置失败"); } });
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && els.confirmDialog.open) return;
  if (event.key === "Escape" && els.addDialog.open) { closeManagerAddDialog(); return; }
  if (event.key === "Escape" && els.dialog.open) { closeEditor(); return; }
  if (event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "n" && !els.dialog.open && !els.addDialog.open) {
    event.preventDefault();
    switchFilter("todo");
    openManagerAddDialog();
  }
});
async function init() {
  applyTheme(currentTheme());
  els.managerNewDate.value = todayKey();
  state.calFocusDate = new Date();
  state.calDate = new Date();
  renderAll();
  loadAutostart();
  try {
    const data = await window.deskWeek?.loadStore?.();
    if (data?.loadError) { toast("数据没读出来，原文件还在"); }
    if (data?.initialized && Array.isArray(data.items)) {
      state.items = normalizeItems(data.items);
      state.prefs = data.prefs && typeof data.prefs === "object" ? data.prefs : {};
      window.DeskWeekBackground.apply(state.prefs.widgetBackground);
      applyTheme(state.prefs.theme || document.documentElement.dataset.theme || "light");
    } else {
      try {
        const local = JSON.parse(localStorage.getItem("deskweek.items.v1") || "{}");
        if (Array.isArray(local.items)) state.items = local.items.filter(validItem).map(normalizeItem);
      } catch { /* no local fallback */ }
    }
    renderAll();
  } catch { /* leave the page usable even if the store cannot be read */ }
  window.deskWeek?.onStoreChanged?.((data) => {
    if (!data || !data.initialized || !Array.isArray(data.items)) return;
    state.items = normalizeItems(data.items);
    state.prefs = data.prefs && typeof data.prefs === "object" ? data.prefs : state.prefs;
    window.DeskWeekBackground.apply(state.prefs.widgetBackground);
    applyTheme(state.prefs.theme || document.documentElement.dataset.theme || "light");
    renderAll();
  });
  syncStartupUpdateState();
}
window.addEventListener("focus", () => requestAnimationFrame(renderAll));
document.addEventListener("visibilitychange", () => { if (!document.hidden) requestAnimationFrame(renderAll); });window.DeskWeekRuntime.start({ refresh: () => { renderSidebarCounts(); renderTasks(); renderCalendar(); } });
init();
