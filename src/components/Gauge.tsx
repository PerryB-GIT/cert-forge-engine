/**
 * Horizontal 100–1000 scaled-score gauge with a hard rule at the 720 cut.
 * Pure SVG, responsive via viewBox.
 */
export function Gauge({
  value,
  color = "var(--sf-accent)",
  height = 56,
}: {
  value: number | null;
  color?: string;
  height?: number;
}) {
  const W = 600;
  const H = height;
  const PAD = 8;
  const trackY = H / 2 - 5;
  const min = 100;
  const max = 1000;
  const cut = 720;
  const x = (v: number) => PAD + ((v - min) / (max - min)) * (W - PAD * 2);
  const cutX = x(cut);
  const valX = value === null ? null : x(Math.min(max, Math.max(min, value)));
  const pass = value !== null && value >= cut;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img"
      aria-label={value === null ? "No score yet" : `Scaled score ${value} of 1000; cut score 720`}>
      {/* track */}
      <rect x={PAD} y={trackY} width={W - PAD * 2} height={10} rx={4} fill="var(--sf-surface-2)" />
      {/* fill */}
      {valX !== null && (
        <rect x={PAD} y={trackY} width={Math.max(4, valX - PAD)} height={10} rx={4} fill={color}>
          <title>{`Scaled score: ${value}`}</title>
        </rect>
      )}
      {/* 720 rule */}
      <line x1={cutX} y1={trackY - 9} x2={cutX} y2={trackY + 19} stroke="var(--sf-ink)" strokeWidth={2} />
      <text x={cutX} y={trackY - 13} textAnchor="middle" fontSize={11} fill="var(--sf-ink)" fontWeight={700}>
        720 cut
      </text>
      {/* min/max labels */}
      <text x={PAD} y={trackY + 32} fontSize={10} fill="var(--sf-ink-3)">100</text>
      <text x={W - PAD} y={trackY + 32} textAnchor="end" fontSize={10} fill="var(--sf-ink-3)">1000</text>
      {/* value marker + direct label */}
      {valX !== null && (
        <>
          <circle cx={valX} cy={trackY + 5} r={7} fill={color} stroke="var(--sf-bg)" strokeWidth={2}>
            <title>{`Scaled score: ${value} (${pass ? "ready" : `${cut - (value as number)} below cut`})`}</title>
          </circle>
          <text
            x={Math.min(W - PAD - 4, Math.max(PAD + 4, valX))}
            y={trackY + 32}
            textAnchor="middle"
            fontSize={13}
            fontWeight={800}
            fill={pass ? "var(--sf-good)" : "var(--sf-ink)"}
          >
            {value}
          </text>
        </>
      )}
    </svg>
  );
}
