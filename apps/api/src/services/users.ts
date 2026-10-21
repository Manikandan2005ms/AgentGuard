import { PolicySchema, type Policy } from "@agentguard/shared";
import { prisma } from "../db";
import { DEMO_USER_ID, paypalMode } from "../env";

/**
 * The saved PayPal wallet (vault) id, if it can be used in the current mode. A wallet connected
 * while running the mock gateway ("MOCK-…") means nothing to the real sandbox, so it's ignored there.
 */
export function usableVaultId(user: { paypalVaultId: string | null }): string | null {
  const id = user.paypalVaultId;
  if (!id) return null;
  return (paypalMode === "sandbox") === id.startsWith("MOCK-") ? null : id;
}

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
