import { describePolicy } from "@agentguard/shared";
import type { Prisma } from "@prisma/client";
import { compilePolicyWithRules } from "../core/ruleCompiler";
import { prisma } from "../db";
import { DEMO_USER_ID, env } from "../env";

/**
 * Demo data: one user, the three demo merchants (with simulated store ages), an active sample
 * policy, and a few weeks of past purchases so "merchant used before" and "average purchase"
 * have real data. Used by `npm run seed` and by the dashboard's Reset demo button.
 */

const DAY = 86_400_000;

export const SAMPLE_POLICY_TEXT =
  "Max $150 a week on groceries. Never spend more than $200 on a single purchase. Never buy gift cards, crypto or gambling. " +
  "Ask me before anything over $50. Don't pay merchants younger than 30 days. Electronics only from stores I've used before. " +
  "No more than 5 purchases per hour.";

const MERCHANTS = [
  { domain: "freshcart.example", name: "FreshCart", category: "groceries", ageDays: 730, email: env.PAYPAL_MERCHANT_FRESHCART, trustNotes: "Established grocery store (2 years)." },
  { domain: "gadgethub.example", name: "GadgetHub", category: "electronics", ageDays: 365, email: env.PAYPAL_MERCHANT_GADGETHUB, trustNotes: "Electronics store (1 year)." },
  {
    domain: "megadealz.example",
    name: "MegaDealz",
    category: "other",
    ageDays: 3,
    email: env.PAYPAL_MERCHANT_MEGADEALZ,
    trustNotes: "Registered 3 days ago. Demo store with hidden prompt injections.",
  },
];

const HISTORY: { domain: string; item: string; category: string; amount: number; daysAgo: number }[] = [
  { domain: "freshcart.example", item: "Weekly groceries", category: "groceries", amount: 23.4, daysAgo: 9 },
  { domain: "freshcart.example", item: "Weekly groceries", category: "groceries", amount: 31.15, daysAgo: 12 },
  { domain: "freshcart.example", item: "Weekly groceries", category: "groceries", amount: 18.9, daysAgo: 16 },
  { domain: "freshcart.example", item: "Weekly groceries", category: "groceries", amount: 27.6, daysAgo: 19 },
  { domain: "gadgethub.example", item: "USB-C Cable 2m", category: "electronics", amount: 12.99, daysAgo: 21 },
  { domain: "freshcart.example", item: "Weekly groceries", category: "groceries", amount: 35.25, daysAgo: 23 },
  { domain: "freshcart.example", item: "Weekly groceries", category: "groceries", amount: 21.8, daysAgo: 26 },
  { domain: "freshcart.example", item: "Weekly groceries", category: "groceries", amount: 29.99, daysAgo: 30 },
  { domain: "freshcart.example", item: "Weekly groceries", category: "groceries", amount: 24.5, daysAgo: 33 },
  { domain: "gadgethub.example", item: "Phone Case", category: "electronics", amount: 19.99, daysAgo: 40 },
];

/** Idempotent. With `reset`, also wipes payment requests, tasks and webhook events and restores the sample policy. */
export async function seedDemo({ reset }: { reset: boolean }): Promise<string[]> {
  const log: string[] = [];
  const now = Date.now();

  if (reset) {
    await prisma.paymentRequest.deleteMany({});
    await prisma.task.deleteMany({});
    await prisma.webhookEvent.deleteMany({});
    log.push("Reset: removed payment requests, tasks and webhook events");
  }

  await prisma.user.upsert({
    where: { id: DEMO_USER_ID },
    update: { killSwitch: false },
    create: { id: DEMO_USER_ID, name: "Demo User" },
  });

  const merchantIds: Record<string, string> = {};
  for (const m of MERCHANTS) {
    const data = {
      name: m.name,
      category: m.category,
      paypalEmail: m.email || `${m.name.toLowerCase()}@merchant.example`,
      createdAtSim: new Date(now - m.ageDays * DAY),
      trustNotes: m.trustNotes,
    };
    const row = await prisma.merchant.upsert({ where: { domain: m.domain }, update: data, create: { domain: m.domain, ...data } });
    merchantIds[m.domain] = row.id;
  }

  // The sample policy is only installed when there is no active policy (or on reset),
  // so re-running the seed on every deploy never overwrites a policy the user confirmed.
  const { policy } = compilePolicyWithRules(SAMPLE_POLICY_TEXT);
  const hasActive = (await prisma.policy.count({ where: { userId: DEMO_USER_ID, active: true } })) > 0;
  if (reset || !hasActive) {
    await prisma.policy.updateMany({ where: { userId: DEMO_USER_ID, active: true }, data: { active: false } });
    await prisma.policy.create({
      data: {
        userId: DEMO_USER_ID,
        rawText: SAMPLE_POLICY_TEXT,
        compiled: policy as unknown as Prisma.InputJsonValue,
        summary: describePolicy(policy).join("\n"),
        clarifications: policy.clarifications,
        engine: "rules",
        active: true,
      },
    });
    log.push("Installed the sample policy:\n  - " + describePolicy(policy).join("\n  - "));
  } else {
    log.push("Kept your existing active policy (use --reset to restore the sample policy).");
  }

  // Past purchases (marked as seed data with SEED- PayPal ids), replaced on every run.
  const SEED_TASK = "Weekly grocery run (seed history)";
  await prisma.paymentRequest.deleteMany({ where: { paypalOrderId: { startsWith: "SEED-" } } });
  await prisma.task.deleteMany({ where: { userId: DEMO_USER_ID, description: SEED_TASK, requests: { none: {} } } });
  const task = await prisma.task.create({ data: { userId: DEMO_USER_ID, description: SEED_TASK, createdAt: new Date(now - 41 * DAY) } });
  for (const [i, h] of HISTORY.entries()) {
    const at = new Date(now - h.daysAgo * DAY);
    await prisma.paymentRequest.create({
      data: {
        userId: DEMO_USER_ID,
        taskId: task.id,
        merchantId: merchantIds[h.domain],
        merchantDomain: h.domain,
        item: h.item,
        category: h.category,
        amount: h.amount,
        decision: "APPROVE",
        riskScore: 0,
        signals: [],
        rulesFired: [],
        aiChecks: { seeded: true },
        explanation: `Approved: $${h.amount.toFixed(2)} for ${h.item} is within your policy (seed history).`,
        status: "PAID",
        paypalOrderId: `SEED-ORDER-${i + 1}`,
        paypalAuthId: `SEED-AUTH-${i + 1}`,
        paypalCaptureId: `SEED-CAPTURE-${i + 1}`,
        decidedBy: "engine",
        createdAt: at,
        resolvedAt: at,
      },
    });
  }
  log.push(`Seeded: demo user, ${MERCHANTS.length} merchants, ${HISTORY.length} past purchases`);
  return log;
}
