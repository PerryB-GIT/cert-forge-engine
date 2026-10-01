-- Cert Forge — per-item CCAR-F scoring, sealed holdout form, fresh-only Readiness
-- 2026-09-25 (regrade top fixes 1 + 2)
--
-- 1. cf_submit_session scores CCAR-F by plain item percent (see comment
--    inline). weighted_pct keeps its column name; for CCAR-F it now holds the
--    unweighted percent.
-- 2. cf_holdout lists items reserved for a single go/no-go sim. They are
--    excluded from full/quick draws and from practice; mode 'holdout' draws
--    exactly that form. Seeded by scripts/seed-holdout.js from
--    fixtures/questions/holdout/<CODE>.json. Kept in its own table so
--    re-seeding cf_questions never clears it.
-- 3. cf_attempts (which drive the Readiness gauge) are written from fresh
--    items only.
-- cf_start_session is otherwise identical to 2026-09-24-seen-tracking.sql;
-- cf_start_practice and cf_submit_session were dumped from the live database
-- today (they were never in version control) and changed only as marked.

begin;

create table if not exists public.cf_holdout (
  question_id text primary key,
  exam_code text not null,
  created_at timestamptz not null default now()
);
alter table public.cf_holdout enable row level security;  -- no policies: server-side only
revoke all on public.cf_holdout from anon, authenticated;

alter table public.cf_exam_sessions drop constraint if exists cf_exam_sessions_mode_check;
alter table public.cf_exam_sessions add constraint cf_exam_sessions_mode_check
  check (mode = any (array['full','quick','holdout']));

create or replace function public.cf_start_session(p_exam text, p_mode text default 'full')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user uuid := auth.uid();
  v_exam cf_exams;
  v_scenarios text[];
  v_qids jsonb;
  v_session cf_exam_sessions;
  v_questions jsonb;
  v_minutes int;
  v_n int;
  v_wsum numeric;
  v_alloc jsonb := '{}'::jsonb;
  v_name text;
  v_rem int;
  v_guard int := 0;
  v_row record;
  v_seen text[];
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  if p_mode not in ('full','quick','holdout') then raise exception 'bad mode %', p_mode; end if;
  select * into v_exam from cf_exams where code = p_exam;
  if not found then raise exception 'unknown exam %', p_exam; end if;

  -- Items this user has already been exposed to: anything in a SUBMITTED sim
  -- (the results page reveals every key), anything answered in practice or
  -- flashcards, and anything the spaced-repetition scheduler has shown.
  select coalesce(array_agg(distinct qid), array[]::text[]) into v_seen
  from (
    select jsonb_array_elements_text(s.question_ids) qid
      from cf_exam_sessions s
     where s.user_id = v_user and s.exam_code = p_exam and s.submitted_at is not null
    union select a.question_id from cf_practice_answers a
     where a.user_id = v_user and a.exam_code = p_exam
    union select r.question_id from cf_item_reviews r
     where r.user_id = v_user and r.exam_code = p_exam and r.times_seen > 0
  ) x;

  if p_mode = 'holdout' then
    -- Sealed go/no-go form: every held-out item for the exam, grouped by
    -- scenario. These items are excluded from every other draw and from
    -- practice, so on a first sitting they are all fresh.
    select jsonb_agg(q.id order by q.scenario nulls last, random()) into v_qids
    from cf_questions q join cf_holdout h on h.question_id = q.id
    where q.exam_code = p_exam;
    if v_qids is null then raise exception 'no holdout form for %', p_exam; end if;
    v_scenarios := null;
    v_minutes := v_exam.minutes;
  elsif p_mode = 'quick' then
    -- 2 per domain, full coverage
    select jsonb_agg(id) into v_qids from (
      select id from (
        select id, row_number() over (partition by domain_name order by (id = any(v_seen)), random()) rn
        from cf_questions where exam_code = p_exam
          and id not in (select question_id from cf_holdout)
      ) t where rn <= 2 order by random()
    ) q;
    v_scenarios := null;
    v_n := jsonb_array_length(v_qids);
    v_minutes := greatest(10, ceil(v_n * 1.5)::int);  -- 90s/item
  elsif p_exam = 'CCAR-F' then
    select array_agg(s) into v_scenarios
    from (select distinct scenario as s from cf_questions where exam_code = p_exam and scenario is not null
          order by 1) all_s;
    -- Take the 4 scenarios with the most items this user has NOT seen (random
    -- among ties). With a 60-item holdout each scenario keeps only 20 practice
    -- items, and a random pick could repeat 40 of 60 on a second sim; this
    -- caps it at ~10. A first sim (nothing seen) is still a uniform random 4.
    select array_agg(s) into v_scenarios
    from (
      select sc.s
      from unnest(v_scenarios) as sc(s)
      order by (select count(*) from cf_questions q
                 where q.exam_code = p_exam and q.scenario = sc.s
                   and q.id not in (select question_id from cf_holdout)
                   and not (q.id = any(v_seen))) desc,
               random()
      limit 4
    ) pick;
    -- v_exam.items / 4 = 15 per scenario (60-item exam, 4 scenarios). Within a
    -- scenario, apportion across its domains in proportion to that scenario's
    -- bank mix (Webster/Sainte-Lague: rank each domain's shuffled items by
    -- (rn - 0.5) / domain_bank_size, take the lowest 15), so a 30-item scenario
    -- yields the same domain shape the 15-item one did, with fresh items.
    select jsonb_agg(t.id order by array_position(v_scenarios, t.scenario), t.slot) into v_qids
    from (
      select r.id, r.scenario,
             row_number() over (partition by r.scenario order by r.prio, random()) slot
      from (
        select q.id, q.scenario,
               (row_number() over (partition by q.scenario, q.domain_name order by (q.id = any(v_seen)), random()) - 0.5)
                 / count(*) over (partition by q.scenario, q.domain_name) prio
        from cf_questions q
        where q.exam_code = p_exam and q.scenario = any(v_scenarios)
          and q.id not in (select question_id from cf_holdout)
      ) r
    ) t
    where t.slot <= v_exam.items / 4;
    v_minutes := v_exam.minutes;
  else
    -- Stratified draw, apportioned across cf_domains by blueprint weight.
    select sum(weight) into v_wsum from cf_domains where exam_code = p_exam;
    if v_wsum is null or v_wsum <= 0 then
      raise exception 'no domain weights for %', p_exam;
    end if;

    -- Base allocation: floor of the weighted quota, floored at 1 so no domain
    -- can vanish from the score, capped at what the bank can actually supply.
    for v_row in
      select d.name,
             c.avail,
             least(c.avail, greatest(1, floor(d.weight / v_wsum * v_exam.items)::int)) as n
      from cf_domains d
      join lateral (
        select count(*)::int as avail from cf_questions q
        where q.exam_code = p_exam and q.domain_name = d.name
      ) c on true
      where d.exam_code = p_exam
    loop
      if v_row.avail = 0 then
        raise exception 'blueprint domain % has no questions for %', v_row.name, p_exam;
      end if;
      v_alloc := v_alloc || jsonb_build_object(v_row.name, v_row.n);
    end loop;

    -- Largest-remainder pass. Hand the shortfall to whichever domain is
    -- furthest below its quota and still has bank headroom; claw any surplus
    -- back from whichever is furthest above, never below the floor of 1.
    v_rem := v_exam.items - (select coalesce(sum(value::int), 0) from jsonb_each_text(v_alloc));

    while v_rem > 0 and v_guard < 500 loop
      v_guard := v_guard + 1;
      select d.name into v_name
        from cf_domains d
        join lateral (
          select count(*)::int as avail from cf_questions q
          where q.exam_code = p_exam and q.domain_name = d.name
        ) c on true
       where d.exam_code = p_exam
         and c.avail > coalesce((v_alloc ->> d.name)::int, 0)
       order by (d.weight / v_wsum * v_exam.items) - coalesce((v_alloc ->> d.name)::int, 0) desc,
                random()
       limit 1;
      exit when v_name is null;  -- every domain is at bank capacity
      v_alloc := jsonb_set(v_alloc, array[v_name],
                           to_jsonb(coalesce((v_alloc ->> v_name)::int, 0) + 1));
      v_rem := v_rem - 1;
    end loop;

    while v_rem < 0 and v_guard < 500 loop
      v_guard := v_guard + 1;
      select d.name into v_name
        from cf_domains d
       where d.exam_code = p_exam
         and coalesce((v_alloc ->> d.name)::int, 0) > 1
       order by coalesce((v_alloc ->> d.name)::int, 0) - (d.weight / v_wsum * v_exam.items) desc,
                random()
       limit 1;
      exit when v_name is null;
      v_alloc := jsonb_set(v_alloc, array[v_name],
                           to_jsonb((v_alloc ->> v_name)::int - 1));
      v_rem := v_rem + 1;
    end loop;

    -- Draw the allocated number per domain, then shuffle across domains so the
    -- delivered order is not clustered by domain.
    select jsonb_agg(t.id order by random()) into v_qids
    from (
      select q.id, q.domain_name,
             row_number() over (partition by q.domain_name order by (q.id = any(v_seen)), random()) rn
      from cf_questions q
      where q.exam_code = p_exam
        and q.id not in (select question_id from cf_holdout)
    ) t
    where t.rn <= coalesce((v_alloc ->> t.domain_name)::int, 0);

    v_minutes := v_exam.minutes;
  end if;

  if v_qids is null or jsonb_array_length(v_qids) = 0 then
    raise exception 'question bank empty for %', p_exam;
  end if;

  insert into cf_exam_sessions (user_id, exam_code, mode, question_ids, scenario_set, fresh_ids, expires_at)
  values (v_user, p_exam, p_mode, v_qids, to_jsonb(v_scenarios),
          (select coalesce(jsonb_agg(e), '[]'::jsonb)
             from jsonb_array_elements_text(v_qids) e where not (e = any(v_seen))),
          now() + make_interval(mins => v_minutes))
  returning * into v_session;

  select jsonb_agg(jsonb_build_object(
    'id', q.id, 'domain', q.domain_name, 'scenario', q.scenario,
    'stem', q.stem, 'options', q.options, 'multi', q.multi, 'select_count', q.select_count
  ) order by ord.n) into v_questions
  from cf_questions q
  join lateral (
    select n from jsonb_array_elements_text(v_session.question_ids) with ordinality t(qid, n)
    where t.qid = q.id
  ) ord on true
  where q.id in (select jsonb_array_elements_text(v_session.question_ids));

  return jsonb_build_object(
    'session_id', v_session.id, 'exam_code', p_exam, 'mode', p_mode,
    'started_at', v_session.started_at, 'expires_at', v_session.expires_at,
    'minutes', v_minutes, 'scenarios', v_session.scenario_set, 'questions', v_questions
  );
end;
$function$;

create or replace function public.cf_start_practice(p_exam text, p_size integer DEFAULT 15)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user uuid := auth.uid();
  v_ids jsonb;
  v_pid uuid;
  v_questions jsonb;
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from cf_exams where code = p_exam) then
    raise exception 'unknown exam %', p_exam;
  end if;
  p_size := least(greatest(coalesce(p_size, 15), 1), 40);

  select jsonb_agg(id) into v_ids from (
    select q.id
    from cf_questions q
    left join cf_item_reviews r on r.user_id = v_user and r.question_id = q.id
    where q.exam_code = p_exam
      and q.id not in (select question_id from cf_holdout)
    order by
      case
        when r.question_id is not null and r.due_at <= now() then 0  -- due for review
        when r.question_id is null then 1                            -- never seen
        else 2                                                       -- seen, not yet due
      end,
      -- Weakest first within a tier. Unseen items have no ratio, so they all
      -- score 1 and stay flat relative to each other (random breaks the tie).
      coalesce(r.times_correct::numeric / nullif(r.times_seen, 0), 1) asc,
      -- Longest-overdue first among due items; soonest-due first among the rest.
      coalesce(r.due_at, now()) asc,
      random()
    limit p_size
  ) s;

  if v_ids is null then raise exception 'no questions for %', p_exam; end if;

  insert into cf_practice_sessions (user_id, exam_code, question_ids)
  values (v_user, p_exam, v_ids) returning id into v_pid;

  select jsonb_agg(jsonb_build_object(
    'id', q.id, 'domain', q.domain_name, 'scenario', q.scenario,
    'stem', q.stem, 'options', q.options, 'multi', q.multi, 'select_count', q.select_count
  ) order by ord.n) into v_questions
  from cf_questions q
  join lateral (
    select n from jsonb_array_elements_text(v_ids) with ordinality t(qid, n) where t.qid = q.id
  ) ord on true;

  return jsonb_build_object('practice_id', v_pid, 'exam_code', p_exam, 'questions', v_questions);
end;
$function$;

create or replace function public.cf_submit_session(p_session uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v cf_exam_sessions;
  v_domain_scores jsonb;
  v_weighted numeric;
  v_scaled int;
  v_passed boolean;
  v_review jsonb;
  r record;
begin
  select * into v from cf_exam_sessions where id = p_session and user_id = auth.uid();
  if not found then raise exception 'session not found'; end if;

  if v.submitted_at is not null then
    return jsonb_build_object(
      'session_id', v.id, 'exam_code', v.exam_code, 'mode', v.mode, 'already_submitted', true,
      'scaled_score', v.scaled_score, 'weighted_pct', v.weighted_pct,
      'passed', v.passed, 'domain_scores', v.domain_scores);
  end if;

  create temp table _graded on commit drop as
  select q.id, q.domain_name, q.scenario, q.stem, q.options, q.correct, q.rationale, q.tip,
         q.multi, q.select_count,
         coalesce(v.answers -> q.id, 'null'::jsonb) as ans,
         (
           (v.answers ? q.id)
           and (select coalesce(array_agg(t.v::int order by t.v::int), array[]::int[])
                from jsonb_array_elements_text(v.answers -> q.id) t(v))
             = (select coalesce(array_agg(t.v::int order by t.v::int), array[]::int[])
                from jsonb_array_elements_text(q.correct) t(v))
         ) as ok
  from cf_questions q
  where q.id in (select jsonb_array_elements_text(v.question_ids));

  select jsonb_object_agg(domain_name, jsonb_build_object(
           'correct', c_ok, 'total', c_all, 'pct', round(100.0 * c_ok / c_all, 1)))
  into v_domain_scores
  from (select domain_name, count(*) filter (where ok) as c_ok, count(*) as c_all
        from _graded group by domain_name) d;

  select sum((100.0 * d.c_ok / d.c_all) * dom.weight) / sum(dom.weight)
  into v_weighted
  from (select domain_name, count(*) filter (where ok) as c_ok, count(*) as c_all
        from _graded group by domain_name) d
  join cf_domains dom on dom.exam_code = v.exam_code and dom.name = d.domain_name;

  -- CCAR-F: score by plain item percent. Its 4-of-6 scenario draw can leave a
  -- 20%-weight domain with 2 items, and blueprint weighting then made each of
  -- those items worth ~90 scaled points. Per-item scoring is also the more
  -- likely model of the real exam. Other exams keep blueprint weighting: their
  -- stratified draw already mirrors the weights, so the two nearly coincide.
  if v.exam_code = 'CCAR-F' then
    select 100.0 * count(*) filter (where ok) / count(*) into v_weighted from _graded;
  end if;

  v_scaled := round(100 + (v_weighted / 100.0) * 900)::int;
  v_passed := v_scaled >= 720;

  select jsonb_agg(jsonb_build_object(
    'id', g.id, 'domain', g.domain_name, 'scenario', g.scenario, 'stem', g.stem,
    'options', g.options, 'your_answer', g.ans, 'correct', g.correct, 'is_correct', g.ok,
    'rationale', g.rationale, 'tip', g.tip, 'multi', g.multi
  ) order by ord.n)
  into v_review
  from _graded g
  join lateral (
    select n from jsonb_array_elements_text(v.question_ids) with ordinality t(qid, n)
    where t.qid = g.id
  ) ord on true;

  update cf_exam_sessions
  set submitted_at = now(), weighted_pct = round(v_weighted, 2),
      scaled_score = v_scaled, domain_scores = v_domain_scores, passed = v_passed
  where id = p_session;

  if v.mode in ('full','holdout') then
    -- Readiness is fed from FRESH items only (unseen when drawn), so a sim full
    -- of repeats cannot push the Readiness gauge up. Sessions from before
    -- tracking (fresh_ids null) count every item, as before.
    for r in select domain_name, count(*) filter (where ok) as c_ok, count(*) as c_all
             from _graded
             where v.fresh_ids is null
                or id in (select jsonb_array_elements_text(v.fresh_ids))
             group by domain_name
    loop
      insert into cf_attempts (user_id, exam_code, domain_name, pct_correct, source)
      values (v.user_id, v.exam_code, r.domain_name, round(100.0 * r.c_ok / r.c_all, 1), 'simulation');
    end loop;

    insert into cf_chronicle (user_id, event_type, exam_code, body)
    values (v.user_id, 'sim_completed', v.exam_code,
      format('%s %s exam %s - scaled %s (%s)',
             case when v.mode = 'holdout' then 'Go/no-go' else 'Full' end, v.exam_code,
             case when v_passed then 'PASSED' else 'completed' end,
             v_scaled, case when v_passed then 'at or above the 720 cut' else 'below the 720 cut' end));
  else
    insert into cf_chronicle (user_id, event_type, exam_code, body)
    values (v.user_id, 'quick_completed', v.exam_code,
      format('Quick test on %s - scaled %s (%s items, %s)', v.exam_code, v_scaled,
             (select count(*) from _graded),
             case when v_passed then 'on track' else 'below the 720 cut' end));
  end if;

  return jsonb_build_object(
    'session_id', v.id, 'exam_code', v.exam_code, 'mode', v.mode,
    'scaled_score', v_scaled, 'weighted_pct', round(v_weighted, 2), 'passed', v_passed,
    'domain_scores', v_domain_scores, 'proctor_events', v.proctor_events, 'review', v_review);
end;
$function$;

commit;
