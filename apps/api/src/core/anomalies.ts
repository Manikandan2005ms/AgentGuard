/**
 * Anomaly detection for the Insights page's Sentinel agent. Plain code over the audit log: the
 * model decides how to present an anomaly, never whether one exists.
 *
 * Each check compares the last `windowHours` with the 7 days before it.
 */

export interface AnomalyRow {
  id: string;
  createdAt: Date;
  kind: string; // "payment" | "paypal_tool"
  toolName: string | null;
  status: string;
  decision: string;
  amount: number;
  riskScore: number;
  injectionDetected: boolean;
  merchant: string;
  failureReason: string | null;
}

export interface AnomalyBudget {
  label: string;
  limit: number;
  spent: number;
  held: number;
}

export type AnomalyKind = "refund_spike" | "failed_payments" | "attack_burst" | "block_spike" | "risk_surge" | "budget_pressure";
export type Severity = "high" | "medium" | "low";

export interface Anomaly {
  id: string;
  kind: AnomalyKind;
  severity: Severity;
  title: string;
  detail: string;
  /** What happened in the window, in `unit`. */
  value: number;
  /** The normal level for a window this long (7-day average), in `unit`. */
  baseline: number;
  unit: "count" | "usd" | "score" | "percent";
  windowHours: number;
  merchants: string[];
  /** A few payment request ids behind the anomaly, newest first. */
  sampleIds: string[];
  /** The Insights `payments` field whose daily sum charts this anomaly. */
  trendField: string | null;
}

const HOUR = 3_600_000;
const BASELINE_DAYS = 7;
const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

export const isRefund = (r: Pick<AnomalyRow, "status" | "kind" | "toolName">) =>
  r.status === "REFUNDED" || (r.kind === "paypal_tool" && !!r.toolName && /refund/i.test(r.toolName));
export const isFailure = (r: Pick<AnomalyRow, "status">) => r.status === "FAILED";
export const isAttackBlocked = (r: Pick<AnomalyRow, "injectionDetected" | "decision">) => r.injectionDetected && r.decision === "BLOCK";

const round = (n: number, places = 1) => Math.round(n * 10 ** places) / 10 ** places;
const usd = (n: number) => `$${n.toFixed(2)}`;
const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

function topMerchants(rows: AnomalyRow[], max = 3): string[] {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.merchant, (counts.get(r.merchant) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([m]) => m);
}

const newestIds = (rows: AnomalyRow[], max = 5) =>
  [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, max).map((r) => r.id);

/** Splits rows into the recent window and the baseline period before it. */
function split(rows: AnomalyRow[], now: number, windowHours: number) {
  const windowStart = now - windowHours * HOUR;
  const baselineStart = windowStart - BASELINE_DAYS * 24 * HOUR;
  const recent = rows.filter((r) => r.createdAt.getTime() >= windowStart && r.createdAt.getTime() <= now);
  const before = rows.filter((r) => r.createdAt.getTime() >= baselineStart && r.createdAt.getTime() < windowStart);
  // The baseline is the 7-day count scaled to one window, so a 24 h window compares with an average day.
  const perWindow = (n: number) => (n * windowHours) / (BASELINE_DAYS * 24);
  return { recent, before, perWindow };
}

export function detectAnomalies(rows: AnomalyRow[], budgets: AnomalyBudget[], now = Date.now(), windowHours = 24): Anomaly[] {
  const { recent, before, perWindow } = split(rows, now, windowHours);
  const span = windowHours === 24 ? "in the last 24 hours" : windowHours === 168 ? "in the last 7 days" : `in the last ${windowHours} hours`;
  const per = windowHours === 24 ? "a day" : windowHours === 168 ? "a week" : `per ${windowHours} h`;
  const found: Anomaly[] = [];

  // Refunds: a burst of money going back out, or of attempts to send it, is the classic sign of a looping or
  // hijacked agent. Blocked and failed attempts count, and the detail says how many really went through.
  const refunds = recent.filter(isRefund);
  const refundBaseline = perWindow(before.filter(isRefund).length);
  if (refunds.length >= 2 && refunds.length >= 3 * refundBaseline) {
    const total = refunds.reduce((s, r) => s + r.amount, 0);
    const outcome = [
      [refunds.filter((r) => r.status === "REFUNDED" || r.status === "PAID").length, "went through"],
      [refunds.filter((r) => r.status === "BLOCKED").length, "blocked"],
      [refunds.filter((r) => r.status === "HELD" || r.status === "PENDING").length, "waiting for you"],
      [refunds.filter(isFailure).length, "failed at PayPal"],
    ] as const;
    found.push({
      id: `refund_spike:${windowHours}`,
      kind: "refund_spike",
      severity: refunds.length >= 5 || total >= 200 ? "high" : "medium",
      title: `Refund spike: ${plural(refunds.length, "refund attempt")} ${span}`,
      detail:
        `${plural(refunds.length, "refund attempt")}${total > 0 ? ` (${usd(total)} requested)` : ""}, against a normal ${round(refundBaseline)} ${per}: ` +
        `${outcome.filter(([n]) => n > 0).map(([n, what]) => `${n} ${what}`).join(", ")}. Check that each one was asked for, and freeze the agent if not.`,
      value: refunds.length,
      baseline: round(refundBaseline),
      unit: "count",
      windowHours,
      merchants: topMerchants(refunds),
      sampleIds: newestIds(refunds),
      trendField: "refunds",
    });
  }

  // Failed payments: PayPal declined a capture or a toolkit call errored.
  const failures = recent.filter(isFailure);
  if (failures.length >= 1) {
    // PayPal's messages nest ("PayPal toolkit call failed: ...: The capture has already been fully refunded (HTTP 422)"); keep the last part.
    const reasons = [...new Set(failures.map((r) => r.failureReason?.split(": ").at(-1)?.trim()).filter((r): r is string => !!r))].slice(0, 2);
    found.push({
      id: `failed_payments:${windowHours}`,
      kind: "failed_payments",
      severity: failures.length >= 3 ? "high" : failures.length === 2 ? "medium" : "low",
      title: `${plural(failures.length, "failed payment")} ${span}`,
      detail:
        `PayPal did not complete ${plural(failures.length, "payment or refund", "payments or refunds")} (normal: ${round(perWindow(before.filter(isFailure).length))}).` +
        (reasons.length ? ` Reason: ${reasons.join("; ")}.` : ""),
      value: failures.length,
      baseline: round(perWindow(before.filter(isFailure).length)),
      unit: "count",
      windowHours,
      merchants: topMerchants(failures),
      sampleIds: newestIds(failures),
      trendField: "failures",
    });
  }

  // Prompt-injection attacks that reached the firewall.
  const attacks = recent.filter(isAttackBlocked);
  if (attacks.length >= 2) {
    const merchants = topMerchants(attacks);
    found.push({
      id: `attack_burst:${windowHours}`,
      kind: "attack_burst",
      severity: attacks.length >= 5 ? "high" : "medium",
      title: `${plural(attacks.length, "injection attack")} blocked ${span}`,
      detail: `Hidden instructions tried to steer the agent into paying. Most came from ${merchants.join(", ")}. Every one was blocked.`,
      value: attacks.length,
      baseline: round(perWindow(before.filter(isAttackBlocked).length)),
      unit: "count",
      windowHours,
      merchants,
      sampleIds: newestIds(attacks),
      trendField: "injections",
    });
  }

  // Policy blocks without an injection: the agent keeps asking for things it isn't allowed.
  const isPolicyBlock = (r: AnomalyRow) => r.decision === "BLOCK" && !r.injectionDetected;
  const blocks = recent.filter(isPolicyBlock);
  const blockBaseline = perWindow(before.filter(isPolicyBlock).length);
  if (blocks.length >= 3 && blocks.length >= 3 * blockBaseline) {
    found.push({
      id: `block_spike:${windowHours}`,
      kind: "block_spike",
      severity: blocks.length >= 8 ? "high" : "medium",
      title: `Agent hit your rules ${blocks.length} times ${span}`,
      detail: `${plural(blocks.length, "request")} broke a policy rule (normal: ${round(blockBaseline)}). The agent may be stuck retrying, or its task may be wrong.`,
      value: blocks.length,
      baseline: round(blockBaseline),
      unit: "count",
      windowHours,
      merchants: topMerchants(blocks),
      sampleIds: newestIds(blocks),
      trendField: "blocked",
    });
  }

  // Average risk climbing.
  const avg = (rs: AnomalyRow[]) => (rs.length ? rs.reduce((s, r) => s + r.riskScore, 0) / rs.length : 0);
  const recentRisk = avg(recent);
  const baselineRisk = avg(before);
  if (recent.length >= 3 && recentRisk >= 35 && recentRisk >= baselineRisk + 15) {
    found.push({
      id: `risk_surge:${windowHours}`,
      kind: "risk_surge",
      severity: recentRisk >= 70 ? "high" : "medium",
      title: `Average risk up to ${Math.round(recentRisk)} ${span}`,
      detail: `Requests averaged ${Math.round(recentRisk)}/100 risk, against ${Math.round(baselineRisk)} over the previous week. At 35 AgentGuard asks you; at 70 it blocks.`,
      value: Math.round(recentRisk),
      baseline: Math.round(baselineRisk),
      unit: "score",
      windowHours,
      merchants: topMerchants(recent.filter((r) => r.riskScore >= 35)),
      sampleIds: newestIds(recent.filter((r) => r.riskScore >= 35)),
      trendField: "riskScore",
    });
  }

  // Budgets nearly used up.
  for (const b of budgets) {
    if (b.limit <= 0) continue;
    const used = (b.spent + b.held) / b.limit;
    if (used < 0.9) continue;
    found.push({
      id: `budget_pressure:${b.label}`,
      kind: "budget_pressure",
      severity: used >= 1 ? "high" : "medium",
      title: `${b.label} budget ${Math.round(used * 100)}% used`,
      detail: `${usd(b.spent)} spent and ${usd(b.held)} held of ${usd(b.limit)}. Further purchases in this budget will be blocked.`,
      value: Math.round(used * 100),
      baseline: 100,
      unit: "percent",
      windowHours,
      merchants: [],
      sampleIds: [],
      trendField: null,
    });
  }

  return found.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}
