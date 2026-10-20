import type { Category, Period, Policy, RuleOutcome, RuleResult } from "@agentguard/shared";
import { CATEGORY_LABELS } from "@agentguard/shared";
import { domainMatches } from "./domain";

/**
 * Deterministic policy engine. Plain code, no AI: every rule returns
 * { rule_id, outcome: pass | ask | block, detail } (README §10).
 */

export interface PolicyPurchase {
  item: string;
  category: Category;
  amount: number;
  currency: string;
  merchantDomain: string;
  merchantAgeDays: number | null;
}

export interface PolicyHistory {
  merchantPaidBefore: boolean;
  /** Payments (paid or held) inside the policy's velocity window. */
  txInVelocityWindow: number;
  /** Spend (paid + held) for a budget category ("*" = all) in the current period. */
  spent: (category: Category | "*", period: Period) => number;
}

export interface PolicyContext {
  policy: Policy;
  purchase: PolicyPurchase;
  history: PolicyHistory;
  now: Date;
}

const OUTCOME_RANK: Record<RuleOutcome, number> = { pass: 0, ask: 1, block: 2 };

export function worstOutcome(results: RuleResult[]): RuleOutcome {
  return results.reduce<RuleOutcome>(
    (acc, r) => (OUTCOME_RANK[r.outcome] > OUTCOME_RANK[acc] ? r.outcome : acc),
    "pass",
  );
}

/** Merge two evaluations of the same rules, keeping the stricter outcome per rule_id. */
export function mergeStrictest(a: RuleResult[], b: RuleResult[]): RuleResult[] {
  const byId = new Map<string, RuleResult>();
  for (const r of [...a, ...b]) {
    const prev = byId.get(r.rule_id);
    if (!prev || OUTCOME_RANK[r.outcome] > OUTCOME_RANK[prev.outcome]) byId.set(r.rule_id, r);
  }
  return [...byId.values()];
}

const fmt = (n: number, currency: string) => `${currency === "USD" ? "$" : `${currency} `}${n.toFixed(2)}`;

export function evaluatePolicy(ctx: PolicyContext): RuleResult[] {
  const { policy: p, purchase: x, history: h } = ctx;
  const out: RuleResult[] = [];
  const money = (n: number) => fmt(n, p.currency);
  const label = CATEGORY_LABELS[x.category];
  const mr = p.merchant_rules;
  const allowlisted = mr.allowlist.some((e) => domainMatches(x.merchantDomain, e));

  // Currency
  if (x.currency.toUpperCase() !== p.currency.toUpperCase()) {
    out.push({
      rule_id: "currency",
      outcome: "ask",
      detail: `Request is in ${x.currency}; your policy limits are in ${p.currency}.`,
    });
  }

  // Per-transaction limit
  if (p.per_transaction_limit != null) {
    const over = x.amount > p.per_transaction_limit;
    out.push({
      rule_id: "per_transaction_limit",
      outcome: over ? "block" : "pass",
      detail: over
        ? `${money(x.amount)} is over your ${money(p.per_transaction_limit)} per-purchase limit.`
        : `${money(x.amount)} is within your ${money(p.per_transaction_limit)} per-purchase limit.`,
    });
  }

  // Approval threshold
  if (p.require_approval_above != null) {
    const over = x.amount > p.require_approval_above;
    out.push({
      rule_id: "require_approval_above",
      outcome: over ? "ask" : "pass",
      detail: over
        ? `${money(x.amount)} is over ${money(p.require_approval_above)}, so you asked to approve it.`
        : `${money(x.amount)} is under your ${money(p.require_approval_above)} approval threshold.`,
    });
  }

  // Blocked categories
  if (p.blocked_categories.length) {
    const blocked = p.blocked_categories.includes(x.category);
    out.push({
      rule_id: "blocked_category",
      outcome: blocked ? "block" : "pass",
      detail: blocked ? `Your policy never allows ${label}.` : `${capitalize(label)} is an allowed category.`,
    });
  }

  // Budgets
  for (const b of p.budgets) {
    if (b.category !== "*" && b.category !== x.category) continue;
    const spent = h.spent(b.category, b.period);
    const after = spent + x.amount;
    const scope = b.category === "*" ? "total" : CATEGORY_LABELS[b.category];
    const over = after > b.limit + 1e-9;
    out.push({
      rule_id: `budget:${b.category}:${b.period}`,
      outcome: over ? "block" : "pass",
      detail: over
        ? `Would exceed your ${b.period}ly ${scope} budget: ${money(spent)} spent + ${money(x.amount)} > ${money(b.limit)}.`
        : `${money(after)} of your ${money(b.limit)} ${b.period}ly ${scope} budget after this purchase.`,
    });
  }

  // Merchant blocklist
  if (mr.blocklist.length) {
    const hit = mr.blocklist.find((e) => domainMatches(x.merchantDomain, e));
    out.push({
      rule_id: "merchant_blocklist",
      outcome: hit ? "block" : "pass",
      detail: hit ? `${x.merchantDomain} is on your blocked-merchant list.` : `${x.merchantDomain} is not blocklisted.`,
    });
  }

  // Merchant age (allowlisted merchants skip it)
  if (mr.min_merchant_age_days != null && !allowlisted) {
    if (x.merchantAgeDays == null) {
      out.push({
        rule_id: "merchant_min_age",
        outcome: "ask",
        detail: `The age of ${x.merchantDomain} is unknown; your policy requires ${mr.min_merchant_age_days}+ days.`,
      });
    } else {
      const young = x.merchantAgeDays < mr.min_merchant_age_days;
      out.push({
        rule_id: "merchant_min_age",
        outcome: young ? "block" : "pass",
        detail: young
          ? `${x.merchantDomain} is only ${x.merchantAgeDays} days old; your minimum is ${mr.min_merchant_age_days} days.`
          : `${x.merchantDomain} is ${x.merchantAgeDays} days old.`,
      });
    }
  }

  // New merchant needs approval
  if (mr.new_merchant_requires_approval && !allowlisted) {
    out.push({
      rule_id: "new_merchant",
      outcome: h.merchantPaidBefore ? "pass" : "ask",
      detail: h.merchantPaidBefore
        ? `You have paid ${x.merchantDomain} before.`
        : `First purchase from ${x.merchantDomain}.`,
    });
  }

  // Category only from merchants used before
  if (mr.trusted_only_categories.includes(x.category)) {
    const ok = h.merchantPaidBefore || allowlisted;
    out.push({
      rule_id: "trusted_only_category",
      outcome: ok ? "pass" : "block",
      detail: ok
        ? `${capitalize(label)} from a merchant you've used before.`
        : `Your policy only allows ${label} from merchants you've paid before.`,
    });
  }

  // Velocity
  if (p.velocity) {
    const count = h.txInVelocityWindow + 1;
    const over = count > p.velocity.max_transactions;
    out.push({
      rule_id: "velocity",
      outcome: over ? "block" : "pass",
      detail: over
        ? `This would be purchase #${count} in ${p.velocity.window_minutes} minutes (limit ${p.velocity.max_transactions}).`
        : `Purchase #${count} of ${p.velocity.max_transactions} allowed in ${p.velocity.window_minutes} minutes.`,
    });
  }

  // Quiet hours
  const q = p.time_rules.quiet_hours;
  if (q) {
    const quiet = inQuietHours(ctx.now, q.start, q.end, p.timezone);
    out.push({
      rule_id: "quiet_hours",
      outcome: quiet ? q.action : "pass",
      detail: quiet ? `It is inside your quiet hours (${q.start}–${q.end}).` : "Outside quiet hours.",
    });
  }

  return out;
}

/** Local "HH:MM" of `now` in an IANA timezone (falls back to UTC on a bad zone). */
export function localTime(now: Date, timezone: string): string {
  const opts: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", hourCycle: "h23" };
  try {
    return new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: timezone }).format(now);
  } catch {
    return new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: "UTC" }).format(now);
  }
}

export function inQuietHours(now: Date, start: string, end: string, timezone: string): boolean {
  const t = localTime(now, timezone);
  if (start === end) return false;
  return start < end ? t >= start && t < end : t >= start || t < end;
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
