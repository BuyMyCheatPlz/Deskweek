"use strict";
const path = require("node:path");
const AI_FILE_MAX_COUNT = 5;
const AI_FILE_MAX_BYTES = 20 * 1024 * 1024;
const AI_FILE_MAX_CHARS = 60_000;
const AI_FILE_TOTAL_CHARS = 120_000;
const AI_TEXT_EXTENSIONS = new Set([".txt", ".md", ".markdown", ".json", ".xml", ".yaml", ".yml", ".log"]);
const AI_WORKBOOK_EXTENSIONS = new Set([".xlsx", ".xls", ".xlsm", ".ods", ".csv"]);
const AI_SUPPORTED_EXTENSIONS = new Set([".pdf", ".doc", ".docx", ".pptx", ".odt", ".rtf", ...AI_TEXT_EXTENSIONS, ...AI_WORKBOOK_EXTENSIONS]);

function decodeDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:([^;,]*)(;base64)?,([\s\S]*)$/i);
  if (!match || !match[2]) throw new Error("文件内容格式不正确");
  return Buffer.from(match[3], "base64");
}

function decodeXmlEntities(text) {
  return String(text || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)));
}

function bufferToText(buffer) {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) return buffer.subarray(2).toString("utf16le");
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const copy = Buffer.from(buffer.subarray(2));
    copy.swap16();
    return copy.toString("utf16le");
  }
  return buffer.toString("utf8");
}

function normalizeDocumentText(text) {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

async function extractPptxText(buffer) {
  const zip = await require("jszip").loadAsync(buffer);
  const slides = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort((a, b) => Number(a.match(/slide(\d+)/i)?.[1] || 0) - Number(b.match(/slide(\d+)/i)?.[1] || 0));
  const parts = [];
  for (const name of slides) {
    const xml = await zip.file(name).async("string");
    const texts = [...xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/gi)].map((match) => decodeXmlEntities(match[1]).trim()).filter(Boolean);
    if (texts.length) parts.push(`第 ${parts.length + 1} 页\n${texts.join("\n")}`);
  }
  return parts.join("\n\n");
}

async function extractOdtText(buffer) {
  const zip = await require("jszip").loadAsync(buffer);
  const file = zip.file("content.xml");
  if (!file) return "";
  const xml = await file.async("string");
  return decodeXmlEntities(xml.replace(/<text:(?:p|h)[^>]*>/gi, "\n").replace(/<[^>]+>/g, " "));
}

function extractRtfText(buffer) {
  return bufferToText(buffer)
    .replace(/\\'[0-9a-f]{2}/gi, " ")
    .replace(/\\[a-z]+-?\d* ?/gi, " ")
    .replace(/[{}]/g, " ");
}

async function extractDocumentFile(file) {
  const name = String(file?.name || "未命名文件").trim().slice(0, 180);
  const ext = path.extname(name).toLowerCase();
  if (!AI_SUPPORTED_EXTENSIONS.has(ext)) throw new Error(`暂不支持 ${ext || "该"} 文件格式`);
  if (String(file?.dataUrl || "").length > 29_000_000) throw new Error("文件不能超过 20MB");
  const buffer = decodeDataUrl(file?.dataUrl);
  if (!buffer.length) throw new Error("文件是空的");
  if (buffer.length > AI_FILE_MAX_BYTES) throw new Error("文件不能超过 20MB");
  let text = "";
  if (ext === ".pdf") {
    const result = await require("pdf-parse")(buffer);
    text = result?.text || "";
  } else if (ext === ".docx") {
    const result = await require("mammoth").extractRawText({ buffer });
    text = result?.value || "";
  } else if (ext === ".doc") {
    const extractor = new (require("word-extractor"))();
    const document = await extractor.extract(buffer);
    text = document?.getBody?.() || document?.getText?.() || "";
  } else if (AI_WORKBOOK_EXTENSIONS.has(ext)) {
    const workbook = require("xlsx").read(buffer, { type: "buffer", cellDates: false, raw: false });
    text = workbook.SheetNames.map((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      return `工作表：${sheetName}\n${require("xlsx").utils.sheet_to_csv(sheet, { blankrows: false })}`;
    }).join("\n\n");
  } else if (ext === ".pptx") {
    text = await extractPptxText(buffer);
  } else if (ext === ".odt") {
    text = await extractOdtText(buffer);
  } else if (ext === ".rtf") {
    text = extractRtfText(buffer);
  } else if (AI_TEXT_EXTENSIONS.has(ext)) {
    text = bufferToText(buffer);
  }
  const normalized = normalizeDocumentText(text);
  if (!normalized) {
    const hint = ext === ".pdf" ? "；如果是扫描版 PDF，请把页面截图作为图片添加" : "";
    throw new Error(`没有提取到文字${hint}`);
  }
  const clipped = normalized.slice(0, AI_FILE_MAX_CHARS);
  return { name, text: clipped, truncated: normalized.length > clipped.length };
}

async function extractDocumentFiles(files) {
  const accepted = Array.isArray(files) ? files.slice(0, AI_FILE_MAX_COUNT) : [];
  const sections = [];
  let totalChars = 0;
  for (const file of accepted) {
    let extracted;
    try {
      extracted = await extractDocumentFile(file);
    } catch (error) {
      throw new Error(`文件“${String(file?.name || "未命名文件")}”读取失败：${error.message}`);
    }
    const remaining = Math.max(0, AI_FILE_TOTAL_CHARS - totalChars);
    const text = extracted.text.slice(0, remaining);
    if (!text) break;
    totalChars += text.length;
    const truncated = extracted.truncated || text.length < extracted.text.length || totalChars >= AI_FILE_TOTAL_CHARS;
    sections.push(`文件：${extracted.name}${truncated ? "（内容过长，已截取前部）" : ""}\n${text}`);
    if (totalChars >= AI_FILE_TOTAL_CHARS) break;
  }
  return sections;
}


module.exports = { extractDocumentFiles };
