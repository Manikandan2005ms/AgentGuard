import { paypalRequest } from "./client";

export interface PayPalLink {
  href: string;
  rel: string;
  method?: string;
}

export interface PayPalAuthorization {
  id: string;
  status: string;
}

export interface PayPalOrder {
  id: string;
  status: string; // CREATED | APPROVED | PAYER_ACTION_REQUIRED | COMPLETED | ...
  links?: PayPalLink[];
  purchase_units?: {
    reference_id?: string;
    payments?: { authorizations?: PayPalAuthorization[]; captures?: { id: string; status: string }[] };
  }[];
}

export interface CreateOrderArgs {
  referenceId: string;
  description: string;
  customId?: string;
  amount: number;
  currency: string;
  payeeEmail?: string;
  /** Vaulted wallet: buyer-not-present payment (README §8.3). */
  vaultId?: string;
  /** Approval-link fallback (README §8.4). */
  returnUrl?: string;
  cancelUrl?: string;
}

export async function createOrder(args: CreateOrderArgs, idempotencyKey: string): Promise<PayPalOrder> {
  const paypalSource = args.vaultId
    ? { vault_id: args.vaultId }
    : {
        experience_context: {
          brand_name: "AgentGuard",
          shipping_preference: "NO_SHIPPING",
          user_action: "PAY_NOW",
          return_url: args.returnUrl,
          cancel_url: args.cancelUrl,
        },
      };
  return paypalRequest<PayPalOrder>("POST", "/v2/checkout/orders", {
    idempotencyKey,
    body: {
      intent: "AUTHORIZE",
      purchase_units: [
        {
          reference_id: args.referenceId,
          description: args.description.slice(0, 127),
          custom_id: args.customId?.slice(0, 127),
          amount: { currency_code: args.currency, value: args.amount.toFixed(2) },
          ...(args.payeeEmail ? { payee: { email_address: args.payeeEmail } } : {}),
        },
      ],
      payment_source: { paypal: paypalSource },
    },
  });
}

export async function getOrder(orderId: string): Promise<PayPalOrder> {
  return paypalRequest<PayPalOrder>("GET", `/v2/checkout/orders/${encodeURIComponent(orderId)}`);
}

/** Holds the funds. */
export async function authorizeOrder(orderId: string, idempotencyKey: string): Promise<PayPalOrder> {
  return paypalRequest<PayPalOrder>("POST", `/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`, {
    idempotencyKey,
    body: {},
  });
}

export async function captureAuthorization(authorizationId: string, idempotencyKey: string): Promise<{ id: string; status: string }> {
  return paypalRequest("POST", `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/capture`, {
    idempotencyKey,
    body: { final_capture: true },
  });
}

export async function voidAuthorization(authorizationId: string, idempotencyKey: string): Promise<void> {
  await paypalRequest("POST", `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/void`, {
    idempotencyKey,
  });
}

export async function refundCapture(captureId: string, idempotencyKey: string): Promise<{ id: string; status: string }> {
  return paypalRequest("POST", `/v2/payments/captures/${encodeURIComponent(captureId)}/refund`, {
    idempotencyKey,
    body: {},
  });
}

export function extractAuthorization(order: PayPalOrder): PayPalAuthorization | null {
  for (const pu of order.purchase_units ?? []) {
    const auth = pu.payments?.authorizations?.[0];
    if (auth) return auth;
  }
  return null;
}

export function approvalLink(order: PayPalOrder): string | null {
  return order.links?.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href ?? null;
}
