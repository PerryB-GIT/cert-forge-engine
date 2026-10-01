"use client";
import type { ReactNode } from "react";
import { SourceLinks } from "@/components/SourceLinks";

/**
 * One reviewed exam item: the stem, every option marked correct / your-answer,
 * the per-option rationale, the overall why, and the study tip.
 *
 * Shared by the post-exam score report (/results/[id]) and the cross-session
 * missed-answer bank (/missed) so a missed item looks the same wherever you meet
 * it. Only render this for questions the user has already answered — it displays
 * the answer key.
 */
export type ReviewableItem = {
  id: string;
  domain: string;
  scenario: string | null;
  stem: string;
  options: string[];
  /** Indices the user picked. null / [] = left unanswered. */
  your_answer: number[] | null;
  correct: number[];
  is_correct: boolean;
  rationale: { overall: string; options: string[] };
  tip: string | null;
};

export function ItemReview({
  item,
  open = false,
  meta,
}: {
  item: ReviewableItem;
  open?: boolean;
  /** Optional badges rendered under the summary line (missed ×N, box, source…). */
  meta?: ReactNode;
}) {
  const yours = item.your_answer ?? [];
  return (
    <details className="card p-4" open={open}>
      <summary className="cursor-pointer text-sm font-semibold">
        <span className={item.is_correct ? "text-good" : "text-bad"}>
          {item.is_correct ? "✓" : "✗"}
        </span>{" "}
        <span className="text-ink3">[{item.domain}]</span> {item.stem.slice(0, 110)}
        {item.stem.length > 110 ? "…" : ""}
      </summary>
      {meta && <div className="mt-2 flex flex-wrap items-center gap-1.5">{meta}</div>}
      <div className="mt-3 space-y-3 border-t border-edge pt-3">
        {item.scenario && (
          <p className="text-xs font-bold text-accenthi">SCENARIO: {item.scenario}</p>
        )}
        <p className="whitespace-pre-wrap text-sm">{item.stem}</p>
        <div className="space-y-1.5">
          {item.options.map((opt, i) => {
            const isCorrect = item.correct.includes(i);
            const chosen = yours.includes(i);
            return (
              <div
                key={i}
                className={`rounded-lg border px-3 py-2 text-sm ${
                  isCorrect
                    ? "border-good bg-good/10"
                    : chosen
                      ? "border-bad bg-bad/10"
                      : "border-edge"
                }`}
              >
                <p>
                  <span className="mr-2 font-mono font-bold text-ink3">
                    {String.fromCharCode(65 + i)}.
                  </span>
                  {opt}
                  {isCorrect && <span className="ml-2 text-xs font-bold text-good">CORRECT</span>}
                  {chosen && !isCorrect && (
                    <span className="ml-2 text-xs font-bold text-bad">YOUR ANSWER</span>
                  )}
                </p>
                {item.rationale.options[i] && (
                  <p className="mt-1 text-xs text-ink2">{item.rationale.options[i]}</p>
                )}
              </div>
            );
          })}
        </div>
        {yours.length === 0 && !item.is_correct && (
          <p className="text-xs font-semibold text-warn">Left unanswered — scored incorrect.</p>
        )}
        <p className="rounded-lg bg-surface2 p-3 text-sm text-ink2">
          <b className="text-ink">Why:</b> {item.rationale.overall}
        </p>
        {item.tip && (
          <p className="text-xs text-ink2">
            <b className="text-accenthi">Study tip:</b> {item.tip}
          </p>
        )}
        <SourceLinks itemId={item.id} domain={item.domain} />
      </div>
    </details>
  );
}

/** Small pill used for the `meta` slot above. */
export function MetaPill({
  children,
  tone = "neutral",
  title,
}: {
  children: ReactNode;
  tone?: "neutral" | "bad" | "good" | "warn" | "accent";
  title?: string;
}) {
  const tones = {
    neutral: "border-edge bg-surface2 text-ink3",
    bad: "border-bad/50 bg-bad/10 text-bad",
    good: "border-good/50 bg-good/10 text-good",
    warn: "border-warn/50 bg-warn/10 text-warn",
    accent: "border-accent/50 bg-accent/15 text-accenthi",
  } as const;
  return (
    <span
      title={title}
      className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
