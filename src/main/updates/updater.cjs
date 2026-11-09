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
    signal: AbortSignal.timeout(15000),
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
  return fs.readFileSync(path.join(__dirname, "install-update.ps1"), "utf8");
}

async function downloadAndInstallUpdate(event, portableDataDir) {
  const { app } = require("electron");
  if (!app.isPackaged) throw new Error("开发模式不执行自动替换，请使用打包版本");
  const report = data => { if (!event.sender.isDestroyed()) event.sender.send("deskweek:update-progress", data); };
  const info = await checkGithubUpdate();
  if (!info.hasUpdate) return { ok: true, updated: false, info };
  if (!info.asset?.downloadUrl) throw new Error("最新版本没有可下载的便携包");
  if (!/^sha256:[a-f0-9]{64}$/i.test(info.asset.digest)) throw new Error("更新包缺少 SHA-256 校验信息");
  const updateDir = path.join(portableDataDir, "updates");
  fs.mkdirSync(updateDir, { recursive: true });
  const safeName = info.asset.name.replace(/[^\w.\-]+/g, "_");
  const finalPath = path.join(updateDir, safeName);
  const tempPath = `${finalPath}.download`;
  const response = await fetch(info.asset.downloadUrl, { signal: AbortSignal.timeout(180000), headers: { "User-Agent": `DeskWeek/${info.currentVersion}` } });
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
        report({ phase: "download", downloaded, total, percent: total ? Math.min(100, Math.round(downloaded / total * 100)) : 0 });
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
  await new Promise((resolve, reject) => { updater.once("spawn", resolve); updater.once("error", reject); });
  updater.unref();
  report({ phase: "ready", downloaded, total, percent: 100 });
  setTimeout(() => app.quit(), 700);
  return { ok: true, updated: true, info };
}

module.exports = { checkGithubUpdate, downloadAndInstallUpdate, buildUpdaterScript };
