import { z } from "zod";
import { CATEGORY_LABELS, CategorySchema, type Category } from "./categories";

const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:MM (24h)");

export const PeriodSchema = z.enum(["day", "week", "month"]);
export type Period = z.infer<typeof PeriodSchema>;

export const BudgetSchema = z
  .object({
    category: z.union([CategorySchema, z.literal("*")]),
    period: PeriodSchema,
    limit: z.number().positive(),
  })
  .strict();

export const MerchantRulesSchema = z
  .object({
    min_merchant_age_days: z.number().int().min(0).nullable(),
    allowlist: z.array(z.string()),
    blocklist: z.array(z.string()),
    new_merchant_requires_approval: z.boolean(),
    /** Categories that may only be bought from merchants the user has paid before. */
    trusted_only_categories: z.array(CategorySchema),
  })
  .strict();

export const VelocitySchema = z
  .object({
    max_transactions: z.number().int().positive(),
    window_minutes: z.number().int().positive(),
  })
  .strict();

export const QuietHoursSchema = z
  .object({
    start: HHMM,
    end: HHMM,
    action: z.enum(["ask", "block"]),
  })
  .strict();

/**
 * The enforceable policy (README §10). `.strict()` everywhere: an AI-compiled policy
 * with an invented field fails validation instead of being silently accepted.
 */
export const PolicySchema = z
  .object({
    version: z.literal(1),
    currency: z.string().length(3),
    timezone: z.string().min(1),
    per_transaction_limit: z.number().positive().nullable(),
    require_approval_above: z.number().min(0).nullable(),
    budgets: z.array(BudgetSchema),
    blocked_categories: z.array(CategorySchema),
    merchant_rules: MerchantRulesSchema,
    velocity: VelocitySchema.nullable(),
    time_rules: z.object({ quiet_hours: QuietHoursSchema.nullable() }).strict(),
    approval_timeout_minutes: z.number().int().positive(),
    clarifications: z.array(z.string()),
  })
  .strict();

export type Policy = z.infer<typeof PolicySchema>;
export type Budget = z.infer<typeof BudgetSchema>;

/** A policy with no limits at all - the starting point for the compilers. */
export function emptyPolicy(): Policy {
  return {
    version: 1,
    currency: "USD",
    timezone: "UTC",
    per_transaction_limit: null,
    require_approval_above: null,
    budgets: [],
    blocked_categories: [],
    merchant_rules: {
      min_merchant_age_days: null,
      allowlist: [],
      blocklist: [],
      new_merchant_requires_approval: false,
      trusted_only_categories: [],
    },
    velocity: null,
    time_rules: { quiet_hours: null },
    approval_timeout_minutes: 15,
    clarifications: [],
  };
}

const money = (n: number, currency: string) =>
  `${currency === "USD" ? "$" : `${currency} `}${Number.isInteger(n) ? n : n.toFixed(2)}`;

const catList = (cats: readonly (Category | "*")[]) =>
  cats.map((c) => (c === "*" ? "everything" : CATEGORY_LABELS[c])).join(", ");

/**
 * Deterministic plain-English rendering of a compiled policy. It is generated from the JSON
 * itself, so what the user confirms is always exactly what the engine enforces.
 */
export function describePolicy(p: Policy): string[] {
  const lines: string[] = [];
  const m = (n: number) => money(n, p.currency);
  if (p.per_transaction_limit != null) lines.push(`Any single purchase over ${m(p.per_transaction_limit)} is blocked.`);
  if (p.require_approval_above != null) lines.push(`Purchases over ${m(p.require_approval_above)} need your approval first.`);
  for (const b of p.budgets) {
    lines.push(
      b.category === "*"
        ? `Total budget: ${m(b.limit)} per ${b.period} across all categories.`
        : `Budget: ${m(b.limit)} per ${b.period} on ${CATEGORY_LABELS[b.category]}.`,
    );
  }
  if (p.blocked_categories.length) lines.push(`Never buy: ${catList(p.blocked_categories)}.`);
  const mr = p.merchant_rules;
  if (mr.min_merchant_age_days != null) lines.push(`Merchants younger than ${mr.min_merchant_age_days} days are blocked.`);
  if (mr.blocklist.length) lines.push(`Blocked merchants: ${mr.blocklist.join(", ")}.`);
  if (mr.allowlist.length) lines.push(`Trusted merchants (skip the age and new-merchant checks): ${mr.allowlist.join(", ")}.`);
  if (mr.new_merchant_requires_approval) lines.push("The first purchase from any new merchant needs your approval.");
  if (mr.trusted_only_categories.length)
    lines.push(`${capitalize(catList(mr.trusted_only_categories))} only from merchants you've paid before.`);
  if (p.velocity) lines.push(`At most ${p.velocity.max_transactions} purchases per ${p.velocity.window_minutes} minutes.`);
  const q = p.time_rules.quiet_hours;
  if (q) lines.push(`Quiet hours ${q.start}–${q.end} (${p.timezone}): ${q.action === "block" ? "purchases are blocked" : "ask you first"}.`);
  if (lines.length === 0) lines.push("No limits: purchases are auto-approved unless risk signals fire.");
  lines.push(`Approval requests you don't answer are cancelled after ${p.approval_timeout_minutes} minutes.`);
  return lines;
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
