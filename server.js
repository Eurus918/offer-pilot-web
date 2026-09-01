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

// 通用 AI 问答（个人档案页的聊天窗口）
app.post("/api/chat", async (req, res) => {
  try {
    const { message, history = [] } = req.body || {};
    if (!message) return res.status(400).json({ error: "消息为空" });
    store.profile.chatHistory.push({ role: "user", text: message, at: Date.now() });
    saveStore(store);
    const reply = await dsChat({
      system:
        "你是『Offer Pilot』秋招 AI 产品岗个人助手，服务于用户王辰宇（2027 届，目标 AI 产品经理/大模型产品经理）。" +
        "你了解他的简历（腾讯同频派、结算 Agent、滴滴等经历）。用中文、专业、鼓励的语气回答他关于求职/职业/准备的任何问题。" +
        "如果他聊到个人偏好（base、就业倾向、顾虑等），你只需自然回应，真正的抽取由另一个接口完成。",
      user: message,
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
    const sys =
      "你是 Offer Pilot 的面试备战官。结合用户的简历背景（腾讯同频派 DAU906/次留38.46%、结算 Agent 省80%人力、" +
      "滴滴补贴率20%→5%/ROI 转正、AI 产品方向），针对给出的 JD，输出结构化面试备战建议。使用中文。" +
      "返回 JSON：{\"selfIntro\":\"结合该 JD 的 1 分钟自我介绍\",\"questions\":[{\"q\":\"面试官可能问的问题\",\"a\":\"建议回答要点\"}]，" +
      "\"knowledge\":\"建议提前储备的知识/准备的动作\"}。";
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
