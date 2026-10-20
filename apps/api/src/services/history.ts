import type { Category, Period, Policy } from "@agentguard/shared";
import { prisma } from "../db";
import type { PolicyHistory } from "../core/policyEngine";

/** Statuses that count against budgets: money already moved or currently held/awaiting approval. */
export const COMMITTED_STATUSES = ["PAID", "HELD", "PENDING"] as const;

export const PERIOD_MS: Record<Period, number> = {
  day: 24 * 3600_000,
  week: 7 * 24 * 3600_000,
  month: 30 * 24 * 3600_000,
};

export interface SpendingHistory extends PolicyHistory {
  avgAmount: number | null;
}

/** Budgets use rolling windows (last 24h / 7d / 30d). */
export async function loadHistory(userId: string, merchantId: string | null, policy: Policy, now: Date): Promise<SpendingHistory> {
  const since = new Date(now.getTime() - 90 * 24 * 3600_000);
  const rows = await prisma.paymentRequest.findMany({
    where: { userId, createdAt: { gte: since }, status: { in: [...COMMITTED_STATUSES] }, decision: { not: "BLOCK" } },
    select: { amount: true, category: true, createdAt: true, status: true, merchantId: true },
  });

  const merchantPaidBefore = merchantId
    ? (await prisma.paymentRequest.count({ where: { userId, merchantId, status: "PAID" } })) > 0
    : false;

  const windowMs = (policy.velocity?.window_minutes ?? 60) * 60_000;
  const txInVelocityWindow = rows.filter((r) => now.getTime() - r.createdAt.getTime() <= windowMs).length;

  const paid = rows.filter((r) => r.status === "PAID").map((r) => Number(r.amount));
  const avgAmount = paid.length >= 3 ? paid.reduce((a, b) => a + b, 0) / paid.length : null;

  const spent = (category: Category | "*", period: Period) =>
    rows
      .filter((r) => now.getTime() - r.createdAt.getTime() <= PERIOD_MS[period])
      .filter((r) => category === "*" || r.category === category)
      .reduce((sum, r) => sum + Number(r.amount), 0);

  return { merchantPaidBefore, txInVelocityWindow, spent, avgAmount };
}
