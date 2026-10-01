import { CUT_PCT } from "@/lib/exams";

/**
 * Where the points are: each domain's % correct as a diverging bar around the
 * ~69% cut, sorted by points at stake (blueprint weight x shortfall). A 30%
 * domain 10 points short outranks a 5% domain 20 points short — that is the
 * order to study in.
 */
export function DomainGap({
  rows,
  color,
}: {
  rows: { name: string; weight: number; pct: number | null }[];
  color: string;
}) {
  const cut = CUT_PCT;
  const scored = rows
    .filter((r): r is { name: string; weight: number; pct: number } => r.pct !== null)
    .map((r) => ({ ...r, stake: r.weight * Math.max(0, cut - r.pct) }))
    .sort((a, b) => b.stake - a.stake || a.pct - b.pct);
  if (scored.length === 0) return <p className="py-4 text-center text-sm text-ink3">No domain scores yet.</p>;
  return (
    <div className="space-y-2">
      {scored.map((r) => {
        const diff = r.pct - cut;
        const left = diff >= 0 ? cut : r.pct;
        return (
          <div key={r.name} className="text-xs">
            <div className="mb-0.5 flex items-baseline justify-between gap-2">
              <span className="truncate text-ink2" title={r.name}>
                {r.name} <span className="text-ink3">· {r.weight}%</span>
              </span>
              <span className={`shrink-0 font-mono tabular-nums ${diff >= 0 ? "text-good" : "text-warn"}`}>
                {Math.round(r.pct)}% ({diff >= 0 ? "+" : ""}
                {Math.round(diff)})
              </span>
            </div>
            <svg viewBox="0 0 100 6" preserveAspectRatio="none" className="block h-2 w-full">
              <rect x={0} y={0} width={100} height={6} rx={2} fill="var(--sf-surface-2)" />
              <rect x={left} y={0} width={Math.max(0.8, Math.abs(diff))} height={6} fill={diff >= 0 ? color : "var(--sf-warn)"}>
                <title>{`${r.name}: ${Math.round(r.pct)}% vs ~${Math.round(cut)}% cut, weight ${r.weight}%`}</title>
              </rect>
              <line x1={cut} y1={0} x2={cut} y2={6} stroke="var(--sf-ink-2)" strokeWidth={0.6} />
            </svg>
          </div>
        );
      })}
      <p className="text-[10px] text-ink3">
        Bars grow from the ~{Math.round(cut)}% cut line · sorted by points at stake (weight × shortfall) · whole
        sitting, repeats included
      </p>
    </div>
  );
}
