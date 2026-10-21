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

/* ---------------------------------------------------------------------------------------------
 * Alternative onboarding: save the wallet DURING a small purchase (Orders API + vault attributes).
 * Some sandbox setups reject "vault without purchase" with CANNOT_PAY_SELF while normal checkout
 * works, so this is the default: the user approves a $1.00 hold with "save for later", we
 * authorize it (which vaults the wallet), keep the vault_id, and void the hold right away.
 * ------------------------------------------------------------------------------------------- */

export const VERIFY_HOLD_AMOUNT = "1.00";

export async function createVaultOrder(returnUrl: string, cancelUrl: string, idempotencyKey: string) {
  const res = await paypalRequest<{ id: string; links?: PayPalLink[] }>("POST", "/v2/checkout/orders", {
    idempotencyKey,
    body: {
      intent: "AUTHORIZE",
      purchase_units: [
        {
          description: "AgentGuard wallet check: $1.00 hold, released immediately",
          amount: { currency_code: "USD", value: VERIFY_HOLD_AMOUNT },
        },
      ],
      payment_source: {
        paypal: {
          attributes: { vault: { store_in_vault: "ON_SUCCESS", usage_type: "MERCHANT", customer_type: "CONSUMER" } },
          experience_context: {
            brand_name: "AgentGuard",
            shipping_preference: "NO_SHIPPING",
            user_action: "CONTINUE",
            return_url: returnUrl,
            cancel_url: cancelUrl,
          },
        },
      },
    },
  });
  const approveUrl = res.links?.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href;
  if (!approveUrl) throw new Error("PayPal vault order has no approval link");
  return { setupTokenId: res.id, approveUrl };
}

/** Authorizes the approved $1 order (this saves the wallet), reads the vault_id, then voids the hold. */
export async function completeVaultOrder(orderId: string) {
  const order = await paypalRequest<{
    status: string;
    payment_source?: { paypal?: { attributes?: { vault?: { id?: string; status?: string; customer?: { id?: string } } } } };
    purchase_units?: { payments?: { authorizations?: { id: string }[] } }[];
  }>("POST", `/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`, { body: {}, idempotencyKey: `vault-authorize-${orderId}` });

  const vault = order.payment_source?.paypal?.attributes?.vault;
  const authId = order.purchase_units?.[0]?.payments?.authorizations?.[0]?.id;
  // Release the $1.00 verification hold whatever happens next.
  if (authId) {
    await paypalRequest("POST", `/v2/payments/authorizations/${encodeURIComponent(authId)}/void`, { idempotencyKey: `vault-void-${authId}` }).catch(
      (err) => console.error("[paypal] could not void the $1 verification hold:", err),
    );
  }
  if (!vault?.id) throw new Error(`PayPal did not return a saved wallet (order ${order.status}, vault ${vault?.status ?? "none"})`);
  return { vaultId: vault.id, customerId: vault.customer?.id ?? null };
}
