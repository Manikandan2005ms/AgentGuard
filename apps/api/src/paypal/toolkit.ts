import { PayPalMCPToolkit, type Tool } from "@paypal/agent-toolkit/mcp";
import { randomUUID } from "node:crypto";
import { env, paypalMode } from "../env";
import { getAccessToken } from "./auth";

/**
 * PayPal Agent Toolkit (@paypal/agent-toolkit) behind AgentGuard (R2).
 * The tool list comes from the toolkit itself, so names, descriptions and argument schemas are
 * exactly what PayPal's own MCP server offers. In mock mode calls return simulated results.
 */

// Every action group the toolkit supports (mirrors the toolkit's ALL_TOOLS_ENABLED).
const ALL_ACTIONS: Record<string, Record<string, boolean>> = {
  invoices: {
    create: true, createRecurringSeries: true, activateRecurringSeries: true, getRecurringSeries: true, cancelRecurringSeries: true,
    deleteRecurringSeries: true, list: true, get: true, send: true, sendReminder: true, cancel: true, delete: true, setupReminders: true,
    updateReminder: true, search: true, update: true, cancelReminders: true, generateQRC: true, generateInvoiceNumber: true,
    recordPayment: true, recordRefund: true, createConditionalRules: true,
  },
  products: { create: true, list: true, update: true, show: true },
  subscriptionPlans: { create: true, list: true, show: true },
  subscriptions: { create: true, show: true, cancel: true, update: true },
  shipment: { create: true, get: true, update: true },
  orders: { create: true, get: true, capture: true },
  disputes: { list: true, get: true, create: true },
  transactions: { list: true },
  plan: { update: true },
  payments: { createRefund: true, getRefunds: true },
  insights: { get: true },
};

const configuration = { actions: ALL_ACTIONS, context: { sandbox: env.PAYPAL_BASE_URL.includes("sandbox") } };

let cached: Tool[] | null = null;

/** The toolkit's tools, filtered by PAYPAL_TOOLKIT_TOOLS ("all", "none" or a comma list). */
export function toolkitTools(): Tool[] {
  if (!cached) {
    // Listing tools needs no network call, so a placeholder token is fine here.
    const all = new PayPalMCPToolkit({ accessToken: "listing-only", configuration }).getTools();
    const setting = env.PAYPAL_TOOLKIT_TOOLS.trim().toLowerCase();
    const wanted = new Set(setting.split(",").map((s) => s.trim()).filter(Boolean));
    cached = setting === "all" ? all : setting === "none" ? [] : all.filter((t) => wanted.has(t.method));
  }
  return cached;
}

export function findTool(name: string): Tool | undefined {
  return toolkitTools().find((t) => t.method === name);
}

/** Runs a toolkit tool for real (sandbox) or simulated (mock). Returns PayPal's parsed response. */
export async function runToolkitTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  if (paypalMode === "mock") return mockResult(name, args);
  const accessToken = await getAccessToken();
  const toolkit = new PayPalMCPToolkit({ accessToken, configuration });
  const raw = await toolkit.getPaypalAPIService().run(name, args);
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function mockResult(name: string, args: Record<string, unknown>): unknown {
  const id = (p: string) => `${p}${randomUUID().replace(/-/g, "").slice(0, 15).toUpperCase()}`;
  const base = { mock: true, note: "Simulated by AgentGuard's mock PayPal (no sandbox keys set)." };
  if (name === "create_refund") return { ...base, id: id("MR"), status: "COMPLETED", capture_id: args.capture_id, amount: args.amount ?? "full" };
  if (name === "accept_dispute_claim") return { ...base, dispute_id: args.dispute_id, status: "RESOLVED" };
  if (name === "create_order") return { ...base, id: id("MO"), status: "CREATED" };
  if (name === "pay_order") return { ...base, id: args.id, status: "COMPLETED" };
  if (name === "list_invoices") {
    return {
      ...base,
      total_items: 1,
      items: [{ id: "INV2-DEMO-1042", status: "PAID", detail: { invoice_number: "1042" }, amount: { currency_code: "USD", value: "24.50" } }],
    };
  }
  if (name.startsWith("list_")) return { ...base, items: [] };
  if (/^(get|show)_/.test(name)) return { ...base, id: args.id ?? args.dispute_id ?? args.refund_id ?? "unknown", status: "COMPLETED" };
  return { ...base, ok: true, tool: name };
}
