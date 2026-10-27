import type { FastifyInstance } from "fastify";
import { telegramWebhookSecret } from "../env";
import { handleUpdate } from "../telegram/bot";

export async function telegramRoutes(app: FastifyInstance) {
  app.post("/webhooks/telegram", async (req, reply) => {
    // Telegram echoes the secret we registered with setWebhook; reject anything else.
    if (!telegramWebhookSecret || req.headers["x-telegram-bot-api-secret-token"] !== telegramWebhookSecret) {
      return reply.code(401).send({ error: "bad secret" });
    }
    await handleUpdate(req.body as Parameters<typeof handleUpdate>[0]);
    return { ok: true };
  });
}
