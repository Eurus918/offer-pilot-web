/**
 * 一次性迁移：把历史遗留的超长词条重洗成 ≤10 字的短标签。
 *
 * 背景：早期版本的「沉淀中的个人偏好」没有长度约束，AI 写出的长句、
 * 以及复盘沉淀把 3 条结论拼成一整段，在页面上变成撑破布局的大色块。
 *
 * 做法：
 *   1) 长词条交给 AI 重写成 短维度名 + 短内容（保留全部语义，只是压缩表达）
 *   2) 老复盘（没有 strengthTags 字段的）补一次短标签提炼
 *   3) 用新的 syncStrengthsToProfile 重新沉淀强项/短板
 *   4) 全量走一遍 normalizeFact 兜底
 *
 * 用法：node scripts/rewash-facts.mjs [--dry]
 */
import fs from "fs";
import { join } from "path";
import { loadEnv, ROOT } from "../src/config.js";
import { dsChat, parseJsonLoose } from "../src/ai.js";
import { normalizeFacts, normalizeFact, charLen, FACT_TOTAL_MAX } from "../src/facts.js";
import { syncStrengthsToProfile } from "../src/services/reviewService.js";

loadEnv();

const DRY = process.argv.includes("--dry");
const TARGETS = [join(ROOT, "data", "store.json")];

async function askCompress(facts) {
  const lines = facts.map((f, i) => `${i}. ${f.key}：${f.value}`).join("\n");
  const sys =
    "你要把求职者档案里的「个人偏好词条」压缩成极短标签。\n" +
    "硬性要求：每条词条 维度名 + 内容 合计不超过 10 个字（维度名 ≤4 字，内容 ≤8 字）。\n" +
    "规则：\n" +
    "1. 保留原意，只压缩表达，不要新增或删掉事实。\n" +
    "2. 维度名用最简洁的名词，例如「期望base城市」→「期望城市」，「历史面试岗位」→「面过」，「求职方向」→「方向」。\n" +
    "3. 内容取最核心的短语，例如「AI 产品经理 / 大模型产品经理」→「AI产品经理」；\n" +
    "   「不接受需要出国的岗位」→「不接受出国」；「秋招海投中，已投 17 个产品岗」→「秋招海投中」。\n" +
    '4. 严格只输出 JSON：{"facts":[{"key":"","value":""}]}，顺序与输入一一对应。\n';
  const raw = await dsChat({
    system: sys,
    user: "请压缩下面这些词条：\n" + lines,
    json: true,
    getKey: () => process.env.DEEPSEEK_API_KEY,
    getModel: () => process.env.OFFER_PILOT_MODEL || "deepseek-chat",
  });
  const parsed = parseJsonLoose(raw);
  return Array.isArray(parsed?.facts) ? parsed.facts : null;
}

async function askTags(list, kind) {
  const sys =
    `把下面这些面试复盘结论提炼成极短标签，每个 4-6 个字，名词性短语，最多 3 个。\n` +
    `侧重点：${kind === "strength" ? "候选人展现出的能力项" : "候选人暴露出的能力缺口"}。\n` +
    "示例：「需求上溯」「结果导向」「兜底设计」「评估体系」「迭代方法」。\n" +
    '严格只输出 JSON：{"tags":["",""]}\n';
  const raw = await dsChat({
    system: sys,
    user: (list || []).slice(0, 6).map((x, i) => `${i + 1}. ${x}`).join("\n"),
    json: true,
    getKey: () => process.env.DEEPSEEK_API_KEY,
    getModel: () => process.env.OFFER_PILOT_MODEL || "deepseek-chat",
  });
  const parsed = parseJsonLoose(raw);
  return Array.isArray(parsed?.tags) ? parsed.tags.slice(0, 3).map((t) => String(t).trim()).filter(Boolean) : [];
}

for (const file of TARGETS) {
  if (!fs.existsSync(file)) {
    console.log(`跳过（不存在）：${file}`);
    continue;
  }
  const store = JSON.parse(fs.readFileSync(file, "utf-8"));
  const backup = file + ".backup-" + Date.now();
  fs.copyFileSync(file, backup);
  console.log(`\n=== ${file} ===\n已备份 → ${backup}`);

  // 1) 先给老复盘补短标签（还没有 strengthTags 字段的）
  for (const rv of Array.isArray(store.reviews) ? store.reviews : []) {
    const a = rv?.analysis;
    if (!a) continue;
    if (!(a.strengthTags || []).length && (a.strengths || []).length) {
      a.strengthTags = await askTags(a.strengths, "strength");
      console.log(`  ${rv.company || "?"} 强项标签：${a.strengthTags.join("、") || "（无）"}`);
    }
    if (!(a.weaknessTags || []).length && (a.weaknesses || []).length) {
      a.weaknessTags = await askTags(a.weaknesses, "weakness");
      console.log(`  ${rv.company || "?"} 短板标签：${a.weaknessTags.join("、") || "（无）"}`);
    }
  }

  // 2) 重新沉淀强项/短板。必须在压缩之前做——旧的整段式 key（"💪 面试稳定强项"）
  //    要先被识别并清掉，压过之后就认不出来了。
  store.profile = store.profile || {};
  syncStrengthsToProfile(store);

  // 3) 压缩剩下的长词条
  const facts = Array.isArray(store.profile.facts) ? store.profile.facts : [];
  const long = facts.filter((f) => charLen(f.key) + charLen(f.value) > FACT_TOTAL_MAX);
  console.log(`词条 ${facts.length} 条，其中超长 ${long.length} 条`);
  if (long.length) {
    const out = await askCompress(long);
    if (out) {
      const byLine = new Map();
      long.forEach((f, i) => byLine.set(`${f.key}：${f.value}`, out[i] || null));
      for (const f of facts) {
        const n = byLine.get(`${f.key}：${f.value}`);
        if (n?.key && n?.value) {
          f.rewritten = n;
          if (!f.detail) f.detail = `${f.key}：${f.value}`;
        }
      }
      console.log(`  AI 重写返回 ${out.length} 条`);
    } else {
      console.log("  ⚠ AI 重写失败，退回规则压缩");
    }
  }

  store.profile.facts = facts
    .map((f) => {
      const r = f.rewritten;
      const n = normalizeFact({
        key: r?.key || f.key,
        value: r?.value || f.value,
        source: f.source,
        updatedAt: f.updatedAt,
      });
      // normalizeFact 只在"被压掉"时才写 detail；这里把 AI 重写前的原文一并留住
      if (n && f.detail && !n.detail) n.detail = f.detail;
      return n;
    })
    .filter(Boolean);

  // 4) 全量归一化兜底
  store.profile.facts = normalizeFacts(store.profile.facts);

  // 5) 自检
  const bad = store.profile.facts.filter((f) => charLen(f.key) + charLen(f.value) > FACT_TOTAL_MAX);
  console.log("—— 迁移后词条 ——");
  for (const f of store.profile.facts) {
    const len = charLen(f.key) + charLen(f.value);
    console.log(`  ${len > FACT_TOTAL_MAX ? "❌" : "✅"} ${f.key}：${f.value}  (${len} 字)`);
  }
  console.log(bad.length ? `❌ 仍有 ${bad.length} 条超长` : "✅ 全部 ≤10 字");

  if (DRY) {
    console.log("（--dry 模式，未写回文件）");
  } else {
    fs.writeFileSync(file, JSON.stringify(store, null, 2), "utf-8");
    console.log("已写回文件");
  }
}
