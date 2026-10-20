import type { Category, RiskSignal } from "@agentguard/shared";
import { CATEGORY_LABELS, HIGH_RISK_CATEGORIES } from "@agentguard/shared";

/** Signal weights from README §11.1 ("start here, tune later"). */
export const RISK_WEIGHTS = {
  injection: 60,
  intent_mismatch: 40,
  young_merchant: 25,
  first_purchase_merchant: 10,
  amount_spike: 20,
  velocity: 15,
  high_risk_category: 20,
  quiet_hours: 10,
} as const;

export const YOUNG_MERCHANT_DAYS = 30;
export const AMOUNT_SPIKE_MULTIPLIER = 3;
export const INJECTION_LLM_THRESHOLD = 0.7;

export interface RiskInput {
  /** Deterministic facts */
  amount: number;
  avgAmount: number | null;
  merchantAgeDays: number | null;
  merchantPaidBefore: boolean;
  category: Category;
  velocity: { count: number; max: number } | null;
  quietHours: boolean;
  /** AI / heuristic checks (null = check did not run) */
  injection: { heuristicHit: boolean; llmScore: number | null } | null;
  intent: { aligned: boolean | null; reason?: string } | null;
}

export interface RiskResult {
  score: number;
  signals: RiskSignal[];
  injectionDetected: boolean;
}

export function scoreRisk(input: RiskInput): RiskResult {
  const signals: RiskSignal[] = [];
  const add = (id: keyof typeof RISK_WEIGHTS, detail: string, source: RiskSignal["source"]) =>
    signals.push({ id, points: RISK_WEIGHTS[id], detail, source });

  const injectionDetected =
    !!input.injection &&
    (input.injection.heuristicHit || (input.injection.llmScore ?? 0) >= INJECTION_LLM_THRESHOLD);
  if (injectionDetected) {
    add("injection", "The page the agent read contains instructions aimed at AI agents (possible prompt injection).", "ai");
  }

  if (input.intent?.aligned === false) {
    add("intent_mismatch", input.intent.reason ?? "This purchase does not match the task you gave the agent.", "ai");
  }

  if (input.merchantAgeDays != null && input.merchantAgeDays < YOUNG_MERCHANT_DAYS) {
    add("young_merchant", `Merchant is only ${input.merchantAgeDays} days old.`, "deterministic");
  }

  if (!input.merchantPaidBefore) {
    add("first_purchase_merchant", "First purchase from this merchant.", "deterministic");
  }

  if (input.avgAmount != null && input.avgAmount > 0 && input.amount > AMOUNT_SPIKE_MULTIPLIER * input.avgAmount) {
    add(
      "amount_spike",
      `$${input.amount.toFixed(2)} is more than ${AMOUNT_SPIKE_MULTIPLIER}x your average purchase ($${input.avgAmount.toFixed(2)}).`,
      "deterministic",
    );
  }

  if (input.velocity && input.velocity.count >= Math.max(1, Math.ceil(input.velocity.max * 0.8))) {
    add("velocity", `Purchase #${input.velocity.count} in the velocity window (limit ${input.velocity.max}).`, "deterministic");
  }

  if (HIGH_RISK_CATEGORIES.includes(input.category)) {
    add("high_risk_category", `${CATEGORY_LABELS[input.category]} are a common fraud target.`, "deterministic");
  }

  if (input.quietHours) {
    add("quiet_hours", "Requested during your quiet hours.", "deterministic");
  }

  const score = Math.min(100, signals.reduce((s, x) => s + x.points, 0));
  return { score, signals, injectionDetected };
}
