(() => {
  'use strict';
  const KEY = 'deskweek.theme.v1';
  const root = document.documentElement;
  const fallback = root.dataset.defaultTheme === 'dark' ? 'dark' : 'light';
  let theme = fallback;
  try { const saved = localStorage.getItem(KEY); if (saved === 'dark' || saved === 'light') theme = saved; } catch { /* optional */ }
  root.dataset.theme = theme;
  function apply() {
    if (!document.body) return;
    document.body.classList.toggle('theme-dark', theme === 'dark');
    document.body.classList.toggle('theme-light', theme === 'light');
    const meta = document.querySelector('meta[name="color-scheme"]');
    if (meta) meta.setAttribute('content', theme);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply, { once: true });
  else apply();
  window.DeskWeekThemeBootstrap = { get: () => theme, apply };
})();
