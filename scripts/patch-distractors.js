/**
 * Applies distractor rewrites to a question bank.
 *
 * WHY: the correct option was the longest one 94-100% of the time across every
 * bank, so "pick the longest option" scored 841-978 against a 720 cut. The fix
 * is to bring distractors up to comparable length — which also makes them more
 * plausible, i.e. better distractors — rather than trimming the keys, whose
 * fully-articulated form is what makes the missed-answer bank and study sheets
 * worth reading.
 *
 * SAFETY: a patch may only touch NON-KEY indices. The script refuses to apply
 * anything that would alter a key's text, change the key indices, or change the
 * number of options — so a rewrite can never silently move the right answer.
 * rationale.options stays index-aligned because indices never move.
 *
 * Patch format:
 *   { "exam_code": "CCAR-P",
 *     "patches": [ { "id": "CCAR-P-D1-01", "options": { "1": "new text", "2": "..." } } ] }
 *
 * Run: node scripts/patch-distractors.js fixtures/questions/patches/<file>.json [--dry]
 */
const fs = require("fs");
const path = require("path");

const file = process.argv[2];
const DRY = process.argv.includes("--dry");
if (!file) {
  console.error("usage: node scripts/patch-distractors.js <patch.json> [--dry]");
  process.exit(1);
}

const ROOT = path.join(__dirname, "..");
const patch = JSON.parse(fs.readFileSync(file, "utf8"));
const bankPath = path.join(ROOT, "fixtures", "questions", `${patch.exam_code}.json`);
const bank = JSON.parse(fs.readFileSync(bankPath, "utf8"));
const byId = Object.fromEntries(bank.questions.map((q) => [q.id, q]));

const errors = [];
const applied = [];

for (const p of patch.patches) {
  const q = byId[p.id];
  if (!q) {
    errors.push(`${p.id}: not found in ${patch.exam_code}`);
    continue;
  }
  const keyBefore = q.correct.map((i) => q.options[i]);
  const nOptsBefore = q.options.length;

  for (const [idxStr, text] of Object.entries(p.options)) {
    const idx = Number(idxStr);
    if (!Number.isInteger(idx) || idx < 0 || idx >= q.options.length) {
      errors.push(`${p.id}: option index ${idxStr} out of range`);
      continue;
    }
    if (q.correct.includes(idx)) {
      errors.push(`${p.id}: index ${idx} is a KEY — patches may only rewrite distractors`);
      continue;
    }
    if (typeof text !== "string" || text.length < 15) {
      errors.push(`${p.id}: replacement for index ${idx} is missing or too short`);
      continue;
    }
    q.options[idx] = text;
  }

  // Invariants: keys untouched, option count unchanged, no duplicate options.
  const keyAfter = q.correct.map((i) => q.options[i]);
  if (JSON.stringify(keyBefore) !== JSON.stringify(keyAfter)) {
    errors.push(`${p.id}: key text changed — refusing`);
  }
  if (q.options.length !== nOptsBefore) {
    errors.push(`${p.id}: option count changed — refusing`);
  }
  if (new Set(q.options).size !== q.options.length) {
    errors.push(`${p.id}: a rewrite duplicated another option`);
  }
  if (q.rationale.options.length !== q.options.length) {
    errors.push(`${p.id}: rationale.options no longer parallel`);
  }
  applied.push(p.id);
}

if (errors.length) {
  console.error(`REJECTED — ${errors.length} problem(s):\n  ` + errors.join("\n  "));
  process.exit(1);
}

// Report the effect on the length tell.
function stats(questions) {
  const single = questions.filter((q) => !q.multi);
  const longest = single.filter((q) => {
    const l = q.options.map((o) => o.length);
    return l[q.correct[0]] === Math.max(...l);
  }).length;
  const ratio =
    single.reduce((acc, q) => {
      const l = q.options.map((o) => o.length);
      const k = l[q.correct[0]];
      const others = l.filter((_, i) => i !== q.correct[0]);
      return acc + k / (others.reduce((a, b) => a + b, 0) / others.length);
    }, 0) / single.length;
  const under60 = questions.filter((q) => {
    const l = q.options.map((o) => o.length);
    const keyLen = Math.max(...q.correct.map((i) => l[i]));
    return q.options.some((o, i) => !q.correct.includes(i) && o.length < 0.6 * keyLen);
  }).length;
  return { longestPct: (100 * longest) / single.length, ratio, under60 };
}

const before = stats(JSON.parse(fs.readFileSync(bankPath, "utf8")).questions);
const after = stats(bank.questions);

console.log(`${patch.exam_code}: ${applied.length} item(s) patched`);
console.log(
  `   key is longest option : ${before.longestPct.toFixed(0)}%  ->  ${after.longestPct.toFixed(0)}%   (target <= 40%)`
);
console.log(
  `   key/distractor ratio  : ${before.ratio.toFixed(2)}  ->  ${after.ratio.toFixed(2)}   (target <= 1.25)`
);
console.log(
  `   items with a <60% distractor: ${before.under60}  ->  ${after.under60}   (target 0)`
);

if (DRY) {
  console.log("\n[dry] nothing written");
  process.exit(0);
}

fs.writeFileSync(bankPath, JSON.stringify(bank, null, 2) + "\n", "utf8");
console.log(`\nwrote ${path.relative(ROOT, bankPath)}`);
console.log(`next: npx vitest run   then   node scripts/seed-questions.js ${patch.exam_code}`);
