import { prisma } from "../db";
import { gateway } from "../paypal/gateway";
import { expireStaleApprovals } from "../services/paymentService";
import { updatePayment } from "../services/paymentService";

/** Void HELD authorizations nobody answered in time (README §13.3). */
async function approvalTimeoutJob() {
  const n = await expireStaleApprovals();
  if (n) console.log(`[jobs] voided ${n} unanswered approval(s)`);
}

/**
 * Compare PayPal's transaction report with the audit log and mark matches as reconciled
 * (README §8.6). Sandbox reporting lags by hours, so this is a background "nice to have".
 */
export async function reconcileJob(): Promise<number> {
  const unreconciled = await prisma.paymentRequest.findMany({
    where: { status: "PAID", reconciledAt: null, paypalCaptureId: { not: null }, createdAt: { gte: new Date(Date.now() - 30 * 24 * 3600_000) } },
    select: { id: true, paypalCaptureId: true, createdAt: true },
  });
  if (!unreconciled.length) return 0;
  const start = new Date(Math.min(...unreconciled.map((r) => r.createdAt.getTime())) - 3600_000);
  const txns = await gateway.listTransactions(start, new Date());
  const ids = new Set(txns.map((t) => t.transactionId));
  let n = 0;
  for (const r of unreconciled) {
    if (r.paypalCaptureId && ids.has(r.paypalCaptureId)) {
      await updatePayment(r.id, { reconciledAt: new Date() });
      n++;
    }
  }
  if (n) console.log(`[jobs] reconciled ${n} payment(s) against PayPal reporting`);
  return n;
}

export function startJobs() {
  const safe = (name: string, fn: () => Promise<unknown>) => () => fn().catch((e) => console.error(`[jobs] ${name} failed:`, e));
  setInterval(safe("approval-timeout", approvalTimeoutJob), 60_000);
  setInterval(safe("reconcile", reconcileJob), gateway.mode === "mock" ? 60_000 : 30 * 60_000);
}
