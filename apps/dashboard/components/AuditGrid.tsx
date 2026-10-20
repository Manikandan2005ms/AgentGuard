"use client";

import type { PaymentRequestDTO } from "@agentguard/shared";
import {
  AllCommunityModule,
  ModuleRegistry,
  type ColDef,
  type GetRowIdParams,
  type ICellRendererParams,
  type ValueFormatterParams,
} from "ag-grid-community";
import {
  CellSelectionModule,
  ColumnMenuModule,
  ColumnsToolPanelModule,
  ContextMenuModule,
  ExcelExportModule,
  FiltersToolPanelModule,
  IntegratedChartsModule,
  LicenseManager,
  MasterDetailModule,
  RowGroupingModule,
  RowGroupingPanelModule,
  SetFilterModule,
  SideBarModule,
  SparklinesModule,
  StatusBarModule,
} from "ag-grid-enterprise";
import { AgGridReact } from "ag-grid-react";
import { AgChartsEnterpriseModule } from "ag-charts-enterprise";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, money } from "@/lib/api";
import { gridTheme } from "@/lib/gridTheme";
import { useLiveEvents } from "@/lib/useLiveEvents";
import { DecisionPill, StatusPill } from "./Pills";

ModuleRegistry.registerModules([
  AllCommunityModule,
  RowGroupingModule,
  RowGroupingPanelModule,
  MasterDetailModule,
  SetFilterModule,
  ColumnsToolPanelModule,
  FiltersToolPanelModule,
  SideBarModule,
  StatusBarModule,
  ColumnMenuModule,
  ContextMenuModule,
  ExcelExportModule,
  CellSelectionModule,
  // AG Charts inside the grid: chart any selected range, and sparklines in cells (R4).
  IntegratedChartsModule.with(AgChartsEnterpriseModule),
  SparklinesModule.with(AgChartsEnterpriseModule),
]);
if (process.env.NEXT_PUBLIC_AG_GRID_LICENSE_KEY) LicenseManager.setLicenseKey(process.env.NEXT_PUBLIC_AG_GRID_LICENSE_KEY);

const theme = gridTheme;

type Row = PaymentRequestDTO;
type Cell<V = unknown> = ICellRendererParams<Row, V>;

const DecisionCell = (p: Cell<Row["decision"]>) => (p.data && p.value ? <DecisionPill decision={p.value} /> : <span>{String(p.value ?? "")}</span>);
const StatusCell = (p: Cell<Row["status"]>) => (p.data && p.value ? <StatusPill status={p.value} kind={p.data.kind} /> : <span>{String(p.value ?? "")}</span>);

function RiskCell(p: Cell<number>) {
  if (p.value == null) return null;
  const v = Math.round(p.value);
  const color = v >= 70 ? "#ef4444" : v >= 35 ? "#f59e0b" : "#22c55e";
  return (
    <div className="flex h-full items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded bg-line">
        <div style={{ width: `${v}%`, background: color }} className="h-full" />
      </div>
      <span style={{ color }} className="font-semibold">
        {v}
      </span>
    </div>
  );
}

const InjectionCell = (p: Cell<boolean>) => (p.data ? p.value ? <span className="font-semibold text-bad">⚠ yes</span> : <span className="text-muted">–</span> : null);

function ActionsCell(p: Cell) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!p.data) return null;
  const d = p.data;
  const act = async (a: "approve" | "reject" | "refund") => {
    if (a === "refund" && !window.confirm(`Refund ${money(d.amount, d.currency)} for "${d.item}" through PayPal?`)) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/payments/${d.id}/${a}`, { method: "POST" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  // Refund: captured agent purchases only (not toolkit actions or seeded history).
  const refundable = d.status === "PAID" && d.kind === "payment" && !!d.paypalCaptureId && !d.paypalCaptureId.startsWith("SEED-");
  if (refundable) {
    return (
      <div className="flex h-full items-center gap-1" title={error ?? undefined}>
        <button className="btn btn-ghost !px-2 !py-0.5 !text-xs" disabled={busy} onClick={() => act("refund")}>
          {busy ? "Refunding…" : "↩ Refund"}
        </button>
        {error && <span className="text-[11px] text-bad">failed</span>}
      </div>
    );
  }
  if (d.status !== "HELD") return null;
  return (
    <div className="flex h-full items-center gap-1">
      <button className="btn btn-ok !px-2 !py-0.5 !text-xs" disabled={busy} onClick={() => act("approve")}>
        Approve
      </button>
      <button className="btn btn-bad !px-2 !py-0.5 !text-xs" disabled={busy} onClick={() => act("reject")}>
        Reject
      </button>
    </div>
  );
}

/** Master-detail row: every rule, signal and piece of evidence behind the decision. */
function DetailRow({ data }: { data?: Row }) {
  if (!data) return null;
  const fired = data.rulesFired.filter((r) => r.outcome !== "pass");
  const passed = data.rulesFired.filter((r) => r.outcome === "pass");
  return (
    <div className="grid gap-4 whitespace-normal break-words bg-ink/60 p-4 text-xs leading-relaxed md:grid-cols-3">
      <div>
        <h4 className="mb-2 font-semibold uppercase tracking-wide text-muted">Policy rules</h4>
        {[...fired, ...passed].map((r) => (
          <div key={r.rule_id} className="mb-1 flex gap-2">
            <span className={r.outcome === "block" ? "text-bad" : r.outcome === "ask" ? "text-warn" : "text-ok"}>
              {r.outcome === "block" ? "⛔" : r.outcome === "ask" ? "📱" : "✓"}
            </span>
            <span>
              <span className="font-mono text-muted">{r.rule_id}</span> {r.detail}
            </span>
          </div>
        ))}
        {data.rulesFired.length === 0 && <p className="text-muted">No rules evaluated.</p>}
      </div>
      <div>
        <h4 className="mb-2 font-semibold uppercase tracking-wide text-muted">Risk signals · {data.riskScore}/100</h4>
        {data.signals.map((s) => (
          <div key={s.id} className="mb-1 flex gap-2">
            <span className="w-8 shrink-0 text-right font-semibold text-warn">+{s.points}</span>
            <span>
              {s.detail} <span className="text-muted">({s.source})</span>
            </span>
          </div>
        ))}
        {data.signals.length === 0 && <p className="text-muted">No risk signals.</p>}
        {data.intentReason && (
          <p className="mt-3">
            <span className="text-muted">Intent check:</span> {data.intentAligned === false ? "❌ " : data.intentAligned ? "✓ " : "? "}
            {data.intentReason}
          </p>
        )}
      </div>
      <div>
        <h4 className="mb-2 font-semibold uppercase tracking-wide text-muted">Evidence & PayPal</h4>
        {data.injectionEvidence.slice(0, 4).map((e, i) => (
          <div key={i} className="mb-2">
            <div className="font-mono text-[11px] text-bad">
              {e.hidden ? "hidden · " : ""}
              {e.technique}
            </div>
            <pre className="whitespace-pre-wrap rounded border border-bad/30 bg-bad/5 p-1.5 font-mono text-[11px] text-red-300">{e.snippet}</pre>
          </div>
        ))}
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 font-mono text-[11px]">
          <dt className="text-muted">order</dt>
          <dd>{data.paypalOrderId ?? "–"}</dd>
          <dt className="text-muted">auth</dt>
          <dd>{data.paypalAuthId ?? "–"}</dd>
          <dt className="text-muted">capture</dt>
          <dd>{data.paypalCaptureId ?? "–"}</dd>
          <dt className="text-muted">decided by</dt>
          <dd>{data.decidedBy}</dd>
        </dl>
        {data.kind === "paypal_tool" && (
          <div className="mt-3">
            <div className="font-semibold text-sky-300">PayPal Agent Toolkit · {data.toolName}</div>
            <pre className="mt-1 max-h-40 overflow-auto rounded border border-line bg-ink/70 p-1.5 font-mono text-[11px]">
              {JSON.stringify({ args: data.toolArgs, result: data.toolResult }, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}

const fmtMoney = (p: ValueFormatterParams<Row, number>) => (p.value == null ? "" : money(p.value, p.data?.currency ?? "USD"));
const fmtTime = (p: ValueFormatterParams<Row, Date>) =>
  p.value ? p.value.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "";

const GROUPS = [
  { label: "No grouping", cols: [] as string[] },
  { label: "Merchant", cols: ["merchant"] },
  { label: "Decision", cols: ["decision"] },
  { label: "Status", cols: ["status"] },
  { label: "Category", cols: ["category"] },
  { label: "Type", cols: ["kind"] },
];

export default function AuditGrid() {
  const grid = useRef<AgGridReact<Row>>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [quick, setQuick] = useState("");
  const [group, setGroup] = useState("No grouping");
  // Phones: no pinned column, side bar or group drop zone, so the data gets the width.
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    api<Row[]>("/api/audit?limit=2000").then(setRows).catch(() => setRows([]));
  }, []);

  useLiveEvents((e) => {
    if (e.type === "payment.created") setRows((r) => [e.payment, ...r]);
    if (e.type === "payment.updated") setRows((r) => r.map((x) => (x.id === e.payment.id ? e.payment : x)));
  });

  const columnDefs = useMemo<ColDef<Row>[]>(
    () => [
      // Master-detail toggle; hidden while grouped (the group column has its own chevrons).
      {
        colId: "expand",
        headerName: "",
        width: 48,
        cellRenderer: "agGroupCellRenderer",
        valueGetter: () => "",
        sortable: false,
        filter: false,
        resizable: false,
        suppressHeaderMenuButton: true,
        suppressColumnsToolPanel: true,
      },
      {
        colId: "time",
        headerName: "Time",
        valueGetter: (p) => (p.data ? new Date(p.data.createdAt) : null),
        valueFormatter: fmtTime,
        filter: "agDateColumnFilter",
        sort: "desc",
        width: 165,
        chartDataType: "time",
      },
      { colId: "task", field: "taskDescription", headerName: "Agent task", width: 220, filter: "agTextColumnFilter", enableRowGroup: true, chartDataType: "category" },
      {
        colId: "kind",
        headerName: "Type",
        width: 150,
        valueGetter: (p) => (p.data ? (p.data.kind === "paypal_tool" ? `toolkit: ${p.data.toolName}` : "payment") : null),
        filter: "agSetColumnFilter",
        enableRowGroup: true,
        chartDataType: "category",
      },
      {
        colId: "merchant",
        headerName: "Merchant",
        width: 130,
        valueGetter: (p) => (p.data ? (p.data.kind === "paypal_tool" ? "PayPal account" : (p.data.merchantName ?? p.data.merchantDomain)) : null),
        filter: "agSetColumnFilter",
        enableRowGroup: true,
        chartDataType: "category",
      },
      { field: "item", headerName: "Item", width: 220, filter: "agTextColumnFilter", chartDataType: "category" },
      { field: "quantity", headerName: "Qty", width: 70, filter: "agNumberColumnFilter", chartDataType: "series" },
      { colId: "category", field: "category", headerName: "Category", width: 120, filter: "agSetColumnFilter", enableRowGroup: true, chartDataType: "category" },
      { field: "amount", headerName: "Amount", width: 110, type: "rightAligned", valueFormatter: fmtMoney, filter: "agNumberColumnFilter", aggFunc: "sum", enableValue: true, chartDataType: "series" },
      { colId: "decision", field: "decision", headerName: "Decision", width: 120, cellRenderer: DecisionCell, filter: "agSetColumnFilter", enableRowGroup: true, chartDataType: "category" },
      { field: "riskScore", headerName: "Risk", width: 120, cellRenderer: RiskCell, filter: "agNumberColumnFilter", aggFunc: "avg", enableValue: true, chartDataType: "series" },
      {
        colId: "riskBreakdown",
        headerName: "Risk signals",
        headerTooltip: "Points from each risk signal (sparkline)",
        width: 120,
        valueGetter: (p) => p.data?.signals.map((s) => s.points) ?? null,
        cellRenderer: "agSparklineCellRenderer",
        cellRendererParams: { sparklineOptions: { type: "bar", direction: "vertical", fill: "#f59e0b", stroke: "#f59e0b" } },
        sortable: false,
        filter: false,
        enableCellChangeFlash: false,
      },
      { colId: "status", field: "status", headerName: "Status", width: 140, cellRenderer: StatusCell, filter: "agSetColumnFilter", enableRowGroup: true, chartDataType: "category" },
      { field: "injectionDetected", headerName: "Injection", width: 100, cellRenderer: InjectionCell, filter: "agSetColumnFilter", enableRowGroup: true },
      { field: "decidedBy", headerName: "Decided by", width: 110, filter: "agSetColumnFilter", enableRowGroup: true },
      { field: "explanation", headerName: "Explanation", flex: 1, minWidth: 320, tooltipField: "explanation", filter: "agTextColumnFilter" },
      { field: "paypalOrderId", headerName: "PayPal order", width: 170, filter: "agTextColumnFilter" },
      { field: "paypalAuthId", headerName: "Authorization", width: 170, hide: true },
      { field: "paypalCaptureId", headerName: "Capture", width: 170, filter: "agTextColumnFilter" },
      {
        field: "reconciledAt",
        headerName: "Reconciled",
        width: 110,
        valueFormatter: (p) => (p.data ? (p.value ? "✓ PayPal" : "–") : ""),
        filter: "agSetColumnFilter",
      },
      { colId: "actions", headerName: "", width: 160, pinned: narrow ? null : "right", cellRenderer: ActionsCell, sortable: false, filter: false, suppressHeaderMenuButton: true },
    ],
    [narrow],
  );

  // Integrated charts: only the columns marked "category" or "series" below can be charted.
  const defaultColDef = useMemo<ColDef<Row>>(() => ({ sortable: true, resizable: true, floatingFilter: true, chartDataType: "excluded" }), []);
  const getRowId = useCallback((p: GetRowIdParams<Row>) => p.data.id, []);

  const applyGroup = (label: string) => {
    setGroup(label);
    grid.current?.api.setRowGroupColumns(GROUPS.find((g) => g.label === label)?.cols ?? []);
  };

  // Also fires when the user drags a column into the group bar.
  const onRowGroupChanged = useCallback(() => {
    const gridApi = grid.current?.api;
    if (!gridApi) return;
    const cols = gridApi.getRowGroupColumns().map((c) => c.getColId());
    gridApi.setColumnsVisible(["expand"], cols.length === 0);
    setGroup(GROUPS.find((g) => g.cols.join() === cols.join())?.label ?? "custom");
  }, []);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={quick}
          onChange={(e) => setQuick(e.target.value)}
          placeholder="Search everything…"
          className="w-64 rounded-lg border border-line bg-panel px-3 py-1.5 text-sm outline-none focus:border-shield"
        />
        <div className="flex max-w-full overflow-x-auto rounded-lg border border-line">
          {GROUPS.map((g) => (
            <button
              key={g.label}
              onClick={() => applyGroup(g.label)}
              className={`shrink-0 whitespace-nowrap px-3 py-1.5 text-xs font-medium ${group === g.label ? "bg-shield text-ink" : "bg-panel text-muted hover:text-text"}`}
            >
              {g.label === "No grouping" ? "Flat" : `By ${g.label.toLowerCase()}`}
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <button
            className="btn btn-ghost"
            title="AG Grid integrated chart: amount agents asked to pay, per merchant (blocked attempts included)"
            onClick={() => grid.current?.api.createRangeChart({ cellRange: { columns: ["merchant", "amount"] }, chartType: "doughnut", aggFunc: "sum", chartThemeName: "ag-default-dark" })}
          >
            📊 Requested $ by merchant
          </button>
          <button
            className="btn btn-ghost"
            title="AG Grid integrated chart of average risk per decision"
            onClick={() => grid.current?.api.createRangeChart({ cellRange: { columns: ["decision", "riskScore"] }, chartType: "groupedColumn", aggFunc: "avg", chartThemeName: "ag-default-dark" })}
          >
            📊 Risk by decision
          </button>
          <button className="btn btn-ghost" onClick={() => grid.current?.api.exportDataAsCsv({ fileName: "agentguard-audit.csv" })}>
            Export CSV
          </button>
          <button className="btn btn-ghost" onClick={() => grid.current?.api.exportDataAsExcel({ fileName: "agentguard-audit.xlsx" })}>
            Export Excel
          </button>
        </div>
      </div>
      <div className="card overflow-hidden" style={{ height: "calc(100vh - 230px)", minHeight: 480 }}>
        <AgGridReact<Row>
          ref={grid}
          theme={theme}
          rowData={rows}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          getRowId={getRowId}
          onColumnRowGroupChanged={onRowGroupChanged}
          quickFilterText={quick}
          masterDetail
          detailCellRenderer={DetailRow}
          detailRowAutoHeight
          rowGroupPanelShow={narrow ? "never" : "always"}
          isGroupOpenByDefault={(p) => p.rowNode.level === 0}
          autoGroupColumnDef={{ headerName: "Group", minWidth: 220 }}
          sideBar={narrow ? false : { toolPanels: ["columns", "filters"] }}
          statusBar={{ statusPanels: [{ statusPanel: "agTotalAndFilteredRowCountComponent" }, { statusPanel: "agAggregationComponent" }] }}
          pagination
          paginationPageSize={50}
          paginationPageSizeSelector={[25, 50, 100, 500]}
          tooltipShowDelay={300}
          animateRows
          cellSelection
          enableCharts
          chartThemes={["ag-default-dark"]}
        />
      </div>
    </div>
  );
}
