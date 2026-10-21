import type { DecisionType, PayStatusType } from "@agentguard/shared";

// Decisions are stamped like a ledger entry; the payment's state is a quieter dot and label.

const DECISION: Record<DecisionType, { label: string; cls: string }> = {
  APPROVE: { label: "Approved", cls: "text-ok" },
  ASK_HUMAN: { label: "Asked you", cls: "text-warn" },
  BLOCK: { label: "Blocked", cls: "text-bad" },
};

const OK = "var(--color-ok)";
const WARN = "var(--color-warn)";
const BAD = "var(--color-bad)";
const QUIET = "var(--color-ink-3)";

const STATUS: Record<PayStatusType, { label: string; dot: string }> = {
  PENDING: { label: "Awaiting PayPal", dot: WARN },
  HELD: { label: "Funds held", dot: WARN },
  PAID: { label: "Captured", dot: OK },
  VOIDED: { label: "Voided", dot: QUIET },
  BLOCKED: { label: "No money moved", dot: QUIET },
  FAILED: { label: "Failed", dot: BAD },
  REFUNDED: { label: "Refunded", dot: QUIET },
};

export function DecisionPill({ decision }: { decision: DecisionType }) {
  const d = DECISION[decision];
  return <span className={`stamp ${d.cls}`}>{d.label}</span>;
}

/** PayPal Agent Toolkit actions don't hold or capture funds; they wait, run, or don't run. */
const TOOL_LABELS: Partial<Record<PayStatusType, string>> = {
  HELD: "Waiting for you",
  PENDING: "Running",
  PAID: "Executed",
  BLOCKED: "Not executed",
  VOIDED: "Rejected",
};

export function StatusPill({ status, kind }: { status: PayStatusType; kind?: string }) {
  const s = STATUS[status];
  const label = kind === "paypal_tool" ? (TOOL_LABELS[status] ?? s.label) : s.label;
  return (
    <span className="mark" style={{ "--dot": s.dot } as React.CSSProperties}>
      {label}
    </span>
  );
}

export function ToolBadge({ name }: { name: string }) {
  return (
    <span className="inline-flex items-center rounded-[3px] bg-accent-wash px-1.5 font-mono text-[11.5px] leading-[1.6] text-accent">
      PayPal toolkit · {name}
    </span>
  );
}

export function InjectionTag() {
  return <span className="inline-flex items-center rounded-[3px] bg-bad-wash px-1.5 text-[12px] font-medium leading-[1.6] text-bad">Prompt injection</span>;
}
