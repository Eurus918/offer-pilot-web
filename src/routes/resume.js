/**
 * AI 简历生成：两阶段——先追问信息缺口，再出稿。
 * 设计意图：不让 AI 凭空编经历，缺什么先问使用者。
 */
import { Router } from "express";
import { asyncHandler, badRequest } from "../errors.js";
import { resumeAskSys, resumeWriteSys } from "../prompts.js";
import { profileToText } from "../persona.js";

export function registerResume(router, ctx) {
  router.post(
    "/api/resume/generate",
    asyncHandler(async (req, res) => {
      const { targetRole, answers = [] } = req.body || {};
      if (!targetRole || !String(targetRole).trim()) throw badRequest("请填写目标岗位");
      const role = String(targetRole).trim();
      const profileText = profileToText(ctx.store);

      // 阶段一：找出信息缺口
      if (!answers.length) {
        const j = await ctx.aiJson({
          system: resumeAskSys(ctx.store, role),
          user: `目标岗位：${role}\n\n${profileText}\n请列出需要向使用者确认的问题。`,
        }, { questions: [] });
        return res.json({ stage: "ask", questions: j.questions || [] });
      }

      // 阶段二：生成简历
      const answersText = answers
        .map((a, i) => `${i + 1}. ${a.q}\n   答：${a.a}`)
        .join("\n");
      const j = await ctx.aiJson({
        system: resumeWriteSys(ctx.store, role),
        user:
          `目标岗位：${role}\n\n${profileText}\n\n【补充回答】\n${answersText}\n\n` +
          `请基于以上内容生成针对性简历。`,
      }, null);

      if (!j || !j.markdown) throw badRequest("AI 未返回简历内容，请重试一次");

      const record = {
        targetRole: role,
        markdown: j.markdown,
        highlights: j.highlights || [],
        tips: j.tips || [],
        updatedAt: new Date().toISOString().slice(0, 10),
      };
      ctx.store.resume = record;
      ctx.save();
      res.json({ stage: "done", resume: record });
    })
  );

  router.get("/api/resume", (req, res) => {
    res.json({ resume: ctx.store.resume || null });
  });

  router.delete(
    "/api/resume",
    asyncHandler(async (req, res) => {
      ctx.store.resume = null;
      ctx.save();
      res.json({ ok: true });
    })
  );
}
