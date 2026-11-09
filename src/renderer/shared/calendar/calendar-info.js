(() => {
  'use strict';

  const RANK = { workday: 0, legal: 1, traditional: 2, festival: 3, term: 4, other: 5 };
  const IMPORTANT_TRADITIONAL = new Set(['除夕', '春节', '元宵节', '清明节', '端午节', '七夕节', '中秋节', '重阳节', '腊八节']);
  const IMPORTANT_SOLAR = new Set(['元旦节', '妇女节', '劳动节', '儿童节', '教师节', '国庆节', '母亲节', '父亲节']);
  const cache = new Map();

  function parseDate(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return new Date(value.getFullYear(), value.getMonth(), value.getDate());
    }
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function dateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function termSeason(name) {
    if (['立春', '雨水', '惊蛰', '春分', '清明', '谷雨'].includes(name)) return 'spring';
    if (['立夏', '小满', '芒种', '夏至', '小暑', '大暑'].includes(name)) return 'summer';
    if (['立秋', '处暑', '白露', '秋分', '寒露', '霜降'].includes(name)) return 'autumn';
    return 'winter';
  }

  function addEvent(events, name, kind, label = name, meta = {}) {
    const clean = String(name || '').trim();
    if (!clean) return;
    const normalized = clean.replace(/\s+/g, '');
    if (events.some((event) => event.name.replace(/\s+/g, '') === normalized)) return;
    events.push({ name: clean, label: String(label || clean).trim(), kind, rank: RANK[kind] ?? 99, ...meta });
  }

  function get(value) {
    const date = parseDate(value);
    if (!date) return { key: '', events: [], primary: null, lunarText: '' };
    const key = dateKey(date);
    if (cache.has(key)) return cache.get(key);

    const events = [];
    let lunarText = '';
    try {
      if (typeof Solar === 'undefined') throw new Error('calendar data unavailable');
      const solar = Solar.fromYmd(date.getFullYear(), date.getMonth() + 1, date.getDate());
      const lunar = solar.getLunar();
      lunarText = lunar.toString();

      if (typeof HolidayUtil !== 'undefined') {
        const holiday = HolidayUtil.getHoliday(date.getFullYear(), date.getMonth() + 1, date.getDate());
        if (holiday) {
          const name = holiday.getName();
          if (holiday.isWork()) addEvent(events, name, 'workday', `${name}调休`);
          else addEvent(events, name, 'legal', name, { major: holiday.getTarget() === key });
        }
      }

      lunar.getFestivals().forEach((name) => { if (IMPORTANT_TRADITIONAL.has(name)) addEvent(events, name, 'traditional'); });
      solar.getFestivals().forEach((name) => { if (IMPORTANT_SOLAR.has(name)) addEvent(events, name, 'festival'); });
      const term = lunar.getJieQi();
      if (term && !events.some((event) => event.name === term || event.name.startsWith(term))) addEvent(events, term, 'term', term, { season: termSeason(term) });
    } catch { /* keep the calendar usable without festival data */ }

    events.sort((a, b) => a.rank - b.rank);
    const result = { key, events, primary: events[0] || null, lunarText };
    cache.set(key, result);
    return result;
  }

  function weekdayText(value, weekday) {
    const primary = get(value).primary;
    return primary ? `${weekday}·${primary.label}` : weekday;
  }

  function eventTitle(value) {
    const info = get(value);
    const parts = info.events.map((event) => event.label);
    if (info.lunarText) parts.push(`农历 ${info.lunarText}`);
    return parts.join(' · ');
  }

  window.DeskWeekCalendarInfo = { get, weekdayText, eventTitle };
})();