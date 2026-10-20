import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { PaymentRequestInputSchema } from "@agentguard/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db";
import { requireAgentKey } from "../lib/auth";
import { buildMcpServer } from "../mcp/server";
import {
  approveRequest,
  evaluateRequest,
  getPayment,
  refundRequest,
  rejectRequest,
  requestPayment,
  toAgentResult,
} from "../services/paymentService";
import { getUser } from "../services/users";

export async function agentRoutes(app: FastifyInstance) {
  // ---- MCP (Streamable HTTP, stateless: a fresh server per request) ----
  app.post("/mcp", { preHandler: requireAgentKey }, async (req, reply) => {
    const server = buildMcpServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    reply.hijack();
    reply.raw.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req.raw, reply.raw, req.body);
  });
  const notAllowed = async (_req: unknown, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) =>
    reply.code(405).send({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed (stateless server)" }, id: null });
  app.get("/mcp", notAllowed);
  app.delete("/mcp", notAllowed);

  // ---- Tasks (intent) ----
  app.post("/api/tasks", { preHandler: requireAgentKey }, async (req) => {
    const { description } = z.object({ description: z.string().min(3).max(500) }).parse(req.body);
    const user = await getUser();
    const task = await prisma.task.create({ data: { userId: user.id, description } });
    return { task_id: task.id, description: task.description, createdAt: task.createdAt };
  });

  app.get("/api/tasks", async () => {
    const user = await getUser();
    return prisma.task.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 50 });
  });

  // ---- Payments ----
  app.post("/api/payments/request", { preHandler: requireAgentKey }, async (req) => {
    const input = PaymentRequestInputSchema.parse(req.body);
    return requestPayment(input);
  });

  /** Dry run: what would AgentGuard decide? Nothing is stored and no money moves. */
  app.post("/api/payments/simulate", async (req) => {
    const input = PaymentRequestInputSchema.parse(req.body);
    const user = await getUser();
    const ev = await evaluateRequest(input, user.killSwitch, user.id);
    return {
      decision: ev.decision,
      baseline_decision: ev.baselineDecision,
      risk_score: ev.score,
      category: ev.category,
      explanation: ev.explanation,
      reasons: ev.reasons,
      rules: ev.rules,
      signals: ev.signals,
      intent: ev.intent,
      injection: { detected: ev.injectionDetected, evidence: ev.injection.evidence, llm: ev.injection.llm },
      engines: ev.aiEngines,
    };
  });

  app.get("/api/payments/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const p = await getPayment(id);
    if (!p) return reply.code(404).send({ error: "Not found" });
    return { payment: p, agent_result: toAgentResult(p) };
  });

  app.post("/api/payments/:id/approve", async (req) => approveRequest((req.params as { id: string }).id, "human"));
  app.post("/api/payments/:id/reject", async (req) => rejectRequest((req.params as { id: string }).id, "human"));
  app.post("/api/payments/:id/refund", async (req) => refundRequest((req.params as { id: string }).id));
}
