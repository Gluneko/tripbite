/**
 * 冒烟测试：验证两个外部依赖可达且密钥有效（不启动完整 Agent）。
 * 运行：pnpm smoke
 */
import { config } from "./config.js";

async function checkGlm() {
  const res = await fetch(`${config.anthropicBaseUrl}/v1/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.llmApiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 16,
      messages: [{ role: "user", content: "回复OK" }],
    }),
  });
  const body = (await res.json()) as {
    content?: { text?: string }[];
    error?: unknown;
  };
  if (!res.ok) throw new Error(`GLM ${res.status}: ${JSON.stringify(body.error ?? body)}`);
  console.log(`✅ GLM (${config.model}) 可用: ${body.content?.[0]?.text ?? "?"}`);
}

async function checkAmapMcp() {
  const res = await fetch(config.amapMcpUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "tripbite-smoke", version: "0.1.0" },
      },
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Amap MCP ${res.status}: ${text.slice(0, 200)}`);
  const jsonLine = text.startsWith("event:")
    ? text.split("\n").find((l) => l.startsWith("data:"))?.slice(5)
    : text;
  const data = JSON.parse(jsonLine ?? "{}") as {
    result?: { serverInfo?: { name?: string; version?: string } };
  };
  console.log(
    `✅ 高德 MCP 可用: ${data.result?.serverInfo?.name ?? "amap"} ${data.result?.serverInfo?.version ?? ""}`
  );
}

const results = await Promise.allSettled([checkGlm(), checkAmapMcp()]);
let failed = false;
for (const r of results) {
  if (r.status === "rejected") {
    failed = true;
    console.error(`❌ ${r.reason instanceof Error ? r.reason.message : r.reason}`);
  }
}
process.exit(failed ? 1 : 0);
