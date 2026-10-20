import type { FastifyInstance } from "fastify";
import { prisma } from "../db";
import { env, paypalMode } from "../env";
import { LIMITS } from "../lib/limits";
import { gateway } from "../paypal/gateway";
import type { PayPalWebhookEvent } from "../paypal/webhooks";
import { handleOrderApproved } from "../services/paymentService";
import { rejectRequest } from "../services/paymentService";
import { processPayPalEvent } from "../services/webhookService";
import { getUser } from "../services/users";

export async function paypalRoutes(app: FastifyInstance) {
  // ---- One-time onboarding: vault the user's PayPal wallet (README §8.3) ----
  app.post("/api/paypal/vault/setup", { config: { rateLimit: LIMITS.admin } }, async () => {
    const user = await getUser();
    const { setupTokenId, approveUrl } = await gateway.createVaultSetup(
      `${env.PUBLIC_BASE_URL}/api/paypal/vault/return`,
      `${env.PUBLIC_BASE_URL}/api/paypal/vault/cancel`,
    );
    await prisma.user.update({ where: { id: user.id }, data: { pendingSetupTokenId: setupTokenId } });
    return { approveUrl, mode: paypalMode };
  });

  app.get("/api/paypal/vault/return", async (req, reply) => {
    const q = req.query as { approval_token_id?: string };
    const user = await getUser();
    const setupTokenId = q.approval_token_id ?? user.pendingSetupTokenId;
    if (!setupTokenId) return reply.redirect(`${env.DASHBOARD_URL}/setup?paypal=error`);
    try {
      const { vaultId, customerId } = await gateway.completeVaultSetup(setupTokenId);
      await prisma.user.update({
        where: { id: user.id },
        data: { paypalVaultId: vaultId, paypalCustomerId: customerId, pendingSetupTokenId: null },
      });
      return reply.redirect(`${env.DASHBOARD_URL}/setup?paypal=connected`);
    } catch (err) {
      req.log.error(err, "vault payment-token exchange failed");
      return reply.redirect(`${env.DASHBOARD_URL}/setup?paypal=error`);
    }
  });

  app.get("/api/paypal/vault/cancel", async (_req, reply) => reply.redirect(`${env.DASHBOARD_URL}/setup?paypal=cancelled`));

  app.post("/api/paypal/vault/disconnect", async () => {
    const user = await getUser();
    await prisma.user.update({ where: { id: user.id }, data: { paypalVaultId: null, paypalCustomerId: null } });
    return { ok: true };
  });

  // ---- Fallback flow (README §8.4): buyer returns from the PayPal approval page ----
  app.get("/api/paypal/order/return", async (req, reply) => {
    const { token } = req.query as { token?: string };
    if (token) await handleOrderApproved(token);
    return reply.redirect(`${env.DASHBOARD_URL}/?approved=${encodeURIComponent(token ?? "")}`);
  });

  app.get("/api/paypal/order/cancel", async (req, reply) => {
    const { token } = req.query as { token?: string };
    if (token) {
      const row = await prisma.paymentRequest.findFirst({ where: { paypalOrderId: token } });
      if (row) await rejectRequest(row.id, "human").catch(() => undefined);
    }
    return reply.redirect(`${env.DASHBOARD_URL}/`);
  });

  // ---- Webhooks (README §8.5): verify every event with PayPal before applying it ----
  app.post("/webhooks/paypal", async (req, reply) => {
    const event = req.body as PayPalWebhookEvent;
    if (!event?.id || !event.event_type) return reply.code(400).send({ error: "Not a PayPal event" });
    let verified = false;
    try {
      verified = await gateway.verifyWebhook(req.headers, event);
    } catch (err) {
      req.log.error(err, "webhook verification call failed");
    }
    if (!verified) {
      req.log.warn({ type: event.event_type }, "rejected unverified PayPal webhook");
      return reply.code(401).send({ error: "Signature verification failed" });
    }
    const result = await processPayPalEvent(event, true);
    return { ok: true, result };
  });
}
