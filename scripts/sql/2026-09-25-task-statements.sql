-- Cert Forge — per-task-statement results
-- 2026-09-25 (regrade fix 5)
--
-- Diagnosis used to stop at the 5 CCAR-F domains, but the guide breaks them
-- into 30 task statements (CCDV-F: 25 weighted skills). A 27%-weight domain is
-- too coarse to aim a study hour at.
--
-- cf_question_tasks maps each item to its PRIMARY task statement id
-- ("<domain#>.<statement#>" in guide order — the same order as
-- src/lib/objectives/<code>.ts, so the client resolves titles itself). Seeded
-- by scripts/seed-tasks.js from fixtures/questions/tags/<CODE>.json. Its own
-- table so re-seeding cf_questions never clears it.
--
-- cf_task_stats(exam) returns the caller's graded attempts per task statement:
-- every item in a SUBMITTED sim (blank = wrong, as scored) plus every graded
-- practice answer. Flashcards are self-graded, so they are excluded.

begin;

create table if not exists public.cf_question_tasks (
  question_id text primary key,
  exam_code text not null,
  task text not null
);
alter table public.cf_question_tasks enable row level security;  -- no policies: server-side only
revoke all on public.cf_question_tasks from anon, authenticated;

create or replace function public.cf_task_stats(p_exam text)
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

  with graded as (
    -- submitted sims: one row per delivered item, graded exactly as scored
    select q.id, (
             (s.answers ? q.id)
             and (select coalesce(array_agg(t.v::int order by t.v::int), array[]::int[])
                  from jsonb_array_elements_text(s.answers -> q.id) t(v))
               = (select coalesce(array_agg(t.v::int order by t.v::int), array[]::int[])
                  from jsonb_array_elements_text(q.correct) t(v))
           ) as ok,
           s.submitted_at as at
      from cf_exam_sessions s
      join lateral jsonb_array_elements_text(s.question_ids) qid(id) on true
      join cf_questions q on q.id = qid.id
     where s.user_id = v_user and s.exam_code = p_exam and s.submitted_at is not null
    union all
    -- graded practice (not self-graded flashcards)
    select a.question_id, a.is_correct, a.answered_at
      from cf_practice_answers a
     where a.user_id = v_user and a.exam_code = p_exam and a.source <> 'flashcard'
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'task', t.task, 'attempts', t.n, 'correct', t.ok,
           'pct', round(100.0 * t.ok / t.n, 1), 'items', t.items, 'last_at', t.last_at)
         order by t.task), '[]'::jsonb)
    into v_out
    from (
      select m.task, count(*) n, count(*) filter (where g.ok) ok,
             count(distinct g.id) items, max(g.at) last_at
        from graded g
        join cf_question_tasks m on m.question_id = g.id
       group by m.task
    ) t;

  return v_out;
end;
$function$;

revoke execute on function public.cf_task_stats(text) from anon;
grant execute on function public.cf_task_stats(text) to authenticated;

commit;
