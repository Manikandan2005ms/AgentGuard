import { paypalRequest } from "./client";
import type { PayPalLink } from "./orders";

/** Step 1 of one-time onboarding: a setup token the user approves on PayPal (README §8.3). */
export async function createSetupToken(returnUrl: string, cancelUrl: string, idempotencyKey: string) {
  const res = await paypalRequest<{ id: string; status: string; links?: PayPalLink[] }>("POST", "/v3/vault/setup-tokens", {
    idempotencyKey,
    body: {
      payment_source: {
        paypal: {
          description: "AgentGuard: lets your AI agent pay, only within the rules you set",
          permit_multiple_payment_tokens: false,
          usage_pattern: "IMMEDIATE",
          usage_type: "MERCHANT",
          customer_type: "CONSUMER",
          experience_context: {
            shipping_preference: "NO_SHIPPING",
            payment_method_preference: "IMMEDIATE_PAYMENT_REQUIRED",
            brand_name: "AgentGuard",
            locale: "en-US",
            return_url: returnUrl,
            cancel_url: cancelUrl,
          },
        },
      },
    },
  });
  const approveUrl = res.links?.find((l) => l.rel === "approve")?.href;
  if (!approveUrl) throw new Error("PayPal setup token has no approve link");
  return { setupTokenId: res.id, approveUrl };
}

/** Step 3: exchange the approved setup token for a permanent payment token (the vault_id). */
export async function createPaymentToken(setupTokenId: string, idempotencyKey: string) {
  const res = await paypalRequest<{ id: string; customer?: { id: string } }>("POST", "/v3/vault/payment-tokens", {
    idempotencyKey,
    body: { payment_source: { token: { id: setupTokenId, type: "SETUP_TOKEN" } } },
  });
  return { vaultId: res.id, customerId: res.customer?.id ?? null };
}
