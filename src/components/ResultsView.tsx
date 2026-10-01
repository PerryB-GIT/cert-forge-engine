"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import { getExam, CUT_PCT } from "@/lib/exams";
import { gradeBand, freshScore, readinessBand, scoreMargin } from "@/lib/scoring";
import { EXAM_COLORS } from "@/lib/ui";
import { retry } from "@/lib/retry";
import { Gauge } from "@/components/Gauge";
import { DomainBars } from "@/components/DomainBars";
import { ItemReview, type ReviewableItem } from "@/components/ItemReview";

type ReviewItem = ReviewableItem & { multi: boolean };

type Payload = {
  session_id: string;
  exam_code: string;
  mode?: "full" | "quick" | "holdout";
  submitted_at: string;
  scaled_score: number;
  weighted_pct: number;
  passed: boolean;
  domain_scores: Record<string, { correct: number; total: number; pct: number }>;
  proctor_events: { type: string; at: string }[];
  review: ReviewItem[];
  fresh_ids?: string[] | null;
};

export function ResultsView({ sessionId }: { sessionId: string }) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<"wrong" | "all">("wrong");

  useEffect(() => {
    retry(async () => {
      const { data, error } = await supabase.rpc("cf_session_review", { p_session: sessionId });
      if (error) throw error;
      return data as Payload;
    })
      .then(setData)
      .catch((e) => setErr(e instanceof Error ? e.message : "Could not load your score report."));
  }, [supabase, sessionId]);

  if (err) return <p className="py-16 text-center text-bad">{err}</p>;
  if (!data) return <p className="py-16 text-center text-ink3">Loading score report…</p>;

  const exam = getExam(data.exam_code)!;
  const color = EXAM_COLORS[data.exam_code];
  const fresh = freshScore(exam.domains, data.review, data.fresh_ids, !!exam.perItemScoring);
  const total = data.review.length;
  const tracked = Array.isArray(data.fresh_ids);
  const freshItems = fresh?.items ?? (tracked ? 0 : total);
  const repeats = total - freshItems;
  // Headline = fresh-item score whenever the sim contained repeats: repeats
  // measure recall of revealed keys, not readiness.
  const useFresh = data.mode !== "quick" && tracked && repeats > 0;
  const headScore = useFresh ? (fresh?.scaled ?? null) : data.scaled_score;
  // Items the headline score rests on — the basis for its margin.
  const headItems = useFresh ? freshItems : total;
  const band = headScore !== null ? readinessBand(headScore, headItems) : null;
  const margin = headScore !== null ? scoreMargin(headScore, headItems) : null;
  // A verdict needs enough fresh items to mean something. Quick tests (2 per
  // domain, ~10-16 items) never get one — their margin is ±150+ points.
  const VERDICT_MIN = 40;
  const verdict = data.mode !== "quick" && freshItems >= VERDICT_MIN && headScore !== null;
  const grade = verdict && headScore !== null ? gradeBand(headScore) : null;
  const wrong = data.review.filter((r) => !r.is_correct);
  const shown = filter === "wrong" ? wrong : data.review;

  // Study pointers: domains ranked by (100 - pct) * weight — most scaled score recoverable
  const pointers = exam.domains
    .map((d) => {
      const s = data.domain_scores[d.name];
      const pct = s ? Number(s.pct) : 0;
      return { name: d.name, weight: d.weight, pct, recoverable: ((100 - pct) * d.weight) / 100 };
    })
    .filter((p) => p.recoverable > 0.01)
    .sort((a, b) => b.recoverable - a.recoverable)
    .slice(0, 3);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* ---------- headline ---------- */}
      <section className="card p-6" style={{ borderTopColor: color, borderTopWidth: 3 }}>
        <p className="text-xs font-semibold tracking-wide text-ink3">
          {data.mode === "quick" ? "QUICK TEST" : data.mode === "holdout" ? "GO / NO-GO FORM" : "SCORE REPORT"} · {data.exam_code} ·{" "}
          {new Date(data.submitted_at).toLocaleString()}
        </p>
        {data.mode === "quick" && (
          <p className="mt-1 text-xs text-ink3">
            Diagnostic scaled score (2 items per domain). Recorded on your Report Card; does not
            change Readiness.
          </p>
        )}
        <div className="mt-2 flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="text-3xl font-bold tracking-tight">
            {data.mode === "quick" ? (
              <span className="text-ink2">DIAGNOSTIC</span>
            ) : !verdict || !band ? (
              <span className="text-warn">NO VERDICT</span>
            ) : band.key === "likely" ? (
              <span className="text-good">LIKELY PASS</span>
            ) : band.key === "borderline" ? (
              <span className="text-warn">BORDERLINE</span>
            ) : (
              <span className="text-bad">NOT YET</span>
            )}{" "}
            · {headScore ?? "—"}
          </h1>
          {grade && (
            <span className="rounded-full border border-edge bg-surface2 px-3 py-1 text-sm font-bold">
              Grade {grade.grade} — {grade.label}
            </span>
          )}
        </div>
        {headScore !== null && (
          <div className="mt-3">
            <Gauge value={headScore} color={color} />
            {margin !== null && (
              <p className="mt-1 text-xs text-ink3">
                ±{margin} points (90% range: {Math.max(100, headScore - margin)}–
                {Math.min(1000, headScore + margin)}) — based on {headItems} item
                {headItems === 1 ? "" : "s"}.
                {data.mode !== "quick" &&
                  " Likely pass needs 800+ with the low end of that range still above 720."}
              </p>
            )}
          </div>
        )}
        <p className="mt-1 text-sm text-ink2">
          {useFresh ? "All items incl. repeats" : exam.perItemScoring ? "Correct" : "Weighted correct"}:{" "}
          <b>{Number(data.weighted_pct).toFixed(1)}%</b>
          {useFresh ? ` (scaled ${data.scaled_score})` : ""} · cut 720 ≈ {Math.round(CUT_PCT)}%
          correct (estimate) ·{" "}
          {verdict &&
            headScore !== null &&
            (headScore >= 800
              ? `${headScore - 800} above the 800 ready line.`
              : headScore >= 720
                ? `above 720 but ${800 - headScore} short of the 800 ready line.`
                : `${720 - headScore} below the 720 cut.`)}{" "}
          {wrong.length} of {data.review.length} items missed.
        </p>
        {tracked && data.mode !== "quick" && (
          <p className="mt-2 rounded-lg border border-edge bg-surface2 px-3 py-2 text-sm text-ink2">
            {repeats === 0
              ? `All ${total} items were new to you, so this is a fresh read.`
              : `Headline is your score on the ${freshItems} of ${total} items you had never seen; ` +
                `${repeats} were repeats and are excluded.`}
            {!verdict &&
              ` Fewer than ${VERDICT_MIN} fresh items, so no verdict — ` +
                (exam.holdoutItems
                  ? "your go/no-go form is the clean read."
                  : "practice on unseen items, then take a full sim once more of the bank is new to you.")}
          </p>
        )}
        {data.proctor_events.length > 0 && (
          <p className="mt-2 rounded-lg border border-warn/50 bg-warn/10 px-3 py-2 text-xs text-warn">
            ⚠ {data.proctor_events.length} proctor event
            {data.proctor_events.length === 1 ? "" : "s"} recorded (tab switches / focus loss /
            fullscreen exits). On the real exam these can void your result — train the habit now.
          </p>
        )}
      </section>

      {/* ---------- domain breakdown ---------- */}
      <section className="card p-5">
        <h2 className="font-bold">Percent correct by domain</h2>
        <p className="mb-3 text-xs text-ink3">
          Exactly what your real score report shows. Bars below the 70% tick are weak domains.
        </p>
        <DomainBars
          rows={exam.domains.map((d) => ({
            name: d.name,
            weight: d.weight,
            pct: data.domain_scores[d.name] ? Number(data.domain_scores[d.name].pct) : null,
          }))}
          color={color}
        />
      </section>

      {/* ---------- pointers ---------- */}
      {pointers.length > 0 && (
        <section className="card p-5">
          <h2 className="font-bold">Where to spend your next study hour</h2>
          <p className="mb-3 text-xs text-ink3">
            Ranked by recoverable scaled score: (100 − your %) × domain weight.
          </p>
          <ol className="space-y-2">
            {pointers.map((p, i) => (
              <li key={p.name} className="flex items-baseline gap-3 text-sm">
                <span className="font-black text-ink3">{i + 1}</span>
                <div>
                  <p className="font-semibold">
                    {p.name}{" "}
                    <span className="text-xs font-normal text-ink3">
                      ({Math.round(p.pct)}% · weight {p.weight}%)
                    </span>
                  </p>
                  <p className="text-xs text-ink2">
                    Worth up to ~{Math.round(p.recoverable * 9)} scaled points. Reread this
                    domain&apos;s objectives in the exam guide, then rework the missed items below.
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* ---------- item review ---------- */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Item review</h2>
          <div className="flex gap-1 rounded-lg border border-edge p-0.5 text-xs font-semibold">
            <button
              onClick={() => setFilter("wrong")}
              className={`rounded-md px-3 py-1 ${filter === "wrong" ? "bg-accent text-white" : "text-ink2"}`}
            >
              Missed ({wrong.length})
            </button>
            <button
              onClick={() => setFilter("all")}
              className={`rounded-md px-3 py-1 ${filter === "all" ? "bg-accent text-white" : "text-ink2"}`}
            >
              All ({data.review.length})
            </button>
          </div>
        </div>

        {shown.length === 0 && (
          <p className="card p-6 text-center text-sm text-good">
            Nothing missed. Comfortable margin indeed.
          </p>
        )}

        {shown.map((r, n) => (
          <ItemReview key={r.id} item={r} open={filter === "wrong" && n < 3} />
        ))}
      </section>

      {/* Every miss here also lands in the permanent bank, so it can be drilled
          long after this one report scrolls out of memory. */}
      {wrong.length > 0 && (
        <section className="card p-5">
          <h2 className="font-bold">Keep working these</h2>
          <p className="mb-3 text-xs text-ink3">
            All {wrong.length} misses were added to your missed-answer bank. Drill them as
            flashcards, or read them in context on the {exam.shortName} study sheet.
          </p>
          <div className="flex flex-wrap gap-2">
            <Link href={`/flashcards/${data.exam_code}`} className="btn btn-primary text-sm">
              Drill as flashcards
            </Link>
            <Link href={`/missed?exam=${data.exam_code}`} className="btn btn-ghost text-sm">
              Missed answers
            </Link>
            <Link href={`/study/${data.exam_code}`} className="btn btn-ghost text-sm">
              Study sheet
            </Link>
          </div>
        </section>
      )}

      <div className="flex gap-2 pb-8">
        <Link href="/" className="btn btn-ghost flex-1">
          Back to Readiness
        </Link>
        <Link href={`/simulate/${data.exam_code}`} className="btn btn-primary flex-1">
          Retake simulation
        </Link>
      </div>
    </div>
  );
}
