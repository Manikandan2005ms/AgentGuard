"use client";

// Must run before ag-grid-enterprise loads (see the file for why).
import "@/lib/agGridLicense";
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
import { gridTheme, monoFamily } from "@/lib/gridTheme";
import { PALETTE, riskColor } from "@/lib/palette";
import { useLiveEvents } from "@/lib/useLiveEvents";
import { chartTheme } from "./Charts";
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
  const color = riskColor(v);
  return (
    <div className="flex h-full items-center gap-2.5">
      <span style={{ color }} className="figure w-6 text-right font-semibold">
        {v}
      </span>
      <div className="h-[3px] w-14 overflow-hidden rounded-full bg-rule">
        <div style={{ width: `${v}%`, background: color }} className="h-full" />
      </div>
    </div>
  );
}

const InjectionCell = (p: Cell<boolean>) => (p.data ? p.value ? <span className="font-semibold text-bad">Yes</span> : <span className="text-ink-3">–</span> : null);

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
      <div className="flex h-full items-center gap-1.5" title={error ?? undefined}>
        <button className="btn btn-sm btn-quiet" disabled={busy} onClick={() => act("refund")}>
          {busy ? "Refunding…" : "Refund"}
        </button>
        {error && <span className="text-[11px] text-bad">failed</span>}
      </div>
    );
  }
  if (d.status !== "HELD") return null;
  return (
    <div className="flex h-full items-center gap-1.5">
      <button className="btn btn-sm btn-approve" disabled={busy} onClick={() => act("approve")}>
        Approve
      </button>
      <button className="btn btn-sm btn-reject" disabled={busy} onClick={() => act("reject")}>
        Reject
      </button>
    </div>
  );
}

const OUTCOME = {
  block: { word: "block", cls: "text-bad" },
  ask: { word: "ask", cls: "text-warn" },
  pass: { word: "pass", cls: "text-ok" },
} as const;

/** Master-detail row: every rule, signal and piece of evidence behind the decision. */
function DetailRow({ data }: { data?: Row }) {
  if (!data) return null;
  const fired = data.rulesFired.filter((r) => r.outcome !== "pass");
  const passed = data.rulesFired.filter((r) => r.outcome === "pass");
  return (
    <div className="grid gap-6 bg-paper px-5 py-4 text-[12.5px] leading-relaxed break-words whitespace-normal md:grid-cols-3">
      <div>
        <h4 className="mb-2 text-[12.5px] font-semibold text-ink-2">Policy rules</h4>
        {[...fired, ...passed].map((r) => (
          <div key={r.rule_id} className="mb-1 flex gap-2">
            <span className={`w-9 shrink-0 font-mono text-[11px] leading-[1.9] uppercase ${OUTCOME[r.outcome].cls}`}>{OUTCOME[r.outcome].word}</span>
            <span>
              <span className="font-mono text-[11.5px] text-ink-3">{r.rule_id}</span> {r.detail}
            </span>
          </div>
        ))}
        {data.rulesFired.length === 0 && <p className="text-ink-3">No rules evaluated.</p>}
      </div>
      <div>
        <h4 className="mb-2 text-[12.5px] font-semibold text-ink-2">
          Risk signals, <span className="figure">{data.riskScore}</span> of 100
        </h4>
        {data.signals.map((s) => (
          <div key={s.id} className="mb-1 flex gap-2">
            <span className="figure w-9 shrink-0 text-right font-mono text-[11.5px] leading-[1.9] font-semibold text-warn">+{s.points}</span>
            <span>
              {s.detail} <span className="text-ink-3">({s.source})</span>
            </span>
          </div>
        ))}
        {data.signals.length === 0 && <p className="text-ink-3">No risk signals.</p>}
        {data.intentReason && (
          <p className="mt-3">
            <span className="font-semibold">Does it match the task? </span>
            <span className={data.intentAligned === false ? "text-bad" : data.intentAligned ? "text-ok" : "text-ink-3"}>
              {data.intentAligned === false ? "No. " : data.intentAligned ? "Yes. " : "Unsure. "}
            </span>
            {data.intentReason}
          </p>
        )}
      </div>
      <div>
        <h4 className="mb-2 text-[12.5px] font-semibold text-ink-2">Evidence and PayPal</h4>
        {data.injectionEvidence.slice(0, 4).map((e, i) => (
          <div key={i} className="mb-2">
            <div className="font-mono text-[11px] text-bad">
              {e.hidden ? "hidden · " : ""}
              {e.technique}
            </div>
            <pre className="mt-0.5 rounded-[3px] bg-bad-wash p-1.5 font-mono text-[11px] whitespace-pre-wrap text-[#7a2618]">{e.snippet}</pre>
          </div>
        ))}
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-[11.5px]">
          <dt className="text-ink-3">order</dt>
          <dd>{data.paypalOrderId ?? "–"}</dd>
          <dt className="text-ink-3">auth</dt>
          <dd>{data.paypalAuthId ?? "–"}</dd>
          <dt className="text-ink-3">capture</dt>
          <dd>{data.paypalCaptureId ?? "–"}</dd>
          <dt className="text-ink-3">decided by</dt>
          <dd>{data.decidedBy}</dd>
        </dl>
        {data.kind === "paypal_tool" && (
          <div className="mt-3">
            <div className="font-semibold text-accent">PayPal Agent Toolkit · {data.toolName}</div>
            <pre className="mt-1 max-h-40 overflow-auto rounded-[3px] border border-rule bg-sheet p-1.5 font-mono text-[11px]">
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

const ID_STYLE = { fontFamily: monoFamily, fontSize: "12px", color: PALETTE.ink2 };

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
        cellRendererParams: { sparklineOptions: { type: "bar", direction: "vertical", fill: PALETTE.warnFill, stroke: PALETTE.warnFill } },
        sortable: false,
        filter: false,
        enableCellChangeFlash: false,
      },
      { colId: "status", field: "status", headerName: "Status", width: 140, cellRenderer: StatusCell, filter: "agSetColumnFilter", enableRowGroup: true, chartDataType: "category" },
      { field: "injectionDetected", headerName: "Injection", width: 100, cellRenderer: InjectionCell, filter: "agSetColumnFilter", enableRowGroup: true },
      { field: "decidedBy", headerName: "Decided by", width: 110, filter: "agSetColumnFilter", enableRowGroup: true },
      { field: "explanation", headerName: "Explanation", flex: 1, minWidth: 320, tooltipField: "explanation", filter: "agTextColumnFilter" },
      { field: "paypalOrderId", headerName: "PayPal order", width: 170, filter: "agTextColumnFilter", cellStyle: ID_STYLE },
      { field: "paypalAuthId", headerName: "Authorization", width: 170, hide: true, cellStyle: ID_STYLE },
      { field: "paypalCaptureId", headerName: "Capture", width: 170, filter: "agTextColumnFilter", cellStyle: ID_STYLE },
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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <input
          type="search"
          value={quick}
          onChange={(e) => setQuick(e.target.value)}
          placeholder="Search every column"
          aria-label="Search the audit log"
          className="field !w-64"
        />
        <div className="flex max-w-full items-center gap-2">
          <span className="text-[13px] text-ink-3">Group</span>
          <div className="flex overflow-x-auto rounded-[5px] border border-rule-2 bg-sheet" role="group" aria-label="Group rows">
            {GROUPS.map((g) => (
              <button
                key={g.label}
                onClick={() => applyGroup(g.label)}
                aria-pressed={group === g.label}
                className={`shrink-0 border-r border-rule px-3 py-1.5 text-[13px] whitespace-nowrap last:border-r-0 ${
                  group === g.label ? "bg-ink text-sheet" : "text-ink-2 hover:bg-paper hover:text-ink"
                }`}
              >
                {g.label === "No grouping" ? "None" : g.label}
              </button>
            ))}
          </div>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <button
            className="btn btn-sm btn-quiet"
            title="AG Grid integrated chart: amount agents asked to pay, per merchant (blocked attempts included)"
            onClick={() => grid.current?.api.createRangeChart({ cellRange: { columns: ["merchant", "amount"] }, chartType: "doughnut", aggFunc: "sum", chartThemeName: "agentguard" })}
          >
            Chart $ by merchant
          </button>
          <button
            className="btn btn-sm btn-quiet"
            title="AG Grid integrated chart of average risk per decision"
            onClick={() => grid.current?.api.createRangeChart({ cellRange: { columns: ["decision", "riskScore"] }, chartType: "groupedColumn", aggFunc: "avg", chartThemeName: "agentguard" })}
          >
            Chart risk by decision
          </button>
          <button className="btn btn-sm btn-quiet" onClick={() => grid.current?.api.exportDataAsCsv({ fileName: "agentguard-audit.csv" })}>
            Export CSV
          </button>
          <button className="btn btn-sm btn-quiet" onClick={() => grid.current?.api.exportDataAsExcel({ fileName: "agentguard-audit.xlsx" })}>
            Export Excel
          </button>
        </div>
      </div>
      <div style={{ height: "calc(100vh - 330px)", minHeight: 520 }}>
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
          customChartThemes={{ agentguard: chartTheme }}
          chartThemes={["agentguard"]}
        />
      </div>
    </div>
  );
}
