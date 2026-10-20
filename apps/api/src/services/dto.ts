import type {
  DecisionType,
  InjectionEvidence,
  PayStatusType,
  PaymentRequestDTO,
  RiskSignal,
  RuleResult,
} from "@agentguard/shared";
import type { Merchant, PaymentRequest, Task } from "@prisma/client";

export type PaymentRow = PaymentRequest & { task: Task | null; merchant: Merchant | null };

export const withRelations = { task: true, merchant: true } as const;

interface StoredAiChecks {
  injectionEvidence?: InjectionEvidence[];
  intentReason?: string | null;
}

export function toDTO(r: PaymentRow): PaymentRequestDTO {
  const ai = (r.aiChecks ?? {}) as StoredAiChecks;
  return {
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    resolvedAt: r.resolvedAt?.toISOString() ?? null,
    taskId: r.taskId,
    taskDescription: r.task?.description ?? null,
    merchantDomain: r.merchantDomain,
    merchantName: r.merchant?.name ?? null,
    item: r.item,
    quantity: r.quantity,
    category: r.category,
    amount: Number(r.amount),
    currency: r.currency,
    decision: r.decision as DecisionType,
    status: r.status as PayStatusType,
    riskScore: r.riskScore,
    signals: (r.signals ?? []) as unknown as RiskSignal[],
    rulesFired: (r.rulesFired ?? []) as unknown as RuleResult[],
    injectionDetected: r.injectionDetected,
    injectionEvidence: ai.injectionEvidence ?? [],
    intentAligned: r.intentAligned,
    intentReason: ai.intentReason ?? null,
    explanation: r.explanation,
    decidedBy: r.decidedBy,
    paypalOrderId: r.paypalOrderId,
    paypalAuthId: r.paypalAuthId,
    paypalCaptureId: r.paypalCaptureId,
    approveUrl: r.approveUrl,
    failureReason: r.failureReason,
    reconciledAt: r.reconciledAt?.toISOString() ?? null,
    sourceExcerpt: r.sourceExcerpt,
  };
}
