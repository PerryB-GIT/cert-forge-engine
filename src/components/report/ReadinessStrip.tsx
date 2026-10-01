import { EXAMS } from "@/lib/exams";
import { EXAM_COLORS } from "@/lib/ui";
import { readinessBand, scoreMargin } from "@/lib/scoring";

/**
 * All four exams on one 100-1000 axis: best qualifying fresh score per exam
 * with its 90% margin, against the 720 estimate and the 800 likely-pass line.
 * Criterion-referenced on purpose — the cut, not other people, is the yardstick
 * (research doc section 4).
 */
export function ReadinessStrip({
  best,
}: {
  best: Record<string, { score: number; items: number } | null>;
}) {
  const pos = (v: number) => ((Math.max(100, Math.min(1000, v)) - 100) / 900) * 100;
  return (
    <div className="space-y-3">
      {EXAMS.map((e) => {
        const b = best[e.code];
        const m = b ? scoreMargin(b.score, b.items) : 0;
        const band = b ? readinessBand(b.score, b.items) : null;
        const color = EXAM_COLORS[e.code];
        return (
          <div key={e.code}>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
              <span className="truncate text-ink2">
                <b style={{ color }}>{e.code}</b> · {e.shortName}
              </span>
              <span className="shrink-0 font-mono tabular-nums">
                {b && band ? (
                  <>
                    <b>{b.score}</b> <span className="text-ink3">±{m}</span>{" "}
                    <span
                      className={
                        band.key === "likely" ? "text-good" : band.key === "borderline" ? "text-warn" : "text-ink3"
                      }
                    >
                      {band.label}
                    </span>
                  </>
                ) : (
                  <span className="text-ink3">no qualifying full sim</span>
                )}
              </span>
            </div>
            <div className="relative h-3 rounded-full bg-surface2">
              <div className="absolute inset-y-0 w-px bg-ink2" style={{ left: `${pos(720)}%` }} title="720 estimated cut" />
              <div className="absolute inset-y-0 w-px bg-good/70" style={{ left: `${pos(800)}%` }} title="800 likely pass" />
              {b && (
                <>
                  <div
                    className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full opacity-40"
                    style={{ left: `${pos(b.score - m)}%`, width: `${pos(b.score + m) - pos(b.score - m)}%`, background: color }}
                  />
                  <div
                    className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2"
                    style={{ left: `${pos(b.score)}%`, background: color, borderColor: "var(--sf-bg)" }}
                    title={`${e.code}: ${b.score} ±${m} on ${b.items} fresh items`}
                  />
                </>
              )}
            </div>
          </div>
        );
      })}
      <p className="text-[10px] text-ink3">
        Dot = best full sim scored on 40+ fresh items · bar = 90% margin · lines at 720 (estimated cut) and 800 (likely pass)
      </p>
    </div>
  );
}
