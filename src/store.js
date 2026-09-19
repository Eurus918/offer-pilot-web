/**
 * 数据层：本地 JSON 文件的读写、schema 归一化、首次启动引导。
 * 数据只存在使用者本机，不上传任何地方。
 */
import fs from "fs";
import { DATA_DIR, DATA_FILE, EXAMPLE_FILE, DEFAULT_MODEL } from "./config.js";

/** 空档案的骨架——保证任何字段缺失都不会让页面崩掉 */
function emptyStore() {
  return {
    config: { model: DEFAULT_MODEL, apiKey: "", meeting: {}, theme: null },
    profile: { basics: {}, facts: [], chatHistory: [] },
    applications: [],
    interviews: [],
    works: [],
    reviews: [],
    offers: [],
    resume: null,
    offerCompare: null,
    onboarding: { done: false, seededFrom: null },
  };
}

const arr = (v) => (Array.isArray(v) ? v : []);

/**
 * 归一化：补齐后加的字段（老数据 / 手工编辑过的 store.json 都能安全加载）
 */
function normalize(s) {
  const base = emptyStore();
  const out = { ...base, ...(s && typeof s === "object" ? s : {}) };
  out.config = { ...base.config, ...(s?.config || {}) };
  out.config.meeting = { ...(s?.config?.meeting || {}) };
  out.profile = {
    basics: { ...(s?.profile?.basics || {}) },
    facts: arr(s?.profile?.facts),
    chatHistory: arr(s?.profile?.chatHistory),
  };
  out.applications = arr(s?.applications);
  out.interviews = arr(s?.interviews);
  out.works = arr(s?.works);
  out.reviews = arr(s?.reviews);
  out.offers = arr(s?.offers);
  out.onboarding = { done: false, seededFrom: null, ...(s?.onboarding || {}) };
  return out;
}

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

/** 首次启动：从示例文件生成使用者的 store.json */
function ensureStore() {
  ensureDir();
  if (fs.existsSync(DATA_FILE)) return;
  if (fs.existsSync(EXAMPLE_FILE)) {
    fs.copyFileSync(EXAMPLE_FILE, DATA_FILE);
    console.log("[store] 已从 data/store.example.json 生成你的 data/store.json");
  } else {
    const fresh = emptyStore();
    fresh.onboarding = { done: false, seededFrom: "empty" };
    fs.writeFileSync(DATA_FILE, JSON.stringify(fresh, null, 2), "utf-8");
    console.log("[store] 已生成空白 data/store.json");
  }
}

export function loadStore() {
  ensureStore();
  let raw;
  try {
    raw = fs.readFileSync(DATA_FILE, "utf-8");
  } catch (e) {
    throw new Error(`无法读取 ${DATA_FILE}：${e.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // store.json 被写坏了：备份一份，别让使用者丢数据
    const backup = DATA_FILE + ".corrupt-" + Date.now();
    try {
      fs.copyFileSync(DATA_FILE, backup);
      console.warn(`[store] store.json 解析失败，已备份到 ${backup}，将使用空档案启动`);
    } catch { /* 备份失败也不阻断启动 */ }
    parsed = {};
  }
  return normalize(parsed);
}

export function saveStore(s) {
  ensureDir();
  const tmp = DATA_FILE + ".tmp";
  // 先写临时文件再重命名，避免写入中途崩溃导致 store.json 损坏
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2), "utf-8");
  fs.renameSync(tmp, DATA_FILE);
}

/** 档案是否已填写到"AI 能认出你是谁"的程度 */
export function onboardingState(s) {
  const b = s?.profile?.basics || {};
  const hasName = !!(b.name && String(b.name).trim());
  const hasTarget = !!(b.targetRoles && String(b.targetRoles).trim());
  const hasEdu = !!(b.education && String(b.education).trim());
  return {
    done: !!s?.onboarding?.done,
    hasName,
    hasTarget,
    hasEdu,
    // 三项里至少两项填了，就认为 AI 已经有足够画像
    ready: [hasName, hasTarget, hasEdu].filter(Boolean).length >= 2,
    hasKey: !!((s?.config?.apiKey && String(s.config.apiKey).trim()) || process.env.DEEPSEEK_API_KEY),
    counts: {
      applications: arr(s?.applications).length,
      interviews: arr(s?.interviews).length,
      reviews: arr(s?.reviews).length,
      offers: arr(s?.offers).length,
      works: arr(s?.works).length,
      facts: arr(s?.profile?.facts).length,
    },
  };
}
