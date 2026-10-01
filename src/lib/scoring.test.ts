import { describe, it, expect } from "vitest";
import {
  weightedPercentCorrect,
  scaledScore,
  isReady,
  readinessBand,
  scoreMargin,
  biggestLever,
  freshScore,
  pooledReadiness,
  pointsFromCut,
} from "./scoring";
import { EXAMS, CUT_PCT } from "./exams";

const ccao = EXAMS.find((e) => e.code === "CCAO-F")!;
const ccdv = EXAMS.find((e) => e.code === "CCDV-F")!;

function uniform(examCode: string, pct: number) {
  const exam = EXAMS.find((e) => e.code === examCode)!;
  return exam.domains.map((d) => ({ name: d.name, weight: d.weight, pct }));
}

describe("scaledScore boundaries at the 720 cut", () => {
  // scaled = round(100 + w/100*900). Invert: w = (scaled-100)/9
  it("719: just below the cut → band 'Not yet'", () => {
    const w = (719 - 100) / 9; // 68.777...%
    const scores = uniform("CCAO-F", w);
    expect(scaledScore(scores)).toBe(719);
    expect(readinessBand(719).key).toBe("below");
    expect(pointsFromCut(scores)).toBe(-1);
  });

  it("720: exactly the cut → borderline, not ready", () => {
    const w = (720 - 100) / 9; // 68.888...%
    const scores = uniform("CCAO-F", w);
    expect(scaledScore(scores)).toBe(720);
    expect(readinessBand(720).key).toBe("borderline");
    expect(isReady(scores, ccao.domains.length)).toBe(false);
    expect(pointsFromCut(scores)).toBe(0);
  });

  it("721: just above → still borderline", () => {
    const w = (721 - 100) / 9;
    const scores = uniform("CCAO-F", w);
    expect(scaledScore(scores)).toBe(721);
    expect(readinessBand(721).key).toBe("borderline");
  });

  it("rounding: weighted pct equivalent to 719.6 rounds up to 720", () => {
    const w = (719.6 - 100) / 9;
    expect(scaledScore(uniform("CCAO-F", w))).toBe(720);
    expect(readinessBand(720).key).toBe("borderline");
  });

  it("rounding: weighted pct equivalent to 719.4 rounds down to 719", () => {
    const w = (719.4 - 100) / 9;
    expect(scaledScore(uniform("CCAO-F", w))).toBe(719);
    expect(readinessBand(719).key).toBe("below");
  });

  it("CUT_PCT constant maps exactly to 720 (68.89% surfaced in UI)", () => {
    expect(scaledScore(uniform("CCAO-F", CUT_PCT))).toBe(720);
    expect(CUT_PCT).toBeCloseTo(68.888888, 4);
  });
});

describe("partial coverage: only logged domains count", () => {
  it("one domain logged: weighted pct equals that domain's pct", () => {
    const scores = [{ name: ccao.domains[1].name, weight: 21, pct: 80 }];
    expect(weightedPercentCorrect(scores)).toBeCloseTo(80);
    expect(scaledScore(scores)).toBe(820);
  });

  it("two of seven logged: normalizes by logged weight only", () => {
    // domains 14% @ 50 and 21% @ 100 → (14*50 + 21*100)/35 = 80
    const scores = [
      { name: "Prompting and Task Execution", weight: 14, pct: 50 },
      { name: "Output Evaluation and Validation", weight: 21, pct: 100 },
    ];
    expect(weightedPercentCorrect(scores)).toBeCloseTo(80);
    expect(scaledScore(scores)).toBe(820);
  });

  it("nothing logged → null, not 100 and not 0", () => {
    expect(weightedPercentCorrect([])).toBeNull();
    expect(scaledScore([])).toBeNull();
    expect(isReady([], ccao.domains.length)).toBe(false);
  });
});

describe("decimal weights (CCDV-F)", () => {
  it("full uniform 100% → 1000", () => {
    expect(scaledScore(uniform("CCDV-F", 100))).toBe(1000);
  });
  it("full uniform 0% → 100", () => {
    expect(scaledScore(uniform("CCDV-F", 0))).toBe(100);
  });
  it("weights sum to 100.0 exactly", () => {
    const sum = ccdv.domains.reduce((a, d) => a + d.weight, 0);
    expect(sum).toBeCloseTo(100.0, 9);
  });
  it("heaviest domain dominates: 33.1% @ 0, all else 100 → fails", () => {
    const scores = ccdv.domains.map((d) => ({
      name: d.name,
      weight: d.weight,
      pct: d.name === "Applications and Integration" ? 0 : 100,
    }));
    // (100*(100-33.1))/100 = 66.9% → 100 + 602.1 = 702
    expect(weightedPercentCorrect(scores)).toBeCloseTo(66.9);
    expect(scaledScore(scores)).toBe(702);
    expect(isReady(scores, ccdv.domains.length)).toBe(false);
  });
});

describe("clamping and safety", () => {
  it("pct above 100 clamps to 100", () => {
    const scores = [{ name: "x", weight: 10, pct: 150 }];
    expect(scaledScore(scores)).toBe(1000);
  });
  it("negative pct clamps to 0", () => {
    const scores = [{ name: "x", weight: 10, pct: -5 }];
    expect(scaledScore(scores)).toBe(100);
  });
});

describe("fresh score", () => {
  const doms = [
    { name: "A", weight: 75 },
    { name: "B", weight: 25 },
  ];
  const review = [
    { id: "1", domain: "A", is_correct: true },
    { id: "2", domain: "A", is_correct: false },
    { id: "3", domain: "B", is_correct: true }, // seen before -> excluded
    { id: "4", domain: "B", is_correct: false },
  ];
  it("scores only fresh items, blueprint-weighted", () => {
    const f = freshScore(doms, review, ["1", "2", "4"])!;
    expect(f.items).toBe(3);
    expect(f.pct).toBeCloseTo((50 * 75 + 0 * 25) / 100); // 37.5
    expect(f.scaled).toBe(Math.round(100 + 0.375 * 900));
  });
  it("null for sessions from before tracking, or nothing fresh", () => {
    expect(freshScore(doms, review, null)).toBeNull();
    expect(freshScore(doms, review, [])).toBeNull();
  });
});

describe("biggest lever", () => {
  it("picks the domain with the most recoverable weighted score", () => {
    const scores = [
      { name: "A", weight: 27, pct: 60 }, // (100-60)*27 = 1080  ← lever
      { name: "B", weight: 18, pct: 40 }, // (100-40)*18 = 1080 tie, A first
      { name: "C", weight: 20, pct: 90 }, // 200
    ];
    expect(biggestLever(scores)?.name).toBe("A");
  });
  it("does not favour a tiny-weight domain (CCDV-F repro)", () => {
    const scores = [
      { name: "Claude Code", weight: 3.1, pct: 90 }, // 31
      { name: "Applications and Integration", weight: 33.1, pct: 50 }, // 1655 ← lever
    ];
    expect(biggestLever(scores)?.name).toBe("Applications and Integration");
  });
  it("null when nothing logged", () => {
    expect(biggestLever([])).toBeNull();
  });
});

describe("blueprint integrity (all four exams)", () => {
  it.each(EXAMS.map((e) => [e.code, e] as const))("%s weights sum to 100", (_c, exam) => {
    expect(exam.domains.reduce((a, d) => a + d.weight, 0)).toBeCloseTo(100, 9);
  });
  it("item counts and fees match the guides", () => {
    const m = Object.fromEntries(EXAMS.map((e) => [e.code, e]));
    expect(m["CCAO-F"].items).toBe(60);
    expect(m["CCAO-F"].fee).toBe(99);
    expect(m["CCDV-F"].items).toBe(53);
    expect(m["CCDV-F"].fee).toBe(125);
    expect(m["CCAR-F"].items).toBe(60);
    expect(m["CCAR-F"].fee).toBe(125);
    expect(m["CCAR-P"].items).toBe(63);
    expect(m["CCAR-P"].fee).toBe(175);
    expect(EXAMS.reduce((s, e) => s + e.fee, 0)).toBe(524);
  });
});

describe("fresh score, per-item exams", () => {
  it("uses plain item percent, not domain weights", () => {
    const doms = [
      { name: "A", weight: 80 },
      { name: "B", weight: 20 },
    ];
    const review = [
      { id: "1", domain: "A", is_correct: false },
      { id: "2", domain: "B", is_correct: true },
      { id: "3", domain: "B", is_correct: true },
      { id: "4", domain: "B", is_correct: true },
    ];
    const f = freshScore(doms, review, ["1", "2", "3", "4"], true)!;
    expect(f.pct).toBe(75); // 3 of 4, not (0*80 + 100*20)/100 = 20
    expect(f.scaled).toBe(Math.round(100 + 0.75 * 900));
  });
});

describe("readiness verdict (2026-09-25)", () => {
  it("band edges: 799 borderline, 800 likely pass", () => {
    expect(readinessBand(799).key).toBe("borderline");
    expect(readinessBand(800).key).toBe("likely");
  });
  it("one domain logged at 100% is NOT ready (used to read 1000/READY)", () => {
    const scores = [{ name: ccao.domains[0].name, weight: ccao.domains[0].weight, pct: 100 }];
    expect(scaledScore(scores)).toBe(1000);
    expect(isReady(scores, ccao.domains.length)).toBe(false);
  });
  it("every domain logged at the 800 line is ready; just under is not", () => {
    expect(isReady(uniform("CCAO-F", (800 - 100) / 9), ccao.domains.length)).toBe(true);
    expect(isReady(uniform("CCAO-F", (799 - 100) / 9), ccao.domains.length)).toBe(false);
  });
});

describe("pooled readiness (cf_readiness)", () => {
  const ccar = EXAMS.find((e) => e.code === "CCAR-F")!;
  const doms = (n: number, ok: number) =>
    Object.fromEntries(ccar.domains.map((d) => [d.name, { n, ok }]));
  it("per-item exam: plain percent over pooled items, no domain swing", () => {
    // one domain at 0/1 and the rest perfect must not crater the score
    const d = doms(12, 12);
    d[ccar.domains[3].name] = { n: 1, ok: 0 };
    const items = 12 * 4 + 1;
    const r = pooledReadiness(ccar, { items, correct: items - 1, sims: 1, domains: d })!;
    expect(r.scaled).toBe(Math.round(100 + ((items - 1) / items) * 900));
    expect(r.verdict).toBe(true);
    expect(r.ready).toBe(true);
  });
  it("no verdict under 40 fresh items, even at a high score", () => {
    const r = pooledReadiness(ccar, { items: 30, correct: 30, sims: 1, domains: doms(6, 6) })!;
    expect(r.scaled).toBe(1000);
    expect(r.verdict).toBe(false);
    expect(r.ready).toBe(false);
  });
  it("weighted exam needs every domain present for a verdict", () => {
    const d = Object.fromEntries(ccdv.domains.slice(1).map((x) => [x.name, { n: 8, ok: 8 }]));
    const r = pooledReadiness(ccdv, { items: 56, correct: 56, sims: 1, domains: d })!;
    expect(r.verdict).toBe(false);
  });
  it("null when nothing pooled", () => {
    expect(pooledReadiness(ccar, null)).toBeNull();
    expect(pooledReadiness(ccar, { items: 0, correct: 0, sims: 0, domains: null })).toBeNull();
  });
});

describe("score margin (90%)", () => {
  it("~±76 at 60 items near 80% correct; wider with fewer items", () => {
    const m60 = scoreMargin(820, 60);
    expect(m60).toBeGreaterThan(70);
    expect(m60).toBeLessThan(82);
    expect(scoreMargin(820, 15)).toBeGreaterThan(2 * m60 - 5);
  });
  it("likely pass needs the low end >= 720: 800 on 60 yes, 800 on 30 no", () => {
    expect(readinessBand(800, 60).key).toBe("likely");
    expect(readinessBand(800, 30).key).toBe("borderline");
    expect(readinessBand(850, 30).key).toBe("likely");
  });
  it("without an item count the band is the plain 800/720 rule", () => {
    expect(readinessBand(800).key).toBe("likely");
  });
});
