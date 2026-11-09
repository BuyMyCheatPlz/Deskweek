"use strict";
const fs = require("node:fs");
const path = require("node:path");

async function build() {
  const { packager } = await import("@electron/packager");
  const root = path.resolve(__dirname, "..");
  const output = path.resolve(root, process.env.DESKWEEK_BUILD_DIR || "dist");
  const dist = path.join(root, "dist");
  if (output !== dist && !output.startsWith(dist + path.sep)) throw new Error("Build output must stay inside dist");
  const outputs = await packager({ dir: root, name: "DeskWeek", platform: "win32", arch: "x64", out: output, overwrite: true,
    asar: { unpack: "**/*.node" }, icon: path.join(root, "assets/icons/app-icon.ico"),
    ignore: [/^\/(?:data|dist|release|test|scripts|\.git|\.github)(?:\/|$)/, /\.(?:log|tmp)$/],
  });
  for (const output of outputs) {
    const names = fs.readdirSync(output).filter(name => name !== "data");
    fs.writeFileSync(path.join(output, ".deskweek-files.json"), JSON.stringify([...new Set([...names, ".deskweek-files.json"])]));
    console.log(`Built ${output}`);
  }
}
build().catch(error => { console.error(error); process.exitCode = 1; });
