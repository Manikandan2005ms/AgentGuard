import type { Policy, RuleResult } from "@agentguard/shared";

/**
 * Deterministic rules for PayPal Agent Toolkit calls made through AgentGuard (R2).
 * The toolkit is merchant-side (refunds, disputes, invoices, subscriptions, orders), so this
 * guards "ops agents" that act on a business's PayPal account, with the same no-AI-first rules.
 */

export type ToolClass = "read" | "write" | "destructive" | "money_out";

/** Calls that send money out of the account. */
const MONEY_OUT = new Set(["create_refund", "accept_dispute_claim", "record_refund_for_invoice"]);

/** Calls that cancel, delete or change something a customer relies on. */
const DESTRUCTIVE = new Set([
  "cancel_subscription",
  "update_subscription",
  "update_plan",
  "cancel_sent_invoice",
  "delete_invoice",
  "cancel_recurring_series",
  "delete_recurring_series",
]);

const READ_EXTRA = new Set(["get_merchant_insights", "generate_invoice_number", "generate_invoice_qr_code", "search_invoicing"]);

export function classifyTool(name: string): ToolClass {
  if (MONEY_OUT.has(name)) return "money_out";
  if (DESTRUCTIVE.has(name)) return "destructive";
  if (READ_EXTRA.has(name) || /^(get|list|show)_/.test(name)) return "read";
  return "write";
}

export const TOOL_CLASS_LABEL: Record<ToolClass, string> = {
  read: "read-only: passed straight through",
  write: "changes data: checked by your AgentGuard policy",
  destructive: "cancels or deletes: always needs your approval",
  money_out: "sends money out: checked by your policy and limits",
};

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Best-effort amount a tool call moves or commits to; null when the call doesn't say. */
export function toolAmount(name: string, args: Record<string, unknown>): number | null {
  const amount = args.amount as { value?: unknown } | undefined;
  if (amount && typeof amount === "object" && "value" in amount) return num(amount.value);
  if (name === "create_order" && Array.isArray(args.items)) {
    const items = args.items as { itemTotal?: unknown; itemCost?: unknown; quantity?: unknown }[];
    const sum = items.reduce((s, i) => s + (num(i.itemTotal) ?? (num(i.itemCost) ?? 0) * (num(i.quantity) ?? 1)), 0);
    return Math.round((sum + (num(args.shippingCost) ?? 0) - (num(args.discount) ?? 0)) * 100) / 100;
  }
  return null;
}

/** One human-readable line for the audit log and the approval card. */
export function describeToolCall(name: string, args: Record<string, unknown>, amount: number | null): string {
  const money = amount != null ? ` ($${amount.toFixed(2)})` : "";
  const id = (k: string) => (typeof args[k] === "string" ? String(args[k]) : "?");
  switch (name) {
    case "create_refund":
      return amount != null ? `Refund $${amount.toFixed(2)} on capture ${id("capture_id")}` : `Full refund of capture ${id("capture_id")}`;
    case "accept_dispute_claim":
      return `Accept dispute ${id("dispute_id")} (customer gets refunded)`;
    case "cancel_subscription":
      return `Cancel subscription ${id("subscription_id")}`;
    case "create_order": {
      const items = Array.isArray(args.items) ? (args.items as { name?: string }[]).map((i) => i.name).filter(Boolean) : [];
      return `Create PayPal order: ${items.join(", ") || "items"}${money}`;
    }
    case "pay_order":
      return `Capture payment for order ${id("id")}`;
    default:
      return `${name.replace(/_/g, " ")}${money}`;
  }
}

export interface ToolRuleInput {
  name: string;
  cls: ToolClass;
  amount: number | null;
  policy: Policy;
  /** The heuristic injection scanner found hidden instructions in the content that prompted the call. */
  injectionInSource: boolean;
}

export function evaluateToolRules(x: ToolRuleInput): RuleResult[] {
  const out: RuleResult[] = [];
  const p = x.policy;
  const m = (n: number) => `$${n.toFixed(2)}`;

  if (x.cls === "destructive") {
    out.push({ rule_id: "tool_destructive", outcome: "ask", detail: `${x.name} cancels or deletes something, so it always needs your approval.` });
  }

  if (x.cls === "money_out" && x.amount == null) {
    out.push({ rule_id: "tool_unknown_amount", outcome: "ask", detail: "This sends money out but doesn't say how much, so it needs your approval." });
  }

  if (x.amount != null && (x.cls === "money_out" || x.cls === "write")) {
    if (p.per_transaction_limit != null) {
      const over = x.amount > p.per_transaction_limit;
      out.push({
        rule_id: "per_transaction_limit",
        outcome: over ? "block" : "pass",
        detail: over ? `${m(x.amount)} is over your ${m(p.per_transaction_limit)} limit.` : `${m(x.amount)} is within your ${m(p.per_transaction_limit)} limit.`,
      });
    }
    if (p.require_approval_above != null) {
      const over = x.amount > p.require_approval_above;
      out.push({
        rule_id: "require_approval_above",
        outcome: over ? "ask" : "pass",
        detail: over ? `${m(x.amount)} is over ${m(p.require_approval_above)}, so you asked to approve it.` : `${m(x.amount)} is under your approval threshold.`,
      });
    }
  }

  // A privileged action prompted by content with hidden instructions is the classic attack: block it.
  if (x.injectionInSource && (x.cls === "money_out" || x.cls === "destructive")) {
    out.push({
      rule_id: "injected_privileged_action",
      outcome: "block",
      detail: "The message that triggered this action contains hidden instructions aimed at AI agents.",
    });
  } else if (x.injectionInSource) {
    out.push({ rule_id: "injected_action", outcome: "ask", detail: "The content behind this action contains hidden instructions aimed at AI agents." });
  }

  return out;
}
