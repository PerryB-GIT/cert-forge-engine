/**
 * Checks a distractor patch against the length targets BEFORE it is applied, and
 * prints exactly which replacements still fall short and by how much.
 *
 * Written after four passes on CCAR-P and two on CCAO-F all under-shot: writing
 * replacements "a bit longer" by eye repeatedly moved the ratio without moving
 * key-longest, because clearing a threshold is a specific character count. This
 * closes that loop so a patch is right before it lands rather than after three
 * more rounds.
 *
 * Run: node scripts/check-patch-targets.js <patch.json>
 */
const fs = require("fs");
const path = require("path");

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/check-patch-targets.js <patch.json>");
  process.exit(1);
}
const ROOT = path.join(__dirname, "..");
const patch = JSON.parse(fs.readFileSync(file, "utf8"));
const bank = JSON.parse(
  fs.readFileSync(path.join(ROOT, "fixtures", "questions", `${patch.exam_code}.json`), "utf8")
);
const byId = Object.fromEntries(bank.questions.map((q) => [q.id, q]));

let short = 0;
let noFlip = 0;
const lines = [];

for (const p of patch.patches) {
  const q = byId[p.id];
  if (!q) continue;
  const lens = q.options.map((o) => o.length);
  for (const [i, t] of Object.entries(p.options)) lens[Number(i)] = t.length;

  const keyLen = Math.max(...q.correct.map((i) => lens[i]));
  // gate 3: no distractor under 60% of key (only when the key is long enough to matter)
  if (keyLen >= 50) {
    for (let i = 0; i < lens.length; i++) {
      if (q.correct.includes(i)) continue;
      const need = Math.ceil(0.6 * keyLen);
      if (lens[i] < need) {
        short++;
        lines.push(`  SHORT ${p.id} [${i}] ${lens[i]} < ${need} (+${need - lens[i]} needed)`);
      }
    }
  }
  // gate 1: key must not be the longest, in enough items
  if (!q.multi) {
    const k = q.correct[0];
    if (lens[k] === Math.max(...lens)) {
      const runner = Math.max(...lens.filter((_, i) => i !== k));
      noFlip++;
      lines.push(`  KEYMAX ${p.id} key=${lens[k]} runnerUp=${runner} (+${lens[k] - runner + 1} to flip)`);
    }
  }
}

console.log(`${patch.patches.length} items in patch`);
console.log(`  ${short} replacement(s) still below the 60% floor`);
console.log(`  ${noFlip} item(s) where the key would still be longest`);
if (lines.length) console.log("\n" + lines.join("\n"));
else console.log("\nAll targets met.");
