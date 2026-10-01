/**
 * Seeds item -> task-statement tags into cf_question_tasks from
 * fixtures/questions/tags/<CODE>.json (see 2026-09-25-task-statements.sql).
 *
 * Replaces the exam's rows in one transaction and refuses to write if any
 * tagged id is missing from cf_questions or any bank item is untagged — a
 * partial map would silently drop items from the per-statement results.
 *
 * Run: CF_DB_URL=... CF_DB_CA=path/to/prod-ca-2021.crt node scripts/seed-tasks.js CCAR-F [CCDV-F ...]
 */
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const codes = process.argv.slice(2);
if (!codes.length) {
  console.error("usage: node scripts/seed-tasks.js <EXAM_CODE> [...]");
  process.exit(1);
}
if (!process.env.CF_DB_URL) {
  console.error("CF_DB_URL is not set");
  process.exit(1);
}

async function main() {
  const ssl = process.env.CF_DB_CA
    ? { ca: fs.readFileSync(process.env.CF_DB_CA, "utf8"), rejectUnauthorized: true }
    : { rejectUnauthorized: true };
  const db = new Client({ connectionString: process.env.CF_DB_URL, ssl });
  await db.connect();
  try {
    for (const code of codes) {
      const file = path.join(__dirname, "..", "fixtures", "questions", "tags", `${code}.json`);
      const { exam_code, items } = JSON.parse(fs.readFileSync(file, "utf8"));
      if (exam_code !== code) throw new Error(`${file} is for ${exam_code}, not ${code}`);
      const ids = Object.keys(items);
      await db.query("begin");
      try {
        const bank = (
          await db.query("select id from cf_questions where exam_code = $1", [code])
        ).rows.map((r) => r.id);
        const inBank = new Set(bank);
        const unknown = ids.filter((id) => !inBank.has(id));
        const untagged = bank.filter((id) => !(id in items));
        if (unknown.length || untagged.length) {
          throw new Error(
            `unknown ids [${unknown.join(", ")}], untagged ids [${untagged.join(", ")}]`
          );
        }
        await db.query("delete from cf_question_tasks where exam_code = $1", [code]);
        await db.query(
          `insert into cf_question_tasks (question_id, exam_code, task)
           select unnest($1::text[]), $2, unnest($3::text[])`,
          [ids, code, ids.map((id) => items[id])]
        );
        await db.query("commit");
        console.log(`${code}: ${ids.length} items tagged`);
      } catch (e) {
        await db.query("rollback");
        throw new Error(`${code}: tags NOT seeded - ${e.message}`);
      }
    }
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  } finally {
    await db.end();
  }
}

main();
