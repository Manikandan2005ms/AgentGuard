import { DECISIONS, PAY_STATUSES } from "@agentguard/shared";
import type { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { llmInfo } from "../ai/llm";
import { prisma } from "../db";
import { env, paypalMode, telegramEnabled } from "../env";
import { publish, subscribe } from "../events";
import { reconcileJob } from "../jobs";
import { LIMITS } from "../lib/limits";
import { toDTO, withRelations } from "../services/dto";
import { activatePolicy, activePolicyView, compileAndSave, listPolicies, simulatePolicy } from "../services/policyService";
import { budgetUsage, summary } from "../services/statsService";
import { getUser, usableVaultId } from "../services/users";
import { telegramBotUsername } from "../telegram/bot";

export async function dashboardRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({ ok: true, paypal: paypalMode, llm: llmInfo().provider }));

  app.get("/api/me", async () => {
    const user = await getUser();
    return {
      user: {
        name: user.name,
        killSwitch: user.killSwitch,
        paypalConnected: !!usableVaultId(user),
        telegramConnected: !!user.telegramChatId,
        telegramUsername: user.telegramUsername,
      },
      modes: {
        paypal: paypalMode,
        paypalFlow: env.PAYPAL_FLOW,
        llm: llmInfo(),
        telegram: telegramEnabled ? (env.TELEGRAM_MODE as string) : "off",
        telegramBot: telegramBotUsername(),
        agentKeyRequired: !!env.AGENT_API_KEY,
      },
      urls: { mcp: `${env.PUBLIC_BASE_URL}/mcp`, stores: env.STORES_URL },
    };
  });

  // ---- Policies ----
  app.post("/api/policies/compile", { config: { rateLimit: LIMITS.aiHeavy } }, async (req) => {
    const { rawText } = z.object({ rawText: z.string().min(3).max(4000) }).parse(req.body);
    return compileAndSave(rawText);
  });
  app.post("/api/policies/:id/activate", { config: { rateLimit: LIMITS.admin } }, async (req, reply) => {
    const p = await activatePolicy((req.params as { id: string }).id);
    return p ?? reply.code(404).send({ error: "Policy not found" });
  });
  app.post("/api/policies/:id/simulate", { config: { rateLimit: LIMITS.payments } }, async (req, reply) => {
    const result = await simulatePolicy((req.params as { id: string }).id);
    return result ?? reply.code(404).send({ error: "Policy not found" });
  });
  app.get("/api/policies/active", async () => ({ policy: await activePolicyView() }));
  app.get("/api/policies", async () => listPolicies());

  // ---- Audit log ----
  app.get("/api/audit", async (req) => {
    const q = z
      .object({
        status: z.enum(PAY_STATUSES).optional(),
        decision: z.enum(DECISIONS).optional(),
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
        limit: z.coerce.number().int().min(1).max(2000).default(500),
      })
      .parse(req.query);
    const user = await getUser();
    const where: Prisma.PaymentRequestWhereInput = {
      userId: user.id,
      ...(q.status ? { status: q.status } : {}),
      ...(q.decision ? { decision: q.decision } : {}),
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } } : {}),
    };
    const rows = await prisma.paymentRequest.findMany({ where, include: withRelations, orderBy: { createdAt: "desc" }, take: q.limit });
    return rows.map(toDTO);
  });

  app.get("/api/threats", async () => {
    const user = await getUser();
    const rows = await prisma.paymentRequest.findMany({
      where: { userId: user.id, injectionDetected: true },
      include: withRelations,
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return rows.map(toDTO);
  });

  app.get("/api/merchants", async () => prisma.merchant.findMany({ orderBy: { name: "asc" } }));

  // ---- Stats ----
  app.get("/api/stats/budgets", async () => budgetUsage());
  app.get("/api/stats/summary", async () => summary());

  // ---- Kill switch ----
  app.get("/api/killswitch", async () => ({ enabled: (await getUser()).killSwitch }));
  app.post("/api/killswitch", { config: { rateLimit: LIMITS.admin } }, async (req) => {
    const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
    const user = await getUser();
    await prisma.user.update({ where: { id: user.id }, data: { killSwitch: enabled } });
    publish({ type: "killswitch", enabled });
    return { enabled };
  });

  app.post("/api/paypal/reconcile", { config: { rateLimit: LIMITS.admin } }, async () => ({ reconciled: await reconcileJob() }));

  // ---- Live feed (Server-Sent Events) ----
  app.get("/api/events", async (req, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      ...(reply.getHeaders() as Record<string, string>),
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    reply.raw.write(`event: hello\ndata: {}\n\n`);
    const unsubscribe = subscribe((event) => reply.raw.write(`data: ${JSON.stringify(event)}\n\n`));
    const ping = setInterval(() => reply.raw.write(`: ping\n\n`), 20_000);
    req.raw.on("close", () => {
      clearInterval(ping);
      unsubscribe();
    });
  });
}
