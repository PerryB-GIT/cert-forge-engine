"use client";
import { useState } from "react";

/**
 * Scaled-score trend over time (one line, 100–1000 y-scale, 720 cut rule).
 * 2px line, ≥8px hover targets, crosshair tooltip per dataviz spec.
 */
export function TrendLine({
  points,
  color = "var(--sf-accent)",
}: {
  points: { at: Date; scaled: number; kind?: "full" | "quick" }[];
  color?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 600;
  const H = 160;
  const P = { l: 34, r: 10, t: 12, b: 20 };
  if (points.length === 0)
    return <p className="py-6 text-center text-sm text-ink3">No scores logged yet.</p>;

  const xs = points.map((p) => p.at.getTime());
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const spanX = Math.max(1, maxX - minX);
  const x = (t: number) => P.l + ((t - minX) / spanX) * (W - P.l - P.r);
  const y = (v: number) => P.t + (1 - (v - 100) / 900) * (H - P.t - P.b);

  const d = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.at.getTime()).toFixed(1)},${y(p.scaled).toFixed(1)}`)
    .join(" ");

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Scaled score trend">
      {/* recessive grid: 100 / 720 / 1000 */}
      {[100, 1000].map((v) => (
        <g key={v}>
          <line x1={P.l} y1={y(v)} x2={W - P.r} y2={y(v)} stroke="var(--sf-border)" strokeWidth={1} />
          <text x={P.l - 6} y={y(v) + 3} textAnchor="end" fontSize={9} fill="var(--sf-ink-3)">{v}</text>
        </g>
      ))}
      {/* 720 cut rule */}
      <line x1={P.l} y1={y(720)} x2={W - P.r} y2={y(720)} stroke="var(--sf-ink-2)" strokeWidth={1.5} strokeDasharray="5 4" />
      <text x={P.l - 6} y={y(720) + 3} textAnchor="end" fontSize={9} fontWeight={700} fill="var(--sf-ink-2)">720</text>

      <path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

      {points.map((p, i) => (
        <g key={i}>
          {/* oversized hover target */}
          <circle
            cx={x(p.at.getTime())}
            cy={y(p.scaled)}
            r={12}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          />
          <circle
            cx={x(p.at.getTime())}
            cy={y(p.scaled)}
            r={hover === i ? 5 : 3.5}
            fill={p.kind === "quick" ? "var(--sf-bg)" : color}
            stroke={p.kind === "quick" ? color : "var(--sf-bg)"}
            strokeWidth={2}
            pointerEvents="none"
          />
          {(hover === i || i === points.length - 1) && (
            <text
              x={Math.min(W - P.r - 4, Math.max(P.l + 4, x(p.at.getTime())))}
              y={y(p.scaled) - 10}
              textAnchor="middle"
              fontSize={11}
              fontWeight={700}
              fill="var(--sf-ink)"
              pointerEvents="none"
            >
              {p.scaled}
            </text>
          )}
        </g>
      ))}
      {hover !== null && (
        <text x={W - P.r} y={H - 6} textAnchor="end" fontSize={9} fill="var(--sf-ink-3)">
          {points[hover].at.toLocaleDateString()} · {points[hover].scaled}
          {points[hover].kind === "quick" ? " · quick" : points[hover].kind === "full" ? " · full" : ""}
        </text>
      )}
    </svg>
  );
}
