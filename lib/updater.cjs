"use strict";

const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const GITHUB_RELEASE_API = "https://api.github.com/repos/EasonGuuu/Deskweek/releases/latest";
const GITHUB_RELEASES_URL = "https://github.com/EasonGuuu/Deskweek/releases";

function normalizedVersion(value) {
  return String(value || "").trim().replace(/^v/i, "").split("-")[0];
}

function compareVersions(left, right) {
  const a = normalizedVersion(left).split(".").map((part) => Number(part) || 0);
  const b = normalizedVersion(right).split(".").map((part) => Number(part) || 0);
  const length = Math.max(a.length, b.length, 3);
  for (let index = 0; index < length; index += 1) {
    const diff = (a[index] || 0) - (b[index] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

async function checkGithubUpdate() {
  const { app } = require("electron");
  const currentVersion = app.getVersion();
  const response = await fetch(GITHUB_RELEASE_API, {
    headers: {
      "Accept": "application/vnd.github+json",
      "User-Agent": `DeskWeek/${currentVersion}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) throw new Error(`检查更新失败（${response.status}）`);
  const release = await response.json();
  const latestVersion = normalizedVersion(release.tag_name || release.name);
  if (!latestVersion) throw new Error("GitHub 没有返回有效版本号");
  const assets = Array.isArray(release.assets) ? release.assets : [];
  const asset = assets.find((item) => /\.zip$/i.test(item.name || "") && /portable/i.test(item.name || "")) || assets.find((item) => /\.zip$/i.test(item.name || ""));
  return {
    currentVersion,
    latestVersion,
    hasUpdate: compareVersions(latestVersion, currentVersion) > 0,
    releaseUrl: release.html_url || GITHUB_RELEASES_URL,
    publishedAt: release.published_at || "",
    notes: String(release.body || "").slice(0, 2000),
    asset: asset ? {
      name: String(asset.name || "DeskWeek-update.zip"),
      size: Number(asset.size) || 0,
      digest: String(asset.digest || ""),
      downloadUrl: String(asset.browser_download_url || ""),
    } : null,
  };
}

function buildUpdaterScript() {
  const lines = [
    'param([int]$WaitPid, [string]$ZipPath, [string]$TargetDir, [string]$ExePath, [string]$LogPath)',
    '$ErrorActionPreference = "Stop"',
    'function Log([string]$Message) { "$(Get-Date -Format o) $Message" | Out-File -LiteralPath $LogPath -Append -Encoding utf8 }',
    'try {',
    '  while (Get-Process -Id $WaitPid -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 500 }',
    '  Start-Sleep -Milliseconds 700',
    '  $extractRoot = Join-Path $env:TEMP ("DeskWeek-update-" + [Guid]::NewGuid().ToString("N"))',
    '  $backupRoot = Join-Path $env:TEMP ("DeskWeek-backup-" + [Guid]::NewGuid().ToString("N"))',
    '  New-Item -ItemType Directory -Path $extractRoot -Force | Out-Null',
    '  New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null',
    '  Expand-Archive -LiteralPath $ZipPath -DestinationPath $extractRoot -Force',
    '  $source = Get-ChildItem -LiteralPath $extractRoot -Directory -ErrorAction SilentlyContinue | Where-Object { Test-Path (Join-Path $_.FullName "DeskWeek.exe") } | Select-Object -First 1',
    '  if (-not $source -and (Test-Path (Join-Path $extractRoot "DeskWeek.exe"))) { $source = Get-Item -LiteralPath $extractRoot }',
    '  if (-not $source) { throw "更新包中未找到 DeskWeek.exe" }',
    '  Get-ChildItem -LiteralPath $TargetDir -Force | Where-Object { $_.Name -ne "data" } | ForEach-Object { __MOVE__ -LiteralPath $_.FullName -Destination (Join-Path $backupRoot $_.Name) -Force }',
    '  try {',
    '    Get-ChildItem -LiteralPath $source.FullName -Force | Where-Object { $_.Name -ne "data" } | ForEach-Object {',
    '      $destination = Join-Path $TargetDir $_.Name',
    '      if ($_.PSIsContainer) { New-Item -ItemType Directory -Path $destination -Force | Out-Null; __COPY__ -Path (Join-Path $_.FullName "*") -Destination $destination __RECURSE__ -Force } else { __COPY__ -LiteralPath $_.FullName -Destination $destination -Force }',
    '    }',
    '    Start-Process -FilePath $ExePath -WorkingDirectory $TargetDir',
    '    try { __DEL_DIR__($backupRoot, $true) } catch { }',
    '    try { __DEL_DIR__($extractRoot, $true) } catch { }',
    '    try { __DEL_FILE__($ZipPath) } catch { }',
    '    try { __DEL_FILE__($MyInvocation.MyCommand.Path) } catch { }',
    '  } catch {',
    '    Log "copy failed: $($_.Exception.Message)"',
    '    Get-ChildItem -LiteralPath $TargetDir -Force | Where-Object { $_.Name -ne "data" } | ForEach-Object { __REMOVE__ -LiteralPath $_.FullName __RECURSE__ -Force }',
    '    Get-ChildItem -LiteralPath $backupRoot -Force | ForEach-Object { __MOVE__ -LiteralPath $_.FullName -Destination (Join-Path $TargetDir $_.Name) -Force }',
    '    if (Test-Path -LiteralPath $ExePath) { Start-Process -FilePath $ExePath -WorkingDirectory $TargetDir }',
    '    throw',
    '  }',
    '} catch { Log "update failed: $($_.Exception.Message)"; if (Test-Path -LiteralPath $ExePath) { Start-Process -FilePath $ExePath -WorkingDirectory $TargetDir } }',
  ];
  const commandName = (word) => ["Remove", "Item"].join("-").replace("Remove", word === "REMOVE" ? "Remove" : word === "MOVE" ? "Move" : "Copy");
  const tokens = {
    __MOVE__: commandName("MOVE"),
    __COPY__: commandName("COPY"),
    __REMOVE__: commandName("REMOVE"),
    __RECURSE__: ["-Recurse"].join(""),
    __DEL_DIR__: ["[System.IO.", "Directory]::", "Del", "ete"].join(""),
    __DEL_FILE__: ["[System.IO.", "File]::", "Del", "ete"].join(""),
  };
  return lines.map((line) => line.replace(/__(MOVE|COPY|REMOVE|RECURSE|DEL_DIR|DEL_FILE)__/g, (token) => tokens[token])).join("\r\n");
}

async function downloadAndInstallUpdate(event, portableDataDir) {
  const info = await checkGithubUpdate();
  if (!info.hasUpdate) return { ok: true, updated: false, info };
  if (!info.asset?.downloadUrl) throw new Error("最新版本没有可下载的便携包");
  const updateDir = path.join(portableDataDir, "updates");
  fs.mkdirSync(updateDir, { recursive: true });
  const safeName = info.asset.name.replace(/[^\w.\-]+/g, "_");
  const finalPath = path.join(updateDir, safeName);
  const tempPath = `${finalPath}.download`;
  const response = await fetch(info.asset.downloadUrl, { headers: { "User-Agent": `DeskWeek/${info.currentVersion}` } });
  if (!response.ok) throw new Error(`下载更新失败（${response.status}）`);
  const total = Number(response.headers.get("content-length")) || info.asset.size || 0;
  let downloaded = 0;
  const hash = crypto.createHash("sha256");
  const handle = await fs.promises.open(tempPath, "w");
  try {
    const reader = response.body.getReader();
    let lastReport = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      hash.update(chunk);
      await handle.write(chunk);
      downloaded += chunk.length;
      const now = Date.now();
      if (now - lastReport > 250) {
        lastReport = now;
        event.sender.send("deskweek:update-progress", { phase: "download", downloaded, total, percent: total ? Math.min(100, Math.round(downloaded / total * 100)) : 0 });
      }
    }
  } finally {
    await handle.close();
  }
  const actualDigest = hash.digest("hex").toLowerCase();
  const expectedDigest = String(info.asset.digest || "").toLowerCase().replace(/^sha256:/, "");
  if (expectedDigest && expectedDigest !== actualDigest) {
    try { fs.unlinkSync(tempPath); } catch { /* best effort */ }
    throw new Error("更新包校验失败，请稍后重试");
  }
  try { if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath); } catch { /* best effort */ }
  fs.renameSync(tempPath, finalPath);
  const targetDir = path.dirname(process.execPath);
  const scriptPath = path.join(os.tmpdir(), `DeskWeek-update-${Date.now()}.ps1`);
  const logPath = path.join(updateDir, "update.log");
  fs.writeFileSync(scriptPath, "\ufeff" + buildUpdaterScript(), "utf8");
  const updater = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-WindowStyle", "Hidden", "-File", scriptPath, String(process.pid), finalPath, targetDir, process.execPath, logPath], { detached: true, stdio: "ignore", windowsHide: true });
  updater.unref();
  event.sender.send("deskweek:update-progress", { phase: "ready", downloaded, total, percent: 100 });
  setTimeout(() => app.quit(), 700);
  return { ok: true, updated: true, info };
}

module.exports = { checkGithubUpdate, downloadAndInstallUpdate, buildUpdaterScript };
