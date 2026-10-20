import { PolicySchema, describePolicy } from "@agentguard/shared";
import type { Prisma } from "@prisma/client";
import { compilePolicy } from "../ai/compilePolicy";
import { replayPolicy } from "../core/policySimulator";
import { prisma } from "../db";
import { publish } from "../events";
import { getUser } from "./users";

export async function compileAndSave(rawText: string) {
  const user = await getUser();
  const compiled = await compilePolicy(rawText);
  const row = await prisma.policy.create({
    data: {
      userId: user.id,
      rawText,
      compiled: compiled.policy as unknown as Prisma.InputJsonValue,
      summary: compiled.summary.join("\n"),
      clarifications: compiled.clarifications,
      engine: compiled.engine,
      active: false,
    },
  });
  return {
    id: row.id,
    compiled: compiled.policy,
    summary: compiled.summary,
    clarifications: compiled.clarifications,
    engine: compiled.engine,
    warning: compiled.warning ?? null,
  };
}

/** Only a policy the user explicitly confirmed becomes active (README §9.1). */
export async function activatePolicy(id: string) {
  const user = await getUser();
  const row = await prisma.policy.findFirst({ where: { id, userId: user.id } });
  if (!row) return null;
  if (!PolicySchema.safeParse(row.compiled).success) throw new Error("Stored policy no longer passes validation");
  await prisma.$transaction([
    prisma.policy.updateMany({ where: { userId: user.id, active: true }, data: { active: false } }),
    prisma.policy.update({ where: { id }, data: { active: true } }),
  ]);
  publish({ type: "policy.activated", policyId: id });
  return serialize({ ...row, active: true });
}

/** Replays the last 30 days of agent purchases against a (draft) policy. No AI calls, nothing stored. */
export async function simulatePolicy(id: string) {
  const user = await getUser();
  const row = await prisma.policy.findFirst({ where: { id, userId: user.id } });
  if (!row) return null;
  const policy = PolicySchema.parse(row.compiled);
  const windowStart = new Date(Date.now() - 30 * 24 * 3600_000);
  const requests = await prisma.paymentRequest.findMany({
    where: { userId: user.id, kind: "payment", createdAt: { gte: windowStart } },
    include: { merchant: true },
    orderBy: { createdAt: "asc" },
  });
  // Merchants you really paid before the window still count as "used before" in the replay.
  const prior = await prisma.paymentRequest.findMany({
    where: { userId: user.id, kind: "payment", status: "PAID", createdAt: { lt: windowStart }, merchantId: { not: null } },
    select: { merchantId: true },
    distinct: ["merchantId"],
  });
  const replay = replayPolicy(
    policy,
    requests.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      item: r.quantity > 1 ? `${r.quantity} × ${r.item}` : r.item,
      merchantDomain: r.merchantDomain,
      merchantId: r.merchantId,
      merchantCreatedAt: r.merchant?.createdAtSim ?? null,
      amount: Number(r.amount),
      currency: r.currency,
      category: r.category,
      decision: r.decision,
      injectionDetected: r.injectionDetected,
      intentAligned: r.intentAligned,
      taskBound: !!r.taskId,
    })),
    { merchantsPaidBefore: prior.map((p) => p.merchantId!) },
  );
  return { policyId: id, windowDays: 30, ...replay };
}

export async function listPolicies() {
  const user = await getUser();
  const rows = await prisma.policy.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 20 });
  return rows.map(serialize);
}

export async function activePolicyView() {
  const user = await getUser();
  const row = await prisma.policy.findFirst({ where: { userId: user.id, active: true }, orderBy: { createdAt: "desc" } });
  return row ? serialize(row) : null;
}

function serialize(row: {
  id: string;
  rawText: string;
  compiled: Prisma.JsonValue;
  summary: string;
  clarifications: Prisma.JsonValue;
  engine: string;
  active: boolean;
  createdAt: Date;
}) {
  const parsed = PolicySchema.safeParse(row.compiled);
  return {
    id: row.id,
    rawText: row.rawText,
    compiled: row.compiled,
    summary: parsed.success ? describePolicy(parsed.data) : row.summary.split("\n"),
    clarifications: (row.clarifications ?? []) as string[],
    engine: row.engine,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
  };
}
