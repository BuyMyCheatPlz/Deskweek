"use strict";
// Drafts live in the main process only; renderer recreation must not erase input.
window.DeskWeekDrafts = (() => {
  let options, ready = false, timer;
  function save() {
    if (!ready) return;
    if (!options.hasDraft()) { options.clear?.(); window.deskWeek?.saveDraft(null); return; }
    const fields = [...document.querySelectorAll("input[id], textarea[id], select[id]")].filter(el => !["file", "password"].includes(el.type))
      .map(el => ({ id: el.id, value: el.value, checked: el.checked }));
    const defers = [...document.querySelectorAll("[data-defer-picker][id]")].map(el => ({ id: el.id, value: window.DeskWeekDefer?.read?.(el) }));
    window.deskWeek?.saveDraft({ fields, defers, dialogs: [...document.querySelectorAll("dialog[open]")].map(el => el.id), ...options.capture() });
  }
  return {
    hasDraft: () => Boolean(options?.hasDraft()),
    save,
    async start(config) {
      options = config;
      const draft = await window.deskWeek?.loadDraft?.();
      if (draft) {
        config.restore(draft);
        for (const field of draft.fields || []) {
          const el = document.getElementById(field.id);
          if (el) { el.value = field.value; if (el.type === "checkbox") el.checked = field.checked; }
        }
        for (const field of draft.defers || []) window.DeskWeekDefer?.set?.(document.getElementById(field.id), field.value);
        for (const id of draft.dialogs || []) { const dialog = document.getElementById(id); if (dialog && !dialog.open) dialog.showModal(); }
      }
      ready = true;
      document.addEventListener("input", save, true);
      document.addEventListener("change", save, true);
      document.addEventListener("close", save, true);
      document.addEventListener("click", () => { clearTimeout(timer); timer = setTimeout(save, 0); }, true);
    },
  };
})();
