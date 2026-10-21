"use client";

import type { DecisionType } from "@agentguard/shared";
import { AllCommunityModule, ModuleRegistry, type ColDef, type ICellRendererParams } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useMemo, useState } from "react";
import { api, money } from "@/lib/api";
import { gridTheme } from "@/lib/gridTheme";
import { DecisionPill } from "./Pills";

ModuleRegistry.registerModules([AllCommunityModule]);

interface Result {
  id: string;
  createdAt: string;
  item: string;
  merchantDomain: string;
  amount: number;
  actual: DecisionType;
  simulated: DecisionType;
  change: "same" | "stricter" | "looser";
  reasons: string[];
}

interface Simulation {
  windowDays: number;
  results: Result[];
  summary: {
    total: number;
    changed: number;
    stricter: number;
    looser: number;
    actual: Record<DecisionType, number>;
    simulated: Record<DecisionType, number>;
  };
}

const Pill = (p: ICellRendererParams<Result, DecisionType>) => (p.value ? <DecisionPill decision={p.value} /> : null);
const Change = (p: ICellRendererParams<Result, Result["change"]>) =>
  p.value === "stricter" ? (
    <span className="font-semibold text-warn">Stricter</span>
  ) : p.value === "looser" ? (
    <span className="font-semibold text-accent">Looser</span>
  ) : (
    <span className="text-ink-3">Same</span>
  );

/** "What would this policy have done?" Replays the last 30 days of agent purchases (R5). */
export default function PolicySimulator({ policyId }: { policyId: string }) {
  const [sim, setSim] = useState<Simulation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [onlyChanges, setOnlyChanges] = useState(true);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setSim(await api<Simulation>(`/api/policies/${policyId}/simulate`, { method: "POST" }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const columns = useMemo<ColDef<Result>[]>(
    () => [
      { field: "createdAt", headerName: "When", width: 100, valueFormatter: (p) => new Date(p.value).toLocaleDateString(undefined, { month: "short", day: "numeric" }) },
      { field: "item", headerName: "Purchase", flex: 1, minWidth: 160 },
      { field: "amount", headerName: "Amount", width: 95, type: "rightAligned", valueFormatter: (p) => money(p.value) },
      { field: "actual", headerName: "Was", width: 120, cellRenderer: Pill },
      { field: "simulated", headerName: "Would be", width: 120, cellRenderer: Pill },
      { field: "change", headerName: "", width: 90, cellRenderer: Change },
      { colId: "why", headerName: "Why", flex: 1.2, minWidth: 200, valueGetter: (p) => p.data?.reasons.join(" "), tooltipValueGetter: (p) => p.data?.reasons.join(" ") },
    ],
    [],
  );

  const rows = sim ? (onlyChanges ? sim.results.filter((r) => r.change !== "same") : sim.results) : [];

  return (
    <div className="mt-5 rounded-[5px] border border-rule bg-paper/50 p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-[14.5px] font-semibold">Try it on your history first</h3>
          <p className="text-[13px] text-ink-2">Replays the last 30 days of agent purchases against these rules, before you turn them on.</p>
        </div>
        <button className="btn btn-sm btn-quiet" disabled={busy} onClick={run}>
          {busy ? "Replaying…" : sim ? "Run again" : "Replay last 30 days"}
        </button>
      </div>
      {error && <p className="mt-2 text-[13px] text-bad">{error}</p>}
      {sim && (
        <>
          <p className="mt-3 text-[13.5px] text-ink-2">
            Of <b className="figure text-ink">{sim.summary.total}</b> purchases, <b className="figure text-warn">{sim.summary.stricter}</b> would be handled more
            strictly and <b className="figure text-accent">{sim.summary.looser}</b> more loosely. Under these rules:{" "}
            <span className="figure">
              {sim.summary.simulated.APPROVE} approved, {sim.summary.simulated.ASK_HUMAN} asked, {sim.summary.simulated.BLOCK} blocked.
            </span>
          </p>
          <label className="mt-2 inline-flex items-center gap-2 text-[13px] text-ink-2">
            <input type="checkbox" className="accent-[#24408f]" checked={onlyChanges} onChange={(e) => setOnlyChanges(e.target.checked)} /> Show only what
            changes
          </label>
          {rows.length === 0 ? (
            <p className="mt-3 text-[14px] text-ink-2">{onlyChanges ? "No decisions would change." : "No purchases in the last 30 days."}</p>
          ) : (
            <div className="mt-3" style={{ height: Math.min(360, 56 + rows.length * 42) }}>
              <AgGridReact<Result>
                theme={gridTheme}
                rowData={rows}
                columnDefs={columns}
                defaultColDef={{ sortable: true, resizable: true }}
                getRowId={(p) => p.data.id}
                rowClassRules={{ "sim-stricter": (p) => p.data?.change === "stricter", "sim-looser": (p) => p.data?.change === "looser" }}
                tooltipShowDelay={300}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
