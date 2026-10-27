import type { AgReportState } from "ag-studio";
import type { InsightsRegistry } from "./widgets";

/**
 * The report the Insights page opens on: an overview of every decision, a threats page built
 * around the blocked-attacks feed, and a page the Sentinel agent fills with anomaly alerts.
 * Studio lays widgets out on a 24-column grid whose rows are 16px tall.
 */

type State = AgReportState<InsightsRegistry>;
type Page = State["pages"][number];

export const PAGES = [
  { id: "overview", title: "Overview" },
  { id: "threats", title: "Threats" },
  { id: "sentinel", title: "Sentinel alerts" },
] as const;
export type PageId = (typeof PAGES)[number]["id"];
export const SENTINEL_PAGE: PageId = "sentinel";

const title = (text: string, subtitle?: string) => ({
  title: { enabled: true, text },
  ...(subtitle ? { subtitle: { enabled: true, text: subtitle } } : {}),
});
const sum = (id: string) => ({ id, aggregation: "sum" as const });
const kpi = (text: string, field: string) => ({
  type: "value" as const,
  dataMapping: { value: [sum(field)], sparklineX: [{ id: "payments.day" }] },
  format: { ...title(text), style: { sparkline: { type: "bar" as const } } },
});

const overview: Page = {
  id: "overview",
  widgets: {
    "decision-filter": { type: "button-filter", dataMapping: { value: [{ id: "payments.decision" }] }, format: title("Decision") },
    "day-filter": { type: "date-filter", dataMapping: { value: [{ id: "payments.day" }] }, format: title("Dates") },
    "kpi-requests": kpi("Requests", "payments.requests"),
    "kpi-spent": kpi("Captured spend", "payments.spent"),
    "kpi-blocked": kpi("Blocked", "payments.blocked"),
    "kpi-attacks": kpi("Attacks stopped", "payments.injections"),
    "risk-gauge": {
      type: "risk-gauge",
      dataMapping: { value: [{ id: "payments.riskScore", aggregation: "avg" }], count: [sum("payments.requests")] },
      format: title("Average risk", "0-100, across the filtered requests"),
    },
    "decisions-by-day": {
      type: "combo-chart-stacked-column-line",
      dataMapping: {
        categoryKey: [{ id: "payments.day" }],
        valueKey: [sum("payments.approved"), sum("payments.asked"), sum("payments.blocked")],
        secondaryValueKey: [sum("payments.requests")],
      },
      sort: [{ field: { id: "payments.day" }, direction: "asc" }],
      format: title("Decisions per day", "What AgentGuard did with each request"),
    },
    "attack-feed": {
      type: "attack-feed",
      dataMapping: {
        snippet: [{ id: "threats.snippet" }],
        time: [{ id: "threats.createdAt" }],
        source: [{ id: "threats.merchant" }],
        technique: [{ id: "threats.technique" }],
        outcome: [{ id: "threats.outcome" }],
      },
      format: { ...title("Blocked attacks", "Hidden instructions pulled off store pages. Click one to filter by its store."), style: { limit: 25 } },
    },
    "spend-by-category": {
      type: "bar-chart-grouped",
      dataMapping: { categoryKey: [{ id: "payments.category" }], valueKey: [sum("payments.spent")] },
      sort: [{ field: sum("payments.spent"), direction: "desc" }],
      format: title("Captured spend by category"),
    },
    budgets: {
      type: "grid",
      dataMapping: {
        cols: [{ id: "budgets.budget" }, sum("budgets.limit"), sum("budgets.spent"), sum("budgets.held"), sum("budgets.remaining"), { id: "budgets.used", aggregation: "max" }],
      },
      format: title("Budgets", "From the active policy"),
    },
    "risk-signals": {
      type: "grid",
      dataMapping: { cols: [{ id: "signals.signal" }, { id: "signals.source" }, sum("signals.points")] },
      sort: [{ field: sum("signals.points"), direction: "desc" }],
      format: title("What raised risk", "Points added by each signal"),
    },
    recent: {
      type: "grid",
      dataMapping: {
        cols: [
          { id: "payments.createdAt" },
          { id: "payments.merchant" },
          { id: "payments.item" },
          sum("payments.amount"),
          { id: "payments.decision" },
          { id: "payments.status" },
          { id: "payments.riskScore", aggregation: "max" },
          { id: "payments.explanation" },
        ],
      },
      sort: [{ field: { id: "payments.createdAt" }, direction: "desc" }],
      format: title("Every request"),
    },
  },
  widgetLayout: {
    "decision-filter": { xTrack: 0, yTrack: 0, xSpan: 14, ySpan: 5 },
    "day-filter": { xTrack: 14, yTrack: 0, xSpan: 10, ySpan: 5 },
    "kpi-requests": { xTrack: 0, yTrack: 5, xSpan: 6, ySpan: 8 },
    "kpi-spent": { xTrack: 6, yTrack: 5, xSpan: 6, ySpan: 8 },
    "kpi-blocked": { xTrack: 12, yTrack: 5, xSpan: 6, ySpan: 8 },
    "kpi-attacks": { xTrack: 18, yTrack: 5, xSpan: 6, ySpan: 8 },
    "risk-gauge": { xTrack: 0, yTrack: 13, xSpan: 8, ySpan: 17 },
    "decisions-by-day": { xTrack: 8, yTrack: 13, xSpan: 16, ySpan: 17 },
    "attack-feed": { xTrack: 0, yTrack: 30, xSpan: 14, ySpan: 23 },
    "spend-by-category": { xTrack: 14, yTrack: 30, xSpan: 10, ySpan: 23 },
    budgets: { xTrack: 0, yTrack: 53, xSpan: 12, ySpan: 14 },
    "risk-signals": { xTrack: 12, yTrack: 53, xSpan: 12, ySpan: 14 },
    recent: { xTrack: 0, yTrack: 67, xSpan: 24, ySpan: 22 },
  },
};

const threats: Page = {
  id: "threats",
  widgets: {
    feed: {
      type: "attack-feed",
      dataMapping: {
        snippet: [{ id: "threats.snippet" }],
        time: [{ id: "threats.createdAt" }],
        source: [{ id: "threats.merchant" }],
        technique: [{ id: "threats.technique" }],
        outcome: [{ id: "threats.outcome" }],
      },
      format: { ...title("Every attack, newest first", "Click one to filter the page to its store"), style: { limit: 60 } },
    },
    "by-technique": {
      type: "bar-chart-grouped",
      dataMapping: { categoryKey: [{ id: "threats.technique" }], valueKey: [{ id: "threats.key", aggregation: "count" }] },
      sort: [{ field: { id: "threats.key", aggregation: "count" }, direction: "desc" }],
      format: title("How they hid it"),
    },
    "by-source": {
      type: "donut-chart",
      dataMapping: { categoryKey: [{ id: "threats.merchant" }], valueKey: [{ id: "threats.key", aggregation: "count" }] },
      format: title("Where they came from"),
    },
    table: {
      type: "grid",
      dataMapping: {
        cols: [
          { id: "threats.createdAt" },
          { id: "threats.merchant" },
          { id: "threats.item" },
          { id: "threats.technique" },
          { id: "threats.hidden" },
          { id: "threats.snippet" },
          { id: "threats.outcome" },
        ],
      },
      sort: [{ field: { id: "threats.createdAt" }, direction: "desc" }],
      format: title("Attack log"),
    },
  },
  widgetLayout: {
    feed: { xTrack: 0, yTrack: 0, xSpan: 14, ySpan: 36 },
    "by-technique": { xTrack: 14, yTrack: 0, xSpan: 10, ySpan: 18 },
    "by-source": { xTrack: 14, yTrack: 18, xSpan: 10, ySpan: 18 },
    table: { xTrack: 0, yTrack: 36, xSpan: 24, ySpan: 22 },
  },
};

export const SENTINEL_INTRO_ID = "sentinel-intro";
const sentinel: Page = {
  id: "sentinel",
  widgets: {
    [SENTINEL_INTRO_ID]: {
      type: "text",
      dataMapping: {},
      format: {
        style: {
          text:
            "The Sentinel watches the transaction stream for refund spikes, failed payments, bursts of attacks, a climbing risk score and budgets " +
            "running out. Ask it in the chat (Build mode), or press Scan now. Each finding becomes an alert card below.",
          typography: { fontSize: 14 },
          color: "#59554c",
          verticalAlign: "center",
        },
      },
    },
  },
  widgetLayout: { [SENTINEL_INTRO_ID]: { xTrack: 0, yTrack: 0, xSpan: 24, ySpan: 5 } },
};

export function initialReport(): State {
  return {
    pages: [overview, threats, sentinel],
    selectedPageId: "overview",
    panels: { filters: { collapsed: true }, data: { collapsed: true }, edit: { collapsed: true }, ai: { collapsed: false } },
  };
}

/** Phones: every widget full width, stacked in reading order (top to bottom, then left to right). */
export function stackForPhone(state: State): State {
  return {
    ...state,
    pages: state.pages.map((page) => {
      const layout = page.widgetLayout ?? {};
      const ids = Object.keys(layout).sort((a, b) => layout[a]!.yTrack - layout[b]!.yTrack || layout[a]!.xTrack - layout[b]!.xTrack);
      let y = 0;
      const stacked: typeof layout = {};
      for (const id of ids) {
        // Filter buttons wrap onto more lines at phone width.
        const type = page.widgets?.[id]?.type;
        const ySpan = Math.max(layout[id]!.ySpan, type === "button-filter" || type === "date-filter" ? 8 : 6);
        stacked[id] = { xTrack: 0, yTrack: y, xSpan: 24, ySpan };
        y += ySpan;
      }
      return { ...page, widgetLayout: stacked };
    }),
  };
}
