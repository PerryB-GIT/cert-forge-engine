"use client";
import { useCallback, useMemo } from "react";
import { useAsyncData } from "@/lib/useAsyncData";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import { EXAMS } from "@/lib/exams";
import { EXAM_COLORS } from "@/lib/ui";
import { retry } from "@/lib/retry";
import { LoadError } from "@/components/LoadError";
import { Gauge } from "@/components/Gauge";
import { DomainBars } from "@/components/DomainBars";
import { ScoreBandTrend } from "@/components/report/ScoreBandTrend";
import { ReadinessStrip } from "@/components/report/ReadinessStrip";
import { DomainGap } from "@/components/report/DomainGap";
import {
  WeeklyVolume,
  DueForecast,
  PaceChart,
  CalibrationChart,
  type PaceRow,
} from "@/components/report/ActivityCharts";
import { GamePanel, type Gamification } from "@/components/report/GamePanel";
import {
  bestSitting,
  bestWeek,
  displayScore,
  trendSeries,
  type CalibrationRow,
  type WeeklyRow,
} from "@/lib/report";
import { AccuracyTrend } from "@/components/AccuracyTrend";
import { DomainHeatmap, type HeatRow } from "@/components/DomainHeatmap";
import { countByStatus, groupByDomain, type MissedItem } from "@/lib/missed";

type DomScore = { correct: number; total: number; pct: number };

/** Per-exam practice rollup from the cf_practice_stats RPC. */
type PracticeStats = {
  sessions: number;
  answered: number;
  correct: number;
  accuracy: number | null;
  distinct_items: number;
  missed_items: number;
  flashcards_reviewed: number;
  due: number;
  domains: { domain: string; answered: number; correct: number; accuracy: number | null; missed: number }[];
  recent: { id: string; at: string; answered: number; correct: number }[];
  daily: { day: string; answered: number; correct: number; accuracy: number | null }[];
};
type Session = {
  id: string;
  exam_code: string;
  mode: "full" | "quick" | "holdout";
  scaled_score: number;
  weighted_pct: number;
  passed: boolean;
  fresh_items: number | null;
  fresh_scaled: number | null;
  domain_scores: Record<string, DomScore>;
  proctor_events: unknown[];
  submitted_at: string;
};

type Extras = {
  weekly: WeeklyRow[];
  due_forecast: { day: string; due: number }[];
  pace: PaceRow[];
  calibration: CalibrationRow[];
};

type Mastery = Record<
  string,
  { domain: string; total: number; seen: number; coverage: number | null; retention: number }[]
>;

export default function ReportCardPage() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const load = useCallback(
    () =>
      retry(async () => {
        const { data: u } = await supabase.auth.getUser();
        const uid = u.user?.id;
        if (!uid) throw new Error("no-session");
        const [
          { data: prof },
          { data: sess, error: e1 },
          { data: mast, error: e2 },
          { data: prac, error: e3 },
          { data: miss, error: e4 },
          { data: game, error: e5 },
          { data: extras, error: e6 },
        ] = await Promise.all([
          supabase.from("cf_profiles").select("display_name").eq("id", uid).maybeSingle(),
          supabase
            .from("cf_exam_sessions")
            .select(
              "id, exam_code, mode, scaled_score, weighted_pct, passed, domain_scores, proctor_events, submitted_at, fresh_items, fresh_scaled"
            )
            .not("submitted_at", "is", null)
            .order("submitted_at", { ascending: true }),
          supabase.rpc("cf_domain_mastery"),
          supabase.rpc("cf_practice_stats"),
          supabase.rpc("cf_missed_items", { p_exam: null }),
          supabase.rpc("cf_gamification"),
          supabase.rpc("cf_report_extras"),
        ]);
        // Gamification and extras are optional panels: if either fails, the core
        // report still renders and that panel is simply omitted.
        if (e1 || e2 || e3 || e4) throw e1 ?? e2 ?? e3 ?? e4;
        return {
          name: (prof as { display_name: string } | null)?.display_name ?? "You",
          sessions: (sess as Session[]) ?? [],
          mastery: (mast as Mastery) ?? {},
          practice: (prac as Record<string, PracticeStats>) ?? {},
          missed: (miss as MissedItem[]) ?? [],
          game: e5 ? null : (game as Gamification),
          extras: e6 ? null : (extras as Extras),
        };
      }),
    [supabase]
  );
  const { data, failed, reload } = useAsyncData(load);

  if (failed) return <LoadError onRetry={reload} label="Couldn't load your report card yet." />;
  if (data === null) return <p className="py-16 text-center text-ink3">Loading report card…</p>;

  const { name, sessions, mastery, practice, missed, game, extras } = data;

  async function chooseQuest(key: string): Promise<string | null> {
    const { error } = await supabase.rpc("cf_choose_quest", { p_key: key });
    if (error) return error.message;
    reload();
    return null;
  }

  const full = sessions.filter((s) => s.mode !== "quick");
  const quick = sessions.filter((s) => s.mode === "quick");
  // "Passed" and "best" only count trustworthy reads: full/go-no-go sittings
  // scored on 40+ fresh items (passed = likely pass, set server-side). Quick
  // tests and repeat-heavy re-sits no longer inflate either.
  const passedExams = new Set(sessions.filter((s) => s.passed).map((s) => s.exam_code));
  const bestOf = (list: Session[]) => bestSitting(list);
  const bestOverall = bestOf(sessions)?.fresh_scaled ?? null;
  const bestPerExam = Object.fromEntries(
    EXAMS.map((e) => {
      const b = bestOf(sessions.filter((s) => s.exam_code === e.code));
      return [e.code, b ? { score: b.fresh_scaled!, items: b.fresh_items! } : null];
    })
  );
  const topWeek = extras ? bestWeek(extras.weekly) : null;

  // Practice totals across all four exams.
  const pracRows = Object.values(practice);
  const pAnswered = pracRows.reduce((n, p) => n + p.answered, 0);
  const pCorrect = pracRows.reduce((n, p) => n + p.correct, 0);
  const pSessions = pracRows.reduce((n, p) => n + p.sessions, 0);
  const pDue = pracRows.reduce((n, p) => n + p.due, 0);
  const pCards = pracRows.reduce((n, p) => n + p.flashcards_reviewed, 0);
  const missSplit = countByStatus(missed);

  const nothingYet =
    sessions.length === 0 &&
    pAnswered === 0 &&
    !Object.values(mastery).some((rows) => rows.some((m) => m.seen > 0));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Report Card</h1>
        <p className="text-sm text-ink2">
          {name}&apos;s complete study record — every full exam, quick test, and practice set,
          scored and graphed. Full exams drive your{" "}
          <Link href="/" className="text-accenthi underline">
            Readiness
          </Link>
          ; quick tests and practice are diagnostics that live here.
        </p>
      </div>

      {/* summary tiles — testing on the first row, practice on the second */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Tests taken" value={String(sessions.length)} sub={`${full.length} full · ${quick.length} quick`} />
        <Tile
          label="Best fresh score"
          value={bestOverall === null ? "—" : String(bestOverall)}
          sub="full sims, 40+ fresh items"
        />
        <Tile label="Likely passes" value={`${passedExams.size}/4`} sub="800+ on fresh items, margin ≥720" />
        <Tile
          label="Clean pace"
          value={
            sessions.length === 0
              ? "—"
              : sessions.filter((s) => (s.proctor_events?.length ?? 0) === 0).length + "/" + sessions.length
          }
          sub="0 proctor flags"
        />
        <Tile
          label="Practice answered"
          value={String(pAnswered)}
          sub={`${pSessions} set${pSessions === 1 ? "" : "s"}${
            pCards ? ` · ${pCards} card${pCards === 1 ? "" : "s"}` : ""
          }`}
        />
        <Tile
          label="Practice accuracy"
          value={pAnswered ? `${Math.round((100 * pCorrect) / pAnswered)}%` : "—"}
          sub={pAnswered ? `${pCorrect} of ${pAnswered} graded` : "graded practice only"}
        />
        <Tile
          label="Still missing"
          value={String(missSplit.shaky)}
          sub={`${missSplit.recovered} recovered`}
        />
        <Tile label="Due for review" value={String(pDue)} sub="spaced-review queue" />
      </div>

      {(missSplit.shaky > 0 || pDue > 0) && (
        <div className="flex flex-wrap gap-2">
          <Link href="/missed" className="btn btn-ghost text-sm">
            Review {missSplit.shaky} missed answer{missSplit.shaky === 1 ? "" : "s"}
          </Link>
          <Link href="/flashcards" className="btn btn-ghost text-sm">
            Drill flashcards
          </Link>
          {pDue > 0 && (
            <Link href="/practice" className="btn btn-primary text-sm">
              {pDue} due for spaced review
            </Link>
          )}
        </div>
      )}

      {nothingYet && (
        <div className="card p-8 text-center">
          <p className="text-ink2">No tests or practice yet.</p>
          <div className="mt-4 flex justify-center gap-2">
            <Link href="/practice" className="btn btn-ghost">
              Start practice
            </Link>
            <Link href="/simulate" className="btn btn-primary">
              Take a quick test or full exam
            </Link>
          </div>
        </div>
      )}

      {game && <GamePanel g={game} onChooseQuest={chooseQuest} />}

      {!nothingYet && (
        <section className="card p-5">
          <h2 className="font-bold">All four exams</h2>
          <p className="mb-3 text-xs text-ink3">
            Best fresh score per exam against the cut — one picture of where you stand.
          </p>
          <ReadinessStrip best={bestPerExam} />
        </section>
      )}

      {!nothingYet && extras && (
        <section className="card p-5">
          <h2 className="font-bold">Study activity</h2>
          <div className="mt-3 grid gap-6 lg:grid-cols-2">
            <div>
              <p className="mb-1 text-xs font-semibold text-ink2">Last 12 weeks</p>
              <WeeklyVolume rows={extras.weekly} />
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold text-ink2">
                Spaced reviews coming due (next 14 days)
              </p>
              <DueForecast rows={extras.due_forecast} />
              <p className="mt-1 text-[10px] text-ink3">
                Plan around the tall days — clearing reviews when they&apos;re due is what moves items
                into long-term memory.
              </p>
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold text-ink2">Pace — time used vs allowed</p>
              <PaceChart rows={extras.pace} />
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold text-ink2">
                Calibration — confidence vs accuracy
              </p>
              <CalibrationChart rows={extras.calibration} />
            </div>
          </div>

          <div className="mt-5 border-t border-edge pt-4">
            <p className="mb-2 text-xs font-semibold text-ink2">Personal bests</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Best label="Best fresh sim" value={bestOverall === null ? "—" : String(bestOverall)} />
              <Best
                label="Longest streak"
                value={game ? `${game.streak.best} day${game.streak.best === 1 ? "" : "s"}` : "—"}
              />
              <Best
                label="Biggest week"
                value={topWeek ? `${topWeek.practice + topWeek.sim_items} items` : "—"}
                sub={
                  topWeek
                    ? `wk of ${new Date(topWeek.week.slice(0, 10) + "T12:00:00").toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}`
                    : undefined
                }
              />
              <Best label="Items recovered" value={String(missSplit.recovered)} />
            </div>
          </div>
        </section>
      )}

      {EXAMS.map((exam) => {
        const es = sessions.filter((s) => s.exam_code === exam.code);
        const mrows = (mastery[exam.code] ?? []).filter((m) => m.seen > 0);
        const prac = practice[exam.code];
        const hasPractice = (prac?.answered ?? 0) > 0;
        const examMissed = missed.filter((m) => m.exam_code === exam.code);
        if (es.length === 0 && mrows.length === 0 && !hasPractice && examMissed.length === 0)
          return null;
        const color = EXAM_COLORS[exam.code];
        const hasSessions = es.length > 0;
        const best = hasSessions ? bestOf(es) : null;
        const trend = trendSeries(es);
        const heatRows: HeatRow[] = [...es]
          .reverse()
          .slice(0, 12)
          .map((s) => ({
            label: new Date(s.submitted_at).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            }),
            kind: s.mode === "quick" ? ("quick" as const) : ("full" as const),
            cells: exam.domains.map((d) =>
              s.domain_scores?.[d.name] ? Number(s.domain_scores[d.name].pct) : null
            ),
          }));

        return (
          <section key={exam.code} className="card p-5" style={{ borderTopColor: color, borderTopWidth: 3 }}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="font-bold">{exam.name}</h2>
                <p className="text-xs text-ink3">
                  {exam.code} · {es.filter((s) => s.mode !== "quick").length} full ·{" "}
                  {es.filter((s) => s.mode === "quick").length} quick ·{" "}
                  {prac?.sessions ?? 0} practice
                  {best ? ` · best fresh ${best.fresh_scaled}` : ""}
                </p>
              </div>
              {best && (
                <span
                  className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                    best.passed ? "bg-good/20 text-good" : "bg-warn/20 text-warn"
                  }`}
                >
                  {best.passed
                    ? "LIKELY PASS"
                    : (best.fresh_scaled ?? 0) >= 720
                      ? "BORDERLINE"
                      : `${720 - (best.fresh_scaled ?? 0)} to cut`}
                </span>
              )}
            </div>

            {hasSessions && best && (
              <>
                <div className="mt-4 grid gap-5 lg:grid-cols-2">
                  <div>
                    <p className="mb-1 text-xs font-semibold text-ink2">
                      Fresh score over time, with margin
                    </p>
                    <ScoreBandTrend points={trend} color={color} />
                  </div>
                  <div>
                    <p className="mb-1 text-xs font-semibold text-ink2">
                      Where the points are — best sitting (
                      {best.mode === "holdout" ? "go/no-go" : best.mode}, fresh {best.fresh_scaled})
                    </p>
                    <DomainGap
                      rows={exam.domains.map((d) => ({
                        name: d.name,
                        weight: d.weight,
                        pct: best.domain_scores?.[d.name]
                          ? Number(best.domain_scores[d.name].pct)
                          : null,
                      }))}
                      color={color}
                    />
                  </div>
                </div>

                {es.length > 1 && (
                  <div className="mt-5">
                    <p className="mb-1 text-xs font-semibold text-ink2">
                      Every attempt, every domain (% correct)
                    </p>
                    <DomainHeatmap
                      domains={exam.domains.map((d) => d.name)}
                      rows={heatRows}
                      color={color}
                    />
                  </div>
                )}
              </>
            )}

            {/* Practice — graded retrieval practice, kept separate from sim scores
                because it is untimed, immediate-feedback, and does not feed Readiness. */}
            {hasPractice && prac && (
              <div className="mt-5 border-t border-edge pt-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-xs font-semibold text-ink2">Practice</p>
                  <p className="text-xs text-ink3">
                    {prac.sessions} set{prac.sessions === 1 ? "" : "s"} · {prac.answered} answered ·{" "}
                    <b className="text-ink2">{prac.accuracy ?? 0}% correct</b> ·{" "}
                    {prac.distinct_items} distinct items
                    {prac.flashcards_reviewed > 0 &&
                      ` · ${prac.flashcards_reviewed} flashcard${
                        prac.flashcards_reviewed === 1 ? "" : "s"
                      }`}
                    {prac.due > 0 && ` · ${prac.due} due`}
                  </p>
                </div>

                <div className="mt-3 grid gap-5 lg:grid-cols-2">
                  <div>
                    <p className="mb-1 text-[11px] font-semibold text-ink3">
                      Practice accuracy by day
                    </p>
                    <AccuracyTrend points={prac.daily} color={color} />
                  </div>
                  <div>
                    <p className="mb-1 text-[11px] font-semibold text-ink3">
                      Practice accuracy by domain
                    </p>
                    <DomainBars
                      rows={exam.domains.map((d) => {
                        const row = prac.domains.find((x) => x.domain === d.name);
                        return {
                          name: d.name,
                          weight: d.weight,
                          pct: row && row.answered > 0 ? (row.accuracy ?? 0) : null,
                        };
                      })}
                      color={color}
                    />
                  </div>
                </div>

                {prac.recent.length > 0 && (
                  <div className="mt-4">
                    <p className="mb-1.5 text-[11px] font-semibold text-ink3">Recent practice sets</p>
                    <div className="flex flex-wrap gap-1.5">
                      {prac.recent.map((s) => {
                        const pct = s.answered ? Math.round((100 * s.correct) / s.answered) : 0;
                        return (
                          <span
                            key={s.id}
                            title={new Date(s.at).toLocaleString()}
                            className="rounded-lg border border-edge bg-surface2 px-2.5 py-1 text-xs"
                          >
                            <span className="text-ink3">
                              {new Date(s.at).toLocaleDateString(undefined, {
                                month: "short",
                                day: "numeric",
                              })}
                            </span>{" "}
                            <span
                              className={`font-mono font-bold ${pct >= 70 ? "text-good" : "text-warn"}`}
                            >
                              {s.correct}/{s.answered}
                            </span>
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Missed items — the cross-session worklist for this exam */}
            {examMissed.length > 0 && (
              <div className="mt-5 border-t border-edge pt-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-xs font-semibold text-ink2">Missed items</p>
                  <p className="text-xs text-ink3">
                    <b className="text-bad">{countByStatus(examMissed).shaky} still shaky</b> ·{" "}
                    <span className="text-good">{countByStatus(examMissed).recovered} recovered</span>
                  </p>
                </div>
                <div className="mt-2 space-y-1">
                  {groupByDomain(examMissed).map((g) => {
                    const s = countByStatus(g.items);
                    return (
                      <Link
                        key={g.domain}
                        href={`/missed?exam=${exam.code}`}
                        className="flex items-center justify-between gap-2 rounded-lg px-2 py-1 text-xs transition hover:bg-surface2"
                      >
                        <span className="truncate text-ink2" title={g.domain}>
                          {g.domain}
                        </span>
                        <span className="flex shrink-0 items-center gap-1.5 font-mono">
                          {s.shaky > 0 && <span className="text-bad">{s.shaky} shaky</span>}
                          {s.recovered > 0 && <span className="text-good">{s.recovered} ok</span>}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Tier 2b: durable mastery from spaced practice */}
            {mrows.length > 0 && (
              <div className="mt-5">
                <p className="mb-1 text-xs font-semibold text-ink2">
                  Durable mastery (from spaced practice)
                </p>
                <p className="mb-2 text-[10px] text-ink3">
                  Coverage = how much of the domain you&apos;ve practiced · Retention = how deep in
                  the spaced-review schedule it sits. Grows as you practice and space out reviews.
                </p>
                <div className="space-y-2">
                  {(mastery[exam.code] ?? []).map((m) => (
                    <div key={m.domain} className="text-xs">
                      <div className="mb-0.5 flex items-baseline justify-between gap-2">
                        <span className="truncate text-ink2" title={m.domain}>
                          {m.domain}
                        </span>
                        <span className="font-mono text-ink3">
                          {m.seen}/{m.total} seen
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-16 shrink-0 text-[10px] text-ink3">coverage</span>
                        <MiniBar pct={m.coverage ?? 0} color="var(--sf-ink-3)" />
                        <span className="w-8 shrink-0 text-right font-mono text-[10px] text-ink2">
                          {m.coverage ?? 0}%
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-2">
                        <span className="w-16 shrink-0 text-[10px] text-ink3">retention</span>
                        <MiniBar pct={m.retention} color={color} />
                        <span className="w-8 shrink-0 text-right font-mono text-[10px] text-ink2">
                          {m.retention}%
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {hasSessions && (
              <div className="mt-5">
                <p className="mb-2 text-xs font-semibold text-ink2">Attempt history</p>
                <div className="space-y-1.5">
                  {[...es].reverse().map((s) => (
                    <Link
                      key={s.id}
                      href={`/results/${s.id}`}
                      className="flex items-center justify-between gap-2 rounded-lg border border-edge bg-surface2 px-3 py-2 text-sm transition hover:border-ink3"
                    >
                      <span className="flex items-center gap-2">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                            s.mode === "quick"
                              ? "bg-accent/20 text-accenthi"
                              : "bg-good/20 text-good"
                          }`}
                        >
                          {s.mode === "quick" ? "QUICK" : s.mode === "holdout" ? "GO/NO-GO" : "FULL"}
                        </span>
                        <span className="text-ink3">
                          {new Date(s.submitted_at).toLocaleString()}
                        </span>
                        {(s.proctor_events?.length ?? 0) > 0 && (
                          <span className="text-warn" title="proctor events">
                            ⚠ {s.proctor_events.length}
                          </span>
                        )}
                      </span>
                      <span className="flex items-center gap-3">
                        {(() => {
                          const d = displayScore(s);
                          return (
                            <span
                              className={`font-mono font-bold ${s.passed ? "text-good" : "text-ink"}`}
                              title={
                                d.raw
                                  ? "raw score (no fresh-item tracking)"
                                  : `fresh score on ${d.items} new items; raw ${s.scaled_score}`
                              }
                            >
                              {d.score}
                              <span className="ml-1 text-[10px] font-normal text-ink3">
                                {d.raw ? "raw" : `fresh/${d.items}`}
                              </span>
                            </span>
                          );
                        })()}
                        <span className="text-xs text-ink3">review →</span>
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {best && (
              <div className="mt-5">
                <p className="mb-1 text-xs font-semibold text-ink2">Best fresh score</p>
                <Gauge value={best.fresh_scaled!} color={color} />
              </div>
            )}

            <div className="mt-5 flex flex-wrap gap-2 border-t border-edge pt-4">
              <Link href={`/practice/${exam.code}`} className="btn btn-ghost text-sm">
                Practice
              </Link>
              {examMissed.length > 0 && (
                <>
                  <Link href={`/flashcards/${exam.code}`} className="btn btn-ghost text-sm">
                    Flashcards ({examMissed.length})
                  </Link>
                  <Link href={`/missed?exam=${exam.code}`} className="btn btn-ghost text-sm">
                    Missed answers
                  </Link>
                </>
              )}
              <Link href={`/study/${exam.code}`} className="btn btn-ghost text-sm">
                Study sheet
              </Link>
              <Link href={`/simulate/${exam.code}?mode=quick`} className="btn btn-ghost text-sm">
                Quick test
              </Link>
              <Link href={`/simulate/${exam.code}`} className="btn btn-primary text-sm">
                Full exam
              </Link>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function MiniBar({ pct, color }: { pct: number; color: string }) {
  return (
    <svg viewBox="0 0 100 5" preserveAspectRatio="none" className="h-1.5 flex-1">
      <rect x={0} y={0} width={100} height={5} rx={2} fill="var(--sf-surface-2)" />
      <rect x={0} y={0} width={Math.max(1, Math.min(100, pct))} height={5} rx={2} fill={color} />
    </svg>
  );
}

function Best({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-edge bg-surface2 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink3">{label}</p>
      <p className="font-mono text-lg font-bold tabular-nums">{value}</p>
      {sub && <p className="text-[10px] text-ink3">{sub}</p>}
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="card p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink3">{label}</p>
      <p className="mt-1 text-2xl font-black tabular-nums">{value}</p>
      <p className="text-[11px] text-ink3">{sub}</p>
    </div>
  );
}
