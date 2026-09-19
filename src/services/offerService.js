/**
 * Offer 量化计算：把"总包数字"还原成"到手能花多少"。
 */
import { CITY_COST } from "../config.js";

export function cityList() {
  return Object.keys(CITY_COST);
}

/** 计算单个 offer 的量化指标 */
export function calcOffer(o) {
  const baseMonth = Number(o.baseMonth) || 0;   // 月薪（K）
  const months = Number(o.months) || 12;        // 发薪月数
  const bonus = Number(o.bonus) || 0;           // 年终（万）
  const equity = Number(o.equity) || 0;         // 期权/年（万，折算）
  const signOn = Number(o.signOn) || 0;         // 签字费（万，仅首年）

  const baseYear = (baseMonth * months) / 10;   // 年薪（万）
  const totalYear = baseYear + bonus + equity;  // 年总包（万）
  const cost = CITY_COST[o.city] || null;
  const monthCost = cost ? cost.rent + cost.living : 0;
  const yearCost = (monthCost * 12) / 10000;    // 年生活成本（万）
  const netYear = totalYear - yearCost;         // 年可支配（万）

  return {
    baseYear: +baseYear.toFixed(1),
    totalYear: +totalYear.toFixed(1),
    monthCost,
    yearCost: +yearCost.toFixed(1),
    netYear: +netYear.toFixed(1),
    firstYear: +(totalYear + signOn - yearCost).toFixed(1), // 首年含签字费
    hasCost: !!cost,
  };
}

/** 供 AI 对比用的纯文本 */
export function offersToText(offers) {
  return offers
    .map((o, i) => {
      const c = o.calc || calcOffer(o);
      return (
        `【Offer ${i + 1}】${o.company} · ${o.role}${o.level ? "（" + o.level + "）" : ""}\n` +
        `- 城市：${o.city || "未填"}\n` +
        `- 月薪：${o.baseMonth}K × ${o.months}个月 = 年薪 ${c.baseYear}万\n` +
        `- 年终：${o.bonus}万｜期权/年：${o.equity}万｜签字费：${o.signOn}万\n` +
        `- 年总包：${c.totalYear}万\n` +
        `- 当地生活成本：${c.hasCost
          ? `约 ${c.monthCost} 元/月（年 ${c.yearCost} 万），扣除后年可支配约 ${c.netYear} 万`
          : "（城市未匹配，未计入）"}\n` +
        (o.growth ? `- 成长性备注：${o.growth}\n` : "") +
        (o.notes ? `- 其他：${o.notes}\n` : "")
      );
    })
    .join("\n");
}
