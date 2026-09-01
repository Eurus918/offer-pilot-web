# Offer Pilot · 秋招 AI 产品岗个人助手

> 一个**独立可运行的 AI 求职助手**（vibecoding 作品）：帮你沉淀个人求职画像、管理投递进度、基于 JD 图文备战面试、汇总 AI 作品集，并给即将到来的面试设置 DDL 提醒。
>
> 后端用 Express 代理 DeepSeek API，前端是零构建的原生单页应用，数据全部存在本地，**API Key 不离开你的机器**。

---

## ✨ 功能

| 模块 | 说明 |
|------|------|
| **个人档案** | 来自简历的基本信息卡片 + 右侧聊天窗口沉淀的个人偏好（base / 业务倾向 / 顾虑…），每次对话自动总结进档案 |
| **投递进度** | 可视化漏斗 + 11 步阶段流水线（筛选→评估→笔试→AI 面→一二三面→结束/offer）；下拉实时改阶段、可增删 |
| **下一步动作** | 每条投递按当前阶段**智能推荐**下一步该做什么（如「关注邮箱筛选通知」「准备 AI 面试题」），点击即可内联编辑 |
| **面邀备战** | 上传 JD 文字/截图 → AI 生成「结合 JD 的自我介绍 + 可能问题&建议回答 + 知识储备清单」；区分「即将面试 / 历史面试」，每条带独立问答窗口 |
| **DDL 提醒** | 给即将开始的面试设截止时间（日期+时间点），自动显示状态标签（正常/即将到期/已过期），可一键联动日历提醒 |
| **我的作品** | 汇总你的 vibe coding / 项目作品，可直接写进简历 |

---

## 🚀 快速开始

### 1. 准备环境
- Node.js ≥ 18（用到 ESM）
- 一个 [DeepSeek API Key](https://platform.deepseek.com)（格式 `sk-` 开头）

### 2. 安装与配置
```bash
git clone <your-repo-url>
cd offer-pilot-web
npm install

# 配置 Key：复制环境变量模板并填入你的 Key
cp .env.example .env
# 编辑 .env，把 DEEPSEEK_API_KEY 改成你的真实 Key
```

> 也可以不配 `.env`，直接在网页「设置」里填 Key——它会存到本地 `data/store.json`（该文件已被 gitignore，不会上传）。

### 3. 运行
```bash
npm start            # 等价于 node server.js
# 浏览器打开 http://localhost:3000
```

首次启动会自动从 `data/store.example.json` 生成一份 `data/store.json`（含示例数据），你可在页面上把它改成自己的真实信息。

---

## 🔧 技术栈

- **后端**：Node.js + Express，作为 DeepSeek Chat / Vision API 的本地代理（避免前端直接暴露 Key）
- **前端**：原生 HTML / CSS / JS 单页应用，**零构建步骤**
- **存储**：本地 `data/store.json`（JSON 文件，无需数据库）
- **模型**：默认 `deepseek-chat`，可在设置或 `DEEPSEEK_MODEL` 环境变量切换

---

## 🔒 隐私说明

- 你的 **API Key** 只存在于本地 `.env` 或 `data/store.json`，**绝不会发送到除 DeepSeek 以外的任何服务器**。
- `data/store.json`（含你的真实投递记录、简历信息）和 `.env` 已在 `.gitignore` 中，**不会被提交到仓库**。
- 仓库里只保留 `data/store.example.json`——一份脱敏的示例数据，供新用户克隆后生成自己的数据。
- 所有 AI 调用均为你本机 → DeepSeek 官方 API 的点对点请求。

---

## 📁 目录结构

```
offer-pilot-web/
├── server.js              # Express 服务 + DeepSeek 代理 + 数据持久化
├── public/
│   ├── index.html         # 单页应用骨架（5 个 Tab）
│   ├── styles.css         # 样式
│   └── app.js             # 前端逻辑
├── data/
│   ├── store.example.json # 脱敏示例数据（进仓库）
│   └── store.json         # 你的真实数据（gitignore，自动生成）
├── .env.example           # 环境变量模板（进仓库）
├── .env                   # 你的 Key（gitignore）
├── .gitignore
├── LICENSE                # MIT
└── package.json
```

---

## 📝 License

[MIT](./LICENSE) © 2026 王辰宇 (Wang Chenyu)
