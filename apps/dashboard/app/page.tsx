"use client";

import type { PaymentRequestDTO } from "@agentguard/shared";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { PaymentCard } from "@/components/PaymentCard";
import { api, money } from "@/lib/api";
import { useLiveEvents } from "@/lib/useLiveEvents";

interface Summary {
  last24h: { total: number; approved: number; askedHuman: number; blocked: number; spent: number };
  last7d: { total: number; spent: number; blocked: number; injectionsBlocked: number; avgRisk: number };
  pendingApprovals: number;
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: "ok" | "warn" | "bad" }) {
  const color = tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : tone === "bad" ? "text-bad" : "text-text";
  return (
    <div className="card px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-bold ${color}`}>{value}</div>
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Live agent payments</h1>
          <p className="text-sm text-muted">Every payment your agents attempt, decided in real time.</p>
        </div>
        <span className={`flex items-center gap-2 text-xs ${connected ? "text-ok" : "text-muted"}`}>
          <span className={`h-2 w-2 rounded-full ${connected ? "bg-ok animate-pulse" : "bg-muted"}`} />
          {connected ? "Live" : "Connecting…"}
        </span>
      </div>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Stat label="Approved (24h)" value={summary?.last24h.approved ?? "–"} tone="ok" />
        <Stat label="Asked you (24h)" value={summary?.last24h.askedHuman ?? "–"} tone="warn" />
        <Stat label="Blocked (24h)" value={summary?.last24h.blocked ?? "–"} tone="bad" />
        <Stat label="Spent (24h)" value={summary ? money(summary.last24h.spent) : "–"} />
        <Stat label="Awaiting you" value={summary?.pendingApprovals ?? "–"} tone={summary?.pendingApprovals ? "warn" : undefined} />
        <Stat label="Injections stopped (7d)" value={summary?.last7d.injectionsBlocked ?? "–"} tone="bad" />
      </section>

      {error && <p className="text-sm text-bad">{error}</p>}
      {items && items.length === 0 && (
        <div className="card p-8 text-center">
          <p className="text-lg font-semibold">No agent payments yet</p>
          <p className="mt-1 text-sm text-muted">Run the demo agent and watch requests appear here:</p>
          <pre className="mx-auto mt-3 inline-block rounded-lg bg-panel-2 px-3 py-2 text-left font-mono text-sm">
            npm run agent -- &quot;Buy oat milk and the cheapest bread you can find&quot;
          </pre>
          <p className="mt-3 text-sm text-muted">
            Or set your rules first on the <Link className="text-shield underline" href="/policies">Policies</Link> page.
          </p>
        </div>
      )}
      <section className="grid gap-3 lg:grid-cols-2">
        {items?.map((p) => <PaymentCard key={p.id} p={p} fresh={fresh.has(p.id)} />)}
      </section>
    </div>
  );
}
