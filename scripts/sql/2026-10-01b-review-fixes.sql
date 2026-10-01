-- Fixes from the fresh-context review of 2026-10-01-report-gamification-leaderboard.sql.
-- Spec: internal report-card v2 spec, "Review round 1" (not included).
--
-- C1  legacy cf_leaderboard() leaked every profile to any signed-in caller -> dropped.
-- H1  practice items could be re-graded in the same set (answer revealed after the
--     first try) -> one grade per (set, item); box only advances when the item is due;
--     review metrics count the FIRST answer of an item per day.
-- H2  blank sims qualified days / farmed XP -> a sim only counts with >=50% answered;
--     sim XP capped at 300/day; qualified practice day = 5 DISTINCT items.
-- H3  Improvement baseline could be sandbagged -> improvement = this week's best
--     "honest" sim minus the personal best from BEFORE this week; honest = >=90%
--     answered and >=25% of the allowed time used.
-- M1  no display-name fallback: opting in requires an alias; aliases unique among members.
-- M3  recover quest: a practice miss answered right on a LATER day, practice only.
-- L3  streak: freezes only spent when they cover the whole gap; current week banks
--     only once it is over; qualified weeks counted over all history.

begin;

-- ---------------------------------------------------------------- C1
drop function if exists cf_leaderboard();

-- ---------------------------------------------------------------- M1
alter table cf_profiles drop constraint if exists cf_profiles_leaderboard_alias_required;
alter table cf_profiles add constraint cf_profiles_leaderboard_alias_required
  check (not leaderboard_opt_in or leaderboard_alias is not null);
create unique index if not exists cf_profiles_leaderboard_alias_unique
  on cf_profiles (lower(btrim(leaderboard_alias))) where leaderboard_opt_in;

-- ---------------------------------------------------------------- H1 (storage guard)
create unique index if not exists cf_practice_answers_once_per_set
  on cf_practice_answers (practice_id, question_id)
  where source = 'practice' and practice_id is not null;

-- ---------------------------------------------------------------- effort predicates
-- answered = items with a non-empty pick in the answers map
create or replace function cf_session_answered(s cf_exam_sessions)
returns int language sql immutable set search_path = public as $$
  select count(*)::int from jsonb_each(coalesce(s.answers, '{}'::jsonb)) e
  where jsonb_typeof(e.value) = 'array' and jsonb_array_length(e.value) > 0;
$$;

-- counts toward study days / XP: at least half the items answered
create or replace function cf_session_effort(s cf_exam_sessions)
returns boolean language sql immutable set search_path = public as $$
  select s.submitted_at is not null
     and cf_session_answered(s) * 2 >= greatest(1, jsonb_array_length(s.question_ids));
$$;

-- counts toward the leaderboard: a real sitting, not a sandbag
create or replace function cf_session_honest(s cf_exam_sessions)
returns boolean language sql immutable set search_path = public as $$
  select s.submitted_at is not null and s.started_at is not null
     and s.mode in ('full','holdout')
     and coalesce(s.fresh_items, 0) >= 40 and s.fresh_scaled is not null
     and cf_session_answered(s) * 10 >= 9 * jsonb_array_length(s.question_ids)
     and (s.submitted_at - s.started_at) * 4 >= (s.expires_at - s.started_at);
$$;

-- first practice answer per (item, day): the only one that counts for review metrics
create or replace function cf_first_daily_answers(p_user uuid)
returns table(question_id text, day date, is_correct boolean, answered_at timestamptz)
language sql stable security definer set search_path = public as $$
  select distinct on (pa.question_id, (pa.answered_at at time zone 'America/New_York')::date)
         pa.question_id, (pa.answered_at at time zone 'America/New_York')::date, pa.is_correct, pa.answered_at
  from cf_practice_answers pa
  where pa.user_id = p_user and pa.source = 'practice'
  order by pa.question_id, (pa.answered_at at time zone 'America/New_York')::date, pa.answered_at;
$$;

-- review answers = first answer of the day on an item first seen on an earlier day
create or replace function cf_review_answers(p_user uuid, p_week date)
returns table(question_id text, is_correct boolean)
language sql stable security definer set search_path = public as $$
  with f as (select * from cf_first_daily_answers(p_user))
  select f.question_id, f.is_correct from f
  where f.day >= p_week and f.day < p_week + 7
    and exists (select 1 from f prior where prior.question_id = f.question_id and prior.day < f.day);
$$;

-- ---------------------------------------------------------------- daily activity (H2)
create or replace function cf_daily_activity(p_user uuid, p_since date)
returns table(day date, practice int, flashcards int, sims int, sim_items int, qualified boolean)
language sql stable security definer set search_path = public as $$
  with pa as (
    select (answered_at at time zone 'America/New_York')::date d,
           count(*) filter (where source = 'practice')  p,
           count(*) filter (where source = 'flashcard') f,
           count(distinct question_id) filter (where source = 'practice') pd
    from cf_practice_answers
    where user_id = p_user and answered_at >= (p_since::timestamp at time zone 'America/New_York')
    group by 1
  ), se as (
    select (s.submitted_at at time zone 'America/New_York')::date d,
           count(*) filter (where cf_session_effort(s)) s,
           coalesce(sum(jsonb_array_length(s.question_ids)), 0) n
    from cf_exam_sessions s
    where s.user_id = p_user and s.submitted_at is not null
      and s.submitted_at >= (p_since::timestamp at time zone 'America/New_York')
    group by 1
  )
  select coalesce(pa.d, se.d), coalesce(pa.p, 0)::int, coalesce(pa.f, 0)::int,
         coalesce(se.s, 0)::int, coalesce(se.n, 0)::int,
         (coalesce(pa.pd, 0) >= 5 or coalesce(se.s, 0) > 0)
  from pa full join se on se.d = pa.d;
$$;

-- ---------------------------------------------------------------- quests (H1, M3)
create or replace function cf_quest_progress(p_user uuid, p_week date, p_key text)
returns int language sql stable security definer set search_path = public as $$
  select case p_key
    when 'study_days' then (
      select count(*)::int from cf_daily_activity(p_user, p_week) a
      where a.day >= p_week and a.day < p_week + 7 and a.qualified)
    when 'review_items' then (select count(*)::int from cf_review_answers(p_user, p_week))
    when 'full_sim' then (
      select count(*)::int from cf_exam_sessions s
      where s.user_id = p_user and s.mode in ('full','holdout') and cf_session_effort(s)
        and cf_week_start(s.submitted_at) = p_week)
    when 'recover_items' then (
      select count(distinct f.question_id)::int from cf_first_daily_answers(p_user) f
      where f.is_correct and f.day >= p_week and f.day < p_week + 7
        and exists (select 1 from cf_practice_answers m
                    where m.user_id = p_user and m.source = 'practice' and m.question_id = f.question_id
                      and not m.is_correct
                      and (m.answered_at at time zone 'America/New_York')::date < f.day))
    when 'calibrate' then (
      select count(*)::int from cf_practice_answers pa
      where pa.user_id = p_user and pa.source = 'practice' and pa.confidence is not null
        and cf_week_start(pa.answered_at) = p_week)
    else 0 end;
$$;

create or replace function cf_quest_catalog()
returns jsonb language sql immutable set search_path = public as $$
  select '[
    {"key":"study_days",    "label":"Study on 5 of 7 days",                         "target":5,  "unit":"days"},
    {"key":"review_items",  "label":"Answer 40 spaced-review items",                "target":40, "unit":"reviews"},
    {"key":"full_sim",      "label":"Sit a full practice exam",                     "target":1,  "unit":"sims"},
    {"key":"recover_items", "label":"Get 10 earlier practice misses right on a later day","target":10,"unit":"items"},
    {"key":"calibrate",     "label":"Rate your confidence on 30 items",             "target":30, "unit":"ratings"}
  ]'::jsonb;
$$;

-- ---------------------------------------------------------------- XP (H2)
create or replace function cf_xp_between(p_user uuid, p_from date, p_to date)
returns int language sql stable security definer set search_path = public as $$
  with items as (
    select (answered_at at time zone 'America/New_York')::date d, question_id, source,
           bool_or(is_correct) ok
    from cf_practice_answers
    where user_id = p_user
      and answered_at >= (p_from::timestamp at time zone 'America/New_York')
      and answered_at <  (p_to::timestamp   at time zone 'America/New_York')
    group by 1, 2, 3
  ), per_day as (
    select d, least(300, sum(case when source = 'practice' then 10 + case when ok then 5 else 0 end
                                  else 3 end)) xp
    from items group by d
  ), sims as (
    select (s.submitted_at at time zone 'America/New_York')::date d,
           least(300, sum(case when s.mode = 'quick' then 30
                               else 100 + least(60, coalesce(s.fresh_items, 0)) end)) xp
    from cf_exam_sessions s
    where s.user_id = p_user and cf_session_effort(s)
      and s.submitted_at >= (p_from::timestamp at time zone 'America/New_York')
      and s.submitted_at <  (p_to::timestamp   at time zone 'America/New_York')
    group by 1
  ), quests as (
    select 150 * count(*) xp from cf_quests q
    where q.user_id = p_user and q.week_start >= p_from and q.week_start < p_to
      and cf_quest_progress(p_user, q.week_start, q.quest_key) >= q.target
  )
  select (coalesce((select sum(xp) from per_day), 0)
        + coalesce((select sum(xp) from sims), 0)
        + coalesce((select xp from quests), 0))::int;
$$;

-- ---------------------------------------------------------------- streak (L3)
create or replace function cf_streak_for(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'America/New_York')::date;
  v_from  date := v_today - 179;
  v_days  date[];
  v_q     boolean[];
  n int; i int; j int; gap int;
  v_bank int := 0; v_used int := 0; v_cur int := 0; v_best int := 0; v_wk int := 0;
  v_frozen date[] := '{}';
  v_qweeks int;
begin
  select array_agg(g::date order by g), array_agg(coalesce(a.qualified, false) order by g)
    into v_days, v_q
  from generate_series(v_from, v_today, interval '1 day') g
  left join cf_daily_activity(p_user, v_from) a on a.day = g::date;
  n := array_length(v_days, 1);
  i := 1;
  while i <= n loop
    if v_q[i] then
      v_cur := v_cur + 1; v_wk := v_wk + 1;
    elsif v_days[i] = v_today then
      null;                                  -- today is still in progress
    else
      -- length of this run of missed days, not counting today
      j := i; gap := 0;
      while j <= n and not v_q[j] and v_days[j] < v_today loop gap := gap + 1; j := j + 1; end loop;
      if v_cur > 0 and gap <= v_bank then
        for k in i .. i + gap - 1 loop v_frozen := v_frozen || v_days[k]; end loop;
        v_bank := v_bank - gap; v_used := v_used + gap;
      else
        v_cur := 0;
      end if;
      -- week-end banking still applies to any Sunday inside the gap
      for k in i .. i + gap - 1 loop
        if extract(isodow from v_days[k]) = 7 then
          if v_wk >= 3 then v_bank := least(2, v_bank + 1); end if;
          v_wk := 0;
        end if;
      end loop;
      i := i + gap;
      continue;
    end if;
    v_best := greatest(v_best, v_cur);
    if extract(isodow from v_days[i]) = 7 and v_days[i] < v_today then
      if v_wk >= 3 then v_bank := least(2, v_bank + 1); end if;
      v_wk := 0;
    end if;
    i := i + 1;
  end loop;

  select count(*) into v_qweeks from (
    select cf_week_start(a.day::timestamp at time zone 'America/New_York') w
    from cf_daily_activity(p_user, '2000-01-01') a
    where a.qualified and a.day < cf_week_start(now())
    group by 1 having count(*) >= 3) x;

  return jsonb_build_object('current', v_cur, 'best', v_best, 'freezes_banked', v_bank,
    'freezes_used', v_used, 'frozen_days', to_jsonb(v_frozen), 'qualified_weeks', v_qweeks);
end;
$$;

-- ---------------------------------------------------------------- grading (H1)
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
  if exists (select 1 from cf_practice_answers
             where practice_id = p_practice and question_id = p_question_id and source = 'practice') then
    raise exception 'already answered in this set';
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

-- ---------------------------------------------------------------- leaderboard (H1, H3, M1)
create or replace function cf_leaderboard_week(p_weeks_ago int default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_week date := cf_week_start(now()) - 7 * greatest(0, least(coalesce(p_weeks_ago, 0), 12));
  v_in boolean;
  v_rows jsonb;
  v_members int;
begin
  if v_user is null then raise exception 'not signed in'; end if;
  select leaderboard_opt_in into v_in from cf_profiles where id = v_user;
  select count(*) into v_members from cf_profiles where leaderboard_opt_in;
  if not coalesce(v_in, false) then
    return jsonb_build_object('opted_in', false, 'members', v_members, 'week_start', v_week);
  end if;

  with m as (
    select p.id, btrim(p.leaderboard_alias) as name, p.id = v_user as is_me
    from cf_profiles p where p.leaderboard_opt_in
  ), h as (   -- honest qualifying sims only
    select s.user_id, s.exam_code, s.fresh_scaled, s.submitted_at, s.passed
    from cf_exam_sessions s join m on m.id = s.user_id
    where cf_session_honest(s)
  ), wk as (
    select user_id, exam_code, max(fresh_scaled) best from h
    where cf_week_start(submitted_at) = v_week group by 1, 2
  ), prior as (  -- personal best from BEFORE the week: sandbagging can't lower it
    select user_id, exam_code, max(fresh_scaled) pb from h
    where submitted_at < (v_week::timestamp at time zone 'America/New_York') group by 1, 2
  ), imp as (
    select distinct on (wk.user_id) wk.user_id, wk.exam_code, wk.best - prior.pb delta
    from wk join prior using (user_id, exam_code)
    order by wk.user_id, wk.best - prior.pb desc
  ), alltime as (
    select user_id, jsonb_object_agg(exam_code, best) per_exam, count(*) filter (where passed_any) passes
    from (select user_id, exam_code, max(fresh_scaled) best, bool_or(passed) passed_any
          from h group by 1, 2) x
    group by 1
  )
  select jsonb_agg(jsonb_build_object(
           'name', m.name, 'is_me', m.is_me,
           'improvement', imp.delta, 'improvement_exam', imp.exam_code,
           'retention_n', rv.n,
           'retention_pct', case when rv.n >= 20 then round(100.0 * rv.k / rv.n) end,
           'qualified_days', (select count(*) from cf_daily_activity(m.id, v_week) a
                              where a.day >= v_week and a.day < v_week + 7 and a.qualified),
           'xp_week', cf_xp_between(m.id, v_week, v_week + 7),
           'best', coalesce(alltime.per_exam, '{}'::jsonb),
           'likely_passes', coalesce(alltime.passes, 0))
         order by m.name)
    into v_rows
  from m
  left join imp on imp.user_id = m.id
  left join alltime on alltime.user_id = m.id
  cross join lateral (select count(*)::int n, count(*) filter (where r.is_correct)::int k
                      from cf_review_answers(m.id, v_week) r) rv;

  return jsonb_build_object(
    'opted_in', true, 'members', v_members, 'week_start', v_week,
    'rows', coalesce(v_rows, '[]'::jsonb),
    'team', jsonb_build_object(
      'qualified_days', (select coalesce(sum((r->>'qualified_days')::int), 0)
                         from jsonb_array_elements(coalesce(v_rows, '[]'::jsonb)) r),
      'target', 4 * v_members));
end;
$$;

-- ---------------------------------------------------------------- grants
revoke all on function cf_first_daily_answers(uuid), cf_review_answers(uuid, date),
  cf_daily_activity(uuid, date), cf_quest_progress(uuid, date, text),
  cf_xp_between(uuid, date, date), cf_streak_for(uuid)
  from public, anon, authenticated;
revoke all on function cf_grade_practice_item(uuid, text, jsonb, int), cf_leaderboard_week(int)
  from public, anon;
grant execute on function cf_grade_practice_item(uuid, text, jsonb, int), cf_leaderboard_week(int)
  to authenticated;

insert into cf_migrations (name) values ('2026-10-01b-review-fixes') on conflict do nothing;

commit;
