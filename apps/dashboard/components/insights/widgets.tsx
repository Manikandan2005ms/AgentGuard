import type {
  AgBaseRegistry,
  AgBaseWidgetDefinition,
  AgDefaultRegistry,
  AgDefaultWidgetDefinition,
  AgWidgetDataFormat,
  AgWidgetFieldReference,
  AgWidgetFormParams,
  AgWidgetsConfig,
} from "ag-studio";
import { createWidgets } from "ag-studio-react";
import { AnomalyAlertWidget } from "./widgets/AnomalyAlertWidget";
import { AttackFeedWidget } from "./widgets/AttackFeedWidget";
import { RiskGaugeWidget } from "./widgets/RiskGaugeWidget";

/** AgentGuard's own Studio widgets: a risk gauge, a feed of blocked attacks, and the Sentinel's anomaly alerts. */

type Fields = AgWidgetFieldReference[];

export interface RiskGaugeDef {
  type: "risk-gauge";
  dataMapping: { value: Fields; count?: Fields };
  format?: AgWidgetDataFormat<Record<string, never>>;
}

export interface AttackFeedDef {
  type: "attack-feed";
  dataMapping: { snippet: Fields; time: Fields; source?: Fields; technique?: Fields; outcome?: Fields };
  format?: AgWidgetDataFormat<{ limit?: number }>;
}

export type Severity = "high" | "medium" | "low";
export interface AnomalyAlertStyle {
  severity?: Severity;
  detail?: string;
  value?: number;
  baseline?: number;
  unit?: "count" | "usd" | "score" | "percent";
  merchants?: string;
  detectedAt?: string;
  anomalyId?: string;
}
export interface AnomalyAlertDef {
  type: "anomaly-alert";
  dataMapping: { trendX?: Fields; trendValue?: Fields };
  format?: AgWidgetDataFormat<AnomalyAlertStyle>;
}

export interface InsightsRegistry extends AgBaseRegistry {
  widgets: readonly (
    | AgDefaultWidgetDefinition
    | AgBaseWidgetDefinition<"risk-gauge", RiskGaugeDef>
    | AgBaseWidgetDefinition<"attack-feed", AttackFeedDef>
    | AgBaseWidgetDefinition<"anomaly-alert", AnomalyAlertDef>
  )[];
}

// Menu icons, drawn in the dashboard's ink.
const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#1d1c19" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const ICONS = {
  gauge: svg('<path d="M3.5 16a8.5 8.5 0 0 1 17 0"/><path d="M12 16l4-5"/><path d="M8.5 7.6l.7 1.2M15.5 7.6l-.7 1.2"/>'),
  feed: svg('<path d="M12 2.8 5 5.4v5.4c0 4.2 2.9 7.8 7 9.2 4.1-1.4 7-5 7-9.2V5.4z"/><path d="M9 10h6M9 13.5h4"/>'),
  alert: svg('<path d="M12 3.5 2.8 19.5h18.4z"/><path d="M12 9.5v4.5M12 16.8v.2"/>'),
};

/** Edit-panel sections beyond Studio's defaults, typed loosely because the form item types are generic over paths. */
type FormItems = { items: { items: unknown[] }[] };

export function insightsWidgets(defaults: AgWidgetsConfig<AgDefaultRegistry>): AgWidgetsConfig<InsightsRegistry> {
  return createWidgets<InsightsRegistry>({
    additionalTypes: [
      {
        id: "risk-gauge",
        label: "Risk gauge",
        icon: ICONS.gauge,
        dataMapping: {
          value: {
            type: "field",
            supportedRoles: ["numeric"],
            requires: { cardinality: "one" },
            required: true,
            aiDescription: "A 0-100 risk score, normally payments.riskScore with aggregation avg.",
          },
          count: {
            type: "field",
            supportedRoles: ["numeric"],
            requires: { cardinality: "one" },
            aiDescription: "Optional: how many requests the score covers, e.g. payments.requests summed.",
          },
        },
        form: (params: AgWidgetFormParams<RiskGaugeDef>) =>
          params.createDefaults({
            dataMappingItems: [
              { key: "value", label: "Risk score" },
              { key: "count", label: "Request count" },
            ],
          }),
        comp: RiskGaugeWidget,
        defaultSize: { width: 340, height: 260 },
        minSize: { width: 220, height: 180 },
        ai: {
          label: "Risk gauge",
          description: "A semicircle gauge for a 0-100 risk score, banded at AgentGuard's thresholds: 35 asks the human, 70 blocks.",
          usage: "Use for an average risk score. Not for money or counts.",
          configuration: "Map value to payments.riskScore with aggregation avg, and count to payments.requests with aggregation sum.",
        },
      },
      {
        id: "attack-feed",
        label: "Blocked attacks feed",
        icon: ICONS.feed,
        dataMapping: {
          snippet: {
            type: "field",
            supportedRoles: ["category"],
            requires: { cardinality: "many" },
            required: true,
            aiDescription: "The injected instruction text, normally threats.snippet.",
          },
          time: {
            type: "field",
            supportedRoles: ["temporal"],
            requires: { cardinality: "many" },
            required: true,
            sort: true,
            aiDescription: "When the attack was caught, normally threats.createdAt.",
          },
          source: { type: "field", supportedRoles: ["category"], requires: { cardinality: "many" }, aiDescription: "The store that carried it, normally threats.merchant." },
          technique: { type: "field", supportedRoles: ["category"], requires: { cardinality: "many" }, aiDescription: "How it was hidden, normally threats.technique." },
          outcome: { type: "field", supportedRoles: ["category"], requires: { cardinality: "many" }, aiDescription: "AgentGuard's decision, normally threats.outcome." },
        },
        form: (params: AgWidgetFormParams<AttackFeedDef>) => {
          const form = params.createDefaults({
            dataMappingItems: [
              { key: "snippet", label: "Hidden text" },
              { key: "time", label: "Caught at" },
              { key: "source", label: "Source" },
              { key: "technique", label: "Technique" },
              { key: "outcome", label: "Outcome" },
            ],
            supportsCrossHighlight: false,
          });
          (form as unknown as FormItems).items[1]!.items.push({
            type: "section",
            key: "feed",
            label: "Feed",
            items: [{ type: "number", id: "format.style.limit", label: "Attacks to show", defaultValue: 25, min: 1, max: 200 }],
          });
          return form;
        },
        comp: AttackFeedWidget,
        defaultSize: { width: 560, height: 420 },
        minSize: { width: 260, height: 220 },
        ai: {
          label: "Blocked attacks feed",
          description: "A newest-first feed of prompt-injection attacks, each showing the hidden text pulled from the store page, the store, the technique and the outcome. Clicking an attack filters the page to its store.",
          usage: "Use to show what attackers tried to make the agent do. Needs the threats table.",
          configuration: "Map snippet to threats.snippet, time to threats.createdAt, source to threats.merchant, technique to threats.technique, outcome to threats.outcome.",
        },
      },
      {
        id: "anomaly-alert",
        label: "Anomaly alert",
        icon: ICONS.alert,
        dataMapping: {
          trendX: { type: "field", supportedRoles: ["temporal", "category"], requires: { cardinality: "many" }, sort: true, aiDescription: "Optional: payments.day, to draw the metric per day." },
          trendValue: {
            type: "field",
            supportedRoles: ["numeric"],
            requires: { per: "dataMapping.trendX", cardinality: "one" },
            aiDescription: "Optional: the daily metric, e.g. payments.refunds summed.",
          },
        },
        form: (params: AgWidgetFormParams<AnomalyAlertDef>) => {
          const form = params.createDefaults({
            dataMappingItems: [
              { key: "trendX", label: "Trend by" },
              { key: "trendValue", label: "Trend value" },
            ],
          });
          // Studio keeps only the format fields the form declares, so every field the Sentinel writes is listed here.
          (form as unknown as FormItems).items[1]!.items.push({
            type: "section",
            key: "alert",
            label: "Alert",
            items: [
              {
                type: "select",
                id: "format.style.severity",
                label: "Severity",
                defaultValue: "medium",
                items: [
                  { value: "high", label: "High" },
                  { value: "medium", label: "Medium" },
                  { value: "low", label: "Low" },
                ],
              },
              { type: "textarea", id: "format.style.detail", label: "What happened" },
              { type: "optional-number", id: "format.style.value", label: "Now" },
              { type: "optional-number", id: "format.style.baseline", label: "Normal" },
              {
                type: "select",
                id: "format.style.unit",
                label: "Unit",
                defaultValue: "count",
                items: [
                  { value: "count", label: "Count" },
                  { value: "usd", label: "US dollars" },
                  { value: "score", label: "Risk score" },
                  { value: "percent", label: "Percent" },
                ],
              },
              { type: "textfield", id: "format.style.merchants", label: "Where" },
              { type: "textfield", id: "format.style.detectedAt", label: "Flagged at (ISO time)" },
              { type: "textfield", id: "format.style.anomalyId", label: "Finding id" },
            ],
          });
          return form;
        },
        comp: AnomalyAlertWidget,
        defaultSize: { width: 420, height: 230 },
        minSize: { width: 240, height: 150 },
        ai: {
          label: "Anomaly alert",
          description: "An alert card raised by the Sentinel: severity, headline, what happened, now vs normal, and an optional daily trend.",
          usage: "Created by the Sentinel's flag_anomaly tool. Do not add or configure it by hand.",
        },
      },
    ],
    menu: [{ label: "AgentGuard", widgetIds: ["risk-gauge", "attack-feed", "anomaly-alert"] }, ...defaults.menu],
  });
}
