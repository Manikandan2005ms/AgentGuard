"use client";

import type { AgWidgetParams } from "ag-studio";
import { PALETTE, riskColor } from "@/lib/palette";
import type { RiskGaugeDef } from "../widgets";
import { useWidgetQuery } from "./useWidgetQuery";

/** The decision engine's thresholds: at 35 AgentGuard asks you, at 70 it blocks. */
const ASK = 35;
const BLOCK = 70;
const R = 78;
const CX = 100;
const CY = 96;

/** A point on the gauge's arc for a 0-100 value (0 = left, 100 = right). */
function at(v: number, r = R) {
  const a = (Math.PI * Math.max(0, Math.min(100, v))) / 100;
  return [CX - r * Math.cos(a), CY - r * Math.sin(a)] as const;
}
const arc = (from: number, to: number) => {
  const [x1, y1] = at(from);
  const [x2, y2] = at(to);
  return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${R} ${R} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
};

const BANDS = [
  { from: 0, to: ASK, track: "#e3ecdc", fill: PALETTE.okFill },
  { from: ASK, to: BLOCK, track: "#f6e9cf", fill: PALETTE.warnFill },
  { from: BLOCK, to: 100, track: "#f6e1da", fill: PALETTE.badFill },
];

export function RiskGaugeWidget(params: AgWidgetParams<RiskGaugeDef>) {
  const { dataMapping, widgetApi } = params;
  const value = dataMapping.value?.at(0);
  const count = dataMapping.count?.at(0);
  const data = useWidgetQuery(
    widgetApi,
    value ? { fields: count ? [value, count] : [value] } : null,
    (rows) => {
      const row = rows.at(0);
      const raw = value ? row?.[value.key] : null;
      if (raw == null || Number.isNaN(Number(raw))) return null;
      return { score: Number(raw), n: count ? widgetApi.formatFieldValue(count, row?.[count.key]) : null };
    },
    params,
  );
  // Always render a root element: Studio mounts the widget into its own container.
  if (!data) return <div className="h-full w-full" />;

  const score = Math.round(Math.max(0, Math.min(100, data.score)));
  const color = riskColor(score);
  const verdict = score >= BLOCK ? "would be blocked" : score >= ASK ? "would ask you first" : "passes on its own";
  const [nx, ny] = at(score, R - 20);

  return (
    <div className="flex h-full w-full flex-col items-center justify-center" role="img" aria-label={`Average risk ${score} of 100: a request like this ${verdict}`}>
      <svg viewBox="0 0 200 112" className="h-full max-h-[200px] w-full min-h-0 flex-1" preserveAspectRatio="xMidYMid meet">
        {BANDS.map((b) => (
          <path key={b.from} d={arc(b.from + 0.6, b.to - 0.6)} stroke={b.track} strokeWidth={15} fill="none" />
        ))}
        {/* The part of each band the score has reached, in the band's own colour. */}
        {BANDS.filter((b) => score > b.from + 1.2).map((b) => (
          <path key={`f${b.from}`} d={arc(b.from + 0.6, Math.min(score, b.to) - 0.6)} stroke={b.fill} strokeWidth={15} fill="none" />
        ))}
        {[ASK, BLOCK].map((t) => {
          const [x1, y1] = at(t, R + 10);
          const [x2, y2] = at(t, R - 10);
          const [lx, ly] = at(t, R + 18);
          return (
            <g key={t}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={PALETTE.ink3} strokeWidth={1} />
              <text x={lx} y={ly} fontSize={8} fill={PALETTE.ink3} textAnchor="middle" dominantBaseline="middle">
                {t === ASK ? "35 ask" : "70 block"}
              </text>
            </g>
          );
        })}
        <line x1={CX} y1={CY} x2={nx} y2={ny} stroke={PALETTE.ink} strokeWidth={2} strokeLinecap="round" />
        <circle cx={CX} cy={CY} r={4} fill={PALETTE.ink} />
        <text x={CX} y={CY - 26} textAnchor="middle" fontSize={30} fontWeight={500} fill={color} style={{ fontFamily: "var(--font-serif)" }}>
          {score}
        </text>
        <text x={CX - R} y={CY + 12} fontSize={8} fill={PALETTE.ink3} textAnchor="middle">
          0
        </text>
        <text x={CX + R} y={CY + 12} fontSize={8} fill={PALETTE.ink3} textAnchor="middle">
          100
        </text>
      </svg>
      <p className="mt-1 text-center text-[12.5px] leading-snug text-ink-2">
        A typical request {verdict}
        {data.n ? <span className="text-ink-3"> · {data.n} requests</span> : null}
      </p>
    </div>
  );
}
