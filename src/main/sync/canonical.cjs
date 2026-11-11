"use strict";

// 同步协议的规范化 JSON（JCS 子集）。
// 用于签名与跨语言一致性；Kotlin 侧必须产出逐字节相同的结果。
//
// 规则：
// - 对象键按 UTF-16 码元升序，无空白分隔符
// - 仅允许安全整数（拒绝小数、NaN、Infinity、-0）
// - 字符串只转义 " \ 与 C0 控制字符；非 ASCII 原样输出（UTF-8）
// - 拒绝未配对代理项，避免 JS 与 JVM 的 UTF-8 编码结果不同
// - 不支持 toJSON、undefined、Buffer、Date 等隐式转换

const SHORT = { 0x08: "\\b", 0x09: "\\t", 0x0a: "\\n", 0x0c: "\\f", 0x0d: "\\r" };

function quote(text) {
  let out = '"';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 0x22) out += '\\"';
    else if (code === 0x5c) out += "\\\\";
    else if (SHORT[code]) out += SHORT[code];
    else if (code < 0x20) out += "\\u" + code.toString(16).padStart(4, "0");
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new TypeError("unpaired high surrogate at " + i);
      out += text[i] + text[i + 1];
      i++;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new TypeError("unpaired low surrogate at " + i);
    } else out += text[i];
  }
  return out + '"';
}

function serialize(value) {
  if (value === null) return "null";
  const type = typeof value;
  if (type === "boolean") return value ? "true" : "false";
  if (type === "number") {
    if (!Number.isSafeInteger(value)) throw new TypeError("only safe integers are canonical: " + value);
    if (Object.is(value, -0)) throw new TypeError("negative zero is not canonical");
    return String(value);
  }
  if (type === "string") return quote(value);
  if (Array.isArray(value)) return "[" + value.map(serialize).join(",") + "]";
  if (type === "object") {
    if (Buffer.isBuffer(value) || value instanceof Date) throw new TypeError("unsupported object type");
    const keys = Object.keys(value);
    if (keys.length === 0) return "{}";
    keys.sort();
    const parts = [];
    for (const key of keys) {
      const child = value[key];
      if (child === undefined) throw new TypeError("undefined value at key: " + key);
      parts.push(quote(key) + ":" + serialize(child));
    }
    return "{" + parts.join(",") + "}";
  }
  throw new TypeError("unsupported type: " + type);
}

function canonicalize(value) {
  return serialize(value);
}

module.exports = { canonicalize };
