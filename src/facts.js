/**
 * 个人偏好词条：长度规范化。
 *
 * 「沉淀中的个人偏好」是一面标签墙，不是文本框。词条必须短，才扫得清、才像"档案"。
 * 硬约束：单条词条 key + value 合计 ≤ 10 字（key ≤ 4 字、value ≤ 8 字）。
 *
 * 超长的原文不丢——压下来的部分存进 detail 字段，前端鼠标悬停可见，
 * 注入 AI 时也仍然使用压缩后的短语（短词条本身就是更好的记忆单元）。
 */

/** 单条词条 key + value 的合计字数上限 */
export const FACT_TOTAL_MAX = 10;
/** 维度名长度上限 */
export const FACT_KEY_MAX = 4;
/** 内容长度上限 */
export const FACT_VALUE_MAX = 8;

/** 按"字"截断：中文一个字算一个，英文一个字母算一个，顺手压掉空白 */
export function cutChars(s, n) {
  const chars = [...String(s ?? "").replace(/\s+/g, "")];
  return chars.slice(0, Math.max(0, n)).join("");
}

/** 字长（同 cutChars 的口径），用于判断是否超限 */
export function charLen(s) {
  return [...String(s ?? "").replace(/\s+/g, "")].length;
}

/** 剥掉 emoji / 装饰符号，只留文字（emoji 占字数却不承载信息，留着只会挤掉内容） */
function stripDecor(s) {
  return String(s ?? "")
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2B00}-\u{2BFF}]/gu, "")
    .replace(/^[\s·•\-—_:：]+/, "")
    .trim();
}

/**
 * 从长文本里抽出最有代表性的短语。
 * 优先级：冒号前的标题 → 第一个分句 → 第一个并列项 → 截断。
 */
export function shortValue(raw, max = FACT_VALUE_MAX) {
  let s = stripDecor(raw);
  if (!s) return "";

  // 1) "标题：一大段解释" → 标题本身才是结论
  const head = s.match(/^([^：:]{2,14})[：:]/);
  if (head) s = head[1];

  // 2) 只取第一个分句（句号 / 分号换行等）
  s = s.split(/[；;。!！?\n|]/)[0];

  // 3) 只取第一个并列项
  s = s.split(/[，,、/（）()]/)[0];

  // 4) 去掉"…的岗位 / …的情况"这类不承载信息的尾巴
  s = s.replace(/(的|了)(岗位|职位|工作|情况|事情|需求|问题)$/, "");

  s = stripDecor(s);
  return s ? cutChars(s, max) : cutChars(stripDecor(raw), max);
}

/** 纯英文维度名的常见写法 → 中文（求职语境高频），避免"offer"被截成"offe"这种半截词 */
const EN_ALIAS = {
  offer: "已拿",
  base: "期望",
  city: "期望城市",
  salary: "薪资",
  role: "目标岗位",
  job: "目标岗位",
  status: "状态",
  ai: "AI",
  llm: "大模型",
  rag: "RAG",
};

/** 维度名压缩 */
export function shortKey(raw, max = FACT_KEY_MAX) {
  let s = stripDecor(raw);
  if (!s) return "";

  // 整个维度名就是一个英文词：查表换成中文，查不到才原样处理
  if (/^[A-Za-z][A-Za-z\s]*$/.test(s)) {
    const alias = EN_ALIAS[s.trim().toLowerCase()];
    return cutChars(alias || s, max);
  }

  // "期望base城市" → "期望城市"：夹在中文里的英文词不承载信息，去掉
  s = s.replace(/[A-Za-z]{2,}/g, "");
  s = s.replace(/^(关于|有关|我的|当前的)/, "");
  s = s.replace(/(的情况|信息|内容|状态)$/, "");
  return s ? cutChars(s, max) : cutChars(stripDecor(raw), max);
}

/**
 * 把一条词条压到规定长度。
 * 返回 { key, value, detail?, source, updatedAt }，detail 仅在原文被压缩时出现。
 */
export function normalizeFact(f) {
  const rawKey = String(f?.key ?? "").trim();
  const rawValue = String(f?.value ?? "").trim();
  if (!rawKey && !rawValue) return null;

  let key = shortKey(rawKey);
  let value = shortValue(rawValue, Math.max(2, FACT_TOTAL_MAX - charLen(key)));
  // key 太长会挤掉内容，回压一次 key 把空间让出来
  if (charLen(key) + charLen(value) > FACT_TOTAL_MAX) {
    key = cutChars(key, Math.max(2, FACT_TOTAL_MAX - charLen(value)));
  }

  const out = { key, value: value || key };
  // 原文被压掉了才留 detail；已经带 detail 的（迁移/演示数据）原样保留
  if (f?.detail) out.detail = f.detail;
  if (charLen(rawValue) > charLen(out.value) || charLen(rawKey) > charLen(key)) {
    out.detail = out.detail || `${rawKey}：${rawValue}`;
  }
  if (f?.source) out.source = f.source;
  if (f?.updatedAt) out.updatedAt = f.updatedAt;
  return out;
}

/** 批量归一化，并按 key 去重（后出现的覆盖先出现的） */
export function normalizeFacts(list) {
  const map = new Map();
  for (const f of Array.isArray(list) ? list : []) {
    const n = normalizeFact(f);
    if (!n || !n.key) continue;
    const prev = map.get(n.key);
    map.set(n.key, prev?.detail && !n.detail ? { ...n, detail: prev.detail } : n);
  }
  return [...map.values()];
}

/** 给 UI / prompt 用的一行文本 */
export function factLine(f) {
  return `${f.key}：${f.value}`;
}
