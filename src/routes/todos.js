/**
 * 待办清单：用户记录一切要跟进的事——
 * 面试 / 笔试提醒、写论文、牛客网刷题、改简历…… 不限求职相关。
 * 纯本地数据，不依赖 AI；"AI 拆解" 是可选增值功能（需配置 Key）。
 */
import { Router } from "express";
import { asyncHandler, badRequest, notFound } from "../errors.js";
import { todoBreakdownSys } from "../prompts.js";

/** 预设分类（用户也可填任意自定义分类） */
export const TODO_CATEGORIES = ["面试", "笔试", "论文", "刷题", "简历", "投递", "其他"];

const PRIORITIES = ["high", "medium", "low"];

function ensureArr(ctx) {
  if (!Array.isArray(ctx.store.todos)) ctx.store.todos = [];
  return ctx.store.todos;
}

/** 排序：未完成在前 → 逾期优先 → 截止日期升序（无日期置后）→ 优先级 → 创建时间倒序 */
function sortTodos(list) {
  const today = new Date().toISOString().slice(0, 10);
  const priWeight = { high: 0, medium: 1, low: 2 };
  return [...list].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    const ao = a.due && a.due < today && !a.done ? 0 : 1;
    const bo = b.due && b.due < today && !b.done ? 0 : 1;
    if (ao !== bo) return ao - bo;
    if (a.due && b.due) {
      if (a.due !== b.due) return a.due < b.due ? -1 : 1;
    } else if (a.due !== b.due) {
      return a.due ? -1 : 1;
    }
    if (priWeight[a.priority] !== priWeight[b.priority]) return priWeight[a.priority] - priWeight[b.priority];
    return (b.createdAt || "") > (a.createdAt || "") ? 1 : -1;
  });
}

export function registerTodos(router, ctx) {
  /** 列表（支持按状态 / 分类筛选，返回预设分类供前端渲染） */
  router.get(
    "/api/todos",
    asyncHandler(async (req, res) => {
      const list = ensureArr(ctx);
      const { filter, category } = req.query;
      let out = list;
      if (filter === "active") out = out.filter((t) => !t.done);
      else if (filter === "done") out = out.filter((t) => t.done);
      if (category) out = out.filter((t) => t.category === category);
      res.json({ todos: sortTodos(out), categories: TODO_CATEGORIES });
    })
  );

  /** 新建待办 */
  router.post(
    "/api/todos",
    asyncHandler(async (req, res) => {
      const list = ensureArr(ctx);
      const { title, category, priority, due, note } = req.body || {};
      if (!title || !String(title).trim()) throw badRequest("请填写待办内容");
      const todo = {
        id: "td-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
        title: String(title).trim(),
        category: category || "其他",
        priority: PRIORITIES.includes(priority) ? priority : "medium",
        due: due || "",
        note: note || "",
        steps: [],
        done: false,
        doneAt: "",
        createdAt: new Date().toISOString().slice(0, 10),
      };
      list.push(todo);
      ctx.save();
      res.json({ todo });
    })
  );

  /** 更新待办（含完成切换；done=true 时自动记录 doneAt） */
  router.patch(
    "/api/todos/:id",
    asyncHandler(async (req, res) => {
      const list = ensureArr(ctx);
      const t = list.find((x) => x.id === req.params.id);
      if (!t) throw notFound("待办不存在");
      const { title, category, priority, due, note, done, steps } = req.body || {};
      if (title !== undefined) t.title = String(title).trim() || t.title;
      if (category !== undefined) t.category = category;
      if (priority !== undefined && PRIORITIES.includes(priority)) t.priority = priority;
      if (due !== undefined) t.due = due;
      if (note !== undefined) t.note = note;
      if (steps !== undefined && Array.isArray(steps)) {
        t.steps = steps
          .map((s) => ({ text: String((s && s.text) || s || "").trim(), done: !!(s && s.done) }))
          .filter((s) => s.text);
      }
      if (done !== undefined) {
        t.done = !!done;
        t.doneAt = t.done ? new Date().toISOString().slice(0, 10) : "";
      }
      ctx.save();
      res.json({ todo: t });
    })
  );

  /** 删除待办 */
  router.delete(
    "/api/todos/:id",
    asyncHandler(async (req, res) => {
      const list = ensureArr(ctx);
      const before = list.length;
      ctx.store.todos = list.filter((x) => x.id !== req.params.id);
      ctx.save();
      res.json({ ok: true, deleted: before - ctx.store.todos.length });
    })
  );

  /**
   * AI 拆解：把一条待办（如"完成论文开题报告"）拆成可勾选的子步骤清单。
   * 不配置 Key 时优雅降级，给出明确提示。
   */
  router.post(
    "/api/todos/:id/breakdown",
    asyncHandler(async (req, res) => {
      const list = ensureArr(ctx);
      const t = list.find((x) => x.id === req.params.id);
      if (!t) throw notFound("待办不存在");
      if (!ctx.hasKey()) {
        return res.json({
          ok: false,
          fallback: true,
          message: "需要先配置 DeepSeek API Key 才能使用 AI 拆解（设置页可填写）。",
        });
      }
      const parsed = await ctx.aiJson(
        {
          system: todoBreakdownSys(ctx.store, t),
          user: `待办：${t.title}${t.note ? "（备注：${t.note}）" : ""}`,
        },
        null
      );
      const raw = (parsed && (parsed.steps || parsed.checklist || parsed.list)) || [];
      const steps = (Array.isArray(raw) ? raw : [])
        .map((s) => ({ text: String((s && s.text) || s || "").trim(), done: false }))
        .filter((s) => s.text)
        .slice(0, 8);
      if (!steps.length) {
        return res.json({ ok: false, fallback: true, message: "AI 没有返回可拆解的子步骤，换种说法再试一次。" });
      }
      t.steps = steps;
      ctx.save();
      res.json({ ok: true, steps });
    })
  );
}
