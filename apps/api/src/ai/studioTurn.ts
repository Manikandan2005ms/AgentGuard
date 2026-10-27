import { z } from "zod";

/**
 * One AG Studio agent turn on Gemini's free tier (POST /v1beta/models/{model}:generateContent).
 *
 * The dashboard's Studio adapter sends Studio's own request (conversation items, instructions,
 * JSON-Schema tools) here, so the Gemini key never reaches the browser. This file converts it to
 * Gemini's format and converts the reply back to text plus tool calls. Studio runs the tools.
 */

const BASE = "https://generativelanguage.googleapis.com/v1beta/models";

/**
 * Gemini 3 requires the "thought signature" of each tool call to be sent back with the
 * conversation. The adapter keeps them; for a call it has none for (a conversation from before a
 * reload), Gemini documents this placeholder.
 */
export const PLACEHOLDER_SIGNATURE = "skip_thought_signature_validator";

const TextPart = z.object({ type: z.string(), text: z.string().optional(), refusal: z.string().optional() }).passthrough();
const Item = z.union([
  z.object({ type: z.literal("message"), role: z.enum(["user", "system", "assistant"]), content: z.array(TextPart) }).passthrough(),
  z.object({ type: z.literal("function_call"), callId: z.string(), name: z.string(), arguments: z.string() }).passthrough(),
  z.object({ type: z.literal("function_call_output"), callId: z.string(), output: z.string() }).passthrough(),
  z.object({ type: z.literal("reasoning") }).passthrough(),
]);

export const StudioTurnSchema = z.object({
  instructions: z.string().max(200_000).optional(),
  input: z.array(Item).max(400),
  tools: z
    .array(z.object({ name: z.string().max(128), description: z.string().max(20_000).default(""), parameters: z.record(z.string(), z.unknown()) }))
    .max(64)
    .default([]),
  toolChoice: z.union([z.enum(["auto", "none", "required"]), z.object({ name: z.string() })]).optional(),
  responseFormat: z
    .union([z.object({ type: z.literal("text") }), z.object({ type: z.literal("json"), name: z.string(), schema: z.record(z.string(), z.unknown()) })])
    .optional(),
  model: z.string().max(64).optional(),
  /** Thought signatures Gemini returned for earlier tool calls, keyed by call id. */
  signatures: z.record(z.string(), z.string()).default({}),
});
export type StudioTurn = z.infer<typeof StudioTurnSchema>;

export interface StudioToolCall {
  callId: string;
  name: string;
  /** JSON-encoded arguments, as Studio expects them. */
  arguments: string;
  signature?: string;
}

export interface StudioTurnResult {
  id: string;
  model: string;
  text: string;
  toolCalls: StudioToolCall[];
  status: "completed" | "incomplete";
  usage?: { inputTokens: number; outputTokens: number; totalTokens?: number; reasoningTokens?: number };
}

interface Part {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { name: string; args?: Record<string, unknown>; id?: string };
  functionResponse?: { name: string; id?: string; response: Record<string, unknown> };
}
interface Content {
  role: "user" | "model";
  parts: Part[];
}

/** Gemini wants a JSON object back from a tool. Studio's output is a string, often JSON. */
function toolResponse(output: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(output);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    return { result: parsed };
  } catch {
    return { result: output };
  }
}

function parseArgs(json: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(json || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const textOf = (content: z.infer<typeof TextPart>[]) => content.map((c) => c.text ?? c.refusal ?? "").join("");

/** Studio's conversation items -> Gemini `contents` (consecutive turns of one role merged) + extra system text. */
export function toGeminiContents(input: StudioTurn["input"], signatures: Record<string, string>): { contents: Content[]; system: string[] } {
  const contents: Content[] = [];
  const system: string[] = [];
  const callNames = new Map<string, string>();

  const push = (role: Content["role"], part: Part) => {
    const last = contents.at(-1);
    if (last && last.role === role) last.parts.push(part);
    else contents.push({ role, parts: [part] });
  };

  for (const item of input) {
    if (item.type === "message") {
      const text = textOf(item.content);
      if (!text) continue;
      if (item.role === "system") system.push(text);
      else push(item.role === "assistant" ? "model" : "user", { text });
    } else if (item.type === "function_call") {
      callNames.set(item.callId, item.name);
      const last = contents.at(-1);
      // Parallel calls share one signature, on the first call of the model's turn.
      const firstCallOfTurn = !(last?.role === "model" && last.parts.some((p) => p.functionCall));
      const signature = signatures[item.callId] ?? (firstCallOfTurn ? PLACEHOLDER_SIGNATURE : undefined);
      push("model", {
        functionCall: { name: item.name, args: parseArgs(item.arguments), id: item.callId },
        ...(signature ? { thoughtSignature: signature } : {}),
      });
    } else if (item.type === "function_call_output") {
      push("user", { functionResponse: { name: callNames.get(item.callId) ?? "tool", id: item.callId, response: toolResponse(item.output) } });
    }
  }
  return { contents, system };
}

/** JSON Schema as Studio emits it, minus the keyword Gemini rejects at the root. */
function cleanSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = schema;
  return rest;
}

export function toGeminiRequest(turn: StudioTurn) {
  const { contents, system } = toGeminiContents(turn.input, turn.signatures);
  const instructions = [turn.instructions, ...system].filter(Boolean).join("\n\n");
  const choice = turn.toolChoice ?? "auto";
  const mode = choice === "none" ? "NONE" : choice === "auto" ? "AUTO" : "ANY";
  const json = turn.responseFormat?.type === "json" ? turn.responseFormat : null;
  return {
    ...(instructions ? { systemInstruction: { parts: [{ text: instructions }] } } : {}),
    contents,
    ...(turn.tools.length
      ? {
          tools: [{ functionDeclarations: turn.tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: cleanSchema(t.parameters) })) }],
          toolConfig: { functionCallingConfig: { mode, ...(typeof choice === "object" ? { allowedFunctionNames: [choice.name] } : {}) } },
        }
      : {}),
    generationConfig: {
      maxOutputTokens: 8192,
      thinkingConfig: { thinkingLevel: "low" },
      ...(json ? { responseMimeType: "application/json", responseJsonSchema: cleanSchema(json.schema) } : {}),
    },
  };
}

interface GenerateResponse {
  responseId?: string;
  modelVersion?: string;
  candidates?: { content?: { parts?: Part[] }; finishReason?: string }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number; thoughtsTokenCount?: number };
  promptFeedback?: { blockReason?: string };
  error?: { message?: string; details?: { "@type"?: string; retryDelay?: string }[] };
}

export function fromGeminiResponse(body: GenerateResponse, model: string): StudioTurnResult {
  const candidate = body.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  if (!candidate) throw new StudioTurnError(502, `Gemini returned no answer${body.promptFeedback?.blockReason ? ` (${body.promptFeedback.blockReason})` : ""}`);
  const text = parts
    .filter((p) => p.text && !p.thought)
    .map((p) => p.text)
    .join("");
  let n = 0;
  const toolCalls = parts
    .filter((p) => p.functionCall)
    .map((p) => ({
      callId: p.functionCall!.id || `call_${body.responseId ?? Date.now()}_${n++}`,
      name: p.functionCall!.name,
      arguments: JSON.stringify(p.functionCall!.args ?? {}),
      ...(p.thoughtSignature ? { signature: p.thoughtSignature } : {}),
    }));
  if (!text && toolCalls.length === 0 && candidate.finishReason && candidate.finishReason !== "STOP" && candidate.finishReason !== "MAX_TOKENS") {
    throw new StudioTurnError(502, `Gemini stopped without an answer (${candidate.finishReason})`);
  }
  const u = body.usageMetadata;
  return {
    id: body.responseId ?? `gemini-${Date.now()}`,
    model: body.modelVersion ?? model,
    text,
    toolCalls,
    status: candidate.finishReason === "MAX_TOKENS" ? "incomplete" : "completed",
    ...(u
      ? {
          usage: {
            inputTokens: u.promptTokenCount ?? 0,
            outputTokens: u.candidatesTokenCount ?? 0,
            totalTokens: u.totalTokenCount,
            reasoningTokens: u.thoughtsTokenCount,
          },
        }
      : {}),
  };
}

export class StudioTurnError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

/** "12s" -> 12000. */
function retryDelayMs(body: GenerateResponse): number | null {
  const delay = body.error?.details?.find((d) => d.retryDelay)?.retryDelay;
  const seconds = delay ? Number.parseFloat(delay) : NaN;
  return Number.isFinite(seconds) ? seconds * 1000 : null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs the turn on `models[0]`. Free-tier limits are per model, so a rate limit or an overloaded
 * model moves on to the next one; if every model is rate limited, it waits once when Gemini says
 * the wait is short.
 */
export async function runStudioTurn(turn: StudioTurn, models: string[], apiKey: string, signal?: AbortSignal): Promise<StudioTurnResult> {
  const payload = JSON.stringify(toGeminiRequest(turn));
  const post = async (model: string) => {
    const res = await fetch(`${BASE}/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: payload,
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(90_000)]) : AbortSignal.timeout(90_000),
    });
    const raw: unknown = await res.json().catch(() => ({}));
    // Errors can arrive wrapped in a one-element array.
    const body = (Array.isArray(raw) ? (raw[0] ?? {}) : raw) as GenerateResponse;
    return { status: res.status, body };
  };

  let last: { status: number; body: GenerateResponse } | null = null;
  for (const model of models) {
    last = await post(model);
    if (last.status === 200) return fromGeminiResponse(last.body, model);
    if (last.status === 401 || last.status === 403) throw new StudioTurnError(502, `Gemini auth failed: ${last.body.error?.message ?? last.status}`);
    if (last.status === 400 || last.status === 404) throw new StudioTurnError(400, `Gemini rejected the request: ${last.body.error?.message ?? last.status}`);
    // 429 (free-tier limit) or 5xx (overloaded): try the next model.
  }

  const wait = last?.status === 429 ? retryDelayMs(last.body) : null;
  if (wait !== null && wait <= 20_000) {
    await sleep(wait + 500);
    const again = await post(models[0]!);
    if (again.status === 200) return fromGeminiResponse(again.body, models[0]!);
    last = again;
  }
  if (last?.status === 429) throw new StudioTurnError(429, "Gemini's free tier is busy (rate limit reached). Wait a minute and try again.");
  throw new StudioTurnError(502, `Gemini HTTP ${last?.status ?? "?"}: ${last?.body.error?.message ?? "no response"}`);
}

/** "gemini-3.6-flash" -> "Gemini 3.6 Flash". */
export const geminiModelLabel = (id: string) =>
  id
    .split("-")
    .map((w) => (w === "lite" ? "Lite" : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ")
    .replace(/ Lite$/, "-Lite");
