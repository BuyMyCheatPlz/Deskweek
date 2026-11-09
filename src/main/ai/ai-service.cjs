"use strict";
const { extractDocuments } = require("./documents.cjs");
const AI_FILE_MAX_COUNT = 5;
function createAIService({ publicAIConfig, readUsableAIKey }) {
  function localDateKey(date = new Date()) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function validDateKey(value) {
    const text = String(value || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
    const [year, month, day] = text.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  }

  function parseAIJson(content) {
    const text = String(content || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("AI 返回内容不是有效 JSON");
    return JSON.parse(text.slice(start, end + 1));
  }

  async function summarizeWithAI(payload = {}) {
    const publicConfig = publicAIConfig();
    if (publicConfig.keyInvalid) throw new Error("AI 密钥已失效，请在设置中重新填写 API Key");
    const apiKey = readUsableAIKey().apiKey;
    if (!apiKey) throw new Error("请先在管理中心配置 AI 接口");
    const sourceText = String(payload.text || "").trim();
    const extraPrompt = String(payload.extraPrompt || "").trim().slice(0, 4000);
    const images = Array.isArray(payload.images) ? payload.images.slice(0, 4) : [];
    const files = Array.isArray(payload.files) ? payload.files.slice(0, AI_FILE_MAX_COUNT) : [];
    if (!sourceText && !images.length && !files.length) throw new Error("先粘贴文字、添加图片或文件");
    for (const image of images) {
      if (typeof image !== "string" || !/^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(image)) throw new Error("图片格式不支持");
      if (image.length > 9_000_000) throw new Error("单张图片不能超过 6MB");
    }
    const fileSections = await extractDocuments(files);
    const fileText = fileSections.join("\n\n---\n\n");
    if (!sourceText && !images.length && !fileText) throw new Error("没有读取到可总结的内容");
    const baseUrl = publicConfig.baseUrl.replace(/\/+$/, "");
    const endpoint = baseUrl.endsWith("/chat/completions") ? baseUrl : `${baseUrl}/chat/completions`;
    const today = localDateKey();
    const isChineseOutput = publicConfig.autoTranslate;
    const firstPromptLine = isChineseOutput
      ? "你是 DeskWeek 的任务整理助手。请从用户提供的邮件、通知、聊天文字、图片或文件中提取待办事项。若用户给出的内容不是中文，则先翻译成中文，再进行总结，其中所有的人名保留原文，地名、专有名词和专业性名词等以类似apple（苹果）的形式给出。"
      : "你是 DeskWeek 的任务整理助手。请从用户提供的邮件、通知、聊天文字、图片或文件中提取待办事项。保留用户原文的主要语言，不要自行翻译。";
    const titleRule = isChineseOutput
      ? "title：使用中文，不超过 30 个汉字，直接说明要做什么，不要照抄整段原文。"
      : "title：保留原文主要语言，直接说明要做什么，保持简短，不要翻译，不要照抄整段原文。";
    const detailRule = isChineseOutput
      ? "detail：只保留会直接影响执行的重要、明确信息，删掉寒暄、重复和无关内容。每项信息单独一行，统一写成“字段：内容”；字段名按内容命名，例如发布机构、客户公式、官网、文件格式、截止时间、地点、提交方式、注意事项。没有的字段不要输出，不要把多项信息挤成一段，也不要编造。JSON 字符串内用 \\n 表示换行。"
      : "detail：只保留会直接影响执行的重要、明确信息，删掉寒暄、重复和无关内容。每项信息单独一行，统一写成“字段：内容”；字段名和内容都保留原文主要语言，不要翻译；字段名按内容命名。没有的字段不要输出，不要把多项信息挤成一段，也不要编造。JSON 字符串内用 \\n 表示换行。";
    const detailExample = isChineseOutput
      ? 'detail 示例："发布机构：…\\n客户公式：…\\n官网：…\\n文件格式：…"'
      : 'detail 示例（仅表示格式，字段名和内容使用原文语言）："<field>: <value>\\n<field>: <value>"';
    const groupingRules = [
      "items：先判断资料的整体目的，输出最小必要的事项数。一封邮件、一条通知或一段聊天记录通常只对应 1 个事项。",
      "同一目标下的报名、填写信息、上传平台、发送材料、通知同学、准备 PPT、满足积分条件、命名格式等步骤必须合并为一项，把步骤写进 detail。例如比赛报名通知里的报名、上传、提交材料、截止时间和积分说明属于同一项，不能拆成多项。",
      "只有目标不同，并且行动或截止时间明显独立时才拆分。不要因为原文出现多个动词、多个网址、多个要求或建议就拆成多个事项。",
      "条件、奖励、后果、建议、参考材料和操作说明都属于 detail，不能单独成为事项。能合并就合并，宁少勿碎。",
      extraPrompt ? "先执行用户的筛选要求，再对保留下来的内容按上述规则合并，只输出筛选后必要的独立事项。" : "",
    ];
    const systemPrompt = [
      firstPromptLine,
      "只输出一个合法 JSON 对象，不要 Markdown、代码块或额外解释。",
      'JSON 格式：{"items":[{"title":"主标题","detail":"详细信息","date":"YYYY-MM-DD或空字符串","time":"HH:mm或空字符串","defer":"none|7d|1m或Nd"}]}',
      extraPrompt ? "用户提供了额外要求。必须优先执行额外要求；如果要求按班级、人员、范围、日期或类型筛选，只输出符合条件的任务，不要输出被排除的任务。" : "",
      ...groupingRules,
      titleRule,
      detailRule,
      detailExample,
      "date 和 time：只填该项任务在原文中明确给出的值；只有时间没有日期时 date 留空；无法确定的相对日期不要猜；两者都没有时都为空。",
      "defer：没有明确要求时固定填 none。",
    ].filter(Boolean).join("\n");
    const userParts = [];
    if (sourceText) userParts.push(sourceText);
    if (fileText) userParts.push(`以下是用户提供的文件内容：\n${fileText}`);
    if (extraPrompt) userParts.push(`以下是用户的额外要求，必须优先遵守：\n${extraPrompt}`);
    const content = [{ type: "text", text: userParts.join("\n\n") || "请整理图片中的任务信息。" }];
    images.forEach((url) => content.push({ type: "image_url", image_url: { url } }));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: publicConfig.model,
          temperature: 0.1,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content },
          ],
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const errorText = (await response.text()).slice(0, 600).replace(/\s+/g, " ").trim();
        throw new Error(`AI 接口请求失败（${response.status}）${errorText ? "：" + errorText : ""}`);
      }
      const data = await response.json();
      const raw = data?.choices?.[0]?.message?.content;
      const text = Array.isArray(raw) ? raw.map((part) => part?.text || "").join("") : raw;
      const result = parseAIJson(text);
      const rawItems = Array.isArray(result?.items) ? result.items : (result?.title || result?.detail ? [result] : []);
      const items = rawItems.slice(0, 20).map((entry) => {
        const title = String(entry?.title || "").trim().slice(0, 100);
        const detail = String(entry?.detail || "").trim().slice(0, 4000);
        if (!title && !detail) return null;
        let date = validDateKey(entry?.date) ? entry.date : "";
        let time = /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(entry?.time || "")) ? String(entry.time) : "";
        if (time && !date) date = today;
        const deferText = String(entry?.defer || "none").toLowerCase();
        const defer = deferText === "1m" || /^[1-9]\d*d$/.test(deferText) ? deferText : "none";
        return { title: title || detail.slice(0, 30), detail, date, time, defer };
      }).filter(Boolean);
      if (!items.length) throw new Error("AI 没有从资料中提取到待办事项");
      return { items };
    } catch (error) {
      if (error?.name === "AbortError") throw new Error("AI 请求超时");
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }


  return { summarizeWithAI };
}
module.exports = { createAIService };
