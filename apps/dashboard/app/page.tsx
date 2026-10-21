"use client";

import type { PaymentRequestDTO } from "@agentguard/shared";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { PaymentCard, needsYou } from "@/components/PaymentCard";
import { api, money } from "@/lib/api";
import { useLiveEvents } from "@/lib/useLiveEvents";

interface Summary {
  last24h: { total: number; approved: number; askedHuman: number; blocked: number; spent: number };
  last7d: { total: number; spent: number; blocked: number; injectionsBlocked: number; avgRisk: number };
  pendingApprovals: number;
}

function Tally({ label, when, value, dot, hot }: { label: string; when: string; value: string | number; dot?: string; hot?: boolean }) {
  return (
    <div className={`px-4 py-4 sm:px-5 ${hot ? "bg-warn-wash" : "bg-sheet"}`}>
      <div className="mark !text-[13px] !text-ink" style={{ "--dot": dot ?? "transparent" } as React.CSSProperties}>
        {label}
      </div>
      <div className={`figure mt-2 font-serif text-[34px] leading-none font-medium ${hot ? "text-warn" : ""}`}>{value}</div>
      <div className="mt-1.5 text-[12px] text-ink-3">{when}</div>
    </div>
  );
}

export default function LivePage() {
  const [items, setItems] = useState<PaymentRequestDTO[] | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSummary = useCallback(() => {
    api<Summary>("/api/stats/summary").then(setSummary).catch(() => undefined);
  }, []);

  useEffect(() => {
    api<PaymentRequestDTO[]>("/api/audit?limit=40")
      .then((rows) => setItems(rows.filter((r) => !r.paypalOrderId?.startsWith("SEED-"))))
      .catch((e) => setError(e.message));
    loadSummary();
  }, [loadSummary]);

  const connected = useLiveEvents((e) => {
    if (e.type === "payment.created") {
      setItems((prev) => [e.payment, ...(prev ?? [])].slice(0, 60));
      setFresh((f) => new Set(f).add(e.payment.id));
      loadSummary();
    } else if (e.type === "payment.updated") {
      setItems((prev) => (prev ?? []).map((p) => (p.id === e.payment.id ? e.payment : p)));
      loadSummary();
    }
  });

  const waiting = items?.filter(needsYou) ?? [];
  const rest = items?.filter((p) => !needsYou(p)) ?? [];
  const n = (v: number | undefined) => v ?? "–";

  return (
    <div>
      <PageHeader
        title="Live activity"
        aside={
          <span className="mark" style={{ "--dot": connected ? "var(--color-ok)" : "var(--color-ink-3)" } as React.CSSProperties}>
            {connected ? "Connected, updating as it happens" : "Connecting…"}
          </span>
        }
      >
        Every payment your agents try to make, and what AgentGuard decided about it.
      </PageHeader>

      <section aria-label="Totals" className="mb-10 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-rule bg-rule sm:grid-cols-3 lg:grid-cols-6">
        <Tally label="Approved" when="last 24 hours" value={n(summary?.last24h.approved)} dot="var(--color-ok)" />
        <Tally label="Asked you" when="last 24 hours" value={n(summary?.last24h.askedHuman)} dot="var(--color-warn)" />
        <Tally label="Blocked" when="last 24 hours" value={n(summary?.last24h.blocked)} dot="var(--color-bad)" />
        <Tally label="Spent" when="last 24 hours" value={summary ? money(summary.last24h.spent) : "–"} />
        <Tally label="Waiting for you" when="right now" value={n(summary?.pendingApprovals)} hot={!!summary?.pendingApprovals} />
        <Tally label="Injections stopped" when="last 7 days" value={n(summary?.last7d.injectionsBlocked)} dot="var(--color-bad)" />
      </section>

      {error && <p className="mb-6 text-[14px] text-bad">{error}</p>}

      {items && items.length === 0 && (
        <div className="sheet px-6 py-14 text-center">
          <p className="section-title">Nothing has happened yet.</p>
          <p className="mx-auto mt-2 max-w-md text-ink-2">
            When an agent tries to pay for something, it shows up here with AgentGuard&apos;s decision. The quickest way to see one is to run a scenario.
          </p>
          <Link href="/try" className="btn btn-primary mt-6">
            Run a scenario
          </Link>
          <p className="mt-8 text-[13px] text-ink-3">Or from a terminal:</p>
          <pre className="mx-auto mt-2 inline-block rounded-[5px] bg-night px-4 py-2.5 text-left font-mono text-[13px] text-[#e9e4d8]">
            npm run agent -- &quot;Buy oat milk and the cheapest bread you can find&quot;
          </pre>
          <p className="mt-6 text-[13.5px] text-ink-2">
            You can also set your rules first, on the{" "}
            <Link className="link" href="/policies">
              Policies
            </Link>{" "}
            page.
          </p>
        </div>
      )}

      {waiting.length > 0 && (
        <section className="mb-10">
          <h2 className="section-title flex items-baseline gap-3">
            Waiting for you <span className="figure font-sans text-[14px] font-semibold text-warn">{waiting.length}</span>
          </h2>
          <p className="mt-1 mb-4 text-[14px] text-ink-2">AgentGuard paused these to ask you first. Nothing is charged until you decide, here or from your phone.</p>
          <div className="space-y-3">
            {waiting.map((p) => (
              <PaymentCard key={p.id} p={p} fresh={fresh.has(p.id)} />
            ))}
          </div>
        </section>
      )}

      {rest.length > 0 && (
        <section>
          <h2 className="section-title mb-4">Recent</h2>
          <div className="space-y-3">
            {rest.map((p) => (
              <PaymentCard key={p.id} p={p} fresh={fresh.has(p.id)} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
