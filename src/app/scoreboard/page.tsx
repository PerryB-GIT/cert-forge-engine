"use client";
import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import { EXAM_ORDER } from "@/lib/exams";
import { EXAM_COLORS } from "@/lib/ui";
import { retry } from "@/lib/retry";
import { useAsyncData } from "@/lib/useAsyncData";
import { LoadError } from "@/components/LoadError";

type Member = {
  display_name: string;
  is_me: boolean;
  ready_count: number;
  total_scaled: number;
  badge_count: number;
  per_exam: Record<string, number>;
  /** Exams with a likely-pass sitting on 40+ fresh items (same rule as the Report Card). */
  ready_exams: string[];
};
type Board = {
  me: Omit<Member, "is_me"> | null;
  opted_in: boolean;
  /** Null when the caller isn't sharing — the server no longer sends group data to non-sharers. */
  team: { members: number; exams_ready: number; exams_possible: number; badges: number } | null;
  roster: Member[];
};

export default function ScoreboardPage() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  // Busy until a NEW board object arrives (reload() is fire-and-forget).
  const [busyFor, setBusyFor] = useState<Board | null>(null);

  const load = useCallback(
    () =>
      retry(async () => {
        const { data, error } = await supabase.rpc("cf_scoreboard");
        if (error) throw error;
        return data as Board;
      }),
    [supabase]
  );
  const { data: board, failed, reload } = useAsyncData(load);
  const busy = busyFor !== null && busyFor === board;

  if (failed) return <LoadError onRetry={reload} />;

  async function toggleShare(next: boolean) {
    setBusyFor(board);
    const { data: u } = await supabase.auth.getUser();
    await supabase.from("cf_profiles").update({ share_scores: next }).eq("id", u.user?.id);
    reload();
  }

  if (!board) return <p className="py-16 text-center text-ink3">Loading…</p>;

  const teamPct =
    board.team && board.team.exams_possible > 0
      ? Math.round((board.team.exams_ready / board.team.exams_possible) * 100)
      : 0;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Scoreboard</h1>
        <p className="text-sm text-ink2">
          A shared goal, not a public ranking. Your scores stay private until you choose to share
          them — and when you do, you join the group&apos;s progress toward getting everyone
          certified. No one is publicly ranked from top to bottom.
        </p>
      </div>

      {/* your standing — always private, always visible to you */}
      {board.me && (
        <section className="card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-bold">
                You — {board.me.display_name}
                <span className="ml-2 text-xs font-normal text-ink3">
                  {board.opted_in ? "sharing with the group" : "private"}
                </span>
              </h2>
              <p className="text-xs text-ink3">
                {board.me.ready_count}/4 exams ready · {board.me.total_scaled} total scaled ·{" "}
                {board.me.badge_count} badge{board.me.badge_count === 1 ? "" : "s"}
              </p>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <span className="text-ink2">Share with the group</span>
              <input
                type="checkbox"
                checked={board.opted_in}
                disabled={busy}
                onChange={(e) => toggleShare(e.target.checked)}
              />
            </label>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {EXAM_ORDER.map((code) => {
              const s = board.me!.per_exam?.[code];
              const ready = board.me!.ready_exams?.includes(code) ?? false;
              return (
                <div
                  key={code}
                  className="rounded-lg border border-edge bg-surface2 px-2.5 py-2"
                  style={{ borderLeftColor: EXAM_COLORS[code], borderLeftWidth: 3 }}
                >
                  <p className="text-[10px] font-semibold tracking-wide text-ink3">{code}</p>
                  <p
                    className={`font-mono text-sm font-bold tabular-nums ${
                      s === undefined ? "text-ink3" : ready ? "text-good" : "text-ink"
                    }`}
                  >
                    {s === undefined ? "—" : s}
                    {ready && " ✓"}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* team progress — collaboration */}
      {board.opted_in && board.team ? (
        <section className="card p-5">
          <h2 className="font-bold">Group progress</h2>
          <p className="text-xs text-ink3">
            {board.team.members} teammate{board.team.members === 1 ? "" : "s"} sharing ·{" "}
            {board.team.exams_ready} of {board.team.exams_possible} possible credentials ready ·{" "}
            {board.team.badges} badges earned together
          </p>
          <div className="mt-3">
            <div className="mb-1 flex justify-between text-xs">
              <span className="text-ink2">Everyone certified on all four</span>
              <span className="font-mono font-bold">{teamPct}%</span>
            </div>
            <div className="h-3 w-full overflow-hidden rounded-full bg-surface2">
              <div
                className="h-full rounded-full bg-accent transition-all"
                style={{ width: `${teamPct}%` }}
              />
            </div>
          </div>
        </section>
      ) : (
        <section className="card border-dashed p-5 text-center">
          <p className="text-sm text-ink2">
            You&apos;re private. Turn on sharing above to compare with teammates and add your
            progress to the group goal.
          </p>
        </section>
      )}

      <p className="text-sm text-ink2">
        Want head-to-head?{" "}
        <Link href="/leaderboard" className="text-accenthi underline">
          Join the opt-in leaderboard
        </Link>
        .
      </p>

      {/* peer roster — opted-in only, no rank numbers */}
      {board.opted_in && board.roster.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-ink2">Study peers ({board.roster.length})</h2>
          {board.roster.map((m) => (
            <div
              key={m.display_name + (m.is_me ? "-me" : "")}
              className={`card p-4 ${m.is_me ? "outline outline-2 outline-accent" : ""}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-bold">
                    {m.display_name}
                    {m.is_me && (
                      <span className="ml-2 text-xs font-semibold text-accenthi">you</span>
                    )}
                  </p>
                  <p className="text-xs text-ink3">
                    {m.ready_count}/4 ready · {m.badge_count} badge
                    {m.badge_count === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="flex gap-1.5">
                  {EXAM_ORDER.map((code) => {
                    const s = m.per_exam?.[code];
                    const ready = m.ready_exams?.includes(code) ?? false;
                    return (
                      <div
                        key={code}
                        className="flex h-8 w-9 flex-col items-center justify-center rounded border border-edge bg-surface2"
                        style={{ borderBottomColor: EXAM_COLORS[code], borderBottomWidth: 2 }}
                        title={`${code}: ${s ?? "—"}`}
                      >
                        <span className={`text-[10px] font-bold ${ready ? "text-good" : "text-ink3"}`}>
                          {ready ? "✓" : s === undefined ? "—" : "•"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ))}
          <p className="text-[11px] text-ink3">
            Peers are listed to find study partners and celebrate progress — not ranked first to
            last. A checkmark means a likely-pass sitting on fresh items; a dot means a fresh
            full-sim score below that.
          </p>
        </section>
      )}
    </div>
  );
}
