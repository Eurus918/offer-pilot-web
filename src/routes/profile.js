/**
 * 个人档案：AI 问答、偏好沉淀
 */
import { Router } from "express";
import { asyncHandler, badRequest } from "../errors.js";
import { chatSys, extractFactsSys } from "../prompts.js";
import { parseJsonLoose } from "../ai.js";

/** 上传文件 → 转成给模型的文本补充 + 图片数组 */
function buildUserContent(message, file) {
  let text = message || "";
  const images = [];
  if (!file || !file.data) return { text, images };

  if (String(file.type || "").startsWith("image/")) {
    images.push(file.data);
    text = text
      ? text + "\n\n[附图：请结合图片内容分析]"
      : "请分析这张图片（可能是 JD 截图、简历、笔试题等），结合我的背景给出建议。";
    return { text, images };
  }

  // 非图片：只有纯文本能真正取出内容，其余只给个提示
  const name = file.name || "附件";
  text =
    (text || "请帮我分析这个文件。") +
    `\n\n[上传了文档：${name}，类型：${file.type || "未知"}。若为纯文本，内容已附在后面；若为 PDF/Word，请基于文件名与上下文分析。]`;

  const isText = file.type === "text/plain" || /\.txt$/i.test(name) || /\.md$/i.test(name);
  if (isText) {
    try {
      const decoded = Buffer.from(String(file.data).split(",")[1] || "", "base64").toString("utf-8");
      text += "\n\n--- 文档内容 ---\n" + decoded.slice(0, 8000);
    } catch { /* 解码失败就只留文件名提示 */ }
  }
  return { text, images };
}

export function registerProfile(router, ctx) {
  /** 通用 AI 问答（支持上传图片/文本） */
  router.post(
    "/api/chat",
    asyncHandler(async (req, res) => {
      const { message, file, history = [] } = req.body || {};
      if (!message && !(file && file.data)) throw badRequest("消息和文件不能都为空");

      const { text, images } = buildUserContent(message, file);
      const push = (role, t, fileName) => {
        ctx.store.profile.chatHistory.push({
          role,
          text: t,
          at: Date.now(),
          ...(fileName ? { fileName } : {}),
        });
      };

      if (file && file.data) push("user", message || `[上传了文件: ${file.name || "附件"}]`, file.name);
      else push("user", message);
      ctx.save();

      const reply = await ctx.ai({
        system: chatSys(ctx.store),
        user: text,
        images,
        history: (Array.isArray(history) ? history : []).map((h) => ({ role: h.role, content: h.text })),
      });

      push("assistant", reply);
      ctx.save();
      res.json({ reply });
    })
  );

  /** 从对话抽取求职偏好并合并进档案 */
  router.post(
    "/api/profile/extract",
    asyncHandler(async (req, res) => {
      const { text } = req.body || {};
      if (!text) return res.json({ facts: ctx.store.profile.facts });

      const today = new Date().toISOString().slice(0, 10);
      const existing = ctx.store.profile.facts.map((f) => `${f.key}=${f.value}`).join("；");
      const out = await ctx.aiJson({
        system: extractFactsSys(existing),
        user: "请抽取这段话里的个人求职偏好事实：\n" + text,
      }, { facts: [] });

      const map = new Map(ctx.store.profile.facts.map((f) => [f.key, f]));
      for (const f of out?.facts || []) {
        if (!f?.key || !f?.value) continue;
        map.set(f.key, { key: String(f.key), value: String(f.value), source: "对话沉淀", updatedAt: today });
      }
      ctx.store.profile.facts = [...map.values()];
      ctx.save();
      res.json({ facts: ctx.store.profile.facts });
    })
  );

  /** 手动记录偏好（不调用 AI，没 Key 也能用） */
  router.post(
    "/api/profile/fact",
    asyncHandler(async (req, res) => {
      const { key, value } = req.body || {};
      if (!key || !value) throw badRequest("请填写维度和内容");
      const today = new Date().toISOString().slice(0, 10);
      const k = String(key).trim();
      const map = new Map(ctx.store.profile.facts.map((f) => [f.key, f]));
      map.set(k, { key: k, value: String(value).trim(), source: "手动记录", updatedAt: today });
      ctx.store.profile.facts = [...map.values()];
      ctx.save();
      res.json({ facts: ctx.store.profile.facts });
    })
  );

  /** 删除某条偏好 */
  router.delete(
    "/api/profile/fact/:key",
    asyncHandler(async (req, res) => {
      const key = decodeURIComponent(req.params.key || "");
      ctx.store.profile.facts = ctx.store.profile.facts.filter((f) => f.key !== key);
      ctx.save();
      res.json({ facts: ctx.store.profile.facts });
    })
  );

  /** 更新基本信息 */
  router.patch(
    "/api/profile/basics",
    asyncHandler(async (req, res) => {
      const patch = req.body || {};
      const b = ctx.store.profile.basics;
      for (const [k, v] of Object.entries(patch)) {
        if (typeof v === "string" || typeof v === "number") b[k] = v;
      }
      ctx.save();
      res.json({ basics: b });
    })
  );

  /** 清空对话记录 */
  router.delete(
    "/api/profile/chat",
    asyncHandler(async (req, res) => {
      ctx.store.profile.chatHistory = [];
      ctx.save();
      res.json({ ok: true });
    })
  );
}
