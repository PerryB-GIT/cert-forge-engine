import { useState } from "react";
import { levelProgress } from "@/lib/report";

export type Gamification = {
  xp: { total: number; week: number; today: number; level: number; floor: number; next: number };
  streak: {
    current: number;
    best: number;
    freezes_banked: number;
    freezes_used: number;
    qualified_weeks: number;
  };
  quest: {
    week_start: string;
    active: { key: string; label: string; target: number; progress: number } | null;
    options: { key: string; label: string; target: number; unit: string }[] | null;
  };
  badges: { key: string; label: string; desc: string; value: number; tiers: number[]; tier: number }[];
};

const TIER = ["—", "Bronze", "Silver", "Gold"];
const TIER_COLOR = ["var(--sf-ink-3)", "#b87333", "#c0c0c0", "#e5b93c"];

/**
 * XP / level, the forgiving streak, this week's chosen quest, and tiered
 * badges. Everything is derived server-side by cf_gamification from real
 * study (graded, de-duplicated, capped) — see the migration header.
 */
export function GamePanel({
  g,
  onChooseQuest,
}: {
  g: Gamification;
  onChooseQuest: (key: string) => Promise<string | null>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const lp = levelProgress(g.xp);
  const q = g.quest.active;

  async function choose(key: string) {
    setBusy(key);
    setErr(await onChooseQuest(key));
    setBusy(null);
  }

  return (
    <section className="card p-5">
      <div className="grid gap-5 md:grid-cols-3">
        {/* level */}
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink3">Level</p>
          <p className="mt-1 text-3xl font-black tabular-nums">
            {g.xp.level}
            <span className="ml-2 text-sm font-semibold text-ink3">{g.xp.total.toLocaleString()} XP</span>
          </p>
          <div className="mt-2 h-2 rounded-full bg-surface2" title={`${g.xp.next - g.xp.total} XP to level ${g.xp.level + 1}`}>
            <div className="h-full rounded-full bg-accent" style={{ width: `${lp}%` }} />
          </div>
          <p className="mt-1 text-[11px] text-ink3">
            {g.xp.next - g.xp.total} to level {g.xp.level + 1} · +{g.xp.week} this week · +{g.xp.today} today
          </p>
          <p className="mt-1 text-[10px] text-ink3">
            Each item counts once a day; practice XP caps at 300/day. Retrieval, not clicking, levels you up.
          </p>
        </div>

        {/* streak */}
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink3">Study streak</p>
          <p className="mt-1 text-3xl font-black tabular-nums">
            {g.streak.current}
            <span className="ml-2 text-sm font-semibold text-ink3">day{g.streak.current === 1 ? "" : "s"} · best {g.streak.best}</span>
          </p>
          <p className="mt-2 text-sm">
            {[0, 1].map((i) => (
              <span
                key={i}
                className={`mr-1 inline-block rounded px-1.5 py-0.5 text-xs font-semibold ${
                  i < g.streak.freezes_banked ? "bg-accent/20 text-accenthi" : "bg-surface2 text-ink3"
                }`}
              >
                ❄ freeze
              </span>
            ))}
          </p>
          <p className="mt-1 text-[10px] text-ink3">
            A day counts with 5+ different practice items graded, or a sim with at least half the items answered.
            Each finished week with 3+ study days banks a freeze (max 2); freezes are spent automatically when they
            cover the whole gap. {g.streak.freezes_used > 0 && `${g.streak.freezes_used} used so far.`}
          </p>
        </div>

        {/* quest */}
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-ink3">This week&apos;s quest</p>
          {q ? (
            <>
              <p className="mt-1 text-sm font-semibold">{q.label}</p>
              <div className="mt-2 h-2 rounded-full bg-surface2">
                <div
                  className={`h-full rounded-full ${q.progress >= q.target ? "bg-good" : "bg-accent"}`}
                  style={{ width: `${Math.min(100, (100 * q.progress) / q.target)}%` }}
                />
              </div>
              <p className="mt-1 text-[11px] text-ink3">
                {Math.min(q.progress, q.target)}/{q.target}
                {q.progress >= q.target ? " · complete, +150 XP" : " · resets Monday, no penalty for missing"}
              </p>
            </>
          ) : (
            <>
              <p className="mt-1 text-[11px] text-ink3">Pick one goal for this week (+150 XP when done):</p>
              <div className="mt-2 space-y-1.5">
                {(g.quest.options ?? []).map((o) => (
                  <button
                    key={o.key}
                    disabled={busy !== null}
                    onClick={() => choose(o.key)}
                    className="block w-full rounded-lg border border-edge bg-surface2 px-3 py-1.5 text-left text-xs transition hover:border-accent disabled:opacity-60"
                  >
                    {busy === o.key ? "Choosing…" : o.label}
                  </button>
                ))}
              </div>
              {err && <p className="mt-1 text-[11px] text-bad">{err}</p>}
            </>
          )}
        </div>
      </div>

      {/* tiered badges */}
      <div className="mt-5 border-t border-edge pt-4">
        <p className="mb-2 text-xs font-semibold text-ink2">Badges — bronze, silver, gold</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {g.badges.map((b) => {
            const next = b.tier < 3 ? b.tiers[b.tier] : null;
            const prev = b.tier > 0 ? b.tiers[b.tier - 1] : 0;
            const pct = next === null ? 100 : Math.min(100, (100 * (b.value - prev)) / Math.max(1, next - prev));
            return (
              <div key={b.key} className="rounded-lg border border-edge bg-surface2 px-3 py-2" title={b.desc}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm font-semibold">{b.label}</span>
                  <span className="shrink-0 text-[11px] font-bold" style={{ color: TIER_COLOR[b.tier] }}>
                    {b.tier > 0 ? "● " : ""}
                    {TIER[b.tier]}
                  </span>
                </div>
                <p className="truncate text-[10px] text-ink3">{b.desc}</p>
                <div className="mt-1.5 h-1 rounded-full bg-surface">
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: TIER_COLOR[Math.min(3, b.tier + 1)] }} />
                </div>
                <p className="mt-0.5 text-[10px] text-ink3">
                  {b.value}
                  {next !== null ? ` / ${next} for ${TIER[b.tier + 1]}` : " · maxed"}
                </p>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
