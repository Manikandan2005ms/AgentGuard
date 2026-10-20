"use client";

import type { BudgetUsageDTO } from "@agentguard/shared";
import type { AgChartOptions } from "ag-charts-community";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CHART_COLORS } from "@/components/Charts";
import { api, money } from "@/lib/api";
import { useLiveEvents } from "@/lib/useLiveEvents";

// Charts render in the browser only.
const Chart = dynamic(() => import("@/components/Charts").then((m) => m.Chart), {
  ssr: false,
  loading: () => <div className="h-[260px] animate-pulse rounded-lg bg-panel-2" />,
});

interface Summary {
  daily: { date: string; paid: number; blocked: number }[];
  last7d: { spent: number; blocked: number };
  decisions7d: { approve: number; askHuman: number; block: number };
  spendByCategory7d: { category: string; spent: number }[];
}

const label = (b: BudgetUsageDTO) => `${b.category === "*" ? "All categories" : b.category.replace("_", " ")} / ${b.period}`;
const usd = (v: number) => `$${Math.round(v)}`;

function BudgetBar({ b }: { b: BudgetUsageDTO }) {
  const pctSpent = Math.min(100, (b.spent / b.limit) * 100);
  const pctHeld = Math.min(100 - pctSpent, (b.held / b.limit) * 100);
  const remaining = Math.max(0, b.limit - b.spent - b.held);
  const tone = pctSpent + pctHeld >= 90 ? "text-bad" : pctSpent + pctHeld >= 70 ? "text-warn" : "text-ok";
  return (
    <div className="card p-4">
      <div className="flex items-baseline justify-between gap-2">
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
    if (e.type === "payment.created" || e.type === "payment.updated" || e.type === "policy.activated" || e.type === "demo.reset") load();
  });

  const budgetChart = useMemo<AgChartOptions | null>(() => {
    if (!budgets?.length) return null;
    const data = budgets.map((b) => ({ label: label(b), spent: b.spent, held: b.held, remaining: Math.max(0, b.limit - b.spent - b.held) }));
    return {
      title: { text: "Spent vs. limit" },
      data,
      series: [
        { type: "bar", direction: "horizontal", xKey: "label", yKey: "spent", yName: "Spent", stacked: true, fill: CHART_COLORS.ok, cornerRadius: 4 },
        { type: "bar", direction: "horizontal", xKey: "label", yKey: "held", yName: "Held for approval", stacked: true, fill: CHART_COLORS.warn },
        { type: "bar", direction: "horizontal", xKey: "label", yKey: "remaining", yName: "Remaining", stacked: true, fill: CHART_COLORS.line },
      ],
      axes: [
        { type: "category", position: "left" },
        { type: "number", position: "bottom", label: { formatter: ({ value }: { value: number }) => usd(value) } },
      ],
      legend: { position: "bottom" },
    };
  }, [budgets]);

  const dailyChart = useMemo<AgChartOptions | null>(() => {
    if (!summary) return null;
    const data = summary.daily.map((d) => ({ ...d, day: new Date(d.date + "T12:00:00Z").toLocaleDateString(undefined, { weekday: "short" }) }));
    return {
      title: { text: "Last 7 days: captured spend and blocked attempts" },
      data,
      series: [
        { type: "bar", xKey: "day", yKey: "paid", yName: "Captured ($)", fill: CHART_COLORS.shield, cornerRadius: 4 },
        { type: "line", xKey: "day", yKey: "blocked", yName: "Blocked attempts", stroke: CHART_COLORS.bad, marker: { fill: CHART_COLORS.bad } },
      ],
      axes: [
        { type: "category", position: "bottom" },
        { type: "number", position: "left", keys: ["paid"], label: { formatter: ({ value }: { value: number }) => usd(value) } },
        { type: "number", position: "right", keys: ["blocked"], min: 0 },
      ],
      legend: { position: "bottom" },
    };
  }, [summary]);

  const decisionsChart = useMemo<AgChartOptions | null>(() => {
    if (!summary) return null;
    const d = summary.decisions7d;
    return {
      title: { text: "Decisions (7 days)" },
      data: [
        { label: "Approved", value: d.approve },
        { label: "Asked you", value: d.askHuman },
        { label: "Blocked", value: d.block },
      ],
      series: [
        {
          type: "donut",
          angleKey: "value",
          legendItemKey: "label",
          innerRadiusRatio: 0.62,
          fills: [CHART_COLORS.ok, CHART_COLORS.warn, CHART_COLORS.bad],
          strokeWidth: 0,
          innerLabels: [{ text: String(d.approve + d.askHuman + d.block), fontSize: 22, fontWeight: "bold", color: "#e6ebf5" }, { text: "requests", color: "#8b98b8" }],
        },
      ],
      legend: { position: "bottom" },
    };
  }, [summary]);

  const categoryChart = useMemo<AgChartOptions | null>(() => {
    if (!summary?.spendByCategory7d.length) return null;
    return {
      title: { text: "Where the money went (7 days)" },
      data: summary.spendByCategory7d.map((c) => ({ ...c, category: c.category.replace("_", " ") })),
      series: [{ type: "donut", angleKey: "spent", legendItemKey: "category", innerRadiusRatio: 0.62, strokeWidth: 0 }],
      legend: { position: "bottom" },
    };
  }, [summary]);

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

      <section className="grid gap-4 lg:grid-cols-2">
        {budgetChart && (
          <div className="card min-w-0 p-3">
            <Chart options={budgetChart} height={Math.max(200, 90 + (budgets?.length ?? 1) * 50)} />
          </div>
        )}
        {dailyChart && (
          <div className="card min-w-0 p-3">
            <Chart options={dailyChart} />
          </div>
        )}
        {decisionsChart && (
          <div className="card min-w-0 p-3">
            <Chart options={decisionsChart} />
          </div>
        )}
        {categoryChart && (
          <div className="card min-w-0 p-3">
            <Chart options={categoryChart} />
          </div>
        )}
      </section>
      {summary && (
        <p className="text-xs text-muted">
          {money(summary.last7d.spent)} captured and {summary.last7d.blocked} attempts blocked in the last 7 days. Charts by AG Charts.
        </p>
      )}
    </div>
  );
}
