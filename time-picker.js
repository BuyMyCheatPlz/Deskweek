(() => {
  'use strict';
  if (window.DeskWeekTime) return;

  const pad = (value) => String(value).padStart(2, '0');
  const inputs = [...document.querySelectorAll('input[data-time-picker]')];
  if (!inputs.length) return;

  function normalizeTime(raw) {
    const text = String(raw == null ? '' : raw).trim().replace(/：/g, ':').replace(/\s+/g, '');
    if (!text) return '';
    let hour;
    let minute;
    let match = text.match(/^(\d{1,2}):(\d{1,2})$/);
    if (match) {
      hour = Number(match[1]);
      minute = Number(match[2]);
    } else if (/^\d{1,2}$/.test(text)) {
      hour = Number(text);
      minute = 0;
    } else if (/^\d{3,4}$/.test(text)) {
      const digits = text.padStart(4, '0');
      hour = Number(digits.slice(0, 2));
      minute = Number(digits.slice(2));
    } else {
      return null;
    }
    if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
    return pad(hour) + ':' + pad(minute);
  }

  function commitInput(input) {
    const value = normalizeTime(input.value);
    const control = input.closest('.dw-time-control');
    if (value === null) {
      input.setCustomValidity('时间格式：12:00，可留空');
      control?.setAttribute('data-invalid', 'true');
      return false;
    }
    input.value = value;
    input.setCustomValidity('');
    control?.removeAttribute('data-invalid');
    return true;
  }

  const popover = document.createElement('div');
  popover.id = 'dwTimePopover';
  popover.className = 'dw-time-popover';
  popover.dataset.theme = document.body.classList.contains('theme-dark') ? 'dark' : 'light';
  popover.setAttribute('popover', 'manual');
  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-label', '选择时间');
  popover.hidden = true;
  popover.innerHTML = [
    '<div class="dw-time-head">',
    '  <div><strong>时间</strong></div>',
    '  <button class="dw-time-clear" type="button">全天</button>',
    '</div>',
    '<div class="dw-time-quick" aria-label="常用时间">',
    '  <button type="button" data-preset="09:00">09:00</button>',
    '  <button type="button" data-preset="12:00">12:00</button>',
    '  <button type="button" data-preset="18:00">18:00</button>',
    '  <button type="button" data-preset="20:00">20:00</button>',
    '</div>',
    '<div class="dw-time-columns">',
    '  <div class="dw-time-column-wrap"><span>时</span><div class="dw-time-column" data-column="hour"></div></div>',
    '  <div class="dw-time-colon">:</div>',
    '  <div class="dw-time-column-wrap"><span>分</span><div class="dw-time-column" data-column="minute"></div></div>',
    '</div>',
    '<div class="dw-time-foot"><span></span><button type="button" class="dw-time-done">完成</button></div>',
  ].join('');

  const hourColumn = popover.querySelector('[data-column="hour"]');
  const minuteColumn = popover.querySelector('[data-column="minute"]');

  function fillColumn(column, part, count) {
    for (let index = 0; index < count; index += 1) {
      const value = pad(index);
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'dw-time-option';
      option.dataset.part = part;
      option.dataset.value = value;
      option.textContent = value;
      option.setAttribute('aria-selected', 'false');
      column.append(option);
    }
  }
  fillColumn(hourColumn, 'hour', 24);
  fillColumn(minuteColumn, 'minute', 60);

  let activeInput = null;
  let activeTrigger = null;
  let selectedHour = pad(new Date().getHours());
  let selectedMinute = pad(new Date().getMinutes());
  let pickerOpen = false;

  function dispatchInput(input) {
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function refreshSelection() {
    popover.querySelectorAll('.dw-time-option').forEach((option) => {
      const active = option.dataset.part === 'hour' ? option.dataset.value === selectedHour : option.dataset.value === selectedMinute;
      option.classList.toggle('active', active);
      option.setAttribute('aria-selected', String(active));
    });
  }

const scrollSyncSuppressedUntil = new WeakMap();
  const wheelAccumulator = new WeakMap();
  function optionContentTop(column, option) {
    return option.offsetParent === column.offsetParent ? option.offsetTop - column.offsetTop : option.getBoundingClientRect().top - column.getBoundingClientRect().top + column.scrollTop;
  }
  function centerColumn(column) {
    const active = column.querySelector('.dw-time-option.active');
    if (!active) return;
    scrollSyncSuppressedUntil.set(column, performance.now() + 90);
    column.scrollTop = optionContentTop(column, active) - column.clientHeight / 2 + active.offsetHeight / 2;
  }
  function selectColumnValue(column, direction) {
    const part = column.dataset.column;
    const max = part === 'hour' ? 23 : 59;
    const current = Number(part === 'hour' ? selectedHour : selectedMinute);
    const next = (current + direction + max + 1) % (max + 1);
    if (part === 'hour') selectedHour = pad(next);
    else selectedMinute = pad(next);
    refreshSelection();
    applySelection();
    centerColumn(column);
  }

  function applySelection() {
    if (!activeInput) return;
    activeInput.value = selectedHour + ':' + selectedMinute;
    activeInput.setCustomValidity('');
    activeInput.closest('.dw-time-control')?.removeAttribute('data-invalid');
    dispatchInput(activeInput);
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
      try { popover.hidePopover(); } catch { /* fallback below */ }
    }
    popover.hidden = true;
    if (activeTrigger) activeTrigger.setAttribute('aria-expanded', 'false');
    activeInput = null;
    activeTrigger = null;
  }

  function openPicker(input, trigger) {
    popover.dataset.theme = document.body.classList.contains('theme-dark') ? 'dark' : 'light';
    activeInput = input;
    activeTrigger = trigger;
    trigger.setAttribute('aria-expanded', 'true');
    const normalized = normalizeTime(input.value);
    const now = new Date();
    const parts = normalized ? normalized.split(':') : [pad(now.getHours()), pad(now.getMinutes())];
    selectedHour = parts[0];
    selectedMinute = parts[1];
    refreshSelection();
    const host = input.closest('dialog[open]') || document.body;
    if (popover.parentElement !== host) host.append(popover);
    popover.hidden = false;
    pickerOpen = true;
    if (typeof popover.showPopover === 'function') {
      try { popover.showPopover(); } catch { /* keep the fixed-position fallback */ }
    }
    popover.classList.remove('is-open');
    positionPopover();
    centerColumn(hourColumn);
    centerColumn(minuteColumn);
    requestAnimationFrame(() => {
      positionPopover();
      popover.classList.add('is-open');
      centerColumn(hourColumn);
      centerColumn(minuteColumn);
    });
  }

[hourColumn, minuteColumn].forEach((column) => {
    column.addEventListener('wheel', (event) => {
      const vertical = Math.abs(event.deltaY) >= Math.abs(event.deltaX) ? event.deltaY : event.deltaX;
      if (Math.abs(vertical) < 0.5) return;
      event.preventDefault();
      event.stopPropagation();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? column.clientHeight : 1;
      const delta = vertical * unit;
      const direction = delta > 0 ? 1 : -1;
      if (Math.abs(delta) >= 50) {
        wheelAccumulator.set(column, 0);
        selectColumnValue(column, direction);
        return;
      }
      const accumulated = (wheelAccumulator.get(column) || 0) + delta;
      if (Math.abs(accumulated) >= 24) {
        wheelAccumulator.set(column, 0);
        selectColumnValue(column, accumulated > 0 ? 1 : -1);
      } else {
        wheelAccumulator.set(column, accumulated);
      }
    }, { passive: false });

    column.addEventListener('scroll', () => {
      if (performance.now() < (scrollSyncSuppressedUntil.get(column) || 0)) return;
      const options = [...column.querySelectorAll('.dw-time-option')];
      if (!options.length) return;
      let nearest = options[0];
      if (column.scrollTop <= 1) nearest = options[0];
      else if (column.scrollTop >= column.scrollHeight - column.clientHeight - 1) nearest = options[options.length - 1];
      else {
        const center = column.scrollTop + column.clientHeight / 2;
        let distance = Infinity;
        options.forEach((option) => {
          const optionCenter = optionContentTop(column, option) + option.offsetHeight / 2;
          const nextDistance = Math.abs(optionCenter - center);
          if (nextDistance < distance) { distance = nextDistance; nearest = option; }
        });
      }
      const value = nearest.dataset.value;
      const changed = column.dataset.column === 'hour' ? selectedHour !== value : selectedMinute !== value;
      if (!changed) return;
      if (column.dataset.column === 'hour') selectedHour = value;
      else selectedMinute = value;
      refreshSelection();
      applySelection();
    }, { passive: true });
  });

  popover.addEventListener('click', (event) => {
    const option = event.target.closest('.dw-time-option');
    if (option) {
      if (option.dataset.part === 'hour') selectedHour = option.dataset.value;
      else selectedMinute = option.dataset.value;
      refreshSelection();
      applySelection();
      centerColumn(option.closest('.dw-time-column'));
      return;
    }
    const preset = event.target.closest('[data-preset]');
    if (preset) {
      [selectedHour, selectedMinute] = preset.dataset.preset.split(':');
      refreshSelection();
      applySelection();
      closePicker();
      return;
    }
    if (event.target.closest('.dw-time-clear')) {
      if (activeInput) {
        activeInput.value = '';
        activeInput.setCustomValidity('');
        activeInput.closest('.dw-time-control')?.removeAttribute('data-invalid');
        dispatchInput(activeInput);
      }
      closePicker();
      return;
    }
    if (event.target.closest('.dw-time-done')) {
      if (activeInput) commitInput(activeInput);
      closePicker();
    }
  });

  document.addEventListener('pointerdown', (event) => {
    if (!activeInput) return;
    if (event.target.closest('#dwTimePopover') || event.target.closest('.dw-time-control')) return;
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
    if (event.target === activeInput || event.target.closest('#dwTimePopover') || event.target.closest('.dw-time-control')) return;
    commitInput(activeInput);
    closePicker();
  });

  window.addEventListener('resize', positionPopover);

  inputs.forEach((input) => {
    const control = document.createElement('div');
    control.className = 'dw-time-control';
    input.parentNode.insertBefore(control, input);
    control.append(input);

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'dw-time-trigger';
    trigger.setAttribute('aria-label', '选择时间');
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.innerHTML = '<span class="dw-time-icon" aria-hidden="true"></span>';
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
  });

  window.DeskWeekTime = {
    normalize: normalizeTime,
    commit: commitInput,
    read(input) {
      commitInput(input);
      return normalizeTime(input.value) || '';
    },
  };
})();
