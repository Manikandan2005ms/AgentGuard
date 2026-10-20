"use client";

import type { AgChartOptions, AgChartTheme } from "ag-charts-community";
import { AgCharts } from "ag-charts-react";

/** AG Charts in the dashboard's dark theme (R4). */

export const CHART_COLORS = { ok: "#22c55e", warn: "#f59e0b", bad: "#ef4444", shield: "#22d3ee", line: "#1f2a44", muted: "#8b98b8" };

export const chartTheme: AgChartTheme = {
  baseTheme: "ag-default-dark",
  palette: {
    fills: [CHART_COLORS.shield, CHART_COLORS.ok, CHART_COLORS.warn, CHART_COLORS.bad, "#a78bfa", "#f472b6", "#60a5fa"],
    strokes: [CHART_COLORS.shield, CHART_COLORS.ok, CHART_COLORS.warn, CHART_COLORS.bad, "#a78bfa", "#f472b6", "#60a5fa"],
  },
  overrides: {
    common: {
      background: { fill: "transparent" },
      title: { color: "#e6ebf5", fontSize: 14, fontWeight: 600 },
      legend: { item: { label: { color: "#8b98b8" } } },
    },
  },
};

export function Chart({ options, height = 260 }: { options: AgChartOptions; height?: number }) {
  return (
    // AG Charts sizes itself to this box; min-w-0 + overflow-hidden keep it from widening the page on phones.
    <div className="w-full min-w-0 overflow-hidden" style={{ height }}>
      <AgCharts options={{ theme: chartTheme, height, ...options } as AgChartOptions} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}
