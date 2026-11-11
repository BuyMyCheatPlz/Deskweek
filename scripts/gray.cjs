"use strict";

// 桌面端灰测：语法 → 单测 → UI 冒烟 → 应用冒烟 → 主机回归。
// 用法：node scripts/gray.cjs   （全部通过才返回 0）

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const results = [];

function run(label, command, args, options = {}) {
  process.stdout.write(`\n=== ${label} ===\n`);
  const started = Date.now();
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    shell: true,
    env: { ...process.env, ...(options.env || {}) },
    timeout: options.timeout || 300000,
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  const tail = output.split(/\r?\n/).filter(Boolean).slice(-6).join("\n");
  if (tail) console.log(tail);
  const ok = result.status === 0 && !/SMOKE_FAIL|UI_SMOKE_FAIL|HOST_REGRESSION_FAIL/.test(output);
  results.push({ label, ok, ms: Date.now() - started });
  return { ok, output };
}

run("语法检查", "npm", ["run", "check"]);
run("单元测试", "node", ["--test", "test/*.test.cjs"]);
run("UI 冒烟（同步面板）", "node", ["scripts/ui-smoke.cjs", "--sync"]);
run("应用冒烟（启动 + 同步服务）", "node", ["scripts/smoke.cjs", "--sync"]);
run("主机回归", "npm", ["run", "test:host"]);

console.log("\n===== 灰测汇总 =====");
let failed = 0;
for (const item of results) {
  console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.label}  (${Math.round(item.ms / 1000)}s)`);
  if (!item.ok) failed++;
}
console.log(failed === 0 ? "GRAY_PASS" : `GRAY_FAIL (${failed})`);
process.exit(failed === 0 ? 0 : 1);
