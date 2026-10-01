/**
 * Per-domain horizontal bars: pct correct (0–100) with weight shown in the label.
 * Direct-labeled values, 70% reference tick, hover titles.
 */
export function DomainBars({
  rows,
  color = "var(--sf-accent)",
}: {
  rows: { name: string; weight: number; pct: number | null }[];
  color?: string;
}) {
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.name} className="group">
          <div className="mb-0.5 flex items-baseline justify-between gap-2 text-xs">
            <span className="truncate text-ink2" title={`${r.name} — ${r.weight}% of exam`}>
              {r.name} <span className="text-ink3">· {r.weight}%</span>
            </span>
            <span className="font-mono font-semibold tabular-nums">
              {r.pct === null ? "—" : `${Math.round(r.pct)}%`}
            </span>
          </div>
          <svg viewBox="0 0 100 6" preserveAspectRatio="none" className="block h-2 w-full">
            <rect x={0} y={0} width={100} height={6} rx={2} fill="var(--sf-surface-2)" />
            {r.pct !== null && (
              <rect
                x={0}
                y={0}
                width={Math.max(1.5, r.pct)}
                height={6}
                rx={2}
                fill={r.pct >= 70 ? color : "var(--sf-warn)"}
              >
                <title>{`${r.name}: ${Math.round(r.pct)}% (weight ${r.weight}%)`}</title>
              </rect>
            )}
            {/* 70% no-weak-domains reference */}
            <line x1={70} y1={0} x2={70} y2={6} stroke="var(--sf-ink-3)" strokeWidth={0.4} />
          </svg>
        </div>
      ))}
    </div>
  );
}
