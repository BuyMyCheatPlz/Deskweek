"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { fileURLToPath, pathToFileURL } = require("node:url");
const { createPaths } = require("../src/main/paths.cjs");

test("both pages resolve every local script, stylesheet and image after relocation", () => {
  const paths = createPaths();
  for (const page of [paths.widget, paths.manager]) {
    for (const match of fs.readFileSync(page, "utf8").matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
      const ref = match[1];
      if (/^(?:https?:|data:|#)/.test(ref)) continue;
      const target = fileURLToPath(new URL(ref, pathToFileURL(page)));
      assert.ok(fs.existsSync(target), `${page}: missing ${ref}`);
    }
  }
  assert.ok(fs.existsSync(paths.preload));
  assert.ok(fs.existsSync(paths.tray));
  assert.equal(paths.root, path.resolve(__dirname, ".."));
});
