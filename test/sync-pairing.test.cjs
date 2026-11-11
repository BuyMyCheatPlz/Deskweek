"use strict";

// 配对：SAS 跨语言一致 + 信任表语义。

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { TrustStore, shortAuthString } = require("../src/main/sync/trust.cjs");

const FIXTURE = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures", "pairing.json"), "utf8"),
);

test("short auth string matches the committed vectors", () => {
  assert.equal(FIXTURE.vectors.length, 5);
  for (const vector of FIXTURE.vectors) {
    assert.equal(shortAuthString(vector.a, vector.b), vector.sas);
    assert.equal(shortAuthString(vector.b, vector.a), vector.sas, "must be symmetric");
  }
});

test("short auth string is six digits", () => {
  const sas = shortAuthString("AAA", "BBB");
  assert.match(sas, /^\d{6}$/);
});

test("trust store remembers peers and rejects a changed key", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trust-"));
  const store = new TrustStore(dir);

  assert.equal(store.isTrusted("peer-1", "key-a"), false);
  store.remember({ actorId: "peer-1", publicKeyB64: "key-a", groupId: "g", pairedAt: "now", sas: "123456" });
  assert.equal(store.isTrusted("peer-1", "key-a"), true);
  assert.equal(store.isTrusted("peer-1", "key-b"), false);
});

test("trust store persists and forgets", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trust-persist-"));
  new TrustStore(dir).remember({
    actorId: "peer-2", publicKeyB64: "key-c", groupId: "g", pairedAt: "now", sas: "654321",
  });

  const reloaded = new TrustStore(dir);
  assert.equal(reloaded.all().length, 1);
  assert.equal(reloaded.isTrusted("peer-2", "key-c"), true);

  reloaded.forget("peer-2");
  assert.equal(new TrustStore(dir).all().length, 0);
});

test("trust store recovers from a corrupted file", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trust-bad-"));
  fs.writeFileSync(path.join(dir, "trusted-peers.json"), "{not json");
  const store = new TrustStore(dir);
  assert.equal(store.all().length, 0);
  store.remember({ actorId: "peer-3", publicKeyB64: "key-d", groupId: "g", pairedAt: "now", sas: "000000" });
  assert.equal(new TrustStore(dir).all().length, 1);
});
