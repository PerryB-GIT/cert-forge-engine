-- Cert Forge — cap the CCAR-F scenario draw at 15 items per scenario
-- 2026-09-24
--
-- The CCAR-F branch of cf_start_session took EVERY item of the 4 drawn
-- scenarios. That was exactly 60 while each scenario held 15 items; the bank is
-- being doubled to 30 per scenario (fixtures/questions/additions/CCAR-F-batch2-*),
-- which would have produced a 120-item "60-item" exam. Now each drawn scenario
-- contributes v_exam.items / 4 items, apportioned across that scenario's domains
-- by its bank mix. Everything else in the function is byte-identical to
-- 2026-08-07-stratified-sim-draw.sql (verified against the live definition
-- before this change). Verify with: node scripts/verify-sim-draw.js

begin;

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
               (row_number() over (partition by q.scenario, q.domain_name order by random()) - 0.5)
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

commit;
