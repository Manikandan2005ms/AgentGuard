import { emptyPolicy, type Policy } from "@agentguard/shared";
import { describe, expect, it } from "vitest";
import { replayPolicy, type ReplayRow } from "../apps/api/src/core/policySimulator";

const DAY = 86_400_000;
const base = new Date("2026-10-20T12:00:00Z").getTime();
const old = new Date(base - 730 * DAY);

let n = 0;
function row(o: Partial<ReplayRow>): ReplayRow {
  n++;
  return {
    id: `r${n}`,
    createdAt: new Date(base - (10 - n) * 3600_000),
    item: "Oat Milk 1L",
    merchantDomain: "freshcart.example",
    merchantId: "m-fresh",
    merchantCreatedAt: old,
    amount: 20,
    currency: "USD",
    category: "groceries",
    decision: "APPROVE",
    injectionDetected: false,
    intentAligned: true,
    taskBound: true,
    ...o,
  };
}

describe("policy simulator (replay)", () => {
  it("reports purchases a stricter policy would now send to you", () => {
    n = 0;
    const policy: Policy = { ...emptyPolicy(), require_approval_above: 25 };
    const { results, summary } = replayPolicy(policy, [row({ amount: 10 }), row({ amount: 31 })]);
    expect(summary.stricter).toBe(1);
    expect(results.find((r) => r.amount === 31)?.simulated).toBe("ASK_HUMAN");
    expect(results.find((r) => r.amount === 10)?.change).toBe("same");
  });

  it("rebuilds budgets in time order, and blocked purchases don't use budget", () => {
    n = 0;
    const policy: Policy = { ...emptyPolicy(), budgets: [{ category: "groceries", period: "week", limit: 50 }], per_transaction_limit: 100 };
    const rows = [row({ amount: 20 }), row({ amount: 150 }), row({ amount: 20 }), row({ amount: 20 })];
    const { results } = replayPolicy(policy, rows);
    const byId = Object.fromEntries(results.map((r) => [r.id, r.simulated]));
    expect(byId.r1).toBe("APPROVE");
    expect(byId.r2).toBe("BLOCK"); // over the per-purchase limit, so it doesn't count toward the budget
    expect(byId.r3).toBe("APPROVE"); // 40 of 50
    expect(byId.r4).toBe("BLOCK"); // would make 60 of 50
  });

  it("can show where a looser policy would have let something through", () => {
    n = 0;
    const { summary } = replayPolicy(emptyPolicy(), [row({ item: "$100 Gift Card", category: "gift_cards", amount: 100, decision: "BLOCK", intentAligned: null })]);
    expect(summary.looser).toBe(1);
  });

  it("counts merchants paid before the replay window as used before", () => {
    n = 0;
    const policy: Policy = { ...emptyPolicy(), merchant_rules: { ...emptyPolicy().merchant_rules, trusted_only_categories: ["electronics"] } };
    const rows = [row({ item: "Headphones", category: "electronics", merchantId: "m-gadget", merchantDomain: "gadgethub.example" })];
    expect(replayPolicy(policy, rows).results[0]?.simulated).toBe("BLOCK");
    expect(replayPolicy(policy, rows, { merchantsPaidBefore: ["m-gadget"] }).results[0]?.simulated).toBe("APPROVE");
  });

  it("keeps the code-only safety net: unknown merchants and injection attacks stay blocked", () => {
    n = 0;
    const { results } = replayPolicy(emptyPolicy(), [
      row({ merchantId: null, merchantDomain: "nowhere.example" }),
      row({ injectionDetected: true, intentAligned: false, decision: "BLOCK" }),
    ]);
    expect(results.every((r) => r.simulated === "BLOCK")).toBe(true);
  });
});
