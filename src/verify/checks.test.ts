import { strict as assert } from "node:assert";
import { test } from "node:test";
import type { Itinerary } from "../schema.js";
import {
  checkBudget,
  checkGeo,
  checkHardConstraints,
  checkTime,
  estimateTransitMinutes,
  haversineKm,
  parseHHmm,
  parseLocation,
} from "./checks.js";

// ---------- 最小行程构造器 ----------

function baseItinerary(over: Partial<Itinerary> = {}): Itinerary {
  return {
    destination: "成都",
    days: 1,
    travelers: 2,
    budgetTotal: 6000,
    tastePreferences: [],
    hardConstraints: [],
    transportCandidates: [],
    hotelCandidates: [],
    dailyPlans: [],
    restaurantHighlights: [],
    totalCostEstimate: 0,
    budgetFeasible: true,
    budgetNotes: "测试用例",
    warnings: [],
    ...over,
  };
}

const item = (
  o: Partial<Itinerary["dailyPlans"][number]["items"][number]> = {}
): Itinerary["dailyPlans"][number]["items"][number] => ({
  startTime: "09:00",
  endTime: "10:00",
  type: "sight",
  title: "测试活动",
  costEstimate: 0,
  ...o,
});

// ---------- 工具函数 ----------

test("parseHHmm 解析与拒绝", () => {
  assert.equal(parseHHmm("09:30"), 570);
  assert.equal(parseHHmm("9:05"), 545);
  assert.equal(parseHHmm("25:00"), null);
  assert.equal(parseHHmm("0930"), null);
});

test("parseLocation / haversine：春熙路→宽窄巷子约 4km 出头", () => {
  const chunxi = parseLocation("104.08191,30.65486")!;
  const kuanzhai = parseLocation("104.06428,30.66909")!;
  const km = haversineKm(chunxi, kuanzhai);
  assert.ok(km > 1.5 && km < 4, `实际 ${km}km`);
  assert.equal(parseLocation("字符串"), null);
});

test("estimateTransitMinutes 按方式给不同速度", () => {
  assert.ok(estimateTransitMinutes(2, "步行") > estimateTransitMinutes(2, "打车"));
});

// ---------- 预算 ----------

test("budget: 抓 day-sum 与 total-sum 不闭合（W1 复盘问题 #2）", () => {
  const it = baseItinerary({
    dailyPlans: [
      {
        day: 1,
        summary: "",
        items: [item({ costEstimate: 100 }), item({ costEstimate: 50 })],
        dayCostEstimate: 200, // 实际 150
      },
    ],
    totalCostEstimate: 999, // 各天之和 200
  });
  const rules = checkBudget(it).map((x) => x.rule);
  assert.ok(rules.includes("budget.day-sum"));
  assert.ok(rules.includes("budget.total-sum"));
});

test("budget: 声称可行但超预算 5% → budget.cap", () => {
  const it = baseItinerary({
    budgetTotal: 1000,
    totalCostEstimate: 1100,
    dailyPlans: [
      { day: 1, summary: "", items: [item({ costEstimate: 1100 })], dayCostEstimate: 1100 },
    ],
  });
  assert.ok(checkBudget(it).some((x) => x.rule === "budget.cap"));
});

test("budget: 在预算内却声称不可行 → feasibility-mismatch（防哭穷后门）", () => {
  const it = baseItinerary({
    budgetTotal: 6000,
    budgetFeasible: false,
    budgetNotes: "超出预算约422元，可通过降档住宿等方式调整（数字未同步的旧结论）",
    totalCostEstimate: 5926,
    dailyPlans: [
      { day: 1, summary: "", items: [item({ costEstimate: 5926 })], dayCostEstimate: 5926 },
    ],
  });
  assert.ok(
    checkBudget(it).some((x) => x.rule === "budget.feasibility-mismatch")
  );
});

test("budget: 不可行 + 有替代方案说明 → 不报错", () => {
  const it = baseItinerary({
    budgetTotal: 800,
    budgetFeasible: false,
    budgetNotes: "预算差约 2000 元：建议缩短至 3 天或换青旅，并给出替代方案明细",
    totalCostEstimate: 2800,
    dailyPlans: [
      { day: 1, summary: "", items: [item({ costEstimate: 2800 })], dayCostEstimate: 2800 },
    ],
  });
  assert.equal(checkBudget(it).filter((x) => x.rule === "budget.cap").length, 0);
});

// ---------- 时间 ----------

test("time: 重叠与倒序", () => {
  const it = baseItinerary({
    dailyPlans: [
      {
        day: 1,
        summary: "",
        items: [
          item({ startTime: "09:00", endTime: "11:00" }),
          item({ startTime: "10:30", endTime: "12:00", title: "重叠项" }),
          item({ startTime: "13:00", endTime: "12:30", title: "倒序项" }),
        ],
        dayCostEstimate: 0,
      },
    ],
  });
  const rules = checkTime(it).issues.map((x) => x.rule);
  assert.ok(rules.includes("time.overlap"));
  assert.ok(rules.includes("time.order"));
});

test("time: 到达日冲突（W1 复盘问题 #1）——14:07 到达却 07:30 排活动", () => {
  const it = baseItinerary({
    transportCandidates: [
      {
        mode: "高铁",
        description: "G1378",
        costEstimate: 1868,
        recommended: true,
        arriveTime: "14:07",
        source: "mock:rail-estimate",
      },
    ],
    dailyPlans: [
      {
        day: 1,
        summary: "",
        items: [item({ startTime: "07:30", endTime: "12:30", title: "熊猫基地" })],
        dayCostEstimate: 0,
      },
    ],
  });
  assert.ok(
    checkTime(it).issues.some((x) => x.rule === "time.arrival-conflict")
  );
});

test("time: 返程缓冲用「返程前最后一个活动」计算，且大交通时刻须与推荐方案一致", () => {
  const it = baseItinerary({
    transportCandidates: [
      {
        mode: "高铁",
        description: "返程 G1403",
        costEstimate: 1814,
        recommended: true,
        returnDepTime: "08:02",
        source: "mock:rail-estimate",
      },
    ],
    dailyPlans: [
      {
        day: 1,
        summary: "",
        items: [
          item({ startTime: "09:15", endTime: "10:30", title: "逛春熙路" }),
          item({
            startTime: "12:30",
            endTime: "19:30",
            type: "transit",
            title: "高铁返程",
            transitMode: "高铁",
          }),
        ],
        dayCostEstimate: 0,
      },
    ],
  });
  const issues = checkTime(it).issues;
  // 缓冲检查：逛街 10:30 结束 vs 08:02 发车 → 冲突
  assert.ok(issues.some((x) => x.rule === "time.return-buffer"));
  // 时刻一致性：行程 12:30 上车 vs 推荐 08:02 → 模型自编班次，打回
  assert.ok(issues.some((x) => x.rule === "time.transport-mismatch"));
});

test("geo: 回酒店项豁免间隙校验（入住时间弹性）", () => {
  const it = baseItinerary({
    dailyPlans: [
      {
        day: 1,
        summary: "",
        items: [
          item({
            startTime: "20:30",
            endTime: "22:30",
            type: "meal",
            title: "晚餐",
            location: "104.08191,30.65486",
          }),
          item({
            startTime: "22:30",
            endTime: "23:59",
            type: "hotel",
            title: "回酒店",
            location: "104.06428,30.66909",
          }),
        ],
        dayCostEstimate: 0,
      },
    ],
  });
  assert.equal(checkGeo(it).issues.length, 0);
});

test("time: 缺 arriveTime 时跳过并声明，而不是装作通过", () => {
  const it = baseItinerary({
    transportCandidates: [
      { mode: "高铁", description: "", costEstimate: 0, source: "mock" },
    ],
  });
  assert.ok(
    checkTime(it).skipped.some((x) => x.rule === "time.arrival-conflict")
  );
});

// ---------- 地理 ----------

test("geo: 正餐绕路（W1 复盘问题 #3）——武侯祠→6km 外吃饭且无通勤项", () => {
  const it = baseItinerary({
    dailyPlans: [
      {
        day: 1,
        summary: "",
        items: [
          item({
            startTime: "09:00",
            endTime: "12:00",
            title: "武侯祠",
            location: "104.04726,30.64720",
          }),
          item({
            startTime: "12:00",
            endTime: "13:30",
            type: "meal",
            title: "明婷饭店",
            location: "104.07452,30.69022",
          }),
        ],
        dayCostEstimate: 0,
      },
    ],
  });
  const rules = checkGeo(it).issues.map((x) => x.rule);
  assert.ok(rules.includes("geo.meal-detour"));
});

test("geo: transit 预留不足", () => {
  const it = baseItinerary({
    dailyPlans: [
      {
        day: 1,
        summary: "",
        items: [
          item({ title: "A", location: "104.04726,30.64720", endTime: "12:00" }),
          item({
            startTime: "12:00",
            endTime: "12:05",
            type: "transit",
            title: "打车",
            transitMode: "打车",
            transitMinutes: 25,
          }),
          item({
            startTime: "12:05",
            endTime: "13:00",
            title: "B",
            location: "104.14602,30.73296",
          }),
        ],
        dayCostEstimate: 0,
      },
    ],
  });
  assert.ok(checkGeo(it).issues.some((x) => x.rule === "geo.transit-reserved"));
});

// ---------- 硬约束 ----------

test("constraint: 不吃生食 × 推荐菜有刺身 → 打回", () => {
  const it = baseItinerary({
    hardConstraints: ["不吃生食"],
    restaurantHighlights: [
      {
        name: "某日料",
        address: "x",
        cuisine: "日料",
        avgPricePerPerson: 200,
        recommendedDishes: ["三文鱼刺身", "天妇罗"],
        reason: "好吃",
        source: "amap:maps_text_search",
        poiId: "B0TEST",
      },
    ],
  });
  assert.ok(
    checkHardConstraints(it).issues.some((x) => x.rule === "constraint.taboo")
  );
});

test("constraint: 无饮食禁忌时声明跳过", () => {
  const it = baseItinerary({ hardConstraints: ["住春熙路附近"] });
  const r = checkHardConstraints(it);
  assert.ok(r.skipped.some((x) => x.rule === "constraint.taboo"));
});

test("constraint: 「住宿位置在X附近」各种措辞都能提取区域名", () => {
  for (const phrase of ["住春熙路附近", "住宿位置在春熙路附近", "住宿必须选在春熙路附近"]) {
    const it = baseItinerary({
      hardConstraints: [phrase],
      hotelCandidates: [
        {
          name: "雅斯特酒店(成都春熙路太古里店)",
          address: "红星路三段8号",
          pricePerNight: 483,
          reason: "",
          source: "mock:hotel-estimate",
        },
      ],
    });
    const issues = checkHardConstraints(it).issues;
    assert.equal(
      issues.filter((x) => x.rule === "constraint.hotel-area").length,
      0,
      `措辞「${phrase}」误报`
    );
  }
});
