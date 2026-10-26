import { z } from "zod";
import type { Attempt, StructuredCall } from "./llm";

/**
 * Google Gemini over the Interactions API (POST /v1beta/interactions), the free-tier alternative to Claude.
 * The reply is constrained to the call's Zod schema (sent as JSON Schema); llm.ts still validates it.
 */

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";

/** Zod -> the JSON Schema subset Gemini accepts: no "$schema", and "const" written as a one-value "enum". */
export function geminiSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _ignored, ...json } = z.toJSONSchema(schema) as Record<string, unknown>;
  return constToEnum(json) as Record<string, unknown>;
}

function constToEnum(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(constToEnum);
  if (!node || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) out[key] = constToEnum(value);
  if ("const" in out) {
    out.enum = [out.const];
    delete out.const;
  }
  return out;
}

export function geminiRequest<T>(call: StructuredCall<T>, model: string, thinking = true) {
  return {
    model,
    system_instruction: call.system,
    input: call.user,
    response_format: { type: "text", mime_type: "application/json", schema: geminiSchema(call.schema) },
    generation_config: {
      max_output_tokens: call.maxTokens ?? (call.tier === "main" ? 16000 : 4096),
      ...(thinking ? { thinking_level: call.effort ?? "low" } : {}),
    },
    store: false,
  };
}

interface Interaction {
  model?: string;
  status?: string;
  steps?: { type?: string; content?: { type?: string; text?: string }[] }[];
  error?: { message?: string };
}

/** Turns a finished interaction into an Attempt. Throws (so llm.ts retries) when there is nothing usable. */
export function readInteraction(body: Interaction, model: string): Attempt {
  if (body.status === "incomplete") return { stop: "max_tokens" };
  if (body.status && body.status !== "completed") throw new Error(`Gemini interaction ${body.status}`);
  const text = (body.steps ?? [])
    .filter((step) => step.type === "model_output")
    .flatMap((step) => step.content ?? [])
    .map((part) => (part.type === "text" ? (part.text ?? "") : ""))
    .join("");
  if (!text.trim()) throw new Error("Gemini returned no text");
  try {
    return { stop: "done", output: JSON.parse(text), model: body.model ?? model };
  } catch {
    throw new Error("Gemini returned text that is not JSON");
  }
}

async function post(payload: object, apiKey: string) {
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(payload),
    // Normal calls take 2–10 s; an overloaded model can hang, so give up early and let llm.ts retry.
    signal: AbortSignal.timeout(30_000),
  });
  const raw: unknown = await res.json().catch(() => ({}));
  // Errors can arrive wrapped in a one-element array: [{ "error": { ... } }].
  const body = (Array.isArray(raw) ? (raw[0] ?? {}) : raw) as Interaction;
  return { status: res.status, body, message: body.error?.message ?? res.statusText };
}

export async function geminiOnce<T>(call: StructuredCall<T>, model: string, apiKey: string): Promise<Attempt> {
  let res = await post(geminiRequest(call, model), apiKey);
  // Not every model takes thinking_level; if this one rejects it, ask again without.
  if (res.status === 400 && /thinking/i.test(res.message)) res = await post(geminiRequest(call, model, false), apiKey);

  if (res.status === 200) return readInteraction(res.body, model);
  if (res.status === 401 || res.status === 403) return { stop: "fatal", error: `Gemini auth failed: ${res.message}` };
  // An invalid API key also comes back as a 400 ("API key not valid").
  if (res.status === 400 || res.status === 404) return { stop: "fatal", error: `Gemini rejected the request: ${res.message}` };
  // Free-tier limits are per model, so a rate limit or overload (503) is worth one retry on the fast model.
  if (res.status === 429) throw new Error(`Gemini rate limit reached (free tier): ${res.message}`);
  throw new Error(`Gemini HTTP ${res.status}: ${res.message}`);
}
