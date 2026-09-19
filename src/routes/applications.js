/**
 * 投递进度：11 阶段流水线的增删改
 */
import { Router } from "express";
import { asyncHandler, badRequest, notFound } from "../errors.js";

/** 投递阶段定义——前端漏斗与"下一步建议"都基于这张表 */
export const STAGES = [
  { key: "screening", label: "简历筛选中", hint: "等结果；超 7 个工作日无反馈可礼貌催问" },
  { key: "review", label: "简历评估中", hint: "关注邮箱/短信评估通知" },
  { key: "written_pending", label: "待笔试", hint: "等笔试链接；超 5 工作日可礼貌催问" },
  { key: "written_done", label: "笔试完成", hint: "等笔试结果，一般 3-7 个工作日出" },
  { key: "interview1", label: "一面", hint: "约面后尽快排期备战" },
  { key: "interview2", label: "二面", hint: "复盘一面，针对性补强" },
  { key: "interview3", label: "三面", hint: "多为交叉面/主管面，准备业务理解" },
  { key: "hr", label: "HR 面", hint: "准备薪资预期与到岗时间" },
  { key: "offer", label: "已 offer", hint: "对比总包与成长性，可谈签约时间" },
  { key: "rejected", label: "已结束", hint: "复盘原因，同步更新备战重点" },
  { key: "withdrawn", label: "已放弃", hint: "记录原因，避免重复踩坑" },
];

export function registerApplications(router, ctx) {
  /** 阶段字典（前端下拉用） */
  router.get("/api/applications/stages", (req, res) => {
    res.json({ stages: STAGES });
  });

  /** 新增或更新 */
  router.post(
    "/api/applications",
    asyncHandler(async (req, res) => {
      const a = req.body || {};
      if (!a.company || !String(a.company).trim()) throw badRequest("请填写公司名称");
      const payload = { ...a, company: String(a.company).trim() };
      if (a.id) {
        const i = ctx.store.applications.findIndex((x) => x.id === a.id);
        if (i >= 0) ctx.store.applications[i] = { ...ctx.store.applications[i], ...payload };
        else ctx.store.applications.push(payload);
      } else {
        payload.id = "app-" + Date.now();
        ctx.store.applications.push(payload);
      }
      ctx.save();
      res.json({ ok: true, applications: ctx.store.applications });
    })
  );

  router.delete(
    "/api/applications/:id",
    asyncHandler(async (req, res) => {
      const before = ctx.store.applications.length;
      ctx.store.applications = ctx.store.applications.filter((x) => x.id !== req.params.id);
      ctx.save();
      res.json({ ok: true, deleted: before - ctx.store.applications.length });
    })
  );

  /** 只改阶段（漏斗图拖动时用） */
  router.patch(
    "/api/applications/:id/stage",
    asyncHandler(async (req, res) => {
      const app = ctx.store.applications.find((x) => x.id === req.params.id);
      if (!app) throw notFound("投递记录不存在");
      const { stageKey } = req.body || {};
      const stage = STAGES.find((s) => s.key === stageKey);
      if (!stage) throw badRequest("未知的阶段：" + stageKey);
      app.stageKey = stage.key;
      app.stage = stage.label;
      if (!app.next || app.nextSource === "stage") {
        app.next = stage.hint;
        app.nextSource = "stage";
      }
      app.updatedAt = new Date().toISOString().slice(0, 10);
      ctx.save();
      res.json({ ok: true, application: app });
    })
  );
}
