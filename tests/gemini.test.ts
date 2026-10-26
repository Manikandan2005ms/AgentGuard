import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { geminiOnce, geminiRequest, geminiSchema, readInteraction } from "../apps/api/src/ai/gemini";
import type { StructuredCall } from "../apps/api/src/ai/llm";

const Verdict = z.object({
  version: z.literal(1),
  aligned: z.boolean(),
  limit: z.number().nullable(),
  period: z.enum(["day", "week"]),
  quotes: z.array(z.string()),
  nested: z.object({ kind: z.union([z.enum(["a", "b"]), z.literal("*")]) }),
});

const call: StructuredCall<z.infer<typeof Verdict>> = {
  name: "test",
  schema: Verdict,
  system: "You are a test.",
  user: "Classify this.",
  tier: "fast",
};

const answer = { version: 1, aligned: false, limit: null, period: "day", quotes: ["gift card"], nested: { kind: "*" } };

function interaction(json: unknown, extra: Record<string, unknown> = {}) {
  return {
    model: "gemini-test",
    status: "completed",
    steps: [
      { type: "thought", content: [{ type: "text", text: "thinking out loud, not JSON" }] },
      { type: "model_output", content: [{ type: "text", text: JSON.stringify(json) }] },
    ],
    ...extra,
  };
}

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

afterEach(() => vi.unstubAllGlobals());

describe("Gemini schema", () => {
  it("drops $schema and writes const as a one-value enum", () => {
    const json = geminiSchema(Verdict);
    const text = JSON.stringify(json);
    expect(json.$schema).toBeUndefined();
    expect(text).not.toContain('"const"');
    expect(json.type).toBe("object");
    const props = json.properties as Record<string, Record<string, unknown>>;
    expect(props.version!.enum).toEqual([1]);
    expect(JSON.stringify(props.limit)).toContain('"null"');
    expect(props.period!.enum).toEqual(["day", "week"]);
  });
});

describe("Gemini request", () => {
  it("sends the system prompt, input, schema and limits", () => {
    const body = geminiRequest({ ...call, tier: "main", effort: "high" }, "gemini-x");
    expect(body.model).toBe("gemini-x");
    expect(body.system_instruction).toBe("You are a test.");
    expect(body.input).toBe("Classify this.");
    expect(body.response_format).toMatchObject({ type: "text", mime_type: "application/json" });
    expect(body.generation_config).toEqual({ max_output_tokens: 16000, thinking_level: "high" });
    expect(body.store).toBe(false);
  });

  it("uses a small budget and low thinking for fast checks, and can leave thinking out", () => {
    expect(geminiRequest(call, "m").generation_config).toEqual({ max_output_tokens: 4096, thinking_level: "low" });
    expect(geminiRequest(call, "m", false).generation_config).toEqual({ max_output_tokens: 4096 });
  });
});

describe("Gemini response", () => {
  it("reads the model output and skips thought steps", () => {
    expect(readInteraction(interaction(answer), "fallback")).toEqual({ stop: "done", output: answer, model: "gemini-test" });
  });

  it("reports truncation, and throws on failed or non-JSON replies so the caller retries", () => {
    expect(readInteraction({ status: "incomplete" }, "m")).toEqual({ stop: "max_tokens" });
    expect(() => readInteraction({ status: "failed" }, "m")).toThrow(/failed/);
    expect(() => readInteraction({ status: "completed", steps: [] }, "m")).toThrow(/no text/);
    expect(() => readInteraction({ status: "completed", steps: [{ type: "model_output", content: [{ type: "text", text: "nope" }] }] }, "m")).toThrow(/not JSON/);
  });
});

describe("Gemini call", () => {
  it("posts to the Interactions API with the key in a header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(200, interaction(answer)));
    vi.stubGlobal("fetch", fetchMock);
    const res = await geminiOnce(call, "gemini-test", "test-key");
    expect(res).toEqual({ stop: "done", output: answer, model: "gemini-test" });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/interactions");
    expect(init.headers["x-goog-api-key"]).toBe("test-key");
    expect(String(url)).not.toContain("test-key");
  });

  it("asks again without thinking_level when the model rejects it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reply(400, { error: { message: "thinking_level is not supported for this model" } }))
      .mockResolvedValueOnce(reply(200, interaction(answer)));
    vi.stubGlobal("fetch", fetchMock);
    const res = await geminiOnce(call, "m", "k");
    expect(res.stop).toBe("done");
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body).generation_config.thinking_level).toBeUndefined();
  });

  it("does not retry a bad key", async () => {
    // The live API wraps this error in an array.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(400, [{ error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT" } }])));
    expect(await geminiOnce(call, "m", "k")).toEqual({ stop: "fatal", error: "Gemini rejected the request: API key not valid. Please pass a valid API key." });
  });

  it("throws on overload and rate limits so the caller retries on the fast model", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(503, { error: { message: "gemini-x is currently experiencing high demand" } })));
    await expect(geminiOnce(call, "m", "k")).rejects.toThrow("Gemini HTTP 503: gemini-x is currently experiencing high demand");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(429, { error: { message: "Quota exceeded" } })));
    await expect(geminiOnce(call, "m", "k")).rejects.toThrow(/rate limit/);
  });
});
