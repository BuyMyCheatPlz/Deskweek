"use strict";

// 协议消息校验（protocolVersion 1）。
// 只做结构与类型校验，不含签名验证与业务语义；两者在 P2 落地。

const VERSION = 1;
const MAX_TEXT = 4096;
const MAX_ID = 128;
const MAX_OPS = 100;
const KINDS = new Set(["create", "patch", "trash", "restore", "purge", "resolve"]);
const TYPES = new Set(["HELLO", "SUMMARY", "WANT", "OPS", "ACK", "CHANGED", "PING", "PONG", "ERROR"]);

class ProtocolError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function fail(code, message) {
  throw new ProtocolError(code, message);
}

function id(value, field) {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_ID) fail("ECONTRACT", field + " must be a non-empty id");
  return value;
}

function seq(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) fail("ECONTRACT", field + " must be a non-negative safe integer");
  return value;
}

function text(value, field, max = MAX_TEXT) {
  if (typeof value !== "string" || value.length > max) fail("ECONTRACT", field + " must be a string <= " + max);
  return value;
}

function vectors(value, field) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail("ECONTRACT", field + " must be an object");
  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    id(key, field + " key");
    out[key] = seq(raw, field + "." + key);
  }
  return out;
}

function validateOp(op) {
  if (op === null || typeof op !== "object" || Array.isArray(op)) fail("ECONTRACT", "op must be an object");
  const { opId, actorId, seq: opSeq, groupId, taskId, kind, changes, context, recordedAt, signature } = op;

  id(actorId, "op.actorId");
  seq(opSeq, "op.seq");
  if (opSeq < 1) fail("ECONTRACT", "op.seq starts at 1");
  if (opId !== actorId + ":" + opSeq) fail("ECONTRACT", "op.opId must be actorId:seq");
  id(groupId, "op.groupId");
  id(taskId, "op.taskId");
  if (!KINDS.has(kind)) fail("ECONTRACT", "op.kind unsupported: " + kind);

  if (changes === null || typeof changes !== "object" || Array.isArray(changes)) fail("ECONTRACT", "op.changes must be an object");
  for (const [field, val] of Object.entries(changes)) {
    if (["title", "detail", "date", "time", "defer", "completedAt", "deletedAt"].includes(field)) text(val, "op.changes." + field);
    else if (["done", "deleted"].includes(field)) {
      if (typeof val !== "boolean") fail("ECONTRACT", "op.changes." + field + " must be boolean");
    } else fail("ECONTRACT", "op.changes unknown field: " + field);
  }

  vectors(context, "op.context");
  if (typeof recordedAt !== "string" || Number.isNaN(Date.parse(recordedAt))) fail("ECONTRACT", "op.recordedAt must be an ISO timestamp");
  text(signature, "op.signature");
  return op;
}

function validate(message) {
  if (message === null || typeof message !== "object" || Array.isArray(message)) fail("ECONTRACT", "message must be an object");
  if (!TYPES.has(message.type)) fail("ECONTRACT", "unknown message type: " + message.type);
  if (message.protocolVersion !== VERSION) fail("EPROTO", "unsupported protocolVersion: " + message.protocolVersion);

  switch (message.type) {
    case "HELLO":
      id(message.groupId, "groupId");
      id(message.actorId, "actorId");
      text(message.nonce, "nonce", 256);
      if (!Array.isArray(message.capabilities)) fail("ECONTRACT", "capabilities must be an array");
      break;
    case "SUMMARY":
    case "ACK":
      vectors(message.vectors, "vectors");
      break;
    case "WANT":
      id(message.actorId, "actorId");
      seq(message.from, "from");
      seq(message.to, "to");
      if (message.to < message.from) fail("ECONTRACT", "to must be >= from");
      break;
    case "OPS": {
      if (!Array.isArray(message.ops) || message.ops.length === 0) fail("ECONTRACT", "ops must be a non-empty array");
      if (message.ops.length > MAX_OPS) fail("ECONTRACT", "ops batch exceeds " + MAX_OPS);
      message.ops.forEach(validateOp);
      break;
    }
    case "CHANGED":
      vectors(message.upto, "upto");
      break;
    case "PING":
    case "PONG":
      text(message.nonce, "nonce", 256);
      break;
    case "ERROR":
      text(message.code, "code", 64);
      text(message.message, "message");
      break;
  }
  return message;
}

module.exports = { validate, validateOp, ProtocolError, VERSION, MAX_OPS, KINDS, TYPES };
