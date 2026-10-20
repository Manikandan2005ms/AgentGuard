import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import type { PayPalWebhookEvent } from "../paypal/webhooks";
import { withRelations } from "./dto";
import { handleOrderApproved, updatePayment } from "./paymentService";

/**
 * Applies PayPal webhook events to payment requests (README §8.5). Idempotent: every event id
 * is stored once, and status changes never move a request backwards (e.g. PAID -> HELD).
 */
export async function processPayPalEvent(event: PayPalWebhookEvent, verified: boolean): Promise<string> {
  const exists = await prisma.webhookEvent.findUnique({ where: { id: event.id } });
  if (exists) return "duplicate";
  await prisma.webhookEvent.create({
    data: {
      id: event.id,
      eventType: event.event_type,
      resourceId: event.resource?.id ?? null,
      verified,
      payload: event as unknown as Prisma.InputJsonValue,
    },
  });

  const r = event.resource ?? {};
  const related = r.supplementary_data?.related_ids ?? {};

  if (event.event_type === "CHECKOUT.ORDER.APPROVED") {
    if (r.id) await handleOrderApproved(r.id);
    return "order-approved";
  }

  const row = await prisma.paymentRequest.findFirst({
    where: {
      OR: [
        ...(r.custom_id ? [{ id: r.custom_id }] : []),
        ...(r.id ? [{ paypalAuthId: r.id }, { paypalCaptureId: r.id }] : []),
        ...(related.authorization_id ? [{ paypalAuthId: related.authorization_id }] : []),
        ...(related.capture_id ? [{ paypalCaptureId: related.capture_id }] : []),
        ...(related.order_id ? [{ paypalOrderId: related.order_id }] : []),
      ],
    },
    include: withRelations,
  });
  if (!row) return "no-matching-request";

  switch (event.event_type) {
    case "PAYMENT.AUTHORIZATION.CREATED":
      if (row.status === "PENDING") await updatePayment(row.id, { status: "HELD", paypalAuthId: r.id ?? row.paypalAuthId });
      break;
    case "PAYMENT.CAPTURE.COMPLETED":
      if (row.status !== "PAID" && row.status !== "REFUNDED") {
        await updatePayment(row.id, { status: "PAID", paypalCaptureId: r.id ?? row.paypalCaptureId, resolvedAt: row.resolvedAt ?? new Date() });
      }
      break;
    case "PAYMENT.AUTHORIZATION.VOIDED":
      if (row.status === "HELD" || row.status === "PENDING") await updatePayment(row.id, { status: "VOIDED", resolvedAt: new Date() });
      break;
    case "PAYMENT.CAPTURE.DENIED":
      await updatePayment(row.id, { status: "FAILED", failureReason: "PayPal denied the capture", resolvedAt: new Date() });
      break;
    case "PAYMENT.CAPTURE.REFUNDED":
      await updatePayment(row.id, { status: "REFUNDED" });
      break;
    default:
      return "ignored";
  }
  return "applied";
}
