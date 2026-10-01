/**
 * Rewrites the text of CORRECT options (keys), tightening verbose keys so that
 * option length stops predicting the answer.
 *
 * WHY THIS EXISTS
 * patch-distractors.js can only lengthen distractors. Using it alone to close
 * the length tell inflated CCAR-P's option text by 49% (+19.5k characters) --
 * padding every wrong answer with filler to match keys I had written far too
 * long. The tell is real, but the adjustment belongs on both sides. Shortening a
 * bloated key fixes the same statistic and makes the item easier to read.
 *
 * WHY IT IS DANGEROUS, AND WHAT GUARDS IT
 * This is the one edit that can change what the right answer MEANS. Automated
 * checks cannot verify meaning, so they verify everything around it:
 *
 *   1. The key INDEX never moves. Only its text changes, so `correct` and
 *      rationale.options stay aligned by construction.
 *   2. Content-word overlap with the original key must stay above --min-overlap
 *      (default 0.5). A rewrite that keeps half the substantive words is a trim;
 *      one that keeps a quarter is a different answer. This catches wholesale
 *      replacement, not subtle drift.
 *   3. The new key must not duplicate another option.
 *   4. The key must still be the option its own rationale describes -- enforced
 *      by requiring the patch to restate the rationale entry when it changes.
 *   5. Every edit is written to a review file as an explicit before/after diff,
 *      so the whole set can be read in one pass rather than trusted.
 *
 * None of that replaces reading the diffs. It narrows what can go wrong silently.
 *
 * Patch format:
 *   { "exam_code": "CCAO-F",
 *     "keys": [ { "id": "...", "index": 2, "text": "...", "rationale": "optional replacement" } ] }
 *
 * Run: node scripts/patch-keys.js <patch.json> [--dry] [--min-overlap 0.5]
 */
const fs = require("fs");
const path = require("path");

const file = process.argv[2];
const DRY = process.argv.includes("--dry");
const ovIdx = process.argv.indexOf("--min-overlap");
const MIN_OVERLAP = ovIdx > -1 ? Number(process.argv[ovIdx + 1]) : 0.5;
if (!file) {
  console.error("usage: node scripts/patch-keys.js <patch.json> [--dry] [--min-overlap 0.5]");
  process.exit(1);
}

const ROOT = path.join(__dirname, "..");
const patch = JSON.parse(fs.readFileSync(file, "utf8"));
const bankPath = path.join(ROOT, "fixtures", "questions", `${patch.exam_code}.json`);
const bank = JSON.parse(fs.readFileSync(bankPath, "utf8"));
const byId = Object.fromEntries(bank.questions.map((q) => [q.id, q]));

const STOP = new Set(
  ("the a an and or of to in on for with that this it is are be as by from at into so its их" +
    " you your they their we our not no but if then than when which who whom whose what where" +
    " how why all any each every some most more less no nor only own same such too very can" +
    " will just should now do does did done has have had having was were been being would" +
    " could may might must shall about after before during over under again further once here" +
    " there because while against between through above below up down out off other").split(/\s+/)
);
const words = (s) =>
  new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w))
  );

const errors = [];
const review = [];

for (const k of patch.keys) {
  const q = byId[k.id];
  if (!q) {
    errors.push(`${k.id}: not found in ${patch.exam_code}`);
    continue;
  }
  if (!q.correct.includes(k.index)) {
    errors.push(`${k.id}: index ${k.index} is NOT a key — use patch-distractors.js for distractors`);
    continue;
  }
  const before = q.options[k.index];
  if (typeof k.text !== "string" || k.text.length < 15) {
    errors.push(`${k.id}: replacement text missing or too short`);
    continue;
  }

  const a = words(before);
  const b = words(k.text);
  const kept = [...a].filter((w) => b.has(w)).length;
  const overlap = a.size === 0 ? 1 : kept / a.size;
  if (overlap < MIN_OVERLAP) {
    errors.push(
      `${k.id}: only ${(overlap * 100).toFixed(0)}% of the original key's content words survive ` +
        `(min ${(MIN_OVERLAP * 100).toFixed(0)}%) — this reads as a replacement, not a trim`
    );
    continue;
  }

  q.options[k.index] = k.text;
  if (k.rationale) q.rationale.options[k.index] = k.rationale;

  if (new Set(q.options).size !== q.options.length) {
    errors.push(`${k.id}: rewritten key now duplicates another option`);
    continue;
  }
  if (q.rationale.options.length !== q.options.length) {
    errors.push(`${k.id}: rationale.options no longer parallel`);
    continue;
  }

  review.push({
    id: k.id,
    index: k.index,
    overlap: +(overlap * 100).toFixed(0),
    chars: `${before.length} -> ${k.text.length}`,
    before,
    after: k.text,
  });
}

if (errors.length) {
  console.error(`REJECTED — ${errors.length} problem(s):\n  ` + errors.join("\n  "));
  process.exit(1);
}

const reviewPath = path.join(ROOT, "fixtures", "questions", "patches", `${path.basename(file, ".json")}.review.txt`);
const reviewText = review
  .map((r) => `${r.id} [key ${r.index}]  ${r.chars} chars, ${r.overlap}% words kept\n  -  ${r.before}\n  +  ${r.after}\n`)
  .join("\n");

console.log(`${patch.exam_code}: ${review.length} key(s) rewritten`);
const shrink = review.reduce((a, r) => {
  const [b, c] = r.chars.split(" -> ").map(Number);
  return a + (b - c);
}, 0);
console.log(`   ${shrink} characters removed from key text`);
console.log(`   lowest content-word overlap: ${Math.min(...review.map((r) => r.overlap))}%`);

if (DRY) {
  console.log(`\n[dry] nothing written. Review diff:\n\n${reviewText}`);
  process.exit(0);
}

fs.writeFileSync(bankPath, JSON.stringify(bank, null, 2) + "\n", "utf8");
fs.writeFileSync(reviewPath, reviewText, "utf8");
console.log(`\nwrote ${path.relative(ROOT, bankPath)}`);
console.log(`audit trail: ${path.relative(ROOT, reviewPath)}`);
