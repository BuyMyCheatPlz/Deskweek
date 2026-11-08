(() => {
  'use strict';
  if (window.DeskWeekDate) return;

  const pad = (value) => String(value).padStart(2, '0');
  const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];
  const inputs = [...document.querySelectorAll('input[data-date-picker]')];
  if (!inputs.length) return;

  function dateKey(date) {
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
  }

  function fromKey(key) {
    const parts = String(key).split('-').map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  function addDays(date, days) {
    const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    next.setDate(next.getDate() + days);
    return next;
  }

  function safeDate(year, month, day) {
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    return date;
  }

  function normalizeDate(raw) {
    const text = String(raw == null ? '' : raw).trim()
      .replace(/年/g, '-')
      .replace(/月/g, '-')
      .replace(/日/g, '')
      .replace(/\//g, '-')
      .replace(/\./g, '-')
      .replace(/\s+/g, '');
    if (!text) return null;
    let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (match) {
      const date = safeDate(Number(match[1]), Number(match[2]), Number(match[3]));
      return date ? dateKey(date) : null;
    }
    if (/^\d{8}$/.test(text)) {
      const date = safeDate(Number(text.slice(0, 4)), Number(text.slice(4, 6)), Number(text.slice(6, 8)));
      return date ? dateKey(date) : null;
    }
    match = text.match(/^(\d{1,2})-(\d{1,2})$/);
    if (match) {
      const date = safeDate(new Date().getFullYear(), Number(match[1]), Number(match[2]));
      return date ? dateKey(date) : null;
    }
    return null;
  }

  function commitInput(input) {
    const value = normalizeDate(input.value);
    const control = input.closest('.dw-date-control');
    if (!String(input.value || '').trim()) {
      input.setCustomValidity('');
      control?.removeAttribute('data-invalid');
      return true;
    }
    if (!value) {
      input.setCustomValidity('日期格式：2026-11-04');
      control?.setAttribute('data-invalid', 'true');
      return false;
    }
    input.value = value;
    input.setCustomValidity('');
    control?.removeAttribute('data-invalid');
    return true;
  }

  const popover = document.createElement('div');
  popover.id = 'dwDatePopover';
  popover.className = 'dw-date-popover';
  popover.dataset.theme = document.body.classList.contains('theme-dark') ? 'dark' : 'light';
  popover.setAttribute('popover', 'manual');
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-label', '选择日期');
  popover.hidden = true;
  popover.innerHTML = [
    '<div class="dw-date-head">',
    '  <button class="dw-date-nav" type="button" data-date-nav="-1" aria-label="上个月">‹</button>',
    '  <strong class="dw-date-title"></strong>',
    '  <button class="dw-date-nav" type="button" data-date-nav="1" aria-label="下个月">›</button>',
    '</div>',
    '<div class="dw-date-quick" aria-label="快捷日期">',
    '  <button type="button" data-date-quick="today">今天</button>',
    '  <button type="button" data-date-quick="tomorrow">明天</button>',
    '  <button type="button" data-date-quick="week">一周后</button>',
    '</div>',
    '<div class="dw-date-weekdays"></div>',
    '<div class="dw-date-grid"></div>',
  ].join('');

  const title = popover.querySelector('.dw-date-title');
  const weekdays = popover.querySelector('.dw-date-weekdays');
  const grid = popover.querySelector('.dw-date-grid');
  WEEKDAYS.forEach((name) => {
    const node = document.createElement('span');
    node.textContent = name;
    weekdays.append(node);
  });

  let activeInput = null;
  let activeTrigger = null;
  let pickerOpen = false;
  let viewYear = new Date().getFullYear();
  let viewMonth = new Date().getMonth();
  let selectedValue = '';
  let wheelLocked = false;

  function dispatchInput(input) {
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function renderCalendar() {
    title.textContent = viewYear + '年' + (viewMonth + 1) + '月';
    grid.replaceChildren();
    const first = new Date(viewYear, viewMonth, 1);
    const offset = (first.getDay() + 6) % 7;
    const start = new Date(viewYear, viewMonth, 1 - offset);
    const today = dateKey(new Date());
    for (let index = 0; index < 42; index += 1) {
      const date = addDays(start, index);
      const key = dateKey(date);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'dw-date-day';
      button.style.setProperty('--day-index', index);
      button.dataset.date = key;
      button.textContent = date.getDate();
      if (date.getMonth() !== viewMonth) { button.classList.add('outside'); button.disabled = true; button.setAttribute('aria-disabled', 'true'); }
      if (key === today) button.classList.add('today');
      if (key === selectedValue) button.classList.add('selected');
      button.setAttribute('aria-label', date.getFullYear() + '年' + (date.getMonth() + 1) + '月' + date.getDate() + '日');
      grid.append(button);
    }
    grid.classList.remove('dw-date-grid-animating');
    void grid.offsetWidth;
    grid.classList.add('dw-date-grid-animating');
  }

  function positionPopover() {
    if (!activeInput || !activeTrigger || !pickerOpen) return;
    const rect = activeTrigger.getBoundingClientRect();
    const width = popover.offsetWidth;
    const height = popover.offsetHeight;
    let left = rect.right - width;
    left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
    let top = rect.bottom + 8;
    if (top + height > window.innerHeight - 8) top = rect.top - height - 8;
    top = Math.max(8, Math.min(top, window.innerHeight - height - 8));
    popover.style.left = Math.round(left) + 'px';
    popover.style.top = Math.round(top) + 'px';
  }

  function closePicker() {
    if (!pickerOpen) return;
    pickerOpen = false;
    popover.classList.remove('is-open');
    if (typeof popover.hidePopover === 'function' && popover.matches(':popover-open')) {
      try { popover.hidePopover(); } catch { /* fallback */ }
    }
    popover.hidden = true;
    if (activeTrigger) activeTrigger.setAttribute('aria-expanded', 'false');
    activeInput = null;
    activeTrigger = null;
  }

  function selectDate(value, close = true) {
    if (!activeInput) return;
    activeInput.value = value;
    activeInput.setCustomValidity('');
    activeInput.closest('.dw-date-control')?.removeAttribute('data-invalid');
    dispatchInput(activeInput);
    selectedValue = value;
    const selected = fromKey(value);
    viewYear = selected.getFullYear();
    viewMonth = selected.getMonth();
    renderCalendar();
    if (close) closePicker();
  }

  function openPicker(input, trigger) {
    popover.dataset.theme = document.body.classList.contains('theme-dark') ? 'dark' : 'light';
    activeInput = input;
    activeTrigger = trigger;
    trigger.setAttribute('aria-expanded', 'true');
    selectedValue = normalizeDate(input.value) || '';
    const base = selectedValue ? fromKey(selectedValue) : new Date();
    viewYear = base.getFullYear();
    viewMonth = base.getMonth();
    renderCalendar();
    const host = input.closest('dialog[open]') || document.body;
    if (popover.parentElement !== host) host.append(popover);
    popover.hidden = false;
    pickerOpen = true;
    if (typeof popover.showPopover === 'function') {
      try { popover.showPopover(); } catch { /* fallback */ }
    }
    popover.classList.remove('is-open');
    positionPopover();
    requestAnimationFrame(() => {
      positionPopover();
      popover.classList.add('is-open');
    });
  }

  popover.addEventListener('click', (event) => {
    const day = event.target.closest('.dw-date-day');
    if (day) {
      selectDate(day.dataset.date);
      return;
    }
    const nav = event.target.closest('[data-date-nav]');
    if (nav) {
      const next = new Date(viewYear, viewMonth + Number(nav.dataset.dateNav), 1);
      viewYear = next.getFullYear();
      viewMonth = next.getMonth();
      renderCalendar();
      return;
    }
    const quick = event.target.closest('[data-date-quick]');
    if (quick) {
      const today = new Date();
      if (quick.dataset.dateQuick === 'tomorrow') selectDate(dateKey(addDays(today, 1)));
      else if (quick.dataset.dateQuick === 'week') selectDate(dateKey(addDays(today, 7)));
      else selectDate(dateKey(today));
    }
  });

  grid.addEventListener('wheel', (event) => {
    event.preventDefault();
    if (wheelLocked) return;
    wheelLocked = true;
    setTimeout(() => { wheelLocked = false; }, 140);
    const next = new Date(viewYear, viewMonth + (event.deltaY > 0 ? 1 : -1), 1);
    viewYear = next.getFullYear();
    viewMonth = next.getMonth();
    renderCalendar();
  }, { passive: false });

  document.addEventListener('pointerdown', (event) => {
    if (!activeInput) return;
    if (event.target.closest('#dwDatePopover') || event.target.closest('.dw-date-control')) return;
    commitInput(activeInput);
    closePicker();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && pickerOpen) {
      event.stopPropagation();
      closePicker();
    }
  }, true);

  document.addEventListener('focusin', (event) => {
    if (!activeInput) return;
    if (event.target === activeInput || event.target.closest('#dwDatePopover') || event.target.closest('.dw-date-control')) return;
    commitInput(activeInput);
    closePicker();
  });

  window.addEventListener('resize', positionPopover);

  function attachInput(input) {
    if (!input || input.closest('.dw-date-control')) return input;
    const control = document.createElement('div');
    control.className = 'dw-date-control';
    input.parentNode.insertBefore(control, input);
    control.append(input);

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'dw-date-trigger';
    trigger.setAttribute('aria-label', '选择日期');
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.innerHTML = '<span class="dw-date-icon" aria-hidden="true"></span>';
    control.append(trigger);

    input.addEventListener('input', () => {
      input.setCustomValidity('');
      control.removeAttribute('data-invalid');
    });
    input.addEventListener('blur', () => commitInput(input));
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !commitInput(input)) {
        event.preventDefault();
        input.reportValidity();
      }
    });
    trigger.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (activeInput === input && pickerOpen) closePicker();
      else openPicker(input, trigger);
    });
    return input;
  }

  inputs.forEach(attachInput);

  window.DeskWeekDate = {
    attach: attachInput,
    normalize: normalizeDate,
    commit: commitInput,
    read(input) {
      if (!commitInput(input)) return null;
      return normalizeDate(input.value) || '';
    },
  };
})();
