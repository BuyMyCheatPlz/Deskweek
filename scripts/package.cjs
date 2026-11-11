"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Windows 上刚解压出来的 default_app.asar 偶尔会被杀毒/索引服务短暂占用，
// 让 @electron/packager 的清理报 EBUSY。这里先清掉旧产物，并每次使用全新的
// 临时目录，避免上一次失败留下的文件把下一次卡住。
async function removeWithRetry(target, attempts = 12) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      fs.rmSync(target, { recursive: true, force: true, maxRetries: 2, retryDelay: 150 });
      return true;
    } catch (error) {
      if (!["EBUSY", "EPERM", "ENOTEMPTY", "EACCES"].includes(error.code) || attempt === attempts - 1) throw error;
      await sleep(250 + attempt * 150);
    }
  }
  return false;
}

async function build() {
  const { packager } = await import("@electron/packager");
  const root = path.resolve(__dirname, "..");
  const output = path.resolve(root, process.env.DESKWEEK_BUILD_DIR || "dist");
  const dist = path.join(root, "dist");
  if (output !== dist && !output.startsWith(dist + path.sep)) throw new Error("Build output must stay inside dist");
  const electronZipDir = process.env.DESKWEEK_ELECTRON_ZIP_DIR ? path.resolve(process.env.DESKWEEK_ELECTRON_ZIP_DIR) : undefined;
  const target = path.join(output, "DeskWeek-win32-x64");
  await removeWithRetry(target);
  const tempDir = path.join(os.tmpdir(), `deskweek-packager-${process.pid}-${Date.now()}`);
  await removeWithRetry(tempDir);

  // packager 解压完 Electron 模板后会立刻删除 default_app.asar。Windows 上
  // 这个新文件常被解压器/杀毒软件短暂占用，直接 rm 会报 EBUSY；换成带等待、
  // GC 和重试的删除，避免整个打包流程被一次瞬时占用打断。
  try {
    const platformModule = await import(pathToFileURL(path.join(root, "node_modules/@electron/packager/dist/platform.js")).href);
    const App = platformModule.App;
    if (App?.prototype?.removeDefaultApp) {
      App.prototype.removeDefaultApp = async function removeDefaultAppWithRetry() {
        for (const basename of ["default_app", "default_app.asar"]) {
          const targetFile = path.join(this.originalResourcesDir, basename);
          for (let attempt = 0; attempt < 80; attempt += 1) {
            try { fs.rmSync(targetFile, { recursive: true, force: true }); break; }
            catch (error) {
              if (!["EBUSY", "EPERM", "ENOTEMPTY", "EACCES"].includes(error.code) || attempt === 79) throw error;
              if (typeof global.gc === "function") global.gc();
              await sleep(200 + Math.min(attempt, 10) * 100);
            }
          }
        }
      };
    }
  } catch (error) {
    console.warn(`[package] 无法安装 default_app 清理重试：${error.message}`);
  }

  let outputs;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      outputs = await packager({ dir: root, name: "DeskWeek", platform: "win32", arch: "x64", out: output, overwrite: true, tmpdir: tempDir, ...(electronZipDir ? { electronZipDir } : {}),
        asar: { unpack: "**/*.node" }, icon: path.join(root, "assets/icons/app-icon.ico"),
        ignore: [/^\/(?:data|dist|release|test|scripts|\.git|\.github)(?:\/|$)/, /\.(?:log|tmp)$/],
      });
      break;
    } catch (error) {
      const blocked = ["EBUSY", "EPERM", "ENOTEMPTY", "EACCES"].includes(error.code);
      if (!blocked || attempt === 3) throw error;
      console.warn(`打包文件被短暂占用（${error.code}），换一个临时目录后重试 ${attempt}/3…`);
      await removeWithRetry(target).catch(() => {});
      await removeWithRetry(tempDir).catch(() => {});
      await sleep(900);
    }
  }
  for (const output of outputs) {
    const names = fs.readdirSync(output).filter(name => name !== "data");
    fs.writeFileSync(path.join(output, ".deskweek-files.json"), JSON.stringify([...new Set([...names, ".deskweek-files.json"])]));
    console.log(`Built ${output}`);
  }
  await removeWithRetry(tempDir).catch(() => {});
}
build().catch(error => { console.error(error); process.exitCode = 1; });
