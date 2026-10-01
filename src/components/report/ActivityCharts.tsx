"use client";
import { useState } from "react";
import { EXAM_COLORS } from "@/lib/ui";
import { calibration, type CalibrationRow, type WeeklyRow } from "@/lib/report";

const fmtDay = (d: string, opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" }) =>
  new Date(d.slice(0, 10) + "T12:00:00").toLocaleDateString(undefined, opts);

/** Last 12 weeks: stacked practice / flashcards / sim items + qualified-day dots. */
export function WeeklyVolume({ rows }: { rows: WeeklyRow[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 600;
  const H = 150;
  const P = { l: 30, r: 8, t: 16, b: 24 };
  const total = (r: WeeklyRow) => r.practice + r.flashcards + r.sim_items;
  const max = Math.max(10, ...rows.map(total));
  const bw = (W - P.l - P.r) / Math.max(1, rows.length);
  const y = (v: number) => P.t + (1 - v / max) * (H - P.t - P.b);
  const seg = [
    { k: "practice" as const, c: "var(--sf-accent)" },
    { k: "flashcards" as const, c: "var(--sf-accent-hi)" },
    { k: "sim_items" as const, c: "var(--sf-ink-3)" },
  ];
  const h = hover !== null ? rows[hover] : null;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Weekly study volume">
      <line x1={P.l} y1={y(0)} x2={W - P.r} y2={y(0)} stroke="var(--sf-border)" />
      <text x={P.l - 5} y={y(max) + 3} textAnchor="end" fontSize={9} fill="var(--sf-ink-3)">{max}</text>
      {rows.map((r, i) => {
        let acc = 0;
        const x0 = P.l + i * bw + bw * 0.15;
        return (
          <g key={r.week} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <rect x={P.l + i * bw} y={P.t} width={bw} height={H - P.t - P.b} fill="transparent" />
            {seg.map((s) => {
              const v = r[s.k];
              if (!v) return null;
              const top = y(acc + v);
              const el = (
                <rect key={s.k} x={x0} y={top} width={bw * 0.7} height={y(acc) - top} fill={s.c} opacity={hover === i ? 1 : 0.85} />
              );
              acc += v;
              return el;
            })}
            {Array.from({ length: r.qualified_days }).map((_, d) => (
              <circle key={d} cx={x0 + 3 + d * ((bw * 0.7 - 6) / 6)} cy={H - P.b + 6} r={1.6} fill="var(--sf-good)" />
            ))}
            {i % 2 === (rows.length - 1) % 2 && (
              <text x={x0 + bw * 0.35} y={H - 3} textAnchor="middle" fontSize={8} fill="var(--sf-ink-3)">
                {fmtDay(r.week)}
              </text>
            )}
          </g>
        );
      })}
      <text x={W - P.r} y={10} textAnchor="end" fontSize={9} fill="var(--sf-ink-3)">
        {h
          ? `wk of ${fmtDay(h.week)} · ${h.practice} practice · ${h.flashcards} cards · ${h.sim_items} sim items · ${h.qualified_days} study days`
          : "dark = practice · light = flashcards · grey = sim items · green dots = qualified study days"}
      </text>
    </svg>
  );
}

/** Reviews coming due over the next 14 days — framed as a plan, not decay. */
export function DueForecast({ rows }: { rows: { day: string; due: number }[] }) {
  const max = Math.max(5, ...rows.map((r) => r.due));
  return (
    <div>
      <div className="flex h-20 items-end gap-1">
        {rows.map((r, i) => (
          <div
            key={r.day}
            className="flex flex-1 flex-col items-center justify-end"
            title={`${fmtDay(r.day, { weekday: "short", month: "short", day: "numeric" })}: ${r.due} due`}
          >
            <span className="mb-0.5 font-mono text-[9px] text-ink3">{r.due || ""}</span>
            <div
              className="w-full rounded-t"
              style={{
                height: `${(r.due / max) * 60}px`,
                minHeight: r.due ? 2 : 0,
                background: i === 0 ? "var(--sf-accent)" : "var(--sf-ink-3)",
              }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[9px] text-ink3">
        <span>today (incl. overdue)</span>
        <span>{rows.length ? fmtDay(rows[rows.length - 1].day) : ""}</span>
      </div>
    </div>
  );
}

export type PaceRow = {
  id: string;
  exam_code: string;
  mode: string;
  at: string;
  used_min: number;
  allowed_min: number;
  items: number;
};

/** Time used vs allowed per sitting, newest last. */
export function PaceChart({ rows }: { rows: PaceRow[] }) {
  if (rows.length === 0) return <p className="py-4 text-center text-sm text-ink3">No timed sittings yet.</p>;
  return (
    <div className="space-y-1.5">
      {rows.slice(-8).map((r) => {
        const pct = r.allowed_min > 0 ? Math.min(100, (100 * r.used_min) / r.allowed_min) : 0;
        const perItem = r.items > 0 ? Math.round((60 * r.used_min) / r.items) : null;
        return (
          <div key={r.id} className="text-xs">
            <div className="mb-0.5 flex justify-between gap-2">
              <span className="truncate text-ink2">
                <b style={{ color: EXAM_COLORS[r.exam_code] }}>{r.exam_code}</b> {r.mode} · {fmtDay(r.at)}
              </span>
              <span className="shrink-0 font-mono tabular-nums text-ink3">
                {Math.round(r.used_min)}/{Math.round(r.allowed_min)} min{perItem !== null ? ` · ${perItem}s/item` : ""}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-surface2">
              <div
                className="h-full rounded-full"
                style={{ width: `${pct}%`, background: pct > 95 ? "var(--sf-warn)" : EXAM_COLORS[r.exam_code] }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Confidence vs actual accuracy from the optional practice confidence tap. */
export function CalibrationChart({ rows }: { rows: CalibrationRow[] }) {
  const c = calibration(rows);
  const total = c.reduce((a, r) => a + r.n, 0);
  if (total === 0)
    return (
      <p className="py-4 text-center text-sm text-ink3">
        Tap “How sure are you?” in practice to see whether your confidence matches your accuracy.
      </p>
    );
  const label = ["Guessing", "Fairly sure", "Certain"];
  return (
    <div className="space-y-2">
      {c.map((r, i) => (
        <div key={r.confidence} className="text-xs">
          <div className="mb-0.5 flex justify-between gap-2">
            <span className="text-ink2">
              {label[i]} <span className="text-ink3">· {r.n} answer{r.n === 1 ? "" : "s"}</span>
            </span>
            <span className="font-mono tabular-nums">
              {r.pct === null ? "—" : `${r.pct}%`}
              {r.gap !== null && Math.abs(r.gap) >= 10 && r.n >= 5 && (
                <span className={r.gap < 0 ? "text-warn" : "text-good"}>
                  {" "}
                  {r.gap < 0 ? "overconfident" : "underconfident"}
                </span>
              )}
            </span>
          </div>
          <div className="relative h-2 rounded-full bg-surface2">
            {r.pct !== null && <div className="h-full rounded-full bg-accent" style={{ width: `${r.pct}%` }} />}
            <div
              className="absolute -inset-y-0.5 w-0.5 bg-ink"
              style={{ left: `${r.expected}%` }}
              title={`well calibrated ≈ ${r.expected}%`}
            />
          </div>
        </div>
      ))}
      <p className="text-[10px] text-ink3">
        Bar = how often you were right · tick = what that confidence should mean. Overconfidence is the trap that ends
        studying too early.
      </p>
    </div>
  );
}
