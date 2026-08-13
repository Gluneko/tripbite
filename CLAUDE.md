# TripBite 项目说明（给 AI 协作者）

旅行美食规划 Agent，4 周作品集项目。完整蓝图见 docs/blueprint.md，当前处于 W1（最小闭环）。

## 技术栈与约定

- TypeScript + pnpm + tsx；Node ≥ 22（用了 `--env-file`）
- @anthropic-ai/claude-agent-sdk，模型走智谱 Anthropic 兼容端点（ANTHROPIC_BASE_URL），密钥只放 .env（已 gitignore），绝不硬编码/提交
- 高德官方 MCP（Streamable HTTP，key 在 URL query 上）
- 行程结构 schema 在 src/schema.ts（zod 单一事实来源）：改输出结构只改这里
- 金额一律人民币元数值、时间一律 "HH:mm"（为确定性校验器预留）；POI 必须带 poiId/source
- 命令：`pnpm dev -- "<需求>"`、`pnpm smoke`（端点连通性）、`pnpm typecheck`

## 路线图要点（勿删功能）

- W2：拆 Transport/Stay/Food/Route 四个子 Agent；自写 taste-profile-mcp；确定性 Verifier
- W3：40+ case 评测集 + LLM-as-judge + Langfuse tracing + CI
- 评测与 tracing 永远不砍（项目核心差异点）

## 注意

- 云端沙箱可能无法访问 open.bigmodel.cn / mcp.amap.com（网络白名单），端到端运行需在本机执行
- 成本小票的美元金额按 Anthropic 牌价估算，GLM 实际计费以智谱账单为准
