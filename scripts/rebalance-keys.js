/**
 * Rebalances answer-key positions across the question banks.
 *
 * THE DEFECT (found 2026-08-06)
 * The banks were generated with the correct answer clustered at the top of the
 * option list. Options are served in stored order — nothing shuffles them — so
 * a blind "pick the top N options" strategy scored:
 *     CCAO-F 385 · CCAR-F 310 · CCAR-P 870 · CCDV-F 579   (cut = 720)
 * CCAR-P was passable, with a Comfortable Margin badge, without reading a word.
 * Single-answer skew: CCAR-P 45/54 keyed to A, CCDV-F never used C or D at all.
 * Multi skew: CCDV-F 8/8, CCAO-F 8/9 and CCAR-P 7/9 keyed to exactly [0,1].
 * Only CCAR-F had been QA'd and rebalanced back on 2026-07-14.
 *
 * THE FIX
 * Permute each item's options so key positions are spread evenly, carrying
 * `rationale.options` along in the same order (it is parallel to `options` —
 * permuting one without the other silently attaches every explanation to the
 * wrong choice) and remapping `correct`.
 *
 * Fixtures are the source of truth, so they are rewritten here and re-seeded.
 * The permutation for every item is written to fixtures/key-permutations.json
 * so the DB migration can move already-stored answer indices
 * (cf_practice_answers.answer, cf_exam_sessions.answers) through the exact same
 * mapping instead of trying to regenerate it.
 *
 * Deterministic: same input always yields the same output.
 *
 * Run: node scripts/rebalance-keys.js [--check | --top-up]
 *   --check   report the current distribution and exit without writing
 *   --top-up  permute ONLY items absent from key-permutations.json, assigning
 *             each the least-used key position/set so far. This is the mode to
 *             use after merging an authored batch: re-running the full rebalance
 *             would re-permute existing items whose answers have already been
 *             migrated, silently breaking stored history.
 */
const fs = require("fs");
const path = require("path");

const CODES = ["CCAO-F", "CCDV-F", "CCAR-F", "CCAR-P"];
const FIXTURES = path.join(__dirname, "..", "fixtures", "questions");
const PERM_FILE = path.join(__dirname, "..", "fixtures", "key-permutations.json");
const CHECK_ONLY = process.argv.includes("--check");
const TOP_UP = process.argv.includes("--top-up");

/** Deterministic PRNG (mulberry32) so reruns reproduce byte-identical output. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seed from the exam code so each bank permutes independently but repeatably. */
function seedFor(code) {
  let h = 2166136261;
  for (const ch of code) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function shuffled(arr, rand) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** All k-sized index combinations of n options, ascending. */
function combinations(n, k) {
  const out = [];
  const walk = (start, acc) => {
    if (acc.length === k) return out.push([...acc]);
    for (let i = start; i < n; i++) {
      acc.push(i);
      walk(i + 1, acc);
      acc.pop();
    }
  };
  walk(0, []);
  return out;
}

/**
 * Build perm where perm[newIndex] = oldIndex, placing the correct option(s) at
 * `targets` and scattering the distractors through the remaining slots.
 */
function permutationFor(correct, nOptions, targets, rand) {
  const perm = new Array(nOptions).fill(-1);
  const sortedCorrect = [...correct].sort((a, b) => a - b);
  targets.forEach((slot, i) => {
    perm[slot] = sortedCorrect[i];
  });
  const distractors = shuffled(
    [...Array(nOptions).keys()].filter((i) => !sortedCorrect.includes(i)),
    rand
  );
  let d = 0;
  for (let slot = 0; slot < nOptions; slot++) {
    if (perm[slot] === -1) perm[slot] = distractors[d++];
  }
  return perm;
}

function distribution(questions) {
  const single = {};
  const multi = {};
  for (const q of questions) {
    if (q.multi) {
      const k = JSON.stringify([...q.correct].sort((a, b) => a - b));
      multi[k] = (multi[k] ?? 0) + 1;
    } else {
      single[q.correct[0]] = (single[q.correct[0]] ?? 0) + 1;
    }
  }
  return { single, multi };
}

function report(code, questions) {
  const { single, multi } = distribution(questions);
  const nSingle = Object.values(single).reduce((a, b) => a + b, 0);
  const worstSingle = Math.max(...Object.values(single), 0);
  const distinctMulti = Object.keys(multi).length;
  const nMulti = Object.values(multi).reduce((a, b) => a + b, 0);
  const worstMulti = Math.max(...Object.values(multi), 0);
  console.log(
    `${code.padEnd(7)} single ${JSON.stringify(single).padEnd(38)} ` +
      `worst ${Math.round((100 * worstSingle) / (nSingle || 1))}%   ` +
      `multi ${distinctMulti} distinct set${distinctMulti === 1 ? " " : "s"} over ${nMulti}, ` +
      `worst ${Math.round((100 * worstMulti) / (nMulti || 1))}%`
  );
}

const perms =
  TOP_UP && fs.existsSync(PERM_FILE) ? JSON.parse(fs.readFileSync(PERM_FILE, "utf8")) : {};
const alreadyPermuted = new Set(Object.keys(perms));
let changed = 0;

/**
 * Top-up mode: leave known items alone and give each new item the currently
 * least-used key position (single) or key set (multi), so the whole bank stays
 * inside the distribution gate.
 */
function topUpExam(code, questions) {
  const rand = rng(seedFor(code + ":topup"));
  const fresh = questions.filter((q) => !alreadyPermuted.has(q.id));
  if (fresh.length === 0) return 0;

  const posCount = new Map();
  const setCount = new Map();
  for (const q of questions) {
    if (alreadyPermuted.has(q.id)) {
      if (q.multi) {
        const k = JSON.stringify([...q.correct].sort((a, b) => a - b));
        setCount.set(k, (setCount.get(k) ?? 0) + 1);
      } else {
        posCount.set(q.correct[0], (posCount.get(q.correct[0]) ?? 0) + 1);
      }
    }
  }

  let n = 0;
  for (const q of fresh) {
    const size = q.options.length;
    let targets;
    if (q.multi) {
      const pool = combinations(size, q.correct.length);
      const best = pool.reduce((a, b) => {
        const ca = setCount.get(JSON.stringify(a)) ?? 0;
        const cb = setCount.get(JSON.stringify(b)) ?? 0;
        return cb < ca ? b : a;
      });
      targets = best;
      setCount.set(JSON.stringify(best), (setCount.get(JSON.stringify(best)) ?? 0) + 1);
    } else {
      let best = 0;
      for (let p = 1; p < size; p++) {
        if ((posCount.get(p) ?? 0) < (posCount.get(best) ?? 0)) best = p;
      }
      targets = [best];
      posCount.set(best, (posCount.get(best) ?? 0) + 1);
    }

    const perm = permutationFor(q.correct, size, targets, rand);
    q.options = perm.map((old) => q.options[old]);
    if (Array.isArray(q.rationale?.options)) {
      q.rationale.options = perm.map((old) => q.rationale.options[old]);
    }
    q.correct = q.correct.map((old) => perm.indexOf(old)).sort((a, b) => a - b);
    perms[q.id] = perm;
    n++;
  }
  return n;
}

for (const code of CODES) {
  const file = path.join(FIXTURES, `${code}.json`);
  const bank = JSON.parse(fs.readFileSync(file, "utf8"));
  const questions = bank.questions;

  if (CHECK_ONLY) {
    report(code, questions);
    continue;
  }

  if (TOP_UP) {
    const n = topUpExam(code, questions);
    if (n > 0) {
      changed += n;
      fs.writeFileSync(file, JSON.stringify(bank, null, 2) + "\n", "utf8");
    }
    process.stdout.write(`${code.padEnd(7)} ${String(n).padStart(3)} new items placed   `);
    report(code, questions);
    continue;
  }

  const rand = rng(seedFor(code));

  // Assign target key positions round-robin over a shuffled item order, so the
  // spread is even and uncorrelated with domain or item number.
  const singles = shuffled(
    questions.filter((q) => !q.multi).map((q) => q.id),
    rand
  );
  const multis = shuffled(
    questions.filter((q) => q.multi).map((q) => q.id),
    rand
  );

  const targetFor = {};
  singles.forEach((id, i) => {
    targetFor[id] = [i % 4];
  });
  // Multi items cycle through every k-combination so no set repeats until the
  // whole space is used.
  const byK = {};
  for (const id of multis) {
    const q = questions.find((x) => x.id === id);
    const k = q.correct.length;
    if (!byK[k]) byK[k] = { pool: shuffled(combinations(q.options.length, k), rand), i: 0 };
    const slot = byK[k];
    targetFor[id] = slot.pool[slot.i++ % slot.pool.length];
  }

  for (const q of questions) {
    const n = q.options.length;
    const targets = targetFor[q.id];
    const perm = permutationFor(q.correct, n, targets, rand);

    const isIdentity = perm.every((old, i) => old === i);
    if (!isIdentity) changed++;

    q.options = perm.map((old) => q.options[old]);
    if (Array.isArray(q.rationale?.options)) {
      // Parallel array — must move with the options it explains.
      q.rationale.options = perm.map((old) => q.rationale.options[old]);
    }
    q.correct = q.correct.map((old) => perm.indexOf(old)).sort((a, b) => a - b);

    perms[q.id] = perm;

    // Invariant: the key must now sit exactly where we aimed it.
    const want = JSON.stringify([...targets].sort((a, b) => a - b));
    if (JSON.stringify(q.correct) !== want) {
      throw new Error(`${q.id}: key landed at ${JSON.stringify(q.correct)}, wanted ${want}`);
    }
  }

  fs.writeFileSync(file, JSON.stringify(bank, null, 2) + "\n", "utf8");
  report(code, questions);
}

if (CHECK_ONLY) process.exit(0);

fs.writeFileSync(PERM_FILE, JSON.stringify(perms, null, 0) + "\n", "utf8");

if (TOP_UP) {
  console.log(
    `\nplaced ${changed} new item(s); ${alreadyPermuted.size} existing items untouched. ` +
      `No answer migration needed — new items have no stored answers.`
  );
  console.log("next: npx vitest run   then   node scripts/seed-questions.js");
} else {
  console.log(
    `\nrewrote ${CODES.length} fixtures (${changed} items repositioned), ` +
      `wrote ${Object.keys(perms).length} permutations to ${path.relative(process.cwd(), PERM_FILE)}`
  );
  console.log("next: node scripts/seed-questions.js   then migrate stored answer indices");
}
