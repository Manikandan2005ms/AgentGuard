import type { DecisionType, RuleResult } from "@agentguard/shared";

export const BLOCK_SCORE = 70;
export const ASK_SCORE = 35;

const RANK: Record<DecisionType, number> = { APPROVE: 0, ASK_HUMAN: 1, BLOCK: 2 };

/** The stricter of two decisions. Used to guarantee AI can only escalate. */
export function escalate(a: DecisionType, b: DecisionType): DecisionType {
  return RANK[a] >= RANK[b] ? a : b;
}

export interface DecideInput {
  killSwitch: boolean;
  rules: RuleResult[];
  score: number;
  injectionDetected: boolean;
  /** false = mismatch, null = unknown / not checked */
  intentAligned: boolean | null;
  /** An AI check failed validation twice: fail safe to ASK_HUMAN (README §9). */
  aiCheckFailed: boolean;
}

export interface DecideResult {
  decision: DecisionType;
  reasons: string[];
}

/** README §11.2 decision function. Pure and monotonic in every risk input. */
export function decide(input: DecideInput): DecideResult {
  if (input.killSwitch) return { decision: "BLOCK", reasons: ["Kill switch is on: all agent spending is frozen."] };

  const blocks = input.rules.filter((r) => r.outcome === "block");
  if (blocks.length) return { decision: "BLOCK", reasons: blocks.map((r) => r.detail) };

  if (input.injectionDetected && input.intentAligned === false) {
    return {
      decision: "BLOCK",
      reasons: ["Attack pattern: hidden instructions on the page plus a purchase that doesn't match your task."],
    };
  }

  if (input.score >= BLOCK_SCORE) return { decision: "BLOCK", reasons: [`Risk score ${input.score} ≥ ${BLOCK_SCORE}.`] };

  const asks = input.rules.filter((r) => r.outcome === "ask");
  const reasons: string[] = asks.map((r) => r.detail);
  if (input.score >= ASK_SCORE) reasons.push(`Risk score ${input.score} ≥ ${ASK_SCORE}.`);
  if (input.aiCheckFailed) reasons.push("An AI safety check could not complete, so a human must decide.");
  if (reasons.length) return { decision: "ASK_HUMAN", reasons };

  return { decision: "APPROVE", reasons: ["Within policy and low risk."] };
}

/**
 * Two-pass decision: a baseline from deterministic facts only, then the full decision with AI
 * signals. The final result is the stricter of the two, so a fooled or failing AI check can
 * never turn a BLOCK or ASK into an APPROVE.
 */
export function decideWithBaseline(
  baseline: DecideInput,
  full: DecideInput,
): DecideResult & { baseline: DecisionType } {
  const base = decide(baseline);
  const withAi = decide(full);
  const decision = escalate(base.decision, withAi.decision);
  return { decision, reasons: decision === withAi.decision ? withAi.reasons : base.reasons, baseline: base.decision };
}
