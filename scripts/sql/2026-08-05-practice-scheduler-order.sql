-- Cert Forge — cf_start_practice: due reviews before new material
-- 2026-08-05
--
-- The bug: the old ordering put unseen items and due reviews in the SAME first
-- tier, then broke the tie with
--     case when coalesce(r.times_seen,0) = 0 then -1 else times_correct/times_seen end asc
-- An unseen item scores -1, which is below any real accuracy ratio (0.0 .. 1.0),
-- so every never-seen question outranked every due review. With 50-odd fresh
-- items in a bank and a set size of 15, a due review never made the cut — an
-- item you missed came back only after you had worked through the whole exam.
--
-- That defeats spaced repetition (the review interval is the mechanism) and
-- contradicted the UI, which promises "prioritizing what you've missed and
-- what's due, then new material" and labels the button "Review N due items".
--
-- The fix is three explicit tiers instead of two:
--     0  due for review   — seen before and the interval has elapsed
--     1  never seen       — new material
--     2  seen, not due    — filler, so a set still fills when 0 and 1 run dry
--
-- Everything else in the function is unchanged.

begin;

create or replace function public.cf_start_practice(p_exam text, p_size integer default 15)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
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

commit;
