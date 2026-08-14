import { z } from "zod";

/**
 * 行程结构化输出 Schema（W1 最小版）。
 * 设计原则：
 * - 每个推荐的餐厅/POI 必须带 amap poiId 或来源说明 → 后续 Verifier 可核验，防幻觉
 * - 金额统一为人民币元的数值 → 确定性预算校验器直接可用
 * - 时间用 "HH:mm" 字符串 → 营业时间/日程冲突校验器直接可用
 */

export const RestaurantSchema = z.object({
  name: z.string().describe("餐厅名称（必须来自高德工具返回结果，不得编造）"),
  address: z.string().describe("地址"),
  poiId: z.string().optional().describe("高德 POI ID（工具返回的 id 字段）"),
  cuisine: z.string().describe("菜系/类型，如 火锅、川菜小馆"),
  avgPricePerPerson: z.number().describe("人均消费估计（元）"),
  recommendedDishes: z.array(z.string()).describe("推荐菜品"),
  reason: z.string().describe("推荐理由，需说明与用户口味偏好的匹配点"),
  source: z.string().describe("信息来源，如 amap:maps_text_search"),
});

export const ItineraryItemSchema = z.object({
  startTime: z.string().describe("开始时间 HH:mm"),
  endTime: z.string().describe("结束时间 HH:mm"),
  type: z.enum(["sight", "meal", "transit", "hotel", "other"]),
  title: z.string().describe("活动名称，如 宽窄巷子 / 午餐：xx火锅"),
  address: z.string().optional(),
  location: z
    .string()
    .optional()
    .describe('坐标 "经度,纬度"，直接透传高德工具返回的 location 字段（校验器依赖）'),
  poiId: z.string().optional().describe("高德 POI ID（如适用）"),
  transitMode: z
    .string()
    .optional()
    .describe("type=transit 时：步行/地铁/公交/打车"),
  transitMinutes: z
    .number()
    .optional()
    .describe("type=transit 时：高德路线规划返回的耗时（分钟）"),
  costEstimate: z.number().describe("此项花费估计（元，两人则为总额）"),
  notes: z.string().optional(),
});

export const DayPlanSchema = z.object({
  day: z.number().describe("第几天，从 1 开始"),
  date: z.string().optional().describe("日期 YYYY-MM-DD（如用户给了日期）"),
  summary: z.string().describe("当日主题一句话"),
  items: z.array(ItineraryItemSchema),
  dayCostEstimate: z.number().describe("当日总花费估计（元）"),
});

export const ItinerarySchema = z.object({
  destination: z.string(),
  days: z.number(),
  travelers: z.number().describe("同行人数，未提供则为 1"),
  budgetTotal: z.number().optional().describe("用户给的总预算（元）"),
  tastePreferences: z.array(z.string()).describe("解析出的口味/饮食偏好"),
  hardConstraints: z
    .array(z.string())
    .describe("硬约束，如 不吃生食、住春熙路附近"),
  transportCandidates: z
    .array(
      z.object({
        mode: z.string().describe("往返大交通方式，如 高铁/飞机"),
        description: z.string(),
        costEstimate: z.number().describe("往返总花费估计（元，按人数）"),
        recommended: z
          .boolean()
          .optional()
          .describe("是否为推荐方案（行程排程必须与推荐方案的到/发时间自洽）"),
        arriveTime: z
          .string()
          .optional()
          .describe("去程到达目的地时刻 HH:mm（来自交通工具查询结果）"),
        returnDepTime: z
          .string()
          .optional()
          .describe("返程出发时刻 HH:mm（如已确定）"),
        source: z.string().describe("数据来源；W1 允许估算，标注 estimate"),
      })
    )
    .describe("往返交通候选，如出发地未知则给常见方案并标注假设"),
  hotelCandidates: z.array(
    z.object({
      name: z.string(),
      address: z.string(),
      poiId: z.string().optional(),
      pricePerNight: z.number().describe("每晚价格估计（元）"),
      reason: z.string(),
      source: z.string(),
    })
  ),
  dailyPlans: z.array(DayPlanSchema),
  restaurantHighlights: z
    .array(RestaurantSchema)
    .describe("全程重点餐厅推荐（含每餐正餐）"),
  totalCostEstimate: z.number().describe("全程总花费估计（元）"),
  budgetFeasible: z
    .boolean()
    .describe("预算是否可行；不可行必须为 false 并在 budgetNotes 说明"),
  budgetNotes: z
    .string()
    .describe("预算拆解与说明；不可行时给出诚实的替代方案"),
  warnings: z
    .array(z.string())
    .describe("不确定信息与假设声明，如 价格为估算、未核实营业时间"),
});

export type Itinerary = z.infer<typeof ItinerarySchema>;

/**
 * 供 Agent SDK outputFormat 使用的 JSON Schema。
 * 注意：CLI 端用 ajv(draft-07) 校验，zod 默认输出 draft-2020-12 会被拒，
 * 因此指定 target 并移除 $schema 头。
 */
export const itineraryJsonSchema = (() => {
  const schema = z.toJSONSchema(ItinerarySchema, { target: "draft-7" }) as Record<
    string,
    unknown
  >;
  delete schema.$schema;
  return schema;
})();
