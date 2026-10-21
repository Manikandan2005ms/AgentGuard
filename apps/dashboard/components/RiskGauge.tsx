import { riskColor } from "@/lib/palette";

/** Risk score 0–100 with a scale underneath. The ticks mark the decision engine's thresholds (35 ask, 70 block). */
export function RiskGauge({ score }: { score: number }) {
  const s = Math.round(Math.max(0, Math.min(100, score)));
  const color = riskColor(s);
  return (
    <div className="w-16" role="img" aria-label={`Risk ${s} of 100`} title={`Risk ${s} of 100. Above 35 asks you, above 70 blocks.`}>
      <div className="kicker !text-[10px] !tracking-[0.1em]">Risk</div>
      <div className="figure mt-0.5 font-serif text-[30px] leading-none font-medium" style={{ color }}>
        {s}
      </div>
      <div className="relative mt-2 h-[3px] rounded-full bg-rule">
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${s}%`, background: color }} />
        <span className="absolute -top-[3px] left-[35%] h-[9px] w-px bg-ink-3" />
        <span className="absolute -top-[3px] left-[70%] h-[9px] w-px bg-ink-3" />
      </div>
    </div>
  );
}
