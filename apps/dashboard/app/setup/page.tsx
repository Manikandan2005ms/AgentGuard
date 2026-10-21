"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api, type MeResponse } from "@/lib/api";

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <section className="card p-5">
      <div className="flex items-center gap-3">
        <span
          className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${done ? "bg-ok text-ink" : "border border-line text-muted"}`}
        >
          {done ? "✓" : n}
        </span>
        <h2 className="text-lg font-semibold">{title}</h2>
      </div>
      <div className="mt-3 pl-11 text-sm">{children}</div>
    </section>
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
        ? "✓ PayPal wallet connected. Your agent can now pay without a redirect, but only through AgentGuard."
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
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Setup</h1>
        <p className="text-sm text-muted">Three steps to give an agent your wallet without giving it a blank cheque.</p>
      </div>
      {notice && <div className="card border-shield/40 p-3 text-sm">{notice}</div>}

      <Step n={1} title="Connect your PayPal wallet" done={!!me?.user.paypalConnected}>
        <p className="text-muted">
          You approve AgentGuard once on PayPal (Vault). After that, agent payments are authorized without a redirect, and only after they pass your
          policy. Ask-human payments are <b>authorized (held)</b> and captured only when you approve. To verify the wallet, PayPal shows a{" "}
          <b>$1.00 hold</b> that AgentGuard releases immediately.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {me?.user.paypalConnected ? (
            <>
              <span className="text-ok">Connected</span>
              <button className="btn btn-ghost" onClick={disconnect}>
                Disconnect
              </button>
            </>
          ) : (
            <button className="btn btn-primary" disabled={busy} onClick={connectPayPal}>
              {busy ? "Redirecting…" : "Connect PayPal"}
            </button>
          )}
          <span className="text-xs text-muted">
            Mode: {me?.modes.paypal === "sandbox" ? `PayPal sandbox (${me.modes.paypalFlow} flow)` : "mock PayPal (no keys set): payments are simulated"}
          </span>
        </div>
      </Step>

      <Step n={2} title="Link your phone (Telegram)" done={!!me?.user.telegramConnected}>
        {me?.modes.telegram === "off" ? (
          <p className="text-muted">
            Set <code className="font-mono">TELEGRAM_BOT_TOKEN</code> in <code className="font-mono">.env</code> (create a bot with @BotFather), restart the API, then come
            back here. Until then, approve payments from the Live page.
          </p>
        ) : me?.user.telegramConnected ? (
          <p>
            Linked to <b>@{me.user.telegramUsername}</b>. Approval requests arrive with ✅ Approve / ❌ Reject buttons. Send <code>/freeze</code> to the bot to stop
            all spending.
          </p>
        ) : (
          <p>
            Open{" "}
            {me?.modes.telegramBot ? (
              <a className="text-shield underline" href={`https://t.me/${me.modes.telegramBot}`} target="_blank" rel="noreferrer">
                t.me/{me.modes.telegramBot}
              </a>
            ) : (
              "your bot"
            )}{" "}
            on your phone and send <code className="font-mono">/start</code>. Then refresh this page.
          </p>
        )}
      </Step>

      <Step n={3} title="Write your spending rules" done={hasPolicy}>
        <p className="text-muted">Plain English, e.g. “Never buy gift cards. Ask me before anything over $50.”</p>
        <Link href="/policies" className="btn btn-ghost mt-3">
          {hasPolicy ? "Edit policy" : "Write your first policy"}
        </Link>
      </Step>

      <section className="card p-5">
        <h2 className="text-lg font-semibold">Connect any MCP agent</h2>
        <p className="mt-1 text-sm text-muted">
          AgentGuard is a “guarded PayPal” MCP server. Point your agent at it instead of calling PayPal directly; every money-moving call passes the
          firewall first. Tools: <code>start_task</code>, <code>request_payment</code>, <code>get_payment_status</code>, <code>get_remaining_budget</code>, plus PayPal&apos;s
          own <b>Agent Toolkit</b> tools under their usual names (<code>create_refund</code>, <code>accept_dispute_claim</code>, <code>list_invoices</code>, …). Read-only ones
          pass straight through; anything that moves money or changes data is checked by your policy and can wait for your approval.
        </p>
        <pre className="mt-3 overflow-auto rounded-lg bg-ink/70 p-3 font-mono text-xs text-cyan-200">{mcpConfig}</pre>
        <p className="mt-3 text-sm text-muted">Or run the demo agent against the demo stores ({me?.urls.stores}):</p>
        <pre className="mt-2 overflow-auto rounded-lg bg-ink/70 p-3 font-mono text-xs">npm run agent -- &quot;Buy oat milk and the cheapest bread you can find&quot;</pre>
      </section>

      <section className="card p-5 text-sm">
        <h2 className="text-lg font-semibold">AI checks</h2>
        {me?.modes.llm.enabled ? (
          <p className="mt-1 text-muted">
            Claude is on: policy compiler <code>{me.modes.llm.model}</code>, in-path checks <code>{me.modes.llm.fastModel}</code>. AI can only raise risk, never
            lower it.
          </p>
        ) : (
          <p className="mt-1 text-muted">
            Heuristics only. Set <code>ANTHROPIC_API_KEY</code> in <code>.env</code> to add the Claude policy compiler, intent checker, injection classifier and
            explainer.
          </p>
        )}
      </section>
    </div>
  );
}
