import type { PaymentRequestDTO } from "@agentguard/shared";

/**
 * Outbound notifications (Telegram). The bot registers real handlers at startup; until then,
 * or when no bot token is configured, these are no-ops and the dashboard is the approval UI.
 */
export interface Notifier {
  approvalNeeded(p: PaymentRequestDTO): Promise<number | null>;
  resolved(p: PaymentRequestDTO, telegramMessageId: number | null): Promise<void>;
  blocked(p: PaymentRequestDTO): Promise<void>;
}

export const notifier: Notifier = {
  approvalNeeded: async () => null,
  resolved: async () => {},
  blocked: async () => {},
};

export function setNotifier(n: Notifier) {
  Object.assign(notifier, n);
}
