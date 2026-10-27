import type { AgReportState, AgStudioApi } from "ag-studio";
import { api as apiFetch } from "@/lib/api";
import { SENTINEL_INTRO_ID, SENTINEL_PAGE } from "./report";
import type { AnomalyAlertDef, InsightsRegistry, Severity } from "./widgets";

/** GET /api/insights/anomalies: found by plain code on the server (apps/api/src/core/anomalies.ts). */
export interface Anomaly {
  id: string;
  kind: string;
  severity: Severity;
  title: string;
  detail: string;
  value: number;
  baseline: number;
  unit: "count" | "usd" | "score" | "percent";
  windowHours: number;
  merchants: string[];
  sampleIds: string[];
  trendField: string | null;
}

type Scan = { scannedAt: string; windowHours: number; anomalies: Anomaly[] };
export const scanAnomalies = (hours = 24) => apiFetch<Scan>(`/api/insights/anomalies?hours=${hours}`);

/** The last 24 hours, or the last 7 days when the last day was quiet (a demo that hasn't run today still has a story). */
export async function scanRecent(): Promise<Scan> {
  const day = await scanAnomalies(24);
  return day.anomalies.length > 0 ? day : scanAnomalies(168);
}

type State = AgReportState<InsightsRegistry>;
const ALERT_W = 12;
const ALERT_H = 14;

const alertId = (anomaly: Anomaly) => `alert-${anomaly.id.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

/** Alerts already on the Sentinel page, by anomaly id. */
export function flaggedAnomalyIds(state: State): Set<string> {
  const page = state.pages.find((p) => p.id === SENTINEL_PAGE);
  const ids = new Set<string>();
  for (const w of Object.values(page?.widgets ?? {})) {
    const id = w?.type === "anomaly-alert" ? (w as AnomalyAlertDef).format?.style?.anomalyId : undefined;
    if (id) ids.add(id);
  }
  return ids;
}

/**
 * Puts an alert card for `anomaly` on the Sentinel page (or refreshes the one already there), with
 * a per-day trend of the metric behind it, and shows that page. Returns the widget id.
 */
export function placeAlert(api: AgStudioApi<InsightsRegistry>, anomaly: Anomaly, words: { headline: string; explanation: string }, phone: boolean): string {
  const state = api.getState();
  const page = state.pages.find((p) => p.id === SENTINEL_PAGE);
  if (!page) throw new Error("The Sentinel alerts page is missing; reset the layout.");
  const id = alertId(anomaly);
  const widgets = { ...(page.widgets ?? {}) };
  const layout = { ...(page.widgetLayout ?? {}) };

  const widget: AnomalyAlertDef = {
    type: "anomaly-alert",
    dataMapping: anomaly.trendField
      ? { trendX: [{ id: "payments.day" }], trendValue: [{ id: `payments.${anomaly.trendField}`, aggregation: anomaly.trendField === "riskScore" ? "avg" : "sum" }] }
      : {},
    format: {
      title: { enabled: true, text: words.headline },
      style: {
        severity: anomaly.severity,
        detail: words.explanation,
        value: anomaly.value,
        baseline: anomaly.baseline,
        unit: anomaly.unit,
        merchants: anomaly.merchants.join(", "),
        detectedAt: new Date().toISOString(),
        anomalyId: anomaly.id,
      },
    },
  };
  widgets[id] = { ...widget, ...(anomaly.trendField ? { sort: [{ field: { id: "payments.day" }, direction: "asc" as const }] } : {}) };

  if (!layout[id]) {
    // Next free slot: two alerts per row below the intro (one per row on phones).
    const top = layout[SENTINEL_INTRO_ID] ? layout[SENTINEL_INTRO_ID].yTrack + layout[SENTINEL_INTRO_ID].ySpan : 0;
    const n = Object.keys(widgets).filter((w) => w !== id && widgets[w]!.type === "anomaly-alert").length;
    layout[id] = phone
      ? { xTrack: 0, yTrack: top + n * ALERT_H, xSpan: 24, ySpan: ALERT_H }
      : { xTrack: (n % 2) * ALERT_W, yTrack: top + Math.floor(n / 2) * ALERT_H, xSpan: ALERT_W, ySpan: ALERT_H };
  }

  api.setState({
    ...state,
    selectedPageId: SENTINEL_PAGE,
    pages: state.pages.map((p) => (p.id === SENTINEL_PAGE ? { ...p, widgets, widgetLayout: layout } : p)),
  });
  return id;
}

/** The Sentinel's own tools. `scan` remembers the last findings so `flag` can only flag something real. */
export function sentinelTools(api: AgStudioApi<InsightsRegistry>, phone: () => boolean) {
  let found: Anomaly[] = [];

  const scan = api.defineAiTool({
    name: "scan_transactions",
    description:
      "Scan AgentGuard's transaction stream for anomalies: refund spikes, failed payments, bursts of blocked injection attacks, " +
      "policy-block spikes, a climbing risk score and budgets nearly used up. Plain code decides what counts as an anomaly; it " +
      "compares the window with the 7 days before it. Returns each finding with its id, and which ones already have an alert.",
    params: (s) =>
      s.object({
        hours: s.number({ description: "How many recent hours to scan, 1-168. Omit it to scan the last 24 hours, or the last 7 days if the last day was quiet." }).optional(),
      }),
    execute: async (args, ctx) => {
      let result: Scan;
      try {
        result = args.hours ? await scanAnomalies(Math.max(1, Math.min(168, Math.round(args.hours)))) : await scanRecent();
      } catch (err) {
        return ctx.error(`The AgentGuard API did not answer: ${err instanceof Error ? err.message : String(err)}`);
      }
      found = result.anomalies;
      const hours = result.windowHours;
      const flagged = flaggedAnomalyIds(api.getState());
      if (found.length === 0) return ctx.success(`No anomalies in the last ${hours} hours. Traffic looks normal.`, result);
      const lines = found.map(
        (a) =>
          `- id: ${a.id} | ${a.severity} | ${a.title} | ${a.detail} | now ${a.value} vs normal ${a.baseline} (${a.unit})` +
          `${a.merchants.length ? ` | where: ${a.merchants.join(", ")}` : ""}${flagged.has(a.id) ? " | ALREADY FLAGGED (flagging again refreshes it)" : ""}`,
      );
      return ctx.success(`${found.length} anomalies in the last ${hours} hours:\n${lines.join("\n")}`, result);
    },
  });

  const flag = api.defineAiTool({
    name: "flag_anomaly",
    description:
      "Put an alert widget for one finding from scan_transactions on the 'Sentinel alerts' page, with a per-day trend chart of the " +
      "metric behind it. Call it once per finding worth the owner's attention, in parallel. Flagging an already-flagged finding refreshes it.",
    params: (s) =>
      s.object({
        anomalyId: s.string({ description: "The id of a finding from the latest scan_transactions result." }),
        headline: s.string({ description: "Alert title, at most 60 characters, plain words, no emoji. E.g. 'Refunds spiked to 4 today'." }),
        explanation: s.string({
          description: "One or two short sentences for a non-technical owner: what happened, compared with normal, and the one thing to do next.",
        }),
      }),
    execute: (args, ctx) => {
      const anomaly = found.find((a) => a.id === args.anomalyId);
      if (!anomaly) {
        return ctx.error(`No finding with id "${args.anomalyId}" in the latest scan. Call scan_transactions first and use one of its ids.`);
      }
      const widgetId = placeAlert(api, anomaly, { headline: args.headline.slice(0, 80), explanation: args.explanation.slice(0, 400) }, phone());
      return ctx.success(`Placed alert widget "${widgetId}" (${anomaly.severity}) on the Sentinel alerts page.`, { widgetId, anomalyId: anomaly.id });
    },
  });

  return { scan, flag };
}
