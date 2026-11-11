"use strict";

// 帧编解码：4 字节无符号大端长度 + UTF-8 JSON。
// 上限 1 MiB；空帧、超限、非法 JSON 一律拒绝（协议文档 §3）。

const MAX_FRAME = 1024 * 1024;
const HEADER = 4;

function encodeFrame(message) {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  if (payload.length === 0) throw new Error("empty frame");
  if (payload.length > MAX_FRAME) throw new Error("frame too large: " + payload.length);
  const header = Buffer.allocUnsafe(HEADER);
  header.writeUInt32BE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

/** 从缓冲区解出尽可能多的帧，返回已解析消息与剩余字节 */
function decodeFrames(buffer) {
  const messages = [];
  let offset = 0;
  while (buffer.length - offset >= HEADER) {
    const length = buffer.readUInt32BE(offset);
    if (length === 0) throw new Error("empty frame");
    if (length > MAX_FRAME) throw new Error("frame too large: " + length);
    if (buffer.length - offset - HEADER < length) break;
    const body = buffer.subarray(offset + HEADER, offset + HEADER + length);
    let parsed;
    try {
      parsed = JSON.parse(body.toString("utf8"));
    } catch (error) {
      throw new Error("invalid json frame: " + error.message);
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("frame must be a json object");
    }
    messages.push(parsed);
    offset += HEADER + length;
  }
  return { messages, rest: buffer.subarray(offset) };
}

module.exports = { encodeFrame, decodeFrames, MAX_FRAME };
