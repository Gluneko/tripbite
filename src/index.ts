import { query } from "@anthropic-ai/claude-agent-sdk";
import { mkdirSync, writeFileSync } from "node:fs";
import { config } from "./config.js";
import { SYSTEM_PROMPT, buildUserPrompt } from "./prompt.js";
import { ItinerarySchema, itineraryJsonSchema } from "./schema.js";
import { renderMarkdown } from "./render.js";

const argv = process.argv.slice(2);
while (argv[0] === "--") argv.shift(); // pnpm 会把分隔符 "--" 原样传入
const rawQuery = argv.join(" ").trim();
if (!rawQuery) {
  console.error('用法：pnpm dev -- "十一去成都4天，两人预算6000，爱吃辣…"');
  process.exit(1);
}

console.log(`🧭 食途 TripBite | 模型: ${config.model} | 高德 MCP: 已配置`);
console.log(`📝 需求: ${rawQuery}\n`);

const started = Date.now();

const run = query({
  prompt: buildUserPrompt(rawQuery),
  options: {
    model: config.model,
    systemPrompt: SYSTEM_PROMPT,
    mcpServers: {
      amap: {
        type: "http",
        url: config.amapMcpUrl,
        alwaysLoad: true, // W1 工具少，全量进 prompt，避免 tool-search 间接层
      },
    },
    // W1 单 Agent：只需要高德 MCP 工具，禁掉文件/命令类内置工具，保持轨迹干净
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
      ANTHROPIC_AUTH_TOKEN: config.zhipuApiKey,
    },
  },
});

let toolCalls = 0;

for await (const message of run) {
  switch (message.type) {
    case "system":
      if (message.subtype === "init") {
        const mcp = (message as { mcp_servers?: { name: string; status: string }[] })
          .mcp_servers;
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
          toolCalls++;
          console.log(
            `🔧 [${toolCalls}] ${block.name} ${JSON.stringify(block.input).slice(0, 160)}`
          );
        }
      }
      break;
    }
    case "result": {
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      console.log("\n" + "─".repeat(60));
      if (message.subtype !== "success") {
        console.error(`❌ 运行失败 (${message.subtype})，耗时 ${seconds}s`);
        process.exit(1);
      }

      // 成本小票
      console.log("\n🧾 成本小票");
      for (const [model, u] of Object.entries(message.modelUsage ?? {})) {
        console.log(
          `   ${model}: in=${u.inputTokens} out=${u.outputTokens} cacheRead=${u.cacheReadInputTokens}`
        );
      }
      console.log(
        `   turns=${message.num_turns} toolCalls=${toolCalls} 耗时=${seconds}s (成本按 Anthropic 牌价估算: $${message.total_cost_usd.toFixed(4)}，GLM 实际计费以智谱账单为准)`
      );

      // 结构化输出校验 + 落盘（structured_output 缺失时回退解析文本中的 JSON 块）
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
      const parsed = ItinerarySchema.safeParse(candidate);
      if (!parsed.success) {
        console.error("\n❌ 结构化输出未通过 schema 校验：");
        console.error(parsed.error.issues.slice(0, 5));
        mkdirSync("output", { recursive: true });
        writeFileSync(
          "output/last-raw.json",
          JSON.stringify(message.structured_output ?? message.result, null, 2)
        );
        console.error("原始输出已保存到 output/last-raw.json");
        process.exit(1);
      }

      const it = parsed.data;
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      mkdirSync("output", { recursive: true });
      const jsonPath = `output/itinerary-${stamp}.json`;
      const mdPath = `output/itinerary-${stamp}.md`;
      writeFileSync(jsonPath, JSON.stringify(it, null, 2));
      const md = renderMarkdown(it);
      writeFileSync(mdPath, md);

      console.log(`\n📄 已保存: ${jsonPath} | ${mdPath}\n`);
      console.log(md);
      break;
    }
  }
}
