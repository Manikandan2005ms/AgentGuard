import type { DecisionType, PayStatusType } from "@agentguard/shared";

const DECISION: Record<DecisionType, { label: string; cls: string }> = {
  APPROVE: { label: "Approved", cls: "bg-ok/15 text-ok border-ok/30" },
  ASK_HUMAN: { label: "Ask human", cls: "bg-warn/15 text-warn border-warn/30" },
  BLOCK: { label: "Blocked", cls: "bg-bad/15 text-bad border-bad/30" },
};

const STATUS: Record<PayStatusType, { label: string; cls: string }> = {
  PENDING: { label: "Awaiting PayPal", cls: "bg-warn/10 text-warn border-warn/30" },
  HELD: { label: "Funds held", cls: "bg-warn/10 text-warn border-warn/30" },
  PAID: { label: "Captured", cls: "bg-ok/10 text-ok border-ok/30" },
  VOIDED: { label: "Voided", cls: "bg-white/5 text-muted border-line" },
  BLOCKED: { label: "No money moved", cls: "bg-bad/10 text-bad border-bad/30" },
  FAILED: { label: "Failed", cls: "bg-bad/10 text-bad border-bad/30" },
  REFUNDED: { label: "Refunded", cls: "bg-white/5 text-muted border-line" },
};

const base = "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold whitespace-nowrap";

export function DecisionPill({ decision }: { decision: DecisionType }) {
  const d = DECISION[decision];
  return <span className={`${base} ${d.cls}`}>{d.label}</span>;
}

export function StatusPill({ status }: { status: PayStatusType }) {
  const s = STATUS[status];
  return <span className={`${base} ${s.cls}`}>{s.label}</span>;
}

export const decisionColor = (d: DecisionType) => (d === "APPROVE" ? "#22c55e" : d === "ASK_HUMAN" ? "#f59e0b" : "#ef4444");
