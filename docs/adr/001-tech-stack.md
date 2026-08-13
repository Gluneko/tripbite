# ADR-001：W1 技术栈选型

日期：2026-08-13 · 状态：已采纳

## 背景

4 周全职冲刺做一个"带评测与可观测"的旅行美食规划 Agent 作品集项目。W1 目标是最小闭环：一条命令输出一份基于真实地理数据的结构化行程。

## 决策

### 1. Claude Agent SDK（TypeScript）而不是裸 API / LangChain / LlamaIndex

- Agent 主循环（工具调用、重试、上下文管理、MCP 连接）由 SDK 承担，我们把精力花在领域逻辑（规划、校验、评测）上
- SDK 原生支持 MCP（stdio / SSE / Streamable HTTP 三种传输），W2 自写 taste-profile MCP Server 可以零成本接入
- `outputFormat: json_schema` 提供结构化输出强约束（schema 不匹配会自动重试），比"提示词里求模型输出 JSON"可靠
- TypeScript 贴合主栈；面试叙事上与 Claude Code / MCP 生态一致

### 2. 模型：智谱 GLM-4.7 走 Anthropic 兼容端点

- Agent SDK 只认 Anthropic 协议；智谱提供官方 Anthropic 兼容端点（`open.bigmodel.cn/api/anthropic`），设 `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` 即可
- 国内网络可直连、成本低，适合开发期高频迭代；模型名通过 `TRIPBITE_MODEL` 可切换（如 glm-5.2），W3 做模型分级时直接复用该机制
- 代价：Anthropic 服务端特性（server-side web search、牌价成本统计）不可用或不准 —— 成本小票以 token 数为准，金额仅供参考

### 3. 地理数据：高德官方 MCP Server（Streamable HTTP）

- 国内旅行场景的 POI / 路线 / 通勤 / 天气一站覆盖，官方维护，key 免费额度够开发
- 选 Streamable HTTP（`mcp.amap.com/mcp?key=…`）而不是 npm stdio 包：零本地依赖、协议更新由服务端负责；也顺便覆盖了 MCP 三种传输里最新的一种（面试考点）
- `alwaysLoad: true`：W1 工具少，全量注入 prompt，避免 tool-search 间接层增加不确定性

### 4. 结构化输出：zod schema 单一事实来源

- `src/schema.ts` 用 zod 定义行程结构，`z.toJSONSchema()` 生成 JSON Schema 喂给 SDK 的 `outputFormat`，运行端再用同一 schema `safeParse` 双保险
- schema 字段为 W2/W3 预埋：`poiId`/`source`（防幻觉核验）、数值金额与 `HH:mm` 时间（确定性校验器直接可用）、`budgetFeasible`（对抗性 case 判分点）

### 5. 防幻觉：先靠 prompt 约束，W2 起靠 Verifier

W1 在系统提示中强制"POI 必须来自工具结果、估算必须进 warnings、预算不可行必须诚实说明"。这是软约束，已知不够 —— W2 加确定性校验器（预算/时间/地理），W3 用评测集量化拦截率。

## 备选方案与放弃原因

- **裸 Anthropic Messages API + 自写 agent loop**：可控性最高，但 4 周预算下重复造轮子（重试、MCP 客户端、上下文压缩），且"会用 Agent SDK"本身是面试考点
- **Python (LangGraph)**：生态成熟，但偏离主栈；留作频道对比选题
- **高德 stdio MCP（npm 包）**：需本地 Node 子进程管理，无优势
