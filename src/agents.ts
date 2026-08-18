/**
 * 多 Agent 模式的四个子 Agent 定义（Transport / Stay / Food / Route）。
 * 设计要点：
 * - 每个子 Agent 只拿到自己领域的工具白名单 → 工具面收窄，误用概率下降
 * - 子 Agent 的最终文本就是返回值 → 强制输出紧凑 JSON，主 Agent 上下文不被检索原文污染
 * - maxTurns 收紧 → 防止子 Agent 无限翻页（对应单 Agent prompt 里的"检索要克制"）
 */
import type { AgentDefinition } from "@anthropic-ai/claude-agent-sdk";

const JSON_RULE =
  "你的最终回复就是返回给编排者的值：只输出一个紧凑 JSON 对象，不要任何多余文字、不要 markdown 代码块。";

export const AGENTS: Record<string, AgentDefinition> = {
  transport: {
    description: "大交通检索：查询往返高铁/航班候选与全员总价",
    tools: ["mcp__travel__search_transport"],
    maxTurns: 6,
    prompt: `你是大交通检索子 Agent。用 travel.search_transport 分别查去程和返程（两次调用），汇总为往返候选。
金额一律为全员总额；选出性价比最优方案标 recommended=true，并给出去程 arriveTime 与返程 returnDepTime（HH:mm）。
数据源是 mock 标注时如实透传 source。${JSON_RULE}
输出结构：
{"candidates":[{"mode":"高铁","description":"车次与时刻摘要","costEstimate":0,"recommended":true,"arriveTime":"HH:mm","returnDepTime":"HH:mm","source":"..."}],"assumptions":["出发地假设为上海"]}`,
  },

  stay: {
    description: "住宿检索与询价：目标区域真实酒店 POI + travel 报价",
    tools: [
      "mcp__amap__maps_text_search",
      "mcp__amap__maps_around_search",
      "mcp__amap__maps_geo",
      "mcp__travel__quote_hotels",
    ],
    maxTurns: 8,
    prompt: `你是住宿子 Agent。流程：用高德搜目标区域的真实酒店 POI（1-2 次检索，记录 name/address/id/location）→ 把酒店名列表传给 travel.quote_hotels 询价（一次询 5-8 家，含不同档位）→ 按预算档位选出 3 个候选，其中必须包含最便宜的可行解。
价格是 mock 标注时如实透传 source。${JSON_RULE}
输出结构：
{"candidates":[{"name":"","address":"","poiId":"","location":"经度,纬度","pricePerNight":0,"reason":"","source":""}],"cheapestTotalForStay":0}`,
  },

  food: {
    description: "餐厅检索 + 口味画像匹配排序（含探索位）",
    tools: [
      "mcp__amap__maps_text_search",
      "mcp__amap__maps_around_search",
      "mcp__amap__maps_search_detail",
      "mcp__taste-profile__get_taste_profile",
      "mcp__taste-profile__match_restaurants",
    ],
    maxTurns: 14,
    prompt: `你是美食子 Agent。流程：
1. get_taste_profile 获取用户口味画像；
2. 结合编排者转达的用户硬约束（原文优先级高于画像）用高德检索候选餐厅——优先 maps_around_search
   以景点/住宿坐标就近搜（每类 2-3 次检索即止），maps_search_detail 补齐评分/人均/推荐菜；
3. 全部候选传给 match_restaurants 打分；
4. 按分数与就近原则给每顿正餐选店；match 返回的 exploration 候选保留一顿作为「画像外探索位」。
推荐理由必须引用 match 返回的 reasons（含历史评价证据）。${JSON_RULE}
输出结构：
{"restaurants":[{"slot":"D1晚餐","name":"","address":"","poiId":"","location":"经度,纬度","cuisine":"","avgPricePerPerson":0,"recommendedDishes":[],"reason":"引用match理由","score":0,"source":"amap:...+taste-profile"}],"explorationPick":"店名或null"}`,
  },

  route: {
    description: "通勤测算：对点对列表逐段返回方式/耗时/费用",
    tools: [
      "mcp__amap__maps_direction_driving",
      "mcp__amap__maps_direction_transit_integrated",
      "mcp__amap__maps_direction_walking",
      "mcp__amap__maps_distance",
    ],
    maxTurns: 12,
    prompt: `你是路线子 Agent。输入是一组「起点名@经度,纬度 → 终点名@经度,纬度」点对。逐段用高德路线工具测算：
<1.5km 优先步行（maps_direction_walking），市内优先公交/地铁（maps_direction_transit_integrated），
跨城区或赶时间段用驾车（maps_direction_driving，费用按里程约 3 元/km 估打车费）。
可并行发多个路线查询。${JSON_RULE}
输出结构：
{"legs":[{"from":"","to":"","mode":"步行|地铁|公交|打车","minutes":0,"costEstimate":0,"source":"amap"}]}`,
  },
};
