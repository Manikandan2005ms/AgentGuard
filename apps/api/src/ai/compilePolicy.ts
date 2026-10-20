import { CATEGORIES, PolicySchema, describePolicy, type Policy } from "@agentguard/shared";
import { z } from "zod";
import { compilePolicyWithRules } from "../core/ruleCompiler";
import { structured } from "./llm";

/** README §9.1: plain English -> validated policy JSON + back-translation. */

const Cat = z.enum(CATEGORIES);

// Loose shape for the model to fill; PolicySchema (strict, with constraints) is the real gate.
const PolicyDraft = z.object({
  version: z.literal(1),
  currency: z.string(),
  timezone: z.string(),
  per_transaction_limit: z.number().nullable(),
  require_approval_above: z.number().nullable(),
  budgets: z.array(z.object({ category: z.union([Cat, z.literal("*")]), period: z.enum(["day", "week", "month"]), limit: z.number() })),
  blocked_categories: z.array(Cat),
  merchant_rules: z.object({
    min_merchant_age_days: z.number().nullable(),
    allowlist: z.array(z.string()),
    blocklist: z.array(z.string()),
    new_merchant_requires_approval: z.boolean(),
    trusted_only_categories: z.array(Cat),
  }),
  velocity: z.object({ max_transactions: z.number(), window_minutes: z.number() }).nullable(),
  time_rules: z.object({
    quiet_hours: z.object({ start: z.string(), end: z.string(), action: z.enum(["ask", "block"]) }).nullable(),
  }),
  approval_timeout_minutes: z.number(),
  clarifications: z.array(z.string()),
});

const SYSTEM = `You convert a person's plain-English spending rules for their AI shopping agent into a JSON policy that matches the given schema exactly.

Field meanings:
- per_transaction_limit: hard cap for any single purchase (above it the payment is blocked).
- require_approval_above: purchases above this amount need the person's approval.
- budgets: spending limits per period. category "*" means all categories combined.
- blocked_categories: categories that must never be bought.
- merchant_rules.min_merchant_age_days: merchants younger than this are blocked.
- merchant_rules.allowlist / blocklist: merchant domains (e.g. "freshcart.example").
- merchant_rules.new_merchant_requires_approval: the first purchase from a merchant needs approval.
- merchant_rules.trusted_only_categories: categories that may only be bought from merchants the person has paid before.
- velocity: at most max_transactions purchases per window_minutes.
- time_rules.quiet_hours: 24h "HH:MM" start/end and whether to "ask" or "block".
- approval_timeout_minutes: how long an approval request waits before it is cancelled (default 15).

Rules for you:
- Only encode rules the person actually stated. Leave limits null and lists empty otherwise. Never invent rules or fields.
- Allowed categories: ${CATEGORIES.join(", ")}. Map synonyms (e.g. "food shopping" -> groceries, "gadgets" -> electronics).
- Default currency "USD" and timezone "UTC" unless the person states otherwise.
- If a rule is ambiguous or cannot be expressed with these fields, do not guess: write a short question about it in "clarifications".`;

export interface CompiledPolicy {
  policy: Policy;
  summary: string[];
  clarifications: string[];
  engine: "llm" | "rules";
  warning?: string;
}

export async function compilePolicy(rawText: string): Promise<CompiledPolicy> {
  const res = await structured({
    name: "compilePolicy",
    schema: PolicyDraft,
    tier: "main",
    effort: "high",
    system: SYSTEM,
    user: `<spending_rules>\n${rawText}\n</spending_rules>`,
  });

  if (res.ok) {
    const valid = PolicySchema.safeParse(res.data);
    if (valid.success) {
      return { policy: valid.data, summary: describePolicy(valid.data), clarifications: valid.data.clarifications, engine: "llm" };
    }
    const fallback = compilePolicyWithRules(rawText);
    return {
      policy: fallback.policy,
      summary: describePolicy(fallback.policy),
      clarifications: fallback.clarifications,
      engine: "rules",
      warning: `The AI compiler's output failed schema validation (${valid.error.issues[0]?.message}); used the rule-based compiler instead.`,
    };
  }

  const fallback = compilePolicyWithRules(rawText);
  return {
    policy: fallback.policy,
    summary: describePolicy(fallback.policy),
    clarifications: fallback.clarifications,
    engine: "rules",
    warning: res.error === "LLM disabled" ? undefined : `AI compiler unavailable (${res.error}); used the rule-based compiler.`,
  };
}
