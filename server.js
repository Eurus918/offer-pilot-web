/**
 * Offer Pilot · 求职 AI 助手 —— 服务入口
 *
 * 这个文件只做三件事：加载配置、装配路由、启动服务。
 * 具体业务在各模块里：
 *   src/config.js    路径与常量
 *   src/store.js     本地数据读写
 *   src/ai.js        DeepSeek 调用
 *   src/persona.js   使用者画像（所有 prompt 的动态背景来源）
 *   src/prompts.js   提示词
 *   src/routes/      HTTP 接口
 */
import express from "express";
import { loadEnv, PORT, PUBLIC_DIR, DEMO_MODE } from "./src/config.js";
import { createContext } from "./src/context.js";
import { createRouter } from "./src/routes/index.js";
import { friendly, AppError } from "./src/errors.js";

loadEnv();

const ctx = createContext();
const app = express();

app.use(express.json({ limit: "15mb" }));
app.use(express.static(PUBLIC_DIR));
app.use(createRouter(ctx));

// 未匹配的 API 请求给出明确 JSON，而不是返回 HTML
app.use("/api", (req, res) => {
  res.status(404).json({ error: `接口不存在：${req.method} ${req.originalUrl}`, code: "NOT_FOUND" });
});

// 统一错误处理：任何路由抛出的异常都在这里落地成可读的中文提示
app.use((err, req, res, next) => {
  const status = err?.status || err?.code || 500;
  const httpStatus = Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
  if (httpStatus >= 500) {
    console.error("[error]", req.method, req.originalUrl, err?.message || err);
  }
  res.status(httpStatus).json({
    error: friendly(err),
    code: err?.code || "INTERNAL",
    ...(err?.fallback ? { fallback: err.fallback } : {}),
  });
});

app.listen(PORT, () => {
  const kbOk = ctx.store.profile?.basics?.name ? "已填写档案" : "档案待填写";
  console.log("");
  console.log("  Offer Pilot 已启动");
  console.log(`  → http://localhost:${PORT}`);
  console.log(`  → AI：${ctx.hasKey() ? "已配置 Key（" + ctx.getModel() + "）" : "未配置 Key，AI 功能不可用（可在设置页填写）"}`);
  const dataHint = DEMO_MODE
    ? "演示模式：跑的是示例数据，访客填写的 Key 不保存"
    : `${kbOk}，存于本机 data/store.json`;
  console.log(`  → 数据：${dataHint}`);
  console.log("");
});

// 优雅退出：收到终止信号时先关连接再退出
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    console.log(`\n[server] 收到 ${sig}，正在退出…`);
    process.exit(0);
  });
}

export { app, ctx, AppError };
