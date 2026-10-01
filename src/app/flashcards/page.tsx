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
import { countByStatus, groupByDomain, type MissedItem } from "@/lib/missed";

export default function FlashcardsPage() {
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

  if (failed) return <LoadError onRetry={reload} label="Couldn't load your flashcard decks." />;
  if (items === null) return <p className="py-16 text-center text-ink3">Loading decks…</p>;

  const anyCards = items.length > 0;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Flashcards</h1>
        <p className="text-sm text-ink2">
          Decks build themselves from what you have actually missed — no card exists for a question
          you have never gotten wrong. Answer in your head, flip, then grade your own recall.
          Self-grading feeds the same spaced-review schedule as practice, capped at box 3; only a
          graded practice set can carry an item to boxes 4 and 5.
        </p>
      </div>

      <StudyNav />

      {!anyCards && (
        <div className="card p-8 text-center">
          <p className="text-ink2">No cards yet — you have not missed anything.</p>
          <p className="mt-1 text-xs text-ink3">
            Run a practice set or a quick test. Every miss becomes a card automatically.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Link href="/practice" className="btn btn-primary">
              Start practice
            </Link>
            <Link href="/simulate" className="btn btn-ghost">
              Take a quick test
            </Link>
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {EXAMS.map((exam) => {
          const deck = items.filter((m) => m.exam_code === exam.code);
          const split = countByStatus(deck);
          const byDomain = groupByDomain(deck);
          return (
            <div
              key={exam.code}
              className="card flex flex-col p-5"
              style={{ borderTopColor: EXAM_COLORS[exam.code], borderTopWidth: 3 }}
            >
              <h2 className="font-bold">{exam.name}</h2>
              <p className="mt-1 text-xs text-ink3">
                {exam.code} · {deck.length} card{deck.length === 1 ? "" : "s"} in the deck
              </p>

              {deck.length === 0 ? (
                <p className="mt-3 flex-1 text-xs text-ink3">
                  Nothing missed on this exam yet.
                </p>
              ) : (
                <>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    <span className="rounded-full bg-bad/15 px-2.5 py-1 font-semibold text-bad">
                      {split.shaky} still shaky
                    </span>
                    <span className="rounded-full bg-good/15 px-2.5 py-1 font-semibold text-good">
                      {split.recovered} recovered
                    </span>
                  </div>
                  <div className="mt-3 flex-1 space-y-1">
                    {byDomain.slice(0, 4).map((g) => (
                      <Link
                        key={g.domain}
                        href={`/flashcards/${exam.code}?domain=${encodeURIComponent(g.domain)}`}
                        className="flex items-baseline justify-between gap-2 rounded-lg px-2 py-1 text-xs transition hover:bg-surface2"
                      >
                        <span className="truncate text-ink2" title={g.domain}>
                          {g.domain}
                        </span>
                        <span className="shrink-0 font-mono text-ink3">{g.items.length}</span>
                      </Link>
                    ))}
                    {byDomain.length > 4 && (
                      <p className="px-2 text-[10px] text-ink3">
                        +{byDomain.length - 4} more domain{byDomain.length - 4 === 1 ? "" : "s"}
                      </p>
                    )}
                  </div>
                </>
              )}

              <div className="mt-4">
                {deck.length > 0 ? (
                  <Link href={`/flashcards/${exam.code}`} className="btn btn-primary w-full text-sm">
                    Drill all {deck.length}
                  </Link>
                ) : (
                  <Link href={`/practice/${exam.code}`} className="btn btn-ghost w-full text-sm">
                    Practice to build a deck
                  </Link>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
