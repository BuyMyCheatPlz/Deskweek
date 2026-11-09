"use strict";

// A small state machine, shared by the runtime controller and its regression tests.
function createRefreshPolicy({ releaseAfterMs = 15000 } = {}) {
  let since = null;
  return {
    evaluate({ now, fullscreen = false, hidden = false, locked = false, canRelease = false }) {
      const paused = fullscreen || hidden || locked;
      if (!paused) since = null;
      else if (since === null) since = now;
      return { paused, reason: locked ? "locked" : hidden ? "hidden" : fullscreen ? "fullscreen" : "active", release: paused && canRelease && now - since >= releaseAfterMs };
    },
  };
}
function coversDisplay(rect, displays, tolerance = 2) {
  return displays.some(a => rect.x <= a.x + tolerance && rect.y <= a.y + tolerance && rect.x + rect.width >= a.x + a.width - tolerance && rect.y + rect.height >= a.y + a.height - tolerance);
}
module.exports = { createRefreshPolicy, coversDisplay };
