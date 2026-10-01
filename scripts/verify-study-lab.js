/**
 * End-to-end verification for the Study Lab: the practice answer log, the
 * missed-item bank, flashcards, practice stats, and the practice scheduler.
 *
 * Creates throwaway auth users, drives the real RPCs as each of them, asserts
 * the spec's verification criteria, then deletes everything it made. Every call
 * runs as `authenticated` with request.jwt.claims set, so auth.uid() and RLS
 * behave exactly as they do for the browser client — this exercises production
 * code paths, not a mock.
 *
 * Requires direct Postgres access (the app itself never has it):
 *     CF_DB_URL=<supabase postgres connection string> node scripts/verify-study-lab.js
 *
 * Needs `pg` and the Supabase CA cert, neither of which the app depends on, so
 * it is deliberately NOT wired into `npm test` — run it by hand after touching
 * any cf_ function.
 */
const fs = require("fs");
const { Client } = require("pg");

const EXAM = "CCDV-F";
const CA_PATH = process.env.CF_DB_CA;
let pass = 0;
const failures = [];

function check(label, cond, detail) {
  if (cond) {
    pass++;
    console.log(`  PASS  ${label}`);
  } else {
    failures.push(label);
    console.log(`  FAIL  ${label}${detail === undefined ? "" : ` -> ${JSON.stringify(detail)}`}`);
  }
}

async function main() {
  if (!process.env.CF_DB_URL) {
    console.error("CF_DB_URL is not set - this script needs direct Postgres access.");
    process.exit(1);
  }
  // Verify the server cert against Supabase's CA rather than disabling TLS checks.
  // Fetch it from https://supabase.com/docs/guides/platform/ssl-enforcement and
  // point CF_DB_CA at it.
  const ssl = CA_PATH
    ? { ca: fs.readFileSync(CA_PATH, "utf8"), rejectUnauthorized: true }
    : { rejectUnauthorized: true };
  const db = new Client({ connectionString: process.env.CF_DB_URL, ssl });
  await db.connect();

  /** Run SQL as a given user id, in the `authenticated` role. */
  async function asUser(uid, sql, params = []) {
    await db.query("begin");
    try {
      await db.query("set local role authenticated");
      await db.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: uid, role: "authenticated" }),
      ]);
      const r = await db.query(sql, params);
      await db.query("commit");
      return r;
    } catch (e) {
      await db.query("rollback");
      throw e;
    }
  }

  const userA = (await db.query("select gen_random_uuid() id")).rows[0].id;
  const userB = (await db.query("select gen_random_uuid() id")).rows[0].id;

  try {
    // --- setup: two throwaway users -----------------------------------------
    for (const [uid, name] of [
      [userA, "HARNESS_A"],
      [userB, "HARNESS_B"],
    ]) {
      await db.query(
        `insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at,
                                 raw_app_meta_data, raw_user_meta_data, is_anonymous)
         values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
                 $2, now(), now(), '{}'::jsonb, '{}'::jsonb, true)`,
        [uid, `${uid}@harness.invalid`]
      );
      await db.query(`insert into cf_profiles (id, display_name) values ($1, $2)`, [uid, name]);
    }
    console.log(`\nharness users: A=${userA} B=${userB}\n`);

    // --- 1. practice grading writes the answer log --------------------------
    console.log("1. practice logging");
    const started = (
      await asUser(userA, `select cf_start_practice($1, 4) as d`, [EXAM])
    ).rows[0].d;
    const qs = started.questions;
    check("cf_start_practice returned a set", qs.length > 0, qs.length);

    // Answer the first question WRONG on purpose: pick an index that isn't correct.
    const q0 = qs[0];
    const correct0 = (
      await db.query(`select correct from cf_questions where id = $1`, [q0.id])
    ).rows[0].correct;
    const wrongPick = [...Array(q0.options.length).keys()].find((i) => !correct0.includes(i));
    const g0 = (
      await asUser(userA, `select cf_grade_practice_item($1, $2, $3) as d`, [
        started.practice_id,
        q0.id,
        JSON.stringify([wrongPick]),
      ])
    ).rows[0].d;
    check("wrong practice answer graded incorrect", g0.is_correct === false, g0.is_correct);
    check("wrong answer resets Leitner box to 0", g0.box === 0, g0.box);

    const logged = (
      await db.query(
        `select answer, is_correct, source, domain_name from cf_practice_answers
         where user_id = $1 and question_id = $2`,
        [userA, q0.id]
      )
    ).rows;
    check("cf_practice_answers row written", logged.length === 1, logged.length);
    check(
      "logged answer matches what was submitted",
      JSON.stringify(logged[0]?.answer) === JSON.stringify([wrongPick]),
      logged[0]?.answer
    );
    check("logged with source=practice", logged[0]?.source === "practice", logged[0]?.source);
    check("logged with a domain", !!logged[0]?.domain_name, logged[0]?.domain_name);

    // Answer the second question RIGHT.
    const q1 = qs[1];
    const correct1 = (
      await db.query(`select correct from cf_questions where id = $1`, [q1.id])
    ).rows[0].correct;
    const g1 = (
      await asUser(userA, `select cf_grade_practice_item($1, $2, $3) as d`, [
        started.practice_id,
        q1.id,
        JSON.stringify(correct1),
      ])
    ).rows[0].d;
    check("correct practice answer graded correct", g1.is_correct === true, g1.is_correct);

    // --- 2. the missed bank -------------------------------------------------
    console.log("\n2. cf_missed_items");
    let bank = (await asUser(userA, `select cf_missed_items(null) as d`)).rows[0].d;
    check("bank holds exactly the one missed item", bank.length === 1, bank.length);
    const row = bank[0];
    check("bank row is the question that was missed", row?.id === q0.id, row?.id);
    check("status is shaky", row?.status === "shaky", row?.status);
    check("times_missed = 1", row?.times_missed === 1, row?.times_missed);
    check("source recorded as practice", JSON.stringify(row?.sources) === '["practice"]', row?.sources);
    check(
      "last wrong answer preserved",
      JSON.stringify(row?.last_wrong_answer) === JSON.stringify([wrongPick]),
      row?.last_wrong_answer
    );
    check("correct answer key returned for review", Array.isArray(row?.correct), row?.correct);
    check(
      "a correctly-answered item does NOT enter the bank",
      !bank.some((b) => b.id === q1.id),
      q1.id
    );
    check(
      "p_exam filter scopes the bank",
      (await asUser(userA, `select cf_missed_items('CCAO-F') as d`)).rows[0].d.length === 0
    );

    // --- 3. shaky -> recovered ---------------------------------------------
    console.log("\n3. recovery");
    // Two correct graded answers take box 0 -> 1 -> 2, which is the recovery bar.
    // Each round backdates only q0's due_at to simulate the review interval
    // elapsing; the scheduler is then expected to surface it on its own.
    for (let i = 0; i < 2; i++) {
      await db.query("set role postgres");
      await db.query(
        `update cf_item_reviews set due_at = now() - interval '1 minute'
         where user_id = $1 and question_id = $2`,
        [userA, q0.id]
      );
      const p = (await asUser(userA, `select cf_start_practice($1, 15) as d`, [EXAM])).rows[0].d;
      if (!p.questions.some((q) => q.id === q0.id)) {
        throw new Error("a due item did not resurface - scheduler priority regressed");
      }
      await asUser(userA, `select cf_grade_practice_item($1, $2, $3) as d`, [
        p.practice_id,
        q0.id,
        JSON.stringify(correct0),
      ]);
    }
    bank = (await asUser(userA, `select cf_missed_items(null) as d`)).rows[0].d;
    const recovered = bank.find((b) => b.id === q0.id);
    check("item stays in the bank after recovery", !!recovered, bank.length);
    check("status flipped to recovered", recovered?.status === "recovered", {
      status: recovered?.status,
      box: recovered?.box,
    });
    check("box reached 2", recovered?.box >= 2, recovered?.box);
    check("times_missed still records the original miss", recovered?.times_missed === 1, recovered?.times_missed);

    // --- 4. flashcards ------------------------------------------------------
    console.log("\n4. flashcards");
    // Any question this user has never touched (the recovery step marked the whole
    // CCDV-F bank as seen, so this deliberately spans every exam).
    const unseen = (
      await db.query(
        `select q.id from cf_questions q
         where not exists (select 1 from cf_item_reviews r where r.user_id = $1 and r.question_id = q.id)
           and not exists (select 1 from cf_exam_sessions s
                            where s.user_id = $1 and s.question_ids ? q.id)
         limit 1`,
        [userA]
      )
    ).rows[0].id;
    let raised = false;
    try {
      await asUser(userA, `select cf_flashcard_grade($1, true)`, [unseen]);
    } catch (e) {
      raised = /has not been answered yet/.test(e.message);
    }
    check("grading an unanswered question RAISES (no answer-key leak)", raised);

    const boxes = [];
    for (let i = 0; i < 4; i++) {
      boxes.push(
        (await asUser(userA, `select cf_flashcard_grade($1, true) as d`, [q0.id])).rows[0].d.box
      );
    }
    check("flashcard box never exceeds 3", Math.max(...boxes) === 3, boxes);
    const reset = (await asUser(userA, `select cf_flashcard_grade($1, false) as d`, [q0.id])).rows[0].d;
    check("'still fuzzy' resets the box to 0", reset.box === 0, reset.box);

    const ir = (
      await db.query(
        `select times_seen, times_correct from cf_item_reviews where user_id=$1 and question_id=$2`,
        [userA, q0.id]
      )
    ).rows[0];
    check(
      "self-grading does not inflate measured practice counts",
      Number(ir.times_seen) === 3 && Number(ir.times_correct) === 2,
      ir
    );

    const fin = (
      await asUser(userA, `select cf_finish_flashcards($1, now() - interval '1 hour') as d`, [EXAM])
    ).rows[0].d;
    check("cf_finish_flashcards counts the drill server-side", fin.reviewed === 5, fin);
    const chron = (
      await db.query(
        `select count(*)::int n from cf_chronicle where user_id=$1 and event_type='flashcards_completed'`,
        [userA]
      )
    ).rows[0].n;
    check("chronicle entry written", chron === 1, chron);
    const act = (await asUser(userA, `select cf_study_activity() as d`)).rows[0].d;
    check("flashcard day counts toward the study streak", act.total_days >= 1, act.total_days);

    // --- 5. practice stats --------------------------------------------------
    console.log("\n5. cf_practice_stats");
    const stats = (await asUser(userA, `select cf_practice_stats() as d`)).rows[0].d[EXAM];
    check("sessions counted", stats.sessions === 3, stats.sessions);
    check("graded answers counted", stats.answered === 4, stats.answered);
    check("correct counted", stats.correct === 3, stats.correct);
    check("accuracy computed", stats.accuracy === 75, stats.accuracy);
    check("distinct items counted", stats.distinct_items === 2, stats.distinct_items);
    check("missed items counted", stats.missed_items === 1, stats.missed_items);
    check(
      "flashcards counted separately from graded practice",
      stats.flashcards_reviewed === 5,
      stats.flashcards_reviewed
    );
    check("per-domain rows present", stats.domains.length > 0, stats.domains.length);
    check("daily series present", stats.daily.length === 1, stats.daily);
    check("recent sessions listed", stats.recent.length === 3, stats.recent.length);
    check(
      "an exam with no practice returns a zeroed row, not null",
      stats && (await asUser(userA, `select cf_practice_stats() as d`)).rows[0].d["CCAO-F"]
        .answered === 0
    );

    // --- 5b. misses from an exam simulation --------------------------------
    // The other half of the union: sim misses are reconstructed from
    // cf_exam_sessions rather than the answer log, and an item left BLANK has to
    // count as missed because that is how it was scored.
    console.log("\n5b. sim misses");
    const sim = (await asUser(userA, `select cf_start_session('CCAO-F', 'quick') as d`)).rows[0].d;
    const simQs = sim.questions ?? sim.question_ids ?? [];
    const simIds = simQs.map((q) => (typeof q === "string" ? q : q.id));
    check("quick session started", simIds.length >= 3, simIds.length);

    const keys = (
      await db.query(`select id, correct, jsonb_array_length(options) n from cf_questions where id = any($1)`, [
        simIds,
      ])
    ).rows;
    const keyOf = new Map(keys.map((k) => [k.id, k]));

    const simWrongId = simIds[0];
    const simBlankId = simIds[1];
    const kw = keyOf.get(simWrongId);
    const simWrongPick = [...Array(Number(kw.n)).keys()].find((i) => !kw.correct.includes(i));
    await asUser(userA, `select cf_save_answer($1, $2, $3)`, [
      sim.session_id ?? sim.id,
      simWrongId,
      JSON.stringify([simWrongPick]),
    ]);
    // everything else answered correctly; simBlankId deliberately left untouched
    for (const id of simIds.slice(2)) {
      await asUser(userA, `select cf_save_answer($1, $2, $3)`, [
        sim.session_id ?? sim.id,
        id,
        JSON.stringify(keyOf.get(id).correct),
      ]);
    }
    await asUser(userA, `select cf_submit_session($1)`, [sim.session_id ?? sim.id]);

    const simBank = (await asUser(userA, `select cf_missed_items('CCAO-F') as d`)).rows[0].d;
    const wrongRow = simBank.find((b) => b.id === simWrongId);
    const blankRow = simBank.find((b) => b.id === simBlankId);
    check("a wrong sim answer enters the bank", !!wrongRow, simBank.map((b) => b.id));
    check("sim miss is tagged with its mode", JSON.stringify(wrongRow?.sources) === '["quick"]', wrongRow?.sources);
    check(
      "the wrong sim pick is preserved",
      JSON.stringify(wrongRow?.last_wrong_answer) === JSON.stringify([simWrongPick]),
      wrongRow?.last_wrong_answer
    );
    check("an item left BLANK counts as missed", !!blankRow, simBlankId);
    check("blank is flagged as unanswered", blankRow?.last_unanswered === true, blankRow?.last_unanswered);
    check("blank has no recorded answer", blankRow?.last_wrong_answer === null, blankRow?.last_wrong_answer);
    check(
      "correctly-answered sim items stay out of the bank",
      simBank.length === 2,
      simBank.length
    );
    check(
      "sim misses do NOT appear in practice stats",
      (await asUser(userA, `select cf_practice_stats() as d`)).rows[0].d["CCAO-F"].answered === 0
    );

    // --- 6. isolation -------------------------------------------------------
    console.log("\n6. isolation");
    const bBank = (await asUser(userB, `select cf_missed_items(null) as d`)).rows[0].d;
    check("user B sees an empty bank", bBank.length === 0, bBank.length);
    const bRows = (
      await asUser(userB, `select count(*)::int n from cf_practice_answers`)
    ).rows[0].n;
    check("user B cannot read user A's practice answers (RLS)", bRows === 0, bRows);
    const bStats = (await asUser(userB, `select cf_practice_stats() as d`)).rows[0].d[EXAM];
    check("user B's stats are their own", bStats.answered === 0, bStats.answered);

    let insertBlocked = false;
    try {
      await asUser(userB, `insert into cf_practice_answers
        (user_id, question_id, exam_code, domain_name, is_correct, source)
        values ($1, $2, $3, 'x', true, 'practice')`, [userB, q0.id, EXAM]);
    } catch {
      insertBlocked = true;
    }
    check("clients cannot forge answer-log rows", insertBlocked);

    // --- 7. scheduler priority ---------------------------------------------
    // Regression guard for the 2026-08-05 ordering fix. Before it, an unseen
    // item scored -1 on the tie-breaker and outranked every due review, so with
    // a bank of fresh questions a due item never re-entered a set and the
    // spaced-review interval did nothing. Runs last, on user B, because the
    // isolation checks above require B to still be empty.
    console.log("\n7. scheduler priority");
    const warm = (await asUser(userB, `select cf_start_practice($1, 3) as d`, [EXAM])).rows[0].d;
    const dueIds = warm.questions.map((q) => q.id);
    for (const id of dueIds) {
      const key = (await db.query(`select correct from cf_questions where id = $1`, [id])).rows[0]
        .correct;
      await asUser(userB, `select cf_grade_practice_item($1, $2, $3) as d`, [
        warm.practice_id,
        id,
        JSON.stringify(key),
      ]);
    }

    // Nothing is due yet (all three just went to box 1 = 1 day out).
    const noneDue = (await asUser(userB, `select cf_start_practice($1, 5) as d`, [EXAM])).rows[0].d;
    check(
      "with nothing due, a set is all new material (never stalls)",
      noneDue.questions.every((q) => !dueIds.includes(q.id)),
      noneDue.questions.map((q) => q.id)
    );

    await db.query("set role postgres");
    await db.query(
      `update cf_item_reviews set due_at = now() - interval '1 minute'
       where user_id = $1 and question_id = any($2)`,
      [userB, dueIds]
    );

    const ordered = (await asUser(userB, `select cf_start_practice($1, 15) as d`, [EXAM])).rows[0].d;
    const firstThree = ordered.questions.slice(0, 3).map((q) => q.id);
    check(
      "due reviews occupy the front of the set, ahead of new material",
      [...firstThree].sort().join() === [...dueIds].sort().join(),
      { got: firstThree, want: dueIds }
    );
    check(
      "the rest of the set is still new material",
      ordered.questions.slice(3).every((q) => !dueIds.includes(q.id)),
      ordered.questions.slice(3).map((q) => q.id)
    );
    check(
      "a set smaller than the due backlog is entirely due items",
      (await asUser(userB, `select cf_start_practice($1, 2) as d`, [EXAM])).rows[0].d.questions.every(
        (q) => dueIds.includes(q.id)
      )
    );
  } finally {
    // --- teardown -----------------------------------------------------------
    await db.query("set role postgres");
    for (const uid of [userA, userB]) {
      await db.query(`delete from cf_practice_answers where user_id = $1`, [uid]);
      await db.query(`delete from cf_item_reviews where user_id = $1`, [uid]);
      await db.query(`delete from cf_practice_sessions where user_id = $1`, [uid]);
      await db.query(`delete from cf_exam_sessions where user_id = $1`, [uid]);
      await db.query(`delete from cf_chronicle where user_id = $1`, [uid]);
      await db.query(`delete from cf_achievements where user_id = $1`, [uid]);
      await db.query(`delete from cf_attempts where user_id = $1`, [uid]);
      await db.query(`delete from cf_profiles where id = $1`, [uid]);
      await db.query(`delete from auth.users where id = $1`, [uid]);
    }
    const leftover = (
      await db.query(
        `select (select count(*) from cf_profiles where display_name like 'HARNESS_%')::int p,
                (select count(*) from cf_practice_answers)::int a`
      )
    ).rows[0];
    console.log(`\nteardown: harness profiles left=${leftover.p}, cf_practice_answers rows=${leftover.a}`);
    await db.end();
  }

  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log("FAILED:\n  " + failures.join("\n  "));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("HARNESS ERROR:", e.message);
  process.exit(1);
});
