/**
 * Moves already-stored answer indices through the same permutation that
 * scripts/rebalance-keys.js applied to the option lists.
 *
 * Without this, every answer recorded before the rebalance silently points at a
 * different option than the user actually chose: the missed-answer bank would
 * show the wrong "YOUR ANSWER", and a previously-wrong answer could even read as
 * correct. Scores already computed and stored (scaled_score, domain_scores) are
 * NOT recomputed — they were correct when graded and are historical fact.
 *
 * Touches:
 *   cf_practice_answers.answer   jsonb array of indices
 *   cf_exam_sessions.answers     jsonb object { question_id: [indices] }
 *
 * Idempotency: this is NOT idempotent — running it twice applies the
 * permutation twice. It records a marker row in cf_seed_secret's sibling table
 * (cf_migrations) and refuses to run again.
 *
 * Run: CF_DB_URL=... [CF_DB_CA=...] node scripts/migrate-stored-answers.js [--dry]
 */
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const DRY = process.argv.includes("--dry");
const MIGRATION = "2026-08-06-rebalance-keys";
const perms = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "fixtures", "key-permutations.json"), "utf8")
);

/** perm[newIndex] = oldIndex, so an old index maps to its position in perm. */
function remap(questionId, indices) {
  const perm = perms[questionId];
  if (!perm) return null;
  return indices.map((old) => perm.indexOf(old)).sort((a, b) => a - b);
}

(async () => {
  if (!process.env.CF_DB_URL) {
    console.error("CF_DB_URL is not set");
    process.exit(1);
  }
  const ssl = process.env.CF_DB_CA
    ? { ca: fs.readFileSync(process.env.CF_DB_CA, "utf8"), rejectUnauthorized: true }
    : { rejectUnauthorized: true };
  const db = new Client({ connectionString: process.env.CF_DB_URL, ssl });
  await db.connect();

  try {
    await db.query(`create table if not exists cf_migrations (
      name text primary key, applied_at timestamptz not null default now())`);
    const done = await db.query(`select 1 from cf_migrations where name = $1`, [MIGRATION]);
    if (done.rowCount) {
      console.log(`${MIGRATION} already applied — nothing to do.`);
      return;
    }

    await db.query("begin");

    // --- cf_practice_answers -------------------------------------------------
    const pa = await db.query(
      `select id, question_id, answer from cf_practice_answers where answer is not null`
    );
    let paFixed = 0;
    for (const row of pa.rows) {
      const next = remap(row.question_id, row.answer);
      if (!next) {
        console.warn(`  no permutation for ${row.question_id} — left as-is`);
        continue;
      }
      if (JSON.stringify(next) === JSON.stringify(row.answer)) continue;
      if (!DRY) {
        await db.query(`update cf_practice_answers set answer = $1 where id = $2`, [
          JSON.stringify(next),
          row.id,
        ]);
      }
      paFixed++;
    }

    // --- cf_exam_sessions.answers -------------------------------------------
    const es = await db.query(
      `select id, answers from cf_exam_sessions where answers is not null and answers <> '{}'::jsonb`
    );
    let sessFixed = 0;
    let itemsFixed = 0;
    for (const row of es.rows) {
      const next = {};
      let touched = false;
      for (const [qid, idx] of Object.entries(row.answers)) {
        const moved = remap(qid, idx);
        if (!moved) {
          next[qid] = idx;
          continue;
        }
        next[qid] = moved;
        if (JSON.stringify(moved) !== JSON.stringify(idx)) {
          touched = true;
          itemsFixed++;
        }
      }
      if (!touched) continue;
      if (!DRY) {
        await db.query(`update cf_exam_sessions set answers = $1 where id = $2`, [
          JSON.stringify(next),
          row.id,
        ]);
      }
      sessFixed++;
    }

    console.log(
      `${DRY ? "[dry] " : ""}cf_practice_answers: ${paFixed}/${pa.rowCount} rows remapped\n` +
        `${DRY ? "[dry] " : ""}cf_exam_sessions: ${sessFixed}/${es.rowCount} sessions, ${itemsFixed} answers remapped`
    );

    if (DRY) {
      await db.query("rollback");
      console.log("[dry] rolled back");
      return;
    }
    await db.query(`insert into cf_migrations (name) values ($1)`, [MIGRATION]);
    await db.query("commit");
    console.log("committed");
  } catch (e) {
    await db.query("rollback").catch(() => {});
    throw e;
  } finally {
    await db.end();
  }
})().catch((e) => {
  console.error("MIGRATION ERROR:", e.message);
  process.exit(1);
});
