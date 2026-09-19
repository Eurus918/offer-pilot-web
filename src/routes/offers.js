/**
 * Offer 对比：量化总包、扣掉城市生活成本看真实可支配收入，再由 AI 做有立场的对比
 */
import { Router } from "express";
import { asyncHandler, badRequest, notFound } from "../errors.js";
import { calcOffer, offersToText, cityList } from "../services/offerService.js";
import { offerCompareSys } from "../prompts.js";

export function registerOffers(router, ctx) {
  router.get("/api/offers", (req, res) => {
    res.json({
      offers: ctx.store.offers.map((o) => ({ ...o, calc: calcOffer(o) })),
      cities: cityList(),
      compare: ctx.store.offerCompare || null,
    });
  });

  router.post(
    "/api/offers",
    asyncHandler(async (req, res) => {
      const b = req.body || {};
      if (!b.company || !String(b.company).trim()) throw badRequest("请填写公司名称");
      const offer = {
        id: "of-" + Date.now(),
        company: String(b.company).trim(),
        role: b.role || "",
        city: b.city || "",
        level: b.level || "",
        baseMonth: Number(b.baseMonth) || 0,
        months: Number(b.months) || 12,
        bonus: Number(b.bonus) || 0,
        equity: Number(b.equity) || 0,
        signOn: Number(b.signOn) || 0,
        growth: b.growth || "",
        notes: b.notes || "",
        createdAt: new Date().toISOString().slice(0, 10),
      };
      ctx.store.offers.push(offer);
      ctx.save();
      res.json({ offer: { ...offer, calc: calcOffer(offer) } });
    })
  );

  router.patch(
    "/api/offers/:id",
    asyncHandler(async (req, res) => {
      const o = ctx.store.offers.find((x) => x.id === req.params.id);
      if (!o) throw notFound("Offer 不存在");
      Object.assign(o, req.body || {});
      delete o.id; // 不允许改 id
      ctx.save();
      res.json({ offer: { ...o, calc: calcOffer(o) } });
    })
  );

  router.delete(
    "/api/offers/:id",
    asyncHandler(async (req, res) => {
      const before = ctx.store.offers.length;
      ctx.store.offers = ctx.store.offers.filter((x) => x.id !== req.params.id);
      ctx.save();
      res.json({ ok: true, deleted: before - ctx.store.offers.length });
    })
  );

  /** AI 全方位对比 */
  router.post(
    "/api/offers/compare",
    asyncHandler(async (req, res) => {
      const offers = ctx.store.offers.map((o) => ({ ...o, calc: calcOffer(o) }));
      if (offers.length < 2) throw badRequest("至少需要 2 个 Offer 才能对比");

      const factsText = (ctx.store.profile?.facts || [])
        .map((f) => `- ${f.key}：${f.value}`)
        .join("\n");

      const j = await ctx.aiJson({
        system: offerCompareSys(),
        user:
          `使用者的已知偏好/事实：\n${factsText || "（暂无）"}\n\n` +
          `===== 待对比 Offer =====\n${offersToText(offers)}\n\n请做全方位对比分析。`,
      }, null);

      if (!j) throw badRequest("AI 未返回对比结果，请重试一次");
      ctx.store.offerCompare = { ...j, updatedAt: new Date().toISOString().slice(0, 10) };
      ctx.save();
      res.json({ compare: j, offers });
    })
  );
}
