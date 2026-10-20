/** Half-circle risk gauge, 0–100. Thresholds match the decision engine (35 ask, 70 block). */
export function RiskGauge({ score, size = 72 }: { score: number; size?: number }) {
  const s = Math.max(0, Math.min(100, score));
  const r = 30;
  const circ = Math.PI * r;
  const color = s >= 70 ? "#ef4444" : s >= 35 ? "#f59e0b" : "#22c55e";
  return (
    <svg width={size} height={size * 0.62} viewBox="0 0 72 44" role="img" aria-label={`Risk ${s} of 100`}>
      <path d="M6 38 A30 30 0 0 1 66 38" fill="none" stroke="#1f2a44" strokeWidth="7" strokeLinecap="round" />
      <path
        d="M6 38 A30 30 0 0 1 66 38"
        fill="none"
        stroke={color}
        strokeWidth="7"
        strokeLinecap="round"
        strokeDasharray={`${(s / 100) * circ} ${circ}`}
      />
      <text x="36" y="37" textAnchor="middle" fontSize="15" fontWeight="700" fill={color}>
        {s}
      </text>
    </svg>
  );
}
