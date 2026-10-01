"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import { EXAMS } from "@/lib/exams";
import { EXAM_COLORS } from "@/lib/ui";

type Counts = Record<string, { due: number; seen: number; new: number }>;

export default function PracticePage() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [counts, setCounts] = useState<Counts | null>(null);

  useEffect(() => {
    supabase.rpc("cf_review_counts").then(({ data }) => setCounts((data as Counts) ?? {}));
  }, [supabase]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Practice</h1>
        <p className="text-sm text-ink2">
          Low-stakes, untimed retrieval practice with immediate feedback on every question — the
          single most effective way to prepare, per the research. Each item you answer is scheduled
          for <b>spaced review</b>: miss it and it comes back soon; get it right and it returns at a
          longer interval, locking it into long-term memory. Practice does not affect your Readiness
          or Scoreboard.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {EXAMS.map((exam) => {
          const c = counts?.[exam.code];
          const due = c?.due ?? 0;
          const fresh = c?.new ?? 0;
          const seen = c?.seen ?? 0;
          return (
            <div
              key={exam.code}
              className="card flex flex-col p-5"
              style={{ borderTopColor: EXAM_COLORS[exam.code], borderTopWidth: 3 }}
            >
              <h2 className="font-bold">{exam.name}</h2>
              <p className="mt-1 text-xs text-ink3">
                {exam.code} · {exam.items} items · {exam.domains.length} domains
              </p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                <span
                  className={`rounded-full px-2.5 py-1 font-semibold ${
                    due > 0 ? "bg-accent/20 text-accenthi" : "bg-surface2 text-ink3"
                  }`}
                >
                  {due} due for review
                </span>
                <span className="rounded-full bg-surface2 px-2.5 py-1 text-ink2">{fresh} new</span>
                <span className="rounded-full bg-surface2 px-2.5 py-1 text-ink3">{seen} seen</span>
              </div>
              <div className="mt-4 flex flex-1 items-end">
                <Link href={`/practice/${exam.code}`} className="btn btn-primary w-full text-sm">
                  {due > 0 ? `Review ${Math.min(due, 15)} due items` : "Start practice set"}
                </Link>
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-ink3">
        Counts refresh as review intervals come due. A practice set pulls up to 15 items, prioritizing
        what you&apos;ve missed and what&apos;s due, then new material — full domain coverage over time.
      </p>

      <div className="card p-4">
        <p className="text-sm font-semibold">Everything you miss is kept</p>
        <p className="mt-1 text-xs text-ink2">
          Wrong answers here and in the exam simulator both land in your missed-answer bank, with the
          correct answer and the reasoning. Drill them as flashcards, or read them in context on a
          study sheet next to the published exam objectives.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href="/missed" className="btn btn-ghost text-sm">
            Missed answers
          </Link>
          <Link href="/flashcards" className="btn btn-ghost text-sm">
            Flashcards
          </Link>
          <Link href="/study" className="btn btn-ghost text-sm">
            Study sheets
          </Link>
        </div>
      </div>
    </div>
  );
}
