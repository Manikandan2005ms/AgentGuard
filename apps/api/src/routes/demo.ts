import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { env, paypalMode } from "../env";
import { LIMITS } from "../lib/limits";
import { DemoBusyError, latestRun, resetDemo, SCENARIOS, startRun, stopRun } from "../services/demoRunner";

export async function demoRoutes(app: FastifyInstance) {
  app.get("/api/demo/scenarios", async () => ({
    scenarios: SCENARIOS.map(({ args: _args, ...s }) => s),
    storesUrl: env.STORES_URL,
    paypalMode,
  }));

  app.get("/api/demo/runs/latest", async () => ({ run: latestRun() }));

  app.post("/api/demo/run", { config: { rateLimit: LIMITS.demoRun } }, async (req, reply) => {
    const { scenario } = z.object({ scenario: z.string() }).parse(req.body);
    try {
      return { run: await startRun(scenario) };
    } catch (err) {
      if (err instanceof DemoBusyError) return reply.code(409).send({ error: err.message, run: latestRun() });
      throw err;
    }
  });

  app.post("/api/demo/stop", { config: { rateLimit: LIMITS.admin } }, async () => ({ run: stopRun() }));

  app.post("/api/demo/reset", { config: { rateLimit: LIMITS.demoReset } }, async () => ({ ok: true, log: await resetDemo() }));
}
