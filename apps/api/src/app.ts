import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { ZodError } from "zod";
import { env } from "./env";
import { isExempt } from "./lib/limits";
import { agentRoutes } from "./routes/agent";
import { dashboardRoutes } from "./routes/dashboard";
import { demoRoutes } from "./routes/demo";
import { paypalRoutes } from "./routes/paypal";
import { telegramRoutes } from "./routes/telegram";
import { PaymentStateError } from "./services/paymentService";

export async function buildApp() {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info", transport: undefined },
    bodyLimit: 2 * 1024 * 1024,
    // Trust only the hosting proxy's hop(s), so clients can't spoof X-Forwarded-For to dodge limits.
    trustProxy: (_address: string, hop: number) => hop < env.TRUST_PROXY_HOPS,
  });

  const origins = (env.CORS_ORIGINS ?? env.DASHBOARD_URL).split(",").map((s) => s.trim());
  await app.register(cors, { origin: origins, credentials: false });

  // Public-demo abuse protection: a global ceiling per IP, tighter limits on routes that call Claude.
  await app.register(rateLimit, {
    global: true,
    max: env.RATE_LIMIT_PER_MINUTE,
    timeWindow: "1 minute",
    allowList: (req) => isExempt(req),
    // Thrown into setErrorHandler below, which turns it into { error } with status 429.
    errorResponseBuilder: (_req, ctx) => Object.assign(new Error(`Too many requests. Try again in ${ctx.after}.`), { statusCode: 429 }),
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: "Invalid request", issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) });
    }
    if (err instanceof PaymentStateError) return reply.code(err.statusCode).send({ error: err.message });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.code(status).send({ error: (err as Error).message });
    req.log.error(err);
    return reply.code(500).send({ error: "Internal error" });
  });

  await app.register(dashboardRoutes);
  await app.register(agentRoutes);
  await app.register(paypalRoutes);
  await app.register(telegramRoutes);
  await app.register(demoRoutes);
  return app;
}
