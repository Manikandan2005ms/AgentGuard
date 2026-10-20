import { z } from "zod";

export type RuleOutcome = "pass" | "ask" | "block";

export interface RuleResult {
  rule_id: string;
  outcome: RuleOutcome;
  detail: string;
}

export const DECISIONS = ["APPROVE", "ASK_HUMAN", "BLOCK"] as const;
export type DecisionType = (typeof DECISIONS)[number];

export const PAY_STATUSES = ["PENDING", "HELD", "PAID", "VOIDED", "BLOCKED", "FAILED", "REFUNDED"] as const;
export type PayStatusType = (typeof PAY_STATUSES)[number];

export interface RiskSignal {
  id: string;
  points: number;
  detail: string;
  /** "ai" signals may only ever raise risk (README §5 security principle). */
  source: "deterministic" | "ai";
}

/** What an agent sends to request a payment (MCP `request_payment` / REST). */
export const PaymentRequestInputSchema = z.object({
  task_id: z.string().optional(),
  merchant_domain: z.string().min(1).max(253),
  item: z.string().min(1).max(300),
  quantity: z.number().int().positive().max(1000).default(1),
  /** Total amount for the line (unit price x quantity). */
  amount: z.number().positive().max(1_000_000),
  currency: z.string().length(3).default("USD"),
  sku: z.string().max(100).optional(),
  /** The page content the agent saw before deciding to buy. Treated as untrusted data. */
  source_page_content: z.string().max(400_000).optional(),
  source_url: z.string().max(2000).optional(),
});
export type PaymentRequestInput = z.infer<typeof PaymentRequestInputSchema>;

export type AgentStatus = "approved" | "pending_approval" | "blocked" | "rejected" | "failed";

/** Structured result returned to the agent (README §11.3). */
export interface AgentResult {
  status: AgentStatus;
  request_id: string;
  decision: DecisionType;
  risk_score: number;
  reason: string;
  safe_next_step: string;
  payment_status: PayStatusType;
  paypal?: { order_id?: string | null; capture_id?: string | null };
  approve_url?: string | null;
}

export interface InjectionEvidence {
  technique: string;
  snippet: string;
  hidden: boolean;
}

/** JSON shape of a payment request as the dashboard sees it. */
export interface PaymentRequestDTO {
  id: string;
  createdAt: string;
  resolvedAt: string | null;
  taskId: string | null;
  taskDescription: string | null;
  merchantDomain: string;
  merchantName: string | null;
  item: string;
  quantity: number;
  category: string | null;
  amount: number;
  currency: string;
  decision: DecisionType;
  status: PayStatusType;
  riskScore: number;
  signals: RiskSignal[];
  rulesFired: RuleResult[];
  injectionDetected: boolean;
  injectionEvidence: InjectionEvidence[];
  intentAligned: boolean | null;
  intentReason: string | null;
  explanation: string;
  decidedBy: string;
  paypalOrderId: string | null;
  paypalAuthId: string | null;
  paypalCaptureId: string | null;
  approveUrl: string | null;
  failureReason: string | null;
  reconciledAt: string | null;
  sourceExcerpt: string | null;
}

export interface BudgetUsageDTO {
  category: string;
  period: "day" | "week" | "month";
  limit: number;
  spent: number;
  held: number;
}

export type LiveEvent =
  | { type: "payment.created"; payment: PaymentRequestDTO }
  | { type: "payment.updated"; payment: PaymentRequestDTO }
  | { type: "killswitch"; enabled: boolean }
  | { type: "policy.activated"; policyId: string };
