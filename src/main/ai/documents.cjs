"use strict";
const { Worker } = require("node:worker_threads");
const path = require("node:path");
let busy = false;
async function extractDocuments(files) {
  if (!files?.length) return [];
  if (busy) throw new Error("正在处理其他文件，请稍后重试");
  busy = true;
  try {
    return await new Promise((resolve, reject) => {
      const worker = new Worker(path.join(__dirname, "document-worker.cjs"), { workerData: files, resourceLimits: { maxOldGenerationSizeMb: 192 } });
      let settled = false;
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        worker.terminate().finally(() => error ? reject(error) : resolve(result));
      };
      const timeout = setTimeout(() => finish(new Error("文件解析超时")), 30000);
      worker.once("message", message => finish(message.error ? new Error(message.error) : null, message.result));
      worker.once("error", error => finish(error));
      worker.once("exit", () => { if (!settled) finish(new Error("文件解析进程已退出")); });
    });
  } finally { busy = false; }
}
module.exports = { extractDocuments };
