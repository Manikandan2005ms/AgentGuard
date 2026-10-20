import type { BudgetUsageDTO, Category } from "@agentguard/shared";
import { prisma } from "../db";
import { PERIOD_MS } from "./history";
import { getActivePolicy, getUser } from "./users";

export async function budgetUsage(): Promise<BudgetUsageDTO[]> {
  const user = await getUser();
  const active = await getActivePolicy(user.id);
  if (!active) return [];
  const now = Date.now();
  const rows = await prisma.paymentRequest.findMany({
    where: {
      userId: user.id,
      kind: "payment",
      createdAt: { gte: new Date(now - PERIOD_MS.month) },
      status: { in: ["PAID", "HELD", "PENDING"] },
      decision: { not: "BLOCK" },
    },
    select: { amount: true, category: true, createdAt: true, status: true },
  });
  return active.policy.budgets.map((b) => {
    const inScope = rows.filter(
      (r) => now - r.createdAt.getTime() <= PERIOD_MS[b.period] && (b.category === "*" || r.category === (b.category as Category)),
    );
    const sum = (status: string[]) => inScope.filter((r) => status.includes(r.status)).reduce((s, r) => s + Number(r.amount), 0);
    return { category: b.category, period: b.period, limit: b.limit, spent: round(sum(["PAID"])), held: round(sum(["HELD", "PENDING"])) };
  });
}

export async function summary() {
  const user = await getUser();
  const since = new Date(Date.now() - 7 * 24 * 3600_000);
  const rows = await prisma.paymentRequest.findMany({
    where: { userId: user.id, createdAt: { gte: since } },
    select: { decision: true, status: true, amount: true, riskScore: true, injectionDetected: true, createdAt: true, category: true, kind: true },
  });
  const dayAgo = Date.now() - 24 * 3600_000;
  const today = rows.filter((r) => r.createdAt.getTime() >= dayAgo);
  // Only purchases count as spend; toolkit actions (refunds etc.) are not money the agent spent.
  const paidSum = (rs: typeof rows) => round(rs.filter((r) => r.status === "PAID" && r.kind === "payment").reduce((s, r) => s + Number(r.amount), 0));

  const byDay = new Map<string, { date: string; paid: number; blocked: number }>();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 3600_000).toISOString().slice(0, 10);
    byDay.set(d, { date: d, paid: 0, blocked: 0 });
  }
  for (const r of rows) {
    const d = byDay.get(r.createdAt.toISOString().slice(0, 10));
    if (!d) continue;
    if (r.status === "PAID" && r.kind === "payment") d.paid = round(d.paid + Number(r.amount));
    if (r.decision === "BLOCK") d.blocked += 1;
  }

  return {
    last24h: {
      total: today.length,
      approved: today.filter((r) => r.decision === "APPROVE").length,
      askedHuman: today.filter((r) => r.decision === "ASK_HUMAN").length,
      blocked: today.filter((r) => r.decision === "BLOCK").length,
      spent: paidSum(today),
    },
    last7d: {
      total: rows.length,
      spent: paidSum(rows),
      blocked: rows.filter((r) => r.decision === "BLOCK").length,
      injectionsBlocked: rows.filter((r) => r.injectionDetected && r.decision === "BLOCK").length,
      avgRisk: rows.length ? Math.round(rows.reduce((s, r) => s + r.riskScore, 0) / rows.length) : 0,
    },
    pendingApprovals: await prisma.paymentRequest.count({ where: { userId: user.id, status: { in: ["HELD", "PENDING"] } } }),
    daily: [...byDay.values()],
  };
}

const round = (n: number) => Math.round(n * 100) / 100;
