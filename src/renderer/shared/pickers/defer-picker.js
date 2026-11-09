(() => {
  'use strict';
  if (window.DeskWeekDefer) return;
  const pickers = [...document.querySelectorAll('[data-defer-picker]')];
  if (!pickers.length) return;
  function normalize(value) {
    const text = String(value || 'none').toLowerCase();
    return text === '1m' || /^[1-9]\d*d$/.test(text) ? text : 'none';
  }
  function label(value) {
    const normalized = normalize(value);
    if (normalized === 'none') return '立即显示';
    if (normalized === '1m') return '提前1个月';
    return '提前' + normalized.slice(0, -1) + '天';
  }
  function syncTrigger(picker) {
    const trigger = picker.querySelector('.defer-trigger');
    const badge = picker.querySelector('.defer-trigger-badge');
    const value = normalize(picker.dataset.deferValue);
    picker.classList.toggle('has-value', value !== 'none');
    trigger.setAttribute('title', '延后显示：' + label(value));
    trigger.setAttribute('aria-label', '延后显示：' + label(value));
    if (value === 'none') {
      badge.hidden = true;
      badge.textContent = '';
    } else {
      badge.hidden = false;
      badge.textContent = value === '1m' ? '月' : value.slice(0, -1);
    }
  }
  function set(picker, value) {
    picker.dataset.deferValue = normalize(value);
    syncTrigger(picker);
  }
  function read(picker) { return normalize(picker.dataset.deferValue); }

  const popover = document.createElement('div');
  popover.id = 'dwDeferPopover';
  popover.className = 'dw-defer-popover';
  popover.setAttribute('popover', 'manual');
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-label', '设置延后显示');
  popover.hidden = true;
  popover.innerHTML = [
    '<div class="dw-defer-head"><div class="dw-defer-heading"><span class="dw-defer-head-icon" aria-hidden="true"></span><div><strong>延后显示</strong></div></div></div>',
    '<label class="dw-defer-days-wrap"><span>提前</span><input class="dw-defer-days" type="number" min="0" max="365" step="1" placeholder="0" aria-label="提前天数"><span>天显示</span></label>',
    '<div class="dw-defer-quick"><button type="button" data-defer-week>一周</button><button type="button" data-defer-month>一个月</button></div>',
    '<div class="dw-defer-note"></div>',
    '<div class="dw-defer-foot"><button class="dw-defer-clear" type="button">立即显示</button><span class="dw-defer-spacer"></span><button class="dw-defer-cancel" type="button">取消</button><button class="dw-defer-done" type="button">确认</button></div>',
  ].join('');
  document.body.append(popover);
  const daysInput = popover.querySelector('.dw-defer-days');
  const weekButton = popover.querySelector('[data-defer-week]');
  const monthButton = popover.querySelector('[data-defer-month]');
  let activePicker = null;
  let activeTrigger = null;
  let pickerOpen = false;
  let draftMode = 'days';

  function syncDraftButtons() {
    const days = Number(daysInput.value) || 0;
    weekButton.classList.toggle('active', draftMode === 'days' && days === 7);
    monthButton.classList.toggle('active', draftMode === 'month');
    popover.querySelector('.dw-defer-clear').classList.toggle('active', draftMode === 'days' && days === 0);
  }
  function setDraft(value) {
    const normalized = normalize(value);
    draftMode = normalized === '1m' ? 'month' : 'days';
    daysInput.value = normalized.endsWith('d') ? normalized.slice(0, -1) : '';
    syncDraftButtons();
  }
  function draftValue() {
    if (draftMode === 'month') return '1m';
    const days = Math.max(0, Math.min(365, Math.floor(Number(daysInput.value) || 0)));
    return days > 0 ? days + 'd' : 'none';
  }
  function position() {
    if (!pickerOpen || !activeTrigger) return;
    const rect = activeTrigger.getBoundingClientRect();
    const width = popover.offsetWidth;
    const height = popover.offsetHeight;
    let left = rect.right - width;
    left = Math.max(8, Math.min(left, innerWidth - width - 8));
    let top = rect.bottom + 8;
    if (top + height > innerHeight - 8) top = rect.top - height - 8;
    top = Math.max(8, Math.min(top, innerHeight - height - 8));
    popover.style.left = Math.round(left) + 'px';
    popover.style.top = Math.round(top) + 'px';
  }
  function close() {
    if (!pickerOpen) return;
    pickerOpen = false;
    popover.classList.remove('is-open');
    if (typeof popover.hidePopover === 'function' && popover.matches(':popover-open')) { try { popover.hidePopover(); } catch { /* noop */ } }
    popover.hidden = true;
    if (activeTrigger) activeTrigger.setAttribute('aria-expanded', 'false');
    activePicker = null;
    activeTrigger = null;
  }
  function commitAndClose(value) {
    if (activePicker) set(activePicker, value == null ? draftValue() : value);
    close();
  }
  function open(picker) {
    const host = picker.closest('dialog[open]') || document.body;
    if (popover.parentElement !== host) host.append(popover);
    activePicker = picker;
    activeTrigger = picker.querySelector('.defer-trigger');
    draftMode = 'days';
    setDraft(read(picker));
    popover.dataset.theme = document.body.classList.contains('theme-dark') ? 'dark' : 'light';
    popover.hidden = false;
    pickerOpen = true;
    if (typeof popover.showPopover === 'function') { try { popover.showPopover(); } catch { /* fallback */ } }
    popover.classList.remove('is-open');
    position();
    requestAnimationFrame(() => { if (!pickerOpen) return; position(); popover.classList.add('is-open'); });
    activeTrigger.setAttribute('aria-expanded', 'true');
  }
  daysInput.addEventListener('focus', () => { draftMode = 'days'; syncDraftButtons(); });
  daysInput.addEventListener('input', () => { draftMode = 'days'; if (Number(daysInput.value) > 365) daysInput.value = '365'; if (Number(daysInput.value) < 0) daysInput.value = '0'; syncDraftButtons(); });
  daysInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); commitAndClose(); } });
  weekButton.addEventListener('click', () => { draftMode = 'days'; daysInput.value = '7'; syncDraftButtons(); daysInput.focus(); });
  monthButton.addEventListener('click', () => { draftMode = 'month'; daysInput.value = ''; syncDraftButtons(); });
  popover.querySelector('.dw-defer-clear').addEventListener('click', () => { draftMode = 'days'; daysInput.value = ''; syncDraftButtons(); daysInput.focus(); });
  popover.querySelector('.dw-defer-cancel').addEventListener('click', close);
  popover.querySelector('.dw-defer-done').addEventListener('click', () => commitAndClose());
  document.addEventListener('pointerdown', (event) => {
    if (!pickerOpen) return;
    if (event.target.closest('#dwDeferPopover') || event.target.closest('.defer-picker')) return;
    close();
  });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && pickerOpen) { event.stopPropagation(); close(); } }, true);
  addEventListener('resize', position);
  function attachPicker(picker) {
    if (!picker || picker.dataset.deferAttached === 'true') return picker;
    if (!picker.dataset.deferValue) picker.dataset.deferValue = 'none';
    const trigger = picker.querySelector('.defer-trigger');
    trigger.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (activePicker === picker && pickerOpen) close(); else open(picker);
    });
    picker.dataset.deferAttached = 'true';
    syncTrigger(picker);
    return picker;
  }

  pickers.forEach(attachPicker);
  window.DeskWeekDefer = { attach: attachPicker, read, set, normalize };
})();
