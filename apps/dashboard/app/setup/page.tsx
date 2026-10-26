"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { aiName, api, type MeResponse } from "@/lib/api";

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <li className="sheet grid grid-cols-[40px_minmax(0,1fr)] gap-x-4 p-5 sm:grid-cols-[56px_minmax(0,1fr)] sm:p-6">
      <span className={`figure font-serif text-[40px] leading-[0.9] font-medium ${done ? "text-ok" : "text-rule-2"}`} aria-hidden>
        {n}
      </span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="section-title">{title}</h2>
          {done && <span className="stamp text-ok">Done</span>}
        </div>
        <div className="mt-2 space-y-3 text-[14.5px] text-ink-2">{children}</div>
      </div>
    </li>
  );
}

export default function SetupPage() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [hasPolicy, setHasPolicy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    api<MeResponse>("/api/me").then(setMe).catch(() => undefined);
    api<{ policy: unknown }>("/api/policies/active").then((r) => setHasPolicy(!!r.policy)).catch(() => undefined);
  };

  useEffect(() => {
    load();
    const q = new URLSearchParams(window.location.search).get("paypal");
    if (q === "error") setNotice("PayPal connection failed. Check the API logs and your sandbox app settings.");
    if (q === "cancelled") setNotice("PayPal connection cancelled.");
    // Drop ?paypal=… from the address so a bookmarked or autocompleted URL can't replay an old message.
    if (q) window.history.replaceState(null, "", window.location.pathname);
  }, []);

  // "Connected" comes from the API, never from the URL alone.
  const justConnected = useRef(typeof window !== "undefined" && new URLSearchParams(window.location.search).get("paypal") === "connected");
  useEffect(() => {
    if (!me || !justConnected.current) return;
    justConnected.current = false;
    setNotice(
      me.user.paypalConnected
        ? "PayPal wallet connected. Your agent can now pay without a redirect, but only through AgentGuard."
        : "PayPal didn't finish connecting. Click Connect PayPal and log in on the PayPal page.",
    );
  }, [me]);

  const connectPayPal = async () => {
    setBusy(true);
    try {
      const r = await api<{ approveUrl: string }>("/api/paypal/vault/setup", { method: "POST" });
      window.location.href = r.approveUrl;
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const disconnect = async () => {
    await api("/api/paypal/vault/disconnect", { method: "POST" });
    load();
  };

  const mcpConfig = me
    ? JSON.stringify(
        {
          mcpServers: {
            agentguard: {
              type: "http",
              url: me.urls.mcp,
              ...(me.modes.agentKeyRequired ? { headers: { Authorization: "Bearer <AGENT_API_KEY>" } } : {}),
            },
          },
        },
        null,
        2,
      )
    : "";

  return (
    <div className="max-w-[780px]">
      <PageHeader title="Setup">Three steps to hand an agent your wallet without handing it a blank cheque.</PageHeader>
      {notice && <div className="sheet mb-6 border-l-[3px] !border-l-accent px-4 py-3 text-[14px]">{notice}</div>}

      <ol className="space-y-4">
        <Step n={1} title="Connect your PayPal wallet" done={!!me?.user.paypalConnected}>
          <p>
            You approve AgentGuard once on PayPal. After that, agent payments go through without a redirect, and only after they pass your rules. When a payment
            needs your say-so, PayPal <b className="font-semibold text-ink">holds</b> the money and AgentGuard captures it only if you approve. To check the
            wallet, PayPal shows a <b className="font-semibold text-ink">$1.00 hold</b> that AgentGuard releases straight away.
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {me?.user.paypalConnected ? (
              <>
                <span className="font-medium text-ok">Connected</span>
                <button className="btn btn-sm btn-quiet" onClick={disconnect}>
                  Disconnect
                </button>
              </>
            ) : (
              <button className="btn btn-primary" disabled={busy} onClick={connectPayPal}>
                {busy ? "Taking you to PayPal…" : "Connect PayPal"}
              </button>
            )}
            <span className="text-[13px] text-ink-3">
              {me?.modes.paypal === "sandbox" ? `PayPal sandbox, ${me.modes.paypalFlow} flow` : "Mock PayPal (no keys set), so payments are simulated"}
            </span>
          </div>
        </Step>

        <Step n={2} title="Link your phone" done={!!me?.user.telegramConnected}>
          {me?.modes.telegram === "off" ? (
            <p>
              Set <code>TELEGRAM_BOT_TOKEN</code> in <code>.env</code> (create a bot with @BotFather), restart the API, then come back here. Until then, you can
              approve payments from the Live page.
            </p>
          ) : me?.user.telegramConnected ? (
            <p>
              Linked to <b className="font-semibold text-ink">@{me.user.telegramUsername}</b> on Telegram. Approval requests arrive with Approve and Reject buttons.
              Send <code>/freeze</code> to the bot to stop all spending.
            </p>
          ) : (
            <p>
              Open{" "}
              {me?.modes.telegramBot ? (
                <a className="link" href={`https://t.me/${me.modes.telegramBot}`} target="_blank" rel="noreferrer">
                  t.me/{me.modes.telegramBot}
                </a>
              ) : (
                "your bot"
              )}{" "}
              in Telegram on your phone and send <code>/start</code>, then refresh this page.
            </p>
          )}
        </Step>

        <Step n={3} title="Write your spending rules" done={hasPolicy}>
          <p>
            In plain English, for example <span className="font-serif text-[15.5px] italic text-ink">“Never buy gift cards. Ask me before anything over $50.”</span>
          </p>
          <Link href="/policies" className="btn btn-quiet">
            {hasPolicy ? "Edit your rules" : "Write your first rules"}
          </Link>
        </Step>
      </ol>

      <section className="mt-12 border-t border-rule pt-8">
        <h2 className="section-title">Connect any MCP agent</h2>
        <div className="mt-2 space-y-3 text-[14.5px] text-ink-2">
          <p>
            AgentGuard is a guarded PayPal MCP server. Point your agent at it instead of at PayPal, and every call that moves money passes the firewall first.
          </p>
          <p>
            Its own tools are <code>start_task</code>, <code>request_payment</code>, <code>get_payment_status</code> and <code>get_remaining_budget</code>. PayPal&apos;s{" "}
            <b className="font-semibold text-ink">Agent Toolkit</b> tools are there too, under their usual names (<code>create_refund</code>,{" "}
            <code>accept_dispute_claim</code>, <code>list_invoices</code> and so on). Read-only ones pass straight through; anything that moves money or changes data
            is checked against your rules and can wait for your approval.
          </p>
        </div>
        <pre className="mt-4 overflow-auto rounded-[5px] bg-night p-4 font-mono text-[12.5px] leading-relaxed text-[#e9e4d8]">{mcpConfig}</pre>
        <p className="mt-4 text-[14px] text-ink-2">
          Or run the demo agent against the demo stores{me?.urls.stores ? <> at {me.urls.stores}</> : null}:
        </p>
        <pre className="mt-2 overflow-auto rounded-[5px] bg-night p-4 font-mono text-[12.5px] text-[#e9e4d8]">
          npm run agent -- &quot;Buy oat milk and the cheapest bread you can find&quot;
        </pre>
      </section>

      <section className="mt-12 border-t border-rule pt-8">
        <h2 className="section-title">AI checks</h2>
        {me?.modes.llm.enabled ? (
          <p className="mt-2 text-[14.5px] text-ink-2">
            {aiName(me.modes.llm.provider)} is on. The policy compiler uses <code>{me.modes.llm.model}</code> and the in-path checks use <code>{me.modes.llm.fastModel}</code>. AI can only
            raise a payment&apos;s risk, never lower it.
          </p>
        ) : (
          <p className="mt-2 text-[14.5px] text-ink-2">
            Running on heuristics only. Set <code>GEMINI_API_KEY</code> (free) or <code>ANTHROPIC_API_KEY</code> in <code>.env</code> to add the AI policy
            compiler, intent checker, injection classifier and explainer.
          </p>
        )}
      </section>
    </div>
  );
}
