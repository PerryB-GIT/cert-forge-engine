"use client";
import { useCallback, useMemo, useState } from "react";
import { bestSitting, type ReportSession } from "@/lib/report";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import { getExam } from "@/lib/exams";
import { EXAM_COLORS } from "@/lib/ui";
import { retry } from "@/lib/retry";
import { useAsyncData } from "@/lib/useAsyncData";
import { LoadError } from "@/components/LoadError";
import { StudyNav } from "@/components/StudyNav";
import { loadObjectives, groupSize, type Group } from "@/lib/objectives";
import { countByStatus, type MissedItem } from "@/lib/missed";
import { SourceLinks } from "@/components/SourceLinks";

type DomScore = { correct: number; total: number; pct: number };
type Session = ReportSession & { domain_scores: Record<string, DomScore> | null };
type TaskStat = { task: string; attempts: number; correct: number; pct: number; items: number };
type PracticeDomain = {
  domain: string;
  answered: number;
  correct: number;
  accuracy: number | null;
  missed: number;
};

/**
 * Per-exam study sheet. Two sources, both verifiable, neither invented:
 *   - the published objectives for each domain, extracted from guides/*.pdf
 *   - the concepts you personally got wrong, from your own answer history
 *
 * Laid out to print cleanly (see the @media print block in globals.css).
 */
export function StudySheet({ examCode }: { examCode: string }) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const exam = getExam(examCode)!;
  const color = EXAM_COLORS[examCode];

  const [showObjectives, setShowObjectives] = useState(true);

  const load = useCallback(async () => {
    const [objectives, mine] = await Promise.all([
      loadObjectives(examCode),
      retry(async () => {
        const [
          { data: miss, error: e1 },
          { data: sess, error: e2 },
          { data: stats, error: e3 },
          { data: tstats, error: e4 },
        ] = await Promise.all([
            supabase.rpc("cf_missed_items", { p_exam: examCode }),
            supabase
              .from("cf_exam_sessions")
              .select("id, exam_code, scaled_score, passed, fresh_items, fresh_scaled, mode, domain_scores, submitted_at")
              .eq("exam_code", examCode)
              .not("submitted_at", "is", null),
            supabase.rpc("cf_practice_stats"),
            supabase.rpc("cf_task_stats", { p_exam: examCode }),
          ]);
        if (e1 || e2 || e3 || e4) throw e1 ?? e2 ?? e3 ?? e4;
        return {
          missed: (miss as MissedItem[]) ?? [],
          // Same rule as the Report Card: best fresh score on a full sitting with 40+ fresh items.
          best: bestSitting((sess as Session[]) ?? []),
          taskStats: ((tstats as TaskStat[]) ?? []) as TaskStat[],
          practice:
            ((stats as Record<string, { domains?: PracticeDomain[] }>)?.[examCode]?.domains ??
              []) as PracticeDomain[],
        };
      }),
    ]);
    return { objectives, ...mine };
  }, [supabase, examCode]);
  const { data, failed, reload } = useAsyncData(load);

  if (failed) return <LoadError onRetry={reload} label="Couldn't load this study sheet." />;
  if (data === null) return <p className="py-16 text-center text-ink3">Building your study sheet…</p>;

  const { objectives, missed, best, practice, taskStats } = data;
  // Task id = "<domain#>.<statement#>" in guide order — the same order the
  // objectives were extracted in (fixtures/questions/tags/<code>.json).
  const statByTask = new Map(taskStats.map((t) => [t.task, t]));
  const titleByTask = new Map<string, string>();
  objectives.forEach((d, di) =>
    d.groups.forEach((g, gi) => g.title && titleByTask.set(`${di + 1}.${gi + 1}`, g.title))
  );
  // Weakest statements: at least 2 graded answers, lowest accuracy first.
  const weakest = taskStats
    .filter((t) => t.attempts >= 2 && t.pct < 100)
    .sort((a, b) => a.pct - b.pct || b.attempts - a.attempts)
    .slice(0, 5);

  const split = countByStatus(missed);
  const byDomainObjectives = new Map(objectives.map((d) => [d.domain, d]));

  return (
    <div className="space-y-5">
      <div className="print:hidden">
        <h1 className="text-2xl font-bold tracking-tight">{exam.name}</h1>
        <p className="text-sm text-ink2">
          Study sheet · {exam.code} · {exam.items} items · {exam.minutes} min · cut 720. Objectives
          below are quoted from the official exam guide; the highlighted concepts are the ones you
          have personally missed.
        </p>
      </div>

      <div className="print:hidden">
        <StudyNav />
      </div>

      {/* Print header — the sub-nav and chrome disappear, so the sheet needs its own. */}
      <div className="hidden print:block">
        <h1 className="text-xl font-bold">
          {exam.name} ({exam.code}) — Cert Forge study sheet
        </h1>
        <p className="text-xs">
          Printed {new Date().toLocaleDateString()} · {split.shaky} concepts still shaky ·{" "}
          {split.recovered} recovered
        </p>
      </div>

      {/* ---------- summary + actions ---------- */}
      <section className="card p-5 print:hidden" style={{ borderTopColor: color, borderTopWidth: 3 }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-4 text-sm">
            <Stat label="Best fresh" value={best ? String(best.fresh_scaled) : "—"} />
            <Stat label="Concepts shaky" value={String(split.shaky)} tone={split.shaky ? "bad" : "good"} />
            <Stat label="Recovered" value={String(split.recovered)} tone="good" />
            <Stat
              label="Practice answered"
              value={String(practice.reduce((n, d) => n + d.answered, 0))}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-ghost text-sm" onClick={() => setShowObjectives((s) => !s)}>
              {showObjectives ? "Hide objectives" : "Show objectives"}
            </button>
            <button className="btn btn-ghost text-sm" onClick={() => window.print()}>
              Print / PDF
            </button>
            {missed.length > 0 && (
              <Link href={`/flashcards/${examCode}`} className="btn btn-primary text-sm">
                Drill all {missed.length}
              </Link>
            )}
          </div>
        </div>
      </section>

      {/* ---------- weakest task statements ---------- */}
      {titleByTask.size > 0 && (
        <section className="card p-5 print:hidden">
          <h2 className="font-bold">Weakest task statements</h2>
          <p className="mt-1 text-xs text-ink3">
            Your graded answers (sims + practice) grouped by the guide&apos;s task statements — aim
            study time here rather than at a whole domain.
          </p>
          {weakest.length === 0 ? (
            <p className="mt-2 text-xs text-ink3">
              Not enough graded answers yet — a statement needs 2+ answers to rank. Take a sim or a
              practice set.
            </p>
          ) : (
            <ol className="mt-3 space-y-2">
              {weakest.map((t) => (
                <li key={t.task} className="flex items-baseline justify-between gap-3 text-sm">
                  <span>
                    <span className="font-mono text-xs text-ink3">{t.task}</span>{" "}
                    {titleByTask.get(t.task) ?? "Unknown statement"}
                  </span>
                  <span
                    className={`shrink-0 font-semibold tabular-nums ${t.pct < 70 ? "text-bad" : "text-warn"}`}
                  >
                    {t.correct}/{t.attempts} · {Math.round(t.pct)}%
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}

      {/* ---------- one section per domain ---------- */}
      {exam.domains.map((d) => {
        const objs = byDomainObjectives.get(d.name);
        const dIdx = objectives.findIndex((o) => o.domain === d.name);
        const domMissed = missed.filter((m) => m.domain === d.name);
        const simPct = best?.domain_scores?.[d.name] ? Number(best.domain_scores[d.name].pct) : null;
        const prac = practice.find((p) => p.domain === d.name) ?? null;

        return (
          <section
            key={d.name}
            className="card break-inside-avoid p-5"
            style={{ borderLeftColor: color, borderLeftWidth: 3 }}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-bold">{d.name}</h2>
              <p className="text-xs text-ink3">
                weight {d.weight}%
                {simPct !== null && ` · your best sim ${Math.round(simPct)}%`}
                {prac && prac.answered > 0 && ` · practice ${prac.accuracy ?? 0}% of ${prac.answered}`}
              </p>
            </div>

            {/* what the guide says is tested */}
            {showObjectives && objs && objs.groups.length > 0 && (
              <div className="mt-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink3">
                  What the exam guide says is tested
                </p>
                <div className="mt-2 space-y-3">
                  {objs.groups.map((g, i) => (
                    <ObjectiveGroup
                      key={i}
                      group={g}
                      stat={dIdx >= 0 ? statByTask.get(`${dIdx + 1}.${i + 1}`) : undefined}
                      taskId={dIdx >= 0 && g.title ? `${dIdx + 1}.${i + 1}` : undefined}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* what you actually got wrong */}
            <div className="mt-4 border-t border-edge pt-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-accenthi">
                  Concepts you have missed
                </p>
                {domMissed.length > 0 && (
                  <Link
                    href={`/flashcards/${examCode}?domain=${encodeURIComponent(d.name)}`}
                    className="text-xs font-semibold text-accenthi underline print:hidden"
                  >
                    Drill {domMissed.length} card{domMissed.length === 1 ? "" : "s"} →
                  </Link>
                )}
              </div>
              {domMissed.length === 0 ? (
                <p className="mt-2 text-xs text-ink3">
                  Nothing missed here yet — either you have it, or you have not been tested on it.
                </p>
              ) : (
                <ol className="mt-2 space-y-3">
                  {domMissed.map((m) => (
                    <li key={m.id} className="border-l-2 border-edge pl-3">
                      <p className="text-sm font-semibold">
                        <span className={m.status === "recovered" ? "text-good" : "text-bad"}>
                          {m.status === "recovered" ? "✓" : "✗"}
                        </span>{" "}
                        {shorten(m.stem)}
                      </p>
                      <p className="mt-1 text-xs text-ink2">{m.rationale.overall}</p>
                      <div className="mt-1">
                        <SourceLinks itemId={m.id} domain={m.domain} />
                      </div>
                      {m.tip && (
                        <p className="mt-1 text-xs text-ink2">
                          <b className="text-accenthi">Tip:</b> {m.tip}
                        </p>
                      )}
                      <p className="mt-1 text-[10px] text-ink3">
                        missed {m.times_missed}× · spaced-review box {m.box}/5
                        {m.status === "recovered" ? " · recovered" : ""}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </section>
        );
      })}

      <p className="text-xs text-ink3 print:text-[9px]">
        Objectives extracted verbatim from the published {exam.code} exam guide. Practice content is
        original, written against those objectives — not real exam items.
      </p>
    </div>
  );
}

function ObjectiveGroup({
  group,
  stat,
  taskId,
}: {
  group: Group;
  stat?: TaskStat;
  taskId?: string;
}) {
  const size = groupSize(group);
  return (
    <div className="break-inside-avoid">
      {group.title && (
        <p className="text-sm font-semibold">
          {taskId && <span className="mr-1.5 font-mono text-xs font-normal text-ink3">{taskId}</span>}
          {group.title}
          {taskId && (
            <span
              className={`ml-2 text-xs font-normal tabular-nums ${
                !stat ? "text-ink3" : stat.pct >= 80 ? "text-good" : stat.pct >= 70 ? "text-warn" : "text-bad"
              }`}
            >
              {stat ? `you: ${stat.correct}/${stat.attempts} (${Math.round(stat.pct)}%)` : "not yet tested"}
            </span>
          )}
          {group.weight !== null && (
            <span className="ml-2 text-xs font-normal text-ink3">{group.weight}% of exam</span>
          )}
        </p>
      )}
      {group.summary && <p className="mt-1 text-xs text-ink2">{group.summary}</p>}
      {group.points.length > 0 && <Bullets items={group.points} />}
      {group.knowledge.length > 0 && <Bullets label="Knowledge of" items={group.knowledge} />}
      {group.skills.length > 0 && <Bullets label="Skills in" items={group.skills} />}
      {size === 0 && !group.summary && (
        <p className="mt-1 text-xs text-ink3">No detail published for this objective.</p>
      )}
    </div>
  );
}

function Bullets({ label, items }: { label?: string; items: string[] }) {
  return (
    <div className="mt-1">
      {label && <p className="text-[10px] font-semibold uppercase tracking-wide text-ink3">{label}</p>}
      <ul className="mt-0.5 list-disc space-y-1 pl-5 text-xs text-ink2 marker:text-ink3">
        {items.map((b, i) => (
          <li key={i}>{b}</li>
        ))}
      </ul>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "good" | "bad";
}) {
  const cls = tone === "good" ? "text-good" : tone === "bad" ? "text-bad" : "text-ink";
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-ink3">{label}</p>
      <p className={`text-xl font-black tabular-nums ${cls}`}>{value}</p>
    </div>
  );
}

/** First sentence (or 140 chars) of a stem — enough to recognise the item. */
function shorten(stem: string): string {
  const flat = stem.replace(/\s+/g, " ").trim();
  const stop = flat.search(/[.?]\s/);
  if (stop > 30 && stop < 140) return flat.slice(0, stop + 1);
  return flat.length > 140 ? flat.slice(0, 140) + "…" : flat;
}
