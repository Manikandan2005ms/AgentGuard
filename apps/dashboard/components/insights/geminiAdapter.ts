import type { AgAiEvent, AgAiOutputItem, AgLlmAdapter, AgLlmRequest, AgLlmResponse } from "ag-studio";
import { API_URL } from "@/lib/api";

/**
 * AG Studio's LLM adapter, pointed at AgentGuard's own API instead of a model provider. The API
 * (POST /api/insights/ai/turn) holds the Gemini key, translates the turn to Gemini's free tier and
 * returns text plus tool calls; Studio runs the tools here in the browser and asks again.
 */

interface TurnReply {
  id: string;
  model: string;
  text: string;
  toolCalls: { callId: string; name: string; arguments: string; signature?: string }[];
  status: "completed" | "incomplete";
  usage?: AgLlmResponse["usage"];
}

export function agentGuardGeminiAdapter(): AgLlmAdapter {
  // Gemini's thought signature for each tool call, sent back on later turns of the conversation.
  const signatures = new Map<string, string>();

  return {
    executeTurn(request: AgLlmRequest, options) {
      const { input, instructions, tools, toolChoice, responseFormat, model } = request;
      const known = new Set(input.flatMap((item) => (item.type === "function_call" ? [item.callId] : [])));

      const reply = fetch(`${API_URL}/api/insights/ai/turn`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input,
          instructions,
          tools: (tools ?? []).filter((t) => t.kind !== "provided").map(({ name, description, parameters }) => ({ name, description, parameters })),
          toolChoice,
          responseFormat,
          model: model?.id,
          signatures: Object.fromEntries([...signatures].filter(([id]) => known.has(id))),
        }),
        signal: options?.signal,
      }).then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body?.error ?? `AgentGuard API ${res.status}`);
        const turn = body as TurnReply;
        for (const c of turn.toolCalls) if (c.signature) signatures.set(c.callId, c.signature);
        return turn;
      });

      const complete: Promise<AgLlmResponse> = reply.then((turn) => {
        const output: AgAiOutputItem[] = [];
        if (turn.text) {
          output.push({ id: `${turn.id}-text`, kind: "output", type: "message", role: "assistant", status: "completed", content: [{ type: "text", text: turn.text, annotations: [] }] });
        }
        for (const c of turn.toolCalls) {
          output.push({ id: `${turn.id}-${c.callId}`, kind: "output", type: "function_call", callId: c.callId, name: c.name, arguments: c.arguments, status: "completed" });
        }
        return { id: turn.id, createdAt: Date.now(), model: turn.model, status: turn.status, output, usage: turn.usage };
      });
      // The run reports a failure through `complete`; this keeps an abandoned stream from also raising it as unhandled.
      complete.catch(() => {});

      async function* stream(): AsyncGenerator<AgAiEvent> {
        let turn: TurnReply;
        try {
          turn = await reply;
        } catch {
          return;
        }
        if (turn.text) {
          const messageId = `${turn.id}-text`;
          yield { type: "TEXT_MESSAGE_START", messageId, role: "assistant" };
          // A few deltas rather than one block, so the panel shows the answer arriving.
          for (let i = 0; i < turn.text.length; i += 120) yield { type: "TEXT_MESSAGE_CONTENT", messageId, delta: turn.text.slice(i, i + 120) };
          yield { type: "TEXT_MESSAGE_END", messageId };
        }
        for (const c of turn.toolCalls) {
          yield { type: "TOOL_CALL_START", toolCallId: c.callId, toolCallName: c.name };
          yield { type: "TOOL_CALL_ARGS", toolCallId: c.callId, delta: c.arguments };
          yield { type: "TOOL_CALL_END", toolCallId: c.callId };
        }
      }

      const events = stream();
      return { stream: { [Symbol.asyncIterator]: () => events }, complete };
    },
  };
}
