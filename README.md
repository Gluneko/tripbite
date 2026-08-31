# 食途 TripBite 🍜🧭

> 旅行美食规划 Agent — Claude Agent SDK + MCP · 带评测与可观测的开源作品集项目
>
> 姊妹项目（一套方法论，六种确定性形态）：本项目（规则约束）·
> [岩鉴 PetroLens](https://github.com/Gluneko/petrolens)（数值复算）·
> [腕鉴 BrachioKey](https://github.com/Gluneko/brachiokey)（决策树复走）·
> [鸟探 BirdScout](https://github.com/Gluneko/birdscout)（数据血缘）·
> [矿探 OreScout](https://github.com/Gluneko/orescout)（统计推断确定性化）·
> [文鉴 CiteLens](https://github.com/Gluneko/citelens)（归因确定性化）

**输入**：目的地、日期、预算、口味偏好、同行人数
**输出**：可执行的行程方案 —— 交通/酒店候选、逐日路线（含通勤时间）、每餐餐厅推荐（带口味匹配依据）

## 当前进度：W1 — 最小闭环

- [x] Claude Agent SDK（TypeScript）脚手架，模型走智谱 GLM 的 Anthropic 兼容端点
- [x] 接入高德官方 MCP Server（Streamable HTTP）：POI 搜索 / 路线规划 / 天气
- [x] 自写 travel MCP（进程内 SDK MCP）：交通检索 + 酒店报价（确定性 mock，来源标注）
- [x] 单 Agent + 工具，结构化行程 JSON（schema 强校验）+ Markdown 渲染
- [x] 成本小票：每次运行输出各模型 token 用量与耗时
- [x] 真实运行样例与复盘：[docs/samples/](docs/samples/) · [W1 复盘（两次运行对比 + 已知问题清单）](docs/w1-notes.md)
- [x] W2：确定性 Verifier（6 类规则 26 单测）+ 打回定向重排循环（实测 R0=7错→R2=0）
- [x] W2：taste-profile MCP——大众点评 30 条真实评价 → 口味画像 + 候选匹配打分（推荐理由带证据引用）
- [x] 供应商无关 LLM 后端（智谱/DeepSeek/Kimi 任一 Anthropic 兼容端点，.env 三行切换）+ 跨模型首测（见 [W2 笔记](docs/w2-notes.md)）
- [x] W2：多 Agent 拆分（`--multi`，Orchestrator + 4 领域子 Agent）+ 单/多消融对比（[结论](docs/w2-notes.md)：当前任务规模下单 Agent 更优，数据说话）
- [x] W2：画像低置信标注 + 画像外探索位（防口味茧房）
- [ ] W3：三层评测体系 + Langfuse tracing
- [ ] W4：打磨与发布

## 快速开始

```bash
pnpm install
cp .env.example .env   # 填入智谱 API key 与高德 key
pnpm smoke             # 冒烟测试：验证 GLM 端点与高德 MCP 可达
pnpm dev -- "十一去成都4天，两人预算6000，爱吃辣但同伴不能吃太辣，要一顿火锅一顿苍蝇馆子，住春熙路附近"
```

输出保存在 `output/itinerary-<时间戳>.json` 与 `.md`。

## 架构（W1）

```
用户输入 → 单 Agent (GLM-4.7 via Agent SDK 主循环)
              │  高德 MCP: maps_text_search / maps_around_search /
              │            maps_direction_* / maps_weather
              ▼
     结构化行程 JSON (zod schema + Agent SDK outputFormat 强约束)
              ▼
     Markdown 渲染 + 成本小票
```

防幻觉设计（W1 版）：所有 POI 必须来自高德工具返回结果并携带 `poiId` 与 `source` 字段；估算数据必须写入 `warnings` 声明；预算不可行时 `budgetFeasible=false` 并给替代方案，而不是硬编假行程。W2 起由 Verifier 层做确定性核验。

## 架构决策记录（ADR）

- [ADR-001 技术栈选型](docs/adr/001-tech-stack.md)

## 项目蓝图

完整 4 周计划（多 Agent 编排、taste-profile MCP、三层评测体系、Langfuse 可观测）见 [docs/blueprint.md](docs/blueprint.md)。
