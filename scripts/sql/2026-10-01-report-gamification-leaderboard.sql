-- Report Card v2 + gamification + opt-in leaderboard.
-- Spec: internal report-card v2 spec (not included). Research: docs/gamification-research.md.
--
-- Everything here is DERIVED ON READ from the existing logs (practice answers,
-- submitted sessions, item reviews). The only new state is the weekly quest
-- choice and three profile columns. No chronicle event types are added, so the
-- cf_chronicle CHECK list is untouched.
--
-- Fairness rules baked in (research doc section 2):
--   * XP counts each item once per day, caps practice XP per day -> no farming.
--   * Leaderboard never ranks raw volume or overall accuracy; it ranks
--     improvement on fresh sims, retention on review items, qualified days.
--   * Leaderboard rows go ONLY to callers who opted in themselves.

begin;

-- ---------------------------------------------------------------- columns
alter table cf_profiles add column if not exists leaderboard_opt_in boolean not null default false;
alter table cf_profiles add column if not exists leaderboard_alias text;
alter table cf_profiles drop constraint if exists cf_profiles_leaderboard_alias_check;
alter table cf_profiles add constraint cf_profiles_leaderboard_alias_check
  check (leaderboard_alias is null or char_length(btrim(leaderboard_alias)) between 2 and 24);

alter table cf_practice_answers add column if not exists confidence smallint;
alter table cf_practice_answers drop constraint if exists cf_practice_answers_confidence_check;
alter table cf_practice_answers add constraint cf_practice_answers_confidence_check
  check (confidence is null or confidence between 1 and 3);

-- ---------------------------------------------------------------- quests
create table if not exists cf_quests (
  user_id    uuid not null references auth.users(id) on delete cascade,
  week_start date not null,
  quest_key  text not null check (quest_key in
               ('study_days','review_items','full_sim','recover_items','calibrate')),
  target     int  not null check (target > 0),
  created_at timestamptz not null default now(),
  primary key (user_id, week_start)
);
alter table cf_quests enable row level security;
drop policy if exists cf_quests_select_own on cf_quests;
create policy cf_quests_select_own on cf_quests for select using (auth.uid() = user_id);

-- ---------------------------------------------------------------- helpers
-- Monday of the America/New_York week containing ts.
create or replace function cf_week_start(ts timestamptz)
returns date language sql immutable set search_path = public as $$
  select date_trunc('week', (ts at time zone 'America/New_York'))::date;
$$;

-- Per-day activity for one user (America/New_York days). A day is QUALIFIED
-- when it has >=5 graded practice answers or a submitted sim of any mode —
-- real retrieval, not a single click (research: streaks steer behaviour).
create or replace function cf_daily_activity(p_user uuid, p_since date)
returns table(day date, practice int, flashcards int, sims int, sim_items int, qualified boolean)
language sql stable security definer set search_path = public as $$
  with pa as (
    select (answered_at at time zone 'America/New_York')::date d,
           count(*) filter (where source = 'practice')  p,
           count(*) filter (where source = 'flashcard') f
    from cf_practice_answers
    where user_id = p_user and answered_at >= (p_since::timestamp at time zone 'America/New_York')
    group by 1
  ), se as (
    select (submitted_at at time zone 'America/New_York')::date d,
           count(*) s, coalesce(sum(jsonb_array_length(question_ids)), 0) n
    from cf_exam_sessions
    where user_id = p_user and submitted_at is not null
      and submitted_at >= (p_since::timestamp at time zone 'America/New_York')
    group by 1
  )
  select coalesce(pa.d, se.d), coalesce(pa.p, 0)::int, coalesce(pa.f, 0)::int,
         coalesce(se.s, 0)::int, coalesce(se.n, 0)::int,
         (coalesce(pa.p, 0) >= 5 or coalesce(se.s, 0) > 0)
  from pa full join se on se.d = pa.d;
$$;
revoke all on function cf_daily_activity(uuid, date) from public, anon, authenticated;

-- Quest progress for one user/week. Must be created before cf_xp_between,
-- whose SQL body is validated at creation time and calls it.
create or replace function cf_quest_progress(p_user uuid, p_week date, p_key text)
returns int language sql stable security definer set search_path = public as $$
  select case p_key
    when 'study_days' then (
      select count(*)::int from cf_daily_activity(p_user, p_week) a
      where a.day >= p_week and a.day < p_week + 7 and a.qualified)
    -- review = a practice answer on an item first answered on an EARLIER day
    when 'review_items' then (
      select count(*)::int from cf_practice_answers pa
      where pa.user_id = p_user and pa.source = 'practice'
        and cf_week_start(pa.answered_at) = p_week
        and exists (select 1 from cf_practice_answers prior
                    where prior.user_id = p_user and prior.question_id = pa.question_id
                      and (prior.answered_at at time zone 'America/New_York')::date
                          < (pa.answered_at at time zone 'America/New_York')::date))
    when 'full_sim' then (
      select count(*)::int from cf_exam_sessions s
      where s.user_id = p_user and s.submitted_at is not null and s.mode in ('full','holdout')
        and cf_week_start(s.submitted_at) = p_week)
    -- recovered = distinct items answered correctly this week that were missed before
    when 'recover_items' then (
      select count(distinct pa.question_id)::int from cf_practice_answers pa
      where pa.user_id = p_user and pa.is_correct
        and cf_week_start(pa.answered_at) = p_week
        and exists (select 1 from cf_practice_answers m
                    where m.user_id = p_user and m.question_id = pa.question_id
                      and not m.is_correct and m.answered_at < pa.answered_at))
    when 'calibrate' then (
      select count(*)::int from cf_practice_answers pa
      where pa.user_id = p_user and pa.confidence is not null
        and cf_week_start(pa.answered_at) = p_week)
    else 0 end;
$$;
-- XP for one user over [p_from, p_to) days. Practice: 10 per distinct item per
-- day (+5 if answered correctly that day); flashcards 3 per distinct item per
-- day; practice+flashcard XP capped at 300/day. Sims: full/holdout 100 + fresh
-- items (max 60), quick 30. Completed weekly quest: 150.
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
    select sum(case when mode = 'quick' then 30
                    else 100 + least(60, coalesce(fresh_items, 0)) end) xp
    from cf_exam_sessions
    where user_id = p_user and submitted_at is not null
      and submitted_at >= (p_from::timestamp at time zone 'America/New_York')
      and submitted_at <  (p_to::timestamp   at time zone 'America/New_York')
  ), quests as (
    select 150 * count(*) xp from cf_quests q
    where q.user_id = p_user and q.week_start >= p_from and q.week_start < p_to
      and cf_quest_progress(p_user, q.week_start, q.quest_key) >= q.target
  )
  select (coalesce((select sum(xp) from per_day), 0)
        + coalesce((select xp from sims), 0)
        + coalesce((select xp from quests), 0))::int;
$$;

revoke all on function cf_quest_progress(uuid, date, text) from public, anon, authenticated;
revoke all on function cf_xp_between(uuid, date, date) from public, anon, authenticated;

create or replace function cf_quest_catalog()
returns jsonb language sql immutable set search_path = public as $$
  select '[
    {"key":"study_days",    "label":"Study on 5 of 7 days",           "target":5,  "unit":"days"},
    {"key":"review_items",  "label":"Answer 40 spaced-review items",  "target":40, "unit":"reviews"},
    {"key":"full_sim",      "label":"Sit a full practice exam",       "target":1,  "unit":"sims"},
    {"key":"recover_items", "label":"Recover 10 previously missed items","target":10,"unit":"items"},
    {"key":"calibrate",     "label":"Rate your confidence on 30 items","target":30, "unit":"ratings"}
  ]'::jsonb;
$$;

-- Three options per week, rotating through the catalog by week number.
create or replace function cf_quest_options(p_week date)
returns jsonb language sql immutable set search_path = public as $$
  select jsonb_agg(c.v order by c.o)
  from (select v, (ord - 1 + (extract(week from p_week)::int)) % 5 o
        from jsonb_array_elements(cf_quest_catalog()) with ordinality t(v, ord)) c
  where c.o < 3;
$$;

create or replace function cf_choose_quest(p_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_week date := cf_week_start(now());
  v_opt  jsonb;
begin
  if v_user is null then raise exception 'not signed in'; end if;
  select o into v_opt from jsonb_array_elements(cf_quest_options(v_week)) o where o->>'key' = p_key;
  if v_opt is null then raise exception 'quest not offered this week'; end if;
  insert into cf_quests (user_id, week_start, quest_key, target)
  values (v_user, v_week, p_key, (v_opt->>'target')::int)
  on conflict (user_id, week_start) do nothing;
  if not found then raise exception 'quest already chosen this week'; end if;
  return jsonb_build_object('week_start', v_week, 'quest_key', p_key);
end;
$$;

-- ---------------------------------------------------------------- streak w/ freezes
-- Walks qualified days chronologically over 180 days. A freeze is earned for
-- each Mon-Sun week with >=3 qualified days (bank max 2) and is spent
-- automatically to bridge a missed day. Today never breaks the streak (still
-- in progress). Research: streaks with slack beat rigid streaks (Duolingo).
create or replace function cf_streak_for(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'America/New_York')::date;
  v_from  date := v_today - 179;
  d date; q boolean;
  v_bank int := 0; v_used int := 0; v_cur int := 0; v_best int := 0; v_wk int := 0;
  v_frozen date[] := '{}'; v_qweeks int := 0;
begin
  for d, q in
    select g::date, coalesce(a.qualified, false)
    from generate_series(v_from, v_today, interval '1 day') g
    left join cf_daily_activity(p_user, v_from) a on a.day = g::date
    order by 1
  loop
    if q then
      v_cur := v_cur + 1; v_wk := v_wk + 1;
    elsif d = v_today then
      null;
    elsif v_cur > 0 and v_bank > 0 then
      v_bank := v_bank - 1; v_used := v_used + 1; v_frozen := v_frozen || d;
    else
      v_cur := 0;
    end if;
    v_best := greatest(v_best, v_cur);
    if extract(isodow from d) = 7 then
      if v_wk >= 3 then v_bank := least(2, v_bank + 1); v_qweeks := v_qweeks + 1; end if;
      v_wk := 0;
    end if;
  end loop;
  return jsonb_build_object('current', v_cur, 'best', v_best, 'freezes_banked', v_bank,
    'freezes_used', v_used, 'frozen_days', to_jsonb(v_frozen), 'qualified_weeks', v_qweeks);
end;
$$;
revoke all on function cf_streak_for(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- gamification
create or replace function cf_level_for(p_xp int)
returns jsonb language sql immutable set search_path = public as $$
  -- level L starts at 125*L*(L-1) XP: 0, 250, 750, 1500, 2500, ...
  with l as (select greatest(1, floor((1 + sqrt(1 + 4 * greatest(p_xp, 0) / 125.0)) / 2))::int lv)
  select jsonb_build_object('level', lv, 'floor', 125 * lv * (lv - 1), 'next', 125 * (lv + 1) * lv)
  from l;
$$;

create or replace function cf_gamification()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_week date := cf_week_start(now());
  v_today date := (now() at time zone 'America/New_York')::date;
  v_xp_total int; v_xp_week int; v_xp_today int;
  v_quest jsonb; v_streak jsonb;
  v_mature int; v_recovered int; v_passes int; v_fresh_sims int; v_cal int;
  v_badges jsonb;
begin
  if v_user is null then raise exception 'not signed in'; end if;
  v_xp_total := cf_xp_between(v_user, '2000-01-01', v_today + 1);
  v_xp_week  := cf_xp_between(v_user, v_week, v_week + 7);
  v_xp_today := cf_xp_between(v_user, v_today, v_today + 1);
  v_streak   := cf_streak_for(v_user);

  select jsonb_build_object('key', q.quest_key, 'target', q.target,
           'label', (select o->>'label' from jsonb_array_elements(cf_quest_catalog()) o where o->>'key' = q.quest_key),
           'progress', cf_quest_progress(v_user, q.week_start, q.quest_key))
    into v_quest
  from cf_quests q where q.user_id = v_user and q.week_start = v_week;

  -- tier metrics (mastery and outcomes, never raw volume)
  select count(*) into v_mature from cf_item_reviews where user_id = v_user and box >= 3;
  select count(*) into v_recovered
    from jsonb_array_elements(coalesce(cf_missed_items(null), '[]'::jsonb)) m
    where m->>'status' = 'recovered';
  select count(distinct exam_code) into v_passes
    from cf_exam_sessions where user_id = v_user and passed;
  select count(*) into v_fresh_sims from cf_exam_sessions
    where user_id = v_user and submitted_at is not null and mode in ('full','holdout')
      and coalesce(fresh_items, 0) >= 40;
  select count(*) into v_cal from (
    select 1 from cf_practice_answers where user_id = v_user and confidence is not null
  ) c;

  select jsonb_agg(jsonb_build_object('key', b.k, 'label', b.label, 'desc', b.descr, 'value', b.v,
           'tiers', to_jsonb(b.t),
           'tier', case when b.v >= b.t[3] then 3 when b.v >= b.t[2] then 2 when b.v >= b.t[1] then 1 else 0 end)
         order by b.ord)
    into v_badges
  from (values
    (1, 'retention',   'Long-term memory', 'Items held 7+ days in spaced review (box 3+)', v_mature, array[25, 75, 150]),
    (2, 'recovery',    'Comeback',         'Missed items you have since recovered',         v_recovered, array[5, 20, 50]),
    (3, 'consistency', 'Steady',           'Weeks with 3+ qualified study days',            (v_streak->>'qualified_weeks')::int, array[1, 4, 8]),
    (4, 'fresh_sims',  'Under pressure',   'Full sims scored on 40+ fresh items',           v_fresh_sims, array[1, 3, 6]),
    (5, 'passes',      'Exam ready',       'Exams with a likely-pass sitting',              v_passes, array[1, 2, 4]),
    (6, 'calibration', 'Self-aware',       'Practice answers with a confidence rating',     v_cal, array[25, 100, 250])
  ) b(ord, k, label, descr, v, t);

  return jsonb_build_object(
    'xp', jsonb_build_object('total', v_xp_total, 'week', v_xp_week, 'today', v_xp_today)
          || cf_level_for(v_xp_total),
    'streak', v_streak,
    'quest', jsonb_build_object('week_start', v_week, 'active', v_quest,
                                'options', case when v_quest is null then cf_quest_options(v_week) else null end),
    'badges', v_badges);
end;
$$;

-- ---------------------------------------------------------------- report extras
create or replace function cf_report_extras()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_today date := (now() at time zone 'America/New_York')::date;
  v_week date := cf_week_start(now());
begin
  if v_user is null then raise exception 'not signed in'; end if;
  return jsonb_build_object(
    'weekly', (
      select coalesce(jsonb_agg(jsonb_build_object('week', wk, 'practice', p, 'flashcards', f,
               'sim_items', n, 'qualified_days', qd) order by wk), '[]'::jsonb)
      from (select w::date wk, coalesce(sum(a.practice), 0) p, coalesce(sum(a.flashcards), 0) f,
                   coalesce(sum(a.sim_items), 0) n, count(*) filter (where a.qualified) qd
            from generate_series(v_week - 77, v_week, interval '7 days') w
            left join cf_daily_activity(v_user, v_week - 77) a on a.day >= w::date and a.day < w::date + 7
            group by w) wk_rows),
    'due_forecast', (
      select jsonb_agg(jsonb_build_object('day', g::date, 'due', (
               select count(*) from cf_item_reviews r where r.user_id = v_user
                 and case when g::date = v_today
                          then r.due_at < ((v_today + 1)::timestamp at time zone 'America/New_York')
                          else (r.due_at at time zone 'America/New_York')::date = g::date end))
             order by g)
      from generate_series(v_today, v_today + 13, interval '1 day') g),
    'pace', (
      select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'exam_code', s.exam_code, 'mode', s.mode,
               'at', s.submitted_at,
               'used_min', round(extract(epoch from (s.submitted_at - s.started_at)) / 60.0, 1),
               'allowed_min', round(extract(epoch from (s.expires_at - s.started_at)) / 60.0, 1),
               'items', jsonb_array_length(s.question_ids)) order by s.submitted_at), '[]'::jsonb)
      from cf_exam_sessions s
      where s.user_id = v_user and s.submitted_at is not null and s.started_at is not null),
    'calibration', (
      select coalesce(jsonb_agg(jsonb_build_object('confidence', c, 'n', n, 'correct', k) order by c), '[]'::jsonb)
      from (select confidence c, count(*) n, count(*) filter (where is_correct) k
            from cf_practice_answers where user_id = v_user and confidence is not null
            group by 1) x)
  );
end;
$$;

-- ---------------------------------------------------------------- practice grading + confidence
-- Replaces the 3-arg version (dropped, not overloaded: a 4-arg overload with a
-- default would make 3-arg PostgREST calls ambiguous). Body identical except
-- the optional confidence written to cf_practice_answers.
drop function if exists cf_grade_practice_item(uuid, text, jsonb);
create or replace function cf_grade_practice_item(p_practice uuid, p_question_id text, p_answer jsonb,
                                                  p_confidence int default null)
returns jsonb language plpgsql security definer set search_path = public as $function$
declare
  v_user uuid := auth.uid();
  v_ps   cf_practice_sessions;
  q      cf_questions;
  v_ok   boolean;
  v_box  int;
begin
  select * into v_ps from cf_practice_sessions where id = p_practice and user_id = v_user;
  if not found then raise exception 'practice session not found'; end if;
  if v_ps.finished_at is not null then raise exception 'practice session finished'; end if;
  if now() > v_ps.expires_at then raise exception 'practice session expired'; end if;
  if not exists (select 1 from jsonb_array_elements_text(v_ps.question_ids) t where t = p_question_id) then
    raise exception 'question not in this practice set';
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

  insert into cf_item_reviews as ir (user_id, question_id, exam_code, box, reps, lapses,
                                     times_seen, times_correct, last_seen, due_at)
  values (v_user, p_question_id, q.exam_code,
          case when v_ok then 1 else 0 end,
          case when v_ok then 1 else 0 end,
          case when v_ok then 0 else 1 end,
          1, case when v_ok then 1 else 0 end, now(),
          now() + cf_box_interval(case when v_ok then 1 else 0 end))
  on conflict (user_id, question_id) do update set
    box = case when v_ok then least(5, ir.box + 1) else 0 end,
    reps = case when v_ok then ir.reps + 1 else 0 end,
    lapses = ir.lapses + case when v_ok then 0 else 1 end,
    times_seen = ir.times_seen + 1,
    times_correct = ir.times_correct + case when v_ok then 1 else 0 end,
    last_seen = now(),
    due_at = now() + cf_box_interval(case when v_ok then least(5, ir.box + 1) else 0 end)
  returning box into v_box;

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
    'box', v_box, 'next_review', (now() + cf_box_interval(v_box)));
end;
$function$;

-- ---------------------------------------------------------------- leaderboard
-- Opt-in only. A caller who has not opted in gets {opted_in:false, members:n}
-- and NO rows. Three weekly metrics (never one composite) + an all-time tab of
-- best fresh sim per exam. Shown name = alias, else display name.
create or replace function cf_leaderboard_week(p_weeks_ago int default 0)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_week date := cf_week_start(now()) - 7 * greatest(0, least(p_weeks_ago, 12));
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
    select p.id, coalesce(nullif(btrim(p.leaderboard_alias), ''), p.display_name) as name,
           p.id = v_user as is_me
    from cf_profiles p where p.leaderboard_opt_in
  ), q as (   -- qualifying fresh sims (same rule as Report Card "best")
    select s.user_id, s.exam_code, s.fresh_scaled, s.submitted_at, s.passed,
           row_number() over (partition by s.user_id, s.exam_code order by s.submitted_at) rn
    from cf_exam_sessions s join m on m.id = s.user_id
    where s.submitted_at is not null and s.mode in ('full','holdout')
      and coalesce(s.fresh_items, 0) >= 40 and s.fresh_scaled is not null
  ), base as (  -- baseline = best of the first two qualifying sims per exam
    select user_id, exam_code, max(fresh_scaled) b from q where rn <= 2 group by 1, 2
  ), wk as (    -- best qualifying sim this week, only once a baseline pair exists
    select q.user_id, q.exam_code, max(q.fresh_scaled) best
    from q where cf_week_start(q.submitted_at) = v_week and q.rn > 2
    group by 1, 2
  ), imp as (
    select distinct on (wk.user_id) wk.user_id, wk.exam_code, wk.best - base.b delta
    from wk join base using (user_id, exam_code)
    order by wk.user_id, wk.best - base.b desc
  ), rev as (   -- retention: accuracy on review items (first answered on an earlier day)
    select pa.user_id, count(*) n, count(*) filter (where pa.is_correct) k
    from cf_practice_answers pa join m on m.id = pa.user_id
    where pa.source = 'practice' and cf_week_start(pa.answered_at) = v_week
      and exists (select 1 from cf_practice_answers prior
                  where prior.user_id = pa.user_id and prior.question_id = pa.question_id
                    and (prior.answered_at at time zone 'America/New_York')::date
                        < (pa.answered_at at time zone 'America/New_York')::date)
    group by 1
  ), alltime as (
    select user_id, jsonb_object_agg(exam_code, best) per_exam, count(*) filter (where passed_any) passes
    from (select user_id, exam_code, max(fresh_scaled) best, bool_or(passed) passed_any
          from q group by 1, 2) x
    group by 1
  )
  select jsonb_agg(jsonb_build_object(
           'name', m.name, 'is_me', m.is_me,
           'improvement', imp.delta, 'improvement_exam', imp.exam_code,
           'retention_n', coalesce(rev.n, 0),
           'retention_pct', case when rev.n >= 20 then round(100.0 * rev.k / rev.n) end,
           'qualified_days', (select count(*) from cf_daily_activity(m.id, v_week) a
                              where a.day >= v_week and a.day < v_week + 7 and a.qualified),
           'xp_week', cf_xp_between(m.id, v_week, v_week + 7),
           'best', coalesce(alltime.per_exam, '{}'::jsonb),
           'likely_passes', coalesce(alltime.passes, 0))
         order by m.name)
    into v_rows
  from m
  left join imp on imp.user_id = m.id
  left join rev on rev.user_id = m.id
  left join alltime on alltime.user_id = m.id;

  return jsonb_build_object(
    'opted_in', true, 'members', v_members, 'week_start', v_week,
    'rows', coalesce(v_rows, '[]'::jsonb),
    'team', jsonb_build_object(
      'qualified_days', (select coalesce(sum((r->>'qualified_days')::int), 0) from jsonb_array_elements(coalesce(v_rows, '[]'::jsonb)) r),
      'target', 4 * v_members));
end;
$$;

-- ---------------------------------------------------------------- scoreboard fix (S1, S2, A4)
-- Was: per-domain MAX across all attempts incl. user-insertable manual logs,
-- "ready" at 720, roster returned to every caller. Now: best qualifying fresh
-- sim per exam, ready = a likely-pass sitting (same rule as the Report Card),
-- roster only for callers who share. Output shape unchanged.
create or replace function cf_scoreboard()
returns jsonb language sql stable security definer set search_path = public as $$
  with scored as (
    select s.user_id, s.exam_code, max(s.fresh_scaled) as scaled, bool_or(s.passed) as ready
    from cf_exam_sessions s
    where s.submitted_at is not null and s.mode in ('full','holdout')
      and coalesce(s.fresh_items, 0) >= 40 and s.fresh_scaled is not null
    group by 1, 2
  ),
  per_user as (
    select p.id, p.display_name, p.share_scores, (p.id = auth.uid()) as is_me,
      count(s.exam_code) filter (where s.ready) as ready_count,
      coalesce(sum(s.scaled), 0)::int as total_scaled,
      (select count(*) from cf_achievements a where a.user_id = p.id) as badge_count,
      coalesce(jsonb_object_agg(s.exam_code, s.scaled) filter (where s.exam_code is not null), '{}'::jsonb) as per_exam,
      coalesce(jsonb_agg(s.exam_code) filter (where s.ready), '[]'::jsonb) as ready_exams
    from cf_profiles p
    left join scored s on s.user_id = p.id
    where p.share_scores = true or p.id = auth.uid()
    group by p.id, p.display_name, p.share_scores
  ),
  me as (select coalesce((select share_scores from cf_profiles where id = auth.uid()), false) as opted)
  select jsonb_build_object(
    'me', (select jsonb_build_object(
        'display_name', display_name, 'ready_count', ready_count,
        'total_scaled', total_scaled, 'badge_count', badge_count, 'per_exam', per_exam,
        'ready_exams', ready_exams)
      from per_user where is_me),
    'opted_in', (select opted from me),
    'team', case when (select opted from me) then (select jsonb_build_object(
        'members', count(*), 'exams_ready', coalesce(sum(ready_count), 0),
        'exams_possible', count(*) * 4, 'badges', coalesce(sum(badge_count), 0))
      from per_user where share_scores) end,
    'roster', case when (select opted from me) then coalesce((select jsonb_agg(jsonb_build_object(
        'display_name', display_name, 'is_me', is_me, 'ready_count', ready_count,
        'total_scaled', total_scaled, 'badge_count', badge_count, 'per_exam', per_exam,
        'ready_exams', ready_exams)
        order by display_name)
      from per_user where share_scores), '[]'::jsonb) else '[]'::jsonb end
  );
$$;

-- ---------------------------------------------------------------- grants
revoke all on function cf_gamification(), cf_report_extras(), cf_leaderboard_week(int),
  cf_choose_quest(text), cf_grade_practice_item(uuid, text, jsonb, int), cf_scoreboard()
  from public, anon;
grant execute on function cf_gamification(), cf_report_extras(), cf_leaderboard_week(int),
  cf_choose_quest(text), cf_grade_practice_item(uuid, text, jsonb, int), cf_scoreboard()
  to authenticated;

insert into cf_migrations (name) values ('2026-10-01-report-gamification-leaderboard')
  on conflict do nothing;

commit;
