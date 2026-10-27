import { CATEGORY_LABELS, type BudgetUsageDTO, type Category, type InjectionEvidence, type RiskSignal } from "@agentguard/shared";
import { detectAnomalies, isAttackBlocked, isFailure, isRefund, type AnomalyBudget, type AnomalyRow } from "../core/anomalies";
import { prisma } from "../db";
import { budgetUsage } from "./statsService";
import { getUser } from "./users";

/**
 * Read-only tables for the AG Studio Insights page: one flat row per payment request, risk signal,
 * injection snippet, budget and merchant. Labels are readable words because Studio's agents and
 * widgets show field values as they are.
 */

const DAY = 86_400_000;
const HISTORY_DAYS = 90;

const DECISION_LABELS: Record<string, string> = { APPROVE: "Approved", ASK_HUMAN: "Asked you", BLOCK: "Blocked" };
const STATUS_LABELS: Record<string, string> = {
  PENDING: "Pending",
  HELD: "Held",
  PAID: "Paid",
  VOIDED: "Voided",
  BLOCKED: "Blocked",
  FAILED: "Failed",
  REFUNDED: "Refunded",
};

const categoryLabel = (c: string | null) => {
  const label = CATEGORY_LABELS[(c ?? "other") as Category] ?? c ?? "other";
  return label.charAt(0).toUpperCase() + label.slice(1);
};
const riskBand = (score: number) => (score >= 70 ? "High (70+)" : score >= 35 ? "Medium (35-69)" : "Low (0-34)");
const budgetLabel = (b: BudgetUsageDTO) => `${b.category === "*" ? "All categories" : categoryLabel(b.category)} / ${b.period}`;
const flag = (on: boolean) => (on ? 1 : 0);

async function loadRows() {
  const user = await getUser();
  return prisma.paymentRequest.findMany({
    where: { userId: user.id, createdAt: { gte: new Date(Date.now() - HISTORY_DAYS * DAY) } },
    include: { merchant: true },
    orderBy: { createdAt: "desc" },
    take: 5000,
  });
}
type Row = Awaited<ReturnType<typeof loadRows>>[number];

const merchantName = (r: Row) => (r.kind === "paypal_tool" ? "PayPal account" : (r.merchant?.name ?? r.merchantDomain));

function toAnomalyRow(r: Row): AnomalyRow {
  return {
    id: r.id,
    createdAt: r.createdAt,
    kind: r.kind,
    toolName: r.toolName,
    status: r.status,
    decision: r.decision,
    amount: Number(r.amount),
    riskScore: r.riskScore,
    injectionDetected: r.injectionDetected,
    merchant: merchantName(r),
    failureReason: r.failureReason,
  };
}

const toAnomalyBudget = (b: BudgetUsageDTO): AnomalyBudget => ({ label: budgetLabel(b), limit: b.limit, spent: b.spent, held: b.held });

export async function insightsData() {
  const [rows, budgets, merchants] = await Promise.all([loadRows(), budgetUsage(), prisma.merchant.findMany({ orderBy: { name: "asc" } })]);

  const payments = rows.map((r) => {
    const a = toAnomalyRow(r);
    const amount = Number(r.amount);
    const spent = r.kind === "payment" && r.status === "PAID" ? amount : 0;
    return {
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      day: r.createdAt.toISOString().slice(0, 10),
      type: r.kind === "paypal_tool" ? `Toolkit: ${r.toolName ?? "call"}` : "Purchase",
      merchant: merchantName(r),
      merchantDomain: r.merchantDomain,
      category: categoryLabel(r.category),
      item: r.item,
      amount,
      spent,
      decision: DECISION_LABELS[r.decision] ?? r.decision,
      status: STATUS_LABELS[r.status] ?? r.status,
      riskScore: r.riskScore,
      riskBand: riskBand(r.riskScore),
      decidedBy: r.decidedBy,
      explanation: r.explanation,
      requests: 1,
      approved: flag(r.decision === "APPROVE"),
      asked: flag(r.decision === "ASK_HUMAN"),
      blocked: flag(r.decision === "BLOCK"),
      injections: flag(isAttackBlocked(a)),
      refunds: flag(isRefund(a)),
      failures: flag(isFailure(a)),
    };
  });

  const signals = rows.flatMap((r) =>
    ((r.signals ?? []) as unknown as RiskSignal[]).map((s, i) => ({
      key: `${r.id}:${i}`,
      paymentId: r.id,
      signal: s.id.replace(/_/g, " "),
      source: s.source === "ai" ? "AI check" : "Rule",
      points: s.points,
      detail: s.detail,
    })),
  );

  const threats = rows
    .filter((r) => r.injectionDetected)
    .flatMap((r) =>
      (((r.aiChecks ?? {}) as { injectionEvidence?: InjectionEvidence[] }).injectionEvidence ?? []).map((e, i) => ({
        key: `${r.id}:${i}`,
        paymentId: r.id,
        createdAt: r.createdAt.toISOString(),
        merchant: merchantName(r),
        item: r.item,
        amount: Number(r.amount),
        technique: e.technique,
        hidden: e.hidden ? "Hidden from view" : "Visible text",
        snippet: e.snippet,
        outcome: DECISION_LABELS[r.decision] ?? r.decision,
      })),
    );

  const now = Date.now();
  return {
    generatedAt: new Date(now).toISOString(),
    payments,
    signals,
    threats,
    budgets: budgets.map((b) => ({
      budget: budgetLabel(b),
      period: b.period,
      limit: b.limit,
      spent: b.spent,
      held: b.held,
      remaining: Math.max(0, Math.round((b.limit - b.spent - b.held) * 100) / 100),
      used: b.limit > 0 ? Math.round(((b.spent + b.held) / b.limit) * 1000) / 1000 : 0,
    })),
    merchants: merchants.map((m) => {
      const ageDays = Math.max(0, Math.floor((now - m.createdAtSim.getTime()) / DAY));
      return { merchantDomain: m.domain, merchantName: m.name, merchantCategory: categoryLabel(m.category), ageDays, storeAge: ageDays < 30 ? "New (under 30 days)" : "Established" };
    }),
  };
}

export async function insightsAnomalies(windowHours: number) {
  const [rows, budgets] = await Promise.all([loadRows(), budgetUsage()]);
  return {
    scannedAt: new Date().toISOString(),
    windowHours,
    anomalies: detectAnomalies(rows.map(toAnomalyRow), budgets.map(toAnomalyBudget), Date.now(), windowHours),
  };
}
