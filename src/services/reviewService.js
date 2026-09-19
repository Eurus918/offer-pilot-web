/**
 * 面试复盘的共享业务逻辑：
 * 1) 把历史复盘注入「面试备战」——形成"答砸过的题，下次别再答砸"的闭环
 * 2) 把跨场复盘的强弱项沉淀进个人档案——"越面越了解自己"
 */
import { reviewSys } from "../prompts.js";
import { parseJsonLoose } from "../ai.js";
import { normalizeFact, shortValue } from "../facts.js";

/** 对一段纪要做 AI 复盘分析 */
export async function analyzeReview(ctx, rv) {
  const raw = await ctx.ai({
    system: reviewSys(ctx.store),
    user:
      `公司：${rv.company}\n岗位：${rv.role}\n轮次：${rv.round}\n日期：${rv.date}\n\n` +
      `===== 面试纪要原文 =====\n${rv.transcript}\n===== 纪要结束 =====\n\n` +
      `请基于以上纪要做结构化复盘分析，严格按 JSON 格式输出。`,
    json: true,
  });
  const parsed = parseJsonLoose(raw);
  if (!parsed) throw new Error("AI 返回的复盘结果不是合法 JSON，请重试");
  return parsed;
}

/** 构造历史复盘上下文，供面试备战接口注入 */
export function buildReviewContext(store, company) {
  const reviews = Array.isArray(store.reviews) ? store.reviews : [];
  if (!reviews.length) return "";
  const analyzed = reviews.filter((r) => r && r.analysis);
  if (!analyzed.length) return "";

  // 同公司的复盘最相关；没有同公司的就用最近的几条
  const sameCompany = company ? analyzed.filter((r) => r.company === company) : [];
  const relevant = sameCompany.length ? sameCompany : analyzed.slice(0, 3);

  let ctx = "\n\n===== 【重要】历史面试复盘，务必针对性强化 =====\n";
  if (sameCompany.length) {
    ctx += `以下是使用者在「${company}」的历史面试复盘——这些是之前被问到且答得不好的地方，本次备战必须重点覆盖、不能再答砸：\n`;
  } else {
    ctx += `以下是近期面试暴露的反复出错点，备战时要有针对性预防：\n`;
  }

  for (const r of relevant.slice(0, 3)) {
    const a = r.analysis;
    ctx += `\n— ${r.company} · ${r.role} · ${r.round || "未知轮次"}（表现分 ${a.score ?? "?"}/10）\n`;
    if (a.weaknesses?.length) {
      ctx += `  答得不好的：\n${a.weaknesses.map((w) => `    · ${w}`).join("\n")}\n`;
    }
    if (a.knowledgeGaps?.length) {
      ctx += `  知识盲区：\n${a.knowledgeGaps.slice(0, 6).map((g) => `    · ${g}`).join("\n")}\n`;
    }
    if (a.nextPrep?.length) {
      ctx += `  上次定的改进重点：\n${a.nextPrep.map((p) => `    · ${p}`).join("\n")}\n`;
    }
  }

  ctx += "\n【硬性要求】\n";
  ctx += "1. 在 questions 中，必须优先覆盖上述薄弱环节（尤其是被判为\"答得不好\"的同类问题），并给出这次应该怎么答。\n";
  ctx += "2. 在 knowledge 中，针对上述知识盲区给出可执行的补课清单。\n";
  ctx += "3. 在 selfIntro 中，避开之前暴露的表述问题。\n";
  return ctx;
}

/**
 * 把跨场复盘的强弱项沉淀到个人档案。
 *
 * 关键约束：个人档案里的词条一律 ≤10 字。早期版本把 3 条长结论用「；」拼成一整条，
 * 在页面上变成两坨撑破布局的大色块——现在改成拆成多条短标签（强项①/②/③、短板①/②/③），
 * 每条只放一个 4-7 字的短语。
 */

/** 旧版本沉淀用的整段式 key，读到就清掉，避免和新词条并存 */
const LEGACY_KEYS = ["💪 面试稳定强项", "🎯 面试反复出错点"];
const S_PREFIX = "强项";
const W_PREFIX = "短板";
const CIRCLED = ["①", "②", "③"];

function isReviewFact(key) {
  const k = String(key || "");
  return LEGACY_KEYS.includes(k) || new RegExp(`^(${S_PREFIX}|${W_PREFIX})[①②③]$`).test(k);
}

export function syncStrengthsToProfile(store) {
  const analyzed = (Array.isArray(store.reviews) ? store.reviews : []).filter((r) => r && r.analysis);
  const kept = (Array.isArray(store.profile?.facts) ? store.profile.facts : []).filter((f) => !isReviewFact(f.key));
  const today = new Date().toISOString().slice(0, 10);

  // 没有复盘记录时，清掉之前沉淀的（避免删光复盘后还留着旧结论）
  if (!analyzed.length) {
    store.profile.facts = kept;
    return;
  }

  const sCount = new Map();
  const wCount = new Map();
  const bump = (m, k) => {
    const t = String(k ?? "").trim();
    if (t) m.set(t, (m.get(t) || 0) + 1);
  };

  for (const r of analyzed) {
    const a = r.analysis || {};
    // 优先用复盘时提炼好的短标签；老复盘没有这个字段，就用压缩后的原句兜底
    const st = (a.strengthTags || []).length ? a.strengthTags : (a.strengths || []).map((x) => shortValue(x));
    const wt = (a.weaknessTags || []).length ? a.weaknessTags : (a.weaknesses || []).map((x) => shortValue(x));
    for (const t of st) bump(sCount, t);
    for (const t of wt) bump(wCount, t);
  }

  /**
   * 出现 2 次以上才算"稳定/反复"，最多沉淀 3 条。
   * 一条都没到 2 次时，退一步保留最高频的那条——否则复盘场次少的使用者会看到这一栏凭空消失。
   */
  const pick = (m) => {
    const sorted = [...m.entries()].sort((a, b) => b[1] - a[1]);
    const stable = sorted.filter(([, c]) => c >= 2).slice(0, 3).map(([t]) => t);
    if (stable.length) return stable;
    return sorted.length ? [sorted[0][0]] : [];
  };

  const add = (prefix, tags) => {
    tags.forEach((t, i) => {
      const n = normalizeFact({ key: prefix + CIRCLED[i], value: t, source: "复盘沉淀", updatedAt: today });
      if (n?.key) kept.push(n);
    });
  };

  add(S_PREFIX, pick(sCount));
  add(W_PREFIX, pick(wCount));
  store.profile.facts = kept;
}

/** 跨复盘汇总统计 */
export function summarizeReviews(store) {
  const reviews = Array.isArray(store.reviews) ? store.reviews : [];
  const analyzed = reviews.filter((r) => r && r.analysis);
  const strengthCount = new Map();
  const weaknessCount = new Map();
  const gapCount = new Map();
  const scoreTrend = [];

  for (const r of analyzed) {
    const a = r.analysis;
    for (const s of a.strengths || []) strengthCount.set(s, (strengthCount.get(s) || 0) + 1);
    for (const w of a.weaknesses || []) weaknessCount.set(w, (weaknessCount.get(w) || 0) + 1);
    for (const g of a.knowledgeGaps || []) gapCount.set(g, (gapCount.get(g) || 0) + 1);
    const sc = Number(a.score);
    if (Number.isFinite(sc)) scoreTrend.push({ date: r.date || "", company: r.company, role: r.role, score: sc });
  }

  const sortDesc = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([text, count]) => ({ text, count }));
  scoreTrend.sort((a, b) => String(a.date).localeCompare(String(b.date)));

  return {
    total: reviews.length,
    analyzedCount: analyzed.length,
    avgScore: analyzed.length
      ? +(analyzed.reduce((s, r) => s + (Number(r.analysis.score) || 0), 0) / analyzed.length).toFixed(1)
      : null,
    latestScore: scoreTrend.length ? scoreTrend[scoreTrend.length - 1].score : null,
    scoreTrend,
    strengths: sortDesc(strengthCount).slice(0, 8),
    weaknesses: sortDesc(weaknessCount).slice(0, 8),
    knowledgeGaps: sortDesc(gapCount).slice(0, 10),
  };
}
