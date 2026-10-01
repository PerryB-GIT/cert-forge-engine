import { CUT_SCORE, SCALE_MIN, SCALE_MAX, type Domain } from "./exams";

export type DomainScore = { name: string; weight: number; pct: number };

/**
 * Weighted percent correct over the domains the user has actually logged.
 * weightedPct = sum(domainPct * domainWeight) / sum(domainWeight of LOGGED domains)
 * Returns null when nothing is logged.
 */
export function weightedPercentCorrect(scores: DomainScore[]): number | null {
  const logged = scores.filter((s) => s.pct !== null && s.pct !== undefined && !Number.isNaN(s.pct));
  if (logged.length === 0) return null;
  const wSum = logged.reduce((a, s) => a + s.weight, 0);
  if (wSum <= 0) return null;
  const num = logged.reduce((a, s) => a + clampPct(s.pct) * s.weight, 0);
  return num / wSum;
}

/** scaled = round(100 + (weightedPct / 100) * 900) */
export function scaledScore(scores: DomainScore[]): number | null {
  const w = weightedPercentCorrect(scores);
  if (w === null) return null;
  return Math.round(SCALE_MIN + (w / 100) * (SCALE_MAX - SCALE_MIN));
}

/**
 * Ready only when EVERY blueprint domain has a score. Scoring renormalises over
 * the domains present, so one logged domain at 100% used to read as 1000/READY.
 */
export function isReady(scores: DomainScore[], domainCount: number): boolean {
  if (scores.length < domainCount) return false;
  const s = scaledScore(scores);
  return s !== null && s >= READY_SCORE;
}

/**
 * The published cut is 720 on the SCALED score. How Anthropic's scale maps to
 * percent correct is not published — the linear 100 + 9 x pct mapping used here
 * (720 ~ 69% correct) is an assumption, and the practice items are self-authored
 * and likely easier than the real ones. So a practice score is read as a band,
 * not a verdict: 800+ likely pass, 720-799 borderline, under 720 not yet.
 */
export const READY_SCORE = 800;
export type Band = { key: "likely" | "borderline" | "below"; label: string };
/**
 * 90% margin of a practice score, in scaled points, from how many items it
 * rests on. Binomial: SE = sqrt(p(1-p)/n) on percent correct, x900 to scale,
 * x1.645 for a one-sided 90% bound. At n=60 and ~80% correct that's ~76 points
 * — a single sim is a noisy read, and the UI must say so.
 */
export function scoreMargin(scaled: number, items: number): number {
  if (items <= 0) return 0;
  const p = Math.min(0.999, Math.max(0.001, (scaled - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)));
  return Math.round(1.645 * Math.sqrt((p * (1 - p)) / items) * (SCALE_MAX - SCALE_MIN));
}

/**
 * Band a practice score. With an item count, "Likely pass" also needs the low
 * end of the 90% margin to clear the 720 cut — 800 on 60 items qualifies
 * (~721 low end), 800 on 30 items does not.
 */
export function readinessBand(scaled: number, items?: number): Band {
  const low = items ? scaled - scoreMargin(scaled, items) : scaled;
  if (scaled >= READY_SCORE && (items === undefined || low >= CUT_SCORE))
    return { key: "likely", label: "Likely pass" };
  if (scaled >= CUT_SCORE) return { key: "borderline", label: "Borderline" };
  return { key: "below", label: "Not yet" };
}

export function pointsFromCut(scores: DomainScore[]): number | null {
  const s = scaledScore(scores);
  return s === null ? null : s - CUT_SCORE;
}

/**
 * "Biggest lever": the logged domain maximizing (100 - pct) * weight — the most
 * weighted score still recoverable there. Same ranking as ResultsView's study
 * pointers. (Minimizing pct * weight, the old rule, favoured tiny-weight domains:
 * 90% on a 3.1% domain "beat" 50% on a 33.1% one.)
 */
export function biggestLever(scores: DomainScore[]): DomainScore | null {
  const logged = scores.filter((s) => s.pct !== null && s.pct !== undefined && !Number.isNaN(s.pct));
  if (logged.length === 0) return null;
  const gap = (s: DomainScore) => (100 - clampPct(s.pct)) * s.weight;
  return logged.reduce((best, s) => (gap(s) > gap(best) ? s : best));
}

/**
 * Score over only the items that were unseen when the sim was drawn — the number
 * that measures readiness rather than recall of revealed keys. Same weighting as
 * the full score (blueprint weights over the domains present). Null when the
 * session predates tracking (freshIds null) or no item was fresh.
 */
export function freshScore(
  domains: Domain[],
  review: { id: string; domain: string; is_correct: boolean }[],
  freshIds: string[] | null | undefined,
  perItem = false
): { items: number; scaled: number; pct: number } | null {
  if (!freshIds) return null;
  const fresh = new Set(freshIds);
  const per = new Map<string, { ok: number; n: number }>();
  for (const r of review) {
    if (!fresh.has(r.id)) continue;
    const d = per.get(r.domain) ?? { ok: 0, n: 0 };
    d.n += 1;
    if (r.is_correct) d.ok += 1;
    per.set(r.domain, d);
  }
  const scores = domains
    .filter((d) => per.has(d.name))
    .map((d) => {
      const x = per.get(d.name)!;
      return { name: d.name, weight: d.weight, pct: (100 * x.ok) / x.n };
    });
  const items = [...per.values()].reduce((a, d) => a + d.n, 0);
  if (items === 0) return null;
  if (perItem) {
    // Plain item percent, matching cf_submit_session for per-item exams.
    const okAll = [...per.values()].reduce((a, d) => a + d.ok, 0);
    const p = (100 * okAll) / items;
    return { items, pct: p, scaled: Math.round(SCALE_MIN + (p / 100) * (SCALE_MAX - SCALE_MIN)) };
  }
  const pct = weightedPercentCorrect(scores);
  const scaled = scaledScore(scores);
  if (pct === null || scaled === null) return null;
  return { items, scaled, pct };
}

/** One exam's row from cf_readiness(): graded fresh items pooled over recent sims. */
export type Pooled = {
  items: number;
  correct: number;
  sims: number;
  domains: Record<string, { n: number; ok: number }> | null;
};

/** Fresh items needed before Readiness gives a verdict (matches ResultsView). */
export const READINESS_MIN_ITEMS = 40;

/**
 * Readiness from pooled fresh items. Per-item exams (CCAR-F) use plain percent,
 * the way their sims are scored. Others weight pooled domain percentages by
 * blueprint, which is only complete when every domain has at least one item.
 * `verdict` is false under READINESS_MIN_ITEMS: the gauge still shows the
 * estimate, but no READY / NOT YET call is made on that little evidence.
 */
export function pooledReadiness(
  exam: { domains: Domain[]; perItemScoring?: boolean },
  p: Pooled | null | undefined
): {
  scaled: number;
  items: number;
  verdict: boolean;
  ready: boolean;
  margin: number;
  domainScores: DomainScore[];
} | null {
  if (!p || p.items === 0) return null;
  const domainScores = exam.domains
    .filter((d) => p.domains?.[d.name]?.n)
    .map((d) => {
      const x = p.domains![d.name];
      return { name: d.name, weight: d.weight, pct: (100 * x.ok) / x.n };
    });
  const scaled = exam.perItemScoring
    ? Math.round(SCALE_MIN + (p.correct / p.items) * (SCALE_MAX - SCALE_MIN))
    : scaledScore(domainScores);
  if (scaled === null) return null;
  const complete = exam.perItemScoring || domainScores.length === exam.domains.length;
  const verdict = p.items >= READINESS_MIN_ITEMS && complete;
  const margin = scoreMargin(scaled, p.items);
  const ready = verdict && readinessBand(scaled, p.items).key === "likely";
  return { scaled, items: p.items, verdict, ready, margin, domainScores };
}

/** Build DomainScore[] from an exam's domain list + a map of latest pct per domain name. */
export function toDomainScores(
  domains: Domain[],
  latest: Record<string, number | undefined>
): DomainScore[] {
  return domains
    .filter((d) => latest[d.name] !== undefined)
    .map((d) => ({ name: d.name, weight: d.weight, pct: latest[d.name] as number }));
}

function clampPct(p: number): number {
  return Math.min(100, Math.max(0, p));
}

/** Grade band for the results debrief (the real exam only reports pass/fail + scaled). */
export function gradeBand(scaled: number): { grade: string; label: string } {
  if (scaled >= 900) return { grade: "A+", label: "Exceptional — well beyond the standard" };
  if (scaled >= 800) return { grade: "A", label: "Comfortable margin" };
  if (scaled >= CUT_SCORE) return { grade: "B", label: "Above the 720 estimate — thin margin" };
  if (scaled >= 650) return { grade: "C", label: "Close — targeted review needed" };
  if (scaled >= 500) return { grade: "D", label: "Developing — significant gaps" };
  return { grade: "F", label: "Foundational review required" };
}
