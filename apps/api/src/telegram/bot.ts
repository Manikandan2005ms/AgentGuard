import type { PaymentRequestDTO } from "@agentguard/shared";
import { prisma } from "../db";
import { env, telegramEnabled } from "../env";
import { publish } from "../events";
import { setNotifier } from "../services/notify";
import { approveRequest, PaymentStateError, rejectRequest } from "../services/paymentService";
import { getUser } from "../services/users";

/**
 * One-tap mobile approvals via the Telegram Bot API (README §4.6). Talks to the HTTP API
 * directly with fetch. Polling mode works on localhost; webhook mode is for deployments.
 */

interface TgUpdate {
  update_id: number;
  message?: { chat: { id: number; username?: string; first_name?: string }; text?: string };
  callback_query?: { id: string; data?: string; message?: { chat: { id: number }; message_id: number } };
}

let botUsername: string | null = null;
export const telegramBotUsername = () => botUsername;

async function tg<T = unknown>(method: string, body: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as { ok: boolean; result: T; description?: string };
  if (!json.ok) throw new Error(`Telegram ${method} failed: ${json.description}`);
  return json.result;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const money = (p: PaymentRequestDTO) => `${p.currency === "USD" ? "$" : `${p.currency} `}${p.amount.toFixed(2)}`;

function card(p: PaymentRequestDTO, header: string): string {
  const lines = [
    header,
    "",
    `🛒 <b>${esc(p.quantity > 1 ? `${p.quantity} × ${p.item}` : p.item)}</b>`,
    `🏪 ${esc(p.merchantName ?? p.merchantDomain)} <i>(${esc(p.merchantDomain)})</i>`,
    `💵 <b>${money(p)}</b>   ⚠️ Risk ${p.riskScore}/100`,
  ];
  if (p.taskDescription) lines.push(`🤖 Task: “${esc(p.taskDescription)}”`);
  lines.push("", `💬 ${esc(p.explanation)}`);
  return lines.join("\n");
}

const STATUS_LINE: Record<string, string> = {
  PAID: "✅ <b>Approved: payment captured</b>",
  VOIDED: "❌ <b>Rejected: hold released, no money moved</b>",
  FAILED: "⚠️ <b>Payment failed</b>",
  REFUNDED: "↩️ <b>Refunded</b>",
};

async function linkedChatId(): Promise<string | null> {
  return (await getUser()).telegramChatId;
}

async function approvalNeeded(p: PaymentRequestDTO): Promise<number | null> {
  const chatId = await linkedChatId();
  if (!chatId) return null;
  const buttons = p.approveUrl
    ? [[{ text: "✅ Approve on PayPal", url: p.approveUrl }, { text: "❌ Reject", callback_data: `reject:${p.id}` }]]
    : [[{ text: "✅ Approve", callback_data: `approve:${p.id}` }, { text: "❌ Reject", callback_data: `reject:${p.id}` }]];
  const msg = await tg<{ message_id: number }>("sendMessage", {
    chat_id: chatId,
    text: card(p, "🛡️ <b>AgentGuard: your agent wants to pay</b>\n<i>PayPal is holding the funds until you decide.</i>"),
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: buttons },
  });
  return msg.message_id;
}

async function resolved(p: PaymentRequestDTO, messageId: number | null): Promise<void> {
  const chatId = await linkedChatId();
  if (!chatId) return;
  const text = card(p, STATUS_LINE[p.status] ?? `ℹ️ <b>${p.status}</b>`) + (p.decidedBy === "timeout" ? "\n\n⏱️ No answer in time." : "");
  if (messageId) {
    await tg("editMessageText", { chat_id: chatId, message_id: messageId, text, parse_mode: "HTML" }).catch(() =>
      tg("sendMessage", { chat_id: chatId, text, parse_mode: "HTML" }),
    );
  } else {
    await tg("sendMessage", { chat_id: chatId, text, parse_mode: "HTML" });
  }
}

async function blocked(p: PaymentRequestDTO): Promise<void> {
  const chatId = await linkedChatId();
  if (!chatId) return;
  const patternCount = (t: string) => (/\(([^)]+)\)/.exec(t)?.[1]?.split(",").length ?? 0);
  const evidence =
    p.injectionEvidence.filter((e) => e.hidden).sort((a, b) => patternCount(b.technique) - patternCount(a.technique))[0] ?? p.injectionEvidence[0];
  const extra = evidence ? `\n\n🕵️ Hidden on the page:\n<code>${esc(evidence.snippet.slice(0, 220))}</code>` : "";
  await tg("sendMessage", {
    chat_id: chatId,
    text: card(p, "⛔ <b>AgentGuard blocked a payment</b>") + extra,
    parse_mode: "HTML",
  });
}

async function setKillSwitch(enabled: boolean) {
  const user = await getUser();
  await prisma.user.update({ where: { id: user.id }, data: { killSwitch: enabled } });
  publish({ type: "killswitch", enabled });
}

export async function handleUpdate(update: TgUpdate): Promise<void> {
  if (update.message?.text) {
    const chat = update.message.chat;
    const text = update.message.text.trim();
    const user = await getUser();
    if (text.startsWith("/start")) {
      await prisma.user.update({
        where: { id: user.id },
        data: { telegramChatId: String(chat.id), telegramUsername: chat.username ?? chat.first_name ?? null },
      });
      await tg("sendMessage", {
        chat_id: chat.id,
        text: "🛡️ <b>AgentGuard connected.</b>\nPayments that need your OK will show up here.\n\n/freeze: stop all agent spending\n/unfreeze: resume\n/status: current state",
        parse_mode: "HTML",
      });
      return;
    }
    if (user.telegramChatId !== String(chat.id)) {
      await tg("sendMessage", { chat_id: chat.id, text: "This chat is not linked. Send /start to link it." });
      return;
    }
    if (text.startsWith("/freeze")) {
      await setKillSwitch(true);
      await tg("sendMessage", { chat_id: chat.id, text: "🧊 Kill switch ON: all agent payments are blocked." });
    } else if (text.startsWith("/unfreeze")) {
      await setKillSwitch(false);
      await tg("sendMessage", { chat_id: chat.id, text: "▶️ Kill switch OFF: payments are evaluated by your policy again." });
    } else if (text.startsWith("/status")) {
      const pending = await prisma.paymentRequest.count({ where: { userId: user.id, status: { in: ["HELD", "PENDING"] } } });
      await tg("sendMessage", {
        chat_id: chat.id,
        text: `Kill switch: ${user.killSwitch ? "ON 🧊" : "off"}\nPending approvals: ${pending}\nDashboard: ${env.DASHBOARD_URL}`,
      });
    }
    return;
  }

  const cb = update.callback_query;
  if (cb?.data) {
    const [action, id] = cb.data.split(":");
    const user = await getUser();
    // Only the linked chat may approve or reject.
    if (!id || String(cb.message?.chat.id) !== user.telegramChatId) {
      await tg("answerCallbackQuery", { callback_query_id: cb.id, text: "Not authorized" });
      return;
    }
    try {
      const p = action === "approve" ? await approveRequest(id, "human") : await rejectRequest(id, "human");
      await tg("answerCallbackQuery", { callback_query_id: cb.id, text: p.status === "PAID" ? "Captured ✅" : p.status === "VOIDED" ? "Voided ❌" : p.status });
    } catch (err) {
      const msg = err instanceof PaymentStateError ? err.message : "Something went wrong";
      await tg("answerCallbackQuery", { callback_query_id: cb.id, text: msg.slice(0, 190), show_alert: true });
    }
  }
}

async function pollLoop() {
  let offset = 0;
  for (;;) {
    try {
      const updates = await tg<TgUpdate[]>("getUpdates", { offset, timeout: 25, allowed_updates: ["message", "callback_query"] });
      for (const u of updates) {
        offset = u.update_id + 1;
        await handleUpdate(u).catch((e) => console.error("[telegram] update failed", e));
      }
    } catch (err) {
      console.error("[telegram] polling error:", err instanceof Error ? err.message : err);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

export async function startTelegram(): Promise<void> {
  if (!telegramEnabled) {
    console.log("[telegram] TELEGRAM_BOT_TOKEN not set: approvals via dashboard only");
    return;
  }
  setNotifier({ approvalNeeded, resolved, blocked });
  try {
    const me = await tg<{ username: string }>("getMe");
    botUsername = me.username;
    if (env.TELEGRAM_MODE === "webhook") {
      await tg("setWebhook", {
        url: `${env.PUBLIC_BASE_URL}/webhooks/telegram`,
        secret_token: env.TELEGRAM_WEBHOOK_SECRET,
        allowed_updates: ["message", "callback_query"],
      });
      console.log(`[telegram] @${botUsername} webhook set`);
    } else {
      await tg("deleteWebhook", {});
      console.log(`[telegram] @${botUsername} polling for updates`);
      void pollLoop();
    }
  } catch (err) {
    console.error("[telegram] could not start:", err instanceof Error ? err.message : err);
  }
}
