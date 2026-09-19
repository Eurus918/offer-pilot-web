/**
 * 统一错误处理：所有 API 用同一套错误码与中文提示，避免前端白屏时无从排查。
 */

export class AppError extends Error {
  constructor(message, status = 500, code = "INTERNAL") {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
  }
}

/** 参数校验失败 */
export const badRequest = (msg) => new AppError(msg, 400, "BAD_REQUEST");
/** 资源不存在 */
export const notFound = (msg = "资源不存在") => new AppError(msg, 404, "NOT_FOUND");
/** 依赖未就绪（如未配置 Key、Agent 源文件缺失） */
export const unavailable = (msg, extra = {}) => {
  const e = new AppError(msg, 503, "UNAVAILABLE");
  Object.assign(e, extra);
  return e;
};

/**
 * 把底层错误翻译成用户看得懂的中文。
 * 只暴露可行动的提示，不泄露密钥、堆栈等内部细节。
 */
export function friendly(e) {
  if (!e) return "服务异常";
  if (e.message === "NO_KEY") {
    return "请先在『设置』中填入 DeepSeek API Key（platform.deepseek.com 获取，格式 sk- 开头）。";
  }
  if (e.message === "AI_TIMEOUT") {
    return "AI 响应超时，可能是本次请求内容较长，请稍后重试或精简输入。";
  }
  if (typeof e.message === "string" && e.message.startsWith("DEEPSEEK_ERR")) {
    if (e.message.includes("402") || e.message.includes("Insufficient")) {
      return "DeepSeek 账户余额不足，请到 platform.deepseek.com 充值后重试。";
    }
    if (e.message.includes("401") || e.message.includes("Unauthorized")) {
      return "DeepSeek API Key 无效或已过期，请到『设置』重新填写。";
    }
    if (e.message.includes("429")) {
      return "请求过于频繁，DeepSeek 限流了，请稍后重试。";
    }
    // 原始报错里可能带 key 片段，截断后返回
    return "调用 DeepSeek 失败：" + e.message.slice(0, 200);
  }
  if (e.code === "ECONNREFUSED" || e.code === "ENOTFOUND") {
    return "无法连接 AI 服务，请检查网络。";
  }
  return e.message || "服务异常";
}

/**
 * 包装 async 路由，把抛出的异常统一交给 Express 错误中间件。
 * 用法：router.post("/x", asyncHandler(async (req, res) => { ... }))
 */
export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
