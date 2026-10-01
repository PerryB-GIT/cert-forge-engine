/**
 * Verification for scripts/sql/2026-10-01c-invite-gate.sql (answer-key harvest fix).
 *
 *   CF_PROJECT_REF=<ref> SUPABASE_ACCESS_TOKEN=<token> node scripts/verify-invite-gate.js [--with-migration]
 *
 * Same contract as verify-gamification.js: ONE transaction that always ends in
 * a raised sentinel, so nothing it creates (users, invites, sessions) persists.
 */
const fs = require("fs");
const path = require("path");
const { runSql } = require("./cf-db");

const MIGRATION = path.join(__dirname, "sql", "2026-10-01c-invite-gate.sql");
const SENTINEL = "CF_HARNESS_RESULT:";

const harness = String.raw`
do $harness$
declare
  v_admin text := current_user;
  r jsonb := '[]'::jsonb;
  stranger uuid := gen_random_uuid();   -- anonymous, no profile
  joiner   uuid := gen_random_uuid();   -- joins with a valid code
  late     uuid := gen_random_uuid();   -- tries a used-up code
  taker    uuid := gen_random_uuid();   -- member who already sat the holdout
  v jsonb; raised boolean; msg text;
begin
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at,
                          raw_app_meta_data, raw_user_meta_data, is_anonymous)
  select u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         u::text || '@harness.invalid', now(), now(), '{}', '{}', true
  from unnest(array[stranger, joiner, late, taker]) u;
  insert into cf_profiles (id, display_name) values (taker, 'Harness Taker');
  insert into cf_invites (code_hash, label, uses_left)
  values (encode(extensions.digest('HARNESS-CODE-1', 'sha256'), 'hex'), 'harness', 1);
  insert into cf_exam_sessions (id, user_id, exam_code, question_ids, started_at, expires_at, submitted_at,
                                mode, fresh_items, fresh_scaled, scaled_score, weighted_pct, passed,
                                domain_scores, answers, proctor_events)
  values (gen_random_uuid(), taker, 'CCAR-F', '[]', now() - interval '2 hours', now() - interval '1 hour',
          now() - interval '1 hour', 'holdout', 60, 700, 700, 66, false, '{}', '{}', '[]');

  r := r || jsonb_build_object('label', 'cf_invites not readable by authenticated',
         'ok', not has_table_privilege('authenticated', 'cf_invites', 'select'));
  r := r || jsonb_build_object('label', 'cf_join not executable by anon',
         'ok', not has_function_privilege('anon', 'cf_join(text,text)', 'execute'));

  -- ---------------------------------------------------------- stranger (anonymous, no profile)
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', stranger, 'role', 'authenticated')::text, true);
  raised := false; msg := null;
  begin perform cf_start_practice('CCDV-F', 15); exception when others then raised := true; msg := sqlerrm; end;
  r := r || jsonb_build_object('label', 'stranger cannot start practice (no keys revealed)', 'ok', raised and msg like 'members only%', 'detail', msg);
  raised := false; msg := null;
  begin perform cf_start_session('CCDV-F', 'quick'); exception when others then raised := true; msg := sqlerrm; end;
  r := r || jsonb_build_object('label', 'stranger cannot start a sim', 'ok', raised and msg like 'members only%', 'detail', msg);
  raised := false;
  begin insert into cf_profiles (id, display_name) values (stranger, 'sneaky'); exception when others then raised := true; end;
  r := r || jsonb_build_object('label', 'stranger cannot self-insert a profile', 'ok', raised);
  v := cf_join('Stranger', 'WRONG-CODE');
  r := r || jsonb_build_object('label', 'bad invite rejected', 'ok', (v->>'ok')::boolean = false, 'detail', v);

  -- ---------------------------------------------------------- joiner
  perform set_config('request.jwt.claims', json_build_object('sub', joiner, 'role', 'authenticated')::text, true);
  v := cf_join('Joiner', '  harness-code-1 ');
  r := r || jsonb_build_object('label', 'valid invite joins (case/space tolerant)', 'ok', (v->>'ok')::boolean, 'detail', v);
  v := cf_start_practice('CCDV-F', 15);
  r := r || jsonb_build_object('label', 'member can start practice', 'ok', jsonb_array_length(v->'questions') > 0);

  -- ---------------------------------------------------------- late (code used up)
  perform set_config('request.jwt.claims', json_build_object('sub', late, 'role', 'authenticated')::text, true);
  v := cf_join('Late', 'HARNESS-CODE-1');
  r := r || jsonb_build_object('label', 'used-up invite rejected', 'ok', (v->>'ok')::boolean = false, 'detail', v);

  -- ---------------------------------------------------------- holdout guard
  perform set_config('request.jwt.claims', json_build_object('sub', taker, 'role', 'authenticated')::text, true);
  raised := false; msg := null;
  begin perform cf_start_session('CCAR-F', 'holdout'); exception when others then raised := true; msg := sqlerrm; end;
  r := r || jsonb_build_object('label', 'go/no-go form cannot be re-taken', 'ok', raised and msg like '%already been taken%', 'detail', msg);
  perform set_config('request.jwt.claims', json_build_object('sub', joiner, 'role', 'authenticated')::text, true);
  raised := false; msg := null;
  begin perform cf_start_session('CCAR-F', 'holdout'); exception when others then raised := true; msg := sqlerrm; end;
  r := r || jsonb_build_object('label', 'first go/no-go sitting still allowed', 'ok', not raised, 'detail', msg);

  perform set_config('role', v_admin, true);
  r := r || jsonb_build_object('label', 'invite uses decremented to 0',
         'ok', (select uses_left from cf_invites where label = 'harness') = 0);
  raise exception '${SENTINEL}%', r::text;
end
$harness$;
`;

async function main() {
  let sql = harness;
  if (process.argv.includes("--with-migration")) {
    const mig = fs.readFileSync(MIGRATION, "utf8").replace(/^\s*begin;\s*$/im, "").replace(/commit;\s*$/i, "");
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
