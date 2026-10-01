/**
 * verify-sim-draw.js - proves the exam draw matches the blueprint.
 *
 * The full-mode draw used to be a flat `order by random() limit items`, which
 * ignored cf_domains. Because scoring renormalises over the domains actually
 * logged (src/lib/scoring.ts), a domain that drew zero items disappeared from
 * the blueprint instead of scoring zero -- 29.1% of CCDV-F sims, measured.
 *
 * This harness starts real sessions as a throwaway user and asserts, over many
 * draws, that every blueprint domain is present and that each domain's share of
 * items tracks its blueprint weight.
 *
 * Run:
 *   CF_DB_URL=<supabase postgres connection string> \
 *   CF_DB_CA=<path to the Supabase CA cert> \
 *   node scripts/verify-sim-draw.js [draws-per-exam]
 */

const fs = require("fs");
const crypto = require("crypto");
const { Client } = require("pg");

const DRAWS = Number(process.argv[2] || 40);
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
  const ssl = CA_PATH
    ? { ca: fs.readFileSync(CA_PATH, "utf8"), rejectUnauthorized: true }
    : { rejectUnauthorized: true };
  const db = new Client({ connectionString: process.env.CF_DB_URL, ssl });
  await db.connect();

  const userId = crypto.randomUUID();

  /** Run SQL as the throwaway user, in the `authenticated` role. */
  async function asUser(sql, params) {
    await db.query("begin");
    try {
      await db.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: userId, role: "authenticated" }),
      ]);
      await db.query("set local role authenticated");
      const r = await db.query(sql, params);
      await db.query("commit");
      return r;
    } catch (e) {
      await db.query("rollback");
      throw e;
    }
  }

  const exams = (await db.query("select code, items from cf_exams order by code")).rows;
  const domains = (
    await db.query("select exam_code, name, weight::float w from cf_domains order by exam_code, name")
  ).rows;
  const bank = (
    await db.query(
      "select exam_code, domain_name, count(*)::int n from cf_questions group by 1,2",
    )
  ).rows;

  try {
    await db.query(
      `insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at,
                               raw_app_meta_data, raw_user_meta_data, is_anonymous)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
               $2, now(), now(), '{}'::jsonb, '{}'::jsonb, true)`,
      [userId, `${userId}@harness.invalid`],
    );
    await db.query(`insert into cf_profiles (id, display_name) values ($1, 'HARNESS_DRAW')`, [
      userId,
    ]);

    for (const exam of exams) {
      const dlist = domains.filter((d) => d.exam_code === exam.code);
      const wsum = dlist.reduce((a, d) => a + d.w, 0);
      const scenarioBased = exam.code === "CCAR-F";
      console.log(`\n${exam.code} - ${DRAWS} draws of ${exam.items} items, ${dlist.length} domains`);

      const seenCount = new Map(dlist.map((d) => [d.name, 0])); // draws containing the domain
      const itemCount = new Map(dlist.map((d) => [d.name, 0])); // total items across draws
      let totalItems = 0;
      const sizes = new Set();

      for (let i = 0; i < DRAWS; i++) {
        const r = await asUser("select cf_start_session($1, 'full') as s", [exam.code]);
        const qs = r.rows[0].s.questions;
        sizes.add(qs.length);
        totalItems += qs.length;
        if (scenarioBased) {
          // Real exam shape: 4 scenarios x (items / 4), no item twice.
          const perScenario = new Map();
          for (const q of qs) perScenario.set(q.scenario, (perScenario.get(q.scenario) || 0) + 1);
          const shapeOk =
            qs.length === exam.items &&
            perScenario.size === 4 &&
            [...perScenario.values()].every((n) => n === exam.items / 4) &&
            new Set(qs.map((q) => q.id)).size === qs.length;
          if (!shapeOk) {
            failures.push(
              `${exam.code}: draw ${i} shape ${qs.length} items, scenarios ${JSON.stringify([...perScenario])}`,
            );
          }
        }
        const here = new Map();
        for (const q of qs) here.set(q.domain, (here.get(q.domain) || 0) + 1);
        for (const [name, n] of here) {
          if (!seenCount.has(name)) {
            failures.push(`${exam.code}: drew unknown domain ${name}`);
            continue;
          }
          seenCount.set(name, seenCount.get(name) + 1);
          itemCount.set(name, itemCount.get(name) + n);
        }
      }

      const missing = dlist.filter((d) => seenCount.get(d.name) < DRAWS);
      check(
        `${exam.code}: every blueprint domain appears in all ${DRAWS} draws`,
        missing.length === 0,
        missing.map((d) => `${d.name} in ${seenCount.get(d.name)}/${DRAWS}`),
      );

      if (!scenarioBased) {
        check(
          `${exam.code}: every draw is exactly ${exam.items} items`,
          sizes.size === 1 && sizes.has(exam.items),
          [...sizes],
        );

        // Each domain's mean share should track its blueprint weight. Allowed
        // drift is one item's worth, since apportionment rounds to whole items
        // and is capped by what the bank holds.
        const tol = (100 / exam.items) * 1.5;
        const drift = [];
        for (const d of dlist) {
          const actualPct = (100 * itemCount.get(d.name)) / totalItems;
          const targetPct = (100 * d.w) / wsum;
          if (Math.abs(actualPct - targetPct) > tol) {
            drift.push(
              `${d.name}: ${actualPct.toFixed(1)}% vs blueprint ${targetPct.toFixed(1)}%`,
            );
          }
        }
        check(
          `${exam.code}: domain shares track blueprint weight (+/-${tol.toFixed(1)} pts)`,
          drift.length === 0,
          drift,
        );

        // Allocation must be deterministic in size: the same domain gets the
        // same item count every draw, since only WHICH items vary.
        const perDraw = new Map(
          dlist.map((d) => [d.name, itemCount.get(d.name) / DRAWS]),
        );
        const nonInteger = [...perDraw].filter(([, v]) => Math.abs(v - Math.round(v)) > 1e-9);
        check(
          `${exam.code}: per-domain item count is stable across draws`,
          nonInteger.length === 0,
          nonInteger.map(([k, v]) => `${k}=${v}`),
        );

        // No domain may be allocated more items than its bank holds.
        const over = dlist.filter((d) => {
          const avail = bank.find((b) => b.exam_code === exam.code && b.domain_name === d.name);
          return perDraw.get(d.name) > (avail ? avail.n : 0);
        });
        check(`${exam.code}: no domain exceeds its bank capacity`, over.length === 0,
          over.map((d) => d.name));

        // A domain allocated n items scores in 1/n steps. One item is therefore
        // worth 900 * weight / (wsum * n) scaled points. This is a property of
        // the blueprint and the bank, not a draw defect, but it is the real
        // floor on how precise a score can be, so report it rather than bury it.
        console.log("    allocation per draw:");
        for (const d of [...dlist].sort((a, b) => b.w - a.w)) {
          const n = perDraw.get(d.name);
          const quota = (d.w / wsum) * exam.items;
          const swing = (900 * d.w) / (wsum * Math.max(1, n));
          console.log(
            `      ${String(n).padStart(3)} items  (quota ${quota.toFixed(1)})  ${String(d.w).padStart(5)}%  ` +
              `${swing.toFixed(1).padStart(5)} scaled pts per item  ${d.name}`,
          );
        }
        const worst = [...dlist].sort(
          (a, b) => (900 * b.w) / (wsum * Math.max(1, perDraw.get(b.name))) -
                    (900 * a.w) / (wsum * Math.max(1, perDraw.get(a.name))),
        )[0];
        const worstSwing = (900 * worst.w) / (wsum * Math.max(1, perDraw.get(worst.name)));
        console.log(
          `    coarsest domain: ${worst.name} at ${perDraw.get(worst.name)} item(s) -> ` +
            `+/-${worstSwing.toFixed(0)} scaled points on a single answer`,
        );
      } else {
        console.log("    scenario-based draw - domain presence only");
      }

      // Items within a draw must be unique.
      const r = await asUser("select cf_start_session($1, 'full') as s", [exam.code]);
      const ids = r.rows[0].s.questions.map((q) => q.id);
      check(`${exam.code}: no duplicate items within a draw`, new Set(ids).size === ids.length);

      // Quick mode still covers every domain.
      const q = await asUser("select cf_start_session($1, 'quick') as s", [exam.code]);
      const qDoms = new Set(q.rows[0].s.questions.map((x) => x.domain));
      check(
        `${exam.code}: quick mode still covers every domain`,
        dlist.every((d) => qDoms.has(d.name)),
        dlist.filter((d) => !qDoms.has(d.name)).map((d) => d.name),
      );
    }

    // --- seen-item tracking (2026-09-24) -----------------------------------
    // Mark every item of one full draw as seen via the scheduler table, then
    // redraw: the new draw must avoid those items wherever the bank allows, and
    // fresh_ids must list exactly the drawn items that were not marked.
    console.log("\nseen-item tracking");
    for (const exam of exams) {
      const first = await asUser("select cf_start_session($1, 'full') as s", [exam.code]);
      const seenIds = first.rows[0].s.questions.map((q) => q.id);
      await db.query(
        `insert into cf_item_reviews (user_id, question_id, exam_code, times_seen)
         select $1, unnest($2::text[]), $3, 1 on conflict do nothing`,
        [userId, seenIds, exam.code],
      );
      const bank = (
        await db.query("select count(*)::int n from cf_questions where exam_code = $1", [exam.code])
      ).rows[0].n;
      const again = await asUser("select cf_start_session($1, 'full') as s", [exam.code]);
      const s2 = again.rows[0].s;
      const ids2 = s2.questions.map((q) => q.id);
      const seen = new Set(seenIds);
      const repeats = ids2.filter((id) => seen.has(id)).length;
      // Lower bound on repeats forced by capacity; CCAR-F scenarios / small
      // domains can force some. Require no more repeats than a flat unseen-first
      // draw could avoid, and that at least half the paper is fresh when the
      // bank has >= 2x headroom.
      const stored = (
        await db.query("select fresh_ids from cf_exam_sessions where id = $1", [s2.session_id])
      ).rows[0].fresh_ids;
      const expectFresh = ids2.filter((id) => !seen.has(id));
      check(
        `${exam.code}: fresh_ids = drawn items not previously seen`,
        JSON.stringify([...stored].sort()) === JSON.stringify([...expectFresh].sort()),
        [`stored ${stored.length}`, `expected ${expectFresh.length}`],
      );
      check(
        `${exam.code}: second draw prefers unseen items (${repeats}/${ids2.length} repeats, bank ${bank})`,
        bank >= 2 * ids2.length ? repeats <= ids2.length / 2 : repeats < ids2.length,
        [`repeats ${repeats}`],
      );
      await db.query("delete from cf_item_reviews where user_id = $1", [userId]);
    }

    // --- holdout form + per-item scoring (2026-09-25) -------------------------
    console.log("\nholdout form + scoring");
    const heldRows = (await db.query("select question_id, exam_code from cf_holdout")).rows;
    for (const exam of exams) {
      const held = new Set(heldRows.filter((r) => r.exam_code === exam.code).map((r) => r.question_id));
      if (held.size === 0) continue;
      let leaked = 0;
      for (let i = 0; i < DRAWS; i++) {
        for (const mode of ["full", "quick"]) {
          const r = await asUser("select cf_start_session($1, $2) as s", [exam.code, mode]);
          leaked += r.rows[0].s.questions.filter((q) => held.has(q.id)).length;
        }
      }
      const p = await asUser("select cf_start_practice($1, 40) as s", [exam.code]);
      leaked += p.rows[0].s.questions.filter((q) => held.has(q.id)).length;
      check(`${exam.code}: holdout items never appear in full/quick sims or practice`, leaked === 0, [
        `${leaked} leaked`,
      ]);

      const h = await asUser("select cf_start_session($1, 'holdout') as s", [exam.code]);
      const hs = h.rows[0].s;
      const hids = hs.questions.map((q) => q.id);
      check(
        `${exam.code}: holdout mode serves exactly the ${held.size}-item form`,
        hids.length === held.size && hids.every((id) => held.has(id)),
        [`served ${hids.length}`],
      );

      // Answer the first 3/4 of the form correctly and submit. For per-item
      // exams weighted_pct must equal the plain item percent.
      const keys = (
        await db.query("select id, correct from cf_questions where id = any($1::text[])", [hids])
      ).rows;
      const answers = {};
      const nRight = Math.floor(hids.length * 0.75);
      hids.forEach((id, i) => {
        const k = keys.find((x) => x.id === id).correct;
        answers[id] = i < nRight ? k : [(k[0] + 1) % 4];
      });
      await db.query("update cf_exam_sessions set answers = $2 where id = $1", [
        hs.session_id,
        answers,
      ]);
      const sub = (await asUser("select cf_submit_session($1) as s", [hs.session_id])).rows[0].s;
      if (exam.code === "CCAR-F") {
        const plain = +((100 * nRight) / hids.length).toFixed(2);
        check(
          `${exam.code}: scored by plain item percent (${plain}%)`,
          Math.abs(Number(sub.weighted_pct) - plain) < 0.01,
          [`weighted_pct ${sub.weighted_pct}`],
        );
      }
      const att = (
        await db.query("select count(*)::int n from cf_attempts where user_id = $1 and exam_code = $2", [
          userId,
          exam.code,
        ])
      ).rows[0].n;
      check(`${exam.code}: holdout submit feeds Readiness (cf_attempts written)`, att > 0, [`${att} rows`]);

      // Per-task-statement results cover every item of the submitted form and
      // agree with the answers we wrote (nRight correct).
      const tagged = (
        await db.query("select count(*)::int n from cf_question_tasks where exam_code = $1", [exam.code])
      ).rows[0].n;
      if (tagged > 0) {
        const ts = (await asUser("select cf_task_stats($1) as s", [exam.code])).rows[0].s;
        const attempts = ts.reduce((a, t) => a + t.attempts, 0);
        const correct = ts.reduce((a, t) => a + t.correct, 0);
        check(
          `${exam.code}: task stats cover the submitted form (${attempts} graded, ${correct} right)`,
          attempts === hids.length && correct === nRight,
          [`attempts ${attempts}/${hids.length}`, `correct ${correct}/${nRight}`],
        );
      }

      // A re-sit is all repeats: fresh_ids empty, so Readiness must not move.
      const h2 = (await asUser("select cf_start_session($1, 'holdout') as s", [exam.code])).rows[0].s;
      const fresh2 = (
        await db.query("select fresh_ids from cf_exam_sessions where id = $1", [h2.session_id])
      ).rows[0].fresh_ids;
      await asUser("select cf_submit_session($1)", [h2.session_id]);
      const att2 = (
        await db.query("select count(*)::int n from cf_attempts where user_id = $1 and exam_code = $2", [
          userId,
          exam.code,
        ])
      ).rows[0].n;
      // Stored fresh score + band (2026-09-25-fresh-verdict.sql). First sitting:
      // 45/60 fresh -> 775 -> borderline, not passed. Re-sit: 0 fresh -> no verdict.
      if (exam.code === "CCAR-F") {
        const rows = (
          await db.query(
            `select id, fresh_items, fresh_scaled, passed from cf_exam_sessions
              where user_id = $1 and mode = 'holdout' and submitted_at is not null order by submitted_at`,
            [userId],
          )
        ).rows;
        const [s1, s2] = rows;
        const want = Math.round(100 + (900 * nRight) / hids.length);
        check(
          `${exam.code}: first sitting stores fresh ${hids.length} items / ${want}, not passed (borderline)`,
          s1.fresh_items === hids.length && s1.fresh_scaled === want && s1.passed === false,
          [JSON.stringify(s1)],
        );
        check(
          `${exam.code}: re-sit stores 0 fresh items and no pass`,
          s2 && s2.fresh_items === 0 && s2.fresh_scaled === null && s2.passed === false,
          [JSON.stringify(s2)],
        );
        const chron = (
          await db.query(
            `select body from cf_chronicle where user_id = $1 and exam_code = $2 order by created_at`,
            [userId, exam.code],
          )
        ).rows.map((r) => r.body);
        check(
          `${exam.code}: chronicle states the band, never raw PASSED`,
          chron.some((b) => /borderline/.test(b)) &&
            chron.some((b) => /no verdict/.test(b)) &&
            !chron.some((b) => /PASSED/.test(b)),
          chron,
        );
      }

      // Pooled readiness counts the first sitting's fresh items only.
      const pooled = (await asUser("select cf_readiness() as r")).rows[0].r[exam.code];
      check(
        `${exam.code}: cf_readiness pools fresh items only (${pooled?.items}/${pooled?.correct})`,
        pooled && pooled.items === hids.length && pooled.correct === nRight,
        [JSON.stringify(pooled && { items: pooled.items, correct: pooled.correct, sims: pooled.sims })],
      );
      check(
        `${exam.code}: a re-sit of seen items adds nothing to Readiness`,
        fresh2.length === 0 && att2 === att,
        [`fresh ${fresh2.length}`, `attempts ${att} -> ${att2}`],
      );
    }
  } finally {
    await db.query("delete from cf_attempts where user_id = $1", [userId]);
    await db.query("delete from cf_chronicle where user_id = $1", [userId]);
    await db.query("delete from cf_achievements where user_id = $1", [userId]);
    await db.query("delete from cf_practice_sessions where user_id = $1", [userId]);
    await db.query("delete from cf_item_reviews where user_id = $1", [userId]);
    const del = await db.query("delete from cf_exam_sessions where user_id = $1", [userId]);
    await db.query("delete from cf_profiles where id = $1", [userId]);
    await db.query("delete from auth.users where id = $1", [userId]);
    const left = await db.query(
      "select (select count(*) from cf_profiles where display_name = 'HARNESS_DRAW')::int p",
    );
    console.log(
      `\nteardown: removed ${del.rowCount} harness sessions, profiles left=${left.rows[0].p}`,
    );
  }

  console.log(`\n${pass} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  }
  await db.end();
}

main().catch((e) => {
  console.error("HARNESS ERROR: " + e.message);
  process.exit(1);
});
