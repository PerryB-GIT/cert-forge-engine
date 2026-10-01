import { EXAM_ORDER } from "./exams";

/** One opted-in member's row from cf_leaderboard_week. */
export type LeaderRow = {
  name: string;
  is_me: boolean;
  improvement: number | null;
  improvement_exam: string | null;
  retention_n: number;
  retention_pct: number | null;
  qualified_days: number;
  xp_week: number;
  best: Record<string, number>;
  likely_passes: number;
};

export type Board = {
  opted_in: boolean;
  members: number;
  week_start: string;
  rows?: LeaderRow[];
  team?: { qualified_days: number; target: number };
};

export type TabKey = "improvement" | "retention" | "consistency" | "alltime";

export type Ranked<T> = { rank: number; row: T };

/**
 * Competition ranking ("1, 1, 3"): rows with a null metric are NOT ranked and
 * come back separately, so "not enough data yet" never reads as last place.
 * Higher is better for every board here. Ties keep the input order.
 */
export function rankBy<T>(
  rows: T[],
  metric: (r: T) => number | null,
  tiebreak?: (r: T) => number
): { ranked: Ranked<T>[]; unranked: T[] } {
  const scored = rows
    .map((row, i) => ({ row, i, v: metric(row) }))
    .filter((x): x is { row: T; i: number; v: number } => x.v !== null && Number.isFinite(x.v));
  const unranked = rows.filter((r) => {
    const v = metric(r);
    return v === null || !Number.isFinite(v);
  });
  const key = (x: { row: T; v: number }) => [x.v, tiebreak ? tiebreak(x.row) : 0];
  scored.sort((a, b) => {
    const [av, at] = key(a);
    const [bv, bt] = key(b);
    return bv - av || bt - at || a.i - b.i;
  });
  const ranked: Ranked<T>[] = [];
  scored.forEach((x, idx) => {
    const prev = scored[idx - 1];
    const same =
      prev !== undefined &&
      key(prev)[0] === key(x)[0] &&
      key(prev)[1] === key(x)[1];
    ranked.push({ rank: same ? ranked[idx - 1].rank : idx + 1, row: x.row });
  });
  return { ranked, unranked };
}

/** All-time board metric: best fresh score across exams (null if none). */
export function bestFresh(r: LeaderRow): number | null {
  const vals = EXAM_ORDER.map((c) => r.best?.[c]).filter((v): v is number => typeof v === "number");
  return vals.length ? Math.max(...vals) : null;
}

export const TABS: { key: TabKey; label: string; weekly: boolean; note: string }[] = [
  {
    key: "improvement",
    label: "Improvement",
    weekly: true,
    note:
      "Your best full sim this week minus your personal best from before this week, on the same exam. Only real sittings count: 40+ fresh items, 90%+ answered, a quarter of the time used — so a bad week can't be faked to set up a big jump.",
  },
  {
    key: "retention",
    label: "Retention",
    weekly: true,
    note:
      "Percent correct on spaced-review items this week — items you first answered on an earlier day. Needs 20 review answers to rank.",
  },
  {
    key: "consistency",
    label: "Consistency",
    weekly: true,
    note:
      "Qualified study days this week (0–7). A day counts with 5+ different practice items graded, or a sim with at least half the items answered.",
  },
  {
    key: "alltime",
    label: "All-time",
    weekly: false,
    note:
      "Best fresh score on any exam. Only real sittings count: full sims with 40+ never-seen items, 90%+ answered, and at least a quarter of the time used. Ties broken by number of likely-pass exams.",
  },
];

export function rankTab(rows: LeaderRow[], tab: TabKey) {
  switch (tab) {
    case "improvement":
      return rankBy(rows, (r) => r.improvement);
    case "retention":
      return rankBy(rows, (r) => r.retention_pct);
    case "consistency":
      return rankBy(rows, (r) => r.qualified_days);
    case "alltime":
      return rankBy(rows, bestFresh, (r) => r.likely_passes);
  }
}

/** Why a row isn't ranked on this tab yet. */
export function unrankedReason(r: LeaderRow, tab: TabKey): string {
  switch (tab) {
    case "improvement":
      return "needs a full sim this week and an earlier one on the same exam";
    case "retention":
      return `${r.retention_n}/20 review answers`;
    case "consistency":
      return "no data";
    case "alltime":
      return "no full sim on 40+ fresh items yet";
  }
}

/** Alias rule mirrors the DB checks: required to join, 2–24 chars after trim. */
export function aliasError(alias: string): string | null {
  const t = alias.trim();
  if (t === "") return "Pick an alias — the board never shows your real name.";
  if (t.length < 2 || t.length > 24) return "Alias must be 2–24 characters.";
  return null;
}
