/**
 * 知识库初始化：仓库自带 agent-kb.example 模板，首次运行时生成使用者的 agent-kb/。
 * 使用者的真实知识库不进仓库（已在 .gitignore 排除），模板进仓库，保证 clone 下来就能用。
 */
import fs from "fs";
import { join } from "path";
import { ROOT, AGENT_KB_DIR } from "./config.js";

const TEMPLATE_DIR = join(ROOT, "agent-kb.example");

export function ensureKb() {
  if (fs.existsSync(AGENT_KB_DIR)) return;
  if (!fs.existsSync(TEMPLATE_DIR)) return;
  try {
    fs.mkdirSync(AGENT_KB_DIR, { recursive: true });
    let n = 0;
    for (const f of fs.readdirSync(TEMPLATE_DIR)) {
      if (!f.endsWith(".md")) continue;
      fs.copyFileSync(join(TEMPLATE_DIR, f), join(AGENT_KB_DIR, f));
      n++;
    }
    if (n) console.log(`[kb] 已从 agent-kb.example 生成 agent-kb/（${n} 个模板文件，改写成你自己的内容）`);
  } catch (e) {
    console.warn("[kb] 初始化知识库失败：", e.message);
  }
}
