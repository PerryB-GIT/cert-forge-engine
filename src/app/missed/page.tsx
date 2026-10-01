"use client";
import { Suspense, useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { EXAMS, getExam } from "@/lib/exams";
import { EXAM_COLORS } from "@/lib/ui";
import { retry } from "@/lib/retry";
import { useAsyncData } from "@/lib/useAsyncData";
import { LoadError } from "@/components/LoadError";
import { StudyNav } from "@/components/StudyNav";
import { ItemReview, MetaPill } from "@/components/ItemReview";
import {
  filterMissed,
  groupByDomain,
  countByStatus,
  totalMisses,
  toReviewable,
  SOURCE_LABEL,
  type MissedItem,
  type SourceFilter,
  type StatusFilter,
} from "@/lib/missed";

export default function MissedPage() {
  return (
    <Suspense fallback={<p className="py-16 text-center text-ink3">Loading missed answers…</p>}>
      <MissedBank />
    </Suspense>
  );
}

function MissedBank() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const search = useSearchParams();
  const [exam, setExam] = useState<string | null>(search.get("exam"));
  const [source, setSource] = useState<SourceFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("shaky");
  const [domain, setDomain] = useState<string | null>(null);

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

  if (failed) return <LoadError onRetry={reload} label="Couldn't load your missed answers yet." />;
  if (items === null) return <p className="py-16 text-center text-ink3">Loading missed answers…</p>;

  const examsWithMisses = EXAMS.filter((e) => items.some((m) => m.exam_code === e.code));
  const scoped = exam ? items.filter((m) => m.exam_code === exam) : items;
  // Domain chips follow the exam scope but not the status/source filters, so a
  // domain doesn't vanish from the picker the moment you filter its items out.
  const domains = [...new Set(scoped.map((m) => m.domain))].sort();
  const shown = filterMissed(scoped, { source, status, domain });
  const grouped = groupByDomain(shown);
  const split = countByStatus(scoped);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Missed answers</h1>
        <p className="text-sm text-ink2">
          Every item you have ever gotten wrong — in a full exam, a quick test, or practice — with
          the answer, the reasoning, and how many times it has caught you. An item becomes{" "}
          <b className="text-good">recovered</b> once you answer it correctly and spaced review has
          it at least two boxes deep.
        </p>
      </div>

      <StudyNav />

      {items.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-ink2">Nothing missed yet — nothing to review.</p>
          <p className="mt-1 text-xs text-ink3">
            This bank fills itself from your exam simulations and practice sets. Anything you get
            wrong lands here permanently, with the answer and the reasoning.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Link href="/practice" className="btn btn-ghost">
              Start practice
            </Link>
            <Link href="/simulate" className="btn btn-primary">
              Take a quick test
            </Link>
          </div>
        </div>
      ) : (
        <>
          {/* ---------- scope + filters ---------- */}
          <div className="card space-y-3 p-4">
            <FilterRow label="Exam">
              <Chip
                active={exam === null}
                onClick={() => {
                  setExam(null);
                  setDomain(null);
                }}
              >
                All ({items.length})
              </Chip>
              {examsWithMisses.map((e) => (
                <Chip
                  key={e.code}
                  active={exam === e.code}
                  color={EXAM_COLORS[e.code]}
                  onClick={() => {
                    setExam(e.code);
                    setDomain(null);
                  }}
                >
                  {e.code} ({items.filter((m) => m.exam_code === e.code).length})
                </Chip>
              ))}
            </FilterRow>

            <FilterRow label="Missed in">
              {(
                [
                  ["all", "Everything"],
                  ["sim", "Exam sims"],
                  ["practice", "Practice"],
                ] as [SourceFilter, string][]
              ).map(([k, label]) => (
                <Chip key={k} active={source === k} onClick={() => setSource(k)}>
                  {label}
                </Chip>
              ))}
            </FilterRow>

            <FilterRow label="Status">
              <Chip active={status === "shaky"} onClick={() => setStatus("shaky")}>
                Still shaky ({split.shaky})
              </Chip>
              <Chip active={status === "recovered"} onClick={() => setStatus("recovered")}>
                Recovered ({split.recovered})
              </Chip>
              <Chip active={status === "all"} onClick={() => setStatus("all")}>
                All ({scoped.length})
              </Chip>
            </FilterRow>

            {domains.length > 1 && (
              <FilterRow label="Domain">
                <Chip active={domain === null} onClick={() => setDomain(null)}>
                  All domains
                </Chip>
                {domains.map((d) => (
                  <Chip key={d} active={domain === d} onClick={() => setDomain(d)}>
                    {d}
                  </Chip>
                ))}
              </FilterRow>
            )}
          </div>

          {/* ---------- drill actions ---------- */}
          {exam && (
            <div className="flex flex-wrap gap-2">
              <Link
                href={`/flashcards/${exam}${domain ? `?domain=${encodeURIComponent(domain)}` : ""}`}
                className="btn btn-primary text-sm"
              >
                Drill {domain ? "this domain" : `all ${scoped.length}`} as flashcards
              </Link>
              <Link href={`/study/${exam}`} className="btn btn-ghost text-sm">
                {getExam(exam)?.shortName} study sheet
              </Link>
              <Link href={`/practice/${exam}`} className="btn btn-ghost text-sm">
                Practice set
              </Link>
            </div>
          )}

          {/* ---------- the bank ---------- */}
          {shown.length === 0 ? (
            <p className="card p-8 text-center text-sm text-ink2">
              Nothing matches these filters.{" "}
              {status === "shaky" && split.shaky === 0 && scoped.length > 0 && (
                <span className="text-good">
                  Everything in scope has recovered — switch to &ldquo;Recovered&rdquo; to review it
                  anyway.
                </span>
              )}
            </p>
          ) : (
            <div className="space-y-6">
              {grouped.map((g) => (
                <section key={g.domain} className="space-y-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="font-bold">{g.domain}</h2>
                    <p className="text-xs text-ink3">
                      {g.items.length} item{g.items.length === 1 ? "" : "s"} · {totalMisses(g.items)}{" "}
                      total misses
                    </p>
                  </div>
                  {g.items.map((m) => (
                    <ItemReview key={m.id} item={toReviewable(m)} meta={<ItemMeta m={m} />} />
                  ))}
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ItemMeta({ m }: { m: MissedItem }) {
  return (
    <>
      <MetaPill tone={m.status === "recovered" ? "good" : "bad"}>
        {m.status === "recovered" ? "recovered" : "still shaky"}
      </MetaPill>
      <MetaPill tone="warn">missed {m.times_missed}×</MetaPill>
      {m.sources.map((s) => (
        <MetaPill key={s}>{SOURCE_LABEL[s] ?? s}</MetaPill>
      ))}
      {m.last_unanswered && <MetaPill tone="warn">last left blank</MetaPill>}
      <MetaPill tone="accent" title="Leitner spaced-review box, 0-5. Higher = longer interval.">
        box {m.box}/5
      </MetaPill>
      {m.last_missed_at && (
        <MetaPill>last missed {new Date(m.last_missed_at).toLocaleDateString()}</MetaPill>
      )}
    </>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="w-20 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-ink3">
        {label}
      </span>
      {children}
    </div>
  );
}

function Chip({
  active,
  onClick,
  color,
  children,
}: {
  active: boolean;
  onClick: () => void;
  color?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={active && color ? { background: color, borderColor: color, color: "#fff" } : undefined}
      className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition ${
        active
          ? "border-accent bg-accent text-white"
          : "border-edge bg-surface2 text-ink2 hover:border-ink3 hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
