"use strict";

// 生成配对短认证码（SAS）走查向量。
// SAS = SHA-256(sorted(pubA, pubB).join("|")) 前 3 字节 % 1000000，6 位补零。
// 用法：node scripts/gen-pairing-fixture.cjs > test/fixtures/pairing.json

const { generateIdentity } = require("../src/main/sync/identity.cjs");
const { shortAuthString } = require("../src/main/sync/trust.cjs");

const vectors = [];
for (let i = 0; i < 5; i++) {
  const a = generateIdentity();
  const b = generateIdentity();
  vectors.push({
    a: a.publicKeyB64,
    b: b.publicKeyB64,
    sas: shortAuthString(a.publicKeyB64, b.publicKeyB64),
  });
}

process.stdout.write(JSON.stringify({ version: 1, vectors }, null, 2) + "\n");
