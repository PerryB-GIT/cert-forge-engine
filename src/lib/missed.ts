import type { ReviewableItem } from "@/components/ItemReview";

/** One row from the cf_missed_items RPC. */
export type MissedItem = {
  id: string;
  exam_code: string;
  domain: string;
  scenario: string | null;
  stem: string;
  options: string[];
  correct: number[];
  multi: boolean;
  select_count: number;
  rationale: { overall: string; options: string[] };
  tip: string | null;
  /** How many times this item has been answered wrong, across every mode. */
  times_missed: number;
  times_answered: number;
  /** Distinct modes it was missed in: "full" | "quick" | "practice" | "flashcard". */
  sources: MissSource[];
  last_missed_at: string | null;
  last_missed_source: MissSource | null;
  last_wrong_answer: number[] | null;
  /** The last miss was a blank — ran out of time or skipped it. */
  last_unanswered: boolean;
  box: number;
  times_seen: number;
  times_correct: number;
  due_at: string | null;
  /**
   * "recovered" = last answered correctly AND at least two Leitner boxes deep.
   * Everything else is still worklist. Computed server-side in cf_missed_items.
   */
  status: "shaky" | "recovered";
};

export type MissSource = "full" | "quick" | "practice" | "flashcard";

export const SOURCE_LABEL: Record<MissSource, string> = {
  full: "Full exam",
  quick: "Quick test",
  practice: "Practice",
  flashcard: "Flashcard",
};

/** Which modes each filter tab covers. */
export const SOURCE_GROUPS = {
  all: ["full", "quick", "practice", "flashcard"],
  sim: ["full", "quick"],
  practice: ["practice", "flashcard"],
} as const satisfies Record<string, readonly MissSource[]>;

export type SourceFilter = keyof typeof SOURCE_GROUPS;
export type StatusFilter = "shaky" | "recovered" | "all";

export type MissedFilters = {
  source?: SourceFilter;
  status?: StatusFilter;
  domain?: string | null;
};

export function filterMissed(items: MissedItem[], f: MissedFilters = {}): MissedItem[] {
  const { source = "all", status = "all", domain = null } = f;
  const allowed = SOURCE_GROUPS[source] as readonly MissSource[];
  return items.filter((m) => {
    if (domain && m.domain !== domain) return false;
    if (status !== "all" && m.status !== status) return false;
    if (source !== "all" && !m.sources.some((s) => allowed.includes(s))) return false;
    return true;
  });
}

/**
 * Group into domain buckets, worst first. "Worst" is total misses, not item
 * count — three items missed twice each outranks four missed once.
 */
export function groupByDomain(items: MissedItem[]): { domain: string; items: MissedItem[] }[] {
  const byDomain = new Map<string, MissedItem[]>();
  for (const m of items) {
    const bucket = byDomain.get(m.domain);
    if (bucket) bucket.push(m);
    else byDomain.set(m.domain, [m]);
  }
  return [...byDomain.entries()]
    .map(([domain, rows]) => ({ domain, items: rows }))
    .sort((a, b) => totalMisses(b.items) - totalMisses(a.items) || a.domain.localeCompare(b.domain));
}

export function totalMisses(items: MissedItem[]): number {
  return items.reduce((n, m) => n + m.times_missed, 0);
}

export function countByStatus(items: MissedItem[]): { shaky: number; recovered: number } {
  let shaky = 0;
  for (const m of items) if (m.status === "shaky") shaky++;
  return { shaky, recovered: items.length - shaky };
}

/** Adapt a bank row for the shared <ItemReview> renderer. */
export function toReviewable(m: MissedItem): ReviewableItem {
  return {
    id: m.id,
    domain: m.domain,
    scenario: m.scenario,
    stem: m.stem,
    options: m.options,
    // The bank exists because it was wrong, so the answer shown is the last
    // wrong one — even for an item that has since recovered.
    your_answer: m.last_wrong_answer,
    correct: m.correct,
    is_correct: false,
    rationale: m.rationale,
    tip: m.tip,
  };
}

/**
 * Deck order for a flashcard drill: shakiest first, then most-missed, then
 * shallowest Leitner box. Recovered items sink to the bottom rather than being
 * dropped, so a full pass still exercises them.
 */
export function deckOrder(items: MissedItem[]): MissedItem[] {
  return [...items].sort(
    (a, b) =>
      Number(a.status === "recovered") - Number(b.status === "recovered") ||
      b.times_missed - a.times_missed ||
      a.box - b.box ||
      a.id.localeCompare(b.id)
  );
}

/** One-line label for a bank row's provenance, e.g. "missed 3x - quick test, practice". */
export function provenance(m: MissedItem): string {
  const modes = m.sources.map((s) => SOURCE_LABEL[s] ?? s).join(", ");
  return `missed ${m.times_missed}x${modes ? ` - ${modes}` : ""}`;
}
