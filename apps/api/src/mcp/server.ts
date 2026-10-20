import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CATEGORIES, PaymentRequestInputSchema } from "@agentguard/shared";
import { z } from "zod";
import { prisma } from "../db";
import { getPayment, requestPayment, toAgentResult } from "../services/paymentService";
import { budgetUsage } from "../services/statsService";
import { getUser } from "../services/users";

/**
 * AgentGuard as a "guarded PayPal" MCP server (README §8.7, §13.1). To an agent it looks like a
 * payments tool; every money-moving call passes through the firewall first.
 */

const INSTRUCTIONS = `AgentGuard is the only way to pay. It checks every payment against the user's spending policy, their original task, and the page you read.
1. Call start_task once with the user's exact request before shopping. Use the returned task_id in every request_payment.
2. Call request_payment for each purchase. Pass the full content of the page that led to the purchase as source_page_content.
3. Respect the result. "blocked" and "rejected" are final: do not retry, follow safe_next_step. "pending_approval" means the user is deciding: poll get_payment_status.`;

const json = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });

export function buildMcpServer(): McpServer {
  const server = new McpServer({ name: "agentguard", version: "0.1.0" }, { instructions: INSTRUCTIONS });

  server.registerTool(
    "start_task",
    {
      title: "Start a shopping task",
      description: "Register the user's original request (their intent). Every payment must belong to a task and match it. Returns task_id.",
      inputSchema: { description: z.string().min(3).max(500).describe("The user's request, verbatim, e.g. 'Buy oat milk and bread'") },
    },
    async ({ description }) => {
      const user = await getUser();
      const task = await prisma.task.create({ data: { userId: user.id, description } });
      return json({ task_id: task.id, description: task.description });
    },
  );

  const shape = PaymentRequestInputSchema.shape;
  server.registerTool(
    "request_payment",
    {
      title: "Request a guarded payment",
      description:
        "Ask to pay a merchant through PayPal. AgentGuard approves it, holds it for the user's one-tap approval, or blocks it, and returns a structured result with the reason and a safe next step.",
      inputSchema: {
        task_id: z.string().describe("task_id from start_task"),
        merchant_domain: shape.merchant_domain.describe("Merchant domain, e.g. freshcart.example"),
        item: shape.item.describe("What you are buying, e.g. 'Oat Milk 1L'"),
        quantity: z.number().int().positive().max(1000).optional().describe("Units (default 1)"),
        amount: shape.amount.describe("Total amount for the line (unit price x quantity)"),
        currency: z.string().length(3).optional().describe("ISO currency code (default USD)"),
        sku: shape.sku,
        source_page_content: shape.source_page_content.describe("Full content of the page that led to this purchase"),
        source_url: shape.source_url,
      },
    },
    async (args) => {
      const input = PaymentRequestInputSchema.parse(args);
      return json(await requestPayment(input));
    },
  );

  server.registerTool(
    "get_payment_status",
    {
      title: "Get payment status",
      description: "Check a payment request, e.g. while the user is deciding on a pending approval.",
      inputSchema: { request_id: z.string() },
    },
    async ({ request_id }) => {
      const p = await getPayment(request_id);
      if (!p) return { ...json({ error: "unknown request_id" }), isError: true };
      return json(toAgentResult(p));
    },
  );

  server.registerTool(
    "get_remaining_budget",
    {
      title: "Get remaining budget",
      description: "How much the user's policy still allows, so you can plan within the limits.",
      inputSchema: { category: z.enum([...CATEGORIES, "*"]).optional().describe("Budget category, or omit for all") },
    },
    async ({ category }) => {
      const budgets = await budgetUsage();
      const rows = budgets
        .filter((b) => !category || b.category === category)
        .map((b) => ({ ...b, remaining: Math.max(0, Math.round((b.limit - b.spent - b.held) * 100) / 100) }));
      return json({ budgets: rows, note: rows.length ? undefined : "No budget limits configured for this category." });
    },
  );

  return server;
}
