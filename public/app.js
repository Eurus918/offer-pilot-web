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

// ---------- tabs ----------
$$(".tab").forEach((b) => b.addEventListener("click", () => {
  $$(".tab").forEach((x) => x.classList.remove("active"));
  $$(".panel").forEach((x) => x.classList.remove("active"));
  b.classList.add("active");
  $("#" + b.dataset.tab).classList.add("active");
}));

// ---------- load ----------
async function load() {
  STATE = await api("/api/state");
  renderProfile();
  renderApps();
  renderInterviews();
  renderWorks();
  const kb = $("#keyBadge");
  if (STATE.hasKey) { kb.textContent = "API Key：已设置"; kb.classList.add("ok"); }
  const notice = $("#aiNotice");
  if (!STATE.hasKey) {
    notice.style.display = "block";
    notice.innerHTML = "<b>AI 功能未启用</b>：未检测到 DeepSeek API Key（或账户无余额）。已为你预置 <b>携程 / 新浪</b> 的面试备战包，可直接在「面邀备战」查看；配置 Key 后解锁 JD 图生成与 AI 问答。去「设置」填入 sk- 开头的 Key 即可。";
  }
}

// ---------- profile ----------
function renderProfile() {
  const b = STATE.profile.basics;
  $("#basics").innerHTML = `
    <div class="kv-row">
      <div class="kv-label">姓名</div><div class="kv-val">${b.name}</div>
      <div class="kv-label">电话</div><div class="kv-val">${b.phone}</div>
    </div>
    <div class="kv-row">
      <div class="kv-label">邮箱</div><div class="kv-val">${b.email}</div>
      <div class="kv-label">城市 / 年龄</div><div class="kv-val">${b.city} · ${b.age}岁 · ${b.political}</div>
    </div>
    <div class="kv-row full-width">
      <div class="kv-label">学历</div><div class="kv-val">${b.education}</div>
    </div>
    <div class="kv-row full-width">
      <div class="kv-label">目标岗位</div><div class="kv-val">${b.targetRoles}</div>
    </div>`;
  renderFacts();
  renderChat();
}
function renderFacts() {
  $("#facts").innerHTML = STATE.profile.facts
    .map((f) => `<div class="fact">${f.key}：${f.value}<small>来源：${f.source} · ${f.updatedAt}</small></div>`)
    .join("") || "<span class='hint'>还没有沉淀的偏好，去右边聊聊吧。</span>";
}
function renderChat() {
  const log = $("#chatLog");
  const h = STATE.profile.chatHistory || [];
  if (h.length === 0) {
    log.innerHTML = `<div style="text-align:center;color:var(--gray);padding:40px 0;font-size:13.5px">
      <div style="font-size:32px;margin-bottom:8px"></div>
      开始和 AI 聊聊吧<br><span style="font-size:12px">聊聊你的想法、偏好，或上传资料让 AI 分析</span>
    </div>`;
    return;
  }
  log.innerHTML = h.map((m) => {
    const isUser = m.role === "user";
    const avatar = isUser
      ? `<div class="chat-avatar user-avatar">我</div>`
      : `<div class="chat-avatar ai-avatar">AI</div>`;
    const time = m.time ? fmtTime(m.time) : "";
    // 如果消息附带图片
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
  }).join("");
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
  aiRow.innerHTML = `<div class="chat-avatar ai-avatar">AI</div><div><div class="chat-bubble" style="color:var(--gray);padding:10px 14px">思考中…</div></div>`;
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
    // 添加时间戳
    const aiTime = document.createElement("div");
    aiTime.className = "chat-time";
    aiTime.textContent = fmtTime(new Date().toISOString());
    aiRow.querySelector("div > div").appendChild(aiTime);

    // 沉淀档案（仅文字部分）
    if (v) {
      const ex = await api("/api/profile/extract", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: v }) });
      STATE.profile.facts = ex.facts; renderFacts();
    }

    STATE.profile.chatHistory = STATE.profile.chatHistory || [];
    STATE.profile.chatHistory.push(
      { role: "user", text: v, time: now, ...(chatFileData ? { fileName: chatFileData.name, image: chatFileData.type.startsWith("image/") ? chatFileData.base64 : undefined } : {}) },
      { role: "assistant", text: j.reply, time: new Date().toISOString() }
    );
  } catch (e) {
    aiRow.querySelector(".chat-bubble").textContent = "" + e.message + "（你也可以用左侧『手动添加』直接沉淀这条偏好）";
  }
  log.scrollTop = log.scrollHeight;

  // 清除上传预览
  clearChatUpload();
});

// 格式化 AI 回复中的 markdown 风格内容
function formatAiReply(text) {
  if (!text) return "";
  return esc(text)
    .replace(/\*\*(.*?)\*\*/g, "<b>$1</b>")
    .replace(/^- (.*)/gm, "• $1")
    .replace(/\n/g, "<br>");
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

// 手动记录偏好（无需 API）
$("#factAddBtn").addEventListener("click", async () => {
  const k = $("#factKey").value.trim();
  const val = $("#factValue").value.trim();
  if (!k || !val) { toast("请填写维度和内容"); return; }
  try {
    const j = await api("/api/profile/fact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: k, value: val }) });
    STATE.profile.facts = j.facts; renderFacts();
    $("#factKey").value = ""; $("#factValue").value = "";
    toast("已沉淀偏好：" + k);
  } catch (e) { toast("" + e.message); }
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
    <div class="qa-input"><input id="qaInput" placeholder="针对这场面试继续问…" /><button class="btn primary" id="qaSend">问</button></div>`;
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
  aiRow.innerHTML = `<div class="chat-avatar ai-avatar">AI</div><div><div class="chat-bubble" style="color:var(--gray)">思考中…</div></div>`;
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
$("#agentInput").addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); $("#agentSend").click(); }
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
  $("#rsResult").innerHTML = `
    <div class="rv-detail-head" style="margin-top:14px">
      <h3>已生成：${esc(r.targetRole)}<span style="font-weight:400;color:var(--muted);font-size:12px;margin-left:8px">${esc(r.updatedAt || "")}</span></h3>
      <button class="btn" id="rsCopy">复制简历</button>
    </div>
    ${hl ? `<div class="rv-section"><h4>本版亮点</h4><ul>${hl}</ul></div>` : ""}
    <pre class="rv-transcript" style="max-height:none;font-family:-apple-system,'PingFang SC',sans-serif;line-height:1.75">${esc(r.markdown)}</pre>
    ${tp ? `<div class="rv-section" style="margin-top:12px"><h4>投递前建议</h4><ul>${tp}</ul></div>` : ""}`;
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