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
    <span className="font-semibold text-warn">▲ stricter</span>
  ) : p.value === "looser" ? (
    <span className="font-semibold text-sky-300">▼ looser</span>
  ) : (
    <span className="text-muted">same</span>
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
      { field: "createdAt", headerName: "When", width: 120, valueFormatter: (p) => new Date(p.value).toLocaleDateString(undefined, { month: "short", day: "numeric" }) },
      { field: "item", headerName: "Purchase", flex: 1, minWidth: 160 },
      { field: "amount", headerName: "Amount", width: 95, type: "rightAligned", valueFormatter: (p) => money(p.value) },
      { field: "actual", headerName: "Actual", width: 115, cellRenderer: Pill },
      { field: "simulated", headerName: "New policy", width: 120, cellRenderer: Pill },
      { field: "change", headerName: "", width: 100, cellRenderer: Change },
      { colId: "why", headerName: "Why", flex: 1.2, minWidth: 200, valueGetter: (p) => p.data?.reasons.join(" "), tooltipValueGetter: (p) => p.data?.reasons.join(" ") },
    ],
    [],
  );

  const rows = sim ? (onlyChanges ? sim.results.filter((r) => r.change !== "same") : sim.results) : [];

  return (
    <div className="mt-4 rounded-lg border border-line bg-ink/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">Policy simulator</span>
        <span className="text-xs text-muted">Replay the last 30 days of agent purchases against these rules before you turn them on.</span>
        <button className="btn btn-ghost ml-auto !py-1 !text-xs" disabled={busy} onClick={run}>
          {busy ? "Replaying…" : sim ? "↻ Re-run" : "▶ Simulate"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-bad">{error}</p>}
      {sim && (
        <>
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <span className="rounded-md border border-line px-2 py-1">{sim.summary.total} purchases replayed</span>
            <span className="rounded-md border border-warn/40 px-2 py-1 text-warn">{sim.summary.stricter} would be stricter</span>
            <span className="rounded-md border border-sky-400/40 px-2 py-1 text-sky-300">{sim.summary.looser} would be looser</span>
            <span className="rounded-md border border-line px-2 py-1 text-muted">
              New policy: {sim.summary.simulated.APPROVE} approve · {sim.summary.simulated.ASK_HUMAN} ask · {sim.summary.simulated.BLOCK} block
            </span>
            <label className="ml-auto flex items-center gap-1 text-muted">
              <input type="checkbox" checked={onlyChanges} onChange={(e) => setOnlyChanges(e.target.checked)} /> only changes
            </label>
          </div>
          {rows.length === 0 ? (
            <p className="mt-3 text-sm text-muted">{onlyChanges ? "No decisions would change." : "No purchases in the last 30 days."}</p>
          ) : (
            <div className="mt-3 overflow-hidden rounded-lg border border-line" style={{ height: Math.min(360, 56 + rows.length * 42) }}>
              <AgGridReact<Result>
                theme={gridTheme}
                rowData={rows}
                columnDefs={columns}
                defaultColDef={{ sortable: true, resizable: true }}
                getRowId={(p) => p.data.id}
                rowClassRules={{ "bg-warn/5": (p) => p.data?.change === "stricter", "bg-sky-400/5": (p) => p.data?.change === "looser" }}
                tooltipShowDelay={300}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
