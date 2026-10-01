/**
 * Emits chunked INSERT SQL for cf_questions from fixtures/questions/*.json.
 * Usage: node scripts/emit-question-sql.js [EXAM_CODE ...]
 * Output: scripts/sql/<code>-<n>.sql  (idempotent upserts)
 */
const fs = require("fs");
const path = require("path");

const codes = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["CCAO-F", "CCDV-F", "CCAR-F", "CCAR-P"];

const outDir = path.join(__dirname, "sql");
fs.mkdirSync(outDir, { recursive: true });
const q = (s) => (s === null || s === undefined ? "null" : `'${String(s).replace(/'/g, "''")}'`);
const jq = (o) => `'${JSON.stringify(o).replace(/'/g, "''")}'::jsonb`;

const CHUNK = 15;
for (const code of codes) {
  const file = path.join(__dirname, "..", "fixtures", "questions", `${code}.json`);
  if (!fs.existsSync(file)) {
    console.log(`skip ${code} (no file)`);
    continue;
  }
  const bank = JSON.parse(fs.readFileSync(file, "utf8"));
  const qs = bank.questions;
  let n = 0;
  for (let i = 0; i < qs.length; i += CHUNK) {
    const rows = qs.slice(i, i + CHUNK).map((x) =>
      `(${q(x.id)},${q(bank.exam_code)},${q(x.domain)},${q(x.scenario)},${q(x.stem)},${jq(
        x.options
      )},${jq(x.correct)},${x.multi ? "true" : "false"},${x.select_count || 1},${jq(
        x.rationale
      )},${q(x.tip)})`
    );
    const sql =
      `insert into cf_questions (id, exam_code, domain_name, scenario, stem, options, correct, multi, select_count, rationale, tip) values\n` +
      rows.join(",\n") +
      `\non conflict (id) do update set domain_name=excluded.domain_name, scenario=excluded.scenario, stem=excluded.stem, options=excluded.options, correct=excluded.correct, multi=excluded.multi, select_count=excluded.select_count, rationale=excluded.rationale, tip=excluded.tip;`;
    fs.writeFileSync(path.join(outDir, `${code}-${String(n).padStart(2, "0")}.sql`), sql);
    n++;
  }
  console.log(`${code}: ${qs.length} questions -> ${n} chunks`);
}
