"use client";

import type { BudgetUsageDTO } from "@agentguard/shared";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api, money } from "@/lib/api";
import { useLiveEvents } from "@/lib/useLiveEvents";

interface Summary {
  daily: { date: string; paid: number; blocked: number }[];
  last7d: { spent: number; blocked: number };
}

function BudgetBar({ b }: { b: BudgetUsageDTO }) {
  const pctSpent = Math.min(100, (b.spent / b.limit) * 100);
  const pctHeld = Math.min(100 - pctSpent, (b.held / b.limit) * 100);
  const remaining = Math.max(0, b.limit - b.spent - b.held);
  const tone = pctSpent + pctHeld >= 90 ? "text-bad" : pctSpent + pctHeld >= 70 ? "text-warn" : "text-ok";
  return (
    <div className="card p-4">
      <div className="flex items-baseline justify-between">
        <h3 className="font-semibold capitalize">{b.category === "*" ? "All categories" : b.category.replace("_", " ")}</h3>
        <span className="text-xs text-muted">per {b.period} (rolling)</span>
      </div>
      <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-line">
        <div className="bg-ok" style={{ width: `${pctSpent}%` }} title={`Spent ${money(b.spent)}`} />
        <div
          className="bg-warn"
          style={{ width: `${pctHeld}%`, backgroundImage: "repeating-linear-gradient(45deg,transparent 0 4px,rgba(0,0,0,.25) 4px 8px)" }}
          title={`Held ${money(b.held)}`}
        />
      </div>
      <div className="mt-2 flex flex-wrap justify-between gap-2 text-sm">
        <span>
          <span className="text-ok">{money(b.spent)}</span> spent
          {b.held > 0 && (
            <>
              {" "}
              · <span className="text-warn">{money(b.held)}</span> held
            </>
          )}
        </span>
        <span className={tone}>
          {money(remaining)} left of {money(b.limit)}
        </span>
      </div>
    </div>
  );
}

export default function BudgetsPage() {
  const [budgets, setBudgets] = useState<BudgetUsageDTO[] | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);

  const load = () => {
    api<BudgetUsageDTO[]>("/api/stats/budgets").then(setBudgets).catch(() => setBudgets([]));
    api<Summary>("/api/stats/summary").then(setSummary).catch(() => undefined);
  };
  useEffect(load, []);
  useLiveEvents((e) => {
    if (e.type !== "killswitch") load();
  });

  const max = Math.max(1, ...(summary?.daily.map((d) => d.paid) ?? [1]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Budgets</h1>
        <p className="text-sm text-muted">Spent vs. limit for every budget in your active policy. Held funds count against the budget until they are captured or voided.</p>
      </div>

      {budgets && budgets.length === 0 && (
        <div className="card p-6 text-sm">
          No budgets in your active policy. Add one on the{" "}
          <Link href="/policies" className="text-shield underline">
            Policies
          </Link>{" "}
          page, e.g. “Max $150 a week on groceries”.
        </div>
      )}
      <section className="grid gap-3 md:grid-cols-2">{budgets?.map((b) => <BudgetBar key={`${b.category}-${b.period}`} b={b} />)}</section>

      {summary && (
        <section className="card p-4">
          <div className="flex items-baseline justify-between">
            <h2 className="font-semibold">Captured spend, last 7 days</h2>
            <span className="text-sm text-muted">
              {money(summary.last7d.spent)} · {summary.last7d.blocked} blocked
            </span>
          </div>
          <div className="mt-4 flex h-40 items-end gap-2">
            {summary.daily.map((d) => (
              <div key={d.date} className="flex flex-1 flex-col items-center gap-1">
                <span className="text-[11px] text-muted">{d.paid ? money(d.paid) : ""}</span>
                <div className="w-full rounded-t bg-shield/70" style={{ height: `${(d.paid / max) * 100}%`, minHeight: d.paid ? 4 : 1 }} />
                <span className="text-[11px] text-muted">{new Date(d.date + "T12:00:00Z").toLocaleDateString(undefined, { weekday: "short" })}</span>
                {d.blocked > 0 && <span className="text-[10px] text-bad">⛔ {d.blocked}</span>}
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
