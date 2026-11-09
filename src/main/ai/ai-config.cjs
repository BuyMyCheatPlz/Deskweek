"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { writeAtomic } = require("../storage/store.cjs");
function createAIConfig({ portableDataDir, safeStorage }) {
  const DEFAULT_AI_CONFIG = {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
  };

  function aiConfigFile() {
    return path.join(portableDataDir(), "ai-config.json");
  }

  function aiConfigBackupFile() {
    return path.join(portableDataDir(), "ai-config.backup.json");
  }

  function aiKeyFile() {
    return path.join(portableDataDir(), "ai-key.dat");
  }

  function aiKeyBackupFile() {
    return path.join(portableDataDir(), "ai-key.backup.dat");
  }

  function readTextFile(file) {
    try {
      return fs.readFileSync(file, "utf8").trim();
    } catch {
      return "";
    }
  }

  function writeTextFileAtomic(file, value) { writeAtomic(file, String(value)); }

  function readAIConfigFile() {
    for (const file of [aiConfigFile(), aiConfigBackupFile()]) {
      try {
        const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
        if (parsed && typeof parsed === "object") return parsed;
      } catch { /* try the backup */ }
    }
    return {};
  }

  function readEncryptedAIKeyCandidates() {
    const legacy = readAIConfigFile().keyEncrypted;
    const candidates = [readTextFile(aiKeyFile()), readTextFile(aiKeyBackupFile()), typeof legacy === "string" ? legacy.trim() : ""];
    return [...new Set(candidates.filter(Boolean))];
  }

  function decryptAIKey(config) {
    if (!config?.keyEncrypted) return "";
    if (!safeStorage.isEncryptionAvailable()) throw new Error("当前系统无法读取 API Key，请在设置中重新填写");
    try {
      const value = safeStorage.decryptString(Buffer.from(config.keyEncrypted, "base64"));
      if (!value) throw new Error("empty key");
      return value;
    } catch {
      throw new Error("AI 密钥已失效，请在设置中重新填写 API Key");
    }
  }

  function readUsableAIKey() {
    const candidates = readEncryptedAIKeyCandidates();
    if (!candidates.length) return { apiKey: "", keyEncrypted: "", keyInvalid: false };
    if (!safeStorage.isEncryptionAvailable()) return { apiKey: "", keyEncrypted: candidates[0], keyInvalid: true };
    for (const keyEncrypted of candidates) {
      try {
        const apiKey = decryptAIKey({ keyEncrypted });
        if (apiKey) {
          if (readTextFile(aiKeyFile()) !== keyEncrypted) writeEncryptedAIKey(keyEncrypted);
          return { apiKey, keyEncrypted, keyInvalid: false };
        }
      } catch { /* try the backup key */ }
    }
    return { apiKey: "", keyEncrypted: candidates[0], keyInvalid: true };
  }

  function writeEncryptedAIKey(keyEncrypted) {
    if (!keyEncrypted) return;
    const existing = readTextFile(aiKeyFile());
    if (existing && existing !== keyEncrypted) {
      try {
        decryptAIKey({ keyEncrypted: existing });
        writeTextFileAtomic(aiKeyBackupFile(), existing);
      } catch { /* do not overwrite a valid backup with a broken key */ }
    }
    writeTextFileAtomic(aiKeyFile(), keyEncrypted);
  }

  function clearEncryptedAIKey() {
    for (const file of [aiKeyFile(), aiKeyBackupFile()]) {
      try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch { /* best effort */ }
    }
  }

  function publicAIConfig() {
    const config = readAIConfigFile();
    const keyState = readUsableAIKey();
    return {
      baseUrl: typeof config.baseUrl === "string" && config.baseUrl.trim() ? config.baseUrl.trim() : DEFAULT_AI_CONFIG.baseUrl,
      model: typeof config.model === "string" && config.model.trim() ? config.model.trim() : DEFAULT_AI_CONFIG.model,
      hasKey: Boolean(keyState.apiKey),
      keyInvalid: keyState.keyInvalid,
      autoTranslate: Boolean(config.autoTranslate),
    };
  }

  function writeAIConfig(config) {
    const file = aiConfigFile();
    if (fs.existsSync(file)) {
      try { fs.copyFileSync(file, aiConfigBackupFile()); } catch { /* best effort */ }
    }
    writeTextFileAtomic(file, JSON.stringify(config));
  }

  function saveAIConfig(next = {}) {
    readUsableAIKey();
    const current = readAIConfigFile();
    const baseUrl = String(next.baseUrl || DEFAULT_AI_CONFIG.baseUrl).trim().replace(/\/+$/, "");
    let parsed;
    try { parsed = new URL(baseUrl); } catch { throw new Error("接口地址格式不正确"); }
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("接口地址必须是 http 或 https");
    const model = String(next.model || DEFAULT_AI_CONFIG.model).trim();
    if (!model) throw new Error("请填写模型名称");
    if (next.clearKey) {
      clearEncryptedAIKey();
    } else if (String(next.apiKey || "").trim()) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error("当前系统无法安全保存 API Key");
      writeEncryptedAIKey(safeStorage.encryptString(String(next.apiKey).trim()).toString("base64"));
    }
    const autoTranslate = typeof next.autoTranslate === "boolean" ? next.autoTranslate : Boolean(current.autoTranslate);
    writeAIConfig({ baseUrl, model, autoTranslate, updatedAt: new Date().toISOString() });
    if (next.clearKey) {
      try { fs.copyFileSync(aiConfigFile(), aiConfigBackupFile()); } catch { /* best effort */ }
    }
    return publicAIConfig();
  }


  return { publicAIConfig, saveAIConfig, readUsableAIKey };
}
module.exports = { createAIConfig };
