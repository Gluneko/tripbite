/** 环境配置。密钥一律来自 .env（已 gitignore），不硬编码。 */

function required(name: string, fallbackName?: string): string {
  const v =
    process.env[name] ?? (fallbackName ? process.env[fallbackName] : undefined);
  if (!v) {
    console.error(
      `缺少环境变量 ${name}。请复制 .env.example 为 .env 并填入密钥。`
    );
    process.exit(1);
  }
  return v;
}

export const config = {
  /**
   * LLM API Key（任何提供 Anthropic 兼容端点的服务商均可：
   * 智谱 / DeepSeek / Kimi / Qwen…）。兼容旧变量名 ZHIPU_API_KEY。
   */
  llmApiKey: required("LLM_API_KEY", "ZHIPU_API_KEY"),
  /** Anthropic 兼容 base URL（默认智谱；DeepSeek 用 https://api.deepseek.com/anthropic） */
  anthropicBaseUrl:
    process.env.ANTHROPIC_BASE_URL ?? "https://open.bigmodel.cn/api/anthropic",
  /** 高德开放平台 key */
  amapKey: required("AMAP_KEY"),
  /** 规划模型（按服务商填对应模型名） */
  model: process.env.TRIPBITE_MODEL ?? "glm-4.7",
  /** 高德官方 MCP（Streamable HTTP） */
  get amapMcpUrl() {
    return `https://mcp.amap.com/mcp?key=${this.amapKey}`;
  },
};
