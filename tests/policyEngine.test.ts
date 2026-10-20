import { emptyPolicy, type Policy } from "@agentguard/shared";
import { describe, expect, it } from "vitest";
import { evaluatePolicy, inQuietHours, mergeStrictest, worstOutcome, type PolicyContext } from "../apps/api/src/core/policyEngine";

function policy(overrides: Partial<Policy> = {}): Policy {
  return { ...emptyPolicy(), ...overrides };
}

function ctx(p: Policy, purchase: Partial<PolicyContext["purchase"]> = {}, history: Partial<PolicyContext["history"]> = {}): PolicyContext {
  return {
    policy: p,
    purchase: {
      item: "Oat Milk 1L",
      category: "groceries",
      amount: 10,
      currency: "USD",
      merchantDomain: "freshcart.example",
      merchantAgeDays: 730,
      ...purchase,
    },
    history: { merchantPaidBefore: true, txInVelocityWindow: 0, spent: () => 0, ...history },
    now: new Date("2026-10-20T12:00:00Z"),
  };
}

const rule = (results: ReturnType<typeof evaluatePolicy>, id: string) => results.find((r) => r.rule_id === id);

describe("policy engine", () => {
  it("passes everything under an empty policy", () => {
    expect(worstOutcome(evaluatePolicy(ctx(emptyPolicy())))).toBe("pass");
  });

  it("blocks over the per-transaction limit", () => {
    const r = evaluatePolicy(ctx(policy({ per_transaction_limit: 200 }), { amount: 250 }));
    expect(rule(r, "per_transaction_limit")?.outcome).toBe("block");
    expect(rule(evaluatePolicy(ctx(policy({ per_transaction_limit: 200 }), { amount: 200 })), "per_transaction_limit")?.outcome).toBe("pass");
  });

  it("asks above the approval threshold", () => {
    const r = evaluatePolicy(ctx(policy({ require_approval_above: 50 }), { amount: 129, category: "electronics" }));
    expect(rule(r, "require_approval_above")?.outcome).toBe("ask");
    expect(worstOutcome(r)).toBe("ask");
  });

  it("blocks banned categories", () => {
    const r = evaluatePolicy(ctx(policy({ blocked_categories: ["gift_cards"] }), { category: "gift_cards", item: "$100 Gift Card" }));
    expect(rule(r, "blocked_category")?.outcome).toBe("block");
  });

  it("blocks when a budget would be exceeded and only applies matching categories", () => {
    const p = policy({ budgets: [{ category: "groceries", period: "week", limit: 150 }] });
    const spent = () => 145;
    expect(rule(evaluatePolicy(ctx(p, { amount: 10 }, { spent })), "budget:groceries:week")?.outcome).toBe("block");
    expect(rule(evaluatePolicy(ctx(p, { amount: 5 }, { spent })), "budget:groceries:week")?.outcome).toBe("pass");
    expect(rule(evaluatePolicy(ctx(p, { category: "electronics" }, { spent })), "budget:groceries:week")).toBeUndefined();
  });

  it("applies the '*' budget to every category", () => {
    const p = policy({ budgets: [{ category: "*", period: "month", limit: 600 }] });
    const r = evaluatePolicy(ctx(p, { category: "electronics", amount: 100 }, { spent: () => 550 }));
    expect(rule(r, "budget:*:month")?.outcome).toBe("block");
  });

  it("blocks young merchants unless allowlisted", () => {
    const mr = { ...emptyPolicy().merchant_rules, min_merchant_age_days: 30 };
    expect(rule(evaluatePolicy(ctx(policy({ merchant_rules: mr }), { merchantAgeDays: 3, merchantDomain: "megadealz.example" })), "merchant_min_age")?.outcome).toBe("block");
    const allow = { ...mr, allowlist: ["megadealz.example"] };
    expect(rule(evaluatePolicy(ctx(policy({ merchant_rules: allow }), { merchantAgeDays: 3, merchantDomain: "megadealz.example" })), "merchant_min_age")).toBeUndefined();
  });

  it("matches blocklisted domains including subdomains", () => {
    const mr = { ...emptyPolicy().merchant_rules, blocklist: ["megadealz.example"] };
    const r = evaluatePolicy(ctx(policy({ merchant_rules: mr }), { merchantDomain: "shop.megadealz.example" }));
    expect(rule(r, "merchant_blocklist")?.outcome).toBe("block");
  });

  it("asks on the first purchase from a new merchant when configured", () => {
    const mr = { ...emptyPolicy().merchant_rules, new_merchant_requires_approval: true };
    expect(rule(evaluatePolicy(ctx(policy({ merchant_rules: mr }), {}, { merchantPaidBefore: false })), "new_merchant")?.outcome).toBe("ask");
    expect(rule(evaluatePolicy(ctx(policy({ merchant_rules: mr }), {}, { merchantPaidBefore: true })), "new_merchant")?.outcome).toBe("pass");
  });

  it("enforces 'electronics only from stores I've used before'", () => {
    const mr = { ...emptyPolicy().merchant_rules, trusted_only_categories: ["electronics" as const] };
    const p = policy({ merchant_rules: mr });
    expect(rule(evaluatePolicy(ctx(p, { category: "electronics" }, { merchantPaidBefore: false })), "trusted_only_category")?.outcome).toBe("block");
    expect(rule(evaluatePolicy(ctx(p, { category: "electronics" }, { merchantPaidBefore: true })), "trusted_only_category")?.outcome).toBe("pass");
  });

  it("blocks past the velocity limit", () => {
    const p = policy({ velocity: { max_transactions: 5, window_minutes: 60 } });
    expect(rule(evaluatePolicy(ctx(p, {}, { txInVelocityWindow: 5 })), "velocity")?.outcome).toBe("block");
    expect(rule(evaluatePolicy(ctx(p, {}, { txInVelocityWindow: 4 })), "velocity")?.outcome).toBe("pass");
  });

  it("handles quiet hours across midnight and timezones", () => {
    expect(inQuietHours(new Date("2026-10-20T23:30:00Z"), "23:00", "07:00", "UTC")).toBe(true);
    expect(inQuietHours(new Date("2026-10-20T06:59:00Z"), "23:00", "07:00", "UTC")).toBe(true);
    expect(inQuietHours(new Date("2026-10-20T12:00:00Z"), "23:00", "07:00", "UTC")).toBe(false);
    // 18:00 UTC is 23:30 in India (UTC+5:30)
    expect(inQuietHours(new Date("2026-10-20T18:00:00Z"), "23:00", "07:00", "Asia/Kolkata")).toBe(true);
    const p = policy({ time_rules: { quiet_hours: { start: "11:00", end: "13:00", action: "ask" } } });
    expect(rule(evaluatePolicy(ctx(p)), "quiet_hours")?.outcome).toBe("ask");
  });

  it("asks when the currency differs from the policy currency", () => {
    expect(rule(evaluatePolicy(ctx(emptyPolicy(), { currency: "EUR" })), "currency")?.outcome).toBe("ask");
  });

  it("mergeStrictest keeps the stricter outcome per rule", () => {
    const merged = mergeStrictest(
      [{ rule_id: "blocked_category", outcome: "pass", detail: "a" }],
      [{ rule_id: "blocked_category", outcome: "block", detail: "b" }],
    );
    expect(merged).toEqual([{ rule_id: "blocked_category", outcome: "block", detail: "b" }]);
  });
});
