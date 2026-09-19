/**
 * 全局配置：路径、环境变量、常量表
 * 所有"写死的东西"都收敛到这里，方便使用者按需覆盖。
 */
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import fs from "fs";

// src/config.js → 上一级即项目根目录
export const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

export const PORT = Number(process.env.PORT) || 3000;
export const DATA_DIR = join(ROOT, "data");
export const DATA_FILE = join(DATA_DIR, "store.json");
export const EXAMPLE_FILE = join(DATA_DIR, "store.example.json");
export const PUBLIC_DIR = join(ROOT, "public");

// Agent 知识库：仓库内自带模板目录，使用者直接改这里的文件即可
export const AGENT_KB_DIR = process.env.OFFER_PILOT_KB_DIR || join(ROOT, "agent-kb");

// Agent 技能文件：优先用环境变量指定的外部路径，否则用仓库内置的那份
// （旧版本写死了作者本机的绝对路径，导致别人 clone 下来 Agent 模块必然失效）
export const AGENT_SKILL_FILE =
  process.env.OFFER_PILOT_SKILL_FILE || join(ROOT, "agent-skills", "offer-pilot", "SKILL.md");

export const DEEPSEEK_URL = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/chat/completions";

/** 已知可用的 DeepSeek 模型名白名单；不在名单内会回退到 deepseek-chat */
export const KNOWN_MODELS = new Set([
  "deepseek-chat",
  "deepseek-reasoner",
  "deepseek-coder",
  "deepseek-v3",
  "deepseek-v3-0324",
  "deepseek-v3-0324-128k",
  "deepseek-r1",
  "deepseek-r1-0528",
  "deepseek-v4-flash-vision-exp",
  "DeepSeek-V4-Flash-Vision-Exp",
]);

export const DEFAULT_MODEL = "deepseek-chat";

/**
 * 城市生活成本基线（月租为合租单间中位数，living 为吃喝交通等月开销，单位元/月）
 * 使用者可自行增删；未匹配的城市按"不计入成本"处理，并在结果里标注 hasCost:false
 */
export const CITY_COST = {
  "北京": { rent: 3500, living: 2600 },
  "上海": { rent: 3400, living: 2600 },
  "深圳": { rent: 3000, living: 2400 },
  "杭州": { rent: 2600, living: 2300 },
  "广州": { rent: 2200, living: 2100 },
  "成都": { rent: 1600, living: 1900 },
  "武汉": { rent: 1500, living: 1800 },
  "西安": { rent: 1400, living: 1700 },
  "南京": { rent: 1900, living: 2000 },
  "苏州": { rent: 1800, living: 2000 },
  "长沙": { rent: 1400, living: 1800 },
  "厦门": { rent: 2000, living: 2100 },
  "中国香港": { rent: 8000, living: 5000 },
  "新加坡": { rent: 7000, living: 4500 },
  "美国": { rent: 9000, living: 5000 },
};

/** 极简 .env 加载器（不引入 dotenv 依赖，保持"只有一个依赖"的承诺） */
export function loadEnv() {
  const p = join(ROOT, ".env");
  if (!fs.existsSync(p)) return;
  let txt;
  try {
    txt = fs.readFileSync(p, "utf-8");
  } catch {
    return;
  }
  for (const line of txt.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    // 已存在的环境变量优先（命令行传入的不会被 .env 覆盖）
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}
