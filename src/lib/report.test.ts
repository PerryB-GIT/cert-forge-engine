import { describe, expect, it } from "vitest";
import {
  bestSitting,
  bestWeek,
  calibration,
  displayScore,
  levelProgress,
  qualifies,
  trendSeries,
  type ReportSession,
} from "./report";

const s = (over: Partial<ReportSession>): ReportSession => ({
  id: "x",
  exam_code: "CCDV-F",
  mode: "full",
  scaled_score: 800,
  passed: false,
  fresh_items: 60,
  fresh_scaled: 760,
  submitted_at: "2026-09-01T12:00:00Z",
  ...over,
});

describe("report card score selection (findings A1-A3)", () => {
  it("never shows the raw score when a fresh score exists", () => {
    const d = displayScore(s({ scaled_score: 850, fresh_scaled: 760, fresh_items: 45 }));
    expect(d).toEqual({ score: 760, items: 45, raw: false, thin: false });
  });

  it("falls back to raw, labelled, only for sittings without fresh tracking", () => {
    expect(displayScore(s({ fresh_scaled: null, fresh_items: null }))).toEqual({
      score: 800,
      items: null,
      raw: true,
      thin: false,
    });
    expect(displayScore(s({ fresh_scaled: 500, fresh_items: 0 })).raw).toBe(true);
  });

  it("best = highest fresh score among qualifying sittings only", () => {
    const list = [
      s({ id: "quick", mode: "quick", fresh_scaled: 990 }),
      s({ id: "thin", fresh_items: 20, fresh_scaled: 950 }),
      s({ id: "a", fresh_scaled: 700 }),
      s({ id: "b", mode: "holdout", fresh_scaled: 780 }),
    ];
    expect(bestSitting(list)?.id).toBe("b");
    expect(qualifies(list[0])).toBe(false);
    expect(qualifies(list[1])).toBe(false);
  });

  it("returns null when nothing qualifies", () => {
    expect(bestSitting([s({ mode: "quick" })])).toBeNull();
  });

  it("a re-sit with 3 fresh items is thin: off the line, not a headline 1000", () => {
    const [p] = trendSeries([s({ fresh_items: 3, fresh_scaled: 1000 })]);
    expect(p.kind).toBe("thin");
    expect(displayScore(s({ fresh_items: 3, fresh_scaled: 1000 })).thin).toBe(true);
  });

  it("an all-repeats sitting (0 fresh) is thin, not a filled raw point on the line", () => {
    const [p] = trendSeries([s({ fresh_items: 0, fresh_scaled: null, scaled_score: 880 })]);
    expect(p.kind).toBe("thin");
    expect(p.raw).toBe(true);
  });

  it("trend is chronological, uses fresh scores, margin from fresh items", () => {
    const t = trendSeries([
      s({ submitted_at: "2026-09-03T00:00:00Z", fresh_scaled: 700 }),
      s({ submitted_at: "2026-09-01T00:00:00Z", mode: "quick", fresh_items: 10, fresh_scaled: 640 }),
    ]);
    expect(t.map((p) => p.score)).toEqual([640, 700]);
    expect(t[0].kind).toBe("quick");
    // 10 items is far noisier than 60
    expect(t[0].margin!).toBeGreaterThan(t[1].margin!);
  });
});

describe("gamification helpers", () => {
  it("level progress is bounded 0..100", () => {
    expect(levelProgress({ total: 500, floor: 250, next: 750 })).toBe(50);
    expect(levelProgress({ total: 0, floor: 0, next: 250 })).toBe(0);
    expect(levelProgress({ total: 9999, floor: 250, next: 750 })).toBe(100);
  });

  it("calibration gap: negative = overconfident", () => {
    const c = calibration([{ confidence: 3, n: 10, correct: 6 }]);
    expect(c[2]).toMatchObject({ pct: 60, gap: -35 });
    expect(c[0]).toMatchObject({ n: 0, pct: null, gap: null });
  });

  it("best week ignores empty weeks", () => {
    expect(bestWeek([{ week: "w1", practice: 0, flashcards: 9, sim_items: 0, qualified_days: 0 }])).toBeNull();
    expect(
      bestWeek([
        { week: "w1", practice: 10, flashcards: 0, sim_items: 0, qualified_days: 2 },
        { week: "w2", practice: 5, flashcards: 0, sim_items: 60, qualified_days: 1 },
      ])?.week
    ).toBe("w2");
  });
});
