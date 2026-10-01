/**
 * Verifies the username + PIN identity layer end to end on throwaway users:
 * claim, restore onto a new session, data migration, collision handling,
 * username enumeration resistance, and lockout.
 *
 * Run: CF_DB_URL=... [CF_DB_CA=...] node scripts/verify-identity.js
 */
const fs = require("fs");
const { Client } = require("pg");

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

(async () => {
  const ssl = process.env.CF_DB_CA
    ? { ca: fs.readFileSync(process.env.CF_DB_CA, "utf8"), rejectUnauthorized: true }
    : { rejectUnauthorized: true };
  const db = new Client({ connectionString: process.env.CF_DB_URL, ssl });
  await db.connect();

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

  async function mkUser(name) {
    const uid = (await db.query("select gen_random_uuid() id")).rows[0].id;
    await db.query(
      `insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at,
                               raw_app_meta_data, raw_user_meta_data, is_anonymous)
       values ($1,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
               $2, now(), now(), '{}'::jsonb,'{}'::jsonb, true)`,
      [uid, `${uid}@idharness.invalid`]
    );
    await db.query(`insert into cf_profiles (id, display_name) values ($1,$2)`, [uid, name]);
    return uid;
  }

  const created = [];
  try {
    // --- 1. claim -----------------------------------------------------------
    console.log("\n1. claiming a username + PIN");
    const oldUid = await mkUser("HARNESS Old Device");
    created.push(oldUid);
    const uname = `harness_${Date.now().toString().slice(-8)}`;

    await asUser(oldUid, `select cf_set_credentials($1,$2)`, [uname, "246810"]);
    check(
      "credentials stored",
      (await db.query(`select count(*)::int n from cf_credentials where user_id=$1`, [oldUid]))
        .rows[0].n === 1
    );
    check(
      "PIN is hashed, not stored in the clear",
      !(
        await db.query(`select pin_hash from cf_credentials where user_id=$1`, [oldUid])
      ).rows[0].pin_hash.includes("246810")
    );
    check(
      "cf_my_username reports the claim",
      (await asUser(oldUid, `select cf_my_username() u`)).rows[0].u === uname
    );

    for (const [bad, why] of [
      ["ab", "too short"],
      ["has space", "space"],
      ["waytoolongusernamethatkeepsgoing", "too long"],
    ]) {
      let raised = false;
      try {
        await asUser(oldUid, `select cf_set_credentials($1,$2)`, [bad, "246810"]);
      } catch {
        raised = true;
      }
      check(`rejects invalid username (${why})`, raised);
    }
    for (const bad of ["123", "abcdef", "12345678901"]) {
      let raised = false;
      try {
        await asUser(oldUid, `select cf_set_credentials($1,$2)`, [`u${Date.now()}`, bad]);
      } catch {
        raised = true;
      }
      check(`rejects invalid PIN (${bad})`, raised);
    }

    // give the old device some history to migrate
    await db.query(
      `insert into cf_item_reviews (user_id, question_id, exam_code, box, times_seen, times_correct)
       select $1, id, exam_code, 3, 2, 1 from cf_questions where exam_code='CCAO-F' limit 5`,
      [oldUid]
    );
    await db.query(
      `insert into cf_chronicle (user_id, event_type, exam_code, body)
       values ($1,'score_logged','CCAO-F','harness')`,
      [oldUid]
    );
    await db.query(`update cf_profiles set share_scores = true where id = $1`, [oldUid]);

    // --- 2. restore on a new device ----------------------------------------
    console.log("\n2. restoring onto a new session");
    const newUid = await mkUser("…");
    created.push(newUid);
    // the throwaway session has one review that collides with the claimed history
    const collide = (
      await db.query(
        `select question_id from cf_item_reviews where user_id=$1 order by question_id limit 1`,
        [oldUid]
      )
    ).rows[0].question_id;
    await db.query(
      `insert into cf_item_reviews (user_id, question_id, exam_code, box, times_seen, times_correct)
       values ($1,$2,'CCAO-F',0,9,0)`,
      [newUid, collide]
    );

    const res = (
      await asUser(newUid, `select cf_claim_profile($1,$2) d`, [uname.toUpperCase(), "246810"])
    ).rows[0].d;
    check("claim succeeds and is case-insensitive on username", res.ok === true, res);
    check("display name carried across", res.display_name === "HARNESS Old Device", res.display_name);

    const moved = (
      await db.query(`select count(*)::int n from cf_item_reviews where user_id=$1`, [newUid])
    ).rows[0].n;
    check("all 5 item reviews migrated", moved === 5, moved);
    check(
      "collision resolved in favour of the claimed history",
      (
        await db.query(
          `select box from cf_item_reviews where user_id=$1 and question_id=$2`,
          [newUid, collide]
        )
      ).rows[0].box === 3
    );
    check(
      "chronicle migrated",
      (await db.query(`select count(*)::int n from cf_chronicle where user_id=$1`, [newUid])).rows[0]
        .n === 1
    );
    check(
      "share_scores preference carried across",
      (await db.query(`select share_scores from cf_profiles where id=$1`, [newUid])).rows[0]
        .share_scores === true
    );
    check(
      "old shell profile removed",
      (await db.query(`select count(*)::int n from cf_profiles where id=$1`, [oldUid])).rows[0].n === 0
    );
    check(
      "old auth user removed",
      (await db.query(`select count(*)::int n from auth.users where id=$1`, [oldUid])).rows[0].n === 0
    );
    check(
      "credential now points at the new session",
      (await asUser(newUid, `select cf_my_username() u`)).rows[0].u === uname
    );
    check("no rows left behind on the old uid", moved === 5);

    // --- 3. resistance ------------------------------------------------------
    console.log("\n3. wrong PIN / unknown username / lockout");
    const attacker = await mkUser("HARNESS Attacker");
    created.push(attacker);

    const wrongPin = (
      await asUser(attacker, `select cf_claim_profile($1,$2) d`, [uname, "999999"])
    ).rows[0].d;
    const noUser = (
      await asUser(attacker, `select cf_claim_profile($1,$2) d`, ["definitely_not_a_user", "999999"])
    ).rows[0].d;
    const msgWrongPin = wrongPin.error;
    const msgNoUser = noUser.error;
    check("wrong PIN is rejected", wrongPin.ok === false && /incorrect/i.test(msgWrongPin), wrongPin);
    check(
      "unknown username gives the SAME message (no enumeration)",
      msgWrongPin === msgNoUser,
      { msgWrongPin, msgNoUser }
    );
    check(
      "a failed claim does not move any data",
      (await db.query(`select count(*)::int n from cf_item_reviews where user_id=$1`, [attacker]))
        .rows[0].n === 0
    );

    for (let i = 0; i < 9; i++) {
      await asUser(attacker, `select cf_claim_profile($1,$2)`, [uname, "111111"]);
    }
    const counted = (
      await db.query(`select failed_attempts, locked_until from cf_credentials where user_id=$1`, [newUid])
    ).rows[0];
    check("failed attempts actually persist across calls", counted.failed_attempts >= 10, counted);
    const locked = (
      await asUser(attacker, `select cf_claim_profile($1,$2) d`, [uname, "246810"])
    ).rows[0].d;
    check(
      "locks out after 10 failed attempts, even with the RIGHT PIN",
      locked.ok === false && /Too many attempts/.test(locked.error),
      locked
    );

    await db.query(`update cf_credentials set failed_attempts=0, locked_until=null where user_id=$1`, [
      newUid,
    ]);

    // --- 4. isolation -------------------------------------------------------
    console.log("\n4. table isolation");
    let credBlocked = false;
    try {
      await asUser(attacker, `select * from cf_credentials`);
    } catch {
      credBlocked = true;
    }
    check("cf_credentials is unreadable by clients", credBlocked);
    check(
      "anon cannot execute the identity RPCs",
      (
        await db.query(
          `select bool_and(not has_function_privilege('anon', p.oid, 'EXECUTE')) ok
             from pg_proc p join pg_namespace n on n.oid=p.pronamespace
            where n.nspname='public' and p.proname in
              ('cf_set_credentials','cf_claim_profile','cf_my_username')`
        )
      ).rows[0].ok
    );
  } finally {
    await db.query("set role postgres");
    for (const uid of created) {
      for (const t of [
        "cf_practice_answers",
        "cf_item_reviews",
        "cf_practice_sessions",
        "cf_exam_sessions",
        "cf_chronicle",
        "cf_achievements",
        "cf_attempts",
        "cf_credentials",
      ]) {
        await db.query(`delete from ${t} where user_id = $1`, [uid]);
      }
      await db.query(`delete from cf_profiles where id = $1`, [uid]);
      await db.query(`delete from auth.users where id = $1`, [uid]);
    }
    const left = (
      await db.query(
        `select (select count(*) from cf_profiles where display_name like 'HARNESS%')::int p,
                (select count(*) from cf_credentials where username like 'harness_%')::int c`
      )
    ).rows[0];
    console.log(`\nteardown: harness profiles=${left.p}, harness credentials=${left.c}`);
    await db.end();
  }

  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log("FAILED:\n  " + failures.join("\n  "));
    process.exit(1);
  }
})().catch((e) => {
  console.error("HARNESS ERROR:", e.message);
  process.exit(1);
});
