"use strict";

// P0 互通原型服务端：监听 0.0.0.0:47821，供 Android 模拟器通过 10.0.2.2 连接。
// 用法：node scripts/serve-p0.cjs [port]
// 仅用于验证 TLS + 帧协议，不承载真实数据。

const { createServer, listen } = require("../src/main/sync/p0-server.cjs");

const port = Number(process.argv[2] || 47821);

const server = createServer({
  log: (event, detail) => {
    const time = new Date().toISOString().slice(11, 19);
    console.log(`${time} ${event}${detail ? " " + detail : ""}`);
  },
});

listen(server, { port, host: "0.0.0.0" })
  .then((actual) => console.log(`P0 sync server listening on 0.0.0.0:${actual}`))
  .catch((error) => {
    console.error("failed to listen:", error.message);
    process.exit(1);
  });

process.on("SIGINT", () => server.close(() => process.exit(0)));
