-- Cert Forge — pooled, item-level Readiness
-- 2026-09-25 (regrade 3: Readiness gauge noise)
--
-- The Readiness gauge took the LATEST cf_attempts row per domain and weighted
-- them by blueprint. Since attempts became fresh-items-only, a second sim can
-- leave a domain with 1-3 fresh items, so one answer swung the gauge 135-180
-- scaled points — the per-item noise fix #1 removed from sims, moved to the
-- home page. cf_attempts also stores no item counts, so it cannot be pooled.
--
-- cf_readiness() pools graded FRESH items (unseen when drawn) across the
-- caller's most recent submitted full/holdout sims, newest first, until at
-- least 60 fresh items are in the window (older sims age out). Sessions from
-- before seen-tracking (fresh_ids null) count every item. Quick tests are
-- excluded (2 items per domain is a diagnostic, not a readiness read).
-- Returns, per exam: fresh item total/correct, per-domain n/ok, sims used.
-- The client scores it (src/lib/scoring.ts pooledReadiness).

begin;

create or replace function public.cf_readiness()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user uuid := auth.uid();
  v_out jsonb;
begin
  if v_user is null then raise exception 'not authenticated'; end if;

  with sess as (
    select s.id, s.exam_code, s.submitted_at, s.answers, s.fresh_ids, s.question_ids
      from cf_exam_sessions s
     where s.user_id = v_user and s.submitted_at is not null and s.mode in ('full','holdout')
  ),
  items as (
    select s.id as sid, s.exam_code, s.submitted_at, q.domain_name, (
             (s.answers ? q.id)
             and (select coalesce(array_agg(t.v::int order by t.v::int), array[]::int[])
                  from jsonb_array_elements_text(s.answers -> q.id) t(v))
               = (select coalesce(array_agg(t.v::int order by t.v::int), array[]::int[])
                  from jsonb_array_elements_text(q.correct) t(v))
           ) as ok
      from sess s
      join lateral jsonb_array_elements_text(s.question_ids) qid(id) on true
      join cf_questions q on q.id = qid.id
     where s.fresh_ids is null or s.fresh_ids ? q.id
  ),
  per_sess as (
    select exam_code, sid, submitted_at, count(*) n from items group by 1, 2, 3
  ),
  windowed as (
    -- newest first; keep a session while the fresh items already collected
    -- from newer sessions are still under 60
    select exam_code, sid
      from (select exam_code, sid,
                   coalesce(sum(n) over (partition by exam_code order by submitted_at desc
                                         rows between unbounded preceding and 1 preceding), 0) before
              from per_sess) w
     where before < 60
  ),
  used as (
    select i.* from items i join windowed w on w.sid = i.sid
  ),
  dom as (
    select exam_code, domain_name, count(*) n, count(*) filter (where ok) ok
      from used group by 1, 2
  )
  select coalesce(jsonb_object_agg(e.exam_code, jsonb_build_object(
           'items', e.n, 'correct', e.ok, 'sims', e.sims,
           'domains', (select jsonb_object_agg(d.domain_name, jsonb_build_object('n', d.n, 'ok', d.ok))
                         from dom d where d.exam_code = e.exam_code))), '{}'::jsonb)
    into v_out
    from (select exam_code, count(*) n, count(*) filter (where ok) ok, count(distinct sid) sims
            from used group by exam_code) e;

  return v_out;
end;
$function$;

revoke execute on function public.cf_readiness() from anon;
grant execute on function public.cf_readiness() to authenticated;

commit;
