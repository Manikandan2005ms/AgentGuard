import { PolicySchema, describePolicy } from "@agentguard/shared";
import { describe, expect, it } from "vitest";
import { categorizeByKeywords, resolveCategory } from "../apps/api/src/core/categoryRules";
import { heuristicIntent } from "../apps/api/src/core/intentHeuristic";
import { compilePolicyWithRules } from "../apps/api/src/core/ruleCompiler";

describe("rule-based policy compiler", () => {
  const text =
    "Max $150 a week on groceries. Never spend more than $200 on a single purchase. Never buy gift cards, crypto or gambling. " +
    "Ask me before anything over $50. Don't pay merchants younger than 30 days. Electronics only from stores I’ve used before. " +
    "No more than 5 purchases per hour.";
  const { policy, clarifications } = compilePolicyWithRules(text);

  it("produces a schema-valid policy", () => {
    expect(PolicySchema.safeParse(policy).success).toBe(true);
    expect(clarifications).toEqual([]);
  });

  it("understands each sentence of the README example", () => {
    expect(policy.budgets).toEqual([{ category: "groceries", period: "week", limit: 150 }]);
    expect(policy.per_transaction_limit).toBe(200);
    expect(policy.blocked_categories).toEqual(["gift_cards", "crypto", "gambling"]);
    expect(policy.require_approval_above).toBe(50);
    expect(policy.merchant_rules.min_merchant_age_days).toBe(30);
    expect(policy.merchant_rules.trusted_only_categories).toEqual(["electronics"]);
    expect(policy.velocity).toEqual({ max_transactions: 5, window_minutes: 60 });
  });

  it("reports what it can't understand instead of guessing", () => {
    const r = compilePolicyWithRules("Only buy things my mum would like.");
    expect(r.clarifications).toHaveLength(1);
    expect(r.policy.blocked_categories).toEqual([]);
  });

  it("parses quiet hours and monthly totals", () => {
    const r = compilePolicyWithRules("Spend at most $600 per month. Ask me for anything between 11pm and 7am.");
    expect(r.policy.budgets).toEqual([{ category: "*", period: "month", limit: 600 }]);
    expect(r.policy.time_rules.quiet_hours).toEqual({ start: "23:00", end: "07:00", action: "ask" });
  });

  it("back-translates deterministically from the JSON", () => {
    const lines = describePolicy(policy);
    expect(lines.join(" ")).toContain("$150 per week on groceries");
    expect(lines.join(" ")).toContain("Never buy: gift cards, crypto, gambling");
  });
});

describe("categorizer and intent heuristics", () => {
  it("categorizes demo items", () => {
    expect(categorizeByKeywords("Oat Milk 1L")).toBe("groceries");
    expect(categorizeByKeywords('$100 Digital Gift Card (SKU GC-100)')).toBe("gift_cards");
    expect(categorizeByKeywords("NoiseAway Pro Wireless Headphones")).toBe("electronics");
    expect(categorizeByKeywords("Mystery box", "groceries")).toBe("groceries");
  });

  it("never lets the LLM relax a high-risk category", () => {
    expect(resolveCategory("gift_cards", "groceries")).toBe("gift_cards");
    expect(resolveCategory("groceries", "gift_cards")).toBe("gift_cards");
    expect(resolveCategory("other", "home")).toBe("home");
  });

  it("flags gift cards during a grocery task", () => {
    const task = "Buy oat milk and the cheapest bread you can find";
    expect(heuristicIntent(task, "$100 Digital Gift Card", "gift_cards").aligned).toBe(false);
    expect(heuristicIntent(task, "Oat Milk 1L", "groceries").aligned).toBe(true);
    expect(heuristicIntent(task, "Classic White Bread", "groceries").aligned).toBe(true);
    expect(heuristicIntent(task, "NoiseAway Pro Headphones", "electronics").aligned).toBe(false);
  });

  it("catches goal drift within the same category", () => {
    const task = "Buy wireless headphones";
    expect(heuristicIntent(task, "NoiseAway Pro Wireless Headphones", "electronics").aligned).toBe(true);
    expect(heuristicIntent(task, "Phone Case", "electronics").aligned).toBe(false);
    // Generic category tasks still accept anything in that category.
    expect(heuristicIntent("Do the weekly grocery run", "Free-Range Eggs (12)", "groceries").aligned).toBe(true);
  });
});
