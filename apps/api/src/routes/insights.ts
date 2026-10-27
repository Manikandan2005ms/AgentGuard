import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { takeBudget } from "../ai/llm";
import { geminiModelLabel, runStudioTurn, StudioTurnError, StudioTurnSchema } from "../ai/studioTurn";
import { env } from "../env";
import { LIMITS } from "../lib/limits";
import { insightsAnomalies, insightsData } from "../services/insightsService";

/** The Studio agent runs on Gemini's free tier whenever a Gemini key is set (LLM_PROVIDER=none turns it off). */
const studioAiEnabled = () => !!env.GEMINI_API_KEY && env.LLM_PROVIDER !== "none";
const studioModels = () => [...new Set([env.GEMINI_MODEL, env.GEMINI_FAST_MODEL])];

export async function insightsRoutes(app: FastifyInstance) {
  // ---- Data for the AG Studio dashboard (read-only) ----
  app.get("/api/insights/data", async () => insightsData());

  app.get("/api/insights/anomalies", async (req) => {
    const { hours } = z.object({ hours: z.coerce.number().int().min(1).max(168).default(24) }).parse(req.query);
    return insightsAnomalies(hours);
  });

  // ---- Studio agent (Gemini) ----
  app.get("/api/insights/ai", async () => ({
    enabled: studioAiEnabled(),
    provider: "gemini",
    models: studioAiEnabled() ? studioModels().map((id) => ({ id, label: geminiModelLabel(id) })) : [],
  }));

  app.post("/api/insights/ai/turn", { config: { rateLimit: LIMITS.studioAi } }, async (req, reply) => {
    if (!studioAiEnabled()) return reply.code(503).send({ error: "The Insights agent needs GEMINI_API_KEY (free at aistudio.google.com)." });
    const turn = StudioTurnSchema.parse(req.body);
    if (!takeBudget()) return reply.code(429).send({ error: `Daily AI call limit (${env.LLM_DAILY_CALL_LIMIT}) reached.` });

    // The chosen model first, then the others: free-tier limits are per model.
    const allowed = studioModels();
    const first = turn.model && allowed.includes(turn.model) ? turn.model : allowed[0]!;
    // Stop the Gemini call if the reader cancels the run (the browser drops the request).
    const controller = new AbortController();
    reply.raw.on("close", () => {
      if (!reply.raw.writableEnded) controller.abort();
    });
    try {
      return await runStudioTurn(turn, [first, ...allowed.filter((m) => m !== first)], env.GEMINI_API_KEY!, controller.signal);
    } catch (err) {
      if (err instanceof StudioTurnError) return reply.code(err.statusCode).send({ error: err.message });
      throw err;
    }
  });
}
