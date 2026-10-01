-- Stratified full-mode sim draw.
--
-- Problem. The full-mode draw for non-scenario exams was:
--
--     select id from cf_questions where exam_code = p_exam order by random() limit v_exam.items
--
-- a flat random sample that ignores cf_domains entirely. Scoring, however, is
-- domain-weighted: weightedPct = sum(domainPct * weight) / sum(weight of the
-- domains actually LOGGED (src/lib/scoring.ts). A domain that draws zero items
-- does not score zero -- it drops out of the denominator, so the blueprint is
-- silently reweighted and the candidate sits a different exam from the one the
-- report card claims they sat.
--
-- Measured over 20,000 simulated draws against the live bank:
--
--     CCAO-F   0.0% of sims missing >=1 domain
--     CCAR-P   0.2%   (Developer Productivity, 7% weight, 8 items in bank)
--     CCDV-F  29.1%   (Eval/Testing/Debugging 2.6% weight and only 2 in bank
--                      accounts for 24.4% on its own; Claude Code 5.9%)
--     CCAR-F   0.0%   scenario-based draw, left unchanged -- see below
--
-- Fix. Apportion the item count across the blueprint domains by weight, using
-- largest-remainder (Hamilton) with two constraints:
--
--   * every domain gets at least 1 item -- this is the property that actually
--     matters, since a domain's WEIGHT in the score is fixed by the blueprint
--     and does not depend on how many items it drew. Allocation size only
--     controls how precisely that domain's percentage is estimated.
--   * no domain is allocated more items than its bank holds; the remainder
--     redistributes to domains that still have headroom.
--
-- CCAR-F is deliberately untouched: it draws 4 of 6 fixed 15-item scenarios,
-- which is how that exam is actually structured, and it never drops a domain
-- (0.0% over 20,000 draws). Quick mode is also untouched -- it already takes
-- 2 per domain, which is full coverage by construction.
--
-- A blueprint domain with an empty bank now raises instead of being silently
-- skipped. src/lib/question-bank.test.ts gates against that ever shipping.
--
-- This migration also checks the whole function into version control for the
-- first time; it previously existed only in the live database.

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
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  if p_mode not in ('full','quick') then raise exception 'bad mode %', p_mode; end if;
  select * into v_exam from cf_exams where code = p_exam;
  if not found then raise exception 'unknown exam %', p_exam; end if;

  if p_mode = 'quick' then
    -- 2 per domain, full coverage
    select jsonb_agg(id) into v_qids from (
      select id from (
        select id, row_number() over (partition by domain_name order by random()) rn
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
    select jsonb_agg(id) into v_qids from (
      select id from cf_questions
      where exam_code = p_exam and scenario = any(v_scenarios)
      order by array_position(v_scenarios, scenario), random()
    ) q;
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
             row_number() over (partition by q.domain_name order by random()) rn
      from cf_questions q
      where q.exam_code = p_exam
    ) t
    where t.rn <= coalesce((v_alloc ->> t.domain_name)::int, 0);

    v_minutes := v_exam.minutes;
  end if;

  if v_qids is null or jsonb_array_length(v_qids) = 0 then
    raise exception 'question bank empty for %', p_exam;
  end if;

  insert into cf_exam_sessions (user_id, exam_code, mode, question_ids, scenario_set, expires_at)
  values (v_user, p_exam, p_mode, v_qids, to_jsonb(v_scenarios),
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
