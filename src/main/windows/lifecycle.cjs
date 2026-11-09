"use strict";

function liveContents(win) {
  if (!win || win.isDestroyed()) return null;
  const contents = win.webContents;
  return contents && !contents.isDestroyed() ? contents : null;
}

function sendToWindow(win, channel, payload) {
  const contents = liveContents(win);
  if (!contents) return false;
  contents.send(channel, payload);
  return true;
}

function onWindowLoaded(win, isCurrent, onLoaded) {
  const contents = win.webContents;
  const loaded = () => {
    // Listener removal cannot cancel an EventEmitter dispatch already underway.
    // Validate ownership as well as both native object lifetimes at delivery.
    if (isCurrent() && liveContents(win) === contents) onLoaded(win);
  };
  contents.on("did-finish-load", loaded);
  win.once("closed", () => contents.removeListener("did-finish-load", loaded));
}

module.exports = { liveContents, sendToWindow, onWindowLoaded };
