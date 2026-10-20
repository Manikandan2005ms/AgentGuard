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

/** PayPal Agent Toolkit actions don't hold or capture funds; they wait, run, or don't run. */
const TOOL_LABELS: Partial<Record<PayStatusType, string>> = {
  HELD: "Awaiting you",
  PENDING: "Running",
  PAID: "Executed",
  BLOCKED: "Not executed",
  VOIDED: "Rejected",
};

export function StatusPill({ status, kind }: { status: PayStatusType; kind?: string }) {
  const s = STATUS[status];
  const label = kind === "paypal_tool" ? (TOOL_LABELS[status] ?? s.label) : s.label;
  return <span className={`${base} ${s.cls}`}>{label}</span>;
}

export function ToolBadge({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-sky-400/40 bg-sky-400/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-sky-300">
      PayPal toolkit · {name}
    </span>
  );
}

export const decisionColor = (d: DecisionType) => (d === "APPROVE" ? "#22c55e" : d === "ASK_HUMAN" ? "#f59e0b" : "#ef4444");
