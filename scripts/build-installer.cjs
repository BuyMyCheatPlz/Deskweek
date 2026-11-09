"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

async function main() {
  const root = path.resolve(__dirname, "..");
  const dist = path.join(root, "dist");
  const unpackedDir = path.join(dist, "DeskWeek-win32-x64");

  if (!fs.existsSync(path.join(unpackedDir, "DeskWeek.exe"))) {
    console.log("打包目录不存在，正在先执行 npm run package...");
    execFileSync("node", [path.join(root, "scripts/package.cjs")], {
      cwd: root,
      stdio: "inherit",
    });
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const version = pkg.version || "1.3.0";

  let isccPath = path.join(root, "node_modules/innosetup/bin/ISCC.exe");
  if (!fs.existsSync(isccPath)) {
    // 尝试寻找系统全局的 ISCC
    try {
      const which = execFileSync("where.exe", ["ISCC.exe"], { encoding: "utf8" }).trim().split(/\r?\n/)[0];
      if (which && fs.existsSync(which)) isccPath = which;
    } catch {
      throw new Error("未找到 Inno Setup 编译器 ISCC.exe，请先运行 npm install 安装依赖");
    }
  }

  const issPath = path.join(__dirname, "installer.iss");
  console.log(`正在使用 Inno Setup 构建安装程序（版本：v${version}）...`);

  execFileSync(isccPath, [`/DMyAppVersion=${version}`, issPath], {
    cwd: __dirname,
    stdio: "inherit",
  });

  const setupExe = path.join(dist, `DeskWeek-v${version}-windows-x64-Setup.exe`);
  if (fs.existsSync(setupExe)) {
    const stats = fs.statSync(setupExe);
    console.log(`\n构建成功！安装程序已生成:`);
    console.log(`文件路径: ${setupExe}`);
    console.log(`文件大小: ${(stats.size / (1024 * 1024)).toFixed(2)} MB`);
  }
}

main().catch((err) => {
  console.error("构建安装程序失败:", err);
  process.exitCode = 1;
});
