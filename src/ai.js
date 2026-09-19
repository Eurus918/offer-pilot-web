/**
 * AI 层：统一封装 DeepSeek 调用。
 * 所有 prompt 走这里，便于统一超时、重试、错误映射。
 */
import { DEEPSEEK_URL, KNOWN_MODELS, DEFAULT_MODEL } from "./config.js";
import { AppError } from "./errors.js";

const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS) || 120000; // 默认 2 分钟
const MAX_RETRY = 1; // 只对网络类错误重试一次

function currentModel(getModel) {
  const model = getModel();
  if (!KNOWN_MODELS.has(model)) {
    console.warn(`[ai] 模型名 "${model}" 不在已知列表中，回退到 ${DEFAULT_MODEL}`);
    return DEFAULT_MODEL;
  }
  return model;
}

/**
 * 调用 DeepSeek。
 * @param {object} o
 * @param {string} o.system   系统提示词
 * @param {string} o.user     用户消息文本
 * @param {string[]} o.images data URL 或 http(s) 图片地址
 * @param {boolean} o.json    是否要求返回 JSON 对象
 * @param {Array}   o.history 历史消息 [{role, content}]
 * @param {Function} o.getKey / o.getModel 由调用方注入（依赖 store）
 */
export async function dsChat({ system, user, images = [], json = false, history = [], getKey, getModel }) {
  const key = getKey();
  if (!key) {
    throw new AppError("NO_KEY", 400, "NO_KEY");
  }
  const model = currentModel(getModel);

  const content = [];
  if (user) content.push({ type: "text", text: user });
  for (const img of images) {
    content.push({ type: "image_url", image_url: { url: img } });
  }

  const messages = [{ role: "system", content: system }];
  for (const h of history) {
    if (h && h.role && h.content) messages.push({ role: h.role, content: h.content });
  }
  messages.push({ role: "user", content: content.length ? content : user || "" });

  const body = { model, messages, temperature: 0.7 };
  if (json) body.response_format = { type: "json_object" };

  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRY; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      const resp = await fetch(DEEPSEEK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
      if (!resp.ok) {
        const t = await resp.text();
        const e = new Error("DEEPSEEK_ERR:" + resp.status + " " + t.slice(0, 300));
        // 4xx 是请求本身的问题，重试没意义
        if (resp.status >= 400 && resp.status < 500) throw e;
        lastErr = e;
        continue;
      }
      const data = await resp.json();
      return data.choices?.[0]?.message?.content ?? "";
    } catch (e) {
      if (e.name === "AbortError") {
        throw new Error("AI_TIMEOUT");
      }
      if (e.message && e.message.startsWith("DEEPSEEK_ERR")) throw e;
      lastErr = e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr || new Error("调用 AI 失败");
}

/**
 * 要求模型返回 JSON，并容错解析。
 * 模型偶尔会在 JSON 外面包一层 ```json 代码块，这里统一处理掉。
 */
export async function dsJson(opts, fallback = null) {
  const raw = await dsChat({ ...opts, json: true });
  const parsed = parseJsonLoose(raw);
  if (parsed === null) {
    if (fallback !== null) return fallback;
    throw new AppError("AI 返回的内容不是合法 JSON，请重试一次", 502, "BAD_AI_JSON");
  }
  return parsed;
}

export function parseJsonLoose(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  // 去掉 ```json ... ``` 包裹
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) s = fence[1].trim();
  try {
    return JSON.parse(s);
  } catch {
    // 尝试截取第一个 { 到最后一个 }
    const a = s.indexOf("{");
    const b = s.lastIndexOf("}");
    if (a >= 0 && b > a) {
      try {
        return JSON.parse(s.slice(a, b + 1));
      } catch { /* 落到下面返回 null */ }
    }
    return null;
  }
}
