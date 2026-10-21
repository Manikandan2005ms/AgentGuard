import { emptyPolicy, type Policy } from "@agentguard/shared";
import { describe, expect, it } from "vitest";
import { worstOutcome } from "../apps/api/src/core/policyEngine";
import { classifyTool, describeToolCall, evaluateToolRules, toolAmount, toolkitError } from "../apps/api/src/core/toolPolicy";

const policy: Policy = { ...emptyPolicy(), per_transaction_limit: 200, require_approval_above: 50 };

describe("PayPal Agent Toolkit tool policy", () => {
  it("classifies the toolkit's tools", () => {
    expect(classifyTool("list_invoices")).toBe("read");
    expect(classifyTool("get_order")).toBe("read");
    expect(classifyTool("show_subscription_details")).toBe("read");
    expect(classifyTool("get_merchant_insights")).toBe("read");
    expect(classifyTool("create_refund")).toBe("money_out");
    expect(classifyTool("accept_dispute_claim")).toBe("money_out");
    expect(classifyTool("cancel_subscription")).toBe("destructive");
    expect(classifyTool("delete_invoice")).toBe("destructive");
    expect(classifyTool("create_invoice")).toBe("write");
    expect(classifyTool("create_order")).toBe("write");
  });

  it("extracts amounts", () => {
    expect(toolAmount("create_refund", { capture_id: "X", amount: { currency_code: "USD", value: "3.99" } })).toBe(3.99);
    expect(toolAmount("create_refund", { capture_id: "X" })).toBeNull();
    expect(
      toolAmount("create_order", { items: [{ name: "a", itemCost: 10, quantity: 2, itemTotal: 20 }, { name: "b", itemCost: 5, itemTotal: 5 }], shippingCost: 4, discount: 1 }),
    ).toBe(28);
  });

  it("describes calls for humans", () => {
    expect(describeToolCall("create_refund", { capture_id: "CAP1" }, null)).toBe("Full refund of capture CAP1");
    expect(describeToolCall("create_refund", { capture_id: "CAP1" }, 3.99)).toBe("Refund $3.99 on capture CAP1");
  });

  it("passes a small refund", () => {
    const r = evaluateToolRules({ name: "create_refund", cls: "money_out", amount: 3.99, policy, injectionInSource: false });
    expect(worstOutcome(r)).toBe("pass");
  });

  it("asks for big or unknown-amount refunds and blocks above the limit", () => {
    expect(worstOutcome(evaluateToolRules({ name: "create_refund", cls: "money_out", amount: 120, policy, injectionInSource: false }))).toBe("ask");
    expect(worstOutcome(evaluateToolRules({ name: "create_refund", cls: "money_out", amount: null, policy, injectionInSource: false }))).toBe("ask");
    expect(worstOutcome(evaluateToolRules({ name: "create_refund", cls: "money_out", amount: 480, policy, injectionInSource: false }))).toBe("block");
  });

  it("always asks before destructive actions", () => {
    expect(worstOutcome(evaluateToolRules({ name: "cancel_subscription", cls: "destructive", amount: null, policy, injectionInSource: false }))).toBe("ask");
  });

  it("blocks money-out actions prompted by content with hidden instructions", () => {
    const r = evaluateToolRules({ name: "create_refund", cls: "money_out", amount: 3.99, policy, injectionInSource: true });
    expect(r.find((x) => x.rule_id === "injected_privileged_action")?.outcome).toBe("block");
    expect(worstOutcome(evaluateToolRules({ name: "create_invoice", cls: "write", amount: 10, policy, injectionInSource: true }))).toBe("ask");
  });

  it("spots the toolkit's error results (it never throws)", () => {
    expect(toolkitError({ error: { message: "get_merchant_insights is not supported in sandbox mode", type: "paypal_error" } })).toBe(
      "get_merchant_insights is not supported in sandbox mode",
    );
    expect(toolkitError({ ok: false, status: 404, code: "PAYPAL_API_HTTP_ERROR", message: "RESOURCE_NOT_FOUND" })).toBe("RESOURCE_NOT_FOUND (HTTP 404)");
    expect(toolkitError({ id: "8XY12345AB678901C", status: "COMPLETED" })).toBeNull();
    expect(toolkitError({ total_items: 0, total_pages: 0 })).toBeNull();
    expect(toolkitError("plain text")).toBeNull();
  });
});
