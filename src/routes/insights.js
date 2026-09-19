/**
 * 数据洞察 + JD 匹配度 + 模拟面试
 *
 * 三者构成一个决策闭环：
 *   投前（这个岗值不值得投）→ 投中（我的漏斗哪里在漏）→ 面后（我进步了吗）
 */
import { Router } from "express";
import { asyncHandler, badRequest, notFound } from "../errors.js";
import { buildInsights } from "../services/insightService.js";
import { jdMatchSys, mockInterviewSys } from "../prompts.js";
import { summarizeReviews } from "../services/reviewService.js";

export function registerInsights(router, ctx) {
  /** 投递数据洞察（纯计算，不依赖 AI） */
  router.get("/api/insights", (req, res) => {
    res.json({
      insights: buildInsights(ctx.store.applications, ctx.store.interviews, ctx.store.reviews),
      reviewSummary: summarizeReviews(ctx.store),
    });
  });

  /** JD 匹配度分析：贴 JD 或传图 → 要不要投、投之前补什么 */
  router.post(
    "/api/jd/match",
    asyncHandler(async (req, res) => {
      const { company, role, jdText, jdImage } = req.body || {};
      if (!jdText && !jdImage) throw badRequest("请粘贴 JD 内容或上传 JD 截图");

      const j = await ctx.aiJson({
        system: jdMatchSys(ctx.store),
        user:
          `公司：${company || "未填写"}\n岗位：${role || "未填写"}\n\n` +
          `===== JD =====\n${jdText || "（见附图）"}\n===== JD 结束 =====\n\n` +
          `请判断匹配度并给出投递建议。`,
        images: jdImage ? [jdImage] : [],
      }, null);

      if (!j) throw badRequest("AI 未返回分析结果，请重试一次");
      res.json({ match: j });
    })
  );

  /**
   * 模拟面试：扮演面试官连续追问。
   * phase: start（开场提问）| continue（追问）| end（出评价，返回 JSON）
   */
  router.post(
    "/api/interviews/:id/mock",
    asyncHandler(async (req, res) => {
      const iv = ctx.store.interviews.find((x) => x.id === req.params.id);
      if (!iv) throw notFound("面试不存在");
      const { phase = "continue", message = "" } = req.body || {};

      // 模拟面试的对话单独存一份，不污染备战陪练的 chat
      if (!Array.isArray(iv.mock)) iv.mock = [];

      if (phase === "start") iv.mock = [];
      if (message) iv.mock.push({ role: "user", text: message });

      const history = iv.mock.map((h) => ({ role: h.role, content: h.text }));
      const isEnd = phase === "end";

      const out = await ctx.ai({
        system: mockInterviewSys(ctx.store, iv, phase),
        user: isEnd
          ? "请基于刚才这场模拟面试给出评价，严格按 JSON 输出。"
          : phase === "start"
            ? "请开始这场模拟面试。"
            : message,
        history: isEnd ? history : history.slice(0, -1),
        json: isEnd,
      });

      if (isEnd) {
        // 评价不进对话流，单独存字段
        const { parseJsonLoose } = await import("../ai.js");
        iv.mockResult = parseJsonLoose(out);
      } else {
        iv.mock.push({ role: "assistant", text: out });
      }
      ctx.save();
      res.json({ reply: out, mock: iv.mock, mockResult: iv.mockResult || null });
    })
  );
}
