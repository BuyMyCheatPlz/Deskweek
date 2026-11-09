"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
function files(dir, top = true) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? ((!top || ["src", "vendor", "scripts", "test"].includes(entry.name)) ? files(file, false) : []) : /\.(?:c?js)$/.test(file) ? [file] : [];
  });
}
for (const file of files(".")) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) { process.stderr.write(result.stderr); process.exit(1); }
}
console.log("All JavaScript syntax checks passed");
