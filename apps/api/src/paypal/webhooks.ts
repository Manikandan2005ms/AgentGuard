import { env } from "../env";
import { paypalRequest } from "./client";

export interface PayPalWebhookEvent {
  id: string;
  event_type: string;
  resource_type?: string;
  resource?: {
    id?: string;
    status?: string;
    custom_id?: string;
    invoice_id?: string;
    supplementary_data?: { related_ids?: { order_id?: string; authorization_id?: string; capture_id?: string } };
    purchase_units?: { reference_id?: string }[];
  };
  create_time?: string;
}

/** POST /v1/notifications/verify-webhook-signature (README §8.5). */
export async function verifyWebhookSignature(
  headers: Record<string, string | string[] | undefined>,
  event: PayPalWebhookEvent,
): Promise<boolean> {
  if (!env.PAYPAL_WEBHOOK_ID) return false;
  const h = (name: string) => {
    const v = headers[name];
    return Array.isArray(v) ? v[0] : v;
  };
  const res = await paypalRequest<{ verification_status: string }>("POST", "/v1/notifications/verify-webhook-signature", {
    body: {
      auth_algo: h("paypal-auth-algo"),
      cert_url: h("paypal-cert-url"),
      transmission_id: h("paypal-transmission-id"),
      transmission_sig: h("paypal-transmission-sig"),
      transmission_time: h("paypal-transmission-time"),
      webhook_id: env.PAYPAL_WEBHOOK_ID,
      webhook_event: event,
    },
  });
  return res.verification_status === "SUCCESS";
}
