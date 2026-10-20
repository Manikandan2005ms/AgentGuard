import type { FastifyReply, FastifyRequest } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { env } from "../env";

/** If AGENT_API_KEY is set, agent endpoints require `Authorization: Bearer <key>` (or x-api-key). */
export async function requireAgentKey(req: FastifyRequest, reply: FastifyReply) {
  if (!env.AGENT_API_KEY) return;
  const header = req.headers.authorization?.replace(/^Bearer\s+/i, "") ?? (req.headers["x-api-key"] as string | undefined) ?? "";
  const a = Buffer.from(header);
  const b = Buffer.from(env.AGENT_API_KEY);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return reply.code(401).send({ error: "Missing or invalid agent API key" });
  }
}
