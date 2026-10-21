"use client";

import type { BudgetUsageDTO } from "@agentguard/shared";
import type { AgChartOptions } from "ag-charts-community";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CHART_COLORS } from "@/components/Charts";
import { PageHeader } from "@/components/PageHeader";
import { api, money } from "@/lib/api";
import { PALETTE } from "@/lib/palette";
import { useLiveEvents } from "@/lib/useLiveEvents";

// Charts render in the browser only.
const Chart = dynamic(() => import("@/components/Charts").then((m) => m.Chart), {
  ssr: false,
  loading: () => <div className="h-[260px] animate-pulse rounded-[5px] bg-paper" />,
});

interface Summary {
  daily: { date: string; paid: number; blocked: number }[];
  last7d: { spent: number; blocked: number };
  decisions7d: { approve: number; askHuman: number; block: number };
  spendByCategory7d: { category: string; spent: number }[];
}

const name = (b: BudgetUsageDTO) => (b.category === "*" ? "All categories" : b.category.replace("_", " "));
const label = (b: BudgetUsageDTO) => `${name(b)} / ${b.period}`;
const usd = (v: number) => `$${Math.round(v)}`;

function BudgetRow({ b }: { b: BudgetUsageDTO }) {
  const pctSpent = Math.min(100, (b.spent / b.limit) * 100);
  const pctHeld = Math.min(100 - pctSpent, (b.held / b.limit) * 100);
  const remaining = Math.max(0, b.limit - b.spent - b.held);
  const used = pctSpent + pctHeld;
  const tone = used >= 90 ? "text-bad" : used >= 70 ? "text-warn" : "text-ink-2";
  return (
    <div className="grid gap-x-8 gap-y-3 px-5 py-4 md:grid-cols-[minmax(160px,220px)_minmax(0,1fr)_200px] md:items-center">
      <div>
        <h3 className="text-[15px] font-semibold capitalize">{name(b)}</h3>
        <p className="text-[12.5px] text-ink-3">per {b.period}, rolling</p>
      </div>
      <div>
        <div className="flex h-2.5 overflow-hidden rounded-full bg-[#e7e1d3]">
          <div className="bg-ok" style={{ width: `${pctSpent}%` }} title={`Spent ${money(b.spent)}`} />
          <div
            className="bg-[#d0912f]"
            style={{ width: `${pctHeld}%`, backgroundImage: "repeating-linear-gradient(45deg,transparent 0 3px,rgba(255,255,255,.35) 3px 6px)" }}
            title={`Held ${money(b.held)}`}
          />
        </div>
        <p className="mt-1.5 text-[12.5px] text-ink-2">
          <span className="figure">{money(b.spent)}</span> spent
          {b.held > 0 && (
            <>
              {" "}
              · <span className="figure text-warn">{money(b.held)}</span> held, waiting on you
            </>
          )}
        </p>
      </div>
      <div className="md:text-right">
        <div className={`figure font-mono text-[16px] font-medium ${tone}`}>{money(remaining)}</div>
        <div className="figure text-[12.5px] text-ink-3">left of {money(b.limit)}</div>
      </div>
    </div>
  );
}

function ChartCard({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <div className="sheet min-w-0 p-5">
      <h3 className="font-serif text-[18px] leading-tight font-medium">{title}</h3>
      {note && <p className="mt-0.5 text-[13px] text-ink-3">{note}</p>}
      <div className="mt-3">{children}</div>
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
      data,
      series: [
        { type: "bar", direction: "horizontal", xKey: "label", yKey: "spent", yName: "Spent", stacked: true, fill: CHART_COLORS.ok },
        { type: "bar", direction: "horizontal", xKey: "label", yKey: "held", yName: "Held for approval", stacked: true, fill: CHART_COLORS.warn },
        { type: "bar", direction: "horizontal", xKey: "label", yKey: "remaining", yName: "Remaining", stacked: true, fill: CHART_COLORS.empty },
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
      data,
      series: [
        { type: "bar", xKey: "day", yKey: "paid", yName: "Captured ($)", fill: CHART_COLORS.accent, cornerRadius: 2 },
        {
          type: "line",
          xKey: "day",
          yKey: "blocked",
          yName: "Blocked attempts",
          stroke: CHART_COLORS.bad,
          strokeWidth: 2,
          marker: { fill: CHART_COLORS.bad, stroke: PALETTE.sheet, strokeWidth: 2, size: 9 },
        },
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
          innerRadiusRatio: 0.66,
          fills: [CHART_COLORS.ok, CHART_COLORS.warn, CHART_COLORS.bad],
          strokes: [PALETTE.sheet],
          strokeWidth: 2,
          innerLabels: [
            { text: String(d.approve + d.askHuman + d.block), fontSize: 26, fontWeight: 500, color: PALETTE.ink },
            { text: "requests", fontSize: 12, color: PALETTE.ink3 },
          ],
        },
      ],
      legend: { position: "bottom" },
    };
  }, [summary]);

  const categoryChart = useMemo<AgChartOptions | null>(() => {
    if (!summary?.spendByCategory7d.length) return null;
    return {
      data: summary.spendByCategory7d.map((c) => ({ ...c, category: c.category.replace("_", " ") })),
      series: [{ type: "donut", angleKey: "spent", legendItemKey: "category", innerRadiusRatio: 0.66, strokes: [PALETTE.sheet], strokeWidth: 2 }],
      legend: { position: "bottom" },
    };
  }, [summary]);

  return (
    <div>
      <PageHeader title="Budgets">
        How much of each budget in your policy is gone. Money PayPal is holding for your approval counts against a budget until it&apos;s captured or released.
      </PageHeader>

      {budgets && budgets.length === 0 && (
        <div className="sheet mb-8 p-5 text-[14.5px]">
          Your policy has no budgets yet. Add one on the{" "}
          <Link href="/policies" className="link">
            Policies
          </Link>{" "}
          page, for example <span className="font-serif italic">“Max $150 a week on groceries.”</span>
        </div>
      )}
      {budgets && budgets.length > 0 && (
        <section className="sheet mb-10 divide-y divide-rule" aria-label="Budgets">
          {budgets.map((b) => (
            <BudgetRow key={`${b.category}-${b.period}`} b={b} />
          ))}
        </section>
      )}

      <h2 className="section-title mb-4">The last seven days</h2>
      <section className="grid gap-5 lg:grid-cols-2">
        {dailyChart && (
          <ChartCard title="Captured spend and blocked attempts" note="Bars are dollars captured; the line counts blocked attempts.">
            <Chart options={dailyChart} />
          </ChartCard>
        )}
        {decisionsChart && (
          <ChartCard title="How requests were decided">
            <Chart options={decisionsChart} />
          </ChartCard>
        )}
        {categoryChart && (
          <ChartCard title="Where the money went">
            <Chart options={categoryChart} />
          </ChartCard>
        )}
        {budgetChart && (
          <ChartCard title="Spent against each limit">
            <Chart options={budgetChart} height={Math.max(200, 90 + (budgets?.length ?? 1) * 50)} />
          </ChartCard>
        )}
      </section>
      {summary && (
        <p className="mt-6 text-[13px] text-ink-3">
          <span className="figure">{money(summary.last7d.spent)}</span> captured and <span className="figure">{summary.last7d.blocked}</span> attempts blocked in the
          last 7 days. Charts by AG Charts.
        </p>
      )}
    </div>
  );
}
