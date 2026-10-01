"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import { getExam } from "@/lib/exams";
import { EXAM_COLORS } from "@/lib/ui";
import { retry } from "@/lib/retry";
import { useAsyncData } from "@/lib/useAsyncData";
import { LoadError } from "@/components/LoadError";
import { deckOrder, SOURCE_LABEL, type MissedItem } from "@/lib/missed";
import { SourceLinks } from "@/components/SourceLinks";

const BOX_LABEL = ["a few minutes", "1 day", "3 days", "1 week", "2+ weeks", "5 weeks"];

/**
 * Flashcard drill over the missed-answer bank. Front is the stem, back is the
 * answer plus the reasoning. You grade your own recall, which feeds the same
 * Leitner scheduler practice uses — but capped at box 3 server-side, because a
 * self-report is weaker evidence than a graded response and the Report Card's
 * retention number should only be moved by the real thing.
 */
export function FlashcardPlayer({ examCode, domain }: { examCode: string; domain: string | null }) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const exam = getExam(examCode)!;
  const color = EXAM_COLORS[examCode];

  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [graded, setGraded] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  // Separate from the loader's failure: a grade can fail on a deck that loaded fine.
  const [gradeFailed, setGradeFailed] = useState(false);
  // Fixed at mount so cf_finish_flashcards only counts this sitting.
  const startedAt = useRef(new Date().toISOString());

  const load = useCallback(async () => {
    const rows = await retry(async () => {
      const { data, error } = await supabase.rpc("cf_missed_items", { p_exam: examCode });
      if (error) throw error;
      return (data as MissedItem[]) ?? [];
    });
    return deckOrder(domain ? rows.filter((r) => r.domain === domain) : rows);
  }, [supabase, examCode, domain]);
  const { data: deck, failed: loadFailed, reload } = useAsyncData(load);
  const failed = loadFailed || gradeFailed;

  const card = deck?.[idx];

  const grade = useCallback(
    async (gotIt: boolean) => {
      if (!card || busy || graded[card.id] !== undefined) return;
      setBusy(true);
      const { error } = await supabase.rpc("cf_flashcard_grade", {
        p_question_id: card.id,
        p_got_it: gotIt,
      });
      setBusy(false);
      if (error) return setGradeFailed(true);
      setGraded((g) => ({ ...g, [card.id]: gotIt }));
    },
    [card, busy, graded, supabase]
  );

  const advance = useCallback(() => {
    setFlipped(false);
    setIdx((i) => i + 1);
  }, []);

  const finish = useCallback(async () => {
    await supabase.rpc("cf_finish_flashcards", {
      p_exam: examCode,
      p_since: startedAt.current,
    });
    setDone(true);
  }, [supabase, examCode]);

  // Keyboard-first: this is a drill, not a form.
  useEffect(() => {
    if (done || !card) return;
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLElement && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        setFlipped((f) => !f);
      } else if (flipped && (e.key === "1" || e.key === "2")) {
        e.preventDefault();
        grade(e.key === "2");
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        advance();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setFlipped(false);
        setIdx((i) => Math.max(0, i - 1));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [done, card, flipped, grade, advance]);

  if (failed)
    return (
      <LoadError
        onRetry={() => {
          setGradeFailed(false);
          reload();
        }}
        label={
          gradeFailed
            ? "Couldn't save that answer."
            : "Couldn't load this flashcard deck."
        }
      />
    );
  if (deck === null) return <p className="py-16 text-center text-ink3">Building your deck…</p>;

  if (deck.length === 0) {
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        <p className="text-ink2">
          No missed items for {exam.shortName}
          {domain ? ` in ${domain}` : ""} — nothing to drill.
        </p>
        <p className="mt-1 text-xs text-ink3">
          Flashcards are built from questions you have actually gotten wrong, so this deck fills up
          as you practice and simulate.
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Link href={`/practice/${examCode}`} className="btn btn-primary">
            Practice {exam.shortName}
          </Link>
          <Link href="/flashcards" className="btn btn-ghost">
            Other exams
          </Link>
        </div>
      </div>
    );
  }

  const answered = Object.keys(graded).length;
  const gotIt = Object.values(graded).filter(Boolean).length;
  const fuzzy = answered - gotIt;

  if (done || idx >= deck.length) {
    return (
      <FinishScreen
        examCode={examCode}
        color={color}
        reviewed={answered}
        gotIt={gotIt}
        fuzzy={fuzzy}
        deckSize={deck.length}
        onFinish={done ? null : finish}
      />
    );
  }

  const verdict = graded[card!.id];
  const c = card!;

  return (
    <div className="mx-auto max-w-3xl">
      {/* progress */}
      <div className="mb-4">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-xs text-ink2">
          <span className="font-semibold">
            Flashcards · {exam.shortName}
            {domain ? ` · ${domain}` : ""} · {idx + 1}/{deck.length}
          </span>
          <span>
            {gotIt} recalled · {fuzzy} fuzzy
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface2">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${((idx + (verdict !== undefined ? 1 : 0)) / deck.length) * 100}%`, background: color }}
          />
        </div>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[10px]">
        <span className="rounded-full border border-edge bg-surface2 px-2 py-0.5 font-semibold text-ink3">
          {c.domain}
        </span>
        <span className="rounded-full border border-warn/50 bg-warn/10 px-2 py-0.5 font-semibold text-warn">
          missed {c.times_missed}×
        </span>
        {c.sources.map((s) => (
          <span
            key={s}
            className="rounded-full border border-edge bg-surface2 px-2 py-0.5 font-semibold text-ink3"
          >
            {SOURCE_LABEL[s] ?? s}
          </span>
        ))}
        {c.status === "recovered" && (
          <span className="rounded-full border border-good/50 bg-good/10 px-2 py-0.5 font-semibold text-good">
            recovered — bonus rep
          </span>
        )}
      </div>

      {/* ---------- the card ---------- */}
      <section className="card p-6" style={{ borderTopColor: color, borderTopWidth: 3 }}>
        {c.scenario && (
          <p className="mb-2 text-xs font-bold tracking-wide text-accenthi">
            SCENARIO: {c.scenario.toUpperCase()}
          </p>
        )}
        <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{c.stem}</p>
        {c.multi && (
          <p className="mt-2 text-xs font-semibold text-warn">
            The real item asks for {c.select_count} responses.
          </p>
        )}

        {!flipped ? (
          <div className="mt-6 text-center">
            <p className="text-xs text-ink3">
              Answer it in your head first — the retrieval is what builds the memory.
            </p>
            <button className="btn btn-primary mt-3" onClick={() => setFlipped(true)}>
              Show answer
            </button>
            <p className="mt-2 text-[10px] text-ink3">space / enter</p>
          </div>
        ) : (
          <div className="mt-5 space-y-3 border-t border-edge pt-4">
            <div className="space-y-1.5">
              {c.options.map((opt, i) =>
                c.correct.includes(i) ? (
                  <div key={i} className="rounded-lg border border-good bg-good/10 px-3 py-2 text-sm">
                    <p>
                      <span className="mr-2 font-mono font-bold text-ink3">
                        {String.fromCharCode(65 + i)}.
                      </span>
                      {opt}
                      <span className="ml-2 text-xs font-bold text-good">CORRECT</span>
                    </p>
                    {c.rationale.options[i] && (
                      <p className="mt-1 text-xs text-ink2">{c.rationale.options[i]}</p>
                    )}
                  </div>
                ) : null
              )}
            </div>
            {c.last_wrong_answer && c.last_wrong_answer.length > 0 && (
              <p className="text-xs text-ink3">
                You picked{" "}
                <b className="text-bad">
                  {c.last_wrong_answer.map((i) => String.fromCharCode(65 + i)).join(", ")}
                </b>{" "}
                last time.
              </p>
            )}
            <p className="rounded-lg bg-surface2 p-3 text-sm text-ink2">
              <b className="text-ink">Why:</b> {c.rationale.overall}
            </p>
            {c.tip && (
              <p className="text-xs text-ink2">
                <b className="text-accenthi">Study tip:</b> {c.tip}
              </p>
            )}
            <SourceLinks itemId={c.id} domain={c.domain} />
          </div>
        )}
      </section>

      {/* ---------- self-grade ---------- */}
      {flipped && (
        <div className="mt-4">
          {verdict === undefined ? (
            <>
              <div className="flex flex-wrap gap-2">
                <button className="btn btn-ghost flex-1" onClick={() => grade(false)} disabled={busy}>
                  Still fuzzy
                </button>
                <button className="btn btn-primary flex-1" onClick={() => grade(true)} disabled={busy}>
                  Got it
                </button>
              </div>
              <p className="mt-2 text-center text-[10px] text-ink3">
                1 = still fuzzy · 2 = got it. Self-grading moves spaced review up to box 3; only
                graded practice can take an item to 4 or 5.
              </p>
            </>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-lg border px-3 py-2 text-sm font-semibold ${
                  verdict ? "border-good bg-good/10 text-good" : "border-warn bg-warn/10 text-warn"
                }`}
              >
                {verdict ? "Recalled" : "Coming back soon"} · next review in{" "}
                {BOX_LABEL[verdict ? Math.min(3, c.box + 1) : 0]}
              </span>
              <button className="btn btn-primary ml-auto" onClick={advance}>
                {idx < deck.length - 1 ? "Next card →" : "Finish drill"}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="mt-4 flex justify-between text-xs">
        <button
          className="text-ink3 underline hover:text-ink2 disabled:opacity-40"
          onClick={() => {
            setFlipped(false);
            setIdx((i) => Math.max(0, i - 1));
          }}
          disabled={idx === 0}
        >
          ← previous
        </button>
        <button className="text-ink3 underline hover:text-ink2" onClick={finish}>
          End drill
        </button>
      </div>
    </div>
  );
}

function FinishScreen({
  examCode,
  color,
  reviewed,
  gotIt,
  fuzzy,
  deckSize,
  onFinish,
}: {
  examCode: string;
  color: string;
  reviewed: number;
  gotIt: number;
  fuzzy: number;
  deckSize: number;
  /** Non-null when the deck ran out without an explicit "End drill". */
  onFinish: (() => void) | null;
}) {
  // Reaching the end of the deck should still write the chronicle entry.
  useEffect(() => {
    onFinish?.();
  }, [onFinish]);

  return (
    <div className="mx-auto max-w-xl py-10">
      <div className="card p-8 text-center" style={{ borderTopColor: color, borderTopWidth: 3 }}>
        <p className="text-xs font-semibold tracking-wide text-ink3">
          FLASHCARD DRILL COMPLETE · {examCode}
        </p>
        <p className="mt-2 text-4xl font-black">
          {gotIt}/{reviewed}
        </p>
        <p className="text-sm text-ink2">
          recalled from a deck of {deckSize} previously-missed item{deckSize === 1 ? "" : "s"}
        </p>
        {fuzzy > 0 ? (
          <p className="mt-4 text-sm text-ink2">
            The {fuzzy} you marked fuzzy reset to the front of the spaced-review queue and will come
            back within minutes. Prove it on a graded practice set to push them deeper.
          </p>
        ) : (
          <p className="mt-4 text-sm text-ink2">
            Clean pass. Confirm it on a graded practice set — self-grading only carries an item to
            box 3.
          </p>
        )}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Link href={`/practice/${examCode}`} className="btn btn-primary">
            Graded practice
          </Link>
          <Link href={`/flashcards/${examCode}`} className="btn btn-ghost">
            Run the deck again
          </Link>
          <Link href={`/missed?exam=${examCode}`} className="btn btn-ghost">
            Missed answers
          </Link>
        </div>
      </div>
    </div>
  );
}
