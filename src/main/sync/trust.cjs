"use strict";

// 已配对设备表 + 短认证码（P3 切片）。
// 与 Kotlin 侧 TrustStore.kt 共用同一套 SAS 计算，向量见 test/fixtures/pairing.json。

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function shortAuthString(publicKeyA, publicKeyB) {
  const pair = [publicKeyA, publicKeyB].sort();
  const digest = crypto.createHash("sha256").update(pair[0] + "|" + pair[1], "utf8").digest();
  const value = (digest[0] << 16) | (digest[1] << 8) | digest[2];
  return String(value % 1000000).padStart(6, "0");
}

class TrustStore {
  constructor(dir) {
    this.file = path.join(dir, "trusted-peers.json");
    this.peers = new Map();
    fs.mkdirSync(dir, { recursive: true });
    this.load();
  }

  load() {
    if (!fs.existsSync(this.file)) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, "utf8"));
      for (const peer of parsed.peers || []) this.peers.set(peer.actorId, peer);
    } catch {
      this.peers.clear();
    }
  }

  persist() {
    fs.writeFileSync(this.file, JSON.stringify({ peers: [...this.peers.values()] }, null, 2));
  }

  all() {
    return [...this.peers.values()];
  }

  get(actorId) {
    return this.peers.get(actorId);
  }

  isTrusted(actorId, publicKeyB64) {
    const peer = this.peers.get(actorId);
    return Boolean(peer) && peer.publicKeyB64 === publicKeyB64;
  }

  remember(peer) {
    this.peers.set(peer.actorId, peer);
    this.persist();
  }

  forget(actorId) {
    this.peers.delete(actorId);
    this.persist();
  }
}

module.exports = { TrustStore, shortAuthString };
