"use strict";

// 同步身份与操作签名（P2 切片）。
//
// 固定选择（不得各端自创）：
// - 曲线 P-256（prime256v1 / secp256r1）
// - 签名算法 ECDSA + SHA-256
// - 签名编码 DER（Node 与 JVM 默认一致），传输时 base64
// - 公钥导出 SPKI/DER base64；私钥 PKCS8/DER base64（仅本地保存）
// - 被签名内容 = 规范化 JSON（见 canonical.cjs），签名前移除 signature 字段

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { canonicalize } = require("./canonical.cjs");

const CURVE = "prime256v1";

function generateIdentity() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: CURVE });
  return {
    actorId: crypto.randomUUID(),
    privateKey,
    publicKey,
    publicKeyB64: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
    privateKeyB64: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
  };
}

function loadIdentity(privateKeyB64) {
  const privateKey = crypto.createPrivateKey({
    key: Buffer.from(privateKeyB64, "base64"),
    format: "der",
    type: "pkcs8",
  });
  const publicKey = crypto.createPublicKey(privateKey);
  return {
    actorId: crypto.randomUUID(),
    privateKey,
    publicKey,
    publicKeyB64: publicKey.export({ format: "der", type: "spki" }).toString("base64"),
    privateKeyB64,
  };
}

/** 去掉 signature 后的规范化字节；调用方保证对象里其他字段就是被签内容 */
function signingBytes(value) {
  const clone = { ...value };
  delete clone.signature;
  return Buffer.from(canonicalize(clone), "utf8");
}

function sign(value, privateKey) {
  return crypto.sign("sha256", signingBytes(value), privateKey).toString("base64");
}

function verify(value, publicKeyB64, signatureB64) {
  if (typeof signatureB64 !== "string" || signatureB64.length === 0) return false;
  let publicKey;
  try {
    publicKey = crypto.createPublicKey({
      key: Buffer.from(publicKeyB64, "base64"),
      format: "der",
      type: "spki",
    });
  } catch {
    return false;
  }
  try {
    return crypto.verify("sha256", signingBytes(value), publicKey, Buffer.from(signatureB64, "base64"));
  } catch {
    return false;
  }
}

/** 供服务端保存对端公钥；P2 原型用内存字典 */
class KeyRegistry {
  constructor() {
    this.keys = new Map();
  }
  put(actorId, publicKeyB64) {
    this.keys.set(actorId, publicKeyB64);
  }
  get(actorId) {
    return this.keys.get(actorId);
  }
  verifyOperation(op) {
    const key = this.get(op.actorId);
    if (!key) return false;
    return verify(op, key, op.signature);
  }
}

/** 读取或创建本地身份文件（P2 原型；正式版应放系统凭据存储） */
function loadOrCreateIdentityFile(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "sync-identity.json");
  if (fs.existsSync(file)) {
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    return { ...loadIdentity(saved.privateKeyB64), actorId: saved.actorId };
  }
  const identity = generateIdentity();
  const actorId = crypto.randomUUID();
  fs.writeFileSync(file, JSON.stringify({ actorId, privateKeyB64: identity.privateKeyB64 }, null, 2), { mode: 0o600 });
  return { actorId, ...identity };
}

module.exports = {
  CURVE,
  generateIdentity,
  loadIdentity,
  loadOrCreateIdentityFile,
  signingBytes,
  sign,
  verify,
  KeyRegistry,
};
