import type { FastifyRequest } from "fastify";

/**
 * Per-route rate limits for the public demo (R3). Anything that can trigger Claude calls or
 * server work gets a tighter budget than plain reads.
 */
export const LIMITS = {
  /** Policy compiler runs the main model. */
  aiHeavy: { max: 10, timeWindow: "10 minutes" },
  /** Payment requests / simulations / tasks (each payment can call the fast model a few times). */
  payments: { max: 40, timeWindow: "1 minute" },
  mcp: { max: 120, timeWindow: "1 minute" },
  /** Human actions and switches. */
  admin: { max: 30, timeWindow: "1 minute" },
  demoRun: { max: 8, timeWindow: "10 minutes" },
  demoReset: { max: 4, timeWindow: "1 minute" },
} as const;

/** A request made by this server to itself (the demo runner's agent), not forwarded by a proxy. */
export function isLocalCall(req: FastifyRequest): boolean {
  const addr = req.socket.remoteAddress ?? "";
  const loopback = addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
  return loopback && !req.headers["x-forwarded-for"];
}

/** Webhooks, health checks and the live event stream are never rate limited. */
export function isExempt(req: FastifyRequest): boolean {
  const url = req.url;
  return url.startsWith("/webhooks/") || url === "/health" || url.startsWith("/api/events") || isLocalCall(req);
}
