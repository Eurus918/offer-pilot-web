/**
 * 面试复盘：纪要 → 结构化复盘 → 沉淀回档案 → 反哺下次备战
 */
import { Router } from "express";
import { asyncHandler, badRequest, notFound } from "../errors.js";
import { analyzeReview, syncStrengthsToProfile, summarizeReviews } from "../services/reviewService.js";

export function registerReviews(router, ctx) {
  router.get("/api/reviews", (req, res) => {
    res.json({ reviews: ctx.store.reviews });
  });

  /** 新建复盘（粘贴或上传纪要内容），自动做 AI 分析 */
  router.post(
    "/api/reviews",
    asyncHandler(async (req, res) => {
      const { company, role, round, date, transcript, source = "manual" } = req.body || {};
      if (!transcript || !String(transcript).trim()) throw badRequest("请粘贴面试纪要内容");

      const review = {
        id: "rv-" + Date.now(),
        company: company || "未填写公司",
        role: role || "未填写岗位",
        round: round || "未知轮次",
        date: date || new Date().toISOString().slice(0, 10),
        source, // manual=粘贴 / file=文件上传 / api=腾讯会议同步
        transcript: String(transcript).trim(),
        analysis: null,
        createdAt: new Date().toISOString().slice(0, 10),
      };

      // 分析失败不阻断保存：纪要先留住，使用者可以稍后手动重跑
      let analyzeError = "";
      try {
        review.analysis = await analyzeReview(ctx, review);
      } catch (e) {
        analyzeError = e.message || String(e);
        console.warn("[reviews] 复盘 AI 分析失败:", analyzeError);
      }

      ctx.store.reviews.unshift(review);
      syncStrengthsToProfile(ctx.store);
      ctx.save();
      res.json({ review, analyzeError: analyzeError || undefined });
    })
  );

  /** 重新分析某条复盘（换了模型、或想再跑一次） */
  router.post(
    "/api/reviews/:id/analyze",
    asyncHandler(async (req, res) => {
      const rv = ctx.store.reviews.find((x) => x.id === req.params.id);
      if (!rv) throw notFound("复盘不存在");
      rv.analysis = await analyzeReview(ctx, rv);
      syncStrengthsToProfile(ctx.store);
      ctx.save();
      res.json({ review: rv });
    })
  );

  /** 编辑复盘：改了纪要默认自动重新分析（reanalyze=false 可跳过） */
  router.patch(
    "/api/reviews/:id",
    asyncHandler(async (req, res) => {
      const rv = ctx.store.reviews.find((x) => x.id === req.params.id);
      if (!rv) throw notFound("复盘不存在");
      const { company, role, round, date, transcript, reanalyze } = req.body || {};
      if (company !== undefined) rv.company = company;
      if (role !== undefined) rv.role = role;
      if (round !== undefined) rv.round = round;
      if (date !== undefined) rv.date = date;

      let need = false;
      if (transcript !== undefined && String(transcript).trim() && String(transcript).trim() !== rv.transcript) {
        rv.transcript = String(transcript).trim();
        need = true;
      }
      if (reanalyze === true || need) {
        rv.analysis = await analyzeReview(ctx, rv);
        syncStrengthsToProfile(ctx.store);
      }
      ctx.save();
      res.json({ review: rv });
    })
  );

  router.delete(
    "/api/reviews/:id",
    asyncHandler(async (req, res) => {
      const before = ctx.store.reviews.length;
      ctx.store.reviews = ctx.store.reviews.filter((x) => x.id !== req.params.id);
      syncStrengthsToProfile(ctx.store);
      ctx.save();
      res.json({ ok: true, deleted: before - ctx.store.reviews.length });
    })
  );

  /** 跨复盘汇总：稳定强项 / 反复出错点 / 知识盲区 / 得分趋势 */
  router.get("/api/reviews/summary", (req, res) => {
    res.json(summarizeReviews(ctx.store));
  });
}
