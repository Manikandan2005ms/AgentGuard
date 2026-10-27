import { afterEach, describe, expect, it, vi } from "vitest";
import { detectAnomalies, type AnomalyRow } from "../apps/api/src/core/anomalies";
import {
  fromGeminiResponse,
  geminiModelLabel,
  PLACEHOLDER_SIGNATURE,
  runStudioTurn,
  StudioTurnSchema,
  toGeminiRequest,
} from "../apps/api/src/ai/studioTurn";

const NOW = Date.parse("2026-10-27T12:00:00Z");
const HOUR = 3_600_000;
let seq = 0;

function row(hoursAgo: number, extra: Partial<AnomalyRow> = {}): AnomalyRow {
  return {
    id: `r${seq++}`,
    createdAt: new Date(NOW - hoursAgo * HOUR),
    kind: "payment",
    toolName: null,
    status: "PAID",
    decision: "APPROVE",
    amount: 20,
    riskScore: 5,
    injectionDetected: false,
    merchant: "FreshCart",
    failureReason: null,
    ...extra,
  };
}

describe("anomaly detection", () => {
  it("finds nothing in quiet, normal traffic", () => {
    const rows = [row(2), row(30), row(50), row(80)];
    expect(detectAnomalies(rows, [], NOW)).toEqual([]);
  });

  it("flags a refund spike against an empty baseline, counting toolkit refunds too", () => {
    const rows = [
      row(1, { status: "REFUNDED", amount: 120 }),
      row(3, { kind: "paypal_tool", toolName: "create_refund", amount: 90, merchant: "PayPal account" }),
      row(5, { status: "REFUNDED", amount: 15 }),
    ];
    const [spike] = detectAnomalies(rows, [], NOW);
    expect(spike).toMatchObject({ kind: "refund_spike", value: 3, baseline: 0, severity: "high", trendField: "refunds" });
    expect(spike!.sampleIds[0]).toBe(rows[0]!.id);
    expect(spike!.detail).toContain("3 refund attempts ($225.00 requested)");
  });

  it("counts blocked and failed refund attempts, and says how many went through", () => {
    const refund = { kind: "paypal_tool", toolName: "create_refund", merchant: "PayPal account" };
    const rows = [row(1, { ...refund, status: "PAID", amount: 3.99 }), row(2, { ...refund, status: "BLOCKED", amount: 0 }), row(3, { ...refund, status: "FAILED" })];
    const spike = detectAnomalies(rows, [], NOW).find((a) => a.kind === "refund_spike");
    expect(spike!.detail).toContain("1 went through, 1 blocked, 1 failed at PayPal");
  });

  it("does not call a normal refund rate a spike", () => {
    // 14 refunds over the previous week = 2 a day; 2 today is normal.
    const history = Array.from({ length: 14 }, (_, i) => row(30 + i * 10, { status: "REFUNDED" }));
    const rows = [...history, row(1, { status: "REFUNDED" }), row(2, { status: "REFUNDED" })];
    expect(detectAnomalies(rows, [], NOW).map((a) => a.kind)).not.toContain("refund_spike");
  });

  it("reports failed payments with their reason", () => {
    const rows = [
      row(1, { status: "FAILED", failureReason: "PayPal toolkit call failed: Business validation: INSTRUMENT_DECLINED (HTTP 422)" }),
      row(4, { status: "FAILED" }),
    ];
    const [failed] = detectAnomalies(rows, [], NOW);
    expect(failed).toMatchObject({ kind: "failed_payments", value: 2, severity: "medium" });
    expect(failed!.detail).toContain("Reason: INSTRUMENT_DECLINED (HTTP 422).");
  });

  it("names the merchants behind an injection burst and sorts high severity first", () => {
    const attack = { injectionDetected: true, decision: "BLOCK", status: "BLOCKED", riskScore: 95, merchant: "MegaDealz" };
    const rows = [...Array.from({ length: 5 }, (_, i) => row(i + 1, attack)), row(2, { status: "FAILED" })];
    const found = detectAnomalies(rows, [], NOW);
    expect(found[0]).toMatchObject({ kind: "attack_burst", severity: "high", merchants: ["MegaDealz"] });
    expect(found.at(-1)!.severity).toBe("low");
  });

  it("flags budgets at 90% or more", () => {
    const found = detectAnomalies([], [{ label: "Groceries / week", limit: 150, spent: 120, held: 20 }], NOW);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: "budget_pressure", value: 93, severity: "medium" });
  });
});

const turn = StudioTurnSchema.parse({
  instructions: "You build dashboards.",
  input: [
    { id: "m1", kind: "input", type: "message", role: "system", content: [{ type: "text", text: "Data: payments." }], status: "completed" },
    { id: "m2", kind: "input", type: "message", role: "user", content: [{ type: "text", text: "Chart refunds" }], status: "completed" },
    { id: "c1", kind: "output", type: "function_call", callId: "call_1", name: "view_schema", arguments: "{}" },
    { id: "c2", kind: "output", type: "function_call", callId: "call_2", name: "execute_query", arguments: '{"query":{"limit":5}}' },
    { kind: "input", type: "function_call_output", callId: "call_1", output: '{"tables":["payments"]}', status: "completed" },
    { kind: "input", type: "function_call_output", callId: "call_2", output: "3 rows", status: "completed" },
    { id: "a1", kind: "output", type: "message", role: "assistant", content: [{ type: "text", text: "Done.", annotations: [] }], status: "completed" },
  ],
  tools: [{ name: "add_widget", description: "Add a widget", parameters: { $schema: "https://json-schema.org/draft/2020-12/schema", type: "object", properties: {} } }],
  toolChoice: { name: "add_widget" },
  signatures: { call_1: "sig-1" },
});

describe("Studio turn -> Gemini", () => {
  it("maps Studio's conversation, tools and tool choice onto generateContent", () => {
    const body = toGeminiRequest(turn);
    expect(body.systemInstruction?.parts[0]?.text).toBe("You build dashboards.\n\nData: payments.");
    expect(body.contents.map((c) => c.role)).toEqual(["user", "model", "user", "model"]);
    // Parallel calls stay in one model turn; the signature rides on the first.
    const calls = body.contents[1]!.parts;
    expect(calls.map((p) => p.functionCall?.name)).toEqual(["view_schema", "execute_query"]);
    expect(calls[0]!.thoughtSignature).toBe("sig-1");
    expect(calls[1]!.thoughtSignature).toBeUndefined();
    expect(calls[1]!.functionCall?.args).toEqual({ query: { limit: 5 } });
    // Tool results are objects, named after their call.
    const results = body.contents[2]!.parts;
    expect(results[0]!.functionResponse).toEqual({ name: "view_schema", id: "call_1", response: { tables: ["payments"] } });
    expect(results[1]!.functionResponse?.response).toEqual({ result: "3 rows" });
    expect(body.tools?.[0]?.functionDeclarations[0]?.parametersJsonSchema).toEqual({ type: "object", properties: {} });
    expect(body.toolConfig?.functionCallingConfig).toEqual({ mode: "ANY", allowedFunctionNames: ["add_widget"] });
  });

  it("uses Gemini's placeholder signature for a call it has no signature for", () => {
    const body = toGeminiRequest({ ...turn, signatures: {} });
    expect(body.contents[1]!.parts[0]!.thoughtSignature).toBe(PLACEHOLDER_SIGNATURE);
  });

  it("turns Gemini's reply into text, tool calls and usage", () => {
    const result = fromGeminiResponse(
      {
        responseId: "r1",
        modelVersion: "gemini-3.6-flash",
        candidates: [
          {
            finishReason: "STOP",
            content: {
              parts: [
                { text: "thinking", thought: true },
                { text: "Adding it." },
                { functionCall: { name: "add_widget", args: { type: "line-chart" }, id: "call_9" }, thoughtSignature: "sig-9" },
              ],
            },
          },
        ],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 20, thoughtsTokenCount: 5 },
      },
      "gemini-3.6-flash",
    );
    expect(result).toMatchObject({ text: "Adding it.", status: "completed", usage: { inputTokens: 10, outputTokens: 5, reasoningTokens: 5 } });
    expect(result.toolCalls).toEqual([{ callId: "call_9", name: "add_widget", arguments: '{"type":"line-chart"}', signature: "sig-9" }]);
  });

  it("labels models for the picker", () => {
    expect(geminiModelLabel("gemini-3.6-flash")).toBe("Gemini 3.6 Flash");
    expect(geminiModelLabel("gemini-3.5-flash-lite")).toBe("Gemini 3.5 Flash-Lite");
  });
});

describe("Studio turn retries", () => {
  afterEach(() => vi.unstubAllGlobals());
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
  const ok = { candidates: [{ finishReason: "STOP", content: { parts: [{ text: "hi" }] } }] };

  it("moves to the next model when the first is rate limited", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(reply(429, { error: { message: "quota" } })).mockResolvedValueOnce(reply(200, ok));
    vi.stubGlobal("fetch", fetchMock);
    const result = await runStudioTurn(turn, ["gemini-main", "gemini-fast"], "key");
    expect(result.text).toBe("hi");
    expect(String(fetchMock.mock.calls[1]![0])).toContain("gemini-fast:generateContent");
  });

  it("gives a plain 429 when every model is rate limited", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => reply(429, { error: { message: "quota" } })));
    await expect(runStudioTurn(turn, ["gemini-main"], "key")).rejects.toMatchObject({ statusCode: 429 });
  });

  it("does not retry a request Gemini rejects", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply(400, { error: { message: "bad schema" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(runStudioTurn(turn, ["a", "b"], "key")).rejects.toMatchObject({ statusCode: 400 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
