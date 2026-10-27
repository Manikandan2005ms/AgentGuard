"use client";

import { AllCommunityModule, ModuleRegistry, type AgChartOptions, type AgChartTheme } from "ag-charts-community";
import { AgCharts } from "ag-charts-react";
import { sans } from "@/lib/fonts";
import { PALETTE } from "@/lib/palette";

// AG Charts 13+ only draws the chart and series types that are registered.
ModuleRegistry.registerModules([AllCommunityModule]);

/** AG Charts on the dashboard's paper palette (R4). Also used for AG Grid's integrated charts. */

export const CHART_COLORS = {
  ok: PALETTE.okFill,
  warn: PALETTE.warnFill,
  bad: PALETTE.badFill,
  accent: PALETTE.accentFill,
  empty: "#e7e1d3",
  ink: PALETTE.ink,
  muted: PALETTE.ink3,
};

const SERIES = [PALETTE.accentFill, PALETTE.okFill, PALETTE.warnFill, PALETTE.badFill, "#7d6a9e", "#4e8a8a", "#a8714a"];

export const chartTheme: AgChartTheme = {
  baseTheme: "ag-default",
  palette: { fills: SERIES, strokes: SERIES },
  params: {
    fontFamily: sans.style.fontFamily,
    foregroundColor: PALETTE.ink,
    textColor: PALETTE.ink,
    subtleTextColor: PALETTE.ink2,
    backgroundColor: PALETTE.sheet,
    chartBackgroundColor: "transparent",
    axisLineColor: PALETTE.rule2,
    gridLineColor: "#ebe5d7",
    accentColor: PALETTE.accent,
    tooltipBackgroundColor: PALETTE.ink,
    tooltipTextColor: PALETTE.sheet,
    tooltipSubtleTextColor: "#cfc8b8",
  },
  overrides: {
    common: {
      legend: { item: { label: { color: PALETTE.ink2, fontSize: 12.5 } } },
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
