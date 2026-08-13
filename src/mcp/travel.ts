/**
 * travel MCP server（W1 版，进程内 SDK MCP）。
 *
 * 交通与酒店报价目前为 mock 数据：结构与真实数据源一致、返回值确定性可复现
 * （同输入永远同输出，方便 W3 回归评测），且所有结果都带 source: "mock:*" 标注，
 * Agent 必须把该标注透传到行程的 warnings/source 字段。
 * W2+ 可整体换成 12306 MCP / 航班 MCP，工具接口保持不变。
 */
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

/** 字符串 → [0,1) 的确定性伪随机（FNV-1a），保证 mock 数据可复现 */
function hash01(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 0xffffffff;
}

/** 国庆/春节等旺季价格系数 */
function seasonFactor(date: string): number {
  const mmdd = date.slice(5); // "MM-DD"
  if (mmdd >= "10-01" && mmdd <= "10-07") return 1.6; // 国庆
  if (mmdd >= "01-25" && mmdd <= "02-10") return 1.5; // 春节（粗略）
  if (mmdd >= "05-01" && mmdd <= "05-05") return 1.4; // 五一
  return 1.0;
}

const CITY_KM: Record<string, Record<string, number>> = {
  // 少量常见城市对的粗略铁路里程，miss 时用 hash 兜底
  上海: { 成都: 1950, 北京: 1300, 大阪: 0, 三亚: 2600, 杭州: 170, 西安: 1350 },
  北京: { 成都: 1560, 上海: 1300, 三亚: 2900, 西安: 1100 },
  杭州: { 成都: 1800, 北京: 1280, 三亚: 2400, 上海: 170, 西安: 1300 },
  深圳: { 成都: 1650, 北京: 2200, 三亚: 700 },
};

function distanceKm(from: string, to: string): number {
  const d = CITY_KM[from]?.[to] ?? CITY_KM[to]?.[from];
  if (d) return d;
  return Math.round(400 + hash01(`${[from, to].sort().join("-")}`) * 1800);
}

export const travelServer = createSdkMcpServer({
  name: "travel",
  version: "0.1.0",
  instructions:
    "交通与酒店报价工具。当前为确定性 mock 数据（source 字段标注 mock），价格量级贴近真实。使用后必须在行程 warnings 中声明相关数据为估算。",
  tools: [
    tool(
      "search_transport",
      "查询两城市间的大交通候选（高铁/动车/飞机），返回班次、时长与单人票价。数据为确定性 mock，供预算规划用。",
      {
        from: z.string().describe("出发城市，如 上海"),
        to: z.string().describe("到达城市，如 成都"),
        date: z.string().describe("出发日期 YYYY-MM-DD"),
        adults: z.number().default(1).describe("出行人数"),
      },
      async ({ from, to, date, adults }) => {
        const km = distanceKm(from, to);
        const sf = seasonFactor(date);
        const seed = `${from}-${to}-${date}`;
        const options = [];

        // 高铁：约 0.46 元/km 二等座，5h 内才现实
        const hsrHours = km / 280;
        if (hsrHours <= 9) {
          const price = Math.round(km * 0.46 * (0.95 + hash01(seed + "hsr") * 0.1));
          options.push({
            mode: "高铁",
            trainNo: `G${1000 + Math.floor(hash01(seed) * 800)}`,
            depTime: "08:0" + Math.floor(hash01(seed + "t") * 9),
            durationHours: Math.round(hsrHours * 10) / 10,
            pricePerPerson: price,
            totalPrice: price * adults,
            seatClass: "二等座",
            source: "mock:rail-estimate",
          });
        }
        // 飞机：基础价随距离，旺季浮动大
        const flightBase = Math.max(400, km * 0.55);
        const flightPrice = Math.round(
          flightBase * sf * (0.85 + hash01(seed + "air") * 0.3)
        );
        options.push({
          mode: "飞机",
          flightNo: `MU${2000 + Math.floor(hash01(seed + "f") * 7000)}`,
          depTime: "1" + Math.floor(hash01(seed + "ft") * 9) + ":30",
          durationHours: Math.round((1 + km / 750) * 10) / 10,
          pricePerPerson: flightPrice,
          totalPrice: flightPrice * adults,
          seatClass: "经济舱",
          source: "mock:flight-estimate",
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                from,
                to,
                date,
                seasonFactor: sf,
                note: "mock 数据：价格为量级估算，规划时需在 warnings 声明",
                options,
              }),
            },
          ],
        };
      }
    ),
    tool(
      "quote_hotels",
      "对酒店候选列表报价（每晚价格）。酒店候选应先用高德 maps_text_search/maps_around_search 检索真实 POI，再把名称传入本工具询价。价格为确定性 mock。",
      {
        city: z.string().describe("城市"),
        hotelNames: z.array(z.string()).describe("酒店名称列表（来自高德检索结果）"),
        checkinDate: z.string().describe("入住日期 YYYY-MM-DD"),
        nights: z.number().describe("住几晚"),
        rooms: z.number().default(1).describe("房间数"),
      },
      async ({ city, hotelNames, checkinDate, nights, rooms }) => {
        const sf = seasonFactor(checkinDate);
        const quotes = hotelNames.map((name) => {
          // 档次感知：名称里带高端词 → 高基价
          const n = name.toLowerCase();
          const base = /亚朵|全季|桔子|丽枫|智选/.test(name)
            ? 420
            : /宾馆|招待所|青年旅舍|客栈/.test(name)
              ? 220
              : /瑞吉|丽思|香格里拉|华尔道夫|w酒店|文华东方/.test(n)
                ? 1600
                : 320;
          const pricePerNight = Math.round(
            base * sf * (0.85 + hash01(`${city}-${name}-${checkinDate}`) * 0.4)
          );
          return {
            name,
            pricePerNight,
            totalPrice: pricePerNight * nights * rooms,
            breakfast: hash01(name) > 0.5 ? "含双早" : "不含早",
            source: "mock:hotel-estimate",
          };
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                city,
                checkinDate,
                nights,
                rooms,
                seasonFactor: sf,
                note: "mock 数据：价格为量级估算（旺季已上浮），需在 warnings 声明",
                quotes,
              }),
            },
          ],
        };
      }
    ),
  ],
});
