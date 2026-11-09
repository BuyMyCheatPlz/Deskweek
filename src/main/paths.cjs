"use strict";
const path = require("node:path");

function createPaths(root = path.resolve(__dirname, "../..")) {
  return {
    root,
    widget: path.join(root, "src/renderer/widget/index.html"),
    manager: path.join(root, "src/renderer/manager/index.html"),
    preload: path.join(root, "src/preload/index.cjs"),
    tray: path.join(root, "assets/icons/tray.png"),
  };
}

module.exports = { createPaths };
