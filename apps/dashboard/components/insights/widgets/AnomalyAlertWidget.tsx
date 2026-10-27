"use client";

import type { AgWidgetParams } from "ag-studio";
import { timeAgo } from "@/lib/api";
import { PALETTE } from "@/lib/palette";
import type { AnomalyAlertDef, AnomalyAlertStyle, Severity } from "../widgets";
import { useWidgetQuery } from "./useWidgetQuery";

const SEVERITY: Record<Severity, { word: string; ink: string; wash: string; bar: string }> = {
  high: { word: "High", ink: "text-bad", wash: "bg-bad-wash", bar: PALETTE.badFill },
  medium: { word: "Medium", ink: "text-warn", wash: "bg-warn-wash", bar: PALETTE.warnFill },
  low: { word: "Low", ink: "text-accent", wash: "bg-accent-wash", bar: PALETTE.accentFill },
};

function measure(n: number | undefined, unit: AnomalyAlertStyle["unit"]) {
  if (n == null) return "–";
  if (unit === "usd") return `$${n.toFixed(2)}`;
  if (unit === "percent") return `${Math.round(n)}%`;
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** Bars for the metric per day; the newest bar is drawn in the alert's colour. */
function Trend({ points, color }: { points: { label: string; v: number }[]; color: string }) {
  const max = Math.max(1, ...points.map((p) => p.v));
  const w = 100 / points.length;
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="h-9 w-full" role="img" aria-label="Daily trend">
      {points.map((p, i) => {
        const h = Math.max(p.v > 0 ? 2 : 0.6, (p.v / max) * 28);
        return (
          <rect key={i} x={i * w + w * 0.15} y={30 - h} width={w * 0.7} height={h} fill={i === points.length - 1 ? color : PALETTE.rule2}>
            <title>{`${p.label}: ${p.v}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}

/** An alert card the Sentinel agent places when it finds something unusual in the transaction stream. */
export function AnomalyAlertWidget(params: AgWidgetParams<AnomalyAlertDef>) {
  const { dataMapping, widgetApi, format } = params;
  const style = format?.style ?? {};
  const sev = SEVERITY[style.severity ?? "medium"] ?? SEVERITY.medium;
  const x = dataMapping.trendX?.at(0);
  const y = dataMapping.trendValue?.at(0);

  const trend = useWidgetQuery(
    widgetApi,
    x && y ? { fields: [x, y], sort: [{ field: x, direction: "asc" }] } : null,
    (rows) => (x && y ? rows.slice(-14).map((r) => ({ label: widgetApi.formatFieldValue(x, r[x.key]), v: Number(r[y.key] ?? 0) })) : null),
    params,
    { optional: true },
  );

  return (
    <div className="flex h-full flex-col gap-2 overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className={`stamp ${sev.ink} !text-[10px]`}>{sev.word} severity</span>
        {style.detectedAt && <span className="text-[12px] text-ink-3">flagged {timeAgo(style.detectedAt)}</span>}
      </div>
      {style.detail && <p className="text-[13.5px] leading-snug text-ink">{style.detail}</p>}
      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-[12.5px]">
        <div className="flex items-baseline gap-1.5">
          <dt className="text-ink-3">Now</dt>
          <dd className={`figure font-serif text-[20px] leading-none font-medium ${sev.ink}`}>{measure(style.value, style.unit)}</dd>
        </div>
        {style.unit !== "percent" && (
          <div className="flex items-baseline gap-1.5">
            <dt className="text-ink-3">Normal</dt>
            <dd className="figure font-serif text-[20px] leading-none text-ink-2">{measure(style.baseline, style.unit)}</dd>
          </div>
        )}
        {style.merchants && (
          <div className="flex min-w-0 items-baseline gap-1.5">
            <dt className="text-ink-3">Where</dt>
            <dd className="truncate text-ink-2">{style.merchants}</dd>
          </div>
        )}
      </dl>
      {trend && trend.length > 1 && (
        <div className={`mt-auto rounded-[4px] ${sev.wash} px-2 pt-1.5 pb-1`}>
          <Trend points={trend} color={sev.bar} />
        </div>
      )}
    </div>
  );
}
