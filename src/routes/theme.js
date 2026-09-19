/**
 * AI 生成界面主题：上传一张图 → 提取配色 → 生成 CSS 变量
 */
import { Router } from "express";
import { asyncHandler, badRequest } from "../errors.js";
import { themeSys } from "../prompts.js";

export function registerTheme(router, ctx) {
  router.post(
    "/api/theme/generate",
    asyncHandler(async (req, res) => {
      const { image } = req.body || {};
      if (!image) throw badRequest("请上传图片");
      const t = await ctx.aiJson({
        system: themeSys(),
        user: "请分析这张图片并生成界面主题。",
        images: [image],
      }, null);
      if (!t || !t.vars || !t.vars.primary) throw badRequest("模型返回的主题缺少配色，换张图试试");
      res.json({
        ok: true,
        theme: { id: "custom", name: t.name || "自定义", summary: t.summary || "", vars: t.vars },
      });
    })
  );
}
