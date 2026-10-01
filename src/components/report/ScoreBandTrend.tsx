"use client";
import { useState } from "react";
import type { TrendPoint } from "@/lib/report";

/**
 * Fresh-score trend with its 90% margin. Full sittings are filled dots with a
 * whisker and a shaded band joining them; quick tests are hollow and carry no
 * band (~10 items — the whisker alone shows how little they say). Dashed 720 =
 * estimated cut, dotted 800 = likely-pass line. Replaces the raw-score line
 * (review finding A2): noise should read as noise, not progress.
 */
export function ScoreBandTrend({ points, color }: { points: TrendPoint[]; color: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 600;
  const H = 170;
  const P = { l: 34, r: 10, t: 12, b: 20 };
  if (points.length === 0) return <p className="py-6 text-center text-sm text-ink3">No sittings yet.</p>;

  const xs = points.map((p) => p.at.getTime());
  const minX = Math.min(...xs);
  const span = Math.max(1, Math.max(...xs) - minX);
  const x = (t: number) => (points.length === 1 ? (P.l + W - P.r) / 2 : P.l + ((t - minX) / span) * (W - P.l - P.r));
  const y = (v: number) => P.t + (1 - (Math.max(100, Math.min(1000, v)) - 100) / 900) * (H - P.t - P.b);

  const full = points.filter((p) => p.kind === "full" && p.margin !== null);
  const band =
    full.length > 1
      ? [
          ...full.map((p) => `${x(p.at.getTime()).toFixed(1)},${y(p.score + p.margin!).toFixed(1)}`),
          ...[...full].reverse().map((p) => `${x(p.at.getTime()).toFixed(1)},${y(p.score - p.margin!).toFixed(1)}`),
        ].join(" ")
      : null;
  const fullPts = points.filter((p) => p.kind === "full");
  const line = fullPts
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.at.getTime()).toFixed(1)},${y(p.score).toFixed(1)}`)
    .join(" ");

  const h = hover !== null ? points[hover] : null;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Fresh score trend with margin">
      {[100, 1000].map((v) => (
        <g key={v}>
          <line x1={P.l} y1={y(v)} x2={W - P.r} y2={y(v)} stroke="var(--sf-border)" strokeWidth={1} />
          <text x={P.l - 6} y={y(v) + 3} textAnchor="end" fontSize={9} fill="var(--sf-ink-3)">{v}</text>
        </g>
      ))}
      <line x1={P.l} y1={y(720)} x2={W - P.r} y2={y(720)} stroke="var(--sf-ink-2)" strokeWidth={1.5} strokeDasharray="5 4" />
      <text x={P.l - 6} y={y(720) + 3} textAnchor="end" fontSize={9} fontWeight={700} fill="var(--sf-ink-2)">720</text>
      <line x1={P.l} y1={y(800)} x2={W - P.r} y2={y(800)} stroke="var(--sf-good)" strokeWidth={1} strokeDasharray="1 3" />
      <text x={P.l - 6} y={y(800) + 3} textAnchor="end" fontSize={9} fill="var(--sf-good)">800</text>

      {band && <polygon points={band} fill={color} opacity={0.14} />}
      {fullPts.length > 1 && <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />}

      {points.map((p, i) => {
        const cx = x(p.at.getTime());
        const cy = y(p.score);
        return (
          <g key={i}>
            {p.margin !== null && (
              <line
                x1={cx}
                x2={cx}
                y1={y(p.score + p.margin)}
                y2={y(p.score - p.margin)}
                stroke={color}
                strokeWidth={p.kind === "full" ? 1.5 : 1}
                opacity={p.kind === "full" ? 0.8 : 0.45}
              />
            )}
            <circle cx={cx} cy={cy} r={12} fill="transparent" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
            <circle
              cx={cx}
              cy={cy}
              r={hover === i ? 5.5 : 4}
              fill={p.kind === "full" ? color : "var(--sf-bg)"}
              stroke={color}
              strokeWidth={p.kind === "full" ? 1 : 1.5}
              strokeDasharray={p.kind === "thin" ? "2 1.5" : undefined}
              pointerEvents="none"
            />
          </g>
        );
      })}
      <text x={W - P.r} y={H - 4} textAnchor="end" fontSize={9} fill="var(--sf-ink-3)">
        {h
          ? `${h.at.toLocaleDateString()} · ${h.kind === "thin" ? "full, few fresh items" : h.kind} · ${h.score}${h.margin !== null ? ` ±${h.margin}` : ""}${h.raw ? " (raw, no fresh tracking)" : " fresh"}`
          : "filled = full sim · hollow = quick test · dashed = <40 fresh items · band = 90% margin"}
      </text>
    </svg>
  );
}
