import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { EXAMS, CUT_PCT, type Exam } from "./exams";
import { SAMPLE_EXAM } from "./sample-exam";

/**
 * Integrity gates on the shipped question banks.
 *
 * These exist because of a real defect found 2026-08-06: the banks were
 * generated with the correct answer clustered at the top of the option list and
 * nothing shuffles options at serve time, so a blind "pick the top N options"
 * strategy scored 870 on CCAR-P against a 720 cut — a passing grade, with a
 * Comfortable Margin badge, for reading nothing. CCAR-F had been QA'd and fixed
 * back in July; its three siblings never were.
 *
 * The banks are the product. A test that only covers the code around them would
 * have stayed green through all of it.
 *
 * Which banks run: every exam in EXAMS whose bank is present at
 * fixtures/questions/<CODE>.json, plus the original DEMO-F sample bank
 * (fixtures/questions/sample/SAMPLE.json, blueprint in ./sample-exam.ts),
 * which always runs. The real banks are not distributed with this repository,
 * so in a fresh clone the gates exercise the sample only, and the gates that
 * need real-only fixtures (authoring batches, holdout forms, task tags) are
 * skipped with a message saying why.
 */

type Question = {
  id: string;
  domain: string;
  scenario?: string | null;
  stem: string;
  options: string[];
  correct: number[];
  multi: boolean;
  select_count: number;
  rationale: { overall: string; options: string[] };
  tip: string | null;
};

const QDIR = path.join(process.cwd(), "fixtures", "questions");
const readBank = (file: string) =>
  (JSON.parse(fs.readFileSync(file, "utf8")) as { questions: Question[] }).questions;

const REAL_EXAMS = EXAMS.filter((e) => fs.existsSync(path.join(QDIR, `${e.code}.json`)));
const ENTRIES: { exam: Exam; questions: Question[] }[] = [
  ...REAL_EXAMS.map((exam) => ({ exam, questions: readBank(path.join(QDIR, `${exam.code}.json`)) })),
  { exam: SAMPLE_EXAM, questions: readBank(path.join(QDIR, "sample", "SAMPLE.json")) },
];
const BANKS = Object.fromEntries(ENTRIES.map((e) => [e.exam.code, e.questions])) as Record<string, Question[]>;
const EXAM_BY_CODE = Object.fromEntries(ENTRIES.map((e) => [e.exam.code, e.exam])) as Record<string, Exam>;
const CODES = ENTRIES.map((e) => e.exam.code);

if (REAL_EXAMS.length === 0) {
  console.warn(
    "  [question-bank] No real banks found at fixtures/questions/<CODE>.json; " +
      "integrity gates are running against the DEMO-F sample bank only."
  );
}

/** describe.each over `list`, or one skipped block explaining why it is empty. */
function eachOrSkip(list: string[], title: string, why: string, fn: (code: string) => void) {
  if (list.length === 0) {
    describe.skip(`${title.replace("%s", "(none)")} - skipped: ${why}`, () => {
      it("skipped", () => {});
    });
    return;
  }
  describe.each(list)(title, fn);
}

/** Score a blind strategy the way the real scorer does: weighted by domain. */
function blindScore(examCode: string, hits: (q: Question) => boolean): number {
  const exam = EXAM_BY_CODE[examCode];
  const qs = BANKS[examCode];
  let num = 0;
  let den = 0;
  for (const d of exam.domains) {
    const inDomain = qs.filter((q) => q.domain === d.name);
    if (inDomain.length === 0) continue;
    const pct = (100 * inDomain.filter(hits).length) / inDomain.length;
    num += pct * d.weight;
    den += d.weight;
  }
  return Math.round(100 + 9 * (num / den));
}

describe.each(CODES)("%s bank integrity", (code) => {
  const qs = () => BANKS[code];

  it("every item has options, a key, per-option rationales, and a tip", () => {
    for (const q of qs()) {
      expect(q.options.length, `${q.id} options`).toBeGreaterThanOrEqual(3);
      expect(q.correct.length, `${q.id} key`).toBeGreaterThan(0);
      expect(q.rationale.options.length, `${q.id} option rationales`).toBe(q.options.length);
      expect(q.rationale.overall?.length ?? 0, `${q.id} overall rationale`).toBeGreaterThan(20);
      expect(q.tip?.length ?? 0, `${q.id} tip`).toBeGreaterThan(10);
    }
  });

  it("keys are in range and match select_count", () => {
    for (const q of qs()) {
      for (const i of q.correct) {
        expect(i, `${q.id} key index`).toBeGreaterThanOrEqual(0);
        expect(i, `${q.id} key index`).toBeLessThan(q.options.length);
      }
      expect(new Set(q.correct).size, `${q.id} duplicate key indices`).toBe(q.correct.length);
      expect(q.correct.length, `${q.id} select_count`).toBe(q.select_count);
      expect(q.multi, `${q.id} multi flag`).toBe(q.select_count > 1);
    }
  });

  it("has no duplicate ids or duplicate option text within an item", () => {
    const ids = qs().map((q) => q.id);
    expect(new Set(ids).size, "duplicate ids").toBe(ids.length);
    for (const q of qs()) {
      expect(new Set(q.options).size, `${q.id} duplicate options`).toBe(q.options.length);
    }
  });

  // ---- the gates that actually caught the 2026-08-06 defect ----

  it("no single-answer key position holds more than 40% of items", () => {
    const single = qs().filter((q) => !q.multi);
    const counts = new Map<number, number>();
    for (const q of single) counts.set(q.correct[0], (counts.get(q.correct[0]) ?? 0) + 1);
    const worst = Math.max(...counts.values());
    expect(
      worst / single.length,
      `${code} key positions: ${JSON.stringify(Object.fromEntries(counts))}`
    ).toBeLessThanOrEqual(0.4);
  });

  it("uses every option position as a key at least once", () => {
    const single = qs().filter((q) => !q.multi);
    const used = new Set(single.map((q) => q.correct[0]));
    const positions = Math.min(...single.map((q) => q.options.length));
    expect(used.size, `${code} only ever keys to ${[...used].sort().join(",")}`).toBe(positions);
  });

  it("no multi-answer key set holds more than 40% of multi items", () => {
    const multi = qs().filter((q) => q.multi);
    if (multi.length === 0) return;
    const counts = new Map<string, number>();
    for (const q of multi) {
      const k = JSON.stringify([...q.correct].sort((a, b) => a - b));
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const worst = Math.max(...counts.values());
    expect(
      worst / multi.length,
      `${code} multi key sets: ${JSON.stringify(Object.fromEntries(counts))}`
    ).toBeLessThanOrEqual(0.4);
  });

  it("a blind 'always pick A' run scores far below the cut", () => {
    const score = blindScore(code, (q) => !q.multi && q.correct.length === 1 && q.correct[0] === 0);
    expect(score, `${code} always-A`).toBeLessThan(500);
  });

  it("a blind 'pick the top N options' run scores far below the cut", () => {
    const score = blindScore(
      code,
      (q) => JSON.stringify(q.correct) === JSON.stringify([...Array(q.select_count).keys()])
    );
    expect(score, `${code} top-N blind (cut is ${Math.round(100 + 9 * CUT_PCT)})`).toBeLessThan(500);
  });

  // ---- length tells ----
  // Added 2026-08-06 after the position-bias fix. Rebalancing key POSITION left a
  // second, larger channel untouched: the correct option was the longest one
  // 94-100% of the time, and "pick the longest option" scored 841-978 against a
  // 720 cut on every exam. Position was the defect we were told about; length was
  // the one nobody measured.

  /**
   * Threshold derivation — do not tighten this without redoing the arithmetic.
   *
   * The scorer is scaled = 100 + 9 x (weighted % correct), cut 720, so the
   * pick-longest strategy passes at ~69% key-longest:
   *      40% -> 460     55% -> 595     69% -> 721  PASSES
   *      50% -> 550     60% -> 640     75% -> 775  PASSES
   * 50% leaves a 170-point margin below the cut and is achievable without
   * damaging items. This gate originally sat at 40%, chosen because chance is
   * 25% rather than from the calculation above; hitting it required inflating
   * CCAR-P's option text by 49% and CCAR-F's by 26%, padding wrong answers
   * purely to clear an invented line. Correct answers legitimately carry more
   * content than wrong ones, and the gate should fight the exploit, not that.
   */
  it("the key is not reliably the longest option", () => {
    const single = qs().filter((q) => !q.multi);
    const keyLongest = single.filter((q) => {
      const lens = q.options.map((o) => o.length);
      return lens[q.correct[0]] === Math.max(...lens);
    }).length;
    const rate = keyLongest / single.length;
    expect(
      rate,
      `${code}: key is the longest option in ${keyLongest}/${single.length} items ` +
        `(${Math.round(rate * 100)}%); pick-longest would score ~${Math.round(100 + 900 * rate)}`
    ).toBeLessThanOrEqual(0.5);
  });

  it("a blind 'pick the longest option' run scores well below the cut", () => {
    // Threshold must stay CONSISTENT with the key-longest gate above: at 50%
    // key-longest this strategy scores ~550, so a <500 assertion could never be
    // satisfied alongside it. That contradiction was in the first version of
    // these gates. 600 keeps a 120-point margin under the 720 cut and is what a
    // 50% key-longest bank actually produces.
    const score = blindScore(code, (q) => {
      const ranked = q.options
        .map((o, i) => [o.length, i] as const)
        .sort((a, b) => b[0] - a[0])
        .slice(0, q.select_count)
        .map(([, i]) => i)
        .sort((a, b) => a - b);
      return JSON.stringify(ranked) === JSON.stringify([...q.correct].sort((a, b) => a - b));
    });
    expect(score, `${code} pick-longest blind (cut is ${Math.round(100 + 9 * CUT_PCT)})`).toBeLessThan(
      600
    );
  });

  /**
   * Reported, not asserted.
   *
   * Both of these measure the same property the two gates above already cover,
   * and unlike key-longest neither threshold has a derivation behind it — I
   * picked 1.25 and 60% by feel. Enforcing the 60% floor is what drove padding
   * every short distractor up to match a bloated key, inflating CCAR-P's option
   * text by 49%. A couple of short options among four lets a candidate eliminate
   * them; it does not tell them which of the rest is right, which is what the
   * exploit needs and what the gates above measure.
   *
   * Kept as a visible signal because implausibly short distractors are still an
   * item-quality smell worth seeing — just not a build-breaking one.
   */
  it("reports length-shape smells without failing on them", () => {
    const single = qs().filter((q) => !q.multi);
    const mean =
      single.reduce((acc, q) => {
        const lens = q.options.map((o) => o.length);
        const others = lens.filter((_, i) => i !== q.correct[0]);
        return acc + lens[q.correct[0]] / (others.reduce((a, b) => a + b, 0) / others.length);
      }, 0) / single.length;
    const shortOnes = qs().filter((q) => {
      const lens = q.options.map((o) => o.length);
      const keyLen = Math.max(...q.correct.map((i) => lens[i]));
      if (keyLen < 50) return false;
      return q.options.some((o, i) => !q.correct.includes(i) && o.length < 0.6 * keyLen);
    });
    if (mean > 1.6 || shortOnes.length > 0) {
      console.warn(
        `  [shape] ${code}: keys average ${mean.toFixed(2)}x their distractors; ` +
          `${shortOnes.length} items have a distractor under 60% of key length`
      );
    }
    expect(true).toBe(true);
  });

  /**
   * Punctuation tell (review 2026-09-24): length-padding patches left items where
   * exactly one option's trailing period differed from the rest, and that odd
   * option was a distractor 20 of 22 times on CCDV-F — "skip the odd one out"
   * became a strategy. Within an item, options must all end with "." or none.
   * CCAO-F still carries this debt (45 odd-one-out items); it is not on the
   * owner's exam path, so it warns rather than fails until it gets its own pass.
   */
  const PUNCT_DEBT = new Set(["CCAO-F"]);
  it("options within an item agree on trailing punctuation", () => {
    const mixed = qs().filter((q) => {
      const ends = q.options.map((o) => o.trimEnd().endsWith("."));
      return ends.some(Boolean) && !ends.every(Boolean);
    });
    if (PUNCT_DEBT.has(code)) {
      if (mixed.length) console.warn(`  [punct] ${code}: ${mixed.length} items mix trailing periods`);
      return;
    }
    // CCAR-P has 2 mixed items where the odd option is the KEY, which
    // carries no skip-the-odd-one tell; allow that handful.
    expect(mixed.length, mixed.map((q) => q.id).join(", ")).toBeLessThanOrEqual(2);
  });
});

describe("bank size vs exam length", () => {
  // A bank the same size as the exam means a "full simulation" serves the entire
  // bank and a retake is the identical paper — the score then measures recall of
  // the bank rather than readiness. This was a warning while CCDV-F and CCAR-P
  // sat at 1.0x; now that every bank has headroom it is an assertion, so the
  // condition cannot come back unnoticed.
  it.each(ENTRIES.map((e) => [e.exam.code, e.exam.items] as const))(
    "%s has enough headroom that a retake is not the same paper",
    (code, examLength) => {
      const bank = BANKS[code].length;
      const ratio = +(bank / examLength).toFixed(2);
      expect(
        ratio,
        `${code}: ${bank} items for a ${examLength}-item exam (${ratio}x) — ` +
          `a retake would reuse ${Math.round((examLength / bank) * 100)}% of the bank`
      ).toBeGreaterThanOrEqual(1.5);
    }
  );
});

describe("blueprint domain coverage", () => {
  /**
   * The full-mode sim draw (cf_start_session, scripts/sql/2026-08-07-stratified-
   * sim-draw.sql) apportions items across the blueprint domains by weight, with
   * a floor of one item per domain. That floor exists because scoring
   * renormalises over the domains actually logged (src/lib/scoring.ts), so a
   * domain drawing zero items silently drops out of the blueprint rather than
   * scoring zero — it was happening in 29.1% of CCDV-F sims.
   *
   * The draw now raises if a blueprint domain has an empty bank. These gates
   * keep that exception unreachable in production, and keep the thinnest
   * domains honest about how much of the score rides on a single item.
   */
  it.each(CODES.map((c) => [c] as const))("%s: every blueprint domain has questions", (code) => {
    const exam = EXAM_BY_CODE[code];
    const counts = new Map<string, number>();
    for (const q of BANKS[code]) counts.set(q.domain, (counts.get(q.domain) ?? 0) + 1);

    const empty = exam.domains.filter((d) => !counts.get(d.name));
    expect(
      empty.map((d) => d.name),
      `${code}: blueprint domains with no questions — cf_start_session would raise`
    ).toEqual([]);

    // Nothing may be authored under a domain the blueprint does not list, or it
    // can never be drawn and never scored.
    const stray = [...counts.keys()].filter((n) => !exam.domains.some((d) => d.name === n));
    expect(stray, `${code}: questions filed under non-blueprint domains`).toEqual([]);
  });

  it.each(CODES.map((c) => [c] as const))(
    "%s: each domain can supply a full draw's worth of distinct items",
    (code) => {
      const exam = EXAM_BY_CODE[code];
      if (exam.scenarioBank) return; // scenario exams draw whole scenarios, not per-domain quotas
      const counts = new Map<string, number>();
      for (const q of BANKS[code]) counts.set(q.domain, (counts.get(q.domain) ?? 0) + 1);
      const wSum = exam.domains.reduce((a, d) => a + d.weight, 0);

      // A domain whose bank cannot cover its own quota forces the apportionment
      // to hand its items to some other domain, so the delivered paper drifts
      // from the blueprint no matter what the draw does.
      const short = exam.domains
        .map((d) => ({
          name: d.name,
          quota: Math.max(1, Math.floor((d.weight / wSum) * exam.items)),
          have: counts.get(d.name) ?? 0,
        }))
        .filter((d) => d.have < d.quota);
      expect(
        short.map((d) => `${d.name}: ${d.have} items for a quota of ${d.quota}`),
        `${code}: domains that cannot fill their blueprint share`
      ).toEqual([]);
    }
  );

  // Per-item score granularity is deliberately NOT gated here. It depends on the
  // allocation the draw actually lands on, which this file cannot see — the
  // largest-remainder pass runs in SQL. scripts/verify-sim-draw.js reports it
  // from the real allocation instead.
});

/**
 * Inverse length tell (regrade 2026-09-25). The length gates above only looked
 * one way; authors correcting "key is longest" over-shot, and a new CCAR-F batch
 * had the key as the SHORTEST option 47% of the time. Symmetric bank-wide
 * gates, same thresholds and derivation as the longest-option pair.
 */
describe.each(CODES)("%s inverse length tell", (code) => {
  const single = () => BANKS[code].filter((q) => !q.multi);
  it("the key is not reliably the shortest option", () => {
    const n = single().filter((q) => {
      const lens = q.options.map((o) => o.length);
      return lens[q.correct[0]] === Math.min(...lens);
    }).length;
    expect(n / single().length, `${code}: key shortest in ${n}/${single().length}`).toBeLessThanOrEqual(0.5);
  });
  it("a blind 'pick the shortest option' run scores well below the cut", () => {
    const score = blindScore(code, (q) => {
      const ranked = q.options
        .map((o, i) => [o.length, i] as const)
        .sort((a, b) => a[0] - b[0])
        .slice(0, q.select_count)
        .map(([, i]) => i)
        .sort((a, b) => a - b);
      return JSON.stringify(ranked) === JSON.stringify([...q.correct].sort((a, b) => a - b));
    });
    expect(score, `${code} pick-shortest blind`).toBeLessThan(600);
  });
});

/**
 * Per-batch length tells for the exams on the owner's path. A bank can look
 * balanced overall while each authoring batch leans hard one way (CCAR-F:
 * originals key-longest 47%, batch2 key-shortest 47%, bank-wide ~30/32) —
 * and a candidate drilling on a batch learns that batch's lean. A batch is a
 * fixtures/questions/additions/<CODE>-*.json file; the rest are "original".
 * 40% is below where either blind strategy could matter (~460 scaled).
 */
const BATCH_GATED = ["CCAR-F", "CCDV-F"];
const ADDITIONS = path.join(QDIR, "additions");
const BATCHED = BATCH_GATED.filter((c) => BANKS[c] && fs.existsSync(ADDITIONS));
eachOrSkip(BATCHED, "%s per-batch length tells", "real banks and authoring batches not present", (code) => {
  const dir = ADDITIONS;
  const byId = new Map(BANKS[code].map((q) => [q.id, q]));
  const batches: Record<string, string[]> = {};
  for (const f of fs.readdirSync(dir).filter((f) => f.startsWith(`${code}-`) && f.endsWith(".json"))) {
    batches[f] = (JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as { questions: Question[] })
      .questions.map((q) => q.id);
  }
  const inBatch = new Set(Object.values(batches).flat());
  batches.original = BANKS[code].filter((q) => !inBatch.has(q.id)).map((q) => q.id);

  it.each(Object.entries(batches))("%s: key is neither reliably longest nor shortest", (name, ids) => {
    const single = ids.map((id) => byId.get(id)).filter((q): q is Question => !!q && !q.multi);
    if (single.length < 20) return; // too small to measure a lean
    const rate = (pick: (l: number[]) => number) =>
      single.filter((q) => {
        const lens = q.options.map((o) => o.length);
        return lens[q.correct[0]] === pick(lens);
      }).length / single.length;
    const longest = rate((l) => Math.max(...l));
    const shortest = rate((l) => Math.min(...l));
    expect(longest, `${code} ${name}: key longest ${Math.round(longest * 100)}%`).toBeLessThanOrEqual(0.4);
    expect(shortest, `${code} ${name}: key shortest ${Math.round(shortest * 100)}%`).toBeLessThanOrEqual(0.4);
  });
});

/** Sealed go/no-go forms (2026-09-25-scoring-holdout.sql). */
const HOLDOUT = REAL_EXAMS.filter(
  (e) => e.holdoutItems && fs.existsSync(path.join(QDIR, "holdout", `${e.code}.json`))
).map((e) => e.code);
eachOrSkip(HOLDOUT, "%s holdout form", "real banks and holdout forms not present", (code) => {
  const exam = EXAM_BY_CODE[code];
  const form = JSON.parse(fs.readFileSync(path.join(QDIR, "holdout", `${code}.json`), "utf8")) as {
    exam_code: string;
    question_ids: string[];
  };
  const byId = new Map(BANKS[code].map((q) => [q.id, q]));
  const items = form.question_ids.map((id) => byId.get(id));

  it("lists exactly holdoutItems existing, distinct items", () => {
    expect(form.exam_code).toBe(code);
    expect(new Set(form.question_ids).size).toBe(form.question_ids.length);
    expect(form.question_ids.length).toBe(exam.holdoutItems);
    expect(items.every(Boolean), "every holdout id exists in the bank").toBe(true);
  });
  it("covers every blueprint domain, and every scenario for scenario exams", () => {
    const doms = new Set(items.map((q) => q!.domain));
    expect(exam.domains.every((d) => doms.has(d.name))).toBe(true);
    if (exam.scenarioBank) {
      expect(new Set(items.map((q) => q!.scenario)).size).toBe(exam.scenarioBank.total);
    }
  });
  it("leaves a practice pool with retake headroom and full scenario draws", () => {
    const pool = BANKS[code].length - form.question_ids.length;
    expect(pool / exam.items).toBeGreaterThanOrEqual(1.5);
    if (exam.scenarioBank) {
      const held = new Set(form.question_ids);
      const perScenario = new Map<string, number>();
      for (const q of BANKS[code]) {
        if (held.has(q.id)) continue;
        perScenario.set(q.scenario!, (perScenario.get(q.scenario!) ?? 0) + 1);
      }
      for (const [s, n] of perScenario) {
        expect(n, `${s}: ${n} practice items`).toBeGreaterThanOrEqual(exam.scenarioBank.perScenario);
      }
    }
  });
});

/**
 * Task-statement tags (2026-09-25-task-statements.sql). Every item carries one
 * primary task id "<domain#>.<statement#>" that must exist in the extracted
 * objectives and sit inside the item's own domain; seed-tasks.js refuses a
 * partial map, and this keeps new batches from arriving untagged.
 */
import ccarObjectives from "./objectives/ccar-f";
import ccdvObjectives from "./objectives/ccdv-f";
import { STUB_NOTE } from "./objectives/stub";
const TAGGED: Record<string, typeof ccarObjectives> = { "CCAR-F": ccarObjectives, "CCDV-F": ccdvObjectives };
type Tags = { exam_code: string; tasks: Record<string, string>; items: Record<string, string> };
// Needs the real bank, its tag file, AND generated (non-stub) objectives.
const TAG_CODES = Object.keys(TAGGED).filter(
  (c) =>
    BANKS[c] &&
    fs.existsSync(path.join(QDIR, "tags", `${c}.json`)) &&
    !TAGGED[c].some((d) => d.groups.some((g) => g.points.includes(STUB_NOTE)))
);
eachOrSkip(TAG_CODES, "%s task-statement tags", "real banks, tag files and extracted objectives not present", (code) => {
  const tags = JSON.parse(fs.readFileSync(path.join(QDIR, "tags", `${code}.json`), "utf8")) as Tags;
  const objectives = TAGGED[code];

  it("tags every bank item exactly once, and nothing else", () => {
    const bankIds = BANKS[code].map((q) => q.id).sort();
    expect(Object.keys(tags.items).sort()).toEqual(bankIds);
  });
  it("task ids resolve to guide statements whose titles match", () => {
    objectives.forEach((d, di) =>
      d.groups.forEach((g, gi) => {
        expect(tags.tasks[`${di + 1}.${gi + 1}`], `${di + 1}.${gi + 1}`).toBe(g.title);
      })
    );
    const count = objectives.reduce((n, d) => n + d.groups.length, 0);
    expect(Object.keys(tags.tasks)).toHaveLength(count);
  });
  it("each item's task sits inside the item's own domain", () => {
    const bad = BANKS[code].filter((q) => {
      const t = tags.items[q.id];
      const di = Number(t.split(".")[0]) - 1;
      return objectives[di]?.domain !== q.domain;
    });
    expect(bad.map((q) => `${q.id}->${tags.items[q.id]}`)).toEqual([]);
  });
});

/** The sample bank's tags, checked against the sample blueprint's domain order. */
describe("DEMO-F sample task-statement tags", () => {
  const tags = JSON.parse(fs.readFileSync(path.join(QDIR, "sample", "tags.json"), "utf8")) as Tags;
  it("tags every sample item exactly once, and nothing else", () => {
    expect(tags.exam_code).toBe(SAMPLE_EXAM.code);
    expect(Object.keys(tags.items).sort()).toEqual(BANKS[SAMPLE_EXAM.code].map((q) => q.id).sort());
  });
  it("each item's task exists and sits inside the item's own domain", () => {
    for (const q of BANKS[SAMPLE_EXAM.code]) {
      const t = tags.items[q.id];
      expect(tags.tasks[t], `${q.id} -> ${t}`).toBeTruthy();
      expect(SAMPLE_EXAM.domains[Number(t.split(".")[0]) - 1]?.name, q.id).toBe(q.domain);
    }
  });
});

/**
 * Lone-enumerated-option tell (regrade 3, 2026-09-25). An option is
 * "enumerated" if it has ';' or ':' or 2+ commas. In items where exactly ONE
 * option was enumerated, that option was the key 95% of the time on CCDV-F and
 * 70% on CCAR-F — "pick the one that lists things" beat chance by 45-70 points.
 * Gate at 40% (chance is 25%) once the pattern fires often enough to measure.
 */
const enumerated = (o: string) => o.includes(";") || o.includes(":") || (o.match(/,/g) ?? []).length >= 2;
const ENUM_GATED = BATCH_GATED.filter((c) => BANKS[c]);
eachOrSkip(ENUM_GATED, "%s lone-enumerated-option tell", "real banks not present", (code) => {
  it("the lone enumerated option is not reliably the key", () => {
    const fires = BANKS[code].filter((q) => !q.multi && q.options.filter(enumerated).length === 1);
    const hits = fires.filter((q) => enumerated(q.options[q.correct[0]])).length;
    if (fires.length < 10) return;
    expect(hits / fires.length, `${code}: lone enumerated = key in ${hits}/${fires.length}`).toBeLessThanOrEqual(0.4);
  });
});

/**
 * General odd-format gate (regrade 4). Each fix to a single punctuation mark
 * moved the cue to the next one (';' -> ','). So instead of one mark at a time,
 * test every surface marker the same way: among single-answer items where
 * exactly ONE option carries the marker, how often is that option the key?
 * Chance is 25%. Fail above 40% (the lone marker picks the key) or, with enough
 * firings to measure, below 8% (the lone marker eliminates an option).
 * Rare markers are pooled so small counts still get checked. Also: the key
 * must not reliably be the SECOND-longest option (the longest/shortest gates
 * can't see that). Exams off the owner's path warn instead of failing.
 */
const MARKERS: Record<string, (o: string) => boolean> = {
  comma: (o) => o.includes(","),
  semicolon: (o) => o.includes(";"),
  colon: (o) => o.includes(":"),
  justification: (o) => /\b(because|since|so that)\b/i.test(o),
  quote: (o) => /["\u201c\u201d']/.test(o),
  digit: (o) => /\d/.test(o),
  rare: (o) => o.includes("(") || /\b(e\.g\.|for example|such as)\b/i.test(o) || (o.match(/\band\b/g) ?? []).length >= 2,
};
describe.each(CODES)("%s odd-format markers", (code) => {
  const gated = BATCH_GATED.includes(code);
  const single = () => BANKS[code].filter((q) => !q.multi);
  it.each(Object.keys(MARKERS))("lone '%s' option is neither the key nor never the key", (m) => {
    const has = MARKERS[m];
    const fires = single().filter((q) => q.options.filter(has).length === 1);
    const hits = fires.filter((q) => has(q.options[q.correct[0]])).length;
    const rate = fires.length ? hits / fires.length : 0;
    const high = fires.length >= 10 && rate > 0.4;
    const low = fires.length >= 15 && rate < 0.08;
    const msg = `${code} lone ${m}: key in ${hits}/${fires.length}`;
    if (!gated) {
      if (high || low) console.warn(`  [marker] ${msg}`);
      return;
    }
    expect(high, msg).toBe(false);
    expect(low, msg).toBe(false);
  });
  it("the key is not reliably the second-longest option", () => {
    const four = single().filter((q) => q.options.length === 4);
    const n = four.filter((q) => {
      const order = q.options.map((o, i) => [o.length, i]).sort((a, b) => b[0] - a[0]);
      return order[1][1] === q.correct[0];
    }).length;
    const msg = `${code}: key second-longest in ${n}/${four.length}`;
    if (!gated) {
      if (n / four.length > 0.4) console.warn(`  [marker] ${msg}`);
      return;
    }
    expect(n / four.length, msg).toBeLessThanOrEqual(0.4);
  });
});
