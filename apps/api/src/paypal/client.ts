import { env } from "../env";
import { getAccessToken } from "./auth";

export class PayPalError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly debugId: string | null,
    readonly details: unknown,
  ) {
    super(message);
    this.name = "PayPalError";
  }
}

interface RequestOptions {
  body?: unknown;
  /** PayPal-Request-Id: a retried POST with the same key never double-charges (README §8.3). */
  idempotencyKey?: string;
  query?: Record<string, string>;
}

export async function paypalRequest<T>(method: "GET" | "POST" | "PATCH", path: string, opts: RequestOptions = {}): Promise<T> {
  const token = await getAccessToken();
  const url = new URL(path, env.PAYPAL_BASE_URL);
  for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
  if (opts.idempotencyKey) headers["PayPal-Request-Id"] = opts.idempotencyKey;

  const res = await fetch(url, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });

  const text = await res.text();
  const json = text ? safeJson(text) : null;
  if (!res.ok) {
    const j = (json ?? {}) as { message?: string; name?: string; debug_id?: string; details?: unknown };
    const issue = Array.isArray(j.details) && j.details[0] ? ` (${(j.details[0] as { issue?: string }).issue})` : "";
    throw new PayPalError(`${j.name ?? "PAYPAL_ERROR"}: ${j.message ?? res.statusText}${issue}`, res.status, j.debug_id ?? null, j.details);
  }
  return (json ?? {}) as T;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}
