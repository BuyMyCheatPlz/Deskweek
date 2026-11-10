"use strict";

// 本地 OpenAI 兼容 mock，仅用于验证 Android AI 客户端的真实 HTTP 路径。
// 用法：node scripts/mock-openai.cjs [port]

const http = require("node:http");

const port = Number(process.argv[2] || 47900);

const drafts = [
  { title: "整理周报", date: "2026-11-12", time: "10:00" },
  { title: "评审同步协议", date: "2026-11-13", time: "" },
  { title: "备份发布签名", date: "", time: "" },
];

const server = http.createServer((req, res) => {
  if (req.method !== "POST" || !req.url.includes("/chat/completions")) {
    res.writeHead(404).end("{}");
    return;
  }
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    const auth = req.headers.authorization || "";
    console.log("REQ", req.url, "auth=" + (auth ? "present" : "missing"), "bytes=" + body.length);
    if (!auth.startsWith("Bearer ")) {
      res.writeHead(401, { "Content-Type": "application/json" }).end('{"error":"missing key"}');
      return;
    }
    const payload = {
      choices: [{ message: { role: "assistant", content: JSON.stringify(drafts) } }],
    };
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(payload));
    console.log("SENT", drafts.length + " drafts");
  });
});

server.listen(port, "0.0.0.0", () => console.log(`mock openai listening on 0.0.0.0:${port}`));
