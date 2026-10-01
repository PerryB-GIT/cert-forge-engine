-- Close the answer-key harvest hole (open since the move to anonymous sign-in).
--
-- Before: anyone on the internet could signInAnonymously(), upsert their own
-- cf_profiles row (insert-own RLS policy), then start practice sets / sims and
-- read every key: cf_grade_practice_item returns `correct` + rationale and
-- cf_session_review returns all keys after a (blank) submit. Practice draws
-- unseen items first, so a script sweeps a whole bank in minutes. The sealed
-- CCAR-F go/no-go form had no one-sitting guard either.
--
-- After:
--   * A profile can only be created by cf_join (needs an invite code) or by
--     cf_claim_profile (needs an existing username + PIN). The client
--     insert-own policy is dropped.
--   * Starting a sim or a practice set requires a profile (trigger on the
--     session tables, so the long start functions stay untouched). Every
--     answer-revealing RPC needs a session first, so this gates them all.
--   * A go/no-go (holdout) form can be submitted once per user per exam.
--   * Re-grading an item already graded in a set returns the original result
--     (round-2 review N4) instead of raising.
--
-- Invite codes are stored as SHA-256 hashes only. Keep the plaintext codes in
-- a secret store, never in the repo.

begin;

create table if not exists cf_invites (
  code_hash  text primary key,
  label      text not null,
  uses_left  int  not null check (uses_left >= 0),
  created_at timestamptz not null default now()
);
alter table cf_invites enable row level security;   -- no policies: server-side only
revoke all on cf_invites from anon, authenticated;

-- ---------------------------------------------------------------- join with an invite
create or replace function cf_join(p_display_name text, p_invite text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_user uuid := auth.uid();
  v_name text := btrim(coalesce(p_display_name, ''));
  v_hash text := encode(digest(upper(btrim(coalesce(p_invite, ''))), 'sha256'), 'hex');
begin
  if v_user is null then return jsonb_build_object('ok', false, 'error', 'Not signed in.'); end if;
  if exists (select 1 from cf_profiles where id = v_user) then return jsonb_build_object('ok', true); end if;
  if char_length(v_name) < 1 or char_length(v_name) > 60 then
    return jsonb_build_object('ok', false, 'error', 'Enter your name (up to 60 characters).');
  end if;
  update cf_invites set uses_left = uses_left - 1 where code_hash = v_hash and uses_left > 0;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'That invite code isn''t valid. Ask Support Forge for one.');
  end if;
  insert into cf_profiles (id, display_name) values (v_user, v_name);
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function cf_join(text, text) from public, anon;
grant execute on function cf_join(text, text) to authenticated;

-- ---------------------------------------------------------------- no client-created profiles
drop policy if exists cf_profiles_insert_own on cf_profiles;

-- ---------------------------------------------------------------- membership + holdout guard
create or replace function cf_require_member()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from cf_profiles where id = new.user_id) then
    raise exception 'members only: join with an invite code first';
  end if;
  -- nested, not AND-ed: plpgsql does not short-circuit, and cf_practice_sessions has no `mode`
  if tg_table_name = 'cf_exam_sessions' then
    if new.mode = 'holdout' and exists (
         select 1 from cf_exam_sessions s
         where s.user_id = new.user_id and s.exam_code = new.exam_code
           and s.mode = 'holdout' and s.submitted_at is not null) then
      raise exception 'the go/no-go form for % has already been taken', new.exam_code;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function cf_require_member() from public, anon, authenticated;

drop trigger if exists cf_exam_sessions_member on cf_exam_sessions;
create trigger cf_exam_sessions_member before insert on cf_exam_sessions
  for each row execute function cf_require_member();
drop trigger if exists cf_practice_sessions_member on cf_practice_sessions;
create trigger cf_practice_sessions_member before insert on cf_practice_sessions
  for each row execute function cf_require_member();

-- ---------------------------------------------------------------- re-grade is idempotent
-- Round-2 review N4: the 10-01b duplicate guard raised, so a lost response left
-- the practice player with no feedback and no Next button. Same function as
-- 10-01b except the duplicate branch.
create or replace function cf_grade_practice_item(p_practice uuid, p_question_id text, p_answer jsonb,
                                                  p_confidence int default null)
returns jsonb language plpgsql security definer set search_path = public as $function$
declare
  v_user uuid := auth.uid();
  v_ps   cf_practice_sessions;
  q      cf_questions;
  v_ok   boolean;
  v_box  int;
  v_due  timestamptz;
begin
  select * into v_ps from cf_practice_sessions where id = p_practice and user_id = v_user;
  if not found then raise exception 'practice session not found'; end if;
  if v_ps.finished_at is not null then raise exception 'practice session finished'; end if;
  if now() > v_ps.expires_at then raise exception 'practice session expired'; end if;
  if not exists (select 1 from jsonb_array_elements_text(v_ps.question_ids) t where t = p_question_id) then
    raise exception 'question not in this practice set';
  end if;
  -- Already graded in this set (e.g. the first response was lost to a network
  -- blip): return the ORIGINAL result instead of raising, so the player can
  -- move on. Nothing is re-graded or re-scheduled; the key was already shown.
  select pa.is_correct into v_ok from cf_practice_answers pa
  where pa.practice_id = p_practice and pa.question_id = p_question_id and pa.source = 'practice';
  if found then
    select * into q from cf_questions where id = p_question_id;
    select ir.box, ir.due_at into v_box, v_due from cf_item_reviews ir
    where ir.user_id = v_user and ir.question_id = p_question_id;
    return jsonb_build_object(
      'is_correct', v_ok, 'correct', q.correct, 'rationale', q.rationale, 'tip', q.tip,
      'box', v_box, 'next_review', v_due, 'duplicate', true);
  end if;
  if p_confidence is not null and p_confidence not between 1 and 3 then
    raise exception 'confidence must be 1-3';
  end if;

  select * into q from cf_questions where id = p_question_id;
  if not found then raise exception 'unknown question'; end if;

  v_ok := (
    jsonb_typeof(p_answer) = 'array'
    and (select coalesce(array_agg(t.v::int order by t.v::int), array[]::int[])
         from jsonb_array_elements_text(p_answer) t(v))
      = (select coalesce(array_agg(t.v::int order by t.v::int), array[]::int[])
         from jsonb_array_elements_text(q.correct) t(v))
  );

  -- Leitner: a correct answer only promotes an item that is DUE; answering a
  -- not-yet-due item correctly keeps its box and schedule (no same-day climbing).
  insert into cf_item_reviews as ir (user_id, question_id, exam_code, box, reps, lapses,
                                     times_seen, times_correct, last_seen, due_at)
  values (v_user, p_question_id, q.exam_code,
          case when v_ok then 1 else 0 end,
          case when v_ok then 1 else 0 end,
          case when v_ok then 0 else 1 end,
          1, case when v_ok then 1 else 0 end, now(),
          now() + cf_box_interval(case when v_ok then 1 else 0 end))
  on conflict (user_id, question_id) do update set
    box = case when not v_ok then 0
               when ir.due_at <= now() then least(5, ir.box + 1)
               else ir.box end,
    reps = case when not v_ok then 0
                when ir.due_at <= now() then ir.reps + 1
                else ir.reps end,
    lapses = ir.lapses + case when v_ok then 0 else 1 end,
    times_seen = ir.times_seen + 1,
    times_correct = ir.times_correct + case when v_ok then 1 else 0 end,
    last_seen = now(),
    due_at = case when not v_ok then now() + cf_box_interval(0)
                  when ir.due_at <= now() then now() + cf_box_interval(least(5, ir.box + 1))
                  else ir.due_at end
  returning box, due_at into v_box, v_due;

  insert into cf_practice_answers
    (user_id, practice_id, question_id, exam_code, domain_name, answer, is_correct, source, confidence)
  values (v_user, p_practice, p_question_id, q.exam_code, q.domain_name, p_answer, v_ok, 'practice',
          p_confidence);

  update cf_practice_sessions
  set answered_count = answered_count + 1,
      correct_count = correct_count + case when v_ok then 1 else 0 end
  where id = p_practice;

  return jsonb_build_object(
    'is_correct', v_ok, 'correct', q.correct, 'rationale', q.rationale, 'tip', q.tip,
    'box', v_box, 'next_review', v_due);
end;
$function$;
revoke all on function cf_grade_practice_item(uuid, text, jsonb, int) from public, anon;
grant execute on function cf_grade_practice_item(uuid, text, jsonb, int) to authenticated;

insert into cf_migrations (name) values ('2026-10-01c-invite-gate') on conflict do nothing;

commit;
