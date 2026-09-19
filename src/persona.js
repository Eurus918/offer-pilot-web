/**
 * 使用者画像：把 store 里的档案 + 知识库，拼成给 AI 看的背景材料。
 *
 * 这一层存在的意义：早期版本把作者本人的姓名、学校、实习履历硬编码在 system prompt 里，
 * 任何人 clone 下来 AI 都会"认错人"，同时把作者隐私公开了。现在全部改为动态读取使用者自己的数据。
 */
import fs from "fs";
import { join } from "path";
import { AGENT_KB_DIR } from "./config.js";

const EXPERIENCE_FILE = "我的经历库.md";
const MAX_EXPERIENCE_CHARS = 4000;

/** 档案 → 可读文本（基本信息 + 已沉淀偏好） */
export function profileToText(store) {
  const p = store?.profile || {};
  const basics = p.basics || {};
  let t = "【基本信息】\n";
  let hasAny = false;
  for (const [k, v] of Object.entries(basics)) {
    if (v && typeof v === "string") {
      t += `- ${k}：${v}\n`;
      hasAny = true;
    }
  }
  if (!hasAny) t += "（尚未填写）\n";

  const facts = (p.facts || []).filter((f) => f && (f.key || f.value));
  if (facts.length) {
    t += "\n【已沉淀的偏好/事实】\n";
    for (const f of facts) t += `- ${f.key}：${f.value}\n`;
  }
  return t;
}

/** 读取使用者的经历库（知识库驱动，AI 只讲使用者自己写过的经历） */
export function readExperience() {
  const p = join(AGENT_KB_DIR, EXPERIENCE_FILE);
  if (!fs.existsSync(p)) return "";
  try {
    const txt = fs.readFileSync(p, "utf-8");
    if (!txt.trim()) return "";
    return txt.length > MAX_EXPERIENCE_CHARS
      ? txt.slice(0, MAX_EXPERIENCE_CHARS) + "\n…（已截断）"
      : txt;
  } catch {
    return "";
  }
}

/**
 * 一段"你是谁"的画像，注入每个 system prompt 的开头。
 * 档案为空时明确告诉 AI：不要臆造背景。
 */
export function buildPersona(store) {
  const b = store?.profile?.basics || {};
  const bits = [];
  if (b.name && String(b.name).trim()) bits.push(`使用者：${b.name}`);
  if (b.education && String(b.education).trim()) bits.push(`教育背景：${b.education}`);
  if (b.targetRoles && String(b.targetRoles).trim()) bits.push(`目标岗位：${b.targetRoles}`);
  if (b.city && String(b.city).trim()) bits.push(`意向城市：${b.city}`);

  if (!bits.length) {
    return [
      "【使用者画像】尚未填写个人档案。",
      "严格要求：不要假设使用者的姓名、学校、经历或求职方向。",
      "需要背景信息时，直接向使用者提问；不知道就说不知道，绝不臆造。",
    ].join("\n");
  }
  return "【使用者画像】\n" + bits.map((x) => `- ${x}`).join("\n");
}

/**
 * 经历摘要：优先用使用者填写的经历库，其次退回档案里可用的字段。
 * 返回空字符串时，调用方应提示"还没填经历库"。
 */
export function buildExperienceBrief(store) {
  const exp = readExperience();
  if (exp) return exp;
  const b = store?.profile?.basics || {};
  const bits = [];
  if (b.education) bits.push(`教育：${b.education}`);
  if (b.targetRoles) bits.push(`目标：${b.targetRoles}`);
  return bits.length ? bits.join("；") : "";
}

/** 供 prompt 拼接：画像 + 经历（经历可能为空） */
export function personaBlock(store, { withExperience = true } = {}) {
  const head = buildPersona(store);
  if (!withExperience) return head;
  const exp = buildExperienceBrief(store);
  if (!exp) {
    return (
      head +
      "\n\n【经历材料】使用者还没有填写「我的经历库」。\n" +
      "严格要求：不要编造任何实习、项目或量化成果；如需背景，先请使用者补充。"
    );
  }
  return head + "\n\n【经历材料（来自使用者自己的经历库，回答必须严格基于此）】\n" + exp;
}
