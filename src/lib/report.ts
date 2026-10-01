import { scoreMargin } from "./scoring";

/**
 * Pure helpers behind the Report Card. Kept out of the page so the rules that
 * decide which number a learner sees as "their score" are unit-tested
 * (internal report-card v2 spec, findings A1-A3).
 */

export type ReportSession = {
  id: string;
  exam_code: string;
  mode: "full" | "quick" | "holdout";
  scaled_score: number;
  passed: boolean;
  fresh_items: number | null;
  fresh_scaled: number | null;
  submitted_at: string;
};

export const FRESH_MIN = 40;

/** A sitting whose fresh-item score is trustworthy enough to call "best". */
export function qualifies(s: ReportSession): boolean {
  return s.mode !== "quick" && (s.fresh_items ?? 0) >= FRESH_MIN && s.fresh_scaled !== null;
}

export function bestSitting<T extends ReportSession>(list: T[]): T | null {
  return list.reduce<T | null>(
    (b, s) => (qualifies(s) && (b === null || s.fresh_scaled! > b.fresh_scaled!) ? s : b),
    null
  );
}

/**
 * The number to show for one sitting. Fresh-item score whenever the sitting has
 * any fresh items (repeats inflate the raw score); raw only for legacy sittings
 * with no fresh tracking. `raw` tells the UI to label it.
 */
export function displayScore(s: ReportSession): {
  score: number;
  items: number | null;
  raw: boolean;
  /** fewer than FRESH_MIN fresh items: a weak read, never plotted as a headline point */
  thin: boolean;
} {
  if (s.fresh_scaled !== null && (s.fresh_items ?? 0) > 0)
    return { score: s.fresh_scaled, items: s.fresh_items, raw: false, thin: (s.fresh_items ?? 0) < FRESH_MIN };
  // fresh_items = 0 means every item was a repeat: the raw score is the inflated
  // number this whole page exists to avoid, so it is "thin" too. Only legacy
  // sittings with no fresh tracking at all (null) plot raw on the line.
  return { score: s.scaled_score, items: null, raw: true, thin: s.fresh_items !== null && s.fresh_items < FRESH_MIN };
}

export type TrendPoint = {
  at: Date;
  score: number;
  /** 90% margin in scaled points, null when the item count is unknown */
  margin: number | null;
  /** quick = quick test; thin = full sitting on <40 fresh items. Neither joins the line or band. */
  kind: "full" | "quick" | "thin";
  raw: boolean;
};

export function trendSeries(sessions: ReportSession[]): TrendPoint[] {
  return [...sessions]
    .sort((a, b) => a.submitted_at.localeCompare(b.submitted_at))
    .map((s) => {
      const d = displayScore(s);
      return {
        at: new Date(s.submitted_at),
        score: d.score,
        margin: d.items ? scoreMargin(d.score, d.items) : null,
        kind: s.mode === "quick" ? ("quick" as const) : d.thin ? ("thin" as const) : ("full" as const),
        raw: d.raw,
      };
    });
}

/** Progress through the current level, 0-100. Level floors come from cf_level_for. */
export function levelProgress(xp: { total: number; floor: number; next: number }): number {
  const span = xp.next - xp.floor;
  if (span <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round((100 * (xp.total - xp.floor)) / span)));
}

export type CalibrationRow = { confidence: number; n: number; correct: number };

/**
 * Calibration gap per confidence level: actual % correct minus the % a
 * well-calibrated learner would get at that confidence (Guessing ~33, Fairly
 * sure ~67, Certain ~95). Positive = underconfident, negative = overconfident.
 */
export const CONFIDENCE_EXPECTED: Record<number, number> = { 1: 33, 2: 67, 3: 95 };
export function calibration(rows: CalibrationRow[]) {
  return [1, 2, 3].map((c) => {
    const r = rows.find((x) => x.confidence === c);
    const pct = r && r.n > 0 ? Math.round((100 * r.correct) / r.n) : null;
    return { confidence: c, n: r?.n ?? 0, pct, expected: CONFIDENCE_EXPECTED[c], gap: pct === null ? null : pct - CONFIDENCE_EXPECTED[c] };
  });
}

export type WeeklyRow = { week: string; practice: number; flashcards: number; sim_items: number; qualified_days: number };

/** Best practice week by graded items, for the personal-bests panel. */
export function bestWeek(rows: WeeklyRow[]): WeeklyRow | null {
  return rows.reduce<WeeklyRow | null>(
    (b, r) => (r.practice + r.sim_items > 0 && (b === null || r.practice + r.sim_items > b.practice + b.sim_items) ? r : b),
    null
  );
}
