"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

test("Windows installer restores partial backup even when its log cannot be written", { skip: process.platform !== "win32" }, async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "deskweek-installer-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const zip = new (require("jszip"))();
  zip.file("package/DeskWeek.exe", "new-exe"); zip.file("package/resources/app.asar", "new-app");
  fs.writeFileSync(path.join(dir, "update.zip"), await zip.generateAsync({ type: "nodebuffer" }));
  const script = `
    $ErrorActionPreference = 'Stop'
    $caseRoot = $env:DESKWEEK_INSTALLER_TEST_DIR
    $target = Join-Path $caseRoot 'app'
    $source = Join-Path $caseRoot 'package'
    New-Item -ItemType Directory -Path $target, (Join-Path $source 'resources') -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $target 'DeskWeek.exe') -Value 'old-exe'
    Set-Content -LiteralPath (Join-Path $target 'chrome_100_percent.pak') -Value 'old-pak'
    Set-Content -LiteralPath (Join-Path $target 'personal.txt') -Value 'keep'
    Set-Content -LiteralPath (Join-Path $source 'DeskWeek.exe') -Value 'new-exe'
    Set-Content -LiteralPath (Join-Path $source 'resources\\app.asar') -Value 'new-app'
    $zip = Join-Path $caseRoot 'update.zip'
    $locked = [IO.File]::Open((Join-Path $target 'chrome_100_percent.pak'), [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None)
    try {
      . $env:DESKWEEK_INSTALLER_SCRIPT -WaitPid 0 -ZipPath $zip -TargetDir $target -ExePath (Join-Path $target 'DeskWeek.exe') -LogPath (Join-Path $caseRoot 'missing\\update.log')
      if ($moved.Count -lt 1) { throw 'Test did not reach a partial backup' }
    } finally { $locked.Dispose() }
  `;
  // PID 0 exists forever on Windows; use an impossible PID to skip waiting.
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script.replace("-WaitPid 0", "-WaitPid 2147483647")], {
    env: { ...process.env, DESKWEEK_INSTALLER_TEST_DIR: dir, DESKWEEK_INSTALLER_SCRIPT: path.resolve(__dirname, "../src/main/updates/install-update.ps1") }, encoding: "utf8", timeout: 20000, windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(fs.readFileSync(path.join(dir, "app/DeskWeek.exe"), "utf8"), /old-exe/);
  assert.equal(fs.readFileSync(path.join(dir, "app/personal.txt"), "utf8").trim(), "keep");
  assert.match(fs.readFileSync(path.join(dir, "app/chrome_100_percent.pak"), "utf8"), /old-pak/);
});
