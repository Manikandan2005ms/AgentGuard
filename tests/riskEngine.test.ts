import type { DecisionType, RuleResult } from "@agentguard/shared";
import { describe, expect, it } from "vitest";
import { decide, decideWithBaseline, escalate, type DecideInput } from "../apps/api/src/core/decide";
import { RISK_WEIGHTS, scoreRisk, type RiskInput } from "../apps/api/src/core/riskEngine";

const baseRisk: RiskInput = {
  amount: 10,
  avgAmount: 25,
  merchantAgeDays: 730,
  merchantPaidBefore: true,
  category: "groceries",
  velocity: null,
  quietHours: false,
  injection: null,
  intent: { aligned: true },
};

const ids = (r: ReturnType<typeof scoreRisk>) => r.signals.map((s) => s.id);

describe("risk engine", () => {
  it("scores a normal grocery purchase as zero", () => {
    expect(scoreRisk(baseRisk).score).toBe(0);
  });

  it("adds each signal with the README weights", () => {
    const r = scoreRisk({ ...baseRisk, merchantAgeDays: 3, merchantPaidBefore: false });
    expect(ids(r)).toEqual(["young_merchant", "first_purchase_merchant"]);
    expect(r.score).toBe(RISK_WEIGHTS.young_merchant + RISK_WEIGHTS.first_purchase_merchant);
  });

  it("flags amount spikes over 3x the average", () => {
    expect(ids(scoreRisk({ ...baseRisk, amount: 129, avgAmount: 24.56 }))).toContain("amount_spike");
    expect(ids(scoreRisk({ ...baseRisk, amount: 70, avgAmount: 24.56 }))).not.toContain("amount_spike");
  });

  it("detects injection from a heuristic hit or LLM score >= 0.7", () => {
    expect(scoreRisk({ ...baseRisk, injection: { heuristicHit: true, llmScore: null } }).injectionDetected).toBe(true);
    expect(scoreRisk({ ...baseRisk, injection: { heuristicHit: false, llmScore: 0.75 } }).injectionDetected).toBe(true);
    expect(scoreRisk({ ...baseRisk, injection: { heuristicHit: false, llmScore: 0.5 } }).injectionDetected).toBe(false);
  });

  it("caps the score at 100", () => {
    const r = scoreRisk({
      ...baseRisk,
      amount: 1000,
      merchantAgeDays: 3,
      merchantPaidBefore: false,
      category: "gift_cards",
      quietHours: true,
      velocity: { count: 5, max: 5 },
      injection: { heuristicHit: true, llmScore: 1 },
      intent: { aligned: false },
    });
    expect(r.score).toBe(100);
  });
});

const input = (o: Partial<DecideInput> = {}): DecideInput => ({
  killSwitch: false,
  rules: [],
  score: 0,
  injectionDetected: false,
  intentAligned: true,
  aiCheckFailed: false,
  ...o,
});
const ask: RuleResult = { rule_id: "require_approval_above", outcome: "ask", detail: "over $50" };
const block: RuleResult = { rule_id: "blocked_category", outcome: "block", detail: "gift cards" };

describe("decision function (README §11.2)", () => {
  it.each<[string, Partial<DecideInput>, DecisionType]>([
    ["low risk, no rules", {}, "APPROVE"],
    ["kill switch", { killSwitch: true }, "BLOCK"],
    ["policy block", { rules: [block] }, "BLOCK"],
    ["policy ask", { rules: [ask] }, "ASK_HUMAN"],
    ["injection + intent mismatch", { injectionDetected: true, intentAligned: false, score: 0 }, "BLOCK"],
    ["injection alone", { injectionDetected: true, score: 60 }, "ASK_HUMAN"],
    ["score 70", { score: 70 }, "BLOCK"],
    ["score 35", { score: 35 }, "ASK_HUMAN"],
    ["score 34", { score: 34 }, "APPROVE"],
    ["AI check failed (fail safe)", { aiCheckFailed: true }, "ASK_HUMAN"],
  ])("%s -> %s", (_name, o, expected) => {
    expect(decide(input(o)).decision).toBe(expected);
  });

  it("escalate never relaxes", () => {
    expect(escalate("BLOCK", "APPROVE")).toBe("BLOCK");
    expect(escalate("APPROVE", "ASK_HUMAN")).toBe("ASK_HUMAN");
  });

  it("AI signals can raise but never lower the baseline decision", () => {
    const baseline = input({ rules: [block] });
    // A fooled AI that reports "aligned, no injection, zero risk" cannot unblock it.
    const fooled = input({ rules: [block], score: 0, intentAligned: true, injectionDetected: false });
    expect(decideWithBaseline(baseline, fooled).decision).toBe("BLOCK");

    // Even if the full input somehow lost the rule, the baseline still wins.
    expect(decideWithBaseline(baseline, input()).decision).toBe("BLOCK");

    // And AI can escalate an approve into a block.
    expect(decideWithBaseline(input(), input({ injectionDetected: true, intentAligned: false })).decision).toBe("BLOCK");
  });

  it("is monotonic: adding risk never improves the decision", () => {
    const rank = { APPROVE: 0, ASK_HUMAN: 1, BLOCK: 2 } as const;
    for (let score = 0; score <= 100; score += 5) {
      const a = decide(input({ score })).decision;
      const b = decide(input({ score: Math.min(100, score + 5) })).decision;
      expect(rank[b]).toBeGreaterThanOrEqual(rank[a]);
    }
  });
});
