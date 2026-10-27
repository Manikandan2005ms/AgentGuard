import {
  createAiHarness,
  directLlmRunner,
  type AgAiAgentContext,
  type AgAiHarnessSetup,
  type AgAiModel,
  type AgAiPromptStarter,
  type AgStudioApi,
} from "ag-studio";
import { agentGuardGeminiAdapter } from "./geminiAdapter";
import { sentinelTools } from "./sentinel";
import type { InsightsRegistry } from "./widgets";

/**
 * Studio's Agent Framework on Gemini's free tier. Studio's five built-in agents (lead, planning,
 * data, page, widget) build and change the dashboard; AgentGuard adds the Sentinel, an
 * anomaly-alert agent the lead hands suspicious-activity questions to. Every agent's turns go
 * through AgentGuard's API, which holds the Gemini key.
 */

const PROMPT_STARTERS: AgAiPromptStarter[] = [
  {
    label: "Flag anything suspicious",
    prompt: "Check recent agent payments for anything suspicious, like refund spikes, failed payments or bursts of attacks, and put an alert on the Sentinel page for each finding.",
  },
  { label: "Chart refunds and failures", prompt: "Add a column chart of refunds and failed payments per day to this page." },
  { label: "Where do attacks come from?", prompt: "Which stores sent the most injection attacks, and what did the hidden text try to make the agent do?" },
];

const AGENTGUARD_CONTEXT = [
  "This dashboard belongs to AgentGuard, a spending firewall for AI agents on PayPal. The owner is not technical: answer in plain words and short sentences, no jargon or emoji.",
  "payments has one row per payment an AI agent asked for. decision is AgentGuard's verdict (Approved, Asked you, Blocked); riskScore is 0-100 (35 asks the owner, 70 blocks).",
  "For counts per day, sum the 0/1 fields (requests, approved, asked, blocked, injections, refunds, failures) by payments.day. For money actually spent use payments.spent, not amount.",
].join("\n");

const SENTINEL_INSTRUCTIONS = [
  "You are the Sentinel, AgentGuard's anomaly-alert agent. You watch the stream of payments AI agents make through AgentGuard and raise alerts the owner can act on.",
  "1. Read the scan_transactions result you were given (call it again only if you need a different time window).",
  "2. Call flag_anomaly once for every finding of medium or high severity, all in parallel in one turn. Flag low-severity findings only if the owner asked for everything. Write each headline and explanation yourself, in plain words for a non-technical owner, using the numbers from the scan.",
  "3. Then reply in two or three sentences: what you flagged and the single most important thing to do. If the scan found nothing, say traffic looks normal and flag nothing.",
  "Never invent an anomaly, a number or a merchant that is not in the scan. You cannot freeze the agent or refund anything yourself; tell the owner where to do it (the Freeze button, or the Audit log).",
].join("\n");

const LEAD_ADDENDUM = [
  "",
  "AgentGuard context:",
  AGENTGUARD_CONTEXT,
  "You also lead the Sentinel, an agent that scans the transaction stream with AgentGuard's anomaly rules and places alert widgets on the 'Sentinel alerts' page.",
  "Delegate to sentinel whenever the request is about anomalies, alerts, monitoring, or anything suspicious or unusual (refund spikes, failed payments, bursts of attacks, risk going up, budgets running out). Do not build those alerts yourself.",
].join("\n");

export function insightsAi(models: AgAiModel[], phone: () => boolean): AgAiHarnessSetup {
  const adapter = agentGuardGeminiAdapter();
  return ({ api }) => {
    const studioApi = api as unknown as AgStudioApi<InsightsRegistry>;
    const { scan, flag } = sentinelTools(studioApi, phone);

    return createAiHarness(api, ({ builtIn, tools }) => {
      const { lead, ...specialists } = builtIn;
      return {
        agents: [
          // Studio's own lead, told about AgentGuard and allowed to hand work to the Sentinel too.
          directLlmRunner({
            ...lead,
            adapter,
            instructions: (ctx: AgAiAgentContext, params: unknown) => `${lead.instructions?.(ctx, params) ?? ""}\n${LEAD_ADDENDUM}`,
            tools: (ctx: AgAiAgentContext, params: unknown) => [
              ...(lead.tools?.(ctx, params) ?? []).filter((t) => t.name !== "delegate_to"),
              ctx.tools.delegateTo(["data", "page", "planning", "widget", "sentinel"]),
            ],
          }),
          // Planning, data, page and widget, as Studio ships them, with AgentGuard's field guide added.
          ...Object.values(specialists).map((definition) =>
            directLlmRunner({
              ...definition,
              adapter,
              instructions: (ctx: AgAiAgentContext, params: unknown) => `${definition.instructions?.(ctx, params) ?? ""}\n\nAgentGuard context:\n${AGENTGUARD_CONTEXT}`,
            }),
          ),
          directLlmRunner({
            id: "sentinel",
            name: "Sentinel",
            description:
              "AgentGuard's anomaly-alert agent. Scans the transaction stream for refund spikes, failed payments, attack bursts, rising risk and budgets running out, and places an alert widget for each finding on the 'Sentinel alerts' page.",
            schema: (s) => s.undefined(),
            adapter,
            instructions: () => SENTINEL_INSTRUCTIONS,
            tools: () => [scan, flag, tools.studio.executeQuery()],
            // Scan before the first turn, so the model starts with the findings and spends no call on fetching them.
            defaultToolCalls: () => [{ tool: "scan_transactions", args: {} }],
            maxTurns: 6,
          }),
        ],
        primary: "lead",
        models,
        promptStarters: PROMPT_STARTERS,
      };
    });
  };
}
