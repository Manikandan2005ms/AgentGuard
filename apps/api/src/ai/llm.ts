import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { env, llmEnabled } from "../env";

/**
 * Thin wrapper for every AI check: structured JSON output validated with Zod.
 * README §9: if validation fails, retry once, then fail safe (the caller treats it as ASK_HUMAN).
 */

let client: Anthropic | null = null;
function anthropic(): Anthropic {
  client ??= new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY ?? null,
    authToken: env.ANTHROPIC_AUTH_TOKEN ?? null,
    maxRetries: 2,
    timeout: 60_000,
  });
  return client;
}

/** "main" = policy compiler; "fast" = in-request-path classifiers (README §22: small/fast model). */
export type Tier = "main" | "fast";

export interface StructuredCall<T> {
  name: string;
  schema: z.ZodType<T>;
  system: string;
  user: string;
  tier: Tier;
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
}

export type StructuredResult<T> = { ok: true; data: T; model: string } | { ok: false; error: string };

// Daily cap on model calls, so a public demo can't run up an unbounded bill (R3).
// Hitting it counts as a failed AI check, which fails safe to ASK_HUMAN.
const usage = { day: "", calls: 0 };
function takeBudget(): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (usage.day !== today) {
    usage.day = today;
    usage.calls = 0;
  }
  if (usage.calls >= env.LLM_DAILY_CALL_LIMIT) return false;
  usage.calls++;
  return true;
}

export const llmInfo = () => ({
  enabled: llmEnabled,
  provider: llmEnabled ? "anthropic" : "none",
  model: env.LLM_MODEL,
  fastModel: env.LLM_FAST_MODEL,
  callsToday: usage.day === new Date().toISOString().slice(0, 10) ? usage.calls : 0,
  dailyCallLimit: env.LLM_DAILY_CALL_LIMIT,
});

/**
 * Models that support the server-side refusal fallback ("default" routing). On these we opt in,
 * so a safety-classifier false positive is re-run on a fallback model instead of failing.
 */
const FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5", "claude-fable-5-1"]);

async function parseOnce<T>(call: StructuredCall<T>, model: string) {
  const common = {
    model,
    max_tokens: call.maxTokens ?? (call.tier === "main" ? 16000 : 4096),
    system: call.system,
    messages: [{ role: "user" as const, content: call.user }],
  };
  const effort = call.effort ?? "low";
  if (FALLBACK_MODELS.has(model)) {
    return anthropic().beta.messages.parse({
      ...common,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { format: betaZodOutputFormat(call.schema), effort },
    });
  }
  return anthropic().messages.parse({
    ...common,
    output_config: { format: zodOutputFormat(call.schema), effort },
  });
}

export async function structured<T>(call: StructuredCall<T>): Promise<StructuredResult<T>> {
  if (!llmEnabled) return { ok: false, error: "LLM disabled" };
  const model = call.tier === "main" ? env.LLM_MODEL : env.LLM_FAST_MODEL;
  let lastError = "unknown error";

  for (let attempt = 1; attempt <= 2; attempt++) {
    if (!takeBudget()) return { ok: false, error: `daily AI call limit (${env.LLM_DAILY_CALL_LIMIT}) reached` };
    try {
      const res = await parseOnce(call, model);
      if (res.stop_reason === "refusal") return { ok: false, error: "model declined the request" };
      if (res.stop_reason === "max_tokens") {
        lastError = "output truncated (max_tokens)";
        continue;
      }
      const checked = call.schema.safeParse(res.parsed_output);
      if (checked.success) return { ok: true, data: checked.data, model: res.model };
      lastError = `output failed validation: ${checked.error.issues[0]?.message ?? "invalid"}`;
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
        return { ok: false, error: `Anthropic auth failed: ${err.message}` };
      }
      if (err instanceof Anthropic.BadRequestError || err instanceof Anthropic.NotFoundError) {
        return { ok: false, error: `Anthropic rejected the request: ${err.message}` };
      }
      lastError = err instanceof Error ? err.message : String(err);
    }
  }
  console.warn(`[ai:${call.name}] failed after retry: ${lastError}`);
  return { ok: false, error: lastError };
}
