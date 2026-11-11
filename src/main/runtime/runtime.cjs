"use strict";
const { createRefreshPolicy } = require("./refresh-policy.cjs");

function createRuntime({ windows, shell, powerMonitor, onState = () => {} }) {
  const policy = createRefreshPolicy();
  let locked = false, timer, last = "", token = 0, paused = false, reason = "active";
  function widgetFullscreen() {
    const bounds = windows.widgetBounds();
    return Boolean(bounds && shell.fullscreen(0, bounds));
  }
  function tick() {
    const state = policy.evaluate({ now: Date.now(), fullscreen: widgetFullscreen(), hidden: windows.isHidden(), locked, canRelease: true });
    paused = state.paused;
    reason = state.reason;
    if (`${state.paused}:${state.reason}` !== last) {
      last = `${state.paused}:${state.reason}`;
      token++;
      if (!state.paused) windows.restoreWidget();
      onState(state);
    }
    // Managers can move or become covered independently of the widget. The
    // window controller only sends IPC when that particular window's state changes.
    windows.notifyRuntime({ ...state, token });
    // Never cache permission across the grace period. Ask the live page just
    // before unloading; it freezes input before granting this one-shot token.
    if (state.release && windows.widget()) windows.notifyRuntime({ ...state, token: ++token, releaseRequested: true });
    if (!state.paused) { windows.restoreWidget(); windows.checkDesktop(); }
  }
  const suspend = () => { locked = true; tick(); };
  const resume = () => { locked = false; tick(); };
  return {
    start() {
      for (const event of ["lock-screen", "suspend"]) powerMonitor.on(event, suspend);
      for (const event of ["unlock-screen", "resume"]) powerMonitor.on(event, resume);
      timer = setInterval(tick, 1500); timer.unref(); tick();
    },
    ready(event, data) {
      if (windows.isWidgetSender(event.sender) && paused && data?.token === token && data.releaseRequested && data.canRelease && (locked || windows.isHidden() || widgetFullscreen())) {
        token++;
        windows.releaseWidget();
      }
    },
    refresh: tick,
    state: () => ({ paused, reason, token }),
    stop() {
      clearInterval(timer);
      for (const event of ["lock-screen", "suspend"]) powerMonitor.removeListener(event, suspend);
      for (const event of ["unlock-screen", "resume"]) powerMonitor.removeListener(event, resume);
    },
  };
}
module.exports = { createRuntime };
