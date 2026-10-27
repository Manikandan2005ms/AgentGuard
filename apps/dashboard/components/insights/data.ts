import type { AgDataSourcesDefinition, AgFieldDefinition } from "ag-studio";
import { techniqueLabel } from "@/lib/techniques";
import type { InsightsRegistry } from "./widgets";

/** GET /api/insights/data */
export interface InsightsData {
  generatedAt: string;
  payments: Record<string, unknown>[];
  signals: Record<string, unknown>[];
  threats: (Record<string, unknown> & { technique: string })[];
  budgets: Record<string, unknown>[];
  merchants: Record<string, unknown>[];
}

type Field = AgFieldDefinition<InsightsRegistry>;

const USD = { format: "$#,##0.00" };
const text = (id: string, name: string, description?: string): Field => ({ id, name, description, format: "textFormat" });
const hidden = (id: string): Field => ({ id, format: "textFormat", hide: true });
const usd = (id: string, name: string, description?: string): Field => ({ id, name, description, format: "currencyFormat", formatOptions: USD });
const count = (id: string, name: string, description: string): Field => ({ id, name, description, format: "integerFormat" });

const PAYMENT_FIELDS: Field[] = [
  hidden("id"),
  { id: "createdAt", name: "Requested at", format: "dateTimeFormat", description: "When the agent asked to pay." },
  { id: "day", name: "Day", format: "dateFormat", formatOptions: { format: "d mmm" }, description: "Calendar day of the request. Use it for anything per day." },
  text("type", "Type", "'Purchase' for a guarded payment, or 'Toolkit: <tool>' for a guarded PayPal Agent Toolkit call such as create_refund."),
  text("merchant", "Merchant"),
  hidden("merchantDomain"),
  text("category", "Category", "Spending category, e.g. Groceries, Electronics, Gift cards."),
  text("item", "Item"),
  usd("amount", "Amount requested", "What the agent asked to pay, whether or not it was allowed."),
  usd("spent", "Captured spend", "Money actually captured through PayPal (paid purchases only). Use this for spend."),
  text("decision", "Decision", "AgentGuard's verdict: Approved, Asked you, or Blocked."),
  text("status", "Status", "Payment state: Paid, Held, Pending, Voided, Blocked, Failed or Refunded."),
  { id: "riskScore", name: "Risk score", format: "integerFormat", description: "0-100. At 35 AgentGuard asks the human; at 70 it blocks. Average it for a risk level." },
  text("riskBand", "Risk band", "Low (0-34), Medium (35-69) or High (70+)."),
  text("decidedBy", "Decided by", "engine, human or timeout."),
  text("explanation", "Explanation", "One-sentence reason for the decision."),
  count("requests", "Requests", "1 per request. Sum it to count requests."),
  count("approved", "Approved", "1 if approved. Sum it for approvals."),
  count("asked", "Asked you", "1 if sent to the human for approval. Sum it."),
  count("blocked", "Blocked", "1 if blocked. Sum it for blocks."),
  count("injections", "Attacks blocked", "1 if a prompt-injection attack was caught and blocked. Sum it."),
  count("refunds", "Refunds", "1 if money went back out (a refunded payment or a toolkit refund). Sum it per day to spot refund spikes."),
  count("failures", "Failed payments", "1 if PayPal did not complete the payment. Sum it per day to spot failures."),
];

const SIGNAL_FIELDS: Field[] = [
  hidden("key"),
  hidden("paymentId"),
  text("signal", "Risk signal", "Which check added risk, e.g. new merchant, injection, unusual amount."),
  text("source", "Signal source", "Rule (deterministic) or AI check."),
  { id: "points", name: "Risk points", format: "integerFormat", description: "Points this signal added to the request's risk score." },
  text("detail", "Signal detail"),
];

const THREAT_FIELDS: Field[] = [
  hidden("key"),
  hidden("paymentId"),
  { id: "createdAt", name: "Caught at", format: "dateTimeFormat" },
  text("merchant", "Attack source", "The store whose page carried the injection."),
  text("item", "Attacked item"),
  usd("amount", "Attacked amount"),
  text("technique", "Technique", "How the instruction was hidden, e.g. display:none, white-on-white text, HTML comment."),
  text("hidden", "Visibility", "Hidden from view, or Visible text."),
  text("snippet", "Hidden text", "The injected instruction AgentGuard pulled out of the page."),
  text("outcome", "Outcome", "AgentGuard's decision on the attacked request."),
];

const BUDGET_FIELDS: Field[] = [
  text("budget", "Budget", "Category and period, e.g. Groceries / week."),
  text("period", "Budget period"),
  usd("limit", "Budget limit"),
  usd("spent", "Budget spent"),
  usd("held", "Budget held", "Money authorized but waiting for approval."),
  usd("remaining", "Budget remaining"),
  { id: "used", name: "Budget used", format: "percentageFormat", formatOptions: { format: "0%" }, description: "(spent + held) / limit." },
];

const MERCHANT_FIELDS: Field[] = [
  hidden("merchantDomain"),
  text("merchantName", "Store"),
  text("merchantCategory", "Store category"),
  { id: "ageDays", name: "Store age (days)", format: "integerFormat" },
  text("storeAge", "Store age", "New (under 30 days) or Established. New stores add risk."),
];

/** Studio's data model for AgentGuard: payment requests at the centre, with signals, attacks and stores around them. */
export function buildStudioData(d: InsightsData): AgDataSourcesDefinition<InsightsRegistry> {
  return {
    description:
      "AgentGuard is a spending firewall for AI agents on PayPal. Every payment an agent asks for is a row in payments, with " +
      "AgentGuard's decision (Approved / Asked you / Blocked), a 0-100 risk score and the PayPal outcome. signals explains each " +
      "risk score, threats holds prompt-injection attacks with the hidden text, budgets tracks spending limits, merchants describes stores.",
    sources: [
      { id: "payments", name: "Payment requests", description: "One row per payment or PayPal toolkit call an agent requested (last 90 days).", data: d.payments, fields: PAYMENT_FIELDS },
      { id: "signals", name: "Risk signals", description: "One row per risk signal that added points to a request.", data: d.signals, fields: SIGNAL_FIELDS },
      {
        id: "threats",
        name: "Injection attacks",
        description: "One row per hidden instruction found on a store page.",
        data: d.threats.map((t) => ({ ...t, technique: techniqueLabel(t.technique).title })),
        fields: THREAT_FIELDS,
      },
      { id: "budgets", name: "Budgets", description: "Spending limits from the active policy and how much of each is used.", data: d.budgets, fields: BUDGET_FIELDS },
      { id: "merchants", name: "Stores", description: "The stores agents buy from.", data: d.merchants, fields: MERCHANT_FIELDS },
    ],
    relationships: [
      { id: "payments-merchants", source: { tableId: "payments", fieldId: "merchantDomain" }, target: { tableId: "merchants", fieldId: "merchantDomain" }, type: "many-to-one" },
      { id: "signals-payments", source: { tableId: "signals", fieldId: "paymentId" }, target: { tableId: "payments", fieldId: "id" }, type: "many-to-one" },
      { id: "threats-payments", source: { tableId: "threats", fieldId: "paymentId" }, target: { tableId: "payments", fieldId: "id" }, type: "many-to-one" },
    ],
  };
}
