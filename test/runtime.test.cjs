"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");

test("unload requires a fresh one-shot acknowledgement and rechecks fullscreen", () => {
  let now = 0, fullscreen = true, releases = 0, restored = 0;
  const messages = [];
  const sandbox = { module: { exports: {} }, require: name => require("../src/main/runtime/" + name.replace("./", "")), Date: { now: () => now } };
  vm.createContext(sandbox); vm.runInContext(fs.readFileSync(require.resolve("../src/main/runtime/runtime.cjs"), "utf8"), sandbox);
  const runtime = sandbox.module.exports.createRuntime({ shell: { fullscreen: () => fullscreen }, powerMonitor: new EventEmitter(), windows: {
    widget: () => true, isHidden: () => false, isWidgetSender: sender => sender === "widget", restoreWidget: () => restored++,
    notifyRuntime: message => messages.push(message), releaseWidget: () => releases++, checkDesktop() {},
  } });
  runtime.refresh();
  runtime.ready({ sender: "widget" }, { token: messages.at(-1).token, canRelease: true });
  now = 16000; runtime.refresh();
  const stale = messages.at(-1);
  runtime.ready({ sender: "widget" }, { ...stale, canRelease: false }); assert.equal(releases, 0);
  now = 17000; runtime.refresh();
  runtime.ready({ sender: "widget" }, { ...stale, canRelease: true }); assert.equal(releases, 0);
  fullscreen = false;
  runtime.ready({ sender: "widget" }, { ...messages.at(-1), canRelease: true }); assert.equal(releases, 0);
  fullscreen = true;
  runtime.ready({ sender: "widget" }, { ...messages.at(-1), canRelease: true }); assert.equal(releases, 1);
  runtime.ready({ sender: "widget" }, { ...messages.at(-1), canRelease: true }); assert.equal(releases, 1);
  fullscreen = false; runtime.refresh(); assert.ok(restored >= 1); assert.equal(runtime.state().paused, false);
});

test("hiding the widget never pauses a visible manager", () => {
  const { managerRuntimeState } = require("../src/main/windows/windows.cjs");
  assert.equal(managerRuntimeState({ paused: true, reason: "hidden" }).paused, false);
  assert.equal(managerRuntimeState({ paused: true, reason: "fullscreen" }).paused, true);
  assert.equal(managerRuntimeState({ paused: true, reason: "locked" }).paused, true);
});
