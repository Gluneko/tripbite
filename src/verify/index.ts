/** 校验器入口：组合所有规则，输出结构化结果与控制台报告。 */
import type { Itinerary } from "../schema.js";
import {
  checkBudget,
  checkGeo,
  checkHardConstraints,
  checkProvenance,
  checkTime,
} from "./checks.js";
import type { VerifyResult } from "./types.js";

export function verifyItinerary(it: Itinerary): VerifyResult {
  const budget = checkBudget(it);
  const time = checkTime(it);
  const geo = checkGeo(it);
  const hard = checkHardConstraints(it);
  const prov = checkProvenance(it);

  const issues = [...budget, ...time.issues, ...geo.issues, ...hard.issues, ...prov];
  const skipped = [...time.skipped, ...geo.skipped, ...hard.skipped];
  const errors = issues.filter((x) => x.severity === "error").length;
  const warns = issues.length - errors;

  return {
    passed: errors === 0,
    issues,
    skipped,
    stats: { errors, warns, rulesRun: 5 },
  };
}

/** 控制台报告（也用于打回 Planner 的失败原因文本） */
export function formatReport(r: VerifyResult): string {
  const lines: string[] = [];
  lines.push(
    r.passed
      ? `✅ 确定性校验通过（${r.stats.warns} 条提醒）`
      : `❌ 确定性校验未通过：${r.stats.errors} 个错误 / ${r.stats.warns} 条提醒`
  );
  for (const i of r.issues) {
    const mark = i.severity === "error" ? "✗" : "⚠";
    const detail =
      i.expected != null || i.actual != null
        ? `（期望 ${i.expected ?? "-"}，实际 ${i.actual ?? "-"}）`
        : "";
    lines.push(`  ${mark} [${i.rule}] ${i.path}: ${i.message}${detail}`);
  }
  for (const s of r.skipped) {
    lines.push(`  ○ [跳过 ${s.rule}] ${s.reason}`);
  }
  return lines.join("\n");
}

/** 打回 Planner 用的结构化修复指令（W2 重试循环使用） */
export function toRepairInstructions(r: VerifyResult): string {
  const errors = r.issues.filter((x) => x.severity === "error");
  if (errors.length === 0) return "";
  return [
    "上一版行程未通过确定性校验，请只针对以下问题定向修复，其余部分保持不变：",
    ...errors.map(
      (e, i) =>
        `${i + 1}. [${e.rule}] ${e.path}: ${e.message}` +
        (e.expected != null ? `（要求：${e.expected}）` : "")
    ),
  ].join("\n");
}
