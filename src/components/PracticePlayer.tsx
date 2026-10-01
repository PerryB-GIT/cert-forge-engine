"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import { getExam } from "@/lib/exams";
import { EXAM_COLORS } from "@/lib/ui";
import { retry } from "@/lib/retry";
import { SourceLinks } from "@/components/SourceLinks";

type Q = {
  id: string;
  domain: string;
  scenario: string | null;
  stem: string;
  options: string[];
  multi: boolean;
  select_count: number;
};

type Feedback = {
  is_correct: boolean;
  correct: number[];
  rationale: { overall: string; options: string[] };
  tip: string | null;
  box: number;
  next_review: string;
};

const BOX_LABEL = ["seeing again soon", "1 day", "3 days", "1 week", "2+ weeks", "5 weeks"];

/** Optional pre-check confidence, stored for the Report Card's calibration chart. */
const CONFIDENCE = [
  { v: 1, label: "Guessing" },
  { v: 2, label: "Fairly sure" },
  { v: 3, label: "Certain" },
] as const;

export function PracticePlayer({ examCode }: { examCode: string }) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const exam = getExam(examCode)!;
  const color = EXAM_COLORS[examCode];

  const [practiceId, setPracticeId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<Q[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [picks, setPicks] = useState<number[]>([]);
  const [confidence, setConfidence] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<Record<string, Feedback>>({});
  const [correctCount, setCorrectCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    retry(async () => {
      const { data, error } = await supabase.rpc("cf_start_practice", {
        p_exam: examCode,
        p_size: 15,
      });
      if (error) throw error;
      return data as { practice_id: string; questions: Q[] };
    })
      .then((d) => {
        setPracticeId(d.practice_id);
        setQuestions(d.questions);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : "Could not start practice."));
  }, [supabase, examCode]);

  if (err) return <p className="py-16 text-center text-bad">{err}</p>;
  if (!questions) return <p className="py-16 text-center text-ink3">Building your review set…</p>;
  if (questions.length === 0)
    return (
      <div className="py-16 text-center">
        <p className="text-ink2">Nothing to practice for this exam yet.</p>
        <Link href="/practice" className="btn btn-ghost mt-4">
          Back to Practice
        </Link>
      </div>
    );

  const q = questions[idx];
  const fb = feedback[q.id];
  const graded = !!fb;

  function toggle(i: number) {
    if (graded) return;
    setPicks((prev) => {
      if (!q.multi) return [i];
      if (prev.includes(i)) return prev.filter((x) => x !== i);
      if (prev.length < q.select_count) return [...prev, i].sort((a, b) => a - b);
      return prev;
    });
  }

  async function check() {
    if (picks.length === 0 || busy || !practiceId) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("cf_grade_practice_item", {
      p_practice: practiceId,
      p_question_id: q.id,
      p_answer: picks,
      ...(confidence !== null ? { p_confidence: confidence } : {}),
    });
    setBusy(false);
    if (error) return setErr(error.message);
    const f = data as Feedback;
    setFeedback((prev) => ({ ...prev, [q.id]: f }));
    if (f.is_correct) setCorrectCount((c) => c + 1);
  }

  function next() {
    if (idx < questions!.length - 1) {
      setIdx(idx + 1);
      setPicks([]);
      setConfidence(null);
    } else {
      finish();
    }
  }

  async function finish() {
    if (practiceId) await supabase.rpc("cf_finish_practice", { p_practice: practiceId });
    setDone(true);
  }

  const answered = Object.keys(feedback).length;

  if (done) {
    const pct = answered ? Math.round((correctCount / answered) * 100) : 0;
    return (
      <div className="mx-auto max-w-xl py-10">
        <div className="card p-8 text-center" style={{ borderTopColor: color, borderTopWidth: 3 }}>
          <p className="text-xs font-semibold tracking-wide text-ink3">PRACTICE COMPLETE · {examCode}</p>
          <p className="mt-2 text-4xl font-black">
            {correctCount}/{answered}
          </p>
          <p className="text-sm text-ink2">{pct}% correct this session</p>
          <p className="mt-4 text-sm text-ink2">
            Each item you answered is now scheduled for spaced review — miss one and it comes back
            soon; get it right and it returns at a longer interval. Come back when items are due to
            lock it into long-term memory.
          </p>
          <div className="mt-6 flex justify-center gap-2">
            <Link href={`/practice/${examCode}`} className="btn btn-primary">
              Practice more
            </Link>
            <Link href="/practice" className="btn btn-ghost">
              Other exams
            </Link>
            <Link href="/" className="btn btn-ghost">
              Readiness
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl">
      {/* progress */}
      <div className="mb-4">
        <div className="mb-1 flex items-center justify-between text-xs text-ink2">
          <span className="font-semibold">
            Practice · {exam.shortName} · {idx + 1}/{questions.length}
          </span>
          <span>
            {correctCount}/{answered} correct
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface2">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${((idx + (graded ? 1 : 0)) / questions.length) * 100}%`, background: color }}
          />
        </div>
      </div>

      {q.scenario && (
        <p className="mb-2 text-xs font-bold tracking-wide text-accenthi">
          SCENARIO: {q.scenario.toUpperCase()}
        </p>
      )}
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-ink3">{q.domain}</p>

      <section className="card p-5">
        <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{q.stem}</p>
        {q.multi && (
          <p className="mt-2 text-xs font-semibold text-warn">Select {q.select_count} responses.</p>
        )}
        <div className="mt-4 space-y-2">
          {q.options.map((opt, i) => {
            const picked = picks.includes(i);
            const isCorrect = graded && fb.correct.includes(i);
            const chosenWrong = graded && picked && !fb.correct.includes(i);
            return (
              <button
                key={i}
                onClick={() => toggle(i)}
                disabled={graded}
                className={`block w-full rounded-lg border px-4 py-3 text-left text-sm transition ${
                  isCorrect
                    ? "border-good bg-good/15"
                    : chosenWrong
                      ? "border-bad bg-bad/15"
                      : picked
                        ? "border-accent bg-accent/15 font-semibold"
                        : "border-edge bg-surface2 hover:border-ink3"
                } ${graded ? "cursor-default" : ""}`}
              >
                <span className="mr-2 font-mono font-bold text-ink3">
                  {String.fromCharCode(65 + i)}.
                </span>
                {opt}
                {isCorrect && <span className="ml-2 text-xs font-bold text-good">CORRECT</span>}
                {chosenWrong && <span className="ml-2 text-xs font-bold text-bad">YOUR PICK</span>}
              </button>
            );
          })}
        </div>

        {/* immediate feedback */}
        {graded && (
          <div className="mt-4 space-y-3 border-t border-edge pt-4">
            <p className={`text-sm font-bold ${fb.is_correct ? "text-good" : "text-bad"}`}>
              {fb.is_correct ? "✓ Correct" : "✗ Not quite"} · next review in {BOX_LABEL[fb.box]}
            </p>
            <p className="rounded-lg bg-surface2 p-3 text-sm text-ink2">
              <b className="text-ink">Why:</b> {fb.rationale.overall}
            </p>
            {fb.tip && (
              <p className="text-xs text-ink2">
                <b className="text-accenthi">Study tip:</b> {fb.tip}
              </p>
            )}
            <SourceLinks itemId={q.id} domain={q.domain} />
          </div>
        )}
      </section>

      {!graded && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs" role="group" aria-label="How sure are you? Optional">
          <span className="text-ink3">How sure are you? (optional)</span>
          {CONFIDENCE.map((c) => (
            <button
              key={c.v}
              type="button"
              aria-pressed={confidence === c.v}
              onClick={() => setConfidence(confidence === c.v ? null : c.v)}
              className={`rounded-full border px-2.5 py-1 transition ${
                confidence === c.v
                  ? "border-accent bg-accent/15 font-semibold text-ink"
                  : "border-edge bg-surface2 text-ink2 hover:border-ink3"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      <div className="mt-4 flex justify-end gap-2">
        {!graded ? (
          <button className="btn btn-primary" onClick={check} disabled={picks.length === 0 || busy}>
            {busy ? "Checking…" : "Check answer"}
          </button>
        ) : (
          <button className="btn btn-primary" onClick={next}>
            {idx < questions.length - 1 ? "Next question →" : "Finish practice"}
          </button>
        )}
      </div>
    </div>
  );
}
