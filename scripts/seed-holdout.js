/**
 * Seeds the sealed go/no-go form for an exam into cf_holdout from
 * fixtures/questions/holdout/<CODE>.json (see 2026-09-25-scoring-holdout.sql).
 *
 * Replaces the exam's holdout rows in one transaction and refuses to write if
 * any listed id is missing from cf_questions — a holdout that silently shrank
 * would still "pass" as a go/no-go form.
 *
 * Run: CF_DB_URL=... CF_DB_CA=path/to/prod-ca-2021.crt node scripts/seed-holdout.js CCAR-F
 */
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const code = process.argv[2];
if (!code) {
  console.error("usage: node scripts/seed-holdout.js <EXAM_CODE>");
  process.exit(1);
}
if (!process.env.CF_DB_URL) {
  console.error("CF_DB_URL is not set");
  process.exit(1);
}

const file = path.join(__dirname, "..", "fixtures", "questions", "holdout", `${code}.json`);
const { exam_code, question_ids } = JSON.parse(fs.readFileSync(file, "utf8"));
if (exam_code !== code) {
  console.error(`${file} is for ${exam_code}, not ${code}`);
  process.exit(1);
}

async function main() {
  // Verify the server cert against Supabase's CA rather than disabling checks.
  const ssl = process.env.CF_DB_CA
    ? { ca: fs.readFileSync(process.env.CF_DB_CA, "utf8"), rejectUnauthorized: true }
    : { rejectUnauthorized: true };
  const db = new Client({ connectionString: process.env.CF_DB_URL, ssl });
  await db.connect();
  try {
    await db.query("begin");
    const found = await db.query(
      "select id from cf_questions where exam_code = $1 and id = any($2::text[])",
      [code, question_ids]
    );
    const have = new Set(found.rows.map((r) => r.id));
    const missing = question_ids.filter((id) => !have.has(id));
    if (missing.length) throw new Error(`not in cf_questions: ${missing.join(", ")}`);

    await db.query("delete from cf_holdout where exam_code = $1", [code]);
    await db.query(
      "insert into cf_holdout (question_id, exam_code) select unnest($1::text[]), $2",
      [question_ids, code]
    );
    await db.query("commit");
    console.log(`${code}: holdout form seeded with ${question_ids.length} items`);
  } catch (e) {
    await db.query("rollback");
    console.error(`${code}: holdout NOT seeded - ${e.message}`);
    process.exitCode = 1;
  } finally {
    await db.end();
  }
}

main();
