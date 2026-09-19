/**
 * 导出接口：把 AI 生成的内容 / 列表数据导出成真正的 Word(.docx) 与 Excel(.xlsx)。
 * 文件在服务端即时生成、直接下载，不落盘、不上传。
 */
import { Router } from "express";
import { asyncHandler, badRequest, notFound } from "../errors.js";
import { buildDocx, buildXlsx, textToBlocks } from "../services/documentService.js";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function safeFilename(name, ext) {
  const base = String(name || "导出").replace(/[\\/:*?"<>|]/g, "_").trim() || "导出";
  return base.endsWith("." + ext) ? base : `${base}.${ext}`;
}

function sendFile(res, buf, filename, mime) {
  res.setHeader("Content-Type", mime);
  // 中文文件名需要 RFC 5987 编码，否则部分浏览器会乱码
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.setHeader("Content-Length", buf.length);
  res.end(buf);
}

export function registerExport(router, ctx) {
  /** 通用：一段文本 → Word */
  router.post(
    "/api/export/docx",
    asyncHandler(async (req, res) => {
      const { title, text, blocks, filename } = req.body || {};
      const list = Array.isArray(blocks) && blocks.length
        ? blocks
        : textToBlocks(text || "");
      if (!list.length) throw badRequest("没有可导出的内容");
      const buf = buildDocx({ title: title || "", blocks: list });
      sendFile(res, buf, safeFilename(filename || title || "导出", "docx"), DOCX_MIME);
    })
  );

  /** 通用：二维数组 → Excel（第一行为表头，自动加粗） */
  router.post(
    "/api/export/xlsx",
    asyncHandler(async (req, res) => {
      const { sheets, rows, sheetName, filename } = req.body || {};
      const list = Array.isArray(sheets) && sheets.length
        ? sheets
        : [{ name: sheetName || "Sheet1", rows: Array.isArray(rows) ? rows : [] }];
      if (!list.some((s) => (s.rows || []).length)) throw badRequest("没有可导出的内容");
      const buf = buildXlsx(list);
      sendFile(res, buf, safeFilename(filename || sheetName || "导出", "xlsx"), XLSX_MIME);
    })
  );

  /** 简历导出（读已生成的简历；format=docx 默认，也支持 xlsx 表格版） */
  router.post(
    "/api/export/resume",
    asyncHandler(async (req, res) => {
      const r = ctx.store.resume;
      if (!r || !r.markdown) throw notFound("还没有生成过简历，先在档案页生成一份");
      const { format = "docx" } = req.body || {};
      const name = (r.targetRole || "简历").replace(/[\\/:*?"<>|]/g, "_");
      const b = ctx.store.profile?.basics || {};

      if (format === "xlsx") {
        const head = [["项目", "内容"]];
        if (b.name) head.push(["姓名", b.name]);
        if (b.targetRoles) head.push(["目标岗位", b.targetRoles]);
        if (b.education) head.push(["教育背景", b.education]);
        if (b.city) head.push(["意向城市", b.city]);
        const sections = String(r.markdown)
          .split(/\r?\n/)
          .reduce((acc, line) => {
            const t = line.trim();
            if (/^#{1,3}\s+/.test(t)) acc.push([t.replace(/^#{1,3}\s+/, ""), ""]);
            else if (t && acc.length) acc[acc.length - 1][1] += (acc[acc.length - 1][1] ? " " : "") + t.replace(/^[-*•·]\s+/, "");
            return acc;
          }, []);
        const rows = [...head, ...sections];
        const buf = buildXlsx([{ name: "简历", rows }]);
        return sendFile(res, buf, safeFilename(name, "xlsx"), XLSX_MIME);
      }

      const blocks = textToBlocks(r.markdown);
      if ((r.highlights || []).length) {
        blocks.push({ type: "h1", text: "本版亮点" });
        r.highlights.forEach((x) => blocks.push({ type: "li", text: x }));
      }
      if ((r.tips || []).length) {
        blocks.push({ type: "h1", text: "投递前建议" });
        r.tips.forEach((x) => blocks.push({ type: "li", text: x }));
      }
      const buf = buildDocx({ title: `${b.name || ""} ${r.targetRole || "简历"}`.trim(), blocks });
      sendFile(res, buf, safeFilename(name, "docx"), DOCX_MIME);
    })
  );

  /** 投递清单导出为 Excel（含阶段、下一步、面试时间） */
  router.post(
    "/api/export/applications",
    asyncHandler(async (req, res) => {
      const apps = Array.isArray(ctx.store.applications) ? ctx.store.applications : [];
      if (!apps.length) throw badRequest("还没有投递记录");
      const rows = [
        ["公司", "岗位", "渠道", "投递日期", "当前阶段", "下一步", "面试时间", "联系人"],
        ...apps.map((a) => [
          a.company || "", a.role || "", a.channel || "", a.applyDate || "",
          a.stage || "", a.next || "", a.interviewAt || "", a.contact || "",
        ]),
      ];
      const buf = buildXlsx([{ name: "投递清单", rows }]);
      sendFile(res, buf, safeFilename("投递清单", "xlsx"), XLSX_MIME);
    })
  );
}
