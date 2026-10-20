import type { DecisionType, RiskSignal, RuleResult } from "@agentguard/shared";
import { z } from "zod";
import { structured } from "./llm";

/** README §9.5: one short human sentence for Telegram, the agent and the audit log. */

export interface ExplainInput {
  decision: DecisionType;
  item: string;
  merchant: string;
  amount: number;
  currency: string;
  riskScore: number;
  reasons: string[];
  rules: RuleResult[];
  signals: RiskSignal[];
  injectionTechniques: string[];
}

const ExplanationSchema = z.object({ sentence: z.string() });

const SYSTEM = `You write the one-sentence explanation a person sees when their AI agent's payment is approved, held for their approval, or blocked by their spending firewall.
Start with "Approved:", "Needs your OK:" or "Blocked:" to match the decision. Mention the one or two most important reasons in plain language. No more than 30 words. Do not add facts that are not in the input.`;

export function templateExplanation(x: ExplainInput): string {
  const money = `${x.currency === "USD" ? "$" : `${x.currency} `}${x.amount.toFixed(2)}`;
  const top = x.reasons.slice(0, 2).join(" ");
  const injection = x.injectionTechniques.length ? " The product page contained hidden instructions aimed at AI agents." : "";
  switch (x.decision) {
    case "APPROVE":
      return `Approved: ${money} for ${x.item} at ${x.merchant} is within your policy (risk ${x.riskScore}/100).`;
    case "ASK_HUMAN":
      return `Needs your OK: ${top}${injection}`.trim();
    case "BLOCK":
      return `Blocked: ${top}${injection}`.trim();
  }
}

export async function explainDecision(x: ExplainInput): Promise<{ text: string; engine: "llm" | "template" }> {
  const fallback = templateExplanation(x);
  const facts = {
    decision: x.decision,
    item: x.item,
    merchant: x.merchant,
    amount: `${x.amount.toFixed(2)} ${x.currency}`,
    risk_score: x.riskScore,
    reasons: x.reasons,
    policy_rules_triggered: x.rules.filter((r) => r.outcome !== "pass").map((r) => r.detail),
    risk_signals: x.signals.map((s) => s.detail),
    prompt_injection_found: x.injectionTechniques.length > 0,
  };
  const res = await structured({
    name: "explain",
    schema: ExplanationSchema,
    tier: "fast",
    system: SYSTEM,
    user: JSON.stringify(facts, null, 2),
  });
  if (!res.ok || !res.data.sentence.trim()) return { text: fallback, engine: "template" };
  const prefix = x.decision === "APPROVE" ? "Approved:" : x.decision === "BLOCK" ? "Blocked:" : "Needs your OK:";
  const text = res.data.sentence.trim();
  // The decision itself is never taken from the model; force the prefix to match it.
  return { text: text.startsWith(prefix) ? text : `${prefix} ${text.replace(/^(Approved|Blocked|Needs your OK):\s*/i, "")}`, engine: "llm" };
}
