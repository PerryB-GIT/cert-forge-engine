"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { getExam } from "@/lib/exams";

type Q = {
  id: string;
  domain: string;
  scenario: string | null;
  stem: string;
  options: string[];
  multi: boolean;
  select_count: number;
};

type Session = {
  session_id: string;
  exam_code: string;
  started_at: string;
  expires_at: string;
  minutes: number;
  scenarios: string[] | null;
  questions: Q[];
};

export function ExamPlayer({
  examCode,
  mode = "full",
}: {
  examCode: string;
  mode?: "full" | "quick" | "holdout";
}) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const router = useRouter();
  const exam = getExam(examCode)!;
  const isQuick = mode === "quick";
  const isHoldout = mode === "holdout";
  const quickItems = exam.domains.length * 2;
  const shownItems = isQuick ? quickItems : isHoldout ? exam.holdoutItems ?? exam.items : exam.items;
  const shownMinutes = isQuick ? Math.max(10, Math.ceil(quickItems * 1.5)) : exam.minutes;

  const [phase, setPhase] = useState<"rules" | "active" | "submitting">("rules");
  const [agreed, setAgreed] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [idx, setIdx] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number[]>>({});
  const [flags, setFlags] = useState<Set<string>>(new Set());
  const [warnings, setWarnings] = useState(0);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [showReview, setShowReview] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const submittingRef = useRef(false);
  // Every cf_save_answer call is chained here: saves land in click order, and
  // submit waits for the chain so a last-second answer is never graded blank.
  const saveChainRef = useRef<Promise<void>>(Promise.resolve());

  // ---- proctor events ----
  const logEvent = useCallback(
    (type: string) => {
      if (!session) return;
      setWarnings((w) => w + 1);
      supabase
        .rpc("cf_proctor_event", {
          p_session: session.session_id,
          p_event: { type },
        })
        .then(() => {});
    },
    [session, supabase]
  );

  useEffect(() => {
    if (phase !== "active" || !session) return;
    const onVis = () => {
      if (document.visibilityState === "hidden") logEvent("tab_hidden");
    };
    const onBlur = () => logEvent("window_blur");
    const onFs = () => {
      if (!document.fullscreenElement) logEvent("fullscreen_exit");
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("blur", onBlur);
    document.addEventListener("fullscreenchange", onFs);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("fullscreenchange", onFs);
    };
  }, [phase, session, logEvent]);

  // ---- timer ----
  const submit = useCallback(async () => {
    if (!session || submittingRef.current) return;
    submittingRef.current = true;
    setPhase("submitting");
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    await saveChainRef.current;
    const { data, error } = await supabase.rpc("cf_submit_session", {
      p_session: session.session_id,
    });
    if (error) {
      setErr(error.message);
      submittingRef.current = false;
      setPhase("active");
      return;
    }
    router.push(`/results/${(data as { session_id: string }).session_id}`);
  }, [session, supabase, router]);

  useEffect(() => {
    if (phase !== "active" || !session) return;
    const end = new Date(session.expires_at).getTime();
    const t = setInterval(() => {
      const left = Math.max(0, Math.floor((end - Date.now()) / 1000));
      setRemaining(left);
      if (left <= 0) {
        clearInterval(t);
        submit();
      }
    }, 500);
    return () => clearInterval(t);
  }, [phase, session, submit]);

  // ---- start ----
  async function begin() {
    setErr(null);
    const { data, error } = await supabase.rpc("cf_start_session", {
      p_exam: examCode,
      p_mode: mode,
    });
    if (error) {
      setErr(error.message);
      return;
    }
    setSession(data as Session);
    setPhase("active");
    document.documentElement.requestFullscreen?.().catch(() => {});
  }

  // ---- answers ----
  function select(q: Q, optIdx: number) {
    if (submittingRef.current) return;
    const cur = answers[q.id] ?? [];
    let next: number[];
    if (!q.multi) {
      next = [optIdx];
    } else if (cur.includes(optIdx)) {
      next = cur.filter((i) => i !== optIdx);
    } else if (cur.length < q.select_count) {
      next = [...cur, optIdx].sort((a, b) => a - b);
    } else {
      return; // at select limit
    }
    setAnswers((prev) => ({ ...prev, [q.id]: next }));
    if (session) {
      const sessionId = session.session_id;
      saveChainRef.current = saveChainRef.current.then(async () => {
        const { error } = await supabase.rpc("cf_save_answer", {
          p_session: sessionId,
          p_qid: q.id,
          p_answer: next,
        });
        if (error) setErr(`Save failed: ${error.message}`);
      });
    }
  }

  // ================= RULES =================
  if (phase === "rules") {
    return (
      <div className="mx-auto max-w-2xl space-y-5">
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-black tracking-wide ${
              isQuick ? "bg-accent/20 text-accenthi" : "bg-good/20 text-good"
            }`}
          >
            {isQuick ? "QUICK TEST" : isHoldout ? "GO / NO-GO" : "FULL EXAM"}
          </span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight">{exam.name}</h1>
        <p className="text-sm text-ink3">
          {exam.code} · {shownItems} items · {shownMinutes} minutes · cut score 720 (100–1000 scale)
          {isHoldout
            ? " · sealed form: items you have never practised, all 6 scenarios"
            : !isQuick && exam.scenarioBank
              ? " · 4 of 6 scenarios drawn at random"
              : ""}
        </p>

        <section className="card space-y-3 p-5 text-sm text-ink2">
          <h2 className="font-bold text-ink">
            {isQuick
              ? "Quick test — a fast diagnostic across every domain"
              : "Simulated exam rules — mirroring the real thing"}
          </h2>
          {isQuick && (
            <p className="rounded-lg border border-edge bg-surface2 p-3">
              A short {shownItems}-item diagnostic: 2 questions from each of the{" "}
              {exam.domains.length} domains, so you get a real scaled score and a full domain
              breakdown in a fraction of the time. It lands on your Report Card but does not change
              your Readiness or award exam-ready badges — only a full sim does that.
            </p>
          )}
          <ul className="list-inside list-disc space-y-1.5">
            <li>
              <b>{shownMinutes} minutes, one sitting.</b> The clock starts when you click Begin and
              does not pause. At 0:00 it auto-submits with whatever you&apos;ve answered.
            </li>
            <li>
              <b>Simulated proctoring.</b> The exam requests fullscreen. Leaving the tab, switching
              windows, or exiting fullscreen is logged as a proctor event and appears on your score
              report — on the real exam it can end your session.
            </li>
            <li>
              <b>Item formats.</b> Multiple-choice and multiple-response; each item states how many
              responses to select. Unanswered items score as incorrect.
            </li>
            <li>
              <b>Navigation.</b> Move freely, flag items for review, and use the review screen
              before submitting — same as Pearson VUE.
            </li>
            <li>
              <b>Scoring.</b> Criterion-referenced: pass/fail with a scaled score (100–1000, cut
              720) plus percent-correct by domain — exactly like your real score report.
            </li>
          </ul>
        </section>

        <section className="card space-y-3 p-5 text-sm text-ink2">
          <h2 className="font-bold text-ink">Agreement</h2>
          <p>
            The real exam begins with a confidentiality and non-disclosure agreement; declining ends
            the session. This simulator mirrors that gate. These practice items are original
            content written against the public exam-guide blueprints — you also agree not to share
            real Anthropic exam content here or anywhere.
          </p>
          <label className="flex cursor-pointer items-start gap-2 font-semibold text-ink">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-0.5"
            />
            I accept and I&apos;m ready to sit the {isQuick ? `${shownMinutes}-minute quick test` : `full ${shownMinutes}-minute exam`}.
          </label>
        </section>

        {err && <p className="text-sm text-bad">{err}</p>}
        <button className="btn btn-primary w-full" disabled={!agreed} onClick={begin}>
          {isQuick ? "Begin quick test" : "Begin exam"} — clock starts now
        </button>
      </div>
    );
  }

  // ================= SUBMITTING =================
  if (phase === "submitting" || !session) {
    return (
      <div className="py-24 text-center">
        <p className="text-lg font-bold">Scoring your exam…</p>
        <p className="mt-1 text-sm text-ink3">Grading server-side, logging attempts, checking badges.</p>
      </div>
    );
  }

  // ================= ACTIVE =================
  const qs = session.questions;
  const q = qs[idx];
  const answered = Object.keys(answers).filter((k) => answers[k]?.length > 0).length;
  const mins = remaining === null ? exam.minutes : Math.floor(remaining / 60);
  const secs = remaining === null ? 0 : remaining % 60;
  const low = remaining !== null && remaining < 300;

  return (
    <div className="mx-auto max-w-3xl">
      {/* status bar */}
      <div className="sticky top-14 z-30 mb-4 flex items-center justify-between gap-2 rounded-xl border border-edge bg-surface px-4 py-2">
        <span className="text-xs font-semibold text-ink2">
          {session.exam_code} · Item {idx + 1}/{qs.length} · {answered} answered
          {flags.size > 0 ? ` · ${flags.size} flagged` : ""}
        </span>
        <div className="flex items-center gap-3">
          {warnings > 0 && (
            <span className="rounded-full bg-warn/20 px-2 py-0.5 text-xs font-bold text-warn"
              title="Proctor events: tab switches, window blur, fullscreen exits">
              ⚠ {warnings}
            </span>
          )}
          <span
            className={`font-mono text-sm font-black tabular-nums ${low ? "text-bad" : "text-ink"}`}
          >
            {String(mins).padStart(2, "0")}:{String(secs).padStart(2, "0")}
          </span>
        </div>
      </div>

      {err && (
        <p className="mb-3 rounded-lg border border-bad bg-bad/10 px-3 py-2 text-sm text-bad">{err}</p>
      )}

      {showReview ? (
        <ReviewScreen
          qs={qs}
          answers={answers}
          flags={flags}
          goTo={(i) => {
            setIdx(i);
            setShowReview(false);
          }}
          onSubmit={submit}
          onBack={() => setShowReview(false)}
        />
      ) : (
        <>
          {q.scenario && (
            <p className="mb-2 text-xs font-bold tracking-wide text-accenthi">
              SCENARIO: {q.scenario.toUpperCase()}
            </p>
          )}
          <section className="card p-5">
            <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{q.stem}</p>
            {q.multi && (
              <p className="mt-2 text-xs font-semibold text-warn">
                Select {q.select_count} responses.
              </p>
            )}
            <div className="mt-4 space-y-2">
              {q.options.map((opt, i) => {
                const sel = (answers[q.id] ?? []).includes(i);
                return (
                  <button
                    key={i}
                    onClick={() => select(q, i)}
                    className={`block w-full rounded-lg border px-4 py-3 text-left text-sm transition ${
                      sel
                        ? "border-accent bg-accent/15 font-semibold"
                        : "border-edge bg-surface2 hover:border-ink3"
                    }`}
                  >
                    <span className="mr-2 font-mono font-bold text-ink3">
                      {String.fromCharCode(65 + i)}.
                    </span>
                    {opt}
                  </button>
                );
              })}
            </div>
          </section>

          <div className="mt-4 flex items-center justify-between gap-2">
            <button className="btn btn-ghost text-sm" onClick={() => setIdx(Math.max(0, idx - 1))} disabled={idx === 0}>
              ← Previous
            </button>
            <button
              className={`btn text-sm ${flags.has(q.id) ? "btn-primary" : "btn-ghost"}`}
              onClick={() =>
                setFlags((f) => {
                  const n = new Set(f);
                  if (n.has(q.id)) n.delete(q.id);
                  else n.add(q.id);
                  return n;
                })
              }
            >
              {flags.has(q.id) ? "⚑ Flagged" : "⚐ Flag for review"}
            </button>
            {idx < qs.length - 1 ? (
              <button className="btn btn-ghost text-sm" onClick={() => setIdx(idx + 1)}>
                Next →
              </button>
            ) : (
              <button className="btn btn-primary text-sm" onClick={() => setShowReview(true)}>
                Review & submit
              </button>
            )}
          </div>

          {/* navigator */}
          <div className="mt-5 flex flex-wrap gap-1.5">
            {qs.map((qq, i) => {
              const done = (answers[qq.id] ?? []).length > 0;
              const flagged = flags.has(qq.id);
              return (
                <button
                  key={qq.id}
                  onClick={() => setIdx(i)}
                  title={`Item ${i + 1}${done ? " · answered" : ""}${flagged ? " · flagged" : ""}`}
                  className={`h-8 w-8 rounded-md text-xs font-bold transition ${
                    i === idx
                      ? "bg-accent text-white"
                      : done
                        ? "bg-surface2 text-ink"
                        : "bg-surface text-ink3 border border-edge"
                  } ${flagged ? "ring-2 ring-warn" : ""}`}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>
          <button
            className="mt-4 w-full rounded-lg border border-edge py-2 text-sm font-semibold text-ink2 hover:bg-surface2"
            onClick={() => setShowReview(true)}
          >
            Go to review screen
          </button>
        </>
      )}
    </div>
  );
}

function ReviewScreen({
  qs,
  answers,
  flags,
  goTo,
  onSubmit,
  onBack,
}: {
  qs: Q[];
  answers: Record<string, number[]>;
  flags: Set<string>;
  goTo: (i: number) => void;
  onSubmit: () => void;
  onBack: () => void;
}) {
  const unanswered = qs
    .map((q, i) => ({ q, i }))
    .filter(({ q }) => (answers[q.id] ?? []).length === 0);
  const flagged = qs.map((q, i) => ({ q, i })).filter(({ q }) => flags.has(q.id));
  const [confirm, setConfirm] = useState(false);

  return (
    <section className="card space-y-4 p-5">
      <h2 className="text-lg font-bold">Review screen</h2>
      <p className="text-sm text-ink2">
        {qs.length - unanswered.length} of {qs.length} answered · {flagged.length} flagged.
        Unanswered items score as incorrect.
      </p>

      {unanswered.length > 0 && (
        <div>
          <p className="text-sm font-semibold text-warn">Unanswered</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {unanswered.map(({ i }) => (
              <button key={i} onClick={() => goTo(i)}
                className="h-8 w-8 rounded-md border border-warn text-xs font-bold text-warn hover:bg-warn/10">
                {i + 1}
              </button>
            ))}
          </div>
        </div>
      )}

      {flagged.length > 0 && (
        <div>
          <p className="text-sm font-semibold text-ink2">Flagged for review</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {flagged.map(({ i }) => (
              <button key={i} onClick={() => goTo(i)}
                className="h-8 w-8 rounded-md border border-edge text-xs font-bold text-ink2 ring-2 ring-warn hover:bg-surface2">
                {i + 1}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2 pt-2">
        <button className="btn btn-ghost flex-1" onClick={onBack}>
          Back to exam
        </button>
        {confirm ? (
          <button className="btn btn-primary flex-1" onClick={onSubmit}>
            Confirm — end exam and score it
          </button>
        ) : (
          <button className="btn btn-primary flex-1" onClick={() => setConfirm(true)}>
            End exam
          </button>
        )}
      </div>
    </section>
  );
}
