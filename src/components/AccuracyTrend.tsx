"use client";
import { useState } from "react";

/**
 * Daily practice accuracy over time, 0–100 with a 70% reference rule.
 * Sibling of <TrendLine>, which plots the 100–1000 scaled score; practice
 * accuracy is a raw percentage and does not belong on that axis.
 * Dot area encodes how many items that day, so a 100% day off two questions
 * does not read the same as a 100% day off twenty.
 */
export function AccuracyTrend({
  points,
  color = "var(--sf-accent)",
}: {
  points: { day: string; answered: number; correct: number; accuracy: number | null }[];
  color?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 600;
  const H = 130;
  const P = { l: 30, r: 10, t: 12, b: 18 };

  const pts = points.filter((p) => p.accuracy !== null);
  if (pts.length === 0)
    return <p className="py-5 text-center text-sm text-ink3">No practice answered yet.</p>;

  const xs = pts.map((p) => new Date(p.day).getTime());
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const spanX = Math.max(1, maxX - minX);
  const maxN = Math.max(...pts.map((p) => p.answered));
  const x = (t: number) =>
    pts.length === 1 ? (P.l + W - P.r) / 2 : P.l + ((t - minX) / spanX) * (W - P.l - P.r);
  const y = (v: number) => P.t + (1 - v / 100) * (H - P.t - P.b);
  const r = (n: number) => 3 + 3 * Math.sqrt(n / Math.max(1, maxN));

  const d = pts
    .map(
      (p, i) =>
        `${i === 0 ? "M" : "L"}${x(new Date(p.day).getTime()).toFixed(1)},${y(p.accuracy!).toFixed(1)}`
    )
    .join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Practice accuracy trend">
      {[0, 100].map((v) => (
        <g key={v}>
          <line x1={P.l} y1={y(v)} x2={W - P.r} y2={y(v)} stroke="var(--sf-border)" strokeWidth={1} />
          <text x={P.l - 6} y={y(v) + 3} textAnchor="end" fontSize={9} fill="var(--sf-ink-3)">
            {v}%
          </text>
        </g>
      ))}
      <line
        x1={P.l}
        y1={y(70)}
        x2={W - P.r}
        y2={y(70)}
        stroke="var(--sf-ink-2)"
        strokeWidth={1.5}
        strokeDasharray="5 4"
      />
      <text x={P.l - 6} y={y(70) + 3} textAnchor="end" fontSize={9} fontWeight={700} fill="var(--sf-ink-2)">
        70
      </text>

      {pts.length > 1 && (
        <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      )}

      {pts.map((p, i) => {
        const cx = x(new Date(p.day).getTime());
        const cy = y(p.accuracy!);
        return (
          <g key={p.day}>
            <circle
              cx={cx}
              cy={cy}
              r={12}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
            <circle
              cx={cx}
              cy={cy}
              r={hover === i ? r(p.answered) + 1.5 : r(p.answered)}
              fill={color}
              stroke="var(--sf-bg)"
              strokeWidth={1.5}
              pointerEvents="none"
            />
          </g>
        );
      })}

      <text x={W - P.r} y={H - 4} textAnchor="end" fontSize={9} fill="var(--sf-ink-3)">
        {hover !== null
          ? `${new Date(pts[hover].day).toLocaleDateString()} · ${pts[hover].correct}/${pts[hover].answered} · ${pts[hover].accuracy}%`
          : "dot size = items answered that day"}
      </text>
    </svg>
  );
}
