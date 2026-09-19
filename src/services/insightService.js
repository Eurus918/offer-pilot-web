/**
 * 投递数据洞察：把"我投了多少家"变成"我的求职漏斗哪里在漏"。
 *
 * 全部是纯计算，不依赖 AI——没配 Key 的人也能立刻看到自己的求职效率。
 */

const DAY = 86400000;

/** 阶段的推进顺序（用于算转化率） */
const FUNNEL_ORDER = [
  "screening",
  "review",
  "written_pending",
  "written_done",
  "interview1",
  "interview2",
  "interview3",
  "hr",
  "offer",
];

const STAGE_LABEL = {
  screening: "简历筛选中",
  review: "简历评估中",
  written_pending: "待笔试",
  written_done: "笔试完成",
  interview1: "一面",
  interview2: "二面",
  interview3: "三面",
  hr: "HR 面",
  offer: "已 offer",
  rejected: "已结束",
  withdrawn: "已放弃",
};

/** 是否算"还活着"（没被拒、没放弃、没拿 offer） */
const isActive = (a) => !["rejected", "withdrawn", "offer"].includes(a.stageKey);

function dateOf(s) {
  if (!s) return null;
  const d = new Date(String(s).slice(0, 10));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * 漏斗：到达过该阶段及之后的数量（累计口径）。
 * 漏斗应该呈递减形状——"当前停在各阶段的人数"是另一回事，放在转化率里看。
 * 已结束/已放弃的投递无法判断曾推进到哪，保守只算到达第 0 阶段。
 */
function stageDistribution(apps) {
  const idx = (k) => FUNNEL_ORDER.indexOf(k);
  return FUNNEL_ORDER.map((key, i) => ({
    key,
    label: STAGE_LABEL[key],
    count: apps.filter((a) => {
      const cur = idx(a.stageKey || "");
      return cur >= 0 ? cur >= i : i === 0;
    }).length,
  }));
}

/** 漏斗转化：到达过某阶段及之后的数量 → 相邻环节转化率 */
function conversion(apps) {
  const idx = (k) => FUNNEL_ORDER.indexOf(k);
  // 到达过第 i 阶段的数量 = 当前阶段 >= i 的（含已结束的按最后阶段算）
  const reached = FUNNEL_ORDER.map((key, i) => {
    const n = apps.filter((a) => {
      const cur = idx(a.stageKey);
      if (cur >= 0) return cur >= i;
      // 已结束/放弃的按其 stageKey 之前推进到的位置无法判断，保守计为只到达第 0 阶段
      return i === 0;
    }).length;
    return { key, label: STAGE_LABEL[key], reached: n };
  });

  const steps = [];
  for (let i = 1; i < reached.length; i++) {
    const prev = reached[i - 1].reached;
    const cur = reached[i].reached;
    steps.push({
      from: reached[i - 1].label,
      to: reached[i].label,
      rate: prev ? +((cur / prev) * 100).toFixed(1) : null,
      drop: prev - cur,
    });
  }
  return { reached, steps };
}

/** 卡住太久、该跟进的投递 */
function staleApplications(apps, days = 7) {
  const now = Date.now();
  const out = [];
  for (const a of apps) {
    if (!isActive(a)) continue;
    const d = dateOf(a.applyDate);
    if (!d) continue;
    const days = Math.floor((now - d.getTime()) / DAY);
    if (days >= days) {
      out.push({
        id: a.id,
        company: a.company,
        role: a.role,
        stage: a.stage || STAGE_LABEL[a.stageKey] || "",
        applyDate: a.applyDate,
        staleDays: days,
      });
    }
  }
  return out.sort((x, y) => y.staleDays - x.staleDays);
}

/** 渠道效果：每个渠道投了多少、进面多少 */
function channelEffect(apps) {
  const map = new Map();
  for (const a of apps) {
    const ch = (a.channel || "").trim() || "未记录";
    if (!map.has(ch)) map.set(ch, { channel: ch, total: 0, advanced: 0, offers: 0 });
    const r = map.get(ch);
    r.total++;
    const k = a.stageKey || "";
    if (["interview1", "interview2", "interview3", "hr"].includes(k)) r.advanced++;
    if (k === "offer") r.offers++;
  }
  return [...map.values()]
    .map((r) => ({
      ...r,
      advancedRate: r.total ? +((r.advanced / r.total) * 100).toFixed(0) : 0,
    }))
    .sort((a, b) => b.total - a.total);
}

/** 从投递到首个进展的平均等待天数 */
function avgWait(apps) {
  const waits = [];
  for (const a of apps) {
    const start = dateOf(a.applyDate);
    if (!start) continue;
    const k = a.stageKey || "";
    // 有面试时间就用面试时间，否则用最后更新时间
    const end = dateOf(a.interviewAt) || dateOf(a.updatedAt);
    if (!end || !["interview1", "interview2", "interview3", "hr", "offer"].includes(k)) continue;
    const d = Math.floor((end.getTime() - start.getTime()) / DAY);
    if (d >= 0 && d < 365) waits.push(d);
  }
  if (!waits.length) return null;
  return {
    samples: waits.length,
    avgDays: +(waits.reduce((s, x) => s + x, 0) / waits.length).toFixed(1),
    medianDays: waits.sort((a, b) => a - b)[Math.floor(waits.length / 2)],
  };
}

export function buildInsights(apps = [], interviews = [], reviews = []) {
  const total = apps.length;
  const active = apps.filter(isActive);
  const offers = apps.filter((a) => a.stageKey === "offer");
  const rejected = apps.filter((a) => a.stageKey === "rejected");

  return {
    summary: {
      total,
      active: active.length,
      offers: offers.length,
      rejected: rejected.length,
      withdrawn: apps.filter((a) => a.stageKey === "withdrawn").length,
      offerRate: total ? +((offers.length / total) * 100).toFixed(1) : 0,
      upcomingInterviews: interviews.filter((i) => i.type === "upcoming" && i.status === "pending").length,
      reviewCount: reviews.length,
    },
    funnel: stageDistribution(apps),
    conversion: conversion(apps),
    stale: staleApplications(apps),
    channels: channelEffect(apps),
    wait: avgWait(apps),
    // 给前端画趋势用：按投递日期聚合
    timeline: timeline(apps),
  };
}

function timeline(apps) {
  const map = new Map();
  for (const a of apps) {
    const d = String(a.applyDate || "").slice(0, 7); // YYYY-MM
    if (!d) continue;
    map.set(d, (map.get(d) || 0) + 1);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, count]) => ({ month, count }));
}
