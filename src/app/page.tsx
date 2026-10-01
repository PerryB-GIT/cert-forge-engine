"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAsyncData } from "@/lib/useAsyncData";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase/client";
import { EXAMS, CUT_PCT } from "@/lib/exams";
import {
  toDomainScores,
  scaledScore,
  pointsFromCut,
  biggestLever,
  readinessBand,
  isReady,
  pooledReadiness,
  READINESS_MIN_ITEMS,
  type Pooled,
} from "@/lib/scoring";
import { EXAM_COLORS, BADGES, latestByDomain, type Attempt } from "@/lib/ui";
import { retry } from "@/lib/retry";
import { LoadError } from "@/components/LoadError";
import { Gauge } from "@/components/Gauge";
import { DomainBars } from "@/components/DomainBars";
import { TrendLine } from "@/components/TrendLine";
import { ConsistencyCard } from "@/components/ConsistencyCard";
import { AccountCard } from "@/components/AccountCard";

type Profile = { id: string; display_name: string };

export default function ReadinessPage() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const load = useCallback(
    () =>
      retry(async () => {
        const { data: userData } = await supabase.auth.getUser();
        const uid = userData.user?.id;
        if (!uid) throw new Error("no-session");
        const [
          { data: prof },
          { data: atts, error: e1 },
          { data: ach },
          { data: rc },
          { data: miss },
          { data: pooled, error: e2 },
        ] = await Promise.all([
            supabase.from("cf_profiles").select("id, display_name").eq("id", uid).maybeSingle(),
            supabase.from("cf_attempts").select("*").order("created_at", { ascending: true }),
            supabase.from("cf_achievements").select("badge_id"),
            supabase.rpc("cf_review_counts"),
            supabase.rpc("cf_missed_items", { p_exam: null }),
            supabase.rpc("cf_readiness"),
          ]);
        if (e1 || e2) throw e1 ?? e2;
        const shaky: Record<string, number> = {};
        for (const m of (miss as { exam_code: string; status: string }[]) ?? []) {
          if (m.status === "shaky") shaky[m.exam_code] = (shaky[m.exam_code] ?? 0) + 1;
        }
        return {
          profile: (prof as Profile) ?? null,
          attempts: (atts as Attempt[]) ?? [],
          badges: ((ach as { badge_id: string }[]) ?? []).map((a) => a.badge_id),
          reviewCounts: (rc as Record<string, { due: number; new: number }>) ?? {},
          shaky,
          pooled: (pooled as Record<string, Pooled>) ?? {},
        };
      }),
    [supabase]
  );
  const { data, failed, reload } = useAsyncData(load);
  const profile = data?.profile;
  const orphaned = data !== null && data.profile === null;

  // Name-login sets the profile at sign-in, so a signed-in session should always have one.
  // The only way here is an orphaned session (profile deleted) — send it back to the front door.
  useEffect(() => {
    if (orphaned) {
      supabase.auth.signOut().finally(() => window.location.assign("/login"));
    }
  }, [orphaned, supabase]);

  if (failed) return <LoadError onRetry={reload} />;

  if (!data || !profile) {
    return <p className="py-16 text-center text-ink3">Loading…</p>;
  }

  const { attempts, badges, reviewCounts, shaky: shakyByExam, pooled } = data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Readiness</h1>
          <p className="text-sm text-ink2">
            The real cut is a scaled 720; here that&apos;s roughly{" "}
            <span className="font-semibold text-ink">{Math.round(CUT_PCT)}% correct</span> — an
            estimate, since Anthropic doesn&apos;t publish the raw cut. Read scores as a band:{" "}
            <span className="font-semibold text-ink">800+</span> likely pass, 720–799 borderline.
            Log domain scores or run a{" "}
            <Link href="/simulate" className="text-accenthi underline">
              full simulated exam
            </Link>
            .
          </p>
        </div>
        {badges.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {badges.map((b) => (
              <span
                key={b}
                title={BADGES[b]?.desc ?? b}
                className="rounded-full border border-edge bg-surface2 px-2.5 py-1 text-xs font-semibold"
              >
                <span className="text-accenthi">{BADGES[b]?.icon ?? "•"}</span>{" "}
                {BADGES[b]?.label ?? b}
              </span>
            ))}
          </div>
        )}
      </div>

      <AccountCard />
      <ConsistencyCard />

      <div className="grid gap-5 lg:grid-cols-2">
        {EXAMS.map((exam) => (
          <ExamCard
            key={exam.code}
            exam={exam}
            attempts={attempts}
            pooled={pooled[exam.code] ?? null}
            reviewDue={reviewCounts[exam.code]?.due ?? 0}
            shaky={shakyByExam[exam.code] ?? 0}
            onLogged={reload}
          />
        ))}
      </div>
    </div>
  );
}

function ExamCard({
  exam,
  attempts,
  pooled,
  reviewDue,
  shaky,
  onLogged,
}: {
  exam: (typeof EXAMS)[number];
  attempts: Attempt[];
  /** Fresh sim items pooled server-side (cf_readiness); null when no sims yet. */
  pooled: Pooled | null;
  reviewDue: number;
  /** Items missed on this exam that have not yet recovered. */
  shaky: number;
  onLogged: () => void;
}) {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [logErr, setLogErr] = useState<string | null>(null);
  const [showTrend, setShowTrend] = useState(false);

  // Two sources, in order of trust: (1) fresh sim items pooled over recent sims,
  // item-level — the only source with enough items to mean something; (2) the
  // latest manually logged score per domain, when no sim has been taken yet.
  const pr = pooledReadiness(exam, pooled);
  const fromSims = pr !== null;
  const latest = latestByDomain(attempts, exam.code);
  const logged = toDomainScores(exam.domains, latest);
  const scores = fromSims ? pr.domainScores : logged;
  const scaled = fromSims ? pr.scaled : scaledScore(logged);
  const pts = fromSims ? pr.scaled - 720 : pointsFromCut(logged);
  const lever = biggestLever(scores);
  const color = EXAM_COLORS[exam.code];
  const loggedCount = Object.keys(latest).length;
  // "complete" = enough evidence for a verdict under the active source.
  const complete = fromSims ? pr.verdict : loggedCount >= exam.domains.length;
  const band = scaled === null ? null : readinessBand(scaled, fromSims ? pr.items : undefined);
  const ready = fromSims ? pr.ready : isReady(logged, exam.domains.length);
  const barPct: Record<string, number> = fromSims
    ? Object.fromEntries(pr.domainScores.map((d) => [d.name, Math.round(d.pct)]))
    : latest;

  const trend = useMemo(() => {
    const rows = attempts
      .filter((a) => a.exam_code === exam.code)
      .sort(
        (a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime() || a.id - b.id
      );
    const acc: Record<string, number> = {};
    const out: { at: Date; scaled: number }[] = [];
    for (const r of rows) {
      acc[r.domain_name] = Number(r.pct_correct);
      const s = scaledScore(toDomainScores(exam.domains, acc));
      if (s !== null) out.push({ at: new Date(r.created_at), scaled: s });
    }
    return out;
  }, [attempts, exam]);

  async function logScores() {
    setBusy(true);
    const rows = Object.entries(inputs)
      .filter(([, v]) => v !== "" && !Number.isNaN(Number(v)))
      .map(([domain, v]) => ({
        exam_code: exam.code,
        domain_name: domain,
        pct_correct: Math.min(100, Math.max(0, Number(v))),
      }));
    setLogErr(null);
    if (rows.length) {
      const { data: userData } = await supabase.auth.getUser();
      const uid = userData.user?.id;
      const { error } = uid
        ? await supabase
            .from("cf_attempts")
            .insert(rows.map((r) => ({ ...r, user_id: uid, source: "manual" })))
        : { error: { message: "You are signed out — sign in again, then re-enter the scores." } };
      if (error) {
        // Keep the typed scores so nothing is lost; say what happened.
        setLogErr(`Scores not saved: ${error.message}`);
      } else {
        setInputs({});
        onLogged();
      }
    }
    setBusy(false);
  }

  return (
    <section className="card p-5" style={{ borderTopColor: color, borderTopWidth: 3 }}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-bold">{exam.name}</h2>
          <p className="text-xs text-ink3">
            {exam.code} · {exam.items} items · ${exam.fee} · {exam.minutes} min · {loggedCount}/
            {exam.domains.length} domains logged
          </p>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-bold ${
            scaled === null || !complete
              ? "bg-surface2 text-ink3"
              : ready
                ? "bg-good/20 text-good"
                : band?.key === "borderline"
                  ? "bg-warn/20 text-warn"
                  : "bg-bad/20 text-bad"
          }`}
          title={
            !complete && scaled !== null
              ? fromSims
                ? `A verdict needs ${READINESS_MIN_ITEMS} fresh sim items${exam.perItemScoring ? "" : " covering every domain"}.`
                : "Readiness needs a score in every domain — missing domains would otherwise drop out of the average."
              : undefined
          }
        >
          {scaled === null
            ? "NO DATA"
            : !complete
              ? fromSims
                ? `${Math.min(pr.items, READINESS_MIN_ITEMS)}/${READINESS_MIN_ITEMS} FRESH`
                : `PARTIAL ${loggedCount}/${exam.domains.length}`
              : ready
                ? "READY"
                : band?.key === "borderline"
                  ? "BORDERLINE"
                  : `${pts} PTS`}
        </span>
      </div>

      <div className="mt-3">
        <Gauge value={scaled} color={color} />
      </div>
      {scaled !== null && (
        <p className="mt-1 text-[11px] text-ink3">
          {fromSims
            ? `±${pr.margin} (90%) · from ${pr.items} fresh item${pr.items === 1 ? "" : "s"} across your last ${pooled!.sims} sim${pooled!.sims === 1 ? "" : "s"}` +
              (exam.perItemScoring ? ", scored per item." : ", weighted by domain.")
            : "From your latest logged domain scores — a full sim replaces this with item-level data."}
        </p>
      )}

      {lever && (
        <p className="mt-1 text-xs text-ink2">
          Biggest lever: <span className="font-semibold text-ink">{lever.name}</span> — most
          score still on the table (weight × what you&apos;re missing).
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <Link
          href={`/practice/${exam.code}`}
          className="inline-flex items-center gap-2 rounded-lg border border-edge bg-surface2 px-3 py-1.5 text-xs font-semibold transition hover:border-ink3"
        >
          <span className="text-accenthi">↻ Practice</span>
          {reviewDue > 0 ? (
            <span className="rounded-full bg-accent/20 px-2 py-0.5 text-accenthi">
              {reviewDue} due
            </span>
          ) : (
            <span className="text-ink3">retrieval + spaced review</span>
          )}
        </Link>
        {shaky > 0 && (
          <Link
            href={`/flashcards/${exam.code}`}
            className="inline-flex items-center gap-2 rounded-lg border border-edge bg-surface2 px-3 py-1.5 text-xs font-semibold transition hover:border-ink3"
          >
            <span className="text-accenthi">◆ Flashcards</span>
            <span className="rounded-full bg-bad/20 px-2 py-0.5 text-bad">{shaky} still missed</span>
          </Link>
        )}
        <Link
          href={`/study/${exam.code}`}
          className="inline-flex items-center gap-2 rounded-lg border border-edge bg-surface2 px-3 py-1.5 text-xs font-semibold text-ink2 transition hover:border-ink3 hover:text-ink"
        >
          ▤ Study sheet
        </Link>
      </div>

      <div className="mt-4">
        <DomainBars
          rows={exam.domains.map((d) => ({
            name: d.name,
            weight: d.weight,
            pct: barPct[d.name] ?? null,
          }))}
          color={color}
        />
      </div>

      <details className="mt-4">
        <summary className="cursor-pointer text-sm font-semibold text-ink2 hover:text-ink">
          Log domain scores (0–100)
        </summary>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {exam.domains.map((d) => (
            <label key={d.name} className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate text-ink2" title={d.name}>
                {d.name}
              </span>
              <input
                type="number"
                min={0}
                max={100}
                value={inputs[d.name] ?? ""}
                placeholder={
                  latest[d.name] !== undefined ? String(Math.round(latest[d.name])) : "—"
                }
                onChange={(e) => setInputs((s) => ({ ...s, [d.name]: e.target.value }))}
                className="w-20 text-right"
              />
            </label>
          ))}
        </div>
        <button className="btn btn-primary mt-3 text-sm" onClick={logScores} disabled={busy}>
          {busy ? "Logging…" : "Log scores"}
        </button>
        {logErr && (
          <p role="alert" className="mt-2 text-xs text-bad">
            {logErr}
          </p>
        )}
      </details>

      <button
        className="mt-3 text-xs text-ink3 underline hover:text-ink2"
        onClick={() => setShowTrend((s) => !s)}
      >
        {showTrend ? "Hide trend" : "Show trend"}
      </button>
      {showTrend && (
        <div className="mt-2">
          <TrendLine points={trend} color={color} />
        </div>
      )}
    </section>
  );
}
