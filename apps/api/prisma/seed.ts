/**
 * Seeds the demo: one user, the three demo merchants (with simulated store ages), an active
 * sample policy, and a few weeks of past purchases so "merchant used before" and "average
 * purchase" have real data.   npm run seed            (idempotent)
 *                             npm run seed -- --reset (also wipes payment requests and tasks)
 */
import { PrismaClient, type Prisma } from "@prisma/client";
import { describePolicy } from "@agentguard/shared";
import { compilePolicyWithRules } from "../src/core/ruleCompiler";

const prisma = new PrismaClient();
const DAY = 86_400_000;
const USER_ID = "demo-user";

export const SAMPLE_POLICY_TEXT =
  "Max $150 a week on groceries. Never spend more than $200 on a single purchase. Never buy gift cards, crypto or gambling. " +
  "Ask me before anything over $50. Don't pay merchants younger than 30 days. Electronics only from stores I've used before. " +
  "No more than 5 purchases per hour.";

const MERCHANTS = [
  {
    domain: "freshcart.example",
    name: "FreshCart",
    category: "groceries",
    ageDays: 730,
    email: process.env.PAYPAL_MERCHANT_FRESHCART,
    trustNotes: "Established grocery store (2 years).",
  },
  {
    domain: "gadgethub.example",
    name: "GadgetHub",
    category: "electronics",
    ageDays: 365,
    email: process.env.PAYPAL_MERCHANT_GADGETHUB,
    trustNotes: "Electronics store (1 year).",
  },
  {
    domain: "megadealz.example",
    name: "MegaDealz",
    category: "other",
    ageDays: 3,
    email: process.env.PAYPAL_MERCHANT_MEGADEALZ,
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

async function main() {
  const reset = process.argv.includes("--reset");
  const now = Date.now();

  if (reset) {
    await prisma.paymentRequest.deleteMany({});
    await prisma.task.deleteMany({});
    await prisma.webhookEvent.deleteMany({});
    console.log("Reset: removed payment requests, tasks and webhook events");
  }

  await prisma.user.upsert({
    where: { id: USER_ID },
    update: { killSwitch: false },
    create: { id: USER_ID, name: "Demo User" },
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

  // The sample policy is only installed when there is no active policy (or on --reset),
  // so re-running the seed on every deploy never overwrites a policy the user confirmed.
  const { policy } = compilePolicyWithRules(SAMPLE_POLICY_TEXT);
  const hasActive = (await prisma.policy.count({ where: { userId: USER_ID, active: true } })) > 0;
  if (reset || !hasActive) {
    await prisma.policy.updateMany({ where: { userId: USER_ID, active: true }, data: { active: false } });
    await prisma.policy.create({
      data: {
        userId: USER_ID,
        rawText: SAMPLE_POLICY_TEXT,
        compiled: policy as unknown as Prisma.InputJsonValue,
        summary: describePolicy(policy).join("\n"),
        clarifications: policy.clarifications,
        engine: "rules",
        active: true,
      },
    });
  }

  // Past purchases (marked as seed data with SEED- PayPal ids), replaced on every run.
  const SEED_TASK = "Weekly grocery run (seed history)";
  await prisma.paymentRequest.deleteMany({ where: { paypalOrderId: { startsWith: "SEED-" } } });
  await prisma.task.deleteMany({ where: { userId: USER_ID, description: SEED_TASK, requests: { none: {} } } });
  const task = await prisma.task.create({ data: { userId: USER_ID, description: SEED_TASK, createdAt: new Date(now - 41 * DAY) } });
  for (const [i, h] of HISTORY.entries()) {
    const at = new Date(now - h.daysAgo * DAY);
    await prisma.paymentRequest.create({
      data: {
        userId: USER_ID,
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

  console.log(`Seeded: demo user, ${MERCHANTS.length} merchants, ${HISTORY.length} past purchases`);
  if (reset || !hasActive) console.log("Installed the sample policy:\n  - " + describePolicy(policy).join("\n  - "));
  else console.log("Kept your existing active policy (use --reset to restore the sample policy).");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
