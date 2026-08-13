import type { Itinerary } from "./schema.js";

const TYPE_ICON: Record<string, string> = {
  sight: "🏞️",
  meal: "🍜",
  transit: "🚇",
  hotel: "🏨",
  other: "📍",
};

/** 把结构化行程渲染成 Markdown（CLI 输出与 README 演示用） */
export function renderMarkdown(it: Itinerary): string {
  const lines: string[] = [];
  lines.push(`# ${it.destination} ${it.days} 天行程 · 食途 TripBite`);
  lines.push("");
  lines.push(
    `**人数** ${it.travelers} 人 · **预算** ${it.budgetTotal ? `¥${it.budgetTotal}` : "未指定"} · **总花费估计** ¥${it.totalCostEstimate} · **预算可行** ${it.budgetFeasible ? "✅" : "❌"}`
  );
  if (it.tastePreferences.length)
    lines.push(`**口味偏好** ${it.tastePreferences.join("、")}`);
  if (it.hardConstraints.length)
    lines.push(`**硬约束** ${it.hardConstraints.join("、")}`);
  lines.push("");
  lines.push(`> ${it.budgetNotes}`);
  lines.push("");

  lines.push("## 🚄 往返交通候选");
  lines.push("");
  for (const t of it.transportCandidates)
    lines.push(`- **${t.mode}** ${t.description} — 约 ¥${t.costEstimate}（${t.source}）`);
  lines.push("");

  lines.push("## 🏨 酒店候选");
  lines.push("");
  for (const h of it.hotelCandidates)
    lines.push(
      `- **${h.name}**（${h.address}）约 ¥${h.pricePerNight}/晚 — ${h.reason}`
    );
  lines.push("");

  for (const day of it.dailyPlans) {
    lines.push(
      `## Day ${day.day}${day.date ? ` · ${day.date}` : ""} — ${day.summary}`
    );
    lines.push("");
    for (const item of day.items) {
      const icon = TYPE_ICON[item.type] ?? "📍";
      const transit =
        item.type === "transit"
          ? `（${item.transitMode ?? ""}${item.transitMinutes ? ` ${item.transitMinutes} 分钟` : ""}）`
          : "";
      const cost = item.costEstimate > 0 ? ` · ¥${item.costEstimate}` : "";
      lines.push(
        `- ${item.startTime}-${item.endTime} ${icon} **${item.title}**${transit}${cost}${item.notes ? ` — ${item.notes}` : ""}`
      );
    }
    lines.push("");
    lines.push(`当日花费估计：¥${day.dayCostEstimate}`);
    lines.push("");
  }

  lines.push("## 🍽️ 重点餐厅");
  lines.push("");
  for (const r of it.restaurantHighlights) {
    lines.push(`### ${r.name}（${r.cuisine}，人均 ¥${r.avgPricePerPerson}）`);
    lines.push("");
    lines.push(`- 地址：${r.address}${r.poiId ? `（POI: ${r.poiId}）` : ""}`);
    lines.push(`- 推荐菜：${r.recommendedDishes.join("、")}`);
    lines.push(`- 推荐理由：${r.reason}`);
    lines.push(`- 来源：${r.source}`);
    lines.push("");
  }

  if (it.warnings.length) {
    lines.push("## ⚠️ 假设与不确定项");
    lines.push("");
    for (const w of it.warnings) lines.push(`- ${w}`);
    lines.push("");
  }
  return lines.join("\n");
}
