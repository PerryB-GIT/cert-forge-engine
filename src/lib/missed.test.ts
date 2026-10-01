import { describe, it, expect } from "vitest";
import {
  filterMissed,
  groupByDomain,
  totalMisses,
  countByStatus,
  toReviewable,
  deckOrder,
  provenance,
  type MissedItem,
  type MissSource,
} from "./missed";

function item(over: Partial<MissedItem> & { id: string }): MissedItem {
  return {
    exam_code: "CCAO-F",
    domain: "Prompting and Task Execution",
    scenario: null,
    stem: "stem",
    options: ["a", "b", "c", "d"],
    correct: [0],
    multi: false,
    select_count: 1,
    rationale: { overall: "because", options: [] },
    tip: null,
    times_missed: 1,
    times_answered: 1,
    sources: ["practice"] as MissSource[],
    last_missed_at: "2026-08-01T00:00:00Z",
    last_missed_source: "practice",
    last_wrong_answer: [2],
    last_unanswered: false,
    box: 0,
    times_seen: 1,
    times_correct: 0,
    due_at: null,
    status: "shaky",
    ...over,
  };
}

describe("filterMissed", () => {
  const rows = [
    item({ id: "a", sources: ["full"], status: "shaky", domain: "D1" }),
    item({ id: "b", sources: ["practice"], status: "recovered", domain: "D1" }),
    item({ id: "c", sources: ["quick", "practice"], status: "shaky", domain: "D2" }),
    item({ id: "d", sources: ["flashcard"], status: "recovered", domain: "D2" }),
  ];

  it("returns everything by default", () => {
    expect(filterMissed(rows).map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("sim filter keeps full and quick, drops practice-only", () => {
    expect(filterMissed(rows, { source: "sim" }).map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("practice filter keeps practice and flashcard", () => {
    expect(filterMissed(rows, { source: "practice" }).map((r) => r.id)).toEqual(["b", "c", "d"]);
  });

  it("an item missed in both modes appears under either filter", () => {
    expect(filterMissed(rows, { source: "sim" }).some((r) => r.id === "c")).toBe(true);
    expect(filterMissed(rows, { source: "practice" }).some((r) => r.id === "c")).toBe(true);
  });

  it("status and domain filters compose", () => {
    expect(filterMissed(rows, { status: "shaky", domain: "D2" }).map((r) => r.id)).toEqual(["c"]);
  });

  it("status: recovered excludes shaky", () => {
    expect(filterMissed(rows, { status: "recovered" }).map((r) => r.id)).toEqual(["b", "d"]);
  });
});

describe("groupByDomain", () => {
  it("orders domains by total misses, not item count", () => {
    const rows = [
      item({ id: "a", domain: "Few but brutal", times_missed: 6 }),
      item({ id: "b", domain: "Many but shallow", times_missed: 1 }),
      item({ id: "c", domain: "Many but shallow", times_missed: 1 }),
      item({ id: "d", domain: "Many but shallow", times_missed: 1 }),
    ];
    expect(groupByDomain(rows).map((g) => g.domain)).toEqual([
      "Few but brutal",
      "Many but shallow",
    ]);
  });

  it("breaks ties alphabetically", () => {
    const rows = [item({ id: "a", domain: "Zebra" }), item({ id: "b", domain: "Alpha" })];
    expect(groupByDomain(rows).map((g) => g.domain)).toEqual(["Alpha", "Zebra"]);
  });

  it("keeps every item", () => {
    const rows = [item({ id: "a", domain: "X" }), item({ id: "b", domain: "X" })];
    expect(groupByDomain(rows)[0].items).toHaveLength(2);
  });

  it("handles an empty bank", () => {
    expect(groupByDomain([])).toEqual([]);
  });
});

describe("totalMisses / countByStatus", () => {
  it("sums misses rather than counting rows", () => {
    expect(totalMisses([item({ id: "a", times_missed: 3 }), item({ id: "b", times_missed: 2 })])).toBe(5);
  });

  it("splits shaky from recovered", () => {
    const rows = [
      item({ id: "a", status: "shaky" }),
      item({ id: "b", status: "recovered" }),
      item({ id: "c", status: "recovered" }),
    ];
    expect(countByStatus(rows)).toEqual({ shaky: 1, recovered: 2 });
  });

  it("is zero-safe", () => {
    expect(countByStatus([])).toEqual({ shaky: 0, recovered: 0 });
    expect(totalMisses([])).toBe(0);
  });
});

describe("toReviewable", () => {
  it("shows the last wrong answer and always renders as incorrect", () => {
    const r = toReviewable(item({ id: "a", last_wrong_answer: [3], correct: [1] }));
    expect(r.your_answer).toEqual([3]);
    expect(r.correct).toEqual([1]);
    expect(r.is_correct).toBe(false);
  });

  it("carries a null answer through for items left blank", () => {
    const r = toReviewable(item({ id: "a", last_wrong_answer: null, last_unanswered: true }));
    expect(r.your_answer).toBeNull();
  });

  it("still renders as incorrect for a recovered item", () => {
    expect(toReviewable(item({ id: "a", status: "recovered" })).is_correct).toBe(false);
  });
});

describe("deckOrder", () => {
  it("puts shaky before recovered, then most-missed, then shallowest box", () => {
    const rows = [
      item({ id: "recovered-hot", status: "recovered", times_missed: 9, box: 0 }),
      item({ id: "shaky-light", status: "shaky", times_missed: 1, box: 3 }),
      item({ id: "shaky-heavy", status: "shaky", times_missed: 4, box: 1 }),
      item({ id: "shaky-light-newer", status: "shaky", times_missed: 1, box: 0 }),
    ];
    expect(deckOrder(rows).map((r) => r.id)).toEqual([
      "shaky-heavy",
      "shaky-light-newer",
      "shaky-light",
      "recovered-hot",
    ]);
  });

  it("keeps recovered items in the deck rather than dropping them", () => {
    const rows = [item({ id: "a", status: "recovered" })];
    expect(deckOrder(rows)).toHaveLength(1);
  });

  it("does not mutate the input", () => {
    const rows = [item({ id: "b", status: "recovered" }), item({ id: "a", status: "shaky" })];
    deckOrder(rows);
    expect(rows.map((r) => r.id)).toEqual(["b", "a"]);
  });
});

describe("provenance", () => {
  it("names every mode the item was missed in", () => {
    expect(provenance(item({ id: "a", times_missed: 3, sources: ["quick", "practice"] }))).toBe(
      "missed 3x - Quick test, Practice"
    );
  });

  it("degrades cleanly with no recorded sources", () => {
    expect(provenance(item({ id: "a", times_missed: 1, sources: [] }))).toBe("missed 1x");
  });
});
