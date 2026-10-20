import type { Category, DecisionType, Policy, RuleResult } from "@agentguard/shared";
import { isCategory } from "@agentguard/shared";
import { decide } from "./decide";
import { PERIOD_MS } from "./periods";
import { evaluatePolicy } from "./policyEngine";
import { scoreRisk } from "./riskEngine";

/**
 * Policy simulator (R5): replays past payment requests against a draft policy before you
 * activate it. Pure and deterministic: it re-runs the policy rules, risk score and decision
 * function in time order, rebuilding budgets, "merchant paid before" and velocity as the new
 * policy would have shaped them. Stored AI findings (injection, intent) are reused, not recomputed.
 */

export interface ReplayRow {
  id: string;
  createdAt: Date;
  item: string;
  merchantDomain: string;
  merchantId: string | null;
  merchantCreatedAt: Date | null;
  amount: number;
  currency: string;
  category: string | null;
  decision: DecisionType;
  injectionDetected: boolean;
  intentAligned: boolean | null;
  taskBound: boolean;
}

export interface ReplayResult {
  id: string;
  createdAt: string;
  item: string;
  merchantDomain: string;
  amount: number;
  actual: DecisionType;
  simulated: DecisionType;
  change: "same" | "stricter" | "looser";
  reasons: string[];
}

export interface ReplaySummary {
  total: number;
  changed: number;
  stricter: number;
  looser: number;
  actual: Record<DecisionType, number>;
  simulated: Record<DecisionType, number>;
}

const RANK: Record<DecisionType, number> = { APPROVE: 0, ASK_HUMAN: 1, BLOCK: 2 };
const DAY = 86_400_000;

export interface ReplayOptions {
  /** Merchants actually paid before the replay window starts (they count as "used before"). */
  merchantsPaidBefore?: Iterable<string>;
}

export function replayPolicy(policy: Policy, rows: ReplayRow[], opts: ReplayOptions = {}): { results: ReplayResult[]; summary: ReplaySummary } {
  const known = new Set(opts.merchantsPaidBefore ?? []);
  const ordered = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const committed: { at: number; amount: number; category: Category; merchantId: string | null }[] = [];
  const results: ReplayResult[] = [];

  for (const r of ordered) {
    const now = r.createdAt;
    const t = now.getTime();
    const category: Category = r.category && isCategory(r.category) ? r.category : "other";
    const windowMs = (policy.velocity?.window_minutes ?? 60) * 60_000;
    const before = committed.filter((c) => c.at < t);
    const merchantPaidBefore = !!r.merchantId && (known.has(r.merchantId) || before.some((c) => c.merchantId === r.merchantId));
    const txInVelocityWindow = before.filter((c) => t - c.at <= windowMs).length;
    const amounts = before.map((c) => c.amount);
    const avgAmount = amounts.length >= 3 ? amounts.reduce((s, a) => s + a, 0) / amounts.length : null;
    const merchantAgeDays = r.merchantCreatedAt ? Math.max(0, Math.floor((t - r.merchantCreatedAt.getTime()) / DAY)) : null;

    const rules: RuleResult[] = [];
    if (!r.merchantId) rules.push({ rule_id: "merchant_unknown", outcome: "block", detail: `${r.merchantDomain} is not a known merchant.` });
    if (!r.taskBound) rules.push({ rule_id: "task_bound", outcome: "ask", detail: "No task was registered for this purchase." });
    if (r.merchantId) {
      rules.push(
        ...evaluatePolicy({
          policy,
          purchase: { item: r.item, category, amount: r.amount, currency: r.currency, merchantDomain: r.merchantDomain, merchantAgeDays },
          history: {
            merchantPaidBefore,
            txInVelocityWindow,
            spent: (cat, period) =>
              before.filter((c) => t - c.at <= PERIOD_MS[period] && (cat === "*" || c.category === cat)).reduce((s, c) => s + c.amount, 0),
          },
          now,
        }),
      );
    }

    const risk = scoreRisk({
      amount: r.amount,
      avgAmount,
      merchantAgeDays,
      merchantPaidBefore,
      category,
      velocity: policy.velocity ? { count: txInVelocityWindow + 1, max: policy.velocity.max_transactions } : null,
      quietHours: rules.some((x) => x.rule_id === "quiet_hours" && x.outcome !== "pass"),
      injection: { heuristicHit: r.injectionDetected, llmScore: null },
      intent: { aligned: r.intentAligned },
    });
    const d = decide({
      killSwitch: false,
      rules,
      score: risk.score,
      injectionDetected: risk.injectionDetected,
      intentAligned: r.intentAligned,
      aiCheckFailed: false,
    });

    if (d.decision !== "BLOCK") committed.push({ at: t, amount: r.amount, category, merchantId: r.merchantId });
    const diff = RANK[d.decision] - RANK[r.decision];
    results.push({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      item: r.item,
      merchantDomain: r.merchantDomain,
      amount: r.amount,
      actual: r.decision,
      simulated: d.decision,
      change: diff > 0 ? "stricter" : diff < 0 ? "looser" : "same",
      reasons: d.reasons,
    });
  }

  const count = (key: "actual" | "simulated") =>
    results.reduce<Record<DecisionType, number>>((m, x) => ({ ...m, [x[key]]: m[x[key]] + 1 }), { APPROVE: 0, ASK_HUMAN: 0, BLOCK: 0 });
  return {
    results: results.reverse(),
    summary: {
      total: results.length,
      changed: results.filter((x) => x.change !== "same").length,
      stricter: results.filter((x) => x.change === "stricter").length,
      looser: results.filter((x) => x.change === "looser").length,
      actual: count("actual"),
      simulated: count("simulated"),
    },
  };
}
