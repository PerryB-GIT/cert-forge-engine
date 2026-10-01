-- Cert Forge — seen-question tracking + fresh-item score
-- 2026-09-24
--
-- Problem (review 2026-09-24): nothing tracked which items a user had already
-- seen. The results page reveals every key, so after a couple of sims a new sim
-- measured recall of answers, not readiness.
--
-- 1. cf_start_session computes the user's seen set (submitted sims + practice
--    answers + scheduler reviews) and, in every draw mode, ranks unseen items
--    ahead of seen ones WITHIN each domain (and scenario, for CCAR-F). The
--    domain/scenario apportionment is unchanged -- only which items fill each
--    slot changes. Everything else is identical to
--    2026-09-24-ccar-f-per-scenario-cap.sql.
-- 2. The ids that were unseen at draw time are stored in
--    cf_exam_sessions.fresh_ids (null for sessions created before this).
-- 3. cf_session_review returns fresh_ids so the results page can report a
--    score over fresh items only -- the number to trust for go/no-go.

begin;

alter table public.cf_exam_sessions add column if not exists fresh_ids jsonb;

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
  if p_mode not in ('full','quick') then raise exception 'bad mode %', p_mode; end if;
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

  if p_mode = 'quick' then
    -- 2 per domain, full coverage
    select jsonb_agg(id) into v_qids from (
      select id from (
        select id, row_number() over (partition by domain_name order by (id = any(v_seen)), random()) rn
        from cf_questions where exam_code = p_exam
      ) t where rn <= 2 order by random()
    ) q;
    v_scenarios := null;
    v_n := jsonb_array_length(v_qids);
    v_minutes := greatest(10, ceil(v_n * 1.5)::int);  -- 90s/item
  elsif p_exam = 'CCAR-F' then
    select array_agg(s) into v_scenarios
    from (select distinct scenario as s from cf_questions where exam_code = p_exam and scenario is not null
          order by 1) all_s;
    select array_agg(s) into v_scenarios
    from (select unnest(v_scenarios) as s order by random() limit 4) pick;
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

revoke execute on function public.cf_start_session(text, text) from anon;

CREATE OR REPLACE FUNCTION public.cf_session_review(p_session uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v cf_exam_sessions;
  v_review jsonb;
begin
  select * into v from cf_exam_sessions where id = p_session and user_id = auth.uid();
  if not found then raise exception 'session not found'; end if;
  if v.submitted_at is null then raise exception 'session not submitted'; end if;

  select jsonb_agg(jsonb_build_object(
    'id', q.id, 'domain', q.domain_name, 'scenario', q.scenario, 'stem', q.stem,
    'options', q.options, 'your_answer', coalesce(v.answers -> q.id, 'null'::jsonb),
    'correct', q.correct, 'rationale', q.rationale, 'tip', q.tip, 'multi', q.multi,
    'is_correct', (
      (v.answers ? q.id)
      and (select coalesce(array_agg(t.v::int order by t.v::int), array[]::int[])
           from jsonb_array_elements_text(v.answers -> q.id) t(v))
        = (select coalesce(array_agg(t.v::int order by t.v::int), array[]::int[])
           from jsonb_array_elements_text(q.correct) t(v))
    )
  ) order by ord.n)
  into v_review
  from cf_questions q
  join lateral (
    select n from jsonb_array_elements_text(v.question_ids) with ordinality t(qid, n)
    where t.qid = q.id
  ) ord on true
  where q.id in (select jsonb_array_elements_text(v.question_ids));

  return jsonb_build_object(
    'session_id', v.id, 'exam_code', v.exam_code, 'mode', v.mode, 'submitted_at', v.submitted_at,
    'scaled_score', v.scaled_score, 'weighted_pct', v.weighted_pct, 'passed', v.passed,
    'domain_scores', v.domain_scores, 'proctor_events', v.proctor_events, 'review', v_review,
    'fresh_ids', v.fresh_ids);
end;
$function$;

commit;
