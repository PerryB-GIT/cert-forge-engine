import { describe, it, expect } from "vitest";
import { rankBy, rankTab, bestFresh, aliasError, type LeaderRow } from "./leaderboard";

function row(over: Partial<LeaderRow> & { name: string }): LeaderRow {
  return {
    is_me: false,
    improvement: null,
    improvement_exam: null,
    retention_n: 0,
    retention_pct: null,
    qualified_days: 0,
    xp_week: 0,
    best: {},
    likely_passes: 0,
    ...over,
  };
}

describe("rankBy", () => {
  it("ranks higher first with competition ties (1,1,3)", () => {
    const { ranked } = rankBy([{ v: 5 }, { v: 9 }, { v: 9 }, { v: 1 }], (r) => r.v);
    expect(ranked.map((x) => [x.rank, x.row.v])).toEqual([
      [1, 9],
      [1, 9],
      [3, 5],
      [4, 1],
    ]);
  });

  it("excludes null metrics from ranking and returns them separately", () => {
    const rows = [{ v: null as number | null, n: "a" }, { v: 3, n: "b" }, { v: null, n: "c" }];
    const { ranked, unranked } = rankBy(rows, (r) => r.v);
    expect(ranked.map((x) => x.row.n)).toEqual(["b"]);
    expect(ranked[0].rank).toBe(1);
    expect(unranked.map((r) => r.n)).toEqual(["a", "c"]);
  });

  it("uses the tiebreak before declaring a tie", () => {
    const { ranked } = rankBy(
      [{ v: 800, t: 1 }, { v: 800, t: 2 }, { v: 800, t: 2 }],
      (r) => r.v,
      (r) => r.t
    );
    expect(ranked.map((x) => [x.rank, x.row.t])).toEqual([
      [1, 2],
      [1, 2],
      [3, 1],
    ]);
  });

  it("negative improvement still ranks, below positive", () => {
    const { ranked } = rankBy([{ v: -20 }, { v: 40 }], (r) => r.v);
    expect(ranked.map((x) => x.row.v)).toEqual([40, -20]);
  });
});

describe("rankTab", () => {
  const rows = [
    row({ name: "A", retention_pct: 80, retention_n: 25, qualified_days: 3, best: { "CCDV-F": 760 } }),
    row({ name: "B", retention_n: 10, qualified_days: 0, best: { "CCDV-F": 850 }, likely_passes: 1 }),
  ];

  it("retention leaves members under the 20-review floor unranked", () => {
    const { ranked, unranked } = rankTab(rows, "retention");
    expect(ranked.map((x) => x.row.name)).toEqual(["A"]);
    expect(unranked.map((r) => r.name)).toEqual(["B"]);
  });

  it("consistency ranks zero days (a real value, not missing)", () => {
    const { ranked } = rankTab(rows, "consistency");
    expect(ranked.map((x) => [x.rank, x.row.name])).toEqual([
      [1, "A"],
      [2, "B"],
    ]);
  });

  it("all-time ranks by best fresh score across exams", () => {
    const { ranked } = rankTab(rows, "alltime");
    expect(ranked.map((x) => x.row.name)).toEqual(["B", "A"]);
  });
});

describe("bestFresh / aliasError", () => {
  it("bestFresh is null with no qualifying sims", () => {
    expect(bestFresh(row({ name: "x" }))).toBeNull();
    expect(bestFresh(row({ name: "x", best: { "CCAO-F": 700, "CCAR-F": 790 } }))).toBe(790);
  });
  it("alias mirrors the DB rules: required, 2-24 chars", () => {
    expect(aliasError("")).not.toBeNull();
    expect(aliasError("  ")).not.toBeNull();
    expect(aliasError("A")).not.toBeNull();
    expect(aliasError("Falcon")).toBeNull();
    expect(aliasError("x".repeat(25))).not.toBeNull();
  });
});
