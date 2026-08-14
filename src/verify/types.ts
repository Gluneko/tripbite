/** 确定性校验器的公共类型。所有规则纯代码判定，零 LLM、零网络，结果可回归。 */

export type Severity = "error" | "warn";

export interface VerifyIssue {
  /** 规则 ID，如 budget.day-sum / time.overlap / geo.meal-detour */
  rule: string;
  severity: Severity;
  /** 出问题的位置，如 dailyPlans[2].items[3] */
  path: string;
  /** 人类可读的失败原因（也是打回 Planner 时的定向修复指令） */
  message: string;
  expected?: string | number;
  actual?: string | number;
}

export interface SkippedRule {
  rule: string;
  reason: string;
}

export interface VerifyResult {
  /** 无 error 级 issue 即通过（warn 不拦截） */
  passed: boolean;
  issues: VerifyIssue[];
  /** 因数据缺失而跳过的规则（透明度：没检查 ≠ 检查通过） */
  skipped: SkippedRule[];
  stats: { errors: number; warns: number; rulesRun: number };
}
