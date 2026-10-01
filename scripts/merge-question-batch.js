/**
 * Merges an authored batch from fixtures/questions/additions/ into the live bank
 * for that exam.
 *
 * Validates before writing anything: shape, no duplicate ids against the
 * existing bank, domain names matching src/lib/exams.ts, select_count/multi
 * agreement, key indices in range, and parallel rationale.options. A batch that
 * fails any check is rejected whole rather than half-applied.
 *
 * Run: node scripts/merge-question-batch.js fixtures/questions/additions/CCAO-F-batch2.json [--dry]
 * Then: node scripts/seed-questions.js CCAO-F
 */
const fs = require("fs");
const path = require("path");

const file = process.argv[2];
const DRY = process.argv.includes("--dry");
if (!file) {
  console.error("usage: node scripts/merge-question-batch.js <batch.json> [--dry]");
  process.exit(1);
}

const ROOT = path.join(__dirname, "..");
const batch = JSON.parse(fs.readFileSync(file, "utf8"));
const code = batch.exam_code;
const bankPath = path.join(ROOT, "fixtures", "questions", `${code}.json`);
const bank = JSON.parse(fs.readFileSync(bankPath, "utf8"));

// Domain names come from exams.ts, which is itself diffed against the guide PDFs.
// Slice from this exam's `domains: [` to its matching `]` — an earlier version
// cut the block at the first "}," and silently saw only the first domain.
const examsSrc = fs.readFileSync(path.join(ROOT, "src", "lib", "exams.ts"), "utf8");
const codeAt = examsSrc.indexOf(`code: "${code}"`);
if (codeAt === -1) {
  console.error(`exams.ts has no exam with code "${code}"`);
  process.exit(1);
}
const domStart = examsSrc.indexOf("domains: [", codeAt);
const domEnd = examsSrc.indexOf("\n    ],", domStart);
const validDomains = new Set(
  [...examsSrc.slice(domStart, domEnd).matchAll(/name:\s*"([^"]+)"/g)].map((m) => m[1])
);
if (validDomains.size === 0) {
  console.error(`could not parse domains for ${code} out of exams.ts`);
  process.exit(1);
}

const errors = [];
const existingIds = new Set(bank.questions.map((q) => q.id));
const seen = new Set();

batch.questions.forEach((q, i) => {
  const at = `${q.id ?? `#${i}`}`;
  if (!q.id) errors.push(`${at}: missing id`);
  if (existingIds.has(q.id)) errors.push(`${at}: id already exists in the bank`);
  if (seen.has(q.id)) errors.push(`${at}: duplicate id within the batch`);
  seen.add(q.id);
  if (!validDomains.has(q.domain)) errors.push(`${at}: unknown domain "${q.domain}"`);
  if (!Array.isArray(q.options) || q.options.length < 3) errors.push(`${at}: needs >= 3 options`);
  if (new Set(q.options).size !== q.options.length) errors.push(`${at}: duplicate option text`);
  if (!Array.isArray(q.correct) || q.correct.length === 0) errors.push(`${at}: missing key`);
  if (q.correct.some((k) => !Number.isInteger(k) || k < 0 || k >= q.options.length))
    errors.push(`${at}: key index out of range`);
  if (new Set(q.correct).size !== q.correct.length) errors.push(`${at}: duplicate key index`);
  if (q.correct.length !== q.select_count) errors.push(`${at}: select_count != key length`);
  if (q.multi !== q.select_count > 1) errors.push(`${at}: multi flag disagrees with select_count`);
  if (!q.rationale?.overall || q.rationale.overall.length < 20)
    errors.push(`${at}: missing or trivial overall rationale`);
  if (!Array.isArray(q.rationale?.options) || q.rationale.options.length !== q.options.length)
    errors.push(`${at}: rationale.options must be parallel to options`);
  if (!q.tip || q.tip.length < 10) errors.push(`${at}: missing tip`);
  if (!("scenario" in q)) errors.push(`${at}: scenario key absent (use null)`);
});

if (errors.length) {
  console.error(`REJECTED — ${errors.length} problem(s):\n  ` + errors.join("\n  "));
  process.exit(1);
}

const merged = { ...bank, questions: [...bank.questions, ...batch.questions] };
merged.questions.sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));

const byDomain = {};
for (const q of merged.questions) byDomain[q.domain] = (byDomain[q.domain] ?? 0) + 1;

console.log(
  `${code}: ${bank.questions.length} + ${batch.questions.length} = ${merged.questions.length} items`
);
for (const [d, n] of Object.entries(byDomain)) console.log(`   ${String(n).padStart(3)}  ${d}`);

if (DRY) {
  console.log("\n[dry] nothing written");
  process.exit(0);
}

fs.writeFileSync(bankPath, JSON.stringify(merged, null, 2) + "\n", "utf8");
console.log(`\nwrote ${path.relative(ROOT, bankPath)}`);
console.log(`next: npx vitest run  then  node scripts/seed-questions.js ${code}`);
