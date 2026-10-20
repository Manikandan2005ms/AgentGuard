import { PolicySchema, type Policy } from "@agentguard/shared";
import { prisma } from "../db";
import { DEMO_USER_ID } from "../env";

/** Single-user demo: every request acts for the seeded demo user. */
export async function getUser() {
  return prisma.user.upsert({
    where: { id: DEMO_USER_ID },
    update: {},
    create: { id: DEMO_USER_ID, name: "Demo User" },
  });
}

export async function getActivePolicy(userId: string): Promise<{ id: string; policy: Policy } | null> {
  const row = await prisma.policy.findFirst({ where: { userId, active: true }, orderBy: { createdAt: "desc" } });
  if (!row) return null;
  const parsed = PolicySchema.safeParse(row.compiled);
  if (!parsed.success) {
    console.error(`[policy] active policy ${row.id} failed validation; treating as no policy`);
    return null;
  }
  return { id: row.id, policy: parsed.data };
}
