-- Cert Forge — missed-answer bank, flashcards, practice analytics
-- 2026-08-05
--
-- Problem this fixes: cf_grade_practice_item updated aggregate counters on
-- cf_item_reviews and returned feedback to the client, but never persisted WHICH
-- answer the user gave. Exam-sim misses are reconstructible from
-- cf_exam_sessions.answers; practice misses were simply gone once the player
-- advanced. cf_practice_answers is the missing primary record.
--
-- Security invariant preserved throughout: cf_questions has RLS with zero
-- policies, so answers only ever leave the DB through a SECURITY DEFINER
-- function, and only for questions the caller has already answered.

begin;

-- ---------------------------------------------------------------------------
-- 1. cf_practice_answers — append-only log of every graded practice / flashcard
-- ---------------------------------------------------------------------------
create table if not exists cf_practice_answers (
  id            bigserial primary key,
  user_id       uuid        not null references auth.users(id) on delete cascade,
  practice_id   uuid        references cf_practice_sessions(id) on delete set null,
  question_id   text        not null references cf_questions(id) on delete cascade,
  exam_code     text        not null,
  domain_name   text        not null,
  answer        jsonb,                        -- null for flashcards (self-graded)
  is_correct    boolean     not null,
  source        text        not null check (source in ('practice', 'flashcard')),
  answered_at   timestamptz not null default now()
);

create index if not exists cf_practice_answers_user_exam_idx
  on cf_practice_answers (user_id, exam_code, is_correct);
create index if not exists cf_practice_answers_user_question_idx
  on cf_practice_answers (user_id, question_id, answered_at desc);

alter table cf_practice_answers enable row level security;

-- Read-your-own only. No insert/update/delete policy exists on purpose: rows are
-- written exclusively by the SECURITY DEFINER functions below, so the log stays
-- append-only and un-forgeable from the client.
drop policy if exists cf_practice_answers_select_own on cf_practice_answers;
create policy cf_practice_answers_select_own on cf_practice_answers
  for select using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- 2. cf_grade_practice_item — unchanged behaviour, plus the answer log
-- ---------------------------------------------------------------------------
-- Identical to the verified 2026-07-15 version except: (a) one insert into
-- cf_practice_answers, (b) the dead v_first variable is dropped (it was assigned
-- and never read). Return shape is unchanged, so PracticePlayer needs no edit.
create or replace function public.cf_grade_practice_item(
  p_practice uuid, p_question_id text, p_answer jsonb
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
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

  -- NEW: durable record of what was actually answered, so the missed-item bank
  -- and the Report Card can reconstruct practice history.
  insert into cf_practice_answers
    (user_id, practice_id, question_id, exam_code, domain_name, answer, is_correct, source)
  values (v_user, p_practice, p_question_id, q.exam_code, q.domain_name, p_answer, v_ok, 'practice');

  update cf_practice_sessions
  set answered_count = answered_count + 1,
      correct_count = correct_count + case when v_ok then 1 else 0 end
  where id = p_practice;

  return jsonb_build_object(
    'is_correct', v_ok, 'correct', q.correct, 'rationale', q.rationale, 'tip', q.tip,
    'box', v_box, 'next_review', (now() + cf_box_interval(v_box)));
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3. cf_flashcard_grade — self-graded recall on an ALREADY-REVEALED question
-- ---------------------------------------------------------------------------
-- Gate: the caller must have already answered this question (practice log, item
-- review, or a submitted sim). Without that gate, flashcards would become a way
-- to read cf_questions.correct out of the bank one card at a time.
--
-- Leitner cap: self-report advances the box by at most 1 and never past 3. Only
-- genuinely graded practice can reach boxes 4-5, which keeps the Report Card's
-- "retention" metric honest against optimistic self-grading.
create or replace function public.cf_flashcard_grade(
  p_question_id text, p_got_it boolean
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_user uuid := auth.uid();
  q      cf_questions;
  v_box  int;
begin
  if v_user is null then raise exception 'not authenticated'; end if;

  select * into q from cf_questions where id = p_question_id;
  if not found then raise exception 'unknown question'; end if;

  if not (
    exists (select 1 from cf_item_reviews r
             where r.user_id = v_user and r.question_id = p_question_id)
    or exists (select 1 from cf_exam_sessions s
                where s.user_id = v_user and s.submitted_at is not null
                  and s.question_ids ? p_question_id)
  ) then
    raise exception 'question has not been answered yet - flashcards only drill revealed items';
  end if;

  insert into cf_item_reviews as ir (user_id, question_id, exam_code, box, reps, lapses,
                                     times_seen, times_correct, last_seen, due_at)
  values (v_user, p_question_id, q.exam_code,
          case when p_got_it then 1 else 0 end,
          0, case when p_got_it then 0 else 1 end,
          0, 0, now(),
          now() + cf_box_interval(case when p_got_it then 1 else 0 end))
  on conflict (user_id, question_id) do update set
    box = case when p_got_it then least(3, ir.box + 1) else 0 end,
    lapses = ir.lapses + case when p_got_it then 0 else 1 end,
    last_seen = now(),
    due_at = now() + cf_box_interval(case when p_got_it then least(3, ir.box + 1) else 0 end)
  returning box into v_box;

  -- Logged with answer = null: a self-graded recall is not a scored response.
  -- times_seen / times_correct on cf_item_reviews are deliberately NOT touched,
  -- so measured practice accuracy stays measured.
  insert into cf_practice_answers
    (user_id, question_id, exam_code, domain_name, answer, is_correct, source)
  values (v_user, p_question_id, q.exam_code, q.domain_name, null, p_got_it, 'flashcard');

  return jsonb_build_object(
    'box', v_box, 'next_review', (now() + cf_box_interval(v_box)), 'capped_at', 3);
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4. cf_finish_flashcards — chronicle entry so flashcard days count as study days
-- ---------------------------------------------------------------------------
-- cf_chronicle.event_type is a closed CHECK list; a new event type has to be
-- admitted before anything can write it.
alter table cf_chronicle drop constraint if exists cf_chronicle_event_type_check;
alter table cf_chronicle add constraint cf_chronicle_event_type_check
  check (event_type = any (array[
    'score_logged', 'crossed_up', 'crossed_down', 'badge_earned',
    'sim_completed', 'quick_completed', 'practice_completed', 'flashcards_completed'
  ]));

-- Counts are derived server-side from the log rather than passed in by the
-- client, so the chronicle can't be inflated.
create or replace function public.cf_finish_flashcards(
  p_exam text, p_since timestamptz
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_user uuid := auth.uid();
  v_reviewed int;
  v_got int;
begin
  if v_user is null then raise exception 'not authenticated'; end if;

  select count(*), count(*) filter (where is_correct)
    into v_reviewed, v_got
  from cf_practice_answers
  where user_id = v_user and exam_code = p_exam and source = 'flashcard'
    and answered_at >= greatest(p_since, now() - interval '12 hours');

  if v_reviewed > 0 then
    insert into cf_chronicle (user_id, event_type, exam_code, body)
    values (v_user, 'flashcards_completed', p_exam,
      format('Flashcard drill on %s - recalled %s of %s missed items',
             p_exam, v_got, v_reviewed));
  end if;

  return jsonb_build_object('reviewed', v_reviewed, 'got_it', v_got);
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5. cf_missed_items — every item ever missed, from sims AND practice
-- ---------------------------------------------------------------------------
-- Only returns questions the caller has already answered, so no new answer
-- content is exposed beyond what they were already shown post-grade.
create or replace function public.cf_missed_items(p_exam text default null)
returns jsonb
language sql security definer set search_path to 'public'
as $function$
with ev as (
  -- Exam simulations and quick tests, submitted only. Iterate the SERVED item
  -- set (question_ids) rather than the answer map, so items left blank are
  -- counted as missed - which is exactly how they were scored.
  select t.qid                          as question_id,
         s.exam_code,
         s.answers -> t.qid             as answer,
         coalesce(
           (select coalesce(array_agg(x.v::int order by x.v::int), array[]::int[])
              from jsonb_array_elements_text(s.answers -> t.qid) x(v))
           = (select coalesce(array_agg(x.v::int order by x.v::int), array[]::int[])
              from jsonb_array_elements_text(q.correct) x(v)),
           false)                       as is_correct,
         s.submitted_at                 as at,
         s.mode                         as source,          -- 'full' | 'quick'
         (s.answers -> t.qid) is null   as unanswered
  from cf_exam_sessions s
  cross join lateral jsonb_array_elements_text(s.question_ids) t(qid)
  join cf_questions q on q.id = t.qid
  where s.user_id = auth.uid()
    and s.submitted_at is not null
    and (p_exam is null or s.exam_code = p_exam)

  union all

  select pa.question_id, pa.exam_code, pa.answer, pa.is_correct,
         pa.answered_at, pa.source, false
  from cf_practice_answers pa
  where pa.user_id = auth.uid()
    and (p_exam is null or pa.exam_code = p_exam)
),
last_ev as (
  select distinct on (question_id) question_id, is_correct as last_correct, at as last_at
  from ev order by question_id, at desc
),
last_wrong as (
  select distinct on (question_id)
         question_id, answer as last_wrong_answer, at as last_missed_at,
         source as last_missed_source, unanswered as last_unanswered
  from ev where not is_correct order by question_id, at desc
),
agg as (
  select question_id,
         count(*) filter (where not is_correct) as times_missed,
         count(*)                               as times_answered,
         array_agg(distinct source) filter (where not is_correct) as sources
  from ev
  group by question_id
  having count(*) filter (where not is_correct) > 0
)
select coalesce(
  jsonb_agg(x.item order by x.domain_name, x.times_missed desc, x.question_id),
  '[]'::jsonb)
from (
  select q.domain_name, a.times_missed, a.question_id,
    jsonb_build_object(
      'id',                q.id,
      'exam_code',         q.exam_code,
      'domain',            q.domain_name,
      'scenario',          q.scenario,
      'stem',              q.stem,
      'options',           q.options,
      'correct',           q.correct,
      'multi',             q.multi,
      'select_count',      q.select_count,
      'rationale',         q.rationale,
      'tip',               q.tip,
      'times_missed',      a.times_missed,
      'times_answered',    a.times_answered,
      'sources',           to_jsonb(a.sources),
      'last_missed_at',    lw.last_missed_at,
      'last_missed_source', lw.last_missed_source,
      'last_wrong_answer', lw.last_wrong_answer,
      'last_unanswered',   coalesce(lw.last_unanswered, false),
      'box',               coalesce(r.box, 0),
      'times_seen',        coalesce(r.times_seen, 0),
      'times_correct',     coalesce(r.times_correct, 0),
      'due_at',            r.due_at,
      -- 'recovered' = the last time you touched it you got it right AND spaced
      -- review has it at least two boxes deep. Anything else is still a worklist item.
      'status', case when coalesce(le.last_correct, false) and coalesce(r.box, 0) >= 2
                     then 'recovered' else 'shaky' end
    ) as item
  from agg a
  join cf_questions q on q.id = a.question_id
  left join cf_item_reviews r on r.user_id = auth.uid() and r.question_id = a.question_id
  left join last_ev    le on le.question_id = a.question_id
  left join last_wrong lw on lw.question_id = a.question_id
) x;
$function$;

-- ---------------------------------------------------------------------------
-- 6. cf_practice_stats — practice history for the Report Card
-- ---------------------------------------------------------------------------
-- 'practice' rows are measured (the user picked options and was graded).
-- 'flashcard' rows are self-reported and are counted separately, never folded
-- into the accuracy number.
create or replace function public.cf_practice_stats()
returns jsonb
language sql security definer set search_path to 'public'
as $function$
with pa as (
  select * from cf_practice_answers where user_id = auth.uid()
),
graded as (select * from pa where source = 'practice')
select coalesce(jsonb_object_agg(e.code, jsonb_build_object(
  'sessions', (select count(*) from cf_practice_sessions ps
                where ps.user_id = auth.uid() and ps.exam_code = e.code),
  'answered', (select count(*) from graded g where g.exam_code = e.code),
  'correct',  (select count(*) from graded g where g.exam_code = e.code and g.is_correct),
  'accuracy', (select round(100.0 * count(*) filter (where g.is_correct) / nullif(count(*), 0))
                 from graded g where g.exam_code = e.code),
  'distinct_items', (select count(distinct g.question_id) from graded g where g.exam_code = e.code),
  'missed_items',   (select count(distinct g.question_id) from graded g
                      where g.exam_code = e.code and not g.is_correct),
  'flashcards_reviewed', (select count(*) from pa f
                           where f.exam_code = e.code and f.source = 'flashcard'),
  'due', (select count(*) from cf_item_reviews r
           where r.user_id = auth.uid() and r.exam_code = e.code and r.due_at <= now()),
  'domains', coalesce((
    select jsonb_agg(jsonb_build_object(
             'domain', d.domain_name,
             'answered', d.answered,
             'correct', d.correct,
             'accuracy', round(100.0 * d.correct / nullif(d.answered, 0)),
             'missed', d.missed
           ) order by d.domain_name)
    from (
      select g.domain_name,
             count(*) as answered,
             count(*) filter (where g.is_correct) as correct,
             count(distinct g.question_id) filter (where not g.is_correct) as missed
      from graded g where g.exam_code = e.code group by g.domain_name
    ) d), '[]'::jsonb),
  'recent', coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', s.id, 'at', s.started_at,
             'answered', s.answered_count, 'correct', s.correct_count
           ) order by s.started_at desc)
    from (
      select * from cf_practice_sessions ps
      where ps.user_id = auth.uid() and ps.exam_code = e.code and ps.answered_count > 0
      order by ps.started_at desc limit 10
    ) s), '[]'::jsonb),
  'daily', coalesce((
    select jsonb_agg(jsonb_build_object(
             'day', t.day, 'answered', t.answered, 'correct', t.correct,
             'accuracy', round(100.0 * t.correct / nullif(t.answered, 0))
           ) order by t.day)
    from (
      select (g.answered_at at time zone 'America/New_York')::date as day,
             count(*) as answered,
             count(*) filter (where g.is_correct) as correct
      from graded g where g.exam_code = e.code group by 1
    ) t), '[]'::jsonb)
)), '{}'::jsonb)
from cf_exams e;
$function$;

-- ---------------------------------------------------------------------------
-- 7. cf_study_activity — count flashcard drills as study days
-- ---------------------------------------------------------------------------
-- Unchanged from the 2026-07-15 version except that 'flashcards_completed' joins
-- the effort-event list in both places.
create or replace function public.cf_study_activity()
returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_user uuid := auth.uid();
  v_today date := (now() at time zone 'America/New_York')::date;
  v_current int := 0;
  v_best int := 0;
  v_total int := 0;
  v_last date;
  v_days jsonb;
begin
  if v_user is null then raise exception 'not authenticated'; end if;

  create temp table _days on commit drop as
  select distinct (created_at at time zone 'America/New_York')::date as d
  from cf_chronicle
  where user_id = v_user
    and event_type in ('score_logged','sim_completed','quick_completed',
                       'practice_completed','flashcards_completed');

  select count(*), max(d) into v_total, v_last from _days;

  if v_total > 0 then
    -- gaps-and-islands: consecutive dates share (d - rownum days)
    with ord as (select d, row_number() over (order by d) rn from _days),
    grp as (select d, d - (rn || ' days')::interval as g from ord),
    runs as (select count(*)::int as len, max(d) as end_d from grp group by g)
    select coalesce(max(len), 0),
           coalesce((select len from runs where end_d >= v_today - 1 order by end_d desc limit 1), 0)
    into v_best, v_current from runs;
  end if;

  select coalesce(jsonb_object_agg(dd::text, cnt), '{}'::jsonb) into v_days
  from (
    select (created_at at time zone 'America/New_York')::date as dd, count(*) as cnt
    from cf_chronicle
    where user_id = v_user
      and event_type in ('score_logged','sim_completed','quick_completed',
                         'practice_completed','flashcards_completed')
      and created_at >= now() - interval '80 days'
    group by 1
  ) t;

  return jsonb_build_object(
    'current', v_current, 'best', v_best, 'total_days', v_total,
    'last_active', v_last, 'today', v_today, 'days', v_days);
end;
$function$;

-- ---------------------------------------------------------------------------
-- 8. Grants — authenticated only, never anon (matches every other cf_ function)
-- ---------------------------------------------------------------------------
revoke execute on function public.cf_flashcard_grade(text, boolean) from public, anon;
revoke execute on function public.cf_finish_flashcards(text, timestamptz) from public, anon;
revoke execute on function public.cf_missed_items(text) from public, anon;
revoke execute on function public.cf_practice_stats() from public, anon;

grant execute on function public.cf_flashcard_grade(text, boolean) to authenticated, service_role;
grant execute on function public.cf_finish_flashcards(text, timestamptz) to authenticated, service_role;
grant execute on function public.cf_missed_items(text) to authenticated, service_role;
grant execute on function public.cf_practice_stats() to authenticated, service_role;

-- Supabase's default privileges hand anon full DML on new public tables and rely
-- on RLS alone. Anonymous sign-in issues an `authenticated` JWT, so the anon role
-- is only ever the pre-login publishable key here - it has no business touching
-- this table at all. Revoke outright rather than leaning on RLS twice.
revoke all on cf_practice_answers from anon;
revoke insert, update, delete, truncate on cf_practice_answers from authenticated;
grant select on cf_practice_answers to authenticated;

commit;
