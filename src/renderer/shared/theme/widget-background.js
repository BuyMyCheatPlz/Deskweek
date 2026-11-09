"use strict";
// Applied before first paint; the shared store remains the source of truth.
window.DeskWeekBackground = (() => {
  const KEY = "deskweek.widget-background.v1";
  const normalize = value => value === "transparent" ? "transparent" : "standard";
  let current = "standard";
  try { current = normalize(localStorage.getItem(KEY)); } catch { /* optional cache */ }
  function renderChoice() {
    document.querySelectorAll("[data-widget-background-choice]").forEach(button => {
      const active = button.dataset.widgetBackgroundChoice === current;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }
  function apply(value) {
    current = normalize(value);
    document.documentElement.dataset.widgetBackground = current;
    try { localStorage.setItem(KEY, current); } catch { /* optional cache */ }
    renderChoice();
    return current;
  }
  apply(current);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", renderChoice, { once: true });
  return { normalize, apply, get: () => current, renderChoice };
})();
