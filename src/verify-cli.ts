/**
 * 离线复验任意行程 JSON：pnpm verify -- <file.json>
 * exit 0 = 通过；exit 1 = 有 error 级问题（供 CI 使用）
 */
import { readFileSync } from "node:fs";
import { ItinerarySchema } from "./schema.js";
import { formatReport, verifyItinerary } from "./verify/index.js";

const argv = process.argv.slice(2);
while (argv[0] === "--") argv.shift();
const file = argv[0];
if (!file) {
  console.error("用法：pnpm verify -- output/itinerary-xxx.json");
  process.exit(1);
}

const raw = JSON.parse(readFileSync(file, "utf-8"));
const parsed = ItinerarySchema.safeParse(raw);
if (!parsed.success) {
  console.error("❌ schema 校验失败：");
  console.error(parsed.error.issues.slice(0, 10));
  process.exit(1);
}

const result = verifyItinerary(parsed.data);
console.log(formatReport(result));
process.exit(result.passed ? 0 : 1);
