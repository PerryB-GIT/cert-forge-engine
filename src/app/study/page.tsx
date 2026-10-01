"use client";
import { useCallback, useMemo } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import { EXAMS } from "@/lib/exams";
import { EXAM_COLORS } from "@/lib/ui";
import { retry } from "@/lib/retry";
import { useAsyncData } from "@/lib/useAsyncData";
import { LoadError } from "@/components/LoadError";
import { StudyNav } from "@/components/StudyNav";
import { countByStatus, type MissedItem } from "@/lib/missed";

export default function StudyHubPage() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const load = useCallback(
    () =>
      retry(async () => {
        const { data, error } = await supabase.rpc("cf_missed_items", { p_exam: null });
        if (error) throw error;
        return (data as MissedItem[]) ?? [];
      }),
    [supabase]
  );
  const { data: items, failed, reload } = useAsyncData(load);

  if (failed) return <LoadError onRetry={reload} label="Couldn't load the study lab yet." />;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Study Lab</h1>
        <p className="text-sm text-ink2">
          A study sheet per exam: the published objectives for every domain, straight out of the
          official exam guide, sitting next to your own score for that domain and the specific
          concepts you have gotten wrong. Print it, or drill any domain as flashcards.
        </p>
      </div>

      <StudyNav />

      <div className="grid gap-4 sm:grid-cols-2">
        {EXAMS.map((exam) => {
          const missed = (items ?? []).filter((m) => m.exam_code === exam.code);
          const split = countByStatus(missed);
          return (
            <Link
              key={exam.code}
              href={`/study/${exam.code}`}
              className="card flex flex-col p-5 transition hover:border-ink3"
              style={{ borderTopColor: EXAM_COLORS[exam.code], borderTopWidth: 3 }}
            >
              <h2 className="font-bold">{exam.name}</h2>
              <p className="mt-1 text-xs text-ink3">
                {exam.code} · {exam.domains.length} domains · {exam.items} items · {exam.minutes} min
              </p>
              <div className="mt-3 flex flex-1 flex-wrap items-end gap-2 text-xs">
                {items === null ? (
                  <span className="text-ink3">loading your data…</span>
                ) : missed.length === 0 ? (
                  <span className="rounded-full bg-surface2 px-2.5 py-1 text-ink3">
                    objectives only — nothing missed yet
                  </span>
                ) : (
                  <>
                    <span className="rounded-full bg-bad/15 px-2.5 py-1 font-semibold text-bad">
                      {split.shaky} shaky concept{split.shaky === 1 ? "" : "s"}
                    </span>
                    <span className="rounded-full bg-good/15 px-2.5 py-1 font-semibold text-good">
                      {split.recovered} recovered
                    </span>
                  </>
                )}
              </div>
              <p className="mt-4 text-sm font-semibold text-accenthi">Open study sheet →</p>
            </Link>
          );
        })}
      </div>

      <p className="text-xs text-ink3">
        Objectives are extracted verbatim from the exam guides in{" "}
        <code className="text-ink2">guides/</code> — nothing on a study sheet is invented. The
        &ldquo;concepts you missed&rdquo; sections are built from your own answer history.
      </p>
    </div>
  );
}
