/**
 * Verification for the 2026-10-01 Report Card / gamification / leaderboard
 * migration. Spec: internal report-card v2 spec, section V2 (not included).
 *
 *   CF_PROJECT_REF=<ref> SUPABASE_ACCESS_TOKEN=<token> node scripts/verify-gamification.js [--with-migration]
 *
 * Everything runs inside ONE transaction that always ends in a raised
 * exception, so throwaway users, sessions and answers can never persist.
 * --with-migration[=path] prepends a migration (default: the latest, minus its
 * begin/commit), so it can be proven BEFORE it is applied for real.
 *
 * Each RPC is called as `authenticated` with request.jwt.claims set, so
 * auth.uid() and grants behave as they do for the browser client.
 */
const fs = require("fs");
const path = require("path");
const { runSql } = require("./cf-db");

const DEFAULT_MIGRATION = path.join(__dirname, "sql", "2026-10-01b-review-fixes.sql");
const SENTINEL = "CF_HARNESS_RESULT:";

const harness = String.raw`
do $harness$
declare
  v_admin text := current_user;
  r jsonb := '[]'::jsonb;
  a uuid := gen_random_uuid();  -- opted in, alias, improving, reviews
  b uuid := gen_random_uuid();  -- opted in, one sim, few reviews
  e uuid := gen_random_uuid();  -- blank-sim farmer
  f uuid := gen_random_uuid();  -- sandbagger
  c uuid := gen_random_uuid();  -- NOT opted in; streak with a freeze
  d uuid := gen_random_uuid();  -- streak gap with no freeze banked
  today date := (now() at time zone 'America/New_York')::date;
  wk date := cf_week_start(now());
  q text[]; qi text; i int; k int;
  ps uuid := gen_random_uuid();
  ps2 uuid := gen_random_uuid();
  full_ans jsonb;
  v jsonb; ok boolean; raised boolean;
  row_a jsonb; row_b jsonb;
begin
  -- ---------------------------------------------------------- fixtures (as admin)
  select array_agg(id order by id) into q
  from (select id from cf_questions where exam_code = 'CCDV-F' order by id limit 80) x;
  select jsonb_object_agg(x, '[0]'::jsonb) into full_ans from unnest(q) x;   -- every item answered

  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at,
                          raw_app_meta_data, raw_user_meta_data, is_anonymous)
  select u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         u::text || '@harness.invalid', now(), now(), '{}', '{}', true
  from unnest(array[a, b, c, d, e, f]) u;
  insert into cf_profiles (id, display_name, share_scores, leaderboard_opt_in, leaderboard_alias) values
    (a, 'Harness Real Name A', true,  true,  'Falcon'),
    (b, 'Harness B',           true,  true,  'Otter'),
    (c, 'Harness C',           false, false, null),
    (d, 'Harness D',           false, false, null),
    (e, 'Harness E',           false, false, null),
    (f, 'Harness F',           false, true,  'Heron');

  -- A: baseline sims 3 weeks ago (600, 650) then 760 this week (Monday noon)
  insert into cf_exam_sessions (id, user_id, exam_code, question_ids, started_at, expires_at,
                                submitted_at, mode, fresh_items, fresh_scaled, scaled_score,
                                weighted_pct, passed, domain_scores, answers, proctor_events)
  select gen_random_uuid(), a, 'CCDV-F', to_jsonb(q[1:60]),
         t - interval '80 minutes', t + interval '40 minutes', t, 'full', 60, s, s, 60, s >= 800,
         '{}', full_ans, '[]'
  from (values ((wk - 21 + time '12:00') at time zone 'America/New_York', 600),
               ((wk - 20 + time '12:00') at time zone 'America/New_York', 650),
               ((wk + time '12:00') at time zone 'America/New_York', 760)) x(t, s);
  -- B: a single qualifying sim, likely pass
  insert into cf_exam_sessions (id, user_id, exam_code, question_ids, started_at, expires_at,
                                submitted_at, mode, fresh_items, fresh_scaled, scaled_score,
                                weighted_pct, passed, domain_scores, answers, proctor_events)
  values (gen_random_uuid(), b, 'CCDV-F', to_jsonb(q[1:60]),
          now() - interval '3 days', now() - interval '2 days', now() - interval '2 days 1 hour',
          'full', 60, 850, 850, 83, true, '{}', full_ans, '[]');

  -- E: a blank quick test two days ago (must not qualify the day or earn XP)
  insert into cf_exam_sessions (id, user_id, exam_code, question_ids, started_at, expires_at,
                                submitted_at, mode, fresh_items, fresh_scaled, scaled_score,
                                weighted_pct, passed, domain_scores, answers, proctor_events)
  values (gen_random_uuid(), e, 'CCDV-F', to_jsonb(q[1:10]), now() - interval '2 days 1 minute',
          now() - interval '1 day', now() - interval '2 days', 'quick', 10, 100, 100, 0, false, '{}', '{}', '[]');
  -- F: two blank full sims first (old rule: baseline 100 -> +660), honest 700, honest 760 this week
  insert into cf_exam_sessions (id, user_id, exam_code, question_ids, started_at, expires_at,
                                submitted_at, mode, fresh_items, fresh_scaled, scaled_score,
                                weighted_pct, passed, domain_scores, answers, proctor_events)
  select gen_random_uuid(), f, 'CCDV-F', to_jsonb(q[1:60]), t - make_interval(mins => used), t + interval '60 minutes', t,
         'full', 60, sc, sc, 60, false, '{}', an, '[]'
  from (values ((wk - 21 + time '12:00') at time zone 'America/New_York', 100, '{}'::jsonb, 2),
               ((wk - 14 + time '12:00') at time zone 'America/New_York', 100, '{}'::jsonb, 2),
               ((wk - 7  + time '12:00') at time zone 'America/New_York', 700, full_ans, 60),
               ((wk      + time '12:00') at time zone 'America/New_York', 760, full_ans, 60)) x(t, sc, an, used);

  -- A: first answers on 40 items two weeks ago (makes later answers "reviews")
  insert into cf_practice_answers (user_id, question_id, exam_code, domain_name, answer, is_correct, source, answered_at)
  select a, q[n], 'CCDV-F', 'x', '[0]', false, 'practice', (wk - 14 + time '12:00') at time zone 'America/New_York'
  from generate_series(1, 40) n;
  -- A: 25 reviews this week across Mon/Tue/Wed (>=5 per day -> 3 qualified days), 20 correct
  insert into cf_practice_answers (user_id, question_id, exam_code, domain_name, answer, is_correct, source, answered_at)
  select a, q[n], 'CCDV-F', 'x', '[0]', n <= 20, 'practice',
         (wk + ((n - 1) % 3) + time '12:00') at time zone 'America/New_York'
  from generate_series(1, 25) n;
  -- B: 10 reviews this week (below the 20-review floor)
  insert into cf_practice_answers (user_id, question_id, exam_code, domain_name, answer, is_correct, source, answered_at)
  select b, q[n], 'CCDV-F', 'x', '[0]', true, 'practice', (wk - 14 + time '12:00') at time zone 'America/New_York'
  from generate_series(1, 10) n;
  insert into cf_practice_answers (user_id, question_id, exam_code, domain_name, answer, is_correct, source, answered_at)
  select b, q[n], 'CCDV-F', 'x', '[0]', true, 'practice', (wk + time '12:00') at time zone 'America/New_York'
  from generate_series(1, 10) n;

  -- C: qualified every day from today-20 to today-1 except today-10 (freeze bridges it)
  insert into cf_practice_answers (user_id, question_id, exam_code, domain_name, answer, is_correct, source, answered_at)
  select c, q[n], 'CCDV-F', 'x', '[0]', true, 'practice', (today - dd + time '12:00') at time zone 'America/New_York'
  from generate_series(1, 20) dd, generate_series(1, 5) n where dd <> 10;
  -- D: qualified today-3 and today-1 only; gap at today-2 with nothing banked
  insert into cf_practice_answers (user_id, question_id, exam_code, domain_name, answer, is_correct, source, answered_at)
  select d, q[n], 'CCDV-F', 'x', '[0]', true, 'practice', (today - dd + time '12:00') at time zone 'America/New_York'
  from unnest(array[1, 3]) dd, generate_series(1, 5) n;

  -- ---------------------------------------------------------- grants
  r := r || jsonb_build_object('label', 'helper cf_daily_activity not executable by authenticated',
         'ok', not has_function_privilege('authenticated', 'cf_daily_activity(uuid,date)', 'execute'));
  r := r || jsonb_build_object('label', 'helper cf_xp_between not executable by authenticated',
         'ok', not has_function_privilege('authenticated', 'cf_xp_between(uuid,date,date)', 'execute'));
  r := r || jsonb_build_object('label', 'cf_leaderboard_week not executable by anon',
         'ok', not has_function_privilege('anon', 'cf_leaderboard_week(int)', 'execute'));

  -- ---------------------------------------------------------- leaderboard as C (not opted in)
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  v := cf_leaderboard_week(0);
  r := r || jsonb_build_object('label', 'non-opted caller: opted_in false', 'ok', (v->>'opted_in')::boolean = false);
  r := r || jsonb_build_object('label', 'non-opted caller: no rows key', 'ok', not (v ? 'rows'), 'detail', v);
  v := cf_scoreboard();
  r := r || jsonb_build_object('label', 'scoreboard non-sharer: roster empty', 'ok', v->'roster' = '[]'::jsonb, 'detail', v->'roster');
  r := r || jsonb_build_object('label', 'scoreboard non-sharer: team hidden', 'ok', jsonb_typeof(v->'team') = 'null');

  -- streak with a freeze
  v := cf_gamification();
  r := r || jsonb_build_object('label', 'C streak bridged by freeze = 19', 'ok', (v->'streak'->>'current')::int = 19, 'detail', v->'streak');
  r := r || jsonb_build_object('label', 'C used exactly 1 freeze', 'ok', (v->'streak'->>'freezes_used')::int = 1);
  r := r || jsonb_build_object('label', 'gamification returns 6 badges', 'ok', jsonb_array_length(v->'badges') = 6);
  r := r || jsonb_build_object('label', 'quest options offered (3) when none chosen', 'ok', jsonb_array_length(v->'quest'->'options') = 3);

  -- quests
  raised := false;
  begin perform cf_choose_quest('not_a_quest'); exception when others then raised := true; end;
  r := r || jsonb_build_object('label', 'choose unknown quest raises', 'ok', raised);

  -- ---------------------------------------------------------- as D
  perform set_config('request.jwt.claims', json_build_object('sub', d, 'role', 'authenticated')::text, true);
  v := cf_gamification();
  r := r || jsonb_build_object('label', 'D no freeze banked: streak = 1', 'ok', (v->'streak'->>'current')::int = 1, 'detail', v->'streak');
  r := r || jsonb_build_object('label', 'D freezes not spent on an uncoverable gap', 'ok', (v->'streak'->>'freezes_used')::int = 0);

  -- ---------------------------------------------------------- review round 1 regressions
  perform set_config('request.jwt.claims', json_build_object('sub', e, 'role', 'authenticated')::text, true);
  v := cf_gamification();
  r := r || jsonb_build_object('label', 'H2 blank quick test earns no XP', 'ok', (v->'xp'->>'total')::int = 0, 'detail', v->'xp');
  r := r || jsonb_build_object('label', 'H2 blank quick test does not start a streak', 'ok', (v->'streak'->>'best')::int = 0);
  raised := false;
  begin update cf_profiles set leaderboard_opt_in = true where id = e; exception when others then raised := true; end;
  r := r || jsonb_build_object('label', 'M1 opting in without an alias is rejected', 'ok', raised);
  raised := false;
  begin update cf_profiles set leaderboard_opt_in = true, leaderboard_alias = ' falcon ' where id = e; exception when others then raised := true; end;
  r := r || jsonb_build_object('label', 'M1 duplicate alias (case/space-insensitive) rejected', 'ok', raised);

  -- ---------------------------------------------------------- as A (opted in)
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  v := cf_leaderboard_week(0);
  r := r || jsonb_build_object('label', 'opted caller sees 3 opted rows (not C/D/E)',
         'ok', jsonb_array_length(v->'rows') = 3, 'detail', v->'rows');
  select x into row_a from jsonb_array_elements(v->'rows') x where (x->>'is_me')::boolean;
  select x into row_b from jsonb_array_elements(v->'rows') x where x->>'name' = 'Otter';
  r := r || jsonb_build_object('label', 'B improvement null (no prior honest sim)', 'ok', jsonb_typeof(row_b->'improvement') = 'null');
  r := r || jsonb_build_object('label', 'alias shown, real name hidden',
         'ok', row_a->>'name' = 'Falcon' and position('Harness Real Name A' in v::text) = 0);
  r := r || jsonb_build_object('label', 'A improvement = 760 - prior best 650 = 110', 'ok', (row_a->>'improvement')::int = 110, 'detail', row_a);
  r := r || jsonb_build_object('label', 'A retention 20/25 = 80%', 'ok', (row_a->>'retention_pct')::int = 80);
  r := r || jsonb_build_object('label', 'B retention null below 20 reviews', 'ok', jsonb_typeof(row_b->'retention_pct') = 'null' and (row_b->>'retention_n')::int = 10);
  r := r || jsonb_build_object('label', 'A qualified days this week = 3', 'ok', (row_a->>'qualified_days')::int = 3);
  r := r || jsonb_build_object('label', 'H3 sandbag ignored: F improvement = 760 - 700 = 60',
         'ok', (select (x->>'improvement')::int from jsonb_array_elements(v->'rows') x where x->>'name' = 'Heron') = 60,
         'detail', (select x from jsonb_array_elements(v->'rows') x where x->>'name' = 'Heron'));
  r := r || jsonb_build_object('label', 'B all-time best CCDV-F 850, 1 likely pass',
         'ok', (row_b->'best'->>'CCDV-F')::int = 850 and (row_b->>'likely_passes')::int = 1);
  r := r || jsonb_build_object('label', 'no answers/domains leak in leaderboard',
         'ok', position('"answer"' in v::text) = 0 and position('domain' in v::text) = 0);

  v := cf_scoreboard();
  r := r || jsonb_build_object('label', 'scoreboard sharer: roster has A and B only', 'ok', jsonb_array_length(v->'roster') = 2, 'detail', v->'roster');
  r := r || jsonb_build_object('label', 'scoreboard: A 760 not ready (passed false), B ready',
         'ok', (v->'me'->>'ready_count')::int = 0 and (v->'me'->'per_exam'->>'CCDV-F')::int = 760);

  -- quest choose + progress
  select o->>'key' into qi from jsonb_array_elements(cf_quest_options(wk)) o limit 1;
  perform cf_choose_quest(qi);
  raised := false;
  begin perform cf_choose_quest(qi); exception when others then raised := true; end;
  r := r || jsonb_build_object('label', 'second quest choice in a week raises', 'ok', raised);
  v := cf_gamification();
  r := r || jsonb_build_object('label', 'active quest returned with progress', 'ok', v->'quest'->'active'->>'key' = qi, 'detail', v->'quest');

  -- XP: A this week = practice (Mon 9 items: ... computed) checked against a direct rule
  -- Rule check instead of a magic number: re-answering the same item many times in one day adds nothing.
  perform set_config('role', v_admin, true);
  k := cf_xp_between(a, wk, wk + 7);
  insert into cf_practice_answers (user_id, question_id, exam_code, domain_name, answer, is_correct, source, answered_at)
  select a, q[1], 'CCDV-F', 'x', '[0]', true, 'practice', (wk + time '12:05') at time zone 'America/New_York'
  from generate_series(1, 30);
  r := r || jsonb_build_object('label', 'XP: 30 repeats of a same-day item add <= 5', 'ok', cf_xp_between(a, wk, wk + 7) - k <= 5,
         'detail', jsonb_build_object('before', k, 'after', cf_xp_between(a, wk, wk + 7)));
  -- XP daily cap: 80 distinct correct items on one day -> capped at 300
  insert into cf_practice_answers (user_id, question_id, exam_code, domain_name, answer, is_correct, source, answered_at)
  select d, q[n], 'CCDV-F', 'x', '[0]', true, 'practice', (today - 30 + time '12:00') at time zone 'America/New_York'
  from generate_series(1, 80) n;
  r := r || jsonb_build_object('label', 'XP daily practice cap = 300', 'ok', cf_xp_between(d, today - 30, today - 29) = 300,
         'detail', cf_xp_between(d, today - 30, today - 29));

  -- report extras + confidence grading
  insert into cf_practice_sessions (id, user_id, exam_code, question_ids, started_at, expires_at)
  values (ps, a, 'CCDV-F', to_jsonb(q[1:5]), now(), now() + interval '1 hour');
  perform set_config('role', 'authenticated', true);
  perform cf_grade_practice_item(ps, q[1], '[0]', 2);
  raised := false;
  begin perform cf_grade_practice_item(ps, q[2], '[0]', 5); exception when others then raised := true; end;
  r := r || jsonb_build_object('label', 'confidence 5 rejected', 'ok', raised);
  perform cf_grade_practice_item(ps, q[3], '[0]');
  raised := false;
  -- (as authenticated, cf_questions is unreadable by design, so compare to the stored row)
  v := cf_grade_practice_item(ps, q[3], '[1]');
  r := r || jsonb_build_object('label', 'H1/N4 re-grade returns the ORIGINAL result, no second answer row',
         'ok', (v->>'duplicate')::boolean
               and (v->>'is_correct')::boolean = (select is_correct from cf_practice_answers where practice_id = ps and question_id = q[3])
               and (select count(*) from cf_practice_answers where practice_id = ps and question_id = q[3]) = 1,
         'detail', v);
  v := cf_report_extras();
  r := r || jsonb_build_object('label', 'extras: 12 weekly rows', 'ok', jsonb_array_length(v->'weekly') = 12, 'detail', v->'weekly');
  r := r || jsonb_build_object('label', 'extras: 14 forecast days', 'ok', jsonb_array_length(v->'due_forecast') = 14);
  r := r || jsonb_build_object('label', 'extras: pace has A''s 3 sims, 80/120 min',
         'ok', jsonb_array_length(v->'pace') = 3 and (v->'pace'->0->>'used_min')::numeric = 80 and (v->'pace'->0->>'allowed_min')::numeric = 120,
         'detail', v->'pace'->0);
  r := r || jsonb_build_object('label', 'extras: calibration has one confidence-2 answer',
         'ok', v->'calibration' = '[{"n": 1, "correct": 0, "confidence": 2}]'::jsonb
               or (jsonb_array_length(v->'calibration') = 1 and (v->'calibration'->0->>'confidence')::int = 2),
         'detail', v->'calibration');
  r := r || jsonb_build_object('label', 'extras: this week practice count >= 25',
         'ok', (v->'weekly'->11->>'practice')::int >= 25);

  -- H1: a correct answer on a NOT-yet-due item must not climb the Leitner box
  perform set_config('role', v_admin, true);
  insert into cf_item_reviews (user_id, question_id, exam_code, box, reps, lapses, times_seen, times_correct, last_seen, due_at)
  values (a, q[70], 'CCDV-F', 1, 1, 0, 1, 1, now(), now() + interval '1 day')
  on conflict (user_id, question_id) do update set box = 1, due_at = now() + interval '1 day';
  select correct::text into qi from cf_questions where id = q[70];
  insert into cf_practice_sessions (id, user_id, exam_code, question_ids, started_at, expires_at)
  values (ps2, a, 'CCDV-F', to_jsonb(array[q[70]]), now(), now() + interval '1 hour');
  perform set_config('role', 'authenticated', true);
  perform cf_grade_practice_item(ps2, q[70], qi::jsonb);
  perform set_config('role', v_admin, true);
  r := r || jsonb_build_object('label', 'H1 correct on not-due item keeps box 1',
         'ok', (select box from cf_item_reviews where user_id = a and question_id = q[70]) = 1);

  -- first answer of the day is the one that counts
  insert into cf_practice_answers (user_id, question_id, exam_code, domain_name, answer, is_correct, source, answered_at) values
    (d, q[75], 'CCDV-F', 'x', '[0]', false, 'practice', (today - 5 + time '09:00') at time zone 'America/New_York'),
    (d, q[75], 'CCDV-F', 'x', '[0]', true,  'practice', (today - 5 + time '09:05') at time zone 'America/New_York');
  r := r || jsonb_build_object('label', 'first daily answer wins (wrong then right = wrong)',
         'ok', (select not f.is_correct from cf_first_daily_answers(d) f where f.question_id = q[75] and f.day = today - 5));

  -- grants / legacy
  r := r || jsonb_build_object('label', 'C1 legacy cf_leaderboard() is gone', 'ok', to_regprocedure('cf_leaderboard()') is null);
  r := r || jsonb_build_object('label', 'all p_user helpers revoked from authenticated', 'ok', not (
            has_function_privilege('authenticated', 'cf_daily_activity(uuid,date)', 'execute')
         or has_function_privilege('authenticated', 'cf_xp_between(uuid,date,date)', 'execute')
         or has_function_privilege('authenticated', 'cf_quest_progress(uuid,date,text)', 'execute')
         or has_function_privilege('authenticated', 'cf_streak_for(uuid)', 'execute')
         or has_function_privilege('authenticated', 'cf_first_daily_answers(uuid)', 'execute')
         or has_function_privilege('authenticated', 'cf_review_answers(uuid,date)', 'execute')));

  perform set_config('role', v_admin, true);
  raise exception '${SENTINEL}%', r::text;
end
$harness$;
`;

async function main() {
  let sql = harness;
  const flag = process.argv.find((a) => a.startsWith("--with-migration"));
  if (flag) {
    const file = flag.includes("=") ? flag.split("=")[1] : DEFAULT_MIGRATION;
    const mig = fs
      .readFileSync(file, "utf8")
      .replace(/^\s*begin;\s*$/im, "")
      .replace(/commit;\s*$/i, "");
    sql = `begin;\n${mig}\n${harness}`;
  }
  let body = "";
  try {
    await runSql(sql);
    console.error("Harness did not raise its sentinel - refusing to trust this run.");
    process.exit(2);
  } catch (e) {
    body = e.body ?? e.message;
  }
  const at = body.indexOf(SENTINEL);
  if (at < 0) {
    console.error("Harness failed before reporting:\n" + body);
    process.exit(2);
  }
  // The message sits inside a JSON error envelope; decode the escaped payload.
  let payload = body.slice(at + SENTINEL.length);
  payload = payload.slice(0, payload.lastIndexOf("]") + 1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  const results = JSON.parse(payload);
  let fails = 0;
  for (const r of results) {
    if (r.ok) console.log(`  PASS  ${r.label}`);
    else {
      fails++;
      console.log(`  FAIL  ${r.label}${r.detail === undefined ? "" : ` -> ${JSON.stringify(r.detail)}`}`);
    }
  }
  console.log(`\n${results.length - fails}/${results.length} passed`);
  process.exit(fails ? 1 : 0);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(2);
});
