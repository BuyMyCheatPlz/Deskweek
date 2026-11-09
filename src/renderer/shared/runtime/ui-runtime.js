"use strict";
// Both renderers use the same minute scheduler. Nothing repaints while paused.
window.DeskWeekRuntime = (() => {
  let paused = false, timer, nativePaused = false, refresh = () => {}, canRelease = () => false;
  function schedule() {
    clearTimeout(timer);
    if (paused) return;
    timer = setTimeout(() => { if (!paused) refresh(); schedule(); }, 60000 - Date.now() % 60000 + 20);
  }
  function update() {
    const next = nativePaused || document.hidden;
    if (next === paused) return;
    paused = next;
    document.documentElement.classList.toggle("runtime-paused", paused);
    if (!paused) refresh();
    schedule();
  }
  return {
    paused: () => paused,
    start(options) {
      refresh = options.refresh; canRelease = options.canRelease || canRelease;
      document.addEventListener("visibilitychange", update);
      window.deskWeek?.onRuntimeState?.(state => {
        nativePaused = Boolean(state.paused); update();
        if (!nativePaused) document.body.inert = false;
        if (nativePaused && state.releaseRequested) {
          const ready = canRelease() && window.deskWeek.canSuspend();
          if (ready) document.body.inert = true;
          window.deskWeek.runtimeReady({ token: state.token, releaseRequested: true, canRelease: ready });
        }
      });
      update(); schedule();
    },
  };
})();
