/**
 * Session x domain heatmap. Rows = attempts (newest first), columns = the exam's domains.
 * Sequential single-hue encoding (value -> opacity of the exam color over the dark surface),
 * with the numeric percent printed in each cell so identity is never color-alone.
 * Cells below 70% carry a warn ring (the "weak domain" threshold).
 */
export type HeatRow = {
  label: string; // e.g. "Full - Jul 14" or "Quick - Jul 15"
  kind: "full" | "quick";
  cells: (number | null)[]; // pct per domain, aligned to `domains`
};

export function DomainHeatmap({
  domains,
  rows,
  color = "var(--sf-accent)",
}: {
  domains: string[];
  rows: HeatRow[];
  color?: string;
}) {
  if (rows.length === 0) return null;
  // sequential ramp: 0% -> faint, 100% -> full hue
  const fill = (v: number | null) => {
    if (v === null) return "transparent";
    const t = Math.min(1, Math.max(0, v / 100));
    return `color-mix(in srgb, ${color} ${Math.round(15 + t * 85)}%, var(--sf-surface-2))`;
  };
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate" style={{ borderSpacing: 2 }}>
        <thead>
          <tr>
            <th className="sticky left-0 bg-surface px-2 py-1 text-left text-[10px] font-semibold text-ink3">
              attempt
            </th>
            {domains.map((d) => (
              <th
                key={d}
                className="px-1 py-1 text-[9px] font-medium text-ink3"
                title={d}
              >
                <span className="block max-w-[54px] truncate">{abbrev(d)}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>
              <td className="sticky left-0 bg-surface whitespace-nowrap px-2 py-1 text-[10px] text-ink2">
                <span className={r.kind === "quick" ? "text-accenthi" : "text-good"}>
                  {r.kind === "quick" ? "Q" : "F"}
                </span>{" "}
                {r.label}
              </td>
              {r.cells.map((c, ci) => (
                <td
                  key={ci}
                  className="h-7 min-w-[40px] rounded text-center align-middle text-[10px] font-semibold tabular-nums"
                  style={{
                    background: fill(c),
                    color: c !== null && c >= 55 ? "var(--sf-bg)" : "var(--sf-ink)",
                    boxShadow:
                      c !== null && c < 70 ? "inset 0 0 0 1px var(--sf-warn)" : undefined,
                  }}
                  title={`${domains[ci]}: ${c === null ? "n/a" : Math.round(c) + "%"}`}
                >
                  {c === null ? "" : Math.round(c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function abbrev(name: string): string {
  // first letters of the first 2-3 significant words, e.g. "Applications and Integration" -> "App/Int"
  const words = name.split(/[\s&,]+/).filter((w) => w.length > 2 && w !== "and");
  return words.slice(0, 2).map((w) => w.slice(0, 3)).join("/");
}
