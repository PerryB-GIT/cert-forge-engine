/**
 * Contribution-grid of study activity, last ~11 weeks. Sequential single-hue intensity by
 * activity count. Deliberately non-punishing: empty days are just empty surface — no red,
 * no "you broke your streak". Positive accumulation only.
 */
export function ActivityHeatmap({
  days,
  today,
  color = "var(--sf-accent)",
}: {
  days: Record<string, number>;
  today: string;
  color?: string;
}) {
  const end = new Date(today + "T00:00:00");
  const DAYS = 77; // 11 weeks
  // start on the Sunday on/before (end - DAYS)
  const start = new Date(end);
  start.setDate(end.getDate() - (DAYS - 1));
  start.setDate(start.getDate() - start.getDay()); // back to Sunday

  const weeks: { date: string; count: number; future: boolean }[][] = [];
  const cur = new Date(start);
  while (cur <= end || cur.getDay() !== 0) {
    const wk: { date: string; count: number; future: boolean }[] = [];
    for (let d = 0; d < 7; d++) {
      const iso = cur.toISOString().slice(0, 10);
      wk.push({ date: iso, count: days[iso] ?? 0, future: cur > end });
      cur.setDate(cur.getDate() + 1);
    }
    weeks.push(wk);
    if (cur > end && cur.getDay() === 0) break;
  }

  const fill = (count: number, future: boolean) => {
    if (future) return "transparent";
    if (count <= 0) return "var(--sf-surface-2)";
    const t = Math.min(1, count / 3);
    return `color-mix(in srgb, ${color} ${Math.round(35 + t * 65)}%, var(--sf-surface-2))`;
  };

  return (
    <div className="overflow-x-auto">
      <div className="flex gap-[3px]">
        {weeks.map((wk, wi) => (
          <div key={wi} className="flex flex-col gap-[3px]">
            {wk.map((c) => (
              <div
                key={c.date}
                className="h-[11px] w-[11px] rounded-[2px]"
                style={{ background: fill(c.count, c.future) }}
                title={c.future ? "" : `${c.date}: ${c.count} action${c.count === 1 ? "" : "s"}`}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex items-center gap-1 text-[10px] text-ink3">
        <span>less</span>
        {[0, 1, 2, 3].map((n) => (
          <span
            key={n}
            className="h-[10px] w-[10px] rounded-[2px]"
            style={{ background: fill(n, false) }}
          />
        ))}
        <span>more</span>
      </div>
    </div>
  );
}
