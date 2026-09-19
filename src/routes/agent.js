/**
 * Agent 工作台：加载「求职助手技能手册」，把四大能力做成可点开的插件。
 *
 * 关键修复：旧版把技能文件路径写死在作者本机（/Users/.../offer-pilot-agent/.dsh/skills/...），
 * 任何人 clone 下来 Agent 模块必然 404。现在默认读仓库内置的 agent-skills/offer-pilot/SKILL.md，
 * 也允许用环境变量 OFFER_PILOT_SKILL_FILE 指向自己的版本。
 */
import { Router } from "express";
import fs from "fs";
import { join } from "path";
import { asyncHandler, badRequest, unavailable } from "../errors.js";
import { AGENT_SKILL_FILE, AGENT_KB_DIR } from "../config.js";
import { personaBlock } from "../persona.js";

const COLORS = ["blue", "purple", "green", "orange", "pink", "teal"];

let cache = null;

function parseSkillFile() {
  if (cache) return cache;
  if (!fs.existsSync(AGENT_SKILL_FILE)) {
    cache = {
      available: false,
      reason: "missing-file",
      message: `未找到技能手册：${AGENT_SKILL_FILE}。可设置环境变量 OFFER_PILOT_SKILL_FILE 指向你自己的 SKILL.md。`,
      skills: [],
      kbFiles: [],
    };
    return cache;
  }

  let md;
  try {
    md = fs.readFileSync(AGENT_SKILL_FILE, "utf-8");
  } catch (e) {
    cache = { available: false, reason: "read-error", message: e.message, skills: [], kbFiles: [] };
    return cache;
  }

  // 解析 frontmatter
  const fmMatch = md.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  let meta = {};
  let body = md;
  if (fmMatch) {
    for (const line of fmMatch[1].split("\n")) {
      const m = line.match(/^(\S+):\s*(.*)$/);
      if (m) meta[m[1]] = m[2].trim();
    }
    body = fmMatch[2];
  }

  // 解析以「## 功能」开头的章节
  const skills = [];
  const skillRegex = /##\s*(功能[一二三四五六七八九十0-9]+[、·.\s]*[^\n]*)\n([\s\S]*?)(?=\n##\s|\n---\s*$|$)/g;
  let m;
  while ((m = skillRegex.exec(body)) !== null) {
    const title = m[1].trim();
    const content = m[2].trim();
    const triggerMatch = content.match(/\*\*触发\*\*[：:]\s*([^\n]+)/);
    const steps = [];
    const stepRegex = /(\d+)\.\s+\*\*([^*]+)\*\*[：:]\s*([^\n]+)/g;
    let sm;
    while ((sm = stepRegex.exec(content)) !== null) {
      steps.push({ num: sm[1], title: sm[2].trim(), desc: sm[3].trim() });
    }
    skills.push({
      key: "skill-" + (skills.length + 1),
      index: skills.length + 1,
      name: title,
      trigger: triggerMatch ? triggerMatch[1].trim() : "",
      steps,
      content,
      color: COLORS[skills.length] || "gray",
    });
  }

  let kbFiles = [];
  if (fs.existsSync(AGENT_KB_DIR)) {
    try {
      kbFiles = fs.readdirSync(AGENT_KB_DIR).filter((f) => f.endsWith(".md"));
    } catch { /* 读不到就算了 */ }
  }

  cache = {
    available: true,
    name: meta.name || "offer-pilot",
    description: meta.description || "",
    whenToUse: meta.whenToUse || "",
    skills,
    kbFiles,
    sourceFile: AGENT_SKILL_FILE,
    kbDir: AGENT_KB_DIR,
  };
  return cache;
}

/** 读取知识库全部 md，拼成上下文 */
function loadKbContext() {
  if (!fs.existsSync(AGENT_KB_DIR)) return "";
  let files = [];
  try {
    files = fs.readdirSync(AGENT_KB_DIR).filter((f) => f.endsWith(".md"));
  } catch {
    return "";
  }
  const parts = [];
  for (const f of files) {
    try {
      const txt = fs.readFileSync(join(AGENT_KB_DIR, f), "utf-8");
      if (txt.trim()) parts.push(`### ${f}\n${txt}`);
    } catch { /* 忽略读取失败的文件 */ }
  }
  return parts.join("\n\n---\n\n");
}

export function registerAgent(router, ctx) {
  router.get("/api/agent/skills", (req, res) => {
    res.json(parseSkillFile());
  });

  router.post(
    "/api/agent/invoke",
    asyncHandler(async (req, res) => {
      const { skillKey, message, history = [] } = req.body || {};
      if (!skillKey || !message) throw badRequest("缺少 skillKey 或 message");

      const agent = parseSkillFile();
      if (!agent.available) throw unavailable(agent.message || "Agent 技能不可用", { reason: agent.reason });

      const skill = agent.skills.find((s) => s.key === skillKey);
      if (!skill) throw unavailable("找不到插件：" + skillKey);

      const md = fs.readFileSync(AGENT_SKILL_FILE, "utf-8");
      const rules = (md.match(/##\s*工作准则[\s\S]*?(?=\n##\s)/) || [""])[0];
      const fileConvention = (md.match(/##\s*工作区文件约定[\s\S]*?(?=\n##\s)/) || [""])[0];
      const outputSpec = (md.match(/##\s*输出规范[\s\S]*?(?=\n---|\n$|$)/) || [""])[0];
      const kbContext = loadKbContext();

      const system = [
        `你是「${agent.name}」——${agent.description}`,
        "",
        personaBlock(ctx.store),
        "",
        "## 当前调用的功能",
        "### " + skill.name,
        skill.trigger ? `**触发场景**：${skill.trigger}` : "",
        "",
        skill.content,
        "",
        "## 通用工作准则",
        rules,
        "",
        fileConvention,
        "",
        outputSpec,
        "",
        kbContext ? "## 知识库上下文（使用者自己的真实数据）\n" + kbContext : "",
      ]
        .filter(Boolean)
        .join("\n");

      const reply = await ctx.ai({
        system,
        user: message,
        history: (Array.isArray(history) ? history : []).map((h) => ({ role: h.role, content: h.text })),
      });

      res.json({ reply, skill: { key: skill.key, name: skill.name } });
    })
  );

  /** 手动刷新缓存（改了 SKILL.md 后不用重启服务） */
  router.post("/api/agent/reload", (req, res) => {
    cache = null;
    res.json(parseSkillFile());
  });
}
