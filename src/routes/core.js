/**
 * 核心路由：状态、配置、首次启动引导
 */
import { Router } from "express";
import { onboardingState } from "../store.js";
import { asyncHandler, badRequest } from "../errors.js";
import { cityList } from "../services/offerService.js";

export function registerCore(router, ctx) {
  /** 全局状态 */
  router.get("/api/state", (req, res) => {
    res.json({
      profile: ctx.store.profile,
      applications: ctx.store.applications,
      interviews: ctx.store.interviews,
      works: ctx.store.works,
      reviews: ctx.store.reviews,
      offers: ctx.store.offers,
      resume: ctx.store.resume || null,
      offerCompare: ctx.store.offerCompare || null,
      hasKey: ctx.hasKey(),
      model: ctx.getModel(),
      theme: ctx.store.config?.theme || null,
      onboarding: onboardingState(ctx.store),
      cities: cityList(),
    });
  });

  /** 配置：API Key / 模型 / 会议凭证 / 主题 */
  router.post(
    "/api/config",
    asyncHandler(async (req, res) => {
      const { apiKey, model, meeting, theme } = req.body || {};
      if (apiKey !== undefined) ctx.store.config.apiKey = String(apiKey).trim();
      if (model !== undefined) ctx.store.config.model = String(model).trim();
      if (meeting && typeof meeting === "object") {
        ctx.store.config.meeting = { ...(ctx.store.config.meeting || {}), ...meeting };
      }
      if (theme && typeof theme === "object") ctx.store.config.theme = theme;
      ctx.store.config.updatedAt = new Date().toISOString().slice(0, 10);
      ctx.save();
      res.json({ ok: true, hasKey: ctx.hasKey(), model: ctx.getModel() });
    })
  );

  /** 首次启动引导：保存基本信息并标记完成 */
  router.post(
    "/api/onboarding",
    asyncHandler(async (req, res) => {
      const { name, education, targetRoles, city, phone, email } = req.body || {};
      const b = ctx.store.profile.basics;
      const put = (k, v) => {
        if (v !== undefined && v !== null && String(v).trim()) b[k] = String(v).trim();
      };
      put("name", name);
      put("education", education);
      put("targetRoles", targetRoles);
      put("city", city);
      put("phone", phone);
      put("email", email);

      if (!b.name && !b.targetRoles) throw badRequest("请至少填写姓名或目标岗位");

      ctx.store.onboarding = { done: true, completedAt: new Date().toISOString().slice(0, 10) };
      ctx.save();
      res.json({ ok: true, onboarding: onboardingState(ctx.store), profile: ctx.store.profile });
    })
  );

  /** 跳过引导 */
  router.post(
    "/api/onboarding/skip",
    asyncHandler(async (req, res) => {
      ctx.store.onboarding = { done: true, skippedAt: new Date().toISOString().slice(0, 10) };
      ctx.save();
      res.json({ ok: true, onboarding: onboardingState(ctx.store) });
    })
  );

  /** 健康检查（部署平台探活用） */
  router.get("/api/health", (req, res) => {
    res.json({ ok: true, uptime: Math.floor(process.uptime()), hasKey: ctx.hasKey() });
  });
}
