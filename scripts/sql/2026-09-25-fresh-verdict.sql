-- Cert Forge — fresh score + band stored at submit; no false greens
-- 2026-09-25 (regrade 4 fixes 2 + 3)
--
-- cf_exam_sessions gains fresh_items / fresh_scaled, computed in
-- cf_submit_session, so every reader (Report Card best / "Exams passed",
-- chronicle, scoreboard) can use the trustworthy number instead of the raw
-- score over repeats and quick tests.
-- `passed` now means: a full/holdout sitting with 40+ fresh items whose fresh
-- score is 800+ with the low end of its 90% margin >= 720 (same rule as
-- src/lib/scoring.ts). It used to be raw scaled >= 720 on any items,
-- including 10-item quick tests and re-sits of seen items.
-- The chronicle line states the band and the fresh score instead of
-- "PASSED" / "on track". Otherwise identical to 2026-09-25-scoring-holdout.sql.
-- Existing rows are backfilled below from the same rule.

begin;

alter table public.cf_exam_sessions add column if not exists fresh_items int;
alter table public.cf_exam_sessions add column if not exists fresh_scaled int;

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
  v_fresh_n int;
  v_fresh_ok int;
  v_fresh_scaled int;
  v_margin int;
  v_band text;
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

  -- Fresh-item score: the items unseen when drawn (all items for sessions
  -- from before tracking). Same scoring model as the headline: plain percent
  -- for CCAR-F, blueprint-weighted over the fresh items' domains otherwise.
  select count(*), count(*) filter (where ok) into v_fresh_n, v_fresh_ok
    from _graded where v.fresh_ids is null or v.fresh_ids ? id;
  if v_fresh_n > 0 then
    if v.exam_code = 'CCAR-F' then
      v_fresh_scaled := round(100 + 900.0 * v_fresh_ok / v_fresh_n)::int;
    else
      select round(100 + 9 * sum((100.0 * d.c_ok / d.c_all) * dom.weight) / sum(dom.weight))::int
        into v_fresh_scaled
        from (select domain_name, count(*) filter (where ok) c_ok, count(*) c_all
                from _graded where v.fresh_ids is null or v.fresh_ids ? id
               group by domain_name) d
        join cf_domains dom on dom.exam_code = v.exam_code and dom.name = d.domain_name;
    end if;
  end if;

  -- Band, same rule as src/lib/scoring.ts readinessBand + scoreMargin: a
  -- verdict needs a full/holdout sitting with 40+ fresh items; "likely pass"
  -- needs 800+ with the low end of the 90% margin still >= 720.
  if v.mode = 'quick' or coalesce(v_fresh_n, 0) < 40 or v_fresh_scaled is null then
    v_band := 'no verdict';
  else
    v_margin := round(1.645 * sqrt(greatest(0.001, least(0.999, (v_fresh_scaled - 100) / 900.0))
                                   * (1 - greatest(0.001, least(0.999, (v_fresh_scaled - 100) / 900.0)))
                                   / v_fresh_n) * 900)::int;
    v_band := case when v_fresh_scaled >= 800 and v_fresh_scaled - v_margin >= 720 then 'likely pass'
                   when v_fresh_scaled >= 720 then 'borderline'
                   else 'not yet' end;
  end if;
  -- "passed" now means a trustworthy likely-pass, not raw >= 720 on any items.
  v_passed := v_band = 'likely pass';

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
      scaled_score = v_scaled, domain_scores = v_domain_scores, passed = v_passed,
      fresh_items = v_fresh_n, fresh_scaled = v_fresh_scaled
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
      format('%s %s exam - %s (fresh %s on %s items; all items %s)',
             case when v.mode = 'holdout' then 'Go/no-go' else 'Full' end, v.exam_code,
             v_band, coalesce(v_fresh_scaled::text, '-'), v_fresh_n, v_scaled));
  else
    insert into cf_chronicle (user_id, event_type, exam_code, body)
    values (v.user_id, 'quick_completed', v.exam_code,
      format('Quick test on %s - scaled %s (%s items, diagnostic only)', v.exam_code, v_scaled,
             (select count(*) from _graded)));
  end if;

  return jsonb_build_object(
    'session_id', v.id, 'exam_code', v.exam_code, 'mode', v.mode,
    'scaled_score', v_scaled, 'weighted_pct', round(v_weighted, 2), 'passed', v_passed,
    'fresh_items', v_fresh_n, 'fresh_scaled', v_fresh_scaled, 'band', v_band,
    'domain_scores', v_domain_scores, 'proctor_events', v.proctor_events, 'review', v_review);
end;
$function$;

-- Backfill: quick tests never carry a verdict. Full/holdout sessions submitted
-- before this migration keep fresh_* null (readers fall back to "no verdict").
update public.cf_exam_sessions set passed = false where mode = 'quick' and passed;
update public.cf_exam_sessions set passed = false
 where mode <> 'quick' and submitted_at is not null and fresh_scaled is null and passed;

commit;
