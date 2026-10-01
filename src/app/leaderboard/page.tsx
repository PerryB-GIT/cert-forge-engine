"use client";
import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import { EXAM_ORDER } from "@/lib/exams";
import { EXAM_COLORS } from "@/lib/ui";
import { retry } from "@/lib/retry";
import { useAsyncData } from "@/lib/useAsyncData";
import { LoadError } from "@/components/LoadError";
import {
  TABS,
  rankTab,
  bestFresh,
  unrankedReason,
  aliasError,
  type Board,
  type LeaderRow,
  type TabKey,
} from "@/lib/leaderboard";

/**
 * Opt-in leaderboard. Separate from the collaborative Scoreboard on purpose:
 * only people who join see it, it resets weekly, and it ranks three things
 * that reward effort and growth (improvement, retention, consistency) plus an
 * all-time best-score board — never one composite score.
 * Research: docs/gamification-research.md.
 */
export default function LeaderboardPage() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [weeksAgo, setWeeksAgo] = useState(0);
  const [tab, setTab] = useState<TabKey>("improvement");
  const [alias, setAlias] = useState("");
  const [editing, setEditing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Busy until a NEW board object arrives (reload() is fire-and-forget).
  const [busyFor, setBusyFor] = useState<Board | null>(null);

  const load = useCallback(
    () =>
      retry(async () => {
        const { data, error } = await supabase.rpc("cf_leaderboard_week", { p_weeks_ago: weeksAgo });
        if (error) throw error;
        return data as Board;
      }),
    [supabase, weeksAgo]
  );
  const { data: board, failed, reload } = useAsyncData(load);
  const busy = busyFor !== null && busyFor === board;

  if (failed) return <LoadError onRetry={reload} label="Couldn't load the leaderboard yet." />;
  if (!board) return <p className="py-16 text-center text-ink3">Loading leaderboard…</p>;

  async function updateProfile(patch: { leaderboard_opt_in?: boolean; leaderboard_alias?: string | null }) {
    setErr(null);
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("cf_profiles").update(patch).eq("id", u.user?.id);
    if (error) {
      setErr(error.code === "23505" ? "That alias is taken — pick another." : error.message);
      return false;
    }
    setBusyFor(board);
    reload();
    return true;
  }

  async function join() {
    const e = aliasError(alias);
    if (e) return setErr(e);
    await updateProfile({ leaderboard_opt_in: true, leaderboard_alias: alias.trim() });
  }

  async function saveAlias() {
    const e = aliasError(alias);
    if (e) return setErr(e);
    if (await updateProfile({ leaderboard_alias: alias.trim() })) setEditing(false);
  }

  if (!board.opted_in) {
    return (
      <div className="space-y-5">
        <Header />
        <section className="card p-5">
          <h2 className="font-bold">Join the opt-in leaderboard</h2>
          <p className="mt-1 text-sm text-ink2">
            Head-to-head, for people who want it. Anyone signed in to Cert Forge can join; members
            see each other&apos;s aliases and the numbers below, never real names. Leave at any time
            and you disappear from current and past boards immediately.
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-ink2">
            <li>Resets every Monday, so a late start is never locked out.</li>
            <li>
              Three separate boards that reward growth and effort — <b>Improvement</b>,{" "}
              <b>Retention</b>, <b>Consistency</b> — plus an <b>All-time</b> best-score board.
            </li>
            <li>
              Shared with members: your alias, improvement, retention %, qualified study days, weekly
              XP, best fresh score per exam, and number of likely-pass exams.
            </li>
            <li>Never shared: your answers, missed questions, or domain weaknesses.</li>
          </ul>
          <p className="mt-3 text-xs text-ink3">
            {board.members} member{board.members === 1 ? "" : "s"} so far.
          </p>
          <div className="mt-4 flex flex-wrap items-end gap-2">
            <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-ink3">
              Alias (required — shown instead of your name)
              <input
                value={alias}
                maxLength={24}
                onChange={(e) => setAlias(e.target.value)}
                placeholder="e.g. Falcon"
                className="rounded-lg border border-edge bg-surface2 px-3 py-2 text-sm text-ink"
              />
            </label>
            <button className="btn btn-primary" disabled={busy} onClick={join}>
              Join the leaderboard
            </button>
          </div>
          {err && <p className="mt-2 text-xs text-bad">{err}</p>}
        </section>
      </div>
    );
  }

  const rows = board.rows ?? [];
  const meta = TABS.find((t) => t.key === tab)!;
  const { ranked, unranked } = rankTab(rows, tab);
  const team = board.team ?? { qualified_days: 0, target: 0 };
  const teamPct = team.target > 0 ? Math.min(100, Math.round((100 * team.qualified_days) / team.target)) : 0;
  const me = rows.find((r) => r.is_me);
  const weekLabel = new Date(board.week_start + "T12:00:00").toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

  return (
    <div className="space-y-5">
      <Header />

      {/* team goal keeps the board competitive-collaborative */}
      <section className="card p-5">
        <div className="mb-1 flex flex-wrap justify-between gap-2 text-xs">
          <span className="text-ink2">
            Group study days {weeksAgo === 0 ? "this week" : "last week"} · week of {weekLabel}
          </span>
          <span className="font-mono font-bold">
            {team.qualified_days}/{team.target}
          </span>
        </div>
        <div className="h-3 w-full overflow-hidden rounded-full bg-surface2">
          <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${teamPct}%` }} />
        </div>
        <p className="mt-1 text-[11px] text-ink3">
          Target: 4 qualified days per member. Everyone&apos;s study fills the same bar.
        </p>
      </section>

      {/* tabs + week toggle */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                tab === t.key ? "bg-accent text-white" : "bg-surface2 text-ink2 hover:text-ink"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        {meta.weekly && (
          <div className="flex gap-1 text-xs">
            {[0, 1].map((w) => (
              <button
                key={w}
                onClick={() => setWeeksAgo(w)}
                className={`rounded-md px-2.5 py-1 ${
                  weeksAgo === w ? "bg-surface2 font-semibold text-ink" : "text-ink3 hover:text-ink2"
                }`}
              >
                {w === 0 ? "This week" : "Last week"}
              </button>
            ))}
          </div>
        )}
      </div>
      <p className="text-xs text-ink3">{meta.note}</p>

      <section className="space-y-2">
        {ranked.length === 0 && (
          <p className="card p-5 text-center text-sm text-ink3">Nobody is ranked on this board yet.</p>
        )}
        {ranked.map(({ rank, row }) => (
          <Row key={`r-${row.name}`} row={row} tab={tab}>
            <span className="w-8 shrink-0 text-center font-mono text-lg font-black tabular-nums text-ink2">
              {rank}
            </span>
          </Row>
        ))}
        {unranked.length > 0 && (
          <>
            <p className="pt-2 text-[11px] font-semibold uppercase tracking-wide text-ink3">
              Not ranked yet
            </p>
            {unranked.map((row) => (
              <Row key={`u-${row.name}`} row={row} tab={tab} reason={unrankedReason(row, tab)}>
                <span className="w-8 shrink-0 text-center text-ink3">—</span>
              </Row>
            ))}
          </>
        )}
      </section>

      {/* your settings */}
      <section className="card p-5">
        <h2 className="text-sm font-bold">Your leaderboard settings</h2>
        <p className="mt-1 text-xs text-ink3">
          Showing as <b className="text-ink2">{me?.name ?? "you"}</b>.
        </p>
        {editing ? (
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <input
              value={alias}
              maxLength={24}
              onChange={(e) => setAlias(e.target.value)}
              placeholder="Alias (2–24 characters)"
              className="min-w-0 flex-1 rounded-lg border border-edge bg-surface2 px-3 py-2 text-sm text-ink"
            />
            <button className="btn btn-primary text-sm" disabled={busy} onClick={saveAlias}>
              Save
            </button>
            <button className="btn btn-ghost text-sm" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className="btn btn-ghost text-sm"
              onClick={() => {
                setAlias(me?.name ?? "");
                setEditing(true);
              }}
            >
              Change alias
            </button>
            <button
              className="btn btn-ghost text-sm"
              disabled={busy}
              onClick={() => updateProfile({ leaderboard_opt_in: false })}
            >
              Leave leaderboard
            </button>
          </div>
        )}
        <p className="mt-2 text-[11px] text-ink3">
          Leaving removes you from this week&apos;s and all past boards immediately. Your own study
          record is unaffected.
        </p>
        {err && <p className="mt-2 text-xs text-bad">{err}</p>}
      </section>
    </div>
  );
}

function Header() {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Leaderboard</h1>
      <p className="text-sm text-ink2">
        Opt-in, weekly, and fair: ranked on growth, retention, and consistency — not on who started
        first. Prefer a shared goal with no rankings? See the{" "}
        <Link href="/scoreboard" className="text-accenthi underline">
          Scoreboard
        </Link>
        .
      </p>
    </div>
  );
}

function metricText(r: LeaderRow, tab: TabKey): string {
  switch (tab) {
    case "improvement":
      return r.improvement === null ? "—" : `${r.improvement >= 0 ? "+" : ""}${r.improvement}`;
    case "retention":
      return r.retention_pct === null ? "—" : `${r.retention_pct}%`;
    case "consistency":
      return `${r.qualified_days}/7`;
    case "alltime": {
      const b = bestFresh(r);
      return b === null ? "—" : String(b);
    }
  }
}

function subText(r: LeaderRow, tab: TabKey): string {
  switch (tab) {
    case "improvement":
      return r.improvement_exam ? `on ${r.improvement_exam}` : "";
    case "retention":
      return `${r.retention_n} review answers`;
    case "consistency":
      return "qualified days";
    case "alltime":
      return `${r.likely_passes} likely pass${r.likely_passes === 1 ? "" : "es"}`;
  }
}

function Row({
  row,
  tab,
  reason,
  children,
}: {
  row: LeaderRow;
  tab: TabKey;
  reason?: string;
  children: React.ReactNode;
}) {
  const sub = reason ?? subText(row, tab);
  return (
    <div className={`card flex items-center gap-3 p-3 ${row.is_me ? "outline outline-2 outline-accent" : ""}`}>
      {children}
      <div className="min-w-0 flex-1">
        <p className="truncate font-bold">
          {row.name}
          {row.is_me && <span className="ml-2 text-xs font-semibold text-accenthi">you</span>}
        </p>
        <p className="truncate text-[11px] text-ink3">
          {sub ? `${sub} · ` : ""}
          {row.xp_week} XP this week
        </p>
        {tab === "alltime" && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {EXAM_ORDER.map((code) => (
              <span
                key={code}
                className="rounded border border-edge bg-surface2 px-1.5 py-0.5 font-mono text-[10px] text-ink2"
                style={{ borderBottomColor: EXAM_COLORS[code], borderBottomWidth: 2 }}
                title={`${code} best fresh score`}
              >
                {code} {row.best?.[code] ?? "—"}
              </span>
            ))}
          </div>
        )}
      </div>
      <span className="shrink-0 text-right font-mono text-lg font-black tabular-nums">
        {metricText(row, tab)}
      </span>
    </div>
  );
}
