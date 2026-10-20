import cors from "@fastify/cors";
import Fastify from "fastify";
import { ZodError } from "zod";
import { env } from "./env";
import { agentRoutes } from "./routes/agent";
import { dashboardRoutes } from "./routes/dashboard";
import { paypalRoutes } from "./routes/paypal";
import { telegramRoutes } from "./routes/telegram";
import { PaymentStateError } from "./services/paymentService";

export async function buildApp() {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info", transport: undefined },
    bodyLimit: 2 * 1024 * 1024,
    trustProxy: true,
  });

  const origins = (env.CORS_ORIGINS ?? env.DASHBOARD_URL).split(",").map((s) => s.trim());
  await app.register(cors, { origin: origins, credentials: false });

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
  return app;
}
