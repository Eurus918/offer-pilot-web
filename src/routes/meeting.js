/**
 * 腾讯会议集成（可选）：云录制 → 智能纪要 → 自动建复盘
 *
 * 这是给「用腾讯会议面试」的使用者准备的省力功能，不是必需项。
 * 未配置凭证时所有接口都会明确提示，并引导手动粘贴纪要——不影响其他模块使用。
 *
 * 接口文档参照官方：GET /v1/smart/minutes/{record_file_id}?llm=3（元宝纪要）
 * 硬性前提：商业版/企业版/教育版 + 应用具备「查看企业录制」权限；
 * 2026-02 起新建自建应用还需 STS-Token。个人版账号用不了，这是平台限制，不是本项目的限制。
 */
import { Router } from "express";
import crypto from "crypto";
import { asyncHandler, badRequest } from "../errors.js";
import { analyzeReview, syncStrengthsToProfile } from "../services/reviewService.js";
import { friendly } from "../errors.js";

function meetingConfig(ctx) {
  const m = ctx.store.config?.meeting || {};
  return {
    appId: process.env.TENCENT_MEETING_APP_ID || m.appId || "",
    sdkId: process.env.TENCENT_MEETING_SDK_ID || m.sdkId || "",
    secretId: process.env.TENCENT_MEETING_SECRET_ID || m.secretId || "",
    secretKey: process.env.TENCENT_MEETING_SECRET_KEY || m.secretKey || "",
    userId: process.env.TENCENT_MEETING_USER_ID || m.userId || "",
    stsToken: process.env.TENCENT_MEETING_STS_TOKEN || m.stsToken || "",
  };
}

function meetingMissing(cfg) {
  const need = [];
  if (!cfg.appId) need.push("appId");
  if (!cfg.secretKey) need.push("secretKey");
  if (!cfg.userId) need.push("userId");
  return need;
}

/** AK/SK 签名 */
function meetingSign(method, path, body, cfg) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = String(Math.abs(crypto.randomInt(1, 2 ** 31)));
  const signStr = [
    method.toUpperCase(),
    `X-TC-Key:${cfg.appId}`,
    `X-TC-Nonce:${nonce}`,
    `X-TC-Timestamp:${timestamp}`,
    body || "",
  ].join("\n");
  const signature = crypto.createHmac("sha256", cfg.secretKey).update(signStr).digest("base64");
  const headers = {
    "Content-Type": "application/json",
    "X-TC-Key": cfg.appId,
    "X-TC-Timestamp": timestamp,
    "X-TC-Nonce": nonce,
    "X-TC-Signature": signature,
  };
  if (cfg.sdkId) headers["X-TC-SdkId"] = cfg.sdkId;
  if (cfg.secretId) headers["X-TC-SecretId"] = cfg.secretId;
  if (cfg.stsToken) headers["X-TC-STSToken"] = cfg.stsToken; // 2026-02 起新建自建应用必需
  return headers;
}

async function meetingGet(path, cfg) {
  const res = await fetch("https://api.meeting.qq.com" + path, {
    method: "GET",
    headers: meetingSign("GET", path, "", cfg),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const e = new Error(
      `会议接口 ${res.status}：${data?.message || data?.error_msg || data?.error?.message || text.slice(0, 120)}`
    );
    e.code = 502;
    e.detail = data;
    throw e;
  }
  return data;
}

/** 兼容多种返回结构，抽出纪要纯文本 */
function extractMinutesText(j) {
  if (typeof j === "string") return j.trim();
  if (!j || typeof j !== "object") return "";
  const keys = ["text", "content", "minutes_text", "transcript", "summary"];
  for (const k of keys) {
    if (typeof j[k] === "string" && j[k].trim()) return j[k].trim();
  }
  const d = j.data;
  if (d && typeof d === "object") {
    for (const k of keys) {
      if (typeof d[k] === "string" && d[k].trim()) return d[k].trim();
    }
  }
  const arr = j.minutes || j.paragraphs || j.chapters || d?.minutes || d?.paragraphs || [];
  if (Array.isArray(arr) && arr.length) {
    return arr
      .map((x) => {
        if (typeof x === "string") return x;
        const title = x.title || x.topic || x.speaker || "";
        const body = x.content || x.text || x.summary || x.sentence || "";
        return title ? `【${title}】${body}` : body;
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

async function fetchMeetingMinutes(meetingId, cfg) {
  const q = `operator_id=${encodeURIComponent(cfg.userId)}&operator_id_type=1`;
  // ① 云录制列表
  const recRes = await meetingGet(`/v1/records?meeting_id=${encodeURIComponent(meetingId)}&${q}`, cfg);
  const files = recRes.record_files || recRes.records || recRes.data?.record_files || [];
  if (!files.length) throw new Error("该会议暂无云录制（需在会议中开启云录制，并等录制+纪要生成完成）");
  const file = files[0];
  const recordFileId = file.record_file_id || file.record_file_id_str;
  if (!recordFileId) throw new Error("录制列表缺少 record_file_id");
  // ② 智能纪要（llm=3 → 元宝纪要）
  const minRes = await meetingGet(`/v1/smart/minutes/${recordFileId}?${q}&llm=3`, cfg);
  const text = extractMinutesText(minRes);
  if (!text) throw new Error("已取回纪要响应，但未解析出文本内容（接口结构可能与预期不同）");
  return {
    recordFileId,
    meetingId: file.meeting_id || meetingId,
    subject: file.meeting_subject || file.subject || file.meeting_topic || "",
    text,
  };
}

export function registerMeeting(router, ctx) {
  /** 凭证配置状态（只回传掩码，不回传密钥明文） */
  router.get("/api/meeting/config", (req, res) => {
    const cfg = meetingConfig(ctx);
    const mask = (v) => (v ? v.slice(0, 4) + "••••" + v.slice(-2) : "");
    res.json({
      configured: meetingMissing(cfg).length === 0,
      missing: meetingMissing(cfg),
      appId: mask(cfg.appId),
      userId: cfg.userId || "",
      hasStsToken: !!cfg.stsToken,
    });
  });

  /** 从腾讯会议拉取纪要并自动建立复盘 */
  router.post(
    "/api/reviews/sync",
    asyncHandler(async (req, res) => {
      const { meetingId, company, role, round, date } = req.body || {};
      const cfg = meetingConfig(ctx);
      const need = meetingMissing(cfg);
      if (need.length) {
        return res.json({
          ok: false,
          stage: "config",
          message: `尚未配置腾讯会议凭证（缺少：${need.join("、")}）`,
          fallback: "请在「设置」页填写会议凭证；未配置时仍可手动粘贴纪要。",
          need,
        });
      }
      if (!meetingId) throw badRequest("请提供会议 ID（meetingId）");

      try {
        const m = await fetchMeetingMinutes(meetingId, cfg);
        const review = {
          id: "rv-" + Date.now(),
          company: company || m.subject || "未填写公司",
          role: role || "未填写岗位",
          round: round || "未知轮次",
          date: date || new Date().toISOString().slice(0, 10),
          source: "api",
          transcript: m.text,
          analysis: null,
          meetingId: m.meetingId,
          recordFileId: m.recordFileId,
          createdAt: new Date().toISOString().slice(0, 10),
        };
        let analyzeError = "";
        try {
          review.analysis = await analyzeReview(ctx, review);
        } catch (e) {
          analyzeError = friendly(e);
        }
        ctx.store.reviews.unshift(review);
        syncStrengthsToProfile(ctx.store);
        ctx.save();
        res.json({ ok: true, review, subject: m.subject, analyzeError: analyzeError || undefined });
      } catch (e) {
        res.status(e.code || 500).json({
          ok: false,
          stage: "api",
          error: friendly(e),
          hint:
            "常见原因：①账号非商业版/企业版/教育版 ②应用缺「查看企业录制」权限 " +
            "③会议未开启云录制或纪要尚未生成 ④2026-02 起新建自建应用需 STS-Token " +
            "⑤该会议属于对方企业（录制在对方，永远拉不到）",
        });
      }
    })
  );
}
