/**
 * taste-profile MCP server（进程内 SDK MCP）。
 * 把大众点评真实评价数据建模成 Agent 可调用的口味记忆：
 * - get_taste_profile：返回画像（菜系亲和度/特质/雷点，全部带原始评价证据）
 * - match_restaurants：对候选餐厅按画像打分排序，返回可引用的推荐/避雷理由
 * 画像计算纯代码确定性（src/taste/profile.ts），数据在 data/taste/reviews.json。
 * W2 后半可抽成独立 npm 包发布。
 */
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import {
  buildProfile,
  loadReviews,
  matchCandidates,
  pickExploration,
} from "../taste/profile.js";

const profile = buildProfile(loadReviews());

export const tasteServer = createSdkMcpServer({
  name: "taste-profile",
  version: "0.1.0",
  instructions:
    "用户口味画像工具（基于其大众点评真实评价建模）。规划餐厅前先 get_taste_profile 了解偏好，选出候选后必须用 match_restaurants 打分排序，推荐理由要引用返回的 reasons（含原始评价证据），不要泛泛而谈。",
  tools: [
    tool(
      "get_taste_profile",
      "获取用户口味画像：菜系亲和度、正面信号、雷点、特质（牛肉偏好/排队厌恶/辣度耐受等），每条都带原始评价证据。",
      {},
      async () => ({
        content: [{ type: "text", text: JSON.stringify(profile) }],
      })
    ),
    tool(
      "match_restaurants",
      "对候选餐厅列表按用户口味画像打分（0-100）并给出推荐/避雷理由。候选应来自高德真实检索结果，把店名、菜系、描述/推荐菜、人均、评分传入。",
      {
        candidates: z
          .array(
            z.object({
              name: z.string(),
              cuisine: z.string().optional().describe("菜系，如 潮汕牛肉火锅"),
              description: z
                .string()
                .optional()
                .describe("检索得到的标签/推荐菜/描述自由文本"),
              avgPrice: z.number().optional().describe("人均（元）"),
              rating: z.number().optional().describe("高德评分"),
            })
          )
          .min(1),
      },
      async ({ candidates }) => {
        const results = matchCandidates(profile, candidates).sort(
          (a, b) => b.score - a.score
        );
        const exploration = pickExploration(profile, candidates);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                results,
                exploration:
                  exploration ??
                  "无探索位候选（所有候选菜系画像里都吃过，或画像外候选公共评分不足 4.5）",
              }),
            },
          ],
        };
      }
    ),
  ],
});
