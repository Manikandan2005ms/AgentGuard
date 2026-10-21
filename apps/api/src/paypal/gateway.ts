import { randomUUID } from "node:crypto";
import { env, paypalMode } from "../env";
import * as orders from "./orders";
import { listTransactions, type ReportedTransaction } from "./reporting";
import * as vault from "./vault";
import { verifyWebhookSignature, type PayPalWebhookEvent } from "./webhooks";

/**
 * One interface over PayPal. "sandbox" talks to the real PayPal REST API; "mock" is an
 * in-memory stand-in (no credentials needed) that emits the same webhook events, so the
 * whole pipeline can be developed and demoed before sandbox keys exist.
 */

export interface StartPaymentArgs {
  requestId: string;
  description: string;
  amount: number;
  currency: string;
  payeeEmail?: string;
  vaultId?: string | null;
}

export interface StartPaymentResult {
  orderId: string;
  /** Set when funds are already authorized (held). */
  authorizationId: string | null;
  /** Set in the approval-link fallback: the user must approve on PayPal first. */
  approveUrl: string | null;
}

export interface PaymentsGateway {
  readonly mode: "sandbox" | "mock";
  startPayment(args: StartPaymentArgs): Promise<StartPaymentResult>;
  authorizeApproved(orderId: string, requestId: string): Promise<string>;
  capture(authorizationId: string, requestId: string): Promise<{ captureId: string; status: string }>;
  void(authorizationId: string, requestId: string): Promise<void>;
  refund(captureId: string, requestId: string): Promise<{ refundId: string; status: string }>;
  createVaultSetup(returnUrl: string, cancelUrl: string): Promise<{ setupTokenId: string; approveUrl: string }>;
  completeVaultSetup(setupTokenId: string): Promise<{ vaultId: string; customerId: string | null }>;
  verifyWebhook(headers: Record<string, string | string[] | undefined>, event: PayPalWebhookEvent): Promise<boolean>;
  listTransactions(start: Date, end: Date): Promise<ReportedTransaction[]>;
}

class SandboxGateway implements PaymentsGateway {
  readonly mode = "sandbox" as const;

  async startPayment(a: StartPaymentArgs): Promise<StartPaymentResult> {
    const order = await orders.createOrder(
      {
        referenceId: a.requestId,
        customId: a.requestId,
        description: a.description,
        amount: a.amount,
        currency: a.currency,
        payeeEmail: a.payeeEmail,
        vaultId: a.vaultId ?? undefined,
        returnUrl: `${env.PUBLIC_BASE_URL}/api/paypal/order/return`,
        cancelUrl: `${env.PUBLIC_BASE_URL}/api/paypal/order/cancel`,
      },
      `${a.requestId}-create`,
    );
    let auth = orders.extractAuthorization(order);
    // With a vaulted wallet PayPal usually authorizes on create; if not, authorize explicitly.
    if (!auth && a.vaultId) {
      const authorized = await orders.authorizeOrder(order.id, `${a.requestId}-authorize`);
      auth = orders.extractAuthorization(authorized);
    }
    if (auth) return { orderId: order.id, authorizationId: auth.id, approveUrl: null };
    const link = orders.approvalLink(order);
    if (link) return { orderId: order.id, authorizationId: null, approveUrl: link };
    throw new Error(`PayPal order ${order.id} is in unexpected state ${order.status}`);
  }

  async authorizeApproved(orderId: string, requestId: string): Promise<string> {
    const order = await orders.authorizeOrder(orderId, `${requestId}-authorize`);
    const auth = orders.extractAuthorization(order);
    if (!auth) throw new Error(`Authorization missing on order ${orderId} (status ${order.status})`);
    return auth.id;
  }

  async capture(authorizationId: string, requestId: string) {
    const c = await orders.captureAuthorization(authorizationId, `${requestId}-capture`);
    return { captureId: c.id, status: c.status };
  }

  async void(authorizationId: string, requestId: string) {
    await orders.voidAuthorization(authorizationId, `${requestId}-void`);
  }

  async refund(captureId: string, requestId: string) {
    const r = await orders.refundCapture(captureId, `${requestId}-refund`);
    return { refundId: r.id, status: r.status };
  }

  createVaultSetup(returnUrl: string, cancelUrl: string) {
    return env.PAYPAL_VAULT_METHOD === "purchase"
      ? vault.createVaultOrder(returnUrl, cancelUrl, `vault-order-${randomUUID()}`)
      : vault.createSetupToken(returnUrl, cancelUrl, `setup-${randomUUID()}`);
  }

  completeVaultSetup(setupTokenId: string) {
    return env.PAYPAL_VAULT_METHOD === "purchase"
      ? vault.completeVaultOrder(setupTokenId)
      : vault.createPaymentToken(setupTokenId, `token-${setupTokenId}`);
  }

  verifyWebhook(headers: Record<string, string | string[] | undefined>, event: PayPalWebhookEvent) {
    return verifyWebhookSignature(headers, event);
  }

  listTransactions(start: Date, end: Date) {
    return listTransactions(start, end);
  }
}

type MockEventHandler = (event: PayPalWebhookEvent) => Promise<void>;
let mockEventHandler: MockEventHandler | null = null;

/** The webhook processor registers here so mock payments produce the same events PayPal would. */
export function setMockEventHandler(fn: MockEventHandler) {
  mockEventHandler = fn;
}

class MockGateway implements PaymentsGateway {
  readonly mode = "mock" as const;
  private auths = new Map<string, { requestId: string; amount: number; currency: string; status: string }>();
  private captures = new Map<string, { requestId: string; authorizationId: string; amount: number; date: string }>();

  private id(prefix: string) {
    return `MOCK-${prefix}-${randomUUID().slice(0, 8).toUpperCase()}`;
  }

  private emit(event_type: string, resource: PayPalWebhookEvent["resource"]) {
    const event: PayPalWebhookEvent = { id: this.id("WH"), event_type, resource, create_time: new Date().toISOString() };
    setTimeout(() => void mockEventHandler?.(event).catch((e) => console.error("[mock webhook]", e)), 150);
  }

  async startPayment(a: StartPaymentArgs): Promise<StartPaymentResult> {
    const orderId = this.id("ORDER");
    const authorizationId = this.id("AUTH");
    this.auths.set(authorizationId, { requestId: a.requestId, amount: a.amount, currency: a.currency, status: "CREATED" });
    this.emit("PAYMENT.AUTHORIZATION.CREATED", { id: authorizationId, status: "CREATED", custom_id: a.requestId });
    return { orderId, authorizationId, approveUrl: null };
  }

  async authorizeApproved(_orderId: string, requestId: string) {
    const authorizationId = this.id("AUTH");
    this.auths.set(authorizationId, { requestId, amount: 0, currency: "USD", status: "CREATED" });
    return authorizationId;
  }

  async capture(authorizationId: string, requestId: string) {
    const auth = this.auths.get(authorizationId);
    if (auth?.status === "VOIDED") throw new Error("Authorization was voided");
    const captureId = this.id("CAPTURE");
    if (auth) auth.status = "CAPTURED";
    this.captures.set(captureId, { requestId, authorizationId, amount: auth?.amount ?? 0, date: new Date().toISOString() });
    this.emit("PAYMENT.CAPTURE.COMPLETED", {
      id: captureId,
      status: "COMPLETED",
      custom_id: requestId,
      supplementary_data: { related_ids: { authorization_id: authorizationId } },
    });
    return { captureId, status: "COMPLETED" };
  }

  async void(authorizationId: string, requestId: string) {
    const auth = this.auths.get(authorizationId);
    if (auth?.status === "CAPTURED") throw new Error("Authorization already captured");
    if (auth) auth.status = "VOIDED";
    this.emit("PAYMENT.AUTHORIZATION.VOIDED", { id: authorizationId, status: "VOIDED", custom_id: requestId });
  }

  async refund(captureId: string, requestId: string) {
    const refundId = this.id("REFUND");
    this.emit("PAYMENT.CAPTURE.REFUNDED", {
      id: refundId,
      status: "COMPLETED",
      custom_id: requestId,
      supplementary_data: { related_ids: { capture_id: captureId } },
    });
    return { refundId, status: "COMPLETED" };
  }

  async createVaultSetup(returnUrl: string) {
    const setupTokenId = this.id("SETUP");
    const url = new URL(returnUrl);
    url.searchParams.set("approval_token_id", setupTokenId);
    return { setupTokenId, approveUrl: url.toString() };
  }

  async completeVaultSetup(_setupTokenId: string) {
    return { vaultId: this.id("VAULT"), customerId: this.id("CUSTOMER") };
  }

  async verifyWebhook() {
    return false; // real webhooks never arrive in mock mode
  }

  async listTransactions(start: Date, end: Date) {
    return [...this.captures.entries()]
      .filter(([, c]) => c.date >= start.toISOString() && c.date <= end.toISOString())
      .map(([id, c]) => ({ transactionId: id, status: "S", amount: c.amount, date: c.date }));
  }
}

export const gateway: PaymentsGateway = paypalMode === "sandbox" ? new SandboxGateway() : new MockGateway();
