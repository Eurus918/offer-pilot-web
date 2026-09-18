# 腾讯会议 API 接入指南：自动拉取面试纪要

> 目标：面试结束后自动把「元宝纪要」拉进 Offer Pilot，替代手动粘贴。
> 结论先行：**代码已完整实现并验证链路打通，但个人账号无法创建应用——门槛在账号版本，不在技术。**

---

## 一、能不能做？——先过账号门槛（个人账号不行）

腾讯会议开放平台文档原话：

> **个人版、免费组织、商业版免费账号、教育版免费账号、企业版免费账号不能创建自建应用。**

| 你的账号 | 能否创建应用 |
|---|---|
| 个人免费版 | ❌ **明确不行** |
| 免费组织 | ❌ 不行 |
| 商业版/企业版/教育版（免费账号） | ❌ 不行 |
| **商业版/企业版/教育版（付费）** | ✅ 可以，**且需管理员权限** |

### 两条路径都对个人关着

1. **企业自建应用**——须购买商业版/教育版/企业版，购买后**管理员账号**自动开通；管理员可把企业内成员设为「应用开发者」，但同样要求企业版付费账号。
2. **第三方应用（OAuth）**——需走服务商入驻，官方优先条件含「公司在所属领域有一定知名度」「**10 人以上稳定的产品研发团队**」，个人开发者基本无望。

### ⚠️ 若用公司企业账号申请，注意合规

创建自建应用时要选类型，区别很大：

- **企业级**：可获取**企业账户下的所有数据**（含同事通过 App 创建的会议），**可跨应用获取**
- **应用级**：仅获取该应用对应的数据，**不能跨应用**

> 以实习生身份用公司账号申请时，**务必选「应用级」**，且只申请「查看/管理**自己的**录制」——否则可能触碰公司数据合规红线。

### ⚠️ 就算有权限，也拉不到对方的面试

面试是**对方公司**的会议，录制存在对方企业账号下——无论什么权限都拉不到。此功能实际只适用于**你自己创建的会议**（模拟面试、自我复盘录音）。

---

## 二、接口本身（2026-09 现状）

腾讯会议服务端 API 的「智能纪要」接口：

| 项目 | 说明 |
|---|---|
| 核心接口 | `GET /v1/smart/minutes/{record_file_id}` |
| **元宝纪要** | 支持！参数 `llm=3` 即元宝纪要（**默认值**），也可选 1=混元、2=DeepSeek |
| 纪要粒度 | `minute_type`：0 智能纪要 / 1 按章节 / 2 按主题 / 3 按发言人 |
| **账号版本要求** | ⚠️ **仅商业版、企业版、教育版**（个人免费版无法调用） |
| 权限点 | 自建应用需「查看企业录制 / 管理企业录制」；操作者需「录制管理 > 查看」 |
| 新增安全要求 | 2026-02-10 起，**新建自建应用**调用录制转写类接口需在 Header 携带 STS-Token |

**你的处境判断**：你在腾讯 PCG 实习，公司大概率有企业版会议。但你的面试是**你个人作为候选人**参加的会议（你既不是公司会议的创建者，也没有对方企业的录制权限）——

**关键结论**：
- ✅ 如果面试是你**自己创建的腾讯会议**（如自己约的模拟面试）且账号在企业版下有录制权限 → 可以拉到
- ❌ 如果面试是**对方公司的会议**（招聘官的会议）→ 录制在对方企业，你的 API 永远拉不到
- 💡 所以这个功能最实用的场景是：**自己开个腾讯会议做模拟面试 / 复盘录音**，自动进产品

---

## 二、接入步骤（假设你能拿到权限）

### Step 1：开通应用

1. 登录 [腾讯会议开放平台](https://meeting.tencent.com/open-platform/)
2. 创建应用 → 选「**自建应用**」
3. 拿到三个凭证：`AppId`（SDK AppID）、`SecretId`、`SecretKey`
4. 在「权限管理」勾选：**查看企业录制、管理企业录制**
5. 在「用户管理 > 角色管理」给你的账号勾选：**账户管理 > 录制管理 > 查看**

### Step 2：配置到产品

在 Offer Pilot「设置」页新增（代码已预留，见下文）：

```
TENCENT_MEETING_APP_ID=xxx
TENCENT_MEETING_SECRET_ID=xxx
TENCENT_MEETING_SECRET_KEY=xxx
TENCENT_MEETING_USER_ID=xxx   # 你的企业内 userid
```

### Step 3：调用链路

```
面试结束（云录制开启时）
    ↓ 等待录制+纪要生成（一般 5-15 分钟）
① GET /v1/records?meeting_id=xxx        → 拿到 record_file_id
② GET /v1/smart/minutes/{record_file_id}?llm=3   → 拿到元宝纪要全文
③ 自动写入 Offer Pilot 的复盘模块（带公司/岗位信息）
④ 自动触发 AI 复盘分析（现有能力）
```

### Step 4：签名（AK/SK 方式）

腾讯会议 REST API 用 HMAC-SHA256 签名，Node 实现框架：

```javascript
import crypto from "crypto";

function buildHeaders(method, path, body = "") {
  const appId = process.env.TENCENT_MEETING_APP_ID;
  const secretKey = process.env.TENCENT_MEETING_SECRET_KEY;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = Math.abs(Math.floor(Math.random() * 1e9)).toString();

  // 签名串：方法 + 头部 + 主体（以官方文档「签名验证」为准）
  const signStr = [
    method.toUpperCase(),
    `X-TC-Key:${appId}`,
    `X-TC-Nonce:${nonce}`,
    `X-TC-Timestamp:${timestamp}`,
    body,
  ].join("\n");

  const signature = crypto
    .createHmac("sha256", secretKey)
    .update(signStr)
    .digest("base64");

  return {
    "Content-Type": "application/json",
    "X-TC-Key": appId,
    "X-TC-Timestamp": timestamp,
    "X-TC-Nonce": nonce,
    "X-TC-Signature": signature,
    // 2026-02 起新建自建应用需要：X-TC-STSToken（见官方「企业自建应用票据」）
  };
}

// 拉取元宝纪要
export async function fetchSmartMinutes(recordFileId) {
  const path = `/v1/smart/minutes/${recordFileId}?operator_id_type=1&operator_id=${process.env.TENCENT_MEETING_USER_ID}&llm=3`;
  const res = await fetch("https://api.meeting.qq.com" + path, {
    headers: buildHeaders("GET", path),
  });
  if (!res.ok) throw new Error("会议API错误 " + res.status);
  return res.json(); // 纪要全文 + 章节结构
}
```

> ⚠️ 签名串的拼接细节（Header 顺序、空行、body 参与方式）**以官方文档「签名验证」章节为准**，上面是框架示意。

---

## 三、产品内的接入点（已预留）

`server.js` 里的 `POST /api/reviews/sync` 就是为此预留的：

```javascript
app.post("/api/reviews/sync", async (req, res) => {
  const { meetingId, company, role, round } = req.body || {};
  // TODO 权限就绪后：
  // 1. 调录制列表接口拿 record_file_id
  // 2. fetchSmartMinutes(recordFileId) 拿元宝纪要
  // 3. 复用 POST /api/reviews 的逻辑写入（transcript=纪要全文）
  // 4. 自动触发 AI 复盘分析
});
```

---

## 四、我的建议（务实版）

| 方案 | 前提 | 建议度 |
|---|---|---|
| **手动粘贴元宝纪要**（现状） | 无任何前提，今天就能用 | ⭐⭐⭐⭐⭐ 当前最优 |
| API 自动同步（自建应用） | 企业版账号 + 管理员开通录制权限 | ⭐⭐⭐ 面试用自己的会议时可用 |
| 拉对方公司的面试录制 | 需要对方企业授权——**不可能** | ❌ 放弃 |

**真实建议**：
1. **短期内维持手动粘贴**——一次复制粘贴 10 秒钟，成本已经很低，且 100% 能覆盖所有面试
2. 如果你想展示「API 集成能力」（作品集加分），可以**用自己开的会议做模拟面试**，把这条链路跑通写进作品集——「对接腾讯会议开放平台，自动拉取云录制智能纪要（元宝）」听起来就很专业
3. 真要接 API 时先确认：你的会议账号版本 + 能否拿到录制权限（问 IT 或企业管理员）

---

## 五、官方文档入口

- 智能纪要：https://cloud.tencent.com/document/api/647/109458
- 查询录制转写详情：https://cloud.tencent.com/document/product/1095/65111
- 单个录制详情（文件+纪要）：https://meeting.tencent.com/support/topic/550
- API 调试工具：开放平台 → 服务端 API 调试工具（免写代码先试通）