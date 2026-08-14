import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdirSync, writeFileSync } from "node:fs";
import { config } from "./config.js";
import { travelServer } from "./mcp/travel.js";
import { tasteServer } from "./mcp/taste.js";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompt.js";
import { ItinerarySchema, itineraryJsonSchema, type Itinerary } from "./schema.js";
import { renderMarkdown } from "./render.js";
import {
  formatReport,
  toRepairInstructions,
  verifyItinerary,
} from "./verify/index.js";

const argv = process.argv.slice(2);
while (argv[0] === "--") argv.shift(); // pnpm 会把分隔符 "--" 原样传入
const rawQuery = argv.join(" ").trim();
if (!rawQuery) {
  console.error('用法：pnpm dev -- "十一去成都4天，两人预算6000，爱吃辣…"');
  process.exit(1);
}

/** Verifier 打回后的最大重排轮数（0 = 只生成不重排） */
const MAX_REPAIR_ROUNDS = Number(process.env.TRIPBITE_MAX_REPAIR ?? 2);

console.log(`🧭 食途 TripBite | 模型: ${config.model} | 高德 MCP: 已配置`);
console.log(`📝 需求: ${rawQuery}\n`);

interface RunOutcome {
  itinerary?: Itinerary;
  rawOutput?: unknown;
  sessionId?: string;
  costUsd: number;
  turns: number;
  toolCalls: number;
}

/** 跑一轮 Agent（首轮新会话；重排轮 resume 上一会话，保留工具调用上下文） */
async function runAgentOnce(
  prompt: string,
  resumeSessionId?: string
): Promise<RunOutcome> {
  const outcome: RunOutcome = { costUsd: 0, turns: 0, toolCalls: 0 };

  const run = query({
    prompt,
    options: {
      model: config.model,
      systemPrompt: SYSTEM_PROMPT,
      resume: resumeSessionId,
      mcpServers: {
        amap: {
          type: "http",
          url: config.amapMcpUrl,
          alwaysLoad: true, // 工具少，全量进 prompt，避免 tool-search 间接层
        },
          travel: travelServer, // 进程内 SDK MCP：交通/酒店报价（W1 mock，W2 换真实源）
        "taste-profile": tasteServer, // 口味画像：大众点评真实数据建模（W2 核心差异点）
      },
      // 单 Agent 阶段：只需要 MCP 工具，禁掉文件/命令类内置工具，保持轨迹干净
      disallowedTools: [
        "Bash",
        "Edit",
        "Write",
        "NotebookEdit",
        "Task",
        "WebFetch",
        "WebSearch",
      ],
      permissionMode: "bypassPermissions",
      maxTurns: 60,
      outputFormat: {
        type: "json_schema",
        schema: itineraryJsonSchema as Record<string, unknown>,
      },
      env: {
        ...process.env,
        ANTHROPIC_BASE_URL: config.anthropicBaseUrl,
        ANTHROPIC_AUTH_TOKEN: config.llmApiKey,
      },
    },
  });

  try {
  for await (const message of run) {
    switch (message.type) {
      case "system":
        if (message.subtype === "init") {
          outcome.sessionId = message.session_id;
          const mcp = (
            message as { mcp_servers?: { name: string; status: string }[] }
          ).mcp_servers;
          console.log(
            `✅ 会话就绪 (session ${message.session_id.slice(0, 8)}…)` +
              (mcp?.length
                ? ` | MCP: ${mcp.map((s) => `${s.name}:${s.status}`).join(", ")}`
                : "")
          );
        }
        break;
      case "assistant": {
        for (const block of message.message.content) {
          if (block.type === "text" && block.text.trim()) {
            console.log(`\n💬 ${block.text.trim().slice(0, 300)}`);
          } else if (block.type === "tool_use") {
            outcome.toolCalls++;
            console.log(
              `🔧 [${outcome.toolCalls}] ${block.name} ${JSON.stringify(block.input).slice(0, 160)}`
            );
          }
        }
        break;
      }
      case "result": {
        if (message.subtype !== "success" || message.is_error) {
          const detail =
            message.subtype === "success" ? message.result : message.subtype;
          console.error(`\n❌ 运行失败: ${detail}`);
          if (/余额不足|1113|insufficient/i.test(String(detail))) {
            console.error(
              "💡 智谱 API 余额/资源包已用尽，请到 open.bigmodel.cn 费用中心充值后重试。"
            );
          }
          return outcome;
        }
        outcome.costUsd = message.total_cost_usd;
        outcome.turns = message.num_turns;
        console.log("\n🧾 成本小票");
        for (const [model, u] of Object.entries(message.modelUsage ?? {})) {
          console.log(
            `   ${model}: in=${u.inputTokens} out=${u.outputTokens} cacheRead=${u.cacheReadInputTokens}`
          );
        }

        // 结构化输出（缺失时回退解析文本中的 JSON 块）
        let candidate: unknown = message.structured_output;
        if (candidate == null && typeof message.result === "string") {
          const m =
            message.result.match(/```json\s*([\s\S]*?)```/) ??
            message.result.match(/(\{[\s\S]*\})/);
          if (m) {
            try {
              candidate = JSON.parse(m[1]!);
            } catch {
              /* 留给 schema 校验报错 */
            }
          }
        }
        outcome.rawOutput = candidate;
        const parsed = ItinerarySchema.safeParse(candidate);
        if (parsed.success) outcome.itinerary = parsed.data;
        else {
          console.error("❌ 结构化输出未通过 schema 校验：");
          console.error(parsed.error.issues.slice(0, 5));
        }
        break;
      }
    }
  }
  } catch (err) {
    const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
    console.error(`\n❌ 运行中断: ${msg}`);
    if (/余额不足|1113|insufficient|429/i.test(msg ?? "")) {
      console.error(
        "💡 智谱 API 余额/资源包已用尽，请到 open.bigmodel.cn 费用中心充值后重试。"
      );
    }
  }
  return outcome;
}

// ---------- 主流程：生成 → 校验 → 打回重排（最多 N 轮） ----------

const started = Date.now();
mkdirSync("output", { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

let prompt = buildUserPrompt(rawQuery);
let sessionId: string | undefined;
let itinerary: Itinerary | undefined;
let verdict = undefined as ReturnType<typeof verifyItinerary> | undefined;
let totalCost = 0;
const roundsLog: { round: number; errors: number; costUsd: number }[] = [];

for (let round = 0; round <= MAX_REPAIR_ROUNDS; round++) {
  if (round > 0) {
    console.log(`\n🔁 打回重排（第 ${round}/${MAX_REPAIR_ROUNDS} 轮）`);
  }
  const r = await runAgentOnce(prompt, sessionId);
  sessionId = r.sessionId ?? sessionId;
  totalCost += r.costUsd;

  if (!r.itinerary) {
    if (r.rawOutput != null) {
      writeFileSync(
        `output/last-raw-${stamp}.json`,
        JSON.stringify(r.rawOutput, null, 2)
      );
      console.error(`原始输出已保存到 output/last-raw-${stamp}.json`);
    }
    if (itinerary) break; // 重排轮失败：退回用上一轮结果
    process.exit(1);
  }

  itinerary = r.itinerary;
  verdict = verifyItinerary(itinerary);
  roundsLog.push({
    round,
    errors: verdict.stats.errors,
    costUsd: Math.round(r.costUsd * 10000) / 10000,
  });

  console.log(`\n🔍 确定性校验（第 ${round} 轮生成）`);
  console.log(formatReport(verdict));
  writeFileSync(
    `output/verify-${stamp}-r${round}.json`,
    JSON.stringify(verdict, null, 2)
  );
  writeFileSync(
    `output/itinerary-${stamp}-r${round}.json`,
    JSON.stringify(itinerary, null, 2)
  );

  if (verdict.passed) break;
  if (round < MAX_REPAIR_ROUNDS) {
    prompt =
      toRepairInstructions(verdict) +
      "\n\n修复以上问题后，重新输出完整的结构化行程（未涉及的部分保持原样，不要重新检索已确认的 POI）。";
  }
}

if (!itinerary || !verdict) process.exit(1);

const seconds = ((Date.now() - started) / 1000).toFixed(1);
const md = renderMarkdown(itinerary);
writeFileSync(`output/itinerary-${stamp}.json`, JSON.stringify(itinerary, null, 2));
writeFileSync(`output/itinerary-${stamp}.md`, md);

console.log("\n" + "─".repeat(60));
console.log(
  `📊 轮次汇总: ${roundsLog
    .map((r) => `R${r.round}=${r.errors}错误($${r.costUsd})`)
    .join(" → ")} | 总耗时 ${seconds}s | 总成本 $${totalCost.toFixed(4)}（按 Anthropic 牌价折算仅供横向对比，实际费用以所用服务商账单为准）`
);
console.log(
  verdict.passed
    ? "✅ 最终行程通过确定性校验"
    : `⚠️ 达到最大重排轮数，仍有 ${verdict.stats.errors} 个错误——输出最后一轮结果供人工判断`
);
console.log(`\n📄 已保存: output/itinerary-${stamp}.json | output/itinerary-${stamp}.md\n`);
console.log(md);
