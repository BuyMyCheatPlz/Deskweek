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
    widget: () => true, widgetBounds: () => ({ x: 80, y: 80, width: 880, height: 690 }), isHidden: () => false, isWidgetSender: sender => sender === "widget", restoreWidget: () => restored++,
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

test("a visible manager uses its own fullscreen state and still respects lock", () => {
  const { managerRuntimeState } = require("../src/main/windows/windows.cjs");
  assert.equal(managerRuntimeState({ paused: true, reason: "hidden" }).paused, false);
  assert.equal(managerRuntimeState({ paused: true, reason: "fullscreen" }, false).paused, false);
  assert.equal(managerRuntimeState({ paused: false, reason: "active" }, true).paused, true);
  assert.equal(managerRuntimeState({ paused: true, reason: "locked" }).paused, true);
});

test("uncovered monitor stays active past the grace period; moving cancels a pending unload", () => {
  let now = 0, x = -1800, releases = 0;
  const calls = [], messages = [];
  const sandbox = { module: { exports: {} }, require: name => require("../src/main/runtime/" + name.replace("./", "")), Date: { now: () => now } };
  vm.createContext(sandbox); vm.runInContext(fs.readFileSync(require.resolve("../src/main/runtime/runtime.cjs"), "utf8"), sandbox);
  const runtime = sandbox.module.exports.createRuntime({ shell: { fullscreen: (_pid, bounds) => {
    calls.push(bounds); return !bounds || bounds.x >= 0;
  } }, powerMonitor: new EventEmitter(), windows: {
    widget: () => true, widgetBounds: () => ({ x, y: 80, width: 880, height: 690 }), isHidden: () => false,
    isWidgetSender: sender => sender === "widget", restoreWidget() {}, checkDesktop() {},
    notifyRuntime: message => messages.push(message), releaseWidget: () => releases++,
  } });
  runtime.refresh(); now = 20000; runtime.refresh();
  assert.equal(runtime.state().paused, false);
  assert.equal(messages.some(m => m.releaseRequested), false);
  assert.equal(calls.at(-1).x, -1800);
  x = 80; now = 21000; runtime.refresh();
  assert.equal(runtime.state().paused, true);
  now = 37000; runtime.refresh(); const request = messages.at(-1);
  assert.equal(request.releaseRequested, true);
  x = -1800;
  runtime.ready({ sender: "widget" }, { ...request, canRelease: true });
  assert.equal(releases, 0, "Move to an uncovered display must invalidate permission immediately");
  runtime.refresh(); assert.equal(runtime.state().paused, false);
  x = 80; now = 38000; runtime.refresh(); now = 40000; runtime.refresh();
  assert.equal(messages.at(-1).releaseRequested, undefined, "A fresh fullscreen interval gets a new grace period");
});
