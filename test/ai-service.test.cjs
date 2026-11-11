"use strict";
// AI 服务回归：模型返回对象或裸数组都要能拆成待办，脏日期/时间不能卡住导入。
const test = require("node:test");
const assert = require("node:assert/strict");
const { createAIService } = require("../src/main/ai/ai-service.cjs");

function service(overrides = {}, apiKey = "test-key") {
  return createAIService({
    publicAIConfig: () => ({ baseUrl: "https://example.test/v1", model: "mock-model", hasKey: true, keyInvalid: false, autoTranslate: false, ...overrides }),
    readUsableAIKey: () => ({ apiKey, keyInvalid: false }),
  });
}

function mockFetch(content, { status = 200, capture } = {}) {
  const original = global.fetch;
  global.fetch = async (url, init) => {
    if (capture) capture(url, init);
    return {
      ok: status >= 200 && status < 300,
      status,
      async text() { return typeof content === "string" ? content : JSON.stringify(content); },
      async json() { return typeof content === "string" ? JSON.parse(content) : content; },
    };
  };
  return () => { global.fetch = original; };
}

function completion(payload) {
  return { choices: [{ message: { role: "assistant", content: typeof payload === "string" ? payload : JSON.stringify(payload) } }] };
}

test("parses the requested object shape", async () => {
  const restore = mockFetch(completion({ items: [{ title: "整理周报", detail: "发布机构：学院", date: "2026-11-12", time: "10:00", defer: "none" }] }));
  try {
    const result = await service().summarizeWithAI({ text: "明天整理周报" });
    assert.deepEqual(result.items, [{ title: "整理周报", detail: "发布机构：学院", date: "2026-11-12", time: "10:00", defer: "none" }]);
  } finally { restore(); }
});

test("accepts a bare JSON array from models that ignore the wrapper", async () => {
  const restore = mockFetch(completion([{ title: "裸数组事项", date: "2026-11-13" }]));
  try {
    const result = await service().summarizeWithAI({ text: "资料" });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].title, "裸数组事项");
    assert.equal(result.items[0].date, "2026-11-13");
  } finally { restore(); }
});

test("accepts a fenced bare array", async () => {
  const restore = mockFetch(completion("```json\n[{\"title\":\"围栏数组\"}]\n```"));
  try {
    const result = await service().summarizeWithAI({ text: "资料" });
    assert.equal(result.items[0].title, "围栏数组");
  } finally { restore(); }
});

test("accepts the tasks alias and a single item object", async () => {
  const restore = mockFetch(completion({ tasks: [{ title: "任务别名" }] }));
  try {
    assert.equal((await service().summarizeWithAI({ text: "资料" })).items[0].title, "任务别名");
  } finally { restore(); }
  const restore2 = mockFetch(completion({ title: "单条对象" }));
  try {
    assert.equal((await service().summarizeWithAI({ text: "资料" })).items[0].title, "单条对象");
  } finally { restore2(); }
});

test("sanitises impossible dates and times instead of blocking the whole import", async () => {
  const restore = mockFetch(completion({ items: [
    { title: "坏日期", date: "2026-02-30", time: "99:99" },
    { title: "有时间没日期", date: "", time: "09:30" },
    { title: "", detail: "只有详情的事项" },
  ] }));
  try {
    const { items } = await service().summarizeWithAI({ text: "资料" });
    assert.equal(items.length, 3);
    assert.equal(items[0].date, "");
    assert.equal(items[0].time, "");
    assert.equal(items[1].date, new Date().getFullYear() + "-" + String(new Date().getMonth() + 1).padStart(2, "0") + "-" + String(new Date().getDate()).padStart(2, "0"));
    assert.equal(items[1].time, "09:30");
    assert.equal(items[2].title, "只有详情的事项");
  } finally { restore(); }
});

test("sends the API key, endpoint and user material", async () => {
  let captured;
  const restore = mockFetch(completion({ items: [{ title: "x" }] }), { capture: (url, init) => { captured = { url, init }; } });
  try {
    await service().summarizeWithAI({ text: "原始资料", extraPrompt: "只要考试" });
    assert.equal(captured.url, "https://example.test/v1/chat/completions");
    assert.equal(captured.init.headers.Authorization, "Bearer test-key");
    const body = JSON.parse(captured.init.body);
    assert.equal(body.model, "mock-model");
    assert.match(body.messages[1].content[0].text, /原始资料/);
    assert.match(body.messages[1].content[0].text, /只要考试/);
  } finally { restore(); }
});

test("reports HTTP failures and invalid JSON as readable errors", async () => {
  const restore = mockFetch("quota exceeded", { status: 429 });
  try {
    await assert.rejects(() => service().summarizeWithAI({ text: "资料" }), /AI 接口请求失败（429）/);
  } finally { restore(); }
  const restore2 = mockFetch(completion("不是 JSON"));
  try {
    await assert.rejects(() => service().summarizeWithAI({ text: "资料" }), /不是有效 JSON/);
  } finally { restore2(); }
});

test("requires a configured key and some material", async () => {
  await assert.rejects(() => service({ hasKey: false }, "").summarizeWithAI({ text: "资料" }), /请先在管理中心配置 AI 接口/);
  await assert.rejects(() => service().summarizeWithAI({}), /先粘贴文字、添加图片或文件/);
});
