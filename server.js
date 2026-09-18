import express from "express";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import fs from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = join(__dirname, "data", "store.json");
const EXAMPLE_FILE = join(__dirname, "data", "store.example.json");
const PORT = process.env.PORT || 3000;

// ---------- 极简 .env 加载器（无需额外依赖） ----------
function loadEnv() {
  const p = join(__dirname, ".env");
  if (!fs.existsSync(p)) return;
  const txt = fs.readFileSync(p, "utf-8");
  for (const line of txt.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
}
loadEnv();
// API Key 优先级：环境变量 (.env) > store.json 中的 config.apiKey
const getApiKey = () => process.env.DEEPSEEK_API_KEY || (store.config && store.config.apiKey) || "";
const getModel = () => process.env.DEEPSEEK_MODEL || (store.config && store.config.model) || "deepseek-chat";

const app = express();
app.use(express.json({ limit: "15mb" }));
app.use(express.static(join(__dirname, "public")));

// ---------- 数据持久化 ----------
function ensureStore() {
  if (!fs.existsSync(DATA_FILE)) {
    if (fs.existsSync(EXAMPLE_FILE)) {
      fs.copyFileSync(EXAMPLE_FILE, DATA_FILE);
      console.log("[info] 已从 store.example.json 生成 data/store.json");
    } else {
      // 极端兜底：内置最小结构
      fs.writeFileSync(DATA_FILE, JSON.stringify({
        config: { model: "deepseek-chat" },
        profile: { basics: {}, facts: [], chatHistory: [] },
        applications: [], interviews: [], works: [],
      }, null, 2));
    }
  }
}
function loadStore() {
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
}
function saveStore(s) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(s, null, 2), "utf-8");
}
ensureStore();
let store = loadStore();
// 兼容旧数据：复盘模块为后加，老 store.json 没有 reviews 字段
if (!Array.isArray(store.reviews)) store.reviews = [];

// ---------- DeepSeek 代理 ----------
const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";

// 已知可用的 DeepSeek 模型名白名单（2026-08）
const KNOWN_MODELS = new Set([
  "deepseek-chat", "deepseek-reasoner", "deepseek-coder",
  "deepseek-v3", "deepseek-v3-0324", "deepseek-v3-0324-128k",
  "deepseek-r1", "deepseek-r1-0528",
  "deepseek-v4-flash-vision-exp", "DeepSeek-V4-Flash-Vision-Exp",
]);
async function dsChat({ system, user, images = [], json = false, history = [] }) {
  const key = getApiKey();
  if (!key) {
    const e = new Error("NO_KEY");
    e.code = 400;
    throw e;
  }
  // 校验模型名，若不在白名单中则回退到 deepseek-chat
  let model = getModel();
  if (!KNOWN_MODELS.has(model)) {
    console.warn(`[warn] 模型名 "${model}" 不在已知列表中，回退到 deepseek-chat`);
    model = "deepseek-chat";
  }
  const content = [];
  if (user) content.push({ type: "text", text: user });
  for (const img of images) {
    content.push({ type: "image_url", image_url: { url: img } }); // img 为 data URL 或 http(s)
  }
  const messages = [{ role: "system", content: system }];
  for (const h of history) messages.push(h);
  messages.push({ role: "user", content: content.length ? content : user });

  const body = {
    model: model,
    messages,
    temperature: 0.7,
  };
  if (json) body.response_format = { type: "json_object" };

  const resp = await fetch(DEEPSEEK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const t = await resp.text();
    const e = new Error("DEEPSEEK_ERR:" + resp.status + " " + t.slice(0, 300));
    e.code = 502;
    throw e;
  }
  const data = await resp.json();
  return data.choices?.[0]?.message?.content ?? "";
}

// ---------- 路由 ----------
app.get("/api/state", (req, res) => {
  res.json({
    profile: store.profile,
    applications: store.applications,
    interviews: store.interviews,
    works: store.works,
    hasKey: !!getApiKey(),
    model: getModel(),
  });
});

app.post("/api/config", (req, res) => {
  const { apiKey, model } = req.body || {};
  if (apiKey !== undefined) store.config.apiKey = apiKey.trim();
  if (model) store.config.model = model;
  store.config.updatedAt = new Date().toISOString().slice(0, 10);
  saveStore(store);
  res.json({ ok: true, hasKey: !!getApiKey() });
});

// 通用 AI 问答（个人档案页的聊天窗口，支持文件上传）
app.post("/api/chat", async (req, res) => {
  try {
    const { message, file, history = [] } = req.body || {};
    if (!message && !file) return res.status(400).json({ error: "消息和文件不能都为空" });

    // 构建用户消息内容
    let userMessage = message || "";
    let images = [];

    // 处理文件
    if (file && file.data) {
      store.profile.chatHistory.push({ role: "user", text: message || `[上传了文件: ${file.name}]`, at: Date.now(), fileName: file.name });
      saveStore(store);

      if (file.type.startsWith("image/")) {
        // 图片 → 发给 DeepSeek Vision
        images.push(file.data);
        if (!userMessage) userMessage = "请分析这张图片（可能是 JD 截图、简历、笔试题等），结合我的背景给出建议。";
        else userMessage += "\n\n[附图：请结合图片内容分析]";
      } else {
        // 文档（PDF/TXT）→ 将 base64 内容附加到消息中（DeepSeek 不直接支持 PDF，但可以传文本）
        // 对于 txt 直接解码；对于 pdf 我们提示 AI 这是文档附件
        const docHint = `\n\n[用户上传了文档：${file.name}，类型：${file.type}。如果这是文本文件，内容已附在后面。如果是 PDF/Word，请基于文件名和上下文分析。]`;
        userMessage = (userMessage || "请帮我分析这个文件。") + docHint;
        // 尝试提取文本内容（仅对纯文本文件有效）
        if (file.type === "text/plain" || file.name.endsWith(".txt")) {
          try {
            const textContent = Buffer.from(file.data.split(",")[1] || "", "base64").toString("utf-8");
            userMessage += "\n\n--- 文档内容 ---\n" + textContent.slice(0, 8000); // 截断防止超长
          } catch { /* base64 解码失败则忽略 */ }
        }
      }
    } else {
      store.profile.chatHistory.push({ role: "user", text: message, at: Date.now() });
      saveStore(store);
    }

    const reply = await dsChat({
      system:
        "你是『Offer Pilot』秋招 AI 产品岗个人助手，服务于用户王辰宇（2027 届，目标 AI 产品经理/大模型产品经理）。" +
        "你了解他的简历（腾讯同频派、结算 Agent、滴滴等经历）。用中文、专业、鼓励的语气回答他关于求职/职业/准备的任何问题。" +
        "如果他聊到个人偏好（base、就业倾向、顾虑等），你只需自然回应，真正的抽取由另一个接口完成。" +
        "当用户上传图片时，仔细阅读图片中的文字内容（JD、简历、笔试题等）并结合他的背景给出具体建议。",
      user: userMessage,
      images: images,
      history: history.map((h) => ({ role: h.role, content: h.text })),
    });
    store.profile.chatHistory.push({ role: "assistant", text: reply, at: Date.now() });
    saveStore(store);
    res.json({ reply });
  } catch (e) {
    res.status(e.code || 500).json({ error: friendly(e) });
  }
});

// 从对话文本抽取个人档案事实并合并
app.post("/api/profile/extract", async (req, res) => {
  try {
    const { text } = req.body || {};
    if (!text) return res.json({ facts: store.profile.facts });
    const today = new Date().toISOString().slice(0, 10);
    const existing = store.profile.facts.map((f) => `${f.key}=${f.value}`).join("；");
    const out = await dsChat({
      system:
        "从用户的这段话中抽取关于『个人求职偏好/情况』的事实，例如：期望 base 城市、就业倾向（行业/岗位类型）、" +
        "对某公司/某业务的偏好、薪资/稳定性诉求、是否读博、地域限制、当前顾虑等。不要抽取简历上已固定的客观信息（姓名/学校/实习）。" +
        "返回 JSON：{\"facts\":[{\"key\":\"简短维度名\",\"value\":\"具体值\"}]}。若无任何新事实，返回 {\"facts\":[]}。" +
        "已存在的事实：" + existing,
      user: "请抽取这段话里的个人求职偏好事实：\n" + text,
      json: true,
    });
    let parsed;
    try {
      parsed = JSON.parse(out);
    } catch {
      parsed = { facts: [] };
    }
    const map = new Map(store.profile.facts.map((f) => [f.key, f]));
    for (const f of parsed.facts || []) {
      if (!f.key || !f.value) continue;
      map.set(f.key, { key: f.key, value: f.value, source: "对话沉淀", updatedAt: today });
    }
    store.profile.facts = [...map.values()];
    saveStore(store);
    res.json({ facts: store.profile.facts });
  } catch (e) {
    res.status(e.code || 500).json({ error: friendly(e) });
  }
});

// 手动记录个人偏好（无需 API）
app.post("/api/profile/fact", (req, res) => {
  const { key, value } = req.body || {};
  if (!key || !value) return res.status(400).json({ error: "请填写维度和内容" });
  const today = new Date().toISOString().slice(0, 10);
  const map = new Map(store.profile.facts.map((f) => [f.key, f]));
  const k = key.trim();
  map.set(k, { key: k, value: value.trim(), source: "手动记录", updatedAt: today });
  store.profile.facts = [...map.values()];
  saveStore(store);
  res.json({ facts: store.profile.facts });
});

// 投递进度
app.post("/api/applications", (req, res) => {
  const a = req.body || {};
  if (a.id) {
    const i = store.applications.findIndex((x) => x.id === a.id);
    if (i >= 0) store.applications[i] = { ...store.applications[i], ...a };
    else store.applications.push(a);
  } else {
    a.id = "app-" + Date.now();
    store.applications.push(a);
  }
  saveStore(store);
  res.json({ ok: true, applications: store.applications });
});
app.delete("/api/applications/:id", (req, res) => {
  store.applications = store.applications.filter((x) => x.id !== req.params.id);
  saveStore(store);
  res.json({ ok: true, applications: store.applications });
});

// 面邀备战：上传 JD（文本或图片）→ 给出建议
app.post("/api/interviews", async (req, res) => {
  try {
    const { company, role, jdText, jdImage, type = "upcoming", ddl = "" } = req.body || {};
    const id = "iv-" + Date.now();
    const interview = {
      id,
      company: company || "未知公司",
      role: role || "未知岗位",
      type: type,
      status: type === "historical" ? "rejected" : "pending",
      ddl: ddl,
      ddlReminder: false,
      jdText: jdText || "",
      jdImage: jdImage || "",
      prep: null,
      chat: [],
      createdAt: new Date().toISOString().slice(0, 10),
    };
    // 注入历史复盘：同公司 > 近期通用。实现"这次答砸的，下次别再答砸"
    const reviewCtx = buildReviewContext(interview.company);
    if (reviewCtx) {
      interview.usedReviewContext = true; // 标记：本次备战已结合历史复盘
      console.log(`[info] 备战「${interview.company}」已注入历史复盘上下文`);
    }
    const sys =
      "你是 Offer Pilot 的面试备战官。结合用户的简历背景（腾讯同频派 DAU906/次留38.46%、结算 Agent 省80%人力、" +
      "滴滴补贴率20%→5%/ROI 转正、AI 产品方向），针对给出的 JD，输出结构化面试备战建议。使用中文。" +
      "返回 JSON：{\"selfIntro\":\"结合该 JD 的 1 分钟自我介绍\",\"questions\":[{\"q\":\"面试官可能问的问题\",\"a\":\"建议回答要点\"}]，" +
      "\"knowledge\":\"建议提前储备的知识/准备的动作\"}。" +
      reviewCtx;
    const userText =
      "公司：" + interview.company + "，岗位：" + interview.role +
      "\nJD 内容：\n" + (jdText || "（见附图）");
    const prepRaw = await dsChat({
      system: sys,
      user: userText,
      images: jdImage ? [jdImage] : [],
      json: true,
    });
    let prep;
    try {
      prep = JSON.parse(prepRaw);
    } catch {
      prep = { selfIntro: prepRaw, questions: [], knowledge: "" };
    }
    interview.prep = prep;
    store.interviews.push(interview);
    saveStore(store);
    res.json({ interview });
  } catch (e) {
    res.status(e.code || 500).json({ error: friendly(e) });
  }
});

// 面邀备战：针对某次面试的 AI 问答窗口
app.post("/api/interviews/:id/chat", async (req, res) => {
  try {
    const iv = store.interviews.find((x) => x.id === req.params.id);
    if (!iv) return res.status(404).json({ error: "面试不存在" });
    const { message } = req.body || {};
    if (!message) return res.status(400).json({ error: "消息为空" });
    iv.chat.push({ role: "user", text: message });
    const jd = iv.jdText || "（JD 以图片形式提供）";
    const reply = await dsChat({
      system:
        "你是 Offer Pilot 的面试陪练。用户正在准备【" + iv.company + " · " + iv.role +
        "】的面试。JD 如下：\n" + jd +
        "\n用户的简历亮点：同频派 DAU906/次留38.46%、结算 Agent 省80%人力、滴滴补贴率20%→5%/ROI 转正。" +
        "结合 JD 与简历，模拟面试官或给出回答建议，中文、具体、可操作。",
      user: message,
      history: iv.chat.slice(0, -1).map((h) => ({ role: h.role, content: h.text })),
    });
    iv.chat.push({ role: "assistant", text: reply });
    saveStore(store);
    res.json({ reply });
  } catch (e) {
    res.status(e.code || 500).json({ error: friendly(e) });
  }
});

// 面邀备战：更新 DDL
app.patch("/api/interviews/:id/ddl", (req, res) => {
  const iv = store.interviews.find((x) => x.id === req.params.id);
  if (!iv) return res.status(404).json({ error: "面试不存在" });
  const { ddl } = req.body || {};
  iv.ddl = ddl || "";
  saveStore(store);
  res.json({ ok: true, ddl: iv.ddl });
});

// 面邀备战：创建日历提醒（联动企微日历）
app.post("/api/interviews/:id/remind", async (req, res) => {
  try {
    const iv = store.interviews.find((x) => x.id === req.params.id);
    if (!iv || !iv.ddl) return res.status(400).json({ error: "面试不存在或未设置DDL" });

    // 调用企微日历创建日程
    const { execSync } = await import("child_process");
    const ddlDate = new Date(iv.ddl);
    const title = `【面试】${iv.company} · ${iv.role}`;
    const startTime = ddlDate.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
    // 提前 30 分钟提醒
    const remindBefore = 30;

    // 尝试调用 wecom-cli 创建日程
    let calResult;
    try {
      const cmd = `wecomcli calendar create --title "${title}" --start "${startTime}" --minutes-before ${remindBefore} 2>&1`;
      calResult = execSync(cmd, { encoding: "utf-8", timeout: 10000 });
      iv.ddlReminder = true;
      saveStore(store);
      res.json({ ok: true, message: "企微日历提醒已创建", detail: calResult.slice(0, 200) });
    } catch (calErr) {
      // wecom-cli 不可用时，返回提示让用户手动添加
      res.json({ ok: false, error: "企微日历暂不可用，请手动添加：" + title + " 时间：" + ddlDate.toLocaleString("zh-CN"), fallback: true });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- 面试复盘（面试后沉淀，形成"备战→实战→复盘→迭代"闭环） ----------
// 复盘分析的系统提示词：从会议纪要中提取结构化复盘
const REVIEW_SYS =
  "你是『Offer Pilot』的面试复盘教练，服务用户王辰宇（2027 届，目标 AI 产品经理/大模型产品经理）。\n" +
  "用户会给你一段腾讯会议面试的纪要（可能是元宝生成的转写稿）。请你像一位严厉但建设性的面试官，**基于纪要原文**做深度复盘。\n\n" +
  "【用户真实背景，用于判断回答是否到位】\n" +
  "- 腾讯 PCG 数据服务中心产品策划实习：结算 Agent（90%+ 非标验收自动化、省 80% 人力）；同频派小程序（DAU 906 达成 302%、次留 38.46%）\n" +
  "- 滴滴生活服务运营实习：补贴率 20%→5%、日均单 200→1000+、ROI -8% 转正、核销率 20%→35%\n" +
  "- 瑞众人寿银保渠道运营（正式 2 年）；中小学教培创业创始人\n" +
  "- 中国人民大学国际商务硕士，本科经济学。目标：AI 产品经理 / 大模型产品经理\n\n" +
  "【输出要求】严格按下面的 JSON 结构输出，不要输出 JSON 以外的内容：\n" +
  "{\n" +
  '  "summary": "一句话总评（80 字内，直接说这场面得怎么样、核心问题是什么）",\n' +
  '  "score": 1-10 的整数（这场面试的整体表现评分）,\n' +
  '  "qa": [{"q": "面试官问的核心问题", "a": "用户的回答要点（从纪要提炼）", "quality": "good|ok|bad", "comment": "这个回答好在哪/差在哪，一句话"}],\n' +
  '  "strengths": ["答得好的点，具体到哪个问题答得好、好在哪"],\n' +
  '  "weaknesses": ["答得不好的点，具体到卡在哪、为什么没答好"],\n' +
  '  "knowledgeGaps": ["暴露出的知识盲区，要具体到知识点"],\n' +
  '  "nextPrep": ["如果还有下一面，重点准备什么（要可执行）"],\n' +
  '  "frameworks": ["从这场面试沉淀出的可复用答题框架/方法论"],\n' +
  '  "resumeHints": ["简历描述或自我介绍需要优化的地方（若某项目讲不清楚则指出）"]\n' +
  "}\n\n" +
  "【分析原则】\n" +
  "1. **严格基于纪要**，不要臆造纪要里没有的问题或回答。\n" +
  "2. **weaknesses 要具体**：不要说'表达不够好'，要说'被问到 Agent 的坏case如何处理时，只说了人工兜底，没讲清兜底策略和触发条件'。\n" +
  "3. **nextPrep 要可执行**：给出下一面具体该补什么、练什么。\n" +
  "4. **frameworks 要能复用**：从这场面试抽象出下次能直接用的答题套路。\n" +
  "5. 如果纪要太短或信息不足，就基于已有内容分析，并在 summary 里说明'纪要信息有限'。\n" +
  "6. 中文输出。";

// 构建「历史复盘上下文」——供面试备战接口注入，实现"复盘→迭代备战"闭环
function buildReviewContext(company) {
  if (!Array.isArray(store.reviews) || !store.reviews.length) return "";
  const analyzed = store.reviews.filter((r) => r.analysis);
  if (!analyzed.length) return "";

  // 同公司的复盘最相关；没有同公司的就用最近的几条
  const sameCompany = company ? analyzed.filter((r) => r.company === company) : [];
  const relevant = sameCompany.length ? sameCompany : analyzed.slice(0, 3);

  let ctx = "\n\n===== 【重要】用户历史面试复盘，务必针对性强化 =====\n";
  if (sameCompany.length) {
    ctx += `以下是用户在「${company}」的历史面试复盘——这些是之前被问到且答得不好的地方，本次备战必须重点覆盖、不能再答砸：\n`;
  } else {
    ctx += `以下是用户近期面试暴露的反复出错点，备战时要有针对性预防：\n`;
  }

  for (const r of relevant.slice(0, 3)) {
    const a = r.analysis;
    ctx += `\n— ${r.company} · ${r.role} · ${r.round}（表现分 ${a.score || "?"}/10）\n`;
    if (a.weaknesses && a.weaknesses.length) {
      ctx += `  答得不好的：\n${a.weaknesses.map((w) => `    · ${w}`).join("\n")}\n`;
    }
    if (a.knowledgeGaps && a.knowledgeGaps.length) {
      ctx += `  知识盲区：\n${a.knowledgeGaps.slice(0, 6).map((g) => `    · ${g}`).join("\n")}\n`;
    }
    if (a.nextPrep && a.nextPrep.length) {
      ctx += `  上次定的改进重点：\n${a.nextPrep.map((p) => `    · ${p}`).join("\n")}\n`;
    }
  }

  ctx += `\n【硬性要求】\n`;
  ctx += `1. 在 questions 中，必须优先覆盖上述薄弱环节（尤其是被判为"答得不好"的同类问题），并给出这次应该怎么答。\n`;
  ctx += `2. 在 knowledge 中，针对上述知识盲区给出可执行的补课清单。\n`;
  ctx += `3. 在 selfIntro 中，避开之前暴露的表述问题（如过于泛泛、缺少 AI 产品方法论）。\n`;
  ctx += `4. 如果用户已有复盘记录，可在 questions 里加一条"上次面试栽过的坑，这次怎么答得更好"。\n`;
  return ctx;
}

// 把跨场复盘的强弱项沉淀到个人档案（profile.facts），实现"越面越了解自己"
function syncStrengthsToProfile() {
  const analyzed = (store.reviews || []).filter((r) => r.analysis);
  if (!analyzed.length) return;

  const sCount = new Map();
  const wCount = new Map();
  for (const r of analyzed) {
    for (const s of r.analysis.strengths || []) sCount.set(s, (sCount.get(s) || 0) + 1);
    for (const w of r.analysis.weaknesses || []) wCount.set(w, (wCount.get(w) || 0) + 1);
  }
  const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([t]) => t);

  const today = new Date().toISOString().slice(0, 10);
  const map = new Map((store.profile.facts || []).map((f) => [f.key, f]));

  const topS = top(sCount, 3);
  const topW = top(wCount, 3);
  if (topS.length) {
    map.set("💪 面试稳定强项", { key: "💪 面试稳定强项", value: topS.join("；"), source: "复盘沉淀", updatedAt: today });
  }
  if (topW.length) {
    map.set("🎯 面试反复出错点", { key: "🎯 面试反复出错点", value: topW.join("；"), source: "复盘沉淀", updatedAt: today });
  }
  store.profile.facts = [...map.values()];
}

// 列出所有复盘
app.get("/api/reviews", (req, res) => {
  res.json({ reviews: store.reviews });
});

// 新建复盘（粘贴文本或上传文件内容），并自动做 AI 分析
app.post("/api/reviews", async (req, res) => {
  try {
    const { company, role, round, date, transcript, source = "manual" } = req.body || {};
    if (!transcript || !transcript.trim()) {
      return res.status(400).json({ error: "请粘贴面试纪要内容" });
    }
    const review = {
      id: "rv-" + Date.now(),
      company: company || "未填写公司",
      role: role || "未填写岗位",
      round: round || "未知轮次",
      date: date || new Date().toISOString().slice(0, 10),
      source, // manual=粘贴 / file=文件上传 / api=腾讯会议同步（预留）
      transcript: transcript.trim(),
      analysis: null,
      createdAt: new Date().toISOString().slice(0, 10),
    };

    // 自动 AI 分析
    let analysis = null;
    let analyzeError = "";
    try {
      const raw = await dsChat({
        system: REVIEW_SYS,
        user:
          `公司：${review.company}\n岗位：${review.role}\n轮次：${review.round}\n日期：${review.date}\n\n` +
          `===== 面试纪要原文 =====\n${review.transcript}\n===== 纪要结束 =====\n\n` +
          `请基于以上纪要做结构化复盘分析，严格按 JSON 格式输出。`,
        json: true,
      });
      analysis = JSON.parse(raw);
    } catch (e) {
      analyzeError = friendly(e);
      console.warn("[warn] 复盘 AI 分析失败:", analyzeError);
    }

    review.analysis = analysis;
    store.reviews.unshift(review); // 最新的排前面
    syncStrengthsToProfile(); // 沉淀强弱项到个人档案
    saveStore(store);
    res.json({ review, analyzeError: analyzeError || undefined });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 重新分析某条复盘（比如换了模型、或想再跑一次）
app.post("/api/reviews/:id/analyze", async (req, res) => {
  try {
    const rv = store.reviews.find((x) => x.id === req.params.id);
    if (!rv) return res.status(404).json({ error: "复盘不存在" });
    const raw = await dsChat({
      system: REVIEW_SYS,
      user:
        `公司：${rv.company}\n岗位：${rv.role}\n轮次：${rv.round}\n日期：${rv.date}\n\n` +
        `===== 面试纪要原文 =====\n${rv.transcript}\n===== 纪要结束 =====\n\n` +
        `请基于以上纪要做结构化复盘分析，严格按 JSON 格式输出。`,
      json: true,
    });
    rv.analysis = JSON.parse(raw);
    syncStrengthsToProfile(); // 重新分析后重算强弱项
    saveStore(store);
    res.json({ review: rv });
  } catch (e) {
    res.status(e.code || 500).json({ error: friendly(e) });
  }
});

// 删除复盘
app.delete("/api/reviews/:id", (req, res) => {
  const before = store.reviews.length;
  store.reviews = store.reviews.filter((x) => x.id !== req.params.id);
  syncStrengthsToProfile(); // 删除后重算强弱项
  saveStore(store);
  res.json({ ok: true, deleted: before - store.reviews.length });
});

// 跨复盘汇总：沉淀稳定强项 + 反复出错点（用于个人档案）
app.get("/api/reviews/summary", (req, res) => {
  const analyzed = store.reviews.filter((r) => r.analysis);
  const strengthCount = new Map();
  const weaknessCount = new Map();
  const gapCount = new Map();

  for (const r of analyzed) {
    const a = r.analysis;
    for (const s of a.strengths || []) strengthCount.set(s, (strengthCount.get(s) || 0) + 1);
    for (const w of a.weaknesses || []) weaknessCount.set(w, (weaknessCount.get(w) || 0) + 1);
    for (const g of a.knowledgeGaps || []) gapCount.set(g, (gapCount.get(g) || 0) + 1);
  }

  const sortDesc = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([text, count]) => ({ text, count }));
  res.json({
    total: store.reviews.length,
    analyzedCount: analyzed.length,
    avgScore: analyzed.length
      ? (analyzed.reduce((s, r) => s + (Number(r.analysis.score) || 0), 0) / analyzed.length).toFixed(1)
      : null,
    strengths: sortDesc(strengthCount),
    weaknesses: sortDesc(weaknessCount),
    knowledgeGaps: sortDesc(gapCount),
  });
});

// 【预留】腾讯会议 / 元宝 API 自动同步
// 当前连接器未开通或接口不可用时，返回明确提示，前端据此引导手动粘贴
app.post("/api/reviews/sync", async (req, res) => {
  res.json({
    ok: false,
    message: "自动同步尚未接入：腾讯会议录制与元宝纪要的开放接口当前不可用（需企业授权）。",
    fallback: "请先在腾讯会议导出/元宝生成纪要，再粘贴到本产品的「面试复盘」中。",
    todo: "接口位置已预留：待连接器（tmeet / ima）开通后，在此处拉取 meetingId → 转写文本 → 写入 store.reviews",
  });
});

// ---------- Agent（嵌入 dsh 的 offer-pilot 技能） ----------
// 技能源文件路径（外部项目，本机绝对路径，可被 .gitignore 排除）
const AGENT_SKILL_FILE = "/Users/wangchenyu/WorkBuddy/2026-08-28-11-36-07/offer-pilot-agent/.dsh/skills/offer-pilot/SKILL.md";
const AGENT_KB_DIR = join(__dirname, "agent-kb"); // 软链到 offer-pilot-agent/知识库/

// 缓存解析结果（SKILL.md 不常变，启动时解析一次）
let AGENT_CACHE = null;
function parseAgentSkill() {
  if (AGENT_CACHE) return AGENT_CACHE;
  if (!fs.existsSync(AGENT_SKILL_FILE)) {
    AGENT_CACHE = { available: false, skills: [], kbFiles: [] };
    return AGENT_CACHE;
  }
  const md = fs.readFileSync(AGENT_SKILL_FILE, "utf-8");
  // 解析 frontmatter
  const fmMatch = md.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  let meta = {};
  let body = md;
  if (fmMatch) {
    fmMatch[1].split("\n").forEach((line) => {
      const m = line.match(/^(\S+):\s*(.*)$/);
      if (m) meta[m[1]] = m[2].trim();
    });
    body = fmMatch[2];
  }
  // 解析 4 个主功能（以"## 功能"开头的章节）
  const skills = [];
  const skillRegex = /##\s*(功能[一二三四0-9]+[、·.\s]*[^\n]*)\n([\s\S]*?)(?=\n##\s|\n---\s*$|$)/g;
  let m;
  while ((m = skillRegex.exec(body)) !== null) {
    const title = m[1].trim();
    const content = m[2].trim();
    // 提取触发条件
    const triggerMatch = content.match(/\*\*触发\*\*[：:]\s*([^\n]+)/);
    const trigger = triggerMatch ? triggerMatch[1].trim() : "";
    // 提取子步骤
    const steps = [];
    const stepRegex = /(\d+)\.\s+\*\*([^*]+)\*\*[：:]\s*([^\n]+)/g;
    let sm;
    while ((sm = stepRegex.exec(content)) !== null) {
      steps.push({ num: sm[1], title: sm[2].trim(), desc: sm[3].trim() });
    }
    // 选个配色
    const colors = ["blue", "purple", "green", "orange"];
    const color = colors[skills.length] || "gray";
    skills.push({
      key: "skill-" + (skills.length + 1),
      index: skills.length + 1,
      name: title,
      trigger,
      steps,
      content,
      color,
    });
  }
  // 知识库文件列表
  let kbFiles = [];
  if (fs.existsSync(AGENT_KB_DIR)) {
    kbFiles = fs.readdirSync(AGENT_KB_DIR).filter((f) => f.endsWith(".md"));
  }
  AGENT_CACHE = {
    available: true,
    name: meta.name || "offer-pilot",
    description: meta.description || "",
    whenToUse: meta.whenToUse || "",
    skills,
    kbFiles,
    sourceFile: AGENT_SKILL_FILE,
  };
  return AGENT_CACHE;
}

// 读取所有知识库文件内容（拼成上下文）
function loadKbContext() {
  if (!fs.existsSync(AGENT_KB_DIR)) return "";
  const files = fs.readdirSync(AGENT_KB_DIR).filter((f) => f.endsWith(".md"));
  const parts = [];
  for (const f of files) {
    try {
      const txt = fs.readFileSync(join(AGENT_KB_DIR, f), "utf-8");
      parts.push(`### ${f}\n${txt}`);
    } catch { /* 忽略读取失败的文件 */ }
  }
  return parts.join("\n\n---\n\n");
}

// 暴露插件元信息给前端
app.get("/api/agent/skills", (req, res) => {
  const a = parseAgentSkill();
  res.json(a);
});

// 调用某个插件
app.post("/api/agent/invoke", async (req, res) => {
  try {
    const { skillKey, message, history = [] } = req.body || {};
    if (!skillKey || !message) return res.status(400).json({ error: "缺少 skillKey 或 message" });
    const agent = parseAgentSkill();
    if (!agent.available) return res.status(503).json({ error: "Agent 源文件不可用，请确认 offer-pilot-agent 项目存在" });
    const skill = agent.skills.find((s) => s.key === skillKey);
    if (!skill) return res.status(404).json({ error: "找不到插件：" + skillKey });

    // 构造系统提示词：通用约定 + 该功能章节 + 知识库上下文
    const skillMd = fs.readFileSync(AGENT_SKILL_FILE, "utf-8");
    // 提取工作准则/工作区约定/输出规范
    const rules = (skillMd.match(/##\s*工作准则[\s\S]*?(?=\n##\s)/) || [""])[0];
    const fileConvention = (skillMd.match(/##\s*工作区文件约定[\s\S]*?(?=\n##\s)/) || [""])[0];
    const outputSpec = (skillMd.match(/##\s*输出规范[\s\S]*?(?=\n---|\n$|$)/) || [""])[0];

    const kbContext = loadKbContext();
    const system = [
        "你是「" + agent.name + "」——" + agent.description,
        "",
        "## 当前调用的功能",
        "### " + skill.name,
        (skill.trigger ? "**触发场景**：" + skill.trigger : ""),
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
        kbContext ? "## 知识库上下文（用户的真实数据）\n" + kbContext : "",
      ]
      .filter(Boolean)
      .join("\n");

    const reply = await dsChat({
      system,
      user: message,
      history: history.map((h) => ({ role: h.role, content: h.text })),
    });
    res.json({ reply, skill: { key: skill.key, name: skill.name } });
  } catch (e) {
    res.status(e.code || 500).json({ error: friendly(e) });
  }
});

function friendly(e) {
  if (e.message === "NO_KEY") return "请先在『设置』中填入 DeepSeek API Key（platform.deepseek.com 获取，格式 sk- 开头）。";
  if (e.message && e.message.startsWith("DEEPSEEK_ERR")) {
    if (e.message.includes("402") || e.message.includes("Insufficient")) return "DeepSeek 账户余额不足，请到 platform.deepseek.com 充值后重试。";
    return "调用 DeepSeek 失败：" + e.message;
  }
  return e.message || "服务异常";
}

app.listen(PORT, () => {
  console.log("Offer Pilot Web 运行中 → http://localhost:" + PORT);
});
