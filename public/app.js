const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
let STATE = null;
let ivImageData = "";
let chatFileData = null;  // 当前选中的上传文件 { name, type, base64 }

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2600);
}
async function api(path, opts) {
  const r = await fetch(path, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "请求失败");
  return j;
}

// ---------- 侧边栏导航 ----------
function switchView(view) {
  $$(".nav-item").forEach((x) => x.classList.remove("active"));
  $$(".panel").forEach((x) => x.classList.remove("active"));
  const btn = $(`.nav-item[data-view="${view}"]`);
  if (btn) btn.classList.add("active");
  const panel = $("#" + view);
  if (panel) panel.classList.add("active");
  // 进入某页时按需刷新该页数据
  if (view === "dashboard") renderDashboard();
  if (view === "interview") loadReviews();
}
$$(".nav-item").forEach((b) => b.addEventListener("click", () => switchView(b.dataset.view)));

// 面试页内部的「备战 / 复盘」子导航
function switchSub(sub) {
  const panel = $("#interview");
  if (!panel) return;
  panel.querySelectorAll(".chip[data-sub]").forEach((x) => x.classList.toggle("active", x.dataset.sub === sub));
  panel.querySelectorAll(".sub-panel").forEach((x) => x.classList.toggle("active", x.dataset.sub === sub));
}
$$(".chip[data-sub]").forEach((b) => b.addEventListener("click", () => switchSub(b.dataset.sub)));

// ---------- load ----------
async function load() {
  STATE = await api("/api/state");
  renderProfile();
  renderApps();
  renderInterviews();
  renderWorks();
  populateTdCatList();
  await refreshTodos();
  renderDashboard();
  updateCounts();
  const kb = $("#keyBadge");
  kb.textContent = STATE.hasKey ? "API Key：已设置" : "API Key：未设置";
  kb.classList.toggle("ok", !!STATE.hasKey);

  // 在线演示版：明确告知数据性质，避免误以为是自己的真实数据
  const dn = $("#demoNotice");
  if (STATE.demo) {
    dn.style.display = "block";
    dn.innerHTML = "<b>在线演示版</b>：这里跑的是示例数据，所有改动只存在这台演示服务器上，" +
      "不会同步到任何人本机；为安全起见，演示版<b>不会保存你填写的 API Key</b>。" +
      "想用自己的真实数据，把项目 clone 到本地跑即可（数据只在你自己电脑上）。";
  } else {
    dn.style.display = "none";
  }
  const setHint = $("#setKeyHint");
  if (setHint) setHint.style.display = STATE.demo ? "block" : "none";
  // 演示版：Key 输入禁用（写了也不会生效，不如直接不给错觉）
  const setKey = $("#setKey");
  if (setKey) {
    setKey.disabled = !!STATE.demo;
    setKey.placeholder = STATE.demo ? "演示版不保存 Key" : "sk-...";
  }
  const notice = $("#aiNotice");
  if (!STATE.hasKey) {
    notice.style.display = "block";
    notice.innerHTML =
      "<b>AI 功能未启用</b>：还没检测到 DeepSeek API Key。" +
      "不填也能用——投递进度、面试复盘、Offer 对比都不依赖 AI。" +
      "配置 Key 后解锁 AI 对话、JD 分析与简历生成。" +
      "<a href='#' id='noticeSetup' style='margin-left:6px'>去设置 →</a>";
    const link = $("#noticeSetup");
    if (link) link.addEventListener("click", (e) => { e.preventDefault(); openSettings(); });
  } else {
    notice.style.display = "none";
  }
  checkOnboarding();
  loadInsights();
}

function openSettings() {
  switchView("settings");
}

// ---------- 首次启动引导 ----------
function checkOnboarding() {
  const o = STATE.onboarding;
  if (!o || o.done) return;
  // 档案已经填过（老用户升级上来）就只补一次标记，不打扰
  if (o.ready) {
    api("/api/onboarding", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {});
    return;
  }
  const b = STATE.profile?.basics || {};
  $("#obName").value = b.name || "";
  $("#obEdu").value = b.education || "";
  $("#obTarget").value = b.targetRoles || "";
  $("#obCity").value = b.city || "";
  $("#onboardMask").style.display = "flex";
}
function closeOnboarding() {
  $("#onboardMask").style.display = "none";
}

// ---------- profile ----------
function renderProfile() {
  const b = STATE.profile?.basics || {};
  const v = (x) => esc(x || "—");
  const cityAge = [b.city, b.age ? b.age + "岁" : "", b.political].filter(Boolean).join(" · ");
  $("#basics").innerHTML = `
    <div class="kv-row">
      <div class="kv-label">姓名</div><div class="kv-val">${v(b.name)}</div>
      <div class="kv-label">电话</div><div class="kv-val">${v(b.phone)}</div>
    </div>
    <div class="kv-row">
      <div class="kv-label">邮箱</div><div class="kv-val">${v(b.email)}</div>
      <div class="kv-label">城市 / 年龄</div><div class="kv-val">${v(cityAge)}</div>
    </div>
    <div class="kv-row full-width">
      <div class="kv-label">学历</div><div class="kv-val">${v(b.education)}</div>
    </div>
    <div class="kv-row full-width">
      <div class="kv-label">目标岗位</div><div class="kv-val">${v(b.targetRoles)}</div>
    </div>`;
  renderChat();
}

// 聊天默认只显示最近一轮（一问一答），不再整段铺成长图；点「查看完整对话」展开
let CHAT_EXPANDED = false;

function chatMsgHtml(m) {
  const isUser = m.role === "user";
  const avatar = isUser
    ? `<div class="chat-avatar user-avatar">我</div>`
    : `<div class="chat-avatar ai-avatar"><img src="assets/cat-mascot.svg" alt="助手" onerror="this.outerHTML='AI'" /></div>`;
  const time = m.time ? fmtTime(m.time) : "";
  let content = esc(m.text);
  if (m.image) {
    content += `<br><img src="${m.image}" style="max-width:200px;max-height:150px;border-radius:8px;margin-top:6px;border:1px solid var(--line)" />`;
  }
  if (m.fileName && !m.image) {
    content += `<br><span style="display:inline-block;margin-top:4px;padding:3px 8px;background:var(--bg);border-radius:6px;font-size:12px;color:var(--muted)">${esc(m.fileName)}</span>`;
  }
  return `<div class="chat-row ${isUser ? "user" : "ai"}">
    ${avatar}
    <div>
      <div class="chat-bubble">${content}</div>
      ${time ? `<div class="chat-time">${time}</div>` : ""}
    </div>
  </div>`;
}

function renderChat() {
  const log = $("#chatLog");
  const h = STATE.profile.chatHistory || [];
  const toggle = $("#chatToggle");
  if (toggle) {
    toggle.textContent = CHAT_EXPANDED ? "收起对话" : "查看完整对话";
    toggle.style.display = h.length > 2 ? "inline-block" : "none";
  }
  if (h.length === 0) {
    log.innerHTML = `<div style="text-align:center;color:var(--gray);padding:40px 0;font-size:13.5px">
      <div style="margin-bottom:8px"><img src="assets/cat-mascot.svg" alt="助手" style="width:56px;height:56px;border-radius:50%;object-fit:cover;background:var(--primary-soft)" onerror="this.style.display='none'" /></div>
      开始和 AI 聊聊吧<br><span style="font-size:12px">聊聊你的想法、偏好，或上传资料让 AI 分析</span>
    </div>`;
    return;
  }
  const visible = CHAT_EXPANDED ? h : h.slice(-2);
  const head = (!CHAT_EXPANDED && h.length > 2)
    ? `<div class="chat-more">只显示最近一轮 · 共 ${h.length} 条，点右上角看完整对话</div>`
    : "";
  log.innerHTML = head + visible.map(chatMsgHtml).join("");
  log.scrollTop = log.scrollHeight;
}
function fmtTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function esc(s) { return (s || "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c])); }

$("#chatSend").addEventListener("click", async () => {
  const v = $("#chatInput").value.trim();
  if (!v && !chatFileData) return;
  $("#chatInput").value = "";
  const log = $("#chatLog");
  // 清空欢迎语
  if (log.querySelector("div[style*='text-align:center']")) log.innerHTML = "";
  const now = new Date().toISOString();
  // 用户消息气泡
  let userContent = esc(v);
  if (chatFileData) {
    if (chatFileData.type.startsWith("image/")) {
      userContent += `<br><img src="${chatFileData.base64}" style="max-width:200px;max-height:150px;border-radius:8px;margin-top:6px;border:1px solid var(--line)" />`;
    } else {
      userContent += `<br><span style="display:inline-block;margin-top:4px;padding:3px 8px;background:var(--bg);border-radius:6px;font-size:12px;color:var(--muted)">${esc(chatFileData.name)}</span>`;
    }
  }
  log.innerHTML += `<div class="chat-row user">
    <div class="chat-avatar user-avatar">我</div>
    <div><div class="chat-bubble">${userContent}</div><div class="chat-time">${fmtTime(now)}</div></div>
  </div>`;
  log.scrollTop = log.scrollHeight;

  // AI 思考中
  const aiRow = document.createElement("div");
  aiRow.className = "chat-row ai";
  aiRow.innerHTML = `<div class="chat-avatar ai-avatar"><img src="assets/cat-mascot.svg" alt="助手" onerror="this.outerHTML='AI'" /></div><div><div class="chat-bubble" style="color:var(--gray);padding:10px 14px">思考中…</div></div>`;
  log.appendChild(aiRow);
  log.scrollTop = log.scrollHeight;

  try {
    const body = { message: v };
    if (chatFileData) {
      body.file = { name: chatFileData.name, type: chatFileData.type, data: chatFileData.base64 };
    }
    const j = await api("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    // 更新 AI 回复
    aiRow.querySelector(".chat-bubble").textContent = "";
    aiRow.querySelector(".chat-bubble").innerHTML = formatAiReply(j.reply);
    renderPoints("chatPoints", extractPoints(j.reply));
    // 添加时间戳
    const aiTime = document.createElement("div");
    aiTime.className = "chat-time";
    aiTime.textContent = fmtTime(new Date().toISOString());
    aiRow.querySelector("div > div").appendChild(aiTime);

    // 沉淀档案（仅文字部分）——静默进行，不再展示词条墙
    if (v) {
      try {
        const ex = await api("/api/profile/extract", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: v }) });
        STATE.profile.facts = ex.facts;
      } catch { /* 沉淀失败不影响对话 */ }
    }

    STATE.profile.chatHistory = STATE.profile.chatHistory || [];
    STATE.profile.chatHistory.push(
      { role: "user", text: v, time: now, ...(chatFileData ? { fileName: chatFileData.name, image: chatFileData.type.startsWith("image/") ? chatFileData.base64 : undefined } : {}) },
      { role: "assistant", text: j.reply, time: new Date().toISOString() }
    );
    renderChat();
  } catch (e) {
    aiRow.querySelector(".chat-bubble").textContent = "" + e.message;
  }
  log.scrollTop = log.scrollHeight;

  // 清除上传预览
  clearChatUpload();
});

/**
 * 格式化 AI 回复。
 * 排版规范（刻意和之前不同）：
 *   - 标题用加粗 + 独立行，正文一律常规字重，不再整段糊成粗体；
 *   - 行内 **强调** 只在短词组（≤12 字）上加粗，长句保持常规，避免"满屏加粗"；
 *   - 列表渲染成真正的 ul/li，段落之间有间距，不再靠 <br> 堆成一坨。
 */
function formatAiReply(text) {
  if (!text) return "";
  const lines = esc(text).split(/\r?\n/);
  let html = "";
  let inList = false;
  const boldShort = (s) =>
    s.replace(/\*\*(.+?)\*\*/g, (m, p1) => (p1.length <= 12 ? `<b>${p1}</b>` : p1));

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { if (inList) { html += "</ul>"; inList = false; } continue; }
    if (/^#{1,3}\s+/.test(line)) {
      if (inList) { html += "</ul>"; inList = false; }
      const lv = Math.min((line.match(/^#+/) || ["#"])[0].length, 3);
      html += `<div class="ai-h ai-h${lv}">${boldShort(line.replace(/^#{1,3}\s+/, ""))}</div>`;
      continue;
    }
    if (/^([-*•·]|\d+[.、)])\s+/.test(line)) {
      if (!inList) { html += `<ul class="ai-ul">`; inList = true; }
      html += `<li>${boldShort(line.replace(/^([-*•·]|\d+[.、)])\s+/, ""))}</li>`;
      continue;
    }
    if (inList) { html += "</ul>"; inList = false; }
    html += `<p class="ai-p">${boldShort(line)}</p>`;
  }
  if (inList) html += "</ul>";
  return html;
}

// ---------- 聊天区文件上传（选择 或 直接 Ctrl+V 粘贴） ----------
function handleChatFile(file) {
  if (!file) return;
  // 文件大小限制：图片 5MB，文档 10MB
  const maxSize = file.type.startsWith("image/") ? 5 * 1024 * 1024 : 10 * 1024 * 1024;
  if (file.size > maxSize) { toast("文件太大，请选 " + (maxSize / 1024 / 1024) + "MB 以内的"); return; }
  const reader = new FileReader();
  reader.onload = () => {
    chatFileData = { name: file.name || "粘贴的图片", type: file.type, base64: reader.result };
    showChatUploadPreview(file, reader.result);
  };
  reader.readAsDataURL(file);
}
$("#chatFileInput").addEventListener("change", (e) => {
  handleChatFile(e.target.files[0]);
  e.target.value = "";
});
// 输入框内直接粘贴：图片（截图）或文件自动作为附件
$("#chatInput").addEventListener("paste", (e) => {
  const items = (e.clipboardData && e.clipboardData.items) || [];
  for (const item of items) {
    if (item.kind === "file") {
      const f = item.getAsFile();
      if (f) { e.preventDefault(); handleChatFile(f); return; }
    }
  }
});
// 回车直接发送；Shift+Enter 换行
$("#chatInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    $("#chatSend").click();
  }
});

function showChatUploadPreview(file, dataUrl) {
  const preview = $("#chatUploadPreview");
  if (file.type.startsWith("image/")) {
    preview.innerHTML = `<img src="${dataUrl}" /><span class="file-name">${esc(file.name)} (${(file.size / 1024).toFixed(1)}KB)</span><button class="file-remove" onclick="clearChatUpload()"></button>`;
  } else {
    preview.innerHTML = `<span style="font-size:24px;margin-right:4px"></span><span class="file-name">${esc(file.name)} (${(file.size / 1024).toFixed(1)}KB)</span><button class="file-remove" onclick="clearChatUpload()"></button>`;
  }
  preview.classList.add("show");
}
function clearChatUpload() {
  chatFileData = null;
  const preview = $("#chatUploadPreview");
  if (preview) { preview.innerHTML = ""; preview.classList.remove("show"); }
  const input = $("#chatFileInput");
  if (input) input.value = "";
}

// 聊天：展开 / 收起完整对话
$("#chatToggle").addEventListener("click", () => {
  CHAT_EXPANDED = !CHAT_EXPANDED;
  renderChat();
});

// ---------- 按阶段智能推荐下一步 ----------
const STAGE_NEXT_HINTS = {
  screening:    ["关注邮箱/短信筛选通知", "准备笔试通用知识（行测/逻辑）", "同步跟进内推进度"],
  review:       ["关注邮箱/短信评估通知", "了解公司产品线最新动态", "准备可能的产品笔试题"],
  passed_resume: ["刷历年笔试真题", "复习产品分析框架（SWOT/PEST/用户旅程）", "关注笔试链接发送"],
  written_pending: ["等笔试链接；超 5 工作日可礼貌催问", "提前熟悉在线笔试平台（北森/牛客）", "复习行测+产品常识"],
  written_done:  ["整理笔试错题复盘", "准备可能的面试自我介绍", "关注面试通知（邮件/电话/短信）"],
  ai_interview:  ["准备 AI 面试题（产品认知/案例分析）", "练习 STAR 法则讲故事", "调试摄像头/麦克风网络环境"],
  mian_1:       ["准备一面：深挖简历每个项目", "研究竞品，准备观点输出", "模拟面试对练"],
  mian_2:       ["准备二面：业务场景设计题", "准备反问面试官的问题", "总结一面经验调整策略"],
  mian_3:       ["准备三面/HR 面：薪资预期/职业规划", "了解团队文化、近期动态", "准备「为什么选我们」的回答"],
  ended:        ["记录挂的原因和阶段", "复盘改进点", "继续投递其他机会"],
  offer:        ["确认 offer 细节（薪资/时间/地点）", "了解入职流程", "感谢帮助过你的人"],
};

function getNextDisplay(app) {
  // 有自定义内容优先显示
  if (app.next && app.next !== "等结果") return app.next;
  // 根据阶段给默认建议
  const hints = STAGE_NEXT_HINTS[app.stageKey] || [];
  return hints[0] || "待更新";
}
const STAGES = [
  ["screening", "简历筛选中"], ["review", "简历评估中"], ["passed_resume", "已过简历笔试"],
  ["written_pending", "待笔试"], ["written_done", "笔试已结束"], ["ai_interview", "待 AI 面试"],
  ["mian_1", "待一面"], ["mian_2", "待二面"], ["mian_3", "待三面"],
  ["ended", "流程结束"], ["offer", "已 offer"],
];
const STAGE_LABEL = Object.fromEntries(STAGES);

function renderApps() {
  const apps = STATE.applications;
  $("#appCount").textContent = apps.length;
  // funnel（按流水线顺序，从 STAGES 派生）
  const order = STAGES.map(([k]) => k);
  const counts = {};
  apps.forEach((a) => (counts[a.stageKey] = (counts[a.stageKey] || 0) + 1));
  const max = Math.max(1, ...Object.values(counts));
  $("#funnel").innerHTML = order.map((k) => `
    <div class="fn-row">
      <div class="fn-label">${STAGE_LABEL[k]}</div>
      <div class="fn-bar"><div class="fn-fill" style="width:${((counts[k] || 0) / max) * 100}%"></div></div>
      <div class="fn-count">${counts[k] || 0}</div>
    </div>`).join("");
  // table
  let html = `<div class="app-row head"><div>公司</div><div>岗位</div><div>阶段（可改）</div><div>下一步</div><div></div></div>`;
  html += apps.map((a) => `
    <div class="app-row" data-id="${a.id}">
      <div>${esc(a.company)}</div>
      <div>${esc(a.role)}</div>
      <div><select class="stage-sel" data-id="${a.id}">
        ${STAGES.map(([k, l]) => `<option value="${k}" ${k === a.stageKey ? "selected" : ""}>${l}</option>`).join("")}
      </select></div>
      <div class="next-cell" data-id="${a.id}" title="点击编辑下一步">
        <span class="next-text">${esc(getNextDisplay(a))}</span>
        <input class="next-input" type="text" value="${esc(a.next || "")}" placeholder="写下一步…" style="display:none" />
      </div>
      <div><button class="del" data-id="${a.id}">×</button></div>
    </div>`).join("");
  $("#appTable").innerHTML = html;
  $$(".stage-sel").forEach((s) => s.addEventListener("change", async (e) => {
    const id = e.target.dataset.id; const k = e.target.value;
    const app = STATE.applications.find((x) => x.id === id);
    app.stageKey = k; app.stage = STAGE_LABEL[k];
    await api("/api/applications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(app) });
    toast("已更新阶段：" + STAGE_LABEL[k]);
  }));
  $$(".del").forEach((b) => b.addEventListener("click", async (e) => {
    await api("/api/applications/" + e.target.dataset.id, { method: "DELETE" });
    STATE.applications = STATE.applications.filter((x) => x.id !== e.target.dataset.id);
    renderApps();
  }));
  // 下一步内联编辑
  $$(".next-cell").forEach((cell) => {
    const txt = cell.querySelector(".next-text");
    const inp = cell.querySelector(".next-input");
    txt.addEventListener("click", () => {
      txt.style.display = "none";
      inp.style.display = "";
      inp.focus();
      inp.select();
    });
    inp.addEventListener("blur", async () => {
      const id = cell.dataset.id;
      const val = inp.value.trim();
      const app = STATE.applications.find((x) => x.id === id);
      if (app) {
        app.next = val;
        await api("/api/applications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(app) });
        txt.textContent = val || getNextDisplay(app);
      }
      txt.style.display = "";
      inp.style.display = "none";
    });
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") inp.blur(); if (e.key === "Escape") { inp.value = app.next || ""; inp.blur(); } });
  });
}

let showAdd = false;
$("#addAppBtn").addEventListener("click", () => {
  if (showAdd) { $("#addForm").remove(); showAdd = false; return; }
  showAdd = true;
  const f = document.createElement("div");
  f.id = "addForm"; f.className = "form"; f.style.marginBottom = "14px";
  f.innerHTML = `
    <input id="naCompany" placeholder="公司" />
    <input id="naRole" placeholder="岗位" />
    <select id="naStage">${STAGES.map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select>
    <input id="naNext" placeholder="下一步动作" />
    <button class="btn primary" id="naSave">保存</button>`;
  $("#appTable").before(f);
  $("#naSave").addEventListener("click", async () => {
    const app = {
      company: $("#naCompany").value.trim() || "未命名",
      role: $("#naRole").value.trim(),
      stageKey: $("#naStage").value,
      stage: STAGE_LABEL[$("#naStage").value],
      next: $("#naNext").value.trim(),
      applyDate: "", interviewAt: "", contact: "", channel: "",
    };
    const j = await api("/api/applications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(app) });
    STATE.applications = j.applications; f.remove(); showAdd = false; renderApps(); toast("已新增投递");
  });
});

// ---------- interviews ----------
function ddlStatus(ddl) {
  if (!ddl) return { cls: "empty", label: "未设截止" };
  const now = Date.now();
  const d = new Date(ddl).getTime();
  const diff = d - now;
  if (diff < 0) return { cls: "overdue", label: "已过期" };
  if (diff < 24 * 3600 * 1000) return { cls: "soon", label: "即将到期" };
  return { cls: "normal", label: fmtDdl(ddl) };
}
function fmtDdl(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
}

function renderInterviews() {
  const upcoming = STATE.interviews.filter((iv) => iv.type !== "historical");
  const historical = STATE.interviews.filter((iv) => iv.type === "historical");

  $("#upcomingCount").textContent = upcoming.length;
  $("#histCount").textContent = historical.length;

  // 即将面试列表
  $("#ivUpcoming").innerHTML = upcoming.length
    ? upcoming.map((iv) => {
        const ds = ddlStatus(iv.ddl);
        return `<div class="iv-item" data-id="${iv.id}">
          <div class="iv-item-header">
            <div>
              <div class="iv-item-title">${esc(iv.company)} · ${esc(iv.role)}</div>
              <div class="iv-item-meta">创建于 ${iv.createdAt}</div>
            </div>
            <span class="ddl-tag ${ds.cls}">${ds.label}</span>
          </div>
          <div class="iv-item-actions" style="margin-top:6px;display:flex;gap:6px;align-items:center">
            <input type="datetime-local" class="ddl-edit" data-id="${iv.id}" value="${iv.ddl || ""}" placeholder="截止时间" style="flex:1;font-size:12px;padding:4px 8px;border:1px solid var(--line);border-radius:6px" />
            <button class="btn ddl-save-btn" data-id="${iv.id}" style="padding:4px 10px;font-size:12px">保存DDL</button>
            ${iv.ddl ? `<button class="btn primary cal-remind-btn" data-id="${iv.id}" style="padding:4px 10px;font-size:12px">日历提醒</button>` : ""}
          </div>
        </div>`;
      }).join("")
    : "<span class='hint'>暂无即将进行的面试。</span>";

  // 历史面试列表
  $("#ivHistorical").innerHTML = historical.length
    ? historical.map((iv) => `<div class="iv-item" data-id="${iv.id}">
      <div class="iv-item-header">
        <div>
          <div class="iv-item-title">${esc(iv.company)} · ${esc(iv.role)}
            <span class="status-badge status-${iv.status || "rejected"}">${iv.status === "passed" ? "通过" : "挂了"}</span>
          </div>
          <div class="iv-item-meta">创建于 ${iv.createdAt}${iv.resultNote ? " · " + esc(iv.resultNote) : ""}</div>
        </div>
      </div>
    </div>`).join("")
    : "<span class='hint'>暂无历史面试记录。</span>";

  // 绑定点击
  $$("#ivUpcoming .iv-item, #ivHistorical .iv-item").forEach((el) =>
    el.addEventListener("click", () => openInterview(el.dataset.id))
  );

  // DDL 保存
  $$(".ddl-save-btn").forEach((btn) => btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const id = btn.dataset.id;
    const input = document.querySelector(`.ddl-edit[data-id="${id}"]`);
    const ddl = input.value;
    const iv = STATE.interviews.find((x) => x.id === id);
    if (iv) { iv.ddl = ddl; }
    // 调后端持久化
    fetch("/api/interviews/" + id + "/ddl", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ddl }),
    }).then(() => { renderInterviews(); toast("DDL 已保存" + (ddl ? `：${fmtDdl(ddl)}` : "（已清除）")); })
      .catch(() => toast("保存失败"));
  }));

  // 日历提醒按钮
  $$(".cal-remind-btn").forEach((btn) => btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const id = btn.dataset.id;
    const iv = STATE.interviews.find((x) => x.id === id);
    if (!iv || !iv.ddl) return;
    toast("正在创建日历提醒：" + iv.company + " " + iv.role + " " + new Date(iv.ddl).toLocaleString("zh-CN"));
    // 调后端创建日历事件
    fetch("/api/interviews/" + id + "/remind", { method: "POST" })
      .then((r) => r.json())
      .then((j) => { if (j.ok) toast("日历提醒已创建！"); else toast("" + (j.error || "创建失败")); })
      .catch(() => toast("日历提醒创建失败，请检查企微连接"));
  }));
}
async function openInterview(id) {
  $$("#ivUpcoming .iv-item, #ivHistorical .iv-item").forEach((x) => x.classList.remove("active"));
  const el = document.querySelector(`.iv-item[data-id="${id}"]`);
  if (el) el.classList.add("active");
  const iv = STATE.interviews.find((x) => x.id === id);
  const p = iv.prep || {};
  const ds = ddlStatus(iv.ddl);
  $("#ivDetail").innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center">
      <h3>${esc(iv.company)} · ${esc(iv.role)}</h3>
      ${iv.type !== "historical" ? `<span class="ddl-tag ${ds.cls}">${ds.label}</span>` : `<span class="status-badge status-${iv.status || "rejected"}">${iv.status === "passed" ? "通过" : "挂了"}</span>`}
    </div>
    ${iv.ddl && iv.type !== "historical" ? `<p style="font-size:12px;color:var(--muted);margin-bottom:8px">截止时间：${new Date(iv.ddl).toLocaleString("zh-CN")}</p>` : ""}
    ${iv.resultNote ? `<p style="font-size:12px;color:var(--muted);margin-bottom:8px">备注：${esc(iv.resultNote)}</p>` : ""}
    <div class="prep">
      <h4>① 结合 JD 的自我介绍</h4><p>${esc(p.selfIntro || "（暂无）")}</p>
      <h4>② 面试官可能问的问题 & 建议回答</h4>
      <ul>${(p.questions || []).map((q) => `<li><b>Q：${esc(q.q)}</b><br>A：${esc(q.a)}</li>`).join("") || "<li>暂无</li>"}</ul>
      <h4>③ 建议提前储备的知识 / 动作</h4><p>${esc(p.knowledge || "（暂无）")}</p>
    </div>
    <h4 style="margin-top:14px">继续追问（问答窗口）</h4>
    <div class="qa-log" id="qaLog">${(iv.chat || []).map((m) => `<div class="msg ${m.role === "user" ? "user" : "ai"}">${esc(m.text)}</div>`).join("")}</div>
    <div class="qa-input"><input id="qaInput" placeholder="针对这场面试继续问…" /><button class="btn primary" id="qaSend">问</button></div>
    <div class="row-between" style="margin-top:18px">
      <h4>AI 模拟面试</h4>
      <div style="display:flex;gap:8px">
        <button class="btn" id="mockStart">开始 / 重来</button>
        <button class="btn" id="mockEnd">结束并评价</button>
      </div>
    </div>
    <p class="hint">让 AI 扮演面试官连续追问——答得浅、没数据，它就会追着问一层。结束后给整场评分和改进清单。</p>
    <div class="qa-log" id="mockLog">${(iv.mock || []).map((m) => `<div class="msg ${m.role === "user" ? "user" : "ai"}">${esc(m.text)}</div>`).join("")}</div>
    <div class="qa-input"><input id="mockInput" placeholder="你的回答…（先点「开始」，AI 会先提问）" /><button class="btn primary" id="mockSend">回答</button></div>
    <div id="mockResult">${iv.mockResult ? renderMockResultHtml(iv.mockResult) : ""}</div>`;
  bindMock(id, iv);
  const log = $("#qaLog");
  $("#qaSend").addEventListener("click", async () => {
    const v = $("#qaInput").value.trim(); if (!v) return;
    $("#qaInput").value = "";
    log.innerHTML += `<div class="msg user">${esc(v)}</div>`; log.scrollTop = log.scrollHeight;
    const ai = document.createElement("div"); ai.className = "msg ai"; ai.textContent = "思考中…"; log.appendChild(ai);
    try {
      const j = await api("/api/interviews/" + id + "/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: v }) });
      ai.textContent = j.reply;
      iv.chat = iv.chat || []; iv.chat.push({ role: "user", text: v }, { role: "assistant", text: j.reply });
    } catch (e) { ai.textContent = "" + e.message; }
    log.scrollTop = log.scrollHeight;
  });
}

$("#ivImage").addEventListener("change", (e) => {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = () => { ivImageData = reader.result; $("#ivPreview").innerHTML = `<img src="${ivImageData}" />`; };
  reader.readAsDataURL(file);
});

$("#ivCreate").addEventListener("click", async () => {
  const company = $("#ivCompany").value.trim();
  const role = $("#ivRole").value.trim();
  const jdText = $("#ivText").value.trim();
  const type = $("#ivType").value || "upcoming";
  const ddl = $("#ivDdl").value || "";
  if (!company && !jdText && !ivImageData) { toast("请至少填写公司或 JD"); return; }
  $("#ivCreate").textContent = "生成中…";
  try {
    const j = await api("/api/interviews", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company, role, jdText, jdImage: ivImageData, type, ddl }),
    });
    STATE.interviews.push(j.interview);
    renderInterviews(); openInterview(j.interview.id);
    toast("备战建议已生成");
  } catch (e) { toast("" + e.message); }
  $("#ivCreate").textContent = "生成备战建议";
});

// ---------- works ----------
function renderWorks() {
  $("#worksGrid").innerHTML = STATE.works.map((w) => `
    <div class="work">
      <h4>${esc(w.name)}</h4>
      <div class="tag">${esc(w.type)}</div>
      <p>${esc(w.desc)}</p>
      <div class="hl">技术：${esc(w.tech)}</div>
      <div class="hl">亮点：${(w.highlights || []).join("、")}</div>
      <div class="link">${esc(w.link)}</div>
    </div>`).join("");
}

// ---------- 待办清单 ----------
const TODO_CATS = ["面试", "笔试", "论文", "刷题", "简历", "投递", "其他"];
const CAT_CLASS = {
  面试: "cat-interview", 笔试: "cat-written", 论文: "cat-thesis",
  刷题: "cat-practice", 简历: "cat-resume", 投递: "cat-apply", 其他: "cat-other",
};
let TD_FILTER = "active";
let TD_CAT = "";
let TD_EDIT_ID = null;

const PRI_LABEL = { high: "高", medium: "中", low: "低" };
function priLabel(p) { return PRI_LABEL[p] || "中"; }
function catClass(c) { return CAT_CLASS[c] || "cat-other"; }

function populateTdCatList() {
  $("#tdCatList").innerHTML = TODO_CATS.map((c) => `<option value="${esc(c)}">`).join("");
}

function dueInfo(t) {
  if (!t.due) return null;
  const today = new Date().toISOString().slice(0, 10);
  if (t.done) return { cls: "td-due done", text: "已完成" };
  if (t.due < today) {
    const d = Math.max(1, Math.round((new Date(today) - new Date(t.due)) / 864e5));
    return { cls: "td-due overdue", text: "已逾期 " + d + " 天" };
  }
  const days = Math.round((new Date(t.due) - new Date(today)) / 864e5);
  if (days <= 3) return { cls: "td-due soon", text: "还有 " + days + " 天" };
  return { cls: "td-due", text: t.due };
}

function cmpTodo(a, b) {
  if (a.done !== b.done) return a.done ? 1 : -1;
  const today = new Date().toISOString().slice(0, 10);
  const ao = a.due && a.due < today && !a.done ? 0 : 1;
  const bo = b.due && b.due < today && !b.done ? 0 : 1;
  if (ao !== bo) return ao - bo;
  if (a.due && b.due) { if (a.due !== b.due) return a.due < b.due ? -1 : 1; }
  else if (a.due !== b.due) return a.due ? -1 : 1;
  const pw = { high: 0, medium: 1, low: 2 };
  if (pw[a.priority] !== pw[b.priority]) return pw[a.priority] - pw[b.priority];
  return (b.createdAt || "") > (a.createdAt || "") ? 1 : -1;
}

function buildSummary() {
  const today = new Date().toISOString().slice(0, 10);
  const active = (STATE.todos || []).filter((t) => !t.done);
  const overdue = active.filter((t) => t.due && t.due < today).length;
  const soon = active.filter((t) => t.due && t.due >= today &&
    Math.round((new Date(t.due) - new Date(today)) / 864e5) <= 3).length;
  const done = (STATE.todos || []).filter((t) => t.done).length;
  const parts = [];
  if (overdue) parts.push(`<b class="warn">${overdue} 项逾期</b>`);
  if (soon) parts.push(`<b class="soon">${soon} 项本周到期</b>`);
  parts.push(`未完成 ${active.length} · 已完成 ${done}`);
  return parts.join(" ｜ ");
}

function renderTodoCats(presets) {
  const used = [...new Set((STATE.todos || []).map((t) => t.category))];
  const cats = [...new Set([...(presets || TODO_CATS), ...used])];
  $("#tdCatFilters").innerHTML =
    `<button class="chip ${TD_CAT === "" ? "active" : ""}" data-cat="">全部分类</button>` +
    cats.map((c) => `<button class="chip ${TD_CAT === c ? "active" : ""}" data-cat="${esc(c)}">${esc(c)}</button>`).join("");
}

function renderTodos() {
  if (!STATE.todos) STATE.todos = [];
  const list = STATE.todos.filter((t) => {
    if (TD_FILTER === "active" && t.done) return false;
    if (TD_FILTER === "done" && !t.done) return false;
    if (TD_CAT && t.category !== TD_CAT) return false;
    return true;
  }).sort(cmpTodo);

  $("#tdSummary").innerHTML = buildSummary();
  const wrap = $("#tdList");
  if (!list.length) {
    wrap.innerHTML = "";
    $("#tdEmpty").style.display = "block";
    return;
  }
  $("#tdEmpty").style.display = "none";
  wrap.innerHTML = list.map((t) => {
    const di = dueInfo(t);
    const steps = (t.steps || []).map((s, i) => `
      <label class="td-step ${s.done ? "done" : ""}">
        <input type="checkbox" data-act="step" data-i="${i}" ${s.done ? "checked" : ""} />
        <span>${esc(s.text)}</span>
      </label>`).join("");
    return `
    <div class="td-item ${t.done ? "done" : ""}" data-id="${t.id}">
      <input type="checkbox" class="td-check" data-act="toggle" ${t.done ? "checked" : ""} title="标记完成" />
      <div class="td-body">
        <div class="td-top">
          <span class="td-title">${esc(t.title)}</span>
          <span class="td-cat ${catClass(t.category)}">${esc(t.category)}</span>
          <span class="td-pri pri-${t.priority}">${priLabel(t.priority)}</span>
          ${di ? `<span class="${di.cls}">${di.text}</span>` : ""}
        </div>
        ${t.note ? `<div class="td-note">${esc(t.note)}</div>` : ""}
        ${steps ? `<div class="td-steps">${steps}</div>` : ""}
      </div>
      <div class="td-actions">
        ${STATE.hasKey ? `<button class="btn-mini" data-act="breakdown">AI 拆解</button>` : ""}
        <button class="btn-mini" data-act="edit">编辑</button>
        <button class="btn-mini danger" data-act="del">删除</button>
      </div>
    </div>`;
  }).join("");
}

async function refreshTodos() {
  try {
    const j = await api("/api/todos");
    STATE.todos = j.todos || [];
    renderTodoCats(j.categories || TODO_CATS);
    renderTodos();
    updateTodoTab();
  } catch (e) { toast(e.message); }
}

/** 统一的侧边栏角标刷新：待办(未完成) / 投递(总数) / 面试(即将) */
function setBadge(id, n, always) {
  const b = $("#" + id);
  if (!b) return;
  if (n > 0) { b.textContent = n; b.style.display = "inline-block"; }
  else b.style.display = always ? "inline-block" : "none";
}
function updateTodoTab() {
  const n = (STATE.todos || []).filter((t) => !t.done).length;
  setBadge("navTodoCount", n);
  if ($("#dashboard") && $("#dashboard").classList.contains("active")) renderDashboard();
}
function updateCounts() {
  setBadge("navTodoCount", (STATE.todos || []).filter((t) => !t.done).length);
  setBadge("navAppsCount", (STATE.applications || []).length);
  const soon = (STATE.interviews || []).filter((i) => i.type !== "historical").length;
  setBadge("navIvCount", soon);
}

function resetTdForm() {
  TD_EDIT_ID = null;
  $("#tdTitle").value = "";
  $("#tdCategory").value = "";
  $("#tdPriority").value = "medium";
  $("#tdDue").value = "";
  $("#tdNote").value = "";
  $("#tdFormTitle").textContent = "添加待办";
  $("#tdAddBtn").textContent = "+ 添加待办";
  $("#tdCancelEdit").style.display = "none";
}

$("#tdAddBtn").addEventListener("click", async () => {
  const title = $("#tdTitle").value.trim();
  if (!title) { toast("请填写待办内容"); return; }
  const body = {
    title,
    category: $("#tdCategory").value.trim() || "其他",
    priority: $("#tdPriority").value,
    due: $("#tdDue").value,
    note: $("#tdNote").value.trim(),
  };
  try {
    if (TD_EDIT_ID) {
      await api(`/api/todos/${TD_EDIT_ID}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      toast("已更新");
    } else {
      await api("/api/todos", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      toast("已添加");
    }
    resetTdForm();
    await refreshTodos();
  } catch (e) { toast(e.message); }
});

$("#tdCancelEdit").addEventListener("click", resetTdForm);

$("#tdFilters").addEventListener("click", (e) => {
  const b = e.target.closest("[data-filter]");
  if (!b) return;
  TD_FILTER = b.dataset.filter;
  $$("#tdFilters .chip").forEach((x) => x.classList.remove("active"));
  b.classList.add("active");
  renderTodos();
});

$("#tdCatFilters").addEventListener("click", (e) => {
  const b = e.target.closest("[data-cat]");
  if (!b) return;
  TD_CAT = b.dataset.cat;
  $$("#tdCatFilters .chip").forEach((x) => x.classList.remove("active"));
  b.classList.add("active");
  renderTodos();
});

$("#tdList").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const item = e.target.closest(".td-item");
  const id = item?.dataset.id;
  const act = btn.dataset.act;
  const t = (STATE.todos || []).find((x) => x.id === id);
  if (!t) return;

  if (act === "toggle") {
    try {
      await api(`/api/todos/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ done: !t.done }),
      });
      await refreshTodos();
    } catch (err) { toast(err.message); }
    return;
  }
  if (act === "step") {
    const i = +btn.dataset.i;
    t.steps[i].done = btn.checked;
    try {
      await api(`/api/todos/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ steps: t.steps }),
      });
      renderTodos();
    } catch (err) { toast(err.message); }
    return;
  }
  if (act === "edit") {
    TD_EDIT_ID = id;
    $("#tdTitle").value = t.title;
    $("#tdCategory").value = t.category;
    $("#tdPriority").value = t.priority;
    $("#tdDue").value = t.due || "";
    $("#tdNote").value = t.note || "";
    $("#tdFormTitle").textContent = "编辑待办";
    $("#tdAddBtn").textContent = "保存修改";
    $("#tdCancelEdit").style.display = "inline-block";
    $("#tdTitle").focus();
    return;
  }
  if (act === "del") {
    if (!confirm("确定删除这条待办？")) return;
    try {
      await api(`/api/todos/${id}`, { method: "DELETE" });
      toast("已删除");
      await refreshTodos();
    } catch (err) { toast(err.message); }
    return;
  }
  if (act === "breakdown") {
    btn.disabled = true;
    btn.textContent = "拆解中…";
    try {
      const j = await api(`/api/todos/${id}/breakdown`, { method: "POST" });
      if (j.ok) toast("已生成拆解步骤");
      else toast(j.message || "拆解失败");
      await refreshTodos();
    } catch (err) { toast(err.message); }
    finally { btn.disabled = false; btn.textContent = "AI 拆解"; }
  }
});

// ---------- 工作台（把进度 / 待办 / 面试 / 分析融合到一个界面） ----------
let INSIGHT = null;

function renderDashboard() {
  if (!STATE) return;
  const apps = STATE.applications || [];
  const ivs = STATE.interviews || [];
  const todos = STATE.todos || [];
  const offers = STATE.offers || [];
  const today = new Date().toISOString().slice(0, 10);
  const active = todos.filter((t) => !t.done);
  const overdue = active.filter((t) => t.due && t.due < today).length;
  const soon = active.filter((t) => t.due && t.due >= today &&
    Math.round((new Date(t.due) - new Date(today)) / 864e5) <= 3).length;
  const goingOn = apps.filter((a) => a.stageKey !== "rejected").length;
  const upcomingIv = ivs.filter((i) => i.type !== "historical").length;

  const stats = [
    { label: "进行中的投递", value: goingOn, hint: `共 ${apps.length} 家` },
    { label: "未完成待办", value: active.length, hint: overdue ? `${overdue} 项逾期` : (soon ? `${soon} 项临期` : "节奏正常") },
    { label: "接下来的面试", value: upcomingIv, hint: `历史 ${ivs.length - upcomingIv} 场` },
    { label: "已收 Offer", value: offers.length, hint: offers.length ? "可比一比" : "继续冲" },
  ];
  $("#dashStats").innerHTML = stats.map((s) => `
    <div class="stat">
      <div class="stat-label">${esc(s.label)}</div>
      <div class="stat-value">${s.value}</div>
      <div class="stat-hint ${s.hint && s.hint.includes("逾期") ? "warn" : ""}">${esc(s.hint || "")}</div>
    </div>`).join("");

  const tdList = [...active].sort(cmpTodo).slice(0, 5);
  $("#dashTodos").innerHTML = tdList.length
    ? tdList.map((t) => {
        const di = dueInfo(t);
        return `<div class="td-item dash-row">
          <div class="td-body">
            <div class="td-top">
              <span class="td-title">${esc(t.title)}</span>
              <span class="td-cat ${catClass(t.category)}">${esc(t.category)}</span>
              ${di ? `<span class="${di.cls}">${di.text}</span>` : ""}
            </div>
          </div>
        </div>`;
      }).join("")
    : `<div class="empty">今天没有待办，干净</div>`;

  const upList = ivs.filter((i) => i.type !== "historical").slice(0, 5);
  $("#dashInterviews").innerHTML = upList.length
    ? upList.map((i) => `
      <div class="td-item dash-row">
        <div class="td-body">
          <div class="td-top">
            <span class="td-title">${esc(i.company)} · ${esc(i.role)}</span>
            ${i.ddl ? `<span class="td-due">${esc(fmtDdl(i.ddl))}</span>` : ""}
          </div>
        </div>
      </div>`).join("")
    : `<div class="empty">还没有安排面试</div>`;
}

// ---------- 导出（Word / Excel，服务端生成后直接下载） ----------
async function downloadExport(path, body, fallbackName) {
  try {
    const r = await fetch(path, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.error || "导出失败");
    }
    const blob = await r.blob();
    const cd = r.headers.get("Content-Disposition") || "";
    const m = cd.match(/filename\*=UTF-8''(.+)/);
    const name = m ? decodeURIComponent(m[1]) : fallbackName;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1200);
    toast("已导出 " + name);
  } catch (e) { toast(e.message); }
}

$("#appExportBtn").addEventListener("click", () => {
  if (!(STATE.applications || []).length) { toast("还没有投递记录"); return; }
  downloadExport("/api/export/applications", {}, "投递清单.xlsx");
});

$("#insightExportBtn").addEventListener("click", () => {
  const d = INSIGHT;
  if (!d) { toast("数据还在加载，稍等一下"); return; }
  const s = d.summary || {};
  const overview = [["指标", "数值"]];
  Object.entries(s).forEach(([k, v]) => overview.push([k, typeof v === "number" ? v : String(v)]));
  const funnel = [["环节", "数量"], ...((d.funnel || []).map((f) => [f.label || f.stage || "", f.count ?? f.value ?? ""]))];
  const conv = [["环节", "转化率"], ...((d.conversion || []).map((c) => [c.label || c.stage || "", c.rate ?? c.value ?? ""]))];
  const channels = [["渠道", "投递数", "进面数"], ...((d.channels || []).map((c) => [c.channel || c.name || "", c.total ?? "", c.interview ?? c.passed ?? ""]))];
  downloadExport("/api/export/xlsx", {
    sheets: [overview, funnel, conv, channels].map((rows, i) => ({
      name: ["总览", "漏斗", "转化率", "渠道"][i], rows,
    })),
    filename: "求职洞察",
  }, "求职洞察.xlsx");
});

$("#chatExportBtn").addEventListener("click", () => {
  const hist = (STATE.profile && STATE.profile.chatHistory) || [];
  if (!hist.length) { toast("还没有对话内容"); return; }
  const blocks = [];
  hist.slice(-20).forEach((m) => {
    blocks.push({ type: "h2", text: m.role === "user" ? "我" : "AI 助手" });
    String(m.text || "").split(/\r?\n/).filter((x) => x.trim())
      .forEach((line) => blocks.push({ type: "p", text: line.trim() }));
  });
  downloadExport("/api/export/docx", { title: "对话记录", blocks, filename: "对话记录" }, "对话记录.docx");
});

// ---------- AI 内容：结构化排版 + 要点提取 ----------
/** 从 AI 文本里抽出要点（标题行 + 列表项；没有结构就取前几句） */
function extractPoints(text) {
  if (!text) return [];
  const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const pts = [];
  for (const l of lines) {
    if (/^#{1,3}\s+/.test(l)) { pts.push({ t: l.replace(/^#{1,3}\s+/, ""), k: "h" }); continue; }
    if (/^[-*•·]\s+/.test(l)) { pts.push({ t: l.replace(/^[-*•·]\s+/, "").replace(/\*\*/g, ""), k: "li" }); continue; }
    if (/^\d+[.、)]\s+/.test(l)) { pts.push({ t: l.replace(/^\d+[.、)]\s+/, "").replace(/\*\*/g, ""), k: "li" }); continue; }
  }
  if (!pts.length) {
    String(text).split(/[。！？\n]/).map((s) => s.trim())
      .filter((s) => s.length > 8).slice(0, 4)
      .forEach((s) => pts.push({ t: s.replace(/\*\*/g, ""), k: "li" }));
  }
  return pts.slice(0, 8);
}

function renderPoints(id, points) {
  const box = $("#" + id);
  if (!box) return;
  if (!points || !points.length) {
    box.innerHTML = `<div class="ai-points-title">要点</div><div class="ai-points-empty">聊完之后，这里只留结论</div>`;
    return;
  }
  box.innerHTML = `<div class="ai-points-title">要点</div><ul class="ai-points-list">` +
    points.map((p) => `<li class="${p.k === "h" ? "pt-h" : ""}">${esc(p.t)}</li>`).join("") +
    `</ul>`;
}

// ---------- settings ----------
$("#setSave").addEventListener("click", async () => {
  const key = $("#setKey").value.trim();
  const model = $("#setModel").value.trim() || "deepseek-chat";
  try {
    const j = await api("/api/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey: key, model }) });
    $("#setMsg").innerHTML = `<span class="msg-line ok">已保存。${j.hasKey ? "API Key 已设置 " : ""}</span>`;
    $("#keyBadge").textContent = j.hasKey ? "API Key：已设置" : "API Key：未设置";
    $("#keyBadge").classList.toggle("ok", j.hasKey);
    STATE.hasKey = j.hasKey;
    // 同步 AI 功能提示横幅
    const notice = $("#aiNotice");
    if (j.hasKey) { notice.style.display = "none"; }
    else { notice.style.display = "block"; }
  } catch (e) { $("#setMsg").innerHTML = `<span class="msg-line err">${e.message}</span>`; }
});

// ---------- Agent（嵌入 dsh 的 offer-pilot 技能） ----------
let AGENT = null;          // 技能元信息缓存
let AGENT_CURRENT = null;  // 当前打开的工作台 { key, name, history }
async function loadAgent() {
  try {
    AGENT = await api("/api/agent/skills");
    if (!AGENT.available) {
      $("#agentUnavailable").style.display = "block";
      $("#agentSkillGrid").innerHTML = "";
      return;
    }
    // 顶部元信息
    $("#agentMeta").innerHTML = `
      技能：<code>${esc(AGENT.name)}</code> · 知识库：
      <span class="kb-list">${(AGENT.kbFiles || []).map(esc).join("、")}</span>`;
    // 渲染 4 大功能卡片
    $("#agentSkillGrid").innerHTML = AGENT.skills.map((s) => `
      <div class="agent-skill-card ${s.color || "blue"}" data-key="${esc(s.key)}">
        <div class="agent-skill-head">
          <div class="agent-skill-name">${esc(s.name)}</div>
          <div class="agent-skill-num">${s.index}</div>
        </div>
        ${s.trigger ? `<div class="agent-skill-trigger"><b>触发：</b>${esc(s.trigger)}</div>` : ""}
        <div class="agent-skill-steps">
          ${(s.steps || []).map((st) => `
            <div class="agent-skill-step">
              <div class="step-num">${st.num}</div>
              <div class="step-content"><b>${esc(st.title)}</b>：${esc(st.desc)}</div>
            </div>`).join("")}
        </div>
      </div>`).join("");
    // 绑定点击进入工作台
    $$(".agent-skill-card").forEach((card) => {
      card.addEventListener("click", () => openAgentWorkspace(card.dataset.key));
    });
  } catch (e) {
    $("#agentSkillGrid").innerHTML = `<span class="hint">${e.message}</span>`;
  }
}

function openAgentWorkspace(skillKey) {
  const skill = AGENT.skills.find((s) => s.key === skillKey);
  if (!skill) return;
  AGENT_CURRENT = { key: skill.key, name: skill.name, history: [] };
  $("#agentCurrentSkill").textContent = skill.name;
  $("#agentSkillDesc").innerHTML = (skill.trigger ? `<b>触发：</b>${esc(skill.trigger)}<br>` : "") +
    (skill.steps && skill.steps.length ? `<b>包含子能力：</b>${skill.steps.map((s) => `${s.num}.${esc(s.title)}`).join("、")}` : "");
  $("#agentChatLog").innerHTML = `<div style="text-align:center;color:var(--gray);padding:40px 0;font-size:13.5px">
    <div style="font-size:32px;margin-bottom:8px"></div>
    ${esc(skill.name)} · 已就绪<br><span style="font-size:12px">结合你的知识库（经历库/岗位清单/追踪表/面试备战）回答</span>
  </div>`;
  $("#agentInput").value = "";
  $("#agentWorkspace").style.display = "block";
  $("#agentInput").focus();
  // 滚动到工作台
  $("#agentWorkspace").scrollIntoView({ behavior: "smooth", block: "start" });
}

$("#agentBackBtn").addEventListener("click", () => {
  $("#agentWorkspace").style.display = "none";
  AGENT_CURRENT = null;
});

$("#agentSend").addEventListener("click", async () => {
  if (!AGENT_CURRENT) return;
  const v = $("#agentInput").value.trim();
  if (!v) return;
  $("#agentInput").value = "";
  const log = $("#agentChatLog");
  if (log.querySelector("div[style*='text-align:center']")) log.innerHTML = "";
  const now = new Date().toISOString();
  // 用户消息
  log.innerHTML += `<div class="chat-row user">
    <div class="chat-avatar user-avatar">我</div>
    <div><div class="chat-bubble">${esc(v)}</div><div class="chat-time">${fmtTime(now)}</div></div>
  </div>`;
  log.scrollTop = log.scrollHeight;
  // 思考中
  const aiRow = document.createElement("div");
  aiRow.className = "chat-row ai";
  aiRow.innerHTML = `<div class="chat-avatar ai-avatar"><img src="assets/cat-mascot.svg" alt="助手" onerror="this.outerHTML='AI'" /></div><div><div class="chat-bubble" style="color:var(--gray)">思考中…</div></div>`;
  log.appendChild(aiRow); log.scrollTop = log.scrollHeight;
  try {
    const j = await api("/api/agent/invoke", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        skillKey: AGENT_CURRENT.key,
        message: v,
        history: AGENT_CURRENT.history,
      }),
    });
    aiRow.querySelector(".chat-bubble").textContent = "";
    aiRow.querySelector(".chat-bubble").innerHTML = formatAiReply(j.reply);
    const t = document.createElement("div");
    t.className = "chat-time"; t.textContent = fmtTime(new Date().toISOString());
    aiRow.querySelector("div > div").appendChild(t);
    AGENT_CURRENT.history.push({ role: "user", text: v }, { role: "assistant", text: j.reply });
  } catch (e) {
    aiRow.querySelector(".chat-bubble").textContent = "" + e.message;
  }
  log.scrollTop = log.scrollHeight;
});

// 支持 Cmd+Enter 发送
// 回车直接发送（Shift+Enter 换行）
$("#agentInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#agentSend").click(); }
});

// ---------- 面试复盘（面试后沉淀，形成"备战实战复盘迭代"闭环） ----------
let REVIEWS = [];
let RV_SUMMARY = null;

async function loadReviews() {
  try {
    const [listRes, sumRes] = await Promise.all([api("/api/reviews"), api("/api/reviews/summary")]);
    REVIEWS = listRes.reviews || [];
    RV_SUMMARY = sumRes;
    renderReviews();
  } catch (e) {
    $("#rvList").innerHTML = `<span class="hint">${esc(e.message)}</span>`;
  }
}

function renderTagWall(s) {
  if (!s) return "";
  const clip = (t) => (t.length > 56 ? t.slice(0, 56) + "…" : t);
  const block = (title, emoji, items, cls) => {
    if (!items || !items.length) return "";
    const tags = items.slice(0, 6).map((t) => `<span class="rv-tag ${cls}">${esc(clip(t.text))}${t.count > 1 ? `<b>×${t.count}</b>` : ""}</span>`).join("");
    return `<div class="rv-tags"><h4>${emoji} ${title}</h4><div class="tag-list">${tags}</div></div>`;
  };
  return (
    block("稳定强项（继续保持）", "", s.strengths, "good") +
    block("反复出错点（重点攻克）", "", s.weaknesses, "bad") +
    block("知识盲区（待补课）", "", s.knowledgeGaps, "gap")
  );
}

function renderReviews() {
  const s = RV_SUMMARY || {};
  $("#rvCount").textContent = REVIEWS.length;

  $("#rvSummary").innerHTML = `
    <div class="rv-stats">
      <div class="rv-stat"><div class="num">${s.total || 0}</div><div class="label">复盘场次</div></div>
      <div class="rv-stat"><div class="num">${s.avgScore || "—"}</div><div class="label">平均表现分</div></div>
      <div class="rv-stat"><div class="num">${(s.weaknesses || []).length}</div><div class="label">待改进点</div></div>
      <div class="rv-stat"><div class="num">${(s.knowledgeGaps || []).length}</div><div class="label">知识盲区</div></div>
    </div>
    ${renderTagWall(s)}`;

  $("#rvList").innerHTML = REVIEWS.length
    ? REVIEWS.map((rv) => {
        const a = rv.analysis || {};
        const score = a.score
          ? `<div class="rv-score"><div class="v">${a.score}</div><div class="l">分</div></div>`
          : `<div class="rv-score none"><div class="v">—</div><div class="l">待分析</div></div>`;
        return `<div class="rv-item" data-id="${rv.id}">
          <div class="rv-item-head">
            <div style="min-width:0">
              <div class="rv-item-title">${esc(rv.company)} · ${esc(rv.role)}</div>
              <div class="rv-item-meta">${esc(rv.round)} · ${esc(rv.date)}</div>
            </div>
            ${score}
          </div>
          ${a.summary ? `<div class="rv-item-summary">${esc(a.summary)}</div>` : ""}
        </div>`;
      }).join("")
    : `<span class="hint">还没有复盘记录。面完一场就沉淀一次，AI 会帮你越面越强。</span>`;

  $$("#rvList .rv-item").forEach((el) => el.addEventListener("click", () => openReview(el.dataset.id)));
}

function openReview(id) {
  const rv = REVIEWS.find((r) => r.id === id);
  if (!rv) return;
  $$("#rvList .rv-item").forEach((x) => x.classList.remove("active"));
  const el = $(`#rvList .rv-item[data-id="${id}"]`);
  if (el) el.classList.add("active");

  const a = rv.analysis;
  const box = $("#rvDetail");
  box.style.display = "block";

  if (!a) {
    box.innerHTML = `
      <div class="rv-detail-head"><h3>${esc(rv.company)} · ${esc(rv.role)}（${esc(rv.round)}）</h3></div>
      <p class="hint">这条复盘还没做 AI 分析（可能当时 Key 未配置或调用失败）。</p>
      <div class="rv-transcript">${esc(rv.transcript.slice(0, 800))}${rv.transcript.length > 800 ? "\n…（已截断）" : ""}</div>
      <div style="margin-top:10px;display:flex;gap:8px">
        <button class="btn primary" id="rvReAnalyze">重新分析</button>
        <button class="btn" id="rvEdit">编辑</button><button class="btn" id="rvDelete">删除</button>
      </div>`;
  } else {
    const qaHtml = (a.qa || []).map((item) => `
      <div class="rv-qa">
        <div class="q">Q：${esc(item.q)}</div>
        <div class="a">A：${esc(item.a || "（纪要未记录）")}</div>
        ${item.comment ? `<div class="cmt ${item.quality || "ok"}">${item.quality === "good" ? "" : item.quality === "bad" ? "" : ""} ${esc(item.comment)}</div>` : ""}
      </div>`).join("");

    const listBlock = (title, emoji, arr) =>
      arr && arr.length
        ? `<div class="rv-section"><h4>${emoji} ${title}</h4><ul>${arr.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>`
        : "";

    box.innerHTML = `
      <div class="rv-detail-head">
        <h3>${esc(rv.company)} · ${esc(rv.role)}（${esc(rv.round)}）</h3>
        <div style="display:flex;gap:8px;align-items:center">
          ${a.score ? `<span class="rv-score"><div class="v">${a.score}</div><div class="l">分</div></span>` : ""}
          <button class="btn" id="rvReAnalyze">重新分析</button>
          <button class="btn" id="rvEdit">编辑</button><button class="btn" id="rvDelete">删除</button>
        </div>
      </div>
      ${a.summary ? `<div class="rv-section"><h4>总评</h4><ul><li>${esc(a.summary)}</li></ul></div>` : ""}
      ${qaHtml ? `<div class="rv-section"><h4>问答复盘</h4>${qaHtml}</div>` : ""}
      ${listBlock("答得好的（继续保持）", "", a.strengths)}
      ${listBlock("答得不好的（重点攻克）", "", a.weaknesses)}
      ${listBlock("暴露的知识盲区", "", a.knowledgeGaps)}
      ${listBlock("下一面备战重点", "", a.nextPrep)}
      ${listBlock("可复用答题框架", "", a.frameworks)}
      ${listBlock("简历/自我介绍优化提示", "", a.resumeHints)}
      <div class="rv-section"><h4>纪要原文</h4><div class="rv-transcript">${esc(rv.transcript)}</div></div>`;
  }

  $("#rvReAnalyze").addEventListener("click", async () => {
    $("#rvReAnalyze").textContent = "分析中…";
    try {
      const j = await api(`/api/reviews/${id}/analyze`, { method: "POST" });
      const i = REVIEWS.findIndex((r) => r.id === id);
      if (i >= 0) REVIEWS[i] = j.review;
      await loadReviews();
      openReview(id);
      toast("重新分析完成 ");
    } catch (e) { toast("" + e.message); }
  });
  $("#rvDelete").addEventListener("click", async () => {
    if (!confirm("确定删除这条复盘？删除后无法恢复。")) return;
    await api(`/api/reviews/${id}`, { method: "DELETE" });
    box.style.display = "none";
    await loadReviews();
    toast("已删除");
  });
  // 编辑表单（默认隐藏；元数据随时改，纪要变更会触发后端自动重新分析）
  box.insertAdjacentHTML("beforeend", `
    <div id="rvEditForm" style="display:none;margin-top:12px;padding-top:12px;border-top:1px solid var(--line)">
      <h4 style="font-size:13px;margin-bottom:8px">编辑复盘</h4>
      <div class="form">
        <div class="form-row">
          <input id="rvEditCompany" placeholder="公司" />
          <input id="rvEditRole" placeholder="岗位" />
        </div>
        <div class="form-row">
          <select id="rvEditRound">
            <option value="AI 面">AI 面</option><option value="一面">一面</option>
            <option value="二面">二面</option><option value="三面">三面</option>
            <option value="HR 面">HR 面</option><option value="其他">其他</option>
          </select>
          <input id="rvEditDate" type="date" />
        </div>
        <textarea id="rvEditTranscript" style="min-height:140px" placeholder="纪要原文"></textarea>
        <div style="display:flex;gap:8px">
          <button class="btn primary" id="rvEditSave">保存</button>
          <button class="btn" id="rvEditCancel">取消</button>
        </div>
      </div>
    </div>`);

  $("#rvEdit").addEventListener("click", () => {
    const f = $("#rvEditForm");
    const showing = f.style.display !== "none";
    f.style.display = showing ? "none" : "block";
    if (!showing) {
      $("#rvEditCompany").value = rv.company;
      $("#rvEditRole").value = rv.role;
      $("#rvEditRound").value = rv.round;
      $("#rvEditDate").value = rv.date;
      $("#rvEditTranscript").value = rv.transcript;
    }
  });
  $("#rvEditCancel").addEventListener("click", () => { $("#rvEditForm").style.display = "none"; });
  $("#rvEditSave").addEventListener("click", async () => {
    const btn = $("#rvEditSave");
    const oldTranscript = rv.transcript;
    btn.textContent = "保存中…"; btn.disabled = true;
    try {
      const j = await api(`/api/reviews/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company: $("#rvEditCompany").value.trim(),
          role: $("#rvEditRole").value.trim(),
          round: $("#rvEditRound").value,
          date: $("#rvEditDate").value,
          transcript: $("#rvEditTranscript").value,
        }),
      });
      const i = REVIEWS.findIndex((r) => r.id === id);
      if (i >= 0) REVIEWS[i] = j.review;
      await loadReviews();
      openReview(id);
      toast(j.review.transcript !== oldTranscript ? "已保存，纪要已变更并重新分析" : "已保存");
    } catch (e) { toast("⚠ " + e.message); }
    btn.textContent = "保存"; btn.disabled = false;
  });

  box.scrollIntoView({ behavior: "smooth", block: "start" });
}

// 文件上传：读取文本填入纪要框
$("#rvFile").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    $("#rvTranscript").value = reader.result;
    $("#rvFileInfo").textContent = `已读取：${file.name}（${(file.size / 1024).toFixed(1)} KB）`;
  };
  reader.readAsText(file, "utf-8");
});

// 新建复盘
$("#rvCreate").addEventListener("click", async () => {
  const transcript = $("#rvTranscript").value.trim();
  if (!transcript) { toast("请粘贴面试纪要内容，或上传 txt/md 文件"); return; }
  const btn = $("#rvCreate");
  btn.textContent = "AI 分析中…（约 20-40 秒）";
  btn.disabled = true;
  try {
    const j = await api("/api/reviews", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        company: $("#rvCompany").value.trim(),
        role: $("#rvRole").value.trim(),
        round: $("#rvRound").value,
        date: $("#rvDate").value,
        transcript,
        source: "manual",
      }),
    });
    $("#rvCompany").value = ""; $("#rvRole").value = "";
    $("#rvTranscript").value = ""; $("#rvFileInfo").textContent = "";
    $("#rvFile").value = "";
    await loadReviews();
    if (j.review) openReview(j.review.id);
    toast(j.analyzeError ? "已保存，但 AI 分析失败：" + j.analyzeError : "复盘完成 ");
  } catch (e) { toast("" + e.message); }
  btn.textContent = "AI 复盘分析";
  btn.disabled = false;
});

// 同步腾讯会议纪要（当前为预留接口）
$("#rvSyncBtn").addEventListener("click", async () => {
  const mid = prompt("输入腾讯会议 ID（meetingId）\n\n前提：该会议已开启云录制且纪要已生成。\n未配置凭证请先到「设置」页填写。", "");
  if (!mid || !mid.trim()) return;
  const btn = $("#rvSyncBtn");
  const oldText = btn.textContent;
  btn.textContent = "拉取中"; btn.disabled = true;
  try {
    const j = await api("/api/reviews/sync", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meetingId: mid.trim() }),
    });
    if (j.ok) {
      await loadReviews();
      openReview(j.review.id);
      toast(j.analyzeError ? "已拉取，但 AI 分析失败：" + j.analyzeError : "已拉取纪要并完成复盘");
    } else {
      toast(j.fallback || j.error || "拉取失败");
      if (j.hint) console.warn("[会议API]", j.hint);
    }
  } catch (e) {
    toast("⚠ " + e.message);
  }
  btn.textContent = oldText; btn.disabled = false;
});

// 默认填入今天日期
$("#rvDate").value = new Date().toISOString().slice(0, 10);

load().catch((e) => toast("加载失败：" + e.message));
loadAgent().catch((e) => toast("Agent 加载失败：" + e.message));
loadReviews().catch((e) => toast("复盘加载失败：" + e.message));


// ---------- 腾讯会议凭证配置 ----------
async function loadMeetingConfig() {
  try {
    const j = await api("/api/meeting/config");
    $("#mtStatus").textContent = j.configured
      ? `已配置（AppId ${j.appId} · 用户 ${j.userId}）`
      : `未配置（缺少：${(j.missing || []).join("、")}）`;
  } catch (e) {
    $("#mtStatus").textContent = "配置状态读取失败";
  }
}
$("#mtSave").addEventListener("click", async () => {
  const all = {
    appId: $("#mtAppId").value.trim(),
    sdkId: $("#mtSdkId").value.trim(),
    secretId: $("#mtSecretId").value.trim(),
    secretKey: $("#mtSecretKey").value.trim(),
    userId: $("#mtUserId").value.trim(),
    stsToken: $("#mtSts").value.trim(),
  };
  const payload = {};
  for (const [k, v] of Object.entries(all)) if (v) payload[k] = v;
  if (!Object.keys(payload).length) { toast("请至少填写一项"); return; }
  try {
    await api("/api/config", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ meeting: payload }),
    });
    const m = $("#mtMsg");
    m.textContent = "已保存到本地"; m.className = "msg ok";
    ["mtAppId", "mtSdkId", "mtSecretId", "mtSecretKey", "mtUserId", "mtSts"].forEach((id) => { $("#" + id).value = ""; });
    loadMeetingConfig();
    toast("会议凭证已保存");
  } catch (e) {
    const m = $("#mtMsg");
    m.textContent = "⚠ " + e.message; m.className = "msg err";
  }
});
loadMeetingConfig();

// ---------- 皮肤系统：预设 + AI 图片生成 ----------
const THEME_PRESETS = {
  business: { id: "business", name: "商务", vars: { bg: "#f7f8fa", card: "#ffffff", ink: "#1a1d23", muted: "#6b7280", line: "#e5e7eb", primary: "#2563eb", "primary-soft": "#eff6ff", shadow: "0 1px 2px rgba(0,0,0,.04)", gradient: "linear-gradient(135deg, #1e40af 0%, #3b82f6 100%)", "gradient-soft": "linear-gradient(135deg, #e8f1ff 0%, #f4f8ff 100%)" } },
  dark:     { id: "dark",     name: "暗夜", vars: { bg: "#17181c", card: "#1f2127", ink: "#e8eaed", muted: "#9aa0a6", line: "#2e3138", primary: "#5b8def", "primary-soft": "#202b3d", shadow: "0 1px 2px rgba(0,0,0,.35)", gradient: "linear-gradient(135deg, #3b82f6 0%, #60a5fa 100%)", "gradient-soft": "linear-gradient(135deg, #1b2333 0%, #17181c 100%)" } },
  warm:     { id: "warm",     name: "暖橙", vars: { bg: "#faf7f2", card: "#ffffff", ink: "#2b2118", muted: "#8a7a6b", line: "#eadfd2", primary: "#c2571b", "primary-soft": "#fbeee3", shadow: "0 1px 2px rgba(120,80,40,.06)", gradient: "linear-gradient(135deg, #9a4318 0%, #d97706 100%)", "gradient-soft": "linear-gradient(135deg, #fdf3e8 0%, #faf7f2 100%)" } },
  jade:     { id: "jade",     name: "青竹", vars: { bg: "#f4f8f5", card: "#ffffff", ink: "#1a2620", muted: "#6b7f74", line: "#dbe7de", primary: "#0f7b52", "primary-soft": "#e5f3ea", shadow: "0 1px 2px rgba(20,80,50,.05)", gradient: "linear-gradient(135deg, #0b5c3e 0%, #10b981 100%)", "gradient-soft": "linear-gradient(135deg, #e6f5ec 0%, #f4f8f5 100%)" } },
};
let CURRENT_THEME = null;

function applyTheme(t) {
  CURRENT_THEME = t || null;
  const root = document.documentElement.style;
  const keys = Object.keys(THEME_PRESETS.business.vars);
  if (!t || !t.vars) { keys.forEach((k) => root.removeProperty("--" + k)); }
  else for (const [k, v] of Object.entries(t.vars)) root.setProperty("--" + k, v);
  $$("#themeList .theme-chip").forEach((c) => c.classList.toggle("active", !!(t && c.dataset.tid === t.id)));
}

function renderThemeList() {
  const swatch = (t) => `
    <div class="theme-swatch">
      <i style="background:${t.vars.primary}"></i>
      <i style="background:${t.vars["primary-soft"]}"></i>
      <i style="background:${t.vars.bg}"></i>
    </div>`;
  const chips = Object.values(THEME_PRESETS).map((t) => `
    <div class="theme-chip" data-tid="${t.id}">
      ${swatch(t)}
      <div class="theme-name">${t.name}</div>
    </div>`).join("");
  const custom = CURRENT_THEME && CURRENT_THEME.id === "custom"
    ? `<div class="theme-chip" data-tid="custom">
         ${swatch(CURRENT_THEME)}
         <div class="theme-name">${esc(CURRENT_THEME.name || "自定义")}</div>
       </div>` : "";
  $("#themeList").innerHTML = chips + custom;
  $$("#themeList .theme-chip").forEach((c) => c.addEventListener("click", () => {
    const t = THEME_PRESETS[c.dataset.tid];
    if (!t) return;
    applyTheme(t);
    saveTheme(t);
  }));
}

async function saveTheme(t) {
  try {
    await api("/api/config", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme: t }),
    });
    toast("皮肤已应用：" + (t.name || "自定义"));
  } catch (e) { toast("⚠ " + e.message); }
}

// 上传图片 → AI 提取配色生成主题
$("#themeImg").addEventListener("change", (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  if (!file.type.startsWith("image/")) { toast("请上传图片文件"); return; }
  if (file.size > 5 * 1024 * 1024) { toast("图片请小于 5MB"); return; }
  const st = $("#themeStatus");
  st.textContent = "AI 正在分析图片配色…（约 10-20 秒）";
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const j = await api("/api/theme/generate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: reader.result }),
      });
      applyTheme(j.theme);
      renderThemeList();
      await saveTheme(j.theme);
      st.textContent = "已生成「" + (j.theme.name || "自定义") + "」" + (j.theme.summary ? " · " + j.theme.summary : "");
    } catch (err) {
      st.textContent = "生成失败：" + err.message;
    }
  };
  reader.readAsDataURL(file);
});

// 初始化：应用已保存的主题（无则商务默认）
(async () => {
  try {
    const st = await api("/api/state");
    const t = st.theme;
    if (t && THEME_PRESETS[t.id]) applyTheme(THEME_PRESETS[t.id]);
    else if (t && t.vars) applyTheme(t);
    else applyTheme(THEME_PRESETS.business);
  } catch (e) {
    applyTheme(THEME_PRESETS.business);
  }
  renderThemeList();
})();

// ---------- AI 生成简历（两阶段） ----------
let RS_QUESTIONS = [];
let RS_TARGET = "";

async function copyText(t) {
  try { await navigator.clipboard.writeText(t); toast("已复制到剪贴板"); }
  catch (e) { toast("复制失败，请手动选中复制"); }
}

$("#rsStart").addEventListener("click", async () => {
  const target = $("#rsTarget").value.trim();
  if (!target) { toast("请先填写目标岗位"); return; }
  RS_TARGET = target;
  const btn = $("#rsStart");
  btn.textContent = "分析中…"; btn.disabled = true;
  try {
    const j = await api("/api/resume/generate", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetRole: target, answers: [] }),
    });
    if (j.stage === "ask") {
      RS_QUESTIONS = j.questions || [];
      renderResumeQuestions();
    } else if (j.stage === "done") {
      renderResume(j.resume);
    }
  } catch (e) { toast("⚠ " + e.message); }
  btn.textContent = "开始生成"; btn.disabled = false;
});

function renderResumeQuestions() {
  const box = $("#rsQuestions");
  if (!RS_QUESTIONS.length) {
    box.style.display = "none";
    generateResumeWithAnswers([]);
    return;
  }
  box.style.display = "block";
  box.innerHTML = `
    <h4 style="font-size:13px;margin:12px 0 8px">AI 需要确认以下信息（已跳过档案中已有的内容）</h4>
    ${RS_QUESTIONS.map((q, i) => `
      <div class="rv-qa" style="background:var(--bg)">
        <div class="q">${i + 1}. ${esc(q.q)}</div>
        <div class="a" style="color:var(--muted)">为什么问：${esc(q.why || "补全简历细节")}</div>
        ${(q.options && q.options.length)
          ? `<div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">
             ${q.options.map((o) => `<span class="rv-tag" style="cursor:pointer" data-opt="${esc(o)}" data-idx="${i}">${esc(o)}</span>`).join("")}
             </div>` : ""}
        <textarea class="rs-answer" data-idx="${i}" style="width:100%;margin-top:8px;min-height:54px" placeholder="你的回答…"></textarea>
      </div>`).join("")}
    <button class="btn primary" id="rsConfirm" style="margin-top:10px">确认并生成简历</button>`;

  // 点选项快速填充
  $$("#rsQuestions .rv-tag[data-opt]").forEach((el) => el.addEventListener("click", () => {
    const ta = $(`.rs-answer[data-idx="${el.dataset.idx}"]`);
    if (ta) ta.value = el.dataset.opt;
  }));
  $("#rsConfirm").addEventListener("click", () => {
    const answers = RS_QUESTIONS.map((q, i) => ({
      q: q.q,
      a: ($(`.rs-answer[data-idx="${i}"]`) || {}).value || "",
    })).filter((x) => x.a.trim());
    generateResumeWithAnswers(answers);
  });
}

async function generateResumeWithAnswers(answers) {
  const btn = $("#rsConfirm");
  if (btn) { btn.textContent = "生成中…（约 30-60 秒）"; btn.disabled = true; }
  try {
    const j = await api("/api/resume/generate", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetRole: RS_TARGET, answers }),
    });
    if (j.stage === "done") renderResume(j.resume);
    else if (j.stage === "ask") { RS_QUESTIONS = j.questions; renderResumeQuestions(); }
  } catch (e) { toast("⚠ " + e.message); }
}

function renderResume(r) {
  if (!r) return;
  $("#rsQuestions").style.display = "none";
  const hl = (r.highlights || []).map((x) => `<li>${esc(x)}</li>`).join("");
  const tp = (r.tips || []).map((x) => `<li>${esc(x)}</li>`).join("");
  const points = [];
  if ((r.highlights || []).length) {
    points.push({ t: "本版亮点", k: "h" });
    (r.highlights || []).forEach((x) => points.push({ t: x, k: "li" }));
  }
  if ((r.tips || []).length) {
    points.push({ t: "投递前建议", k: "h" });
    (r.tips || []).forEach((x) => points.push({ t: x, k: "li" }));
  }
  $("#rsResult").innerHTML = `
    <div class="rv-detail-head" style="margin-top:14px">
      <h3>已生成：${esc(r.targetRole)}<span style="font-weight:400;color:var(--muted);font-size:12px;margin-left:8px">${esc(r.updatedAt || "")}</span></h3>
      <div class="export-row">
        <button class="btn" id="rsExportDocx">导出 Word</button>
        <button class="btn" id="rsExportXlsx">导出 Excel</button>
        <button class="btn" id="rsCopy">复制简历</button>
      </div>
    </div>
    <div class="ai-split">
      <div class="ai-main">
        <pre class="rv-transcript" style="max-height:none;font-family:-apple-system,'PingFang SC',sans-serif;line-height:1.75">${esc(r.markdown)}</pre>
      </div>
      <div class="ai-points" id="rsPoints"></div>
    </div>
    ${tp ? `<div class="rv-section" style="margin-top:12px"><h4>投递前建议</h4><ul>${tp}</ul></div>` : ""}`;
  renderPoints("rsPoints", points);
  $("#rsExportDocx").addEventListener("click", () =>
    downloadExport("/api/export/resume", { format: "docx" }, "简历.docx"));
  $("#rsExportXlsx").addEventListener("click", () =>
    downloadExport("/api/export/resume", { format: "xlsx" }, "简历.xlsx"));
  $("#rsCopy").addEventListener("click", () => copyText(r.markdown));
  toast("简历已生成");
}

// 载入已保存的简历
(async () => {
  try {
    const j = await api("/api/resume");
    if (j.resume && j.resume.markdown) renderResume(j.resume);
  } catch (e) {}
})();

// ---------- Offer 对比 ----------
let OFFERS = [];

async function loadOffers() {
  try {
    const j = await api("/api/offers");
    OFFERS = j.offers || [];
    $("#ofCount").textContent = OFFERS.length;
    const dl = $("#cityList");
    if (dl && j.cities) dl.innerHTML = j.cities.map((c) => `<option value="${c}">`).join("");
    $("#ofList").innerHTML = OFFERS.length
      ? OFFERS.map((o) => {
          const c = o.calc || {};
          return `<div class="rv-item" data-id="${o.id}">
            <div class="rv-item-head">
              <div style="min-width:0">
                <div class="rv-item-title">${esc(o.company)}${o.role ? " · " + esc(o.role) : ""}${o.level ? "（" + esc(o.level) + "）" : ""}</div>
                <div class="rv-item-meta">${esc(o.city || "未填城市")} · 月薪 ${o.baseMonth}K × ${o.months}月</div>
              </div>
              <div style="text-align:right">
                <div style="font-size:16px;font-weight:700;color:var(--primary)">${c.totalYear || 0} 万</div>
                <div class="rv-item-meta">年总包</div>
              </div>
            </div>
            <div class="rv-item-meta" style="margin-top:6px">
              ${c.hasCost
                ? `生活成本约 ${c.monthCost} 元/月 → 扣后年可支配 <b style="color:var(--ink)">${c.netYear} 万</b>`
                : "（城市未匹配，未计入生活成本）"}
              ${o.growth ? `<br>成长性：${esc(o.growth)}` : ""}
            </div>
            <div style="margin-top:8px"><button class="btn of-del" data-id="${o.id}" style="font-size:12px;padding:3px 10px">删除</button></div>
          </div>`;
        }).join("")
      : `<span class="hint">还没有录入 Offer。拿到 offer 后填进来，可以做年包、生活成本、成长曲线的全方位对比。</span>`;
    $$("#ofList .of-del").forEach((b) => b.addEventListener("click", async (e) => {
      e.stopPropagation();
      await api("/api/offers/" + b.dataset.id, { method: "DELETE" });
      loadOffers();
      toast("已删除");
    }));
  } catch (e) {
    $("#ofList").innerHTML = `<span class="hint">⚠ ${esc(e.message)}</span>`;
  }
}

$("#ofAdd").addEventListener("click", async () => {
  const company = $("#ofCompany").value.trim();
  if (!company) { toast("请填写公司"); return; }
  try {
    await api("/api/offers", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        company,
        role: $("#ofRole").value.trim(),
        city: $("#ofCity").value.trim(),
        level: $("#ofLevel").value.trim(),
        baseMonth: $("#ofBase").value,
        months: $("#ofMonths").value || 12,
        bonus: $("#ofBonus").value || 0,
        equity: $("#ofEquity").value || 0,
        signOn: $("#ofSignOn").value || 0,
        growth: $("#ofGrowth").value.trim(),
      }),
    });
    ["ofCompany", "ofRole", "ofCity", "ofLevel", "ofBase", "ofBonus", "ofEquity", "ofSignOn", "ofGrowth"]
      .forEach((id) => { $("#" + id).value = ""; });
    $("#ofMonths").value = 12;
    await loadOffers();
    toast("已添加");
  } catch (e) { toast("⚠ " + e.message); }
});

$("#ofCompare").addEventListener("click", async () => {
  const btn = $("#ofCompare");
  btn.textContent = "AI 对比中…（约 30-60 秒）"; btn.disabled = true;
  try {
    const j = await api("/api/offers/compare", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    renderOfferCompare(j.compare);
  } catch (e) { toast("⚠ " + e.message); }
  btn.textContent = "AI 全方位对比"; btn.disabled = false;
});

function renderOfferCompare(c) {
  if (!c) return;
  const box = $("#ofCompareResult");
  box.style.display = "block";
  const table = (c.table || []).map((r) => `
    <tr>
      <td style="padding:6px 10px;font-weight:600;border-bottom:1px solid var(--line)">${esc(r.item)}</td>
      ${(r.values || []).map((v) => `<td style="padding:6px 10px;border-bottom:1px solid var(--line)">${esc(v)}</td>`).join("")}
      <td style="padding:6px 10px;border-bottom:1px solid var(--line);color:var(--muted)">${esc(r.winner || "")}</td>
    </tr>`).join("");
  const block = (t, emoji, txt) => txt ? `<div class="rv-section"><h4>${emoji} ${t}</h4><div style="font-size:13px;line-height:1.7;white-space:pre-wrap">${esc(txt)}</div></div>` : "";
  box.innerHTML = `
    <div class="rv-detail-head"><h3>Offer 对比结论</h3></div>
    ${c.summary ? `<div class="rv-section"><h4>结论</h4><div style="font-size:13.5px;line-height:1.7;padding:10px 12px;background:var(--bg);border-radius:8px">${esc(c.summary)}</div></div>` : ""}
    ${table ? `<div class="rv-section"><h4>对比表</h4><table style="width:100%;border-collapse:collapse;font-size:13px">${table}</table></div>` : ""}
    ${block("薪酬与购买力", "💰", c.payAnalysis)}
    ${block("成长曲线", "📈", c.growthAnalysis)}
    ${block("风险提示", "⚠️", c.risks)}
    ${block("最终建议", "🎯", c.suggestion)}
    ${block("可谈判的点", "🤝", c.negotiate)}`;
  box.scrollIntoView({ behavior: "smooth", block: "start" });
}
loadOffers();
// ---------- 引导层交互 ----------
$("#obStart").addEventListener("click", async () => {
  const key = $("#obKey").value.trim();
  const hasAny = ["obName", "obEdu", "obTarget", "obCity"].some((id) => $("#" + id).value.trim());
  try {
    if (hasAny) {
      await api("/api/onboarding", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: $("#obName").value.trim(),
          education: $("#obEdu").value.trim(),
          targetRoles: $("#obTarget").value.trim(),
          city: $("#obCity").value.trim(),
        }),
      });
    } else {
      await api("/api/onboarding/skip", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    }
    if (key) {
      await api("/api/config", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: key }),
      });
    }
    closeOnboarding();
    await load();
    toast(key ? "已保存，AI 功能已启用" : "已保存");
  } catch (e) {
    toast("⚠ " + e.message);
  }
});

$("#obSkip").addEventListener("click", async () => {
  try {
    await api("/api/onboarding/skip", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  } catch { /* 跳过失败也不该卡住用户 */ }
  closeOnboarding();
});

// ---------- 求职洞察 ----------
async function loadInsights() {
  try {
    const j = await api("/api/insights");
    INSIGHT = j.insights || null;
    renderInsights(j.insights, j.reviewSummary);
  } catch (e) {
    $("#insightSummary").innerHTML = `<span class="hint">⚠ ${esc(e.message)}</span>`;
  }
}

function renderInsights(d, rs) {
  if (!d) return;
  const s = d.summary || {};
  const stat = (label, val) =>
    `<div class="ins-stat"><div class="ins-stat-v">${val}</div><div class="ins-stat-l">${label}</div></div>`;

  $("#insightSummary").innerHTML = [
    stat("总投递", s.total ?? 0),
    stat("进行中", s.active ?? 0),
    stat("已 offer", s.offers ?? 0),
    stat("offer 率", (s.offerRate ?? 0) + "%"),
    stat("待面试", s.upcomingInterviews ?? 0),
    stat("已复盘", (rs && rs.analyzedCount) || 0),
  ].join("");

  // 漏斗条形图
  const funnel = (d.funnel || []).filter((f) => !f.terminal);
  const max = Math.max(1, ...funnel.map((f) => f.count));
  $("#insightFunnel").innerHTML = funnel.length
    ? funnel.map((f) => `
      <div class="ins-funnel-row">
        <div class="ins-funnel-label">${esc(f.label)}</div>
        <div class="ins-funnel-track">
          <div class="ins-funnel-bar" style="width:${((f.count / max) * 100).toFixed(1)}%"></div>
        </div>
        <div class="ins-funnel-num">${f.count}</div>
      </div>`).join("")
    : `<span class="hint">还没有投递记录。先去「投递进度」加几家。</span>`;

  // 转化率
  const steps = (d.conversion && d.conversion.steps) || [];
  $("#insightConv").innerHTML = steps.length
    ? `<table style="width:100%;border-collapse:collapse;font-size:13px">
        ${steps.map((st) => `
          <tr>
            <td style="padding:6px 4px;border-bottom:1px solid var(--line)">${esc(st.from)} → ${esc(st.to)}</td>
            <td style="padding:6px 4px;border-bottom:1px solid var(--line);text-align:right;font-weight:600;color:${st.rate === null ? "var(--muted)" : st.rate >= 50 ? "var(--green)" : "var(--ink)"}">${st.rate === null ? "—" : st.rate + "%"}</td>
          </tr>`).join("")}
      </table>`
    : `<span class="hint">数据还不够，多投几家就能看出瓶颈。</span>`;

  // 该跟进
  const stale = d.stale || [];
  $("#insightStale").innerHTML = stale.length
    ? stale.map((x) => `
        <div class="ins-stale-item">
          <div style="min-width:0">
            <div style="font-weight:600;font-size:13.5px">${esc(x.company)}${x.role ? " · " + esc(x.role) : ""}</div>
            <div class="hint">${esc(x.stage)}</div>
          </div>
          <div class="ins-stale-days">${x.staleDays} 天</div>
        </div>`).join("")
    : `<span class="hint">暂时没有卡住的投递。记得在投递时填「投递日」，这里才准。</span>`;

  // 渠道
  const channels = d.channels || [];
  $("#insightChannels").innerHTML = channels.length
    ? `<table style="width:100%;border-collapse:collapse;font-size:13px">
        ${channels.map((c) => `
          <tr>
            <td style="padding:6px 4px;border-bottom:1px solid var(--line)">${esc(c.channel)}</td>
            <td style="padding:6px 4px;border-bottom:1px solid var(--line);text-align:right">${c.total} 家</td>
            <td style="padding:6px 4px;border-bottom:1px solid var(--line);text-align:right;color:${c.advancedRate >= 40 ? "var(--green)" : "var(--muted)"}">进面 ${c.advancedRate}%</td>
          </tr>`).join("")}
      </table>`
    : `<span class="hint">在投递清单里填上渠道，这里会告诉你哪条路最有效。</span>`;

  // 面试表现趋势
  const trend = (rs && rs.scoreTrend) || [];
  if (!trend.length) {
    $("#insightTrend").innerHTML = `<span class="hint">还没有复盘记录。面完一场去「面试复盘」粘纪要，这里就会画出你的进步曲线。</span>`;
  } else {
    const bars = trend.map((t) => {
      const h = Math.max(4, Math.round((t.score / 10) * 100));
      const color = t.score >= 7 ? "var(--green)" : t.score >= 5 ? "var(--yellow)" : "var(--red)";
      return `<div class="ins-trend-col" title="${esc((t.company || "") + " " + (t.date || ""))}：${t.score} 分">
        <div class="ins-trend-bar" style="height:${h}%;background:${color}"></div>
        <div class="ins-trend-label">${t.score}</div>
      </div>`;
    }).join("");
    $("#insightTrend").innerHTML =
      `<div class="ins-trend">${bars}</div>` +
      `<div class="hint" style="margin-top:8px">平均分 ${rs.avgScore ?? "—"} / 10 · 最新 ${rs.latestScore ?? "—"} 分 · 共 ${trend.length} 场</div>`;
  }
}

// ---------- JD 匹配度 ----------
$("#jdMatchBtn").addEventListener("click", async () => {
  const jdText = $("#jdText").value.trim();
  if (!jdText) { toast("请先粘贴 JD 内容"); return; }
  const btn = $("#jdMatchBtn");
  btn.textContent = "分析中…"; btn.disabled = true;
  try {
    const j = await api("/api/jd/match", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        company: $("#jdCompany").value.trim(),
        role: $("#jdRole").value.trim(),
        jdText,
      }),
    });
    renderJdMatch(j.match);
  } catch (e) {
    toast("⚠ " + e.message);
  }
  btn.textContent = "分析匹配度"; btn.disabled = false;
});

function renderJdMatch(m) {
  if (!m) return;
  const box = $("#jdMatchResult");
  box.style.display = "block";
  const score = Number(m.score) || 0;
  const color = score >= 75 ? "var(--green)" : score >= 55 ? "var(--yellow)" : "var(--red)";
  const list = (t, arr) =>
    arr && arr.length
      ? `<div class="rv-section"><h4>${t}</h4><ul class="ins-list">${arr.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>`
      : "";
  const block = (t, txt) =>
    txt ? `<div class="rv-section"><h4>${t}</h4><div style="font-size:13px;line-height:1.7;white-space:pre-wrap">${esc(txt)}</div></div>` : "";

  const jdPoints = [
    { t: `匹配度 ${score}/100 · ${m.verdict || ""}`, k: "h" },
    ...((m.matches || []).slice(0, 3).map((x) => ({ t: "对上：" + x, k: "li" }))),
    ...((m.gaps || []).slice(0, 3).map((x) => ({ t: "还缺：" + x, k: "li" }))),
  ];
  box.innerHTML = `
    <div class="rv-detail-head">
      <h3>匹配度分析</h3>
      <div class="export-row">
        <button class="btn" id="jdExportDocx">导出 Word</button>
        <button class="btn" id="jdExportXlsx">导出 Excel</button>
      </div>
    </div>
    <div class="ai-split">
      <div class="ai-main">
        <div class="jd-score-row">
          <div class="jd-score" style="color:${color}">${score}<small>/100</small></div>
          <div style="flex:1;min-width:0">
            <div style="font-size:15px;font-weight:650">${esc(m.verdict || "")}</div>
            <div class="hint" style="margin-top:2px">${esc(m.oneLine || "")}</div>
          </div>
        </div>
        ${list("✅ 对上了什么", m.matches)}
        ${list("⚠️ 还缺什么", m.gaps)}
        ${m.keywords && m.keywords.length
          ? `<div class="rv-section"><h4>🔑 简历该补的关键词</h4><div class="ins-kw">${m.keywords.map((k) => `<span class="ins-kw-item">${esc(k)}</span>`).join("")}</div></div>`
          : ""}
        ${block("🎯 投之前该做什么", m.advice)}
        ${block("🕳 这个岗位可能的坑", m.risk)}
      </div>
      <div class="ai-points" id="jdPoints"></div>
    </div>`;
  renderPoints("jdPoints", jdPoints);
  const jdBlocks = [
    { type: "h1", text: `匹配度 ${score}/100 · ${m.verdict || ""}` },
    { type: "p", text: m.oneLine || "" },
    ...((m.matches || []).map((x) => ({ type: "li", text: "对上：" + x }))),
    ...((m.gaps || []).map((x) => ({ type: "li", text: "还缺：" + x }))),
  ];
  if (m.advice) jdBlocks.push({ type: "h1", text: "投之前该做什么" }, { type: "p", text: m.advice });
  if (m.risk) jdBlocks.push({ type: "h1", text: "这个岗位可能的坑" }, { type: "p", text: m.risk });
  $("#jdExportDocx").addEventListener("click", () =>
    downloadExport("/api/export/docx", { title: "JD 匹配度分析", blocks: jdBlocks, filename: "JD匹配度" }, "JD匹配度.docx"));
  $("#jdExportXlsx").addEventListener("click", () => downloadExport("/api/export/xlsx", {
    sheets: [{
      name: "匹配度",
      rows: [
        ["项目", "内容"],
        ["匹配度", score], ["结论", m.verdict || ""], ["一句话", m.oneLine || ""],
        ...(m.matches || []).map((x) => ["对上了", x]),
        ...(m.gaps || []).map((x) => ["还缺", x]),
        ...((m.keywords || []).map((k) => ["建议补的关键词", k])),
      ],
    }],
    filename: "JD匹配度",
  }, "JD匹配度.xlsx"));
  box.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

$("#insightRefresh").addEventListener("click", async () => {
  await loadInsights();
  toast("已刷新");
});

// ---------- AI 模拟面试 ----------
function renderMockResultHtml(r) {
  if (!r) return "";
  const score = Number(r.score) || 0;
  const color = score >= 7 ? "var(--green)" : score >= 5 ? "var(--yellow)" : "var(--red)";
  const list = (t, arr) =>
    arr && arr.length
      ? `<div class="rv-section"><h4>${t}</h4><ul class="ins-list">${arr.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>`
      : "";
  return `<div style="margin-top:12px;padding:12px 14px;background:var(--bg);border:1px solid var(--line);border-radius:var(--radius)">
    <div style="display:flex;align-items:center;gap:12px">
      <div style="font-size:28px;font-weight:700;color:${color}">${score}<small style="font-size:12px;color:var(--muted);font-weight:500">/10</small></div>
      <div style="font-size:13.5px;line-height:1.6">${esc(r.summary || "")}</div>
    </div>
    ${list("✅ 答得好的", r.good)}
    ${list("⚠️ 答得不好的", r.bad)}
    ${list("💡 本该提到却没说", r.missed)}
    ${list("🎯 下次重点练", r.nextPrep)}
  </div>`;
}

function bindMock(id, iv) {
  const log = $("#mockLog");
  const add = (role, text) => {
    log.innerHTML += `<div class="msg ${role}">${esc(text)}</div>`;
    log.scrollTop = log.scrollHeight;
  };
  const thinking = () => {
    const ai = document.createElement("div");
    ai.className = "msg ai";
    ai.textContent = "思考中…";
    log.appendChild(ai);
    log.scrollTop = log.scrollHeight;
    return ai;
  };

  $("#mockStart").addEventListener("click", async () => {
    log.innerHTML = "";
    $("#mockResult").innerHTML = "";
    const ai = thinking(); ai.textContent = "面试官正在开场…";
    try {
      const j = await api("/api/interviews/" + id + "/mock", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phase: "start" }),
      });
      ai.textContent = j.reply;
      iv.mock = j.mock || [];
      iv.mockResult = null;
    } catch (e) { ai.textContent = "" + e.message; }
  });

  $("#mockSend").addEventListener("click", async () => {
    const v = $("#mockInput").value.trim();
    if (!v) return;
    $("#mockInput").value = "";
    add("user", v);
    const ai = thinking(); ai.textContent = "追问中…";
    try {
      const j = await api("/api/interviews/" + id + "/mock", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phase: "continue", message: v }),
      });
      ai.textContent = j.reply;
      iv.mock = j.mock || [];
    } catch (e) { ai.textContent = "" + e.message; }
    log.scrollTop = log.scrollHeight;
  });

  $("#mockInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("#mockSend").click(); }
  });

  $("#mockEnd").addEventListener("click", async () => {
    if (!(iv.mock || []).length) { toast("先开始一场模拟面试"); return; }
    const btn = $("#mockEnd");
    btn.textContent = "评价中…"; btn.disabled = true;
    try {
      const j = await api("/api/interviews/" + id + "/mock", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phase: "end" }),
      });
      iv.mockResult = j.mockResult;
      $("#mockResult").innerHTML = renderMockResultHtml(j.mockResult);
      toast("已出评价");
    } catch (e) { toast("⚠ " + e.message); }
    btn.textContent = "结束并评价"; btn.disabled = false;
  });
}
