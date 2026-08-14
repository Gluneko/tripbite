/** 各校验规则实现。函数纯净：输入行程，输出 issue 列表，无副作用。 */
import type { Itinerary } from "../schema.js";
import type { SkippedRule, VerifyIssue } from "./types.js";

// ---------- 工具函数 ----------

/** "HH:mm" → 当日分钟数；非法返回 null */
export function parseHHmm(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59) return null;
  return h * 60 + min;
}

/** "经度,纬度" → [lng, lat]；非法返回 null */
export function parseLocation(s?: string): [number, number] | null {
  if (!s) return null;
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(s);
  if (!m) return null;
  const lng = Number(m[1]);
  const lat = Number(m[2]);
  if (Math.abs(lng) > 180 || Math.abs(lat) > 90) return null;
  return [lng, lat];
}

/** 球面距离（km），Haversine */
export function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** 市内通勤耗时估计（分钟）：按方式给"门到门"速度 + 固定开销 */
export function estimateTransitMinutes(km: number, mode?: string): number {
  const m = mode ?? "";
  if (/步行|walk/i.test(m)) return Math.ceil((km / 4.5) * 60);
  if (/打车|出租|驾车|taxi/i.test(m)) return Math.ceil((km / 22) * 60) + 5;
  if (/地铁|公交|轨道|metro|bus/i.test(m)) return Math.ceil((km / 18) * 60) + 15;
  // 未知方式：取公共交通口径
  return Math.ceil((km / 18) * 60) + 10;
}

const fmt = (n: number) => Math.round(n * 100) / 100;

// ---------- 预算类 ----------

/**
 * budget.day-sum：每天 items 金额之和 == dayCostEstimate
 * budget.total-sum：各天之和 == totalCostEstimate
 * budget.cap：声称可行时总额不得超预算 5%；声称不可行时必须给出说明
 */
export function checkBudget(it: Itinerary): VerifyIssue[] {
  const issues: VerifyIssue[] = [];
  let daysTotal = 0;

  it.dailyPlans.forEach((day, di) => {
    const sum = day.items.reduce((acc, x) => acc + x.costEstimate, 0);
    daysTotal += day.dayCostEstimate;
    if (Math.abs(sum - day.dayCostEstimate) > Math.max(1, sum * 0.005)) {
      issues.push({
        rule: "budget.day-sum",
        severity: "error",
        path: `dailyPlans[${di}]`,
        message: `Day ${day.day} 各项花费之和与当日总额不一致`,
        expected: fmt(sum),
        actual: day.dayCostEstimate,
      });
    }
  });

  if (Math.abs(daysTotal - it.totalCostEstimate) > Math.max(1, daysTotal * 0.01)) {
    issues.push({
      rule: "budget.total-sum",
      severity: "error",
      path: "totalCostEstimate",
      message:
        "各天花费之和与总额不一致（所有花费包括大交通与每晚住宿都必须入天）",
      expected: fmt(daysTotal),
      actual: it.totalCostEstimate,
    });
  }

  if (it.budgetTotal != null) {
    if (it.budgetFeasible && it.totalCostEstimate > it.budgetTotal * 1.05) {
      issues.push({
        rule: "budget.cap",
        severity: "error",
        path: "budgetFeasible",
        message: "声称预算可行，但总花费超出预算 5% 容差",
        expected: `≤ ${fmt(it.budgetTotal * 1.05)}`,
        actual: it.totalCostEstimate,
      });
    }
    if (!it.budgetFeasible && it.budgetNotes.trim().length < 20) {
      issues.push({
        rule: "budget.infeasible-notes",
        severity: "error",
        path: "budgetNotes",
        message: "预算不可行时必须给出差距说明与替代方案（budgetNotes 过短）",
      });
    }
    // 防"哭穷后门"：行程实际在预算内却声称不可行（常见于重排修了数字没同步结论），
    // 同时 budgetFeasible=false 会跳过超预算检查，必须与实际花费一致
    if (!it.budgetFeasible && it.totalCostEstimate <= it.budgetTotal) {
      issues.push({
        rule: "budget.feasibility-mismatch",
        severity: "error",
        path: "budgetFeasible",
        message:
          "行程总花费已在预算内，budgetFeasible 却为 false——改为 true 并同步更新 budgetNotes 中的数字",
        expected: "true",
        actual: `false（总花费 ${it.totalCostEstimate} ≤ 预算 ${it.budgetTotal}）`,
      });
    }
  }
  return issues;
}

// ---------- 时间类 ----------

/**
 * time.format / time.order / time.overlap：时间合法、start<end、当日无重叠
 * time.arrival-conflict：Day1 首个活动不得早于推荐交通到达时间 + 60 分钟
 * time.return-buffer：最后一天最后活动结束 + 90 分钟 ≤ 返程发车时刻
 */
export function checkTime(it: Itinerary): {
  issues: VerifyIssue[];
  skipped: SkippedRule[];
} {
  const issues: VerifyIssue[] = [];
  const skipped: SkippedRule[] = [];

  it.dailyPlans.forEach((day, di) => {
    let prevEnd: number | null = null;
    let prevTitle = "";
    day.items.forEach((item, ii) => {
      const path = `dailyPlans[${di}].items[${ii}]`;
      const start = parseHHmm(item.startTime);
      const end = parseHHmm(item.endTime);
      if (start == null || end == null) {
        issues.push({
          rule: "time.format",
          severity: "error",
          path,
          message: `时间格式非法：${item.startTime}-${item.endTime}（要求 HH:mm）`,
        });
        return;
      }
      if (end <= start) {
        issues.push({
          rule: "time.order",
          severity: "error",
          path,
          message: `「${item.title}」结束时间不晚于开始时间`,
          actual: `${item.startTime}-${item.endTime}`,
        });
      }
      if (prevEnd != null && start < prevEnd) {
        issues.push({
          rule: "time.overlap",
          severity: "error",
          path,
          message: `「${item.title}」与上一项「${prevTitle}」时间重叠`,
          expected: `开始 ≥ ${Math.floor(prevEnd / 60)}:${String(prevEnd % 60).padStart(2, "0")}`,
          actual: item.startTime,
        });
      }
      prevEnd = end;
      prevTitle = item.title;
    });
  });

  const rec =
    it.transportCandidates.find((t) => t.recommended) ?? it.transportCandidates[0];

  if (!rec?.arriveTime) {
    skipped.push({
      rule: "time.arrival-conflict",
      reason: "推荐交通方案未提供 arriveTime",
    });
  } else {
    const arrive = parseHHmm(rec.arriveTime);
    const day1 = it.dailyPlans[0];
    const first = day1?.items.find((x) => x.type !== "transit" && x.type !== "hotel");
    const firstStart = first ? parseHHmm(first.startTime) : null;
    if (arrive != null && first && firstStart != null && firstStart < arrive + 60) {
      issues.push({
        rule: "time.arrival-conflict",
        severity: "error",
        path: "dailyPlans[0]",
        message: `Day 1「${first.title}」开始于 ${first.startTime}，早于推荐交通到达时间 ${rec.arriveTime} + 1 小时缓冲`,
        expected: `≥ 到达后 1 小时`,
        actual: first.startTime,
      });
    }
  }

  if (!rec?.returnDepTime) {
    skipped.push({
      rule: "time.return-buffer",
      reason: "推荐交通方案未提供 returnDepTime",
    });
  } else {
    const dep = parseHHmm(rec.returnDepTime);
    const lastDay = it.dailyPlans[it.dailyPlans.length - 1];
    // 用"返程大交通之前的最后一个活动"算缓冲（排除 transit/hotel 本身）
    const lastActivity = lastDay
      ? [...lastDay.items]
          .reverse()
          .find((x) => x.type !== "transit" && x.type !== "hotel")
      : undefined;
    const lastEnd = lastActivity ? parseHHmm(lastActivity.endTime) : null;
    if (dep != null && lastActivity && lastEnd != null && lastEnd + 90 > dep) {
      issues.push({
        rule: "time.return-buffer",
        severity: "error",
        path: `dailyPlans[${it.dailyPlans.length - 1}]`,
        message: `最后一天「${lastActivity.title}」结束于 ${lastActivity.endTime}，距返程发车 ${rec.returnDepTime} 不足 90 分钟缓冲——压缩当日安排或换更晚班次`,
      });
    }
  }

  // time.transport-mismatch：行程中的大交通时刻必须与推荐方案一致（防模型自编班次时刻）
  const BIG_TRANSIT_MIN = 120;
  const bigTransit = (day?: Itinerary["dailyPlans"][number]) =>
    day?.items.find((x) => {
      if (x.type !== "transit") return false;
      const s = parseHHmm(x.startTime);
      const e = parseHHmm(x.endTime);
      return s != null && e != null && e - s >= BIG_TRANSIT_MIN;
    });

  if (rec?.arriveTime) {
    const arr = parseHHmm(rec.arriveTime);
    const t = bigTransit(it.dailyPlans[0]);
    const end = t ? parseHHmm(t.endTime) : null;
    if (arr != null && t && end != null && Math.abs(end - arr) > 15) {
      issues.push({
        rule: "time.transport-mismatch",
        severity: "error",
        path: "dailyPlans[0]",
        message: `Day 1 大交通「${t.title}」结束于 ${t.endTime}，与推荐方案到达时间 ${rec.arriveTime} 不符——行程必须使用推荐方案的真实时刻`,
        expected: rec.arriveTime,
        actual: t.endTime,
      });
    }
  }
  if (rec?.returnDepTime) {
    const dep = parseHHmm(rec.returnDepTime);
    const t = bigTransit(it.dailyPlans[it.dailyPlans.length - 1]);
    const start = t ? parseHHmm(t.startTime) : null;
    if (dep != null && t && start != null && Math.abs(start - dep) > 15) {
      issues.push({
        rule: "time.transport-mismatch",
        severity: "error",
        path: `dailyPlans[${it.dailyPlans.length - 1}]`,
        message: `返程大交通「${t.title}」出发于 ${t.startTime}，与推荐方案发车时间 ${rec.returnDepTime} 不符——要么按 ${rec.returnDepTime} 排程，要么在交通候选中改选并标注对应班次`,
        expected: rec.returnDepTime,
        actual: t.startTime,
      });
    }
  }

  return { issues, skipped };
}

// ---------- 地理类 ----------

/**
 * geo.transit-reserved：transit 项预留时长 ≥ 按距离估算的耗时（工具返回的 transitMinutes 优先）
 * geo.meal-detour：正餐与前一个带坐标活动距离 > 3km 且中间无 transit 项 → 打回
 * geo.gap-feasible：相邻两个带坐标活动之间无 transit 项时，间隙时间须够走过去
 */
export function checkGeo(it: Itinerary): {
  issues: VerifyIssue[];
  skipped: SkippedRule[];
} {
  const issues: VerifyIssue[] = [];
  const skipped: SkippedRule[] = [];
  let located = 0;
  let total = 0;

  it.dailyPlans.forEach((day, di) => {
    const items = day.items;
    items.forEach((x) => {
      if (x.type !== "transit") {
        total++;
        if (parseLocation(x.location)) located++;
      }
    });

    for (let i = 0; i < items.length; i++) {
      const cur = items[i]!;
      if (cur.type === "transit") continue;
      // 回酒店/入住的时间本身弹性，不做间隙可行性硬校验
      if (cur.type === "hotel") continue;
      const curLoc = parseLocation(cur.location);
      if (!curLoc) continue;

      // 找上一个带坐标的非 transit 项，以及两者之间是否有 transit 项
      let transitBetween: (typeof items)[number] | null = null;
      let prev: (typeof items)[number] | null = null;
      for (let j = i - 1; j >= 0; j--) {
        const cand = items[j]!;
        if (cand.type === "transit") {
          transitBetween = transitBetween ?? cand;
          continue;
        }
        prev = cand;
        break;
      }
      const prevLoc = prev ? parseLocation(prev!.location) : null;
      if (!prev || !prevLoc) continue;

      const km = haversineKm(prevLoc, curLoc);
      const path = `dailyPlans[${di}].items[${i}]`;

      if (transitBetween) {
        const reserved =
          (parseHHmm(transitBetween.endTime) ?? 0) -
          (parseHHmm(transitBetween.startTime) ?? 0);
        const need =
          transitBetween.transitMinutes ??
          estimateTransitMinutes(km, transitBetween.transitMode);
        if (reserved < need) {
          issues.push({
            rule: "geo.transit-reserved",
            severity: "error",
            path,
            message: `「${prev!.title}」→「${cur.title}」通勤需约 ${need} 分钟，排程仅预留 ${reserved} 分钟`,
            expected: `≥ ${need} 分钟`,
            actual: `${reserved} 分钟`,
          });
        }
      } else {
        if (cur.type === "meal" && km > 3) {
          issues.push({
            rule: "geo.meal-detour",
            severity: "error",
            path,
            message: `正餐「${cur.title}」距上一活动「${prev!.title}」约 ${fmt(km)}km 且未安排通勤——就近换店或补 transit 项`,
            actual: `${fmt(km)}km`,
          });
        }
        const gap =
          (parseHHmm(cur.startTime) ?? 0) - (parseHHmm(prev!.endTime) ?? 0);
        const walkNeed = estimateTransitMinutes(km, "步行");
        if (km > 0.8 && gap < walkNeed) {
          issues.push({
            rule: "geo.gap-feasible",
            severity: "error",
            path,
            message: `「${prev!.title}」→「${cur.title}」相距约 ${fmt(km)}km，间隙 ${gap} 分钟不够步行到达且未安排通勤`,
            expected: `间隙 ≥ ${walkNeed} 分钟或补 transit 项`,
            actual: `${gap} 分钟`,
          });
        }
      }
    }
  });

  if (total > 0 && located / total < 0.5) {
    skipped.push({
      rule: "geo.*",
      reason: `仅 ${located}/${total} 个活动带坐标，地理校验覆盖不完整（提示 Planner 透传 location）`,
    });
  }
  return { issues, skipped };
}

// ---------- 硬约束类（关键词双检） ----------

/** 饮食禁忌 → 违禁关键词表。命中 hardConstraints 中的约束词后，扫描全行程文本。 */
const TABOO_RULES: { trigger: RegExp; banned: string[]; label: string }[] = [
  {
    trigger: /生食|生鱼|刺身/,
    banned: ["刺身", "生鱼片", "生蚝", "生腌", "醉虾", "鱼生"],
    label: "不吃生食",
  },
  {
    trigger: /内脏|下水/,
    banned: ["肥肠", "毛肚", "黄喉", "郡肝", "腰花", "脑花", "鸭肠", "鹅肠"],
    label: "不吃内脏",
  },
  { trigger: /清真|不吃猪/, banned: ["猪", "回锅肉", "蒜泥白肉"], label: "清真/不吃猪肉" },
  { trigger: /素食|吃素/, banned: ["牛肉", "羊肉", "猪", "鸡", "鱼", "虾"], label: "素食" },
];

export function checkHardConstraints(it: Itinerary): {
  issues: VerifyIssue[];
  skipped: SkippedRule[];
} {
  const issues: VerifyIssue[] = [];
  const skipped: SkippedRule[] = [];
  const constraints = it.hardConstraints.join("；");

  const active = TABOO_RULES.filter((r) => r.trigger.test(constraints));
  if (active.length === 0) {
    skipped.push({ rule: "constraint.taboo", reason: "硬约束中无饮食禁忌类条目" });
  } else {
    for (const rule of active) {
      it.restaurantHighlights.forEach((r, ri) => {
        const text = `${r.name} ${r.cuisine} ${r.recommendedDishes.join(" ")} ${r.reason}`;
        for (const word of rule.banned) {
          if (text.includes(word)) {
            issues.push({
              rule: "constraint.taboo",
              severity: "error",
              path: `restaurantHighlights[${ri}]`,
              message: `硬约束「${rule.label}」被违反：餐厅「${r.name}」内容含「${word}」`,
            });
          }
        }
      });
    }
  }

  // 住宿位置约束："住X附近" → 酒店候选的名称/地址应包含 X（粗检，warn 级）
  const areaMatch = /住[宿]?(?:位置)?(?:必须)?(?:选?在)?(.{2,8}?)附近/.exec(constraints);
  if (areaMatch) {
    const area = areaMatch[1]!;
    const hit = it.hotelCandidates.some(
      (h) => h.name.includes(area) || h.address.includes(area)
    );
    if (!hit && it.hotelCandidates.length > 0) {
      issues.push({
        rule: "constraint.hotel-area",
        severity: "warn",
        path: "hotelCandidates",
        message: `用户要求住「${area}」附近，但酒店候选的名称/地址均未体现（建议核对坐标距离）`,
      });
    }
  }

  return { issues, skipped };
}

// ---------- 溯源类 ----------

/**
 * provenance.restaurant：重点餐厅必须带高德 poiId 且 source 以 amap 开头
 * provenance.mock-declared：使用 mock 数据时 warnings 必须声明估算
 */
export function checkProvenance(it: Itinerary): VerifyIssue[] {
  const issues: VerifyIssue[] = [];

  it.restaurantHighlights.forEach((r, ri) => {
    if (!r.poiId || !r.source.startsWith("amap")) {
      issues.push({
        rule: "provenance.restaurant",
        severity: "error",
        path: `restaurantHighlights[${ri}]`,
        message: `餐厅「${r.name}」缺少可核验来源（需高德 poiId + amap 来源标注）`,
        actual: `poiId=${r.poiId ?? "无"}, source=${r.source}`,
      });
    }
  });

  const usesMock =
    it.transportCandidates.some((t) => t.source.includes("mock")) ||
    it.hotelCandidates.some((h) => h.source.includes("mock"));
  if (usesMock) {
    const declared = it.warnings.some((w) => /mock|估算/.test(w));
    if (!declared) {
      issues.push({
        rule: "provenance.mock-declared",
        severity: "error",
        path: "warnings",
        message: "使用了 mock 报价但 warnings 未声明估算性质",
      });
    }
  }
  return issues;
}
