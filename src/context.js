/**
 * 运行时上下文：把 store / 保存 / AI 调用打包成一份，注入给所有路由。
 */
import { loadStore, saveStore } from "./store.js";
import { DEFAULT_MODEL } from "./config.js";
import { dsChat, dsJson } from "./ai.js";
import { ensureKb } from "./kb.js";

export function createContext() {
  // 首次运行：从模板生成使用者的知识库目录
  ensureKb();
  const store = loadStore();

  const getKey = () =>
    (process.env.DEEPSEEK_API_KEY || store.config?.apiKey || "").trim();
  const getModel = () => process.env.DEEPSEEK_MODEL || store.config?.model || DEFAULT_MODEL;

  return {
    store,
    save: () => saveStore(store),
    getKey,
    getModel,
    hasKey: () => !!getKey(),
    /** 普通对话 */
    ai: (opts) => dsChat({ ...opts, getKey, getModel }),
    /** 要求 JSON 输出（带容错解析） */
    aiJson: (opts, fallback = null) => dsJson({ ...opts, getKey, getModel }, fallback),
  };
}
