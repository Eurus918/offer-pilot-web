/**
 * 面邀备战：JD → AI 备战包、陪练对话、DDL 与日历提醒
 */
import { Router } from "express";
import { execFileSync } from "child_process";
import { asyncHandler, badRequest, notFound } from "../errors.js";
import { interviewPrepSys, interviewChatSys } from "../prompts.js";
import { buildReviewContext } from "../services/reviewService.js";

/** 企微日历 CLI 是否可用（腾讯内部工具，外部使用者通常没有——缺失时优雅降级） */
function wecomCliAvailable() {
  try {
    execFileSync("which", ["wecomcli"], { encoding: "utf-8", timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

export function registerInterviews(router, ctx) {
  /** 新建面试 + 生成备战包（会注入同公司/近期的历史复盘） */
  router.post(
    "/api/interviews",
    asyncHandler(async (req, res) => {
      const { company, role, jdText, jdImage, type = "upcoming", ddl = "" } = req.body || {};
      if (!company && !jdText && !jdImage) throw badRequest("请至少填写公司或 JD 内容");

      const interview = {
        id: "iv-" + Date.now(),
        company: company || "未知公司",
        role: role || "未知岗位",
        type,
        status: type === "historical" ? "rejected" : "pending",
        ddl: ddl || "",
        ddlReminder: false,
        jdText: jdText || "",
        jdImage: jdImage || "",
        prep: null,
        chat: [],
        createdAt: new Date().toISOString().slice(0, 10),
      };

      const reviewCtx = buildReviewContext(ctx.store, interview.company);
      if (reviewCtx) interview.usedReviewContext = true;

      const prep = await ctx.aiJson({
        system: interviewPrepSys(ctx.store, reviewCtx),
        user: `公司：${interview.company}，岗位：${interview.role}\nJD 内容：\n${jdText || "（见附图）"}`,
        images: jdImage ? [jdImage] : [],
      }, null);

      // 解析失败时把原文兜底塞进自我介绍，避免使用者白等一次调用
      interview.prep = prep || {
        selfIntro: "（AI 返回格式异常，请重试一次；若反复失败，可在设置页更换模型）",
        questions: [],
        knowledge: "",
      };
      ctx.store.interviews.push(interview);
      ctx.save();
      res.json({ interview });
    })
  );

  /** 针对某场面试的陪练问答 */
  router.post(
    "/api/interviews/:id/chat",
    asyncHandler(async (req, res) => {
      const iv = ctx.store.interviews.find((x) => x.id === req.params.id);
      if (!iv) throw notFound("面试不存在");
      const { message } = req.body || {};
      if (!message) throw badRequest("消息为空");

      iv.chat.push({ role: "user", text: message });
      const reply = await ctx.ai({
        system: interviewChatSys(ctx.store, iv),
        user: message,
        history: iv.chat.slice(0, -1).map((h) => ({ role: h.role, content: h.text })),
      });
      iv.chat.push({ role: "assistant", text: reply });
      ctx.save();
      res.json({ reply });
    })
  );

  router.patch(
    "/api/interviews/:id/ddl",
    asyncHandler(async (req, res) => {
      const iv = ctx.store.interviews.find((x) => x.id === req.params.id);
      if (!iv) throw notFound("面试不存在");
      iv.ddl = (req.body || {}).ddl || "";
      ctx.save();
      res.json({ ok: true, ddl: iv.ddl });
    })
  );

  router.patch(
    "/api/interviews/:id",
    asyncHandler(async (req, res) => {
      const iv = ctx.store.interviews.find((x) => x.id === req.params.id);
      if (!iv) throw notFound("面试不存在");
      const { company, role, jdText, type, status } = req.body || {};
      if (company !== undefined) iv.company = company;
      if (role !== undefined) iv.role = role;
      if (jdText !== undefined) iv.jdText = jdText;
      if (type !== undefined) iv.type = type;
      if (status !== undefined) iv.status = status;
      ctx.save();
      res.json({ interview: iv });
    })
  );

  router.delete(
    "/api/interviews/:id",
    asyncHandler(async (req, res) => {
      const before = ctx.store.interviews.length;
      ctx.store.interviews = ctx.store.interviews.filter((x) => x.id !== req.params.id);
      ctx.save();
      res.json({ ok: true, deleted: before - ctx.store.interviews.length });
    })
  );

  /**
   * 创建日历提醒。
   * 安全说明：旧版用 execSync 拼字符串，公司名里带引号或分号就会被当成 shell 命令执行。
   * 这里改用 execFileSync + 参数数组，shell 不参与解析，注入风险归零。
   */
  router.post(
    "/api/interviews/:id/remind",
    asyncHandler(async (req, res) => {
      const iv = ctx.store.interviews.find((x) => x.id === req.params.id);
      if (!iv) throw notFound("面试不存在");
      if (!iv.ddl) throw badRequest("该面试还没设置截止时间");

      const when = new Date(iv.ddl);
      if (Number.isNaN(when.getTime())) throw badRequest("截止时间格式不正确");

      const title = `【面试】${iv.company} · ${iv.role}`;
      const startTime = when.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";

      if (!wecomCliAvailable()) {
        return res.json({
          ok: false,
          fallback: true,
          title,
          startTime,
          message: "未检测到 wecomcli（企业微信 CLI），请手动添加日程：" + title + " @ " + iv.ddl,
        });
      }

      try {
        const out = execFileSync(
          "wecomcli",
          ["calendar", "create", "--title", title, "--start", startTime, "--minutes-before", "30"],
          { encoding: "utf-8", timeout: 10000 }
        );
        iv.ddlReminder = true;
        ctx.save();
        res.json({ ok: true, message: "企微日历提醒已创建", detail: String(out).slice(0, 200) });
      } catch (e) {
        res.json({
          ok: false,
          fallback: true,
          title,
          startTime,
          message: "企微日历创建失败，请手动添加：" + title + " @ " + iv.ddl,
        });
      }
    })
  );
}
