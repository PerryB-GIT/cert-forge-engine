-- LIVE SNAPSHOT of Cert Forge (cf_) objects, pulled 2026-10-01 via Supabase Management API (read-only).
-- Reference only: closes review finding A5 (live RPCs not in repo). Do not re-run blindly. cf_seed_questions omitted.

-- ===== CONSTRAINTS =====
-- cf_achievements.cf_achievements_pkey: PRIMARY KEY (id)
-- cf_achievements.cf_achievements_user_id_badge_id_key: UNIQUE (user_id, badge_id)
-- cf_achievements.cf_achievements_user_id_fkey: FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
-- cf_attempts.cf_attempts_exam_code_fkey: FOREIGN KEY (exam_code) REFERENCES cf_exams(code)
-- cf_attempts.cf_attempts_pct_correct_check: CHECK (((pct_correct >= (0)::numeric) AND (pct_correct <= (100)::numeric)))
-- cf_attempts.cf_attempts_pkey: PRIMARY KEY (id)
-- cf_attempts.cf_attempts_user_id_fkey: FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
-- cf_chronicle.cf_chronicle_event_type_check: CHECK ((event_type = ANY (ARRAY['score_logged'::text, 'crossed_up'::text, 'crossed_down'::text, 'badge_earned'::text, 'sim_completed'::text, 'quick_completed'::text, 'practice_completed'::text, 'flashcards_completed'::text])))
-- cf_chronicle.cf_chronicle_pkey: PRIMARY KEY (id)
-- cf_chronicle.cf_chronicle_user_id_fkey: FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
-- cf_credentials.cf_credentials_pkey: PRIMARY KEY (user_id)
-- cf_credentials.cf_credentials_user_id_fkey: FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
-- cf_domains.cf_domains_exam_code_fkey: FOREIGN KEY (exam_code) REFERENCES cf_exams(code) ON DELETE CASCADE
-- cf_domains.cf_domains_pkey: PRIMARY KEY (exam_code, name)
-- cf_domains.cf_domains_weight_check: CHECK ((weight > (0)::numeric))
-- cf_exam_sessions.cf_exam_sessions_exam_code_fkey: FOREIGN KEY (exam_code) REFERENCES cf_exams(code)
-- cf_exam_sessions.cf_exam_sessions_mode_check: CHECK ((mode = ANY (ARRAY['full'::text, 'quick'::text, 'holdout'::text])))
-- cf_exam_sessions.cf_exam_sessions_pkey: PRIMARY KEY (id)
-- cf_exam_sessions.cf_exam_sessions_user_id_fkey: FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
-- cf_exams.cf_exams_pkey: PRIMARY KEY (code)
-- cf_holdout.cf_holdout_pkey: PRIMARY KEY (question_id)
-- cf_item_reviews.cf_item_reviews_pkey: PRIMARY KEY (user_id, question_id)
-- cf_item_reviews.cf_item_reviews_question_id_fkey: FOREIGN KEY (question_id) REFERENCES cf_questions(id) ON DELETE CASCADE
-- cf_item_reviews.cf_item_reviews_user_id_fkey: FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
-- cf_migrations.cf_migrations_pkey: PRIMARY KEY (name)
-- cf_practice_answers.cf_practice_answers_pkey: PRIMARY KEY (id)
-- cf_practice_answers.cf_practice_answers_practice_id_fkey: FOREIGN KEY (practice_id) REFERENCES cf_practice_sessions(id) ON DELETE SET NULL
-- cf_practice_answers.cf_practice_answers_question_id_fkey: FOREIGN KEY (question_id) REFERENCES cf_questions(id) ON DELETE CASCADE
-- cf_practice_answers.cf_practice_answers_source_check: CHECK ((source = ANY (ARRAY['practice'::text, 'flashcard'::text])))
-- cf_practice_answers.cf_practice_answers_user_id_fkey: FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
-- cf_practice_sessions.cf_practice_sessions_exam_code_fkey: FOREIGN KEY (exam_code) REFERENCES cf_exams(code)
-- cf_practice_sessions.cf_practice_sessions_pkey: PRIMARY KEY (id)
-- cf_practice_sessions.cf_practice_sessions_user_id_fkey: FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
-- cf_profiles.cf_profiles_id_fkey: FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE
-- cf_profiles.cf_profiles_pkey: PRIMARY KEY (id)
-- cf_question_tasks.cf_question_tasks_pkey: PRIMARY KEY (question_id)
-- cf_questions.cf_questions_exam_code_fkey: FOREIGN KEY (exam_code) REFERENCES cf_exams(code) ON DELETE CASCADE
-- cf_questions.cf_questions_pkey: PRIMARY KEY (id)
-- cf_seed_secret.cf_seed_secret_pkey: PRIMARY KEY (secret)

-- ===== RLS POLICIES =====
-- cf_achievements [SELECT] cf_achievements_select_own: using((auth.uid() = user_id)) check()
-- cf_attempts [INSERT] cf_attempts_insert_own: using() check((auth.uid() = user_id))
-- cf_attempts [SELECT] cf_attempts_select_own: using((auth.uid() = user_id)) check()
-- cf_chronicle [SELECT] cf_chronicle_select_own: using((auth.uid() = user_id)) check()
-- cf_domains [SELECT] cf_domains_read: using(true) check()
-- cf_exam_sessions [SELECT] cf_sessions_select_own: using((auth.uid() = user_id)) check()
-- cf_exams [SELECT] cf_exams_read: using(true) check()
-- cf_item_reviews [SELECT] cf_reviews_select_own: using((auth.uid() = user_id)) check()
-- cf_practice_answers [SELECT] cf_practice_answers_select_own: using((auth.uid() = user_id)) check()
-- cf_practice_sessions [SELECT] cf_practice_select_own: using((auth.uid() = user_id)) check()
-- cf_profiles [INSERT] cf_profiles_insert_own: using() check((auth.uid() = id))
-- cf_profiles [SELECT] cf_profiles_select_own: using((auth.uid() = id)) check()
-- cf_profiles [UPDATE] cf_profiles_update_own: using((auth.uid() = id)) check()

-- ===== TRIGGERS =====
-- CREATE TRIGGER cf_attempts_after_insert AFTER INSERT ON public.cf_attempts FOR EACH ROW EXECUTE FUNCTION cf_handle_attempt_insert()

-- ===== GRANTS (functions executable by anon/authenticated) =====

-- ===== FUNCTIONS =====
CREATE OR REPLACE FUNCTION public.cf_box_interval(p_box integer)
 RETURNS interval
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case p_box
    when 0 then interval '10 minutes'
    when 1 then interval '1 day'
    when 2 then interval '3 days'
    when 3 then interval '7 days'
    when 4 then interval '16 days'
    else interval '35 days'
  end;
$function$
;

CREATE OR REPLACE FUNCTION public.cf_claim_profile(p_username text, p_pin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_new uuid := auth.uid();
  v_cred cf_credentials;
  v_old uuid;
  v_name text;
begin
  if v_new is null then raise exception 'not authenticated'; end if;

  select * into v_cred from cf_credentials where lower(username) = lower(btrim(p_username));

  -- Identical response for unknown username and wrong PIN, so this cannot be
  -- used to enumerate usernames.
  if not found then
    perform pg_sleep(0.3);
    return jsonb_build_object('ok', false, 'error', 'Username or PIN is incorrect.');
  end if;

  if v_cred.locked_until is not null and v_cred.locked_until > now() then
    return jsonb_build_object('ok', false, 'error', format(
      'Too many attempts. Try again in %s minutes.',
      greatest(1, ceil(extract(epoch from (v_cred.locked_until - now())) / 60))));
  end if;

  if v_cred.pin_hash <> crypt(p_pin, v_cred.pin_hash) then
    -- Must NOT raise: the transaction has to commit for the counter to stick.
    update cf_credentials
       set failed_attempts = failed_attempts + 1,
           locked_until = case when failed_attempts + 1 >= 10
                               then now() + interval '15 minutes' end
     where user_id = v_cred.user_id;
    perform pg_sleep(0.3);
    return jsonb_build_object('ok', false, 'error', 'Username or PIN is incorrect.');
  end if;

  v_old := v_cred.user_id;
  if v_old = v_new then
    update cf_credentials set failed_attempts = 0, locked_until = null where user_id = v_new;
    return jsonb_build_object('ok', true, 'already_current', true,
      'display_name', (select display_name from cf_profiles where id = v_new));
  end if;

  select display_name into v_name from cf_profiles where id = v_old;

  -- Only now, past every failure path, does a profile row get created for the
  -- caller — so a rejected attempt leaves no trace.
  insert into cf_profiles (id, display_name)
  values (v_new, coalesce(v_name, 'Studying'))
  on conflict (id) do nothing;

  -- Where the throwaway session already holds a row that would collide with the
  -- claimed history, the claimed history wins.
  delete from cf_item_reviews t
   where t.user_id = v_new
     and exists (select 1 from cf_item_reviews s where s.user_id = v_old and s.question_id = t.question_id);
  delete from cf_achievements t
   where t.user_id = v_new
     and exists (select 1 from cf_achievements s where s.user_id = v_old and s.badge_id = t.badge_id);

  update cf_item_reviews      set user_id = v_new where user_id = v_old;
  update cf_achievements      set user_id = v_new where user_id = v_old;
  update cf_attempts          set user_id = v_new where user_id = v_old;
  update cf_chronicle         set user_id = v_new where user_id = v_old;
  update cf_exam_sessions     set user_id = v_new where user_id = v_old;
  update cf_practice_sessions set user_id = v_new where user_id = v_old;
  update cf_practice_answers  set user_id = v_new where user_id = v_old;

  update cf_profiles p
     set display_name = v_name,
         share_scores = coalesce((select share_scores from cf_profiles where id = v_old), false)
   where p.id = v_new;

  delete from cf_credentials where user_id = v_new;
  update cf_credentials
     set user_id = v_new, failed_attempts = 0, locked_until = null
   where user_id = v_old;
  delete from cf_profiles where id = v_old;
  delete from auth.users where id = v_old;

  return jsonb_build_object('ok', true, 'display_name', v_name, 'restored_from', v_old);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.cf_domain_mastery()
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with dm as (
    select q.exam_code, q.domain_name,
      count(distinct q.id) as total_in_domain,
      count(r.question_id) as seen,
      coalesce(avg(r.box), 0) as avg_box
    from cf_questions q
    left join cf_item_reviews r on r.question_id = q.id and r.user_id = auth.uid()
    group by q.exam_code, q.domain_name
  )
  select coalesce(jsonb_object_agg(exam_code, arr), '{}'::jsonb)
  from (
    select exam_code, jsonb_agg(jsonb_build_object(
      'domain', domain_name,
      'total', total_in_domain,
      'seen', seen,
      'coverage', round(100.0 * seen / nullif(total_in_domain, 0)),
      'retention', round(100.0 * avg_box / 5)
    ) order by domain_name) as arr
    from dm group by exam_code
  ) t;
$function$
;

CREATE OR REPLACE FUNCTION public.cf_finish_flashcards(p_exam text, p_since timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.cf_finish_practice(p_practice uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user uuid := auth.uid();
  v_ps cf_practice_sessions;
begin
  select * into v_ps from cf_practice_sessions where id = p_practice and user_id = v_user;
  if not found then raise exception 'practice session not found'; end if;
  if v_ps.finished_at is null then
    update cf_practice_sessions set finished_at = now() where id = p_practice
    returning * into v_ps;
    if v_ps.answered_count > 0 then
      insert into cf_chronicle (user_id, event_type, exam_code, body)
      values (v_user, 'practice_completed', v_ps.exam_code,
        format('Practice on %s - %s/%s correct, %s items scheduled for spaced review',
               v_ps.exam_code, v_ps.correct_count, v_ps.answered_count, v_ps.answered_count));
    end if;
  end if;
  return jsonb_build_object(
    'exam_code', v_ps.exam_code, 'answered', v_ps.answered_count, 'correct', v_ps.correct_count);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.cf_flashcard_grade(p_question_id text, p_got_it boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.cf_grade_practice_item(p_practice uuid, p_question_id text, p_answer jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.cf_handle_attempt_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  prev_scaled int;
  curr_scaled int;
  inserted boolean;
  ready_ct int;
  all_domains int;
  logged_ok int;
begin
  prev_scaled := cf_scaled_score(new.user_id, new.exam_code, new.id);
  curr_scaled := cf_scaled_score(new.user_id, new.exam_code, null);

  insert into cf_chronicle (user_id, event_type, exam_code, body)
  values (new.user_id, 'score_logged', new.exam_code,
    format('%s — %s: %s%% logged (scaled %s)', new.exam_code, new.domain_name,
           round(new.pct_correct), coalesce(curr_scaled::text, '—')));

  if curr_scaled >= 720 and (prev_scaled is null or prev_scaled < 720) then
    insert into cf_chronicle (user_id, event_type, exam_code, body)
    values (new.user_id, 'crossed_up', new.exam_code,
      format('Crossed 720 on %s — now %s. Ready.', new.exam_code, curr_scaled));
  elsif prev_scaled is not null and prev_scaled >= 720 and curr_scaled < 720 then
    insert into cf_chronicle (user_id, event_type, exam_code, body)
    values (new.user_id, 'crossed_down', new.exam_code,
      format('Dropped below 720 on %s — now %s. Back to work.', new.exam_code, curr_scaled));
  end if;

  -- First Blood
  insert into cf_achievements (user_id, badge_id) values (new.user_id, 'first_blood')
  on conflict do nothing;
  if found then
    insert into cf_chronicle (user_id, event_type, exam_code, body)
    values (new.user_id, 'badge_earned', new.exam_code, 'Badge earned: First Blood — first score logged');
  end if;

  -- Ready per exam
  if curr_scaled >= 720 then
    insert into cf_achievements (user_id, badge_id) values (new.user_id, 'ready_' || new.exam_code)
    on conflict do nothing;
    if found then
      insert into cf_chronicle (user_id, event_type, exam_code, body)
      values (new.user_id, 'badge_earned', new.exam_code,
        format('Badge earned: Ready — %s at %s', new.exam_code, curr_scaled));
    end if;
  end if;

  -- Comfortable Margin (any exam 800+)
  if curr_scaled >= 800 then
    insert into cf_achievements (user_id, badge_id) values (new.user_id, 'comfortable_margin')
    on conflict do nothing;
    if found then
      insert into cf_chronicle (user_id, event_type, exam_code, body)
      values (new.user_id, 'badge_earned', new.exam_code,
        format('Badge earned: Comfortable Margin — %s at %s', new.exam_code, curr_scaled));
    end if;
  end if;

  -- No Weak Domains (every domain of this exam logged and latest >= 70)
  select count(*) into all_domains from cf_domains where exam_code = new.exam_code;
  select count(*) into logged_ok from (
    select distinct on (a.domain_name) a.pct_correct
    from cf_attempts a
    where a.user_id = new.user_id and a.exam_code = new.exam_code
    order by a.domain_name, a.created_at desc, a.id desc
  ) t where t.pct_correct >= 70;
  if logged_ok = all_domains then
    insert into cf_achievements (user_id, badge_id) values (new.user_id, 'no_weak_domains')
    on conflict do nothing;
    if found then
      insert into cf_chronicle (user_id, event_type, exam_code, body)
      values (new.user_id, 'badge_earned', new.exam_code,
        format('Badge earned: No Weak Domains — every %s domain at 70%%+', new.exam_code));
    end if;
  end if;

  -- Clean Sweep (all four ready badges)
  select count(*) into ready_ct from cf_achievements
  where user_id = new.user_id and badge_id in ('ready_CCAO-F','ready_CCDV-F','ready_CCAR-F','ready_CCAR-P');
  if ready_ct = 4 then
    insert into cf_achievements (user_id, badge_id) values (new.user_id, 'clean_sweep')
    on conflict do nothing;
    if found then
      insert into cf_chronicle (user_id, event_type, exam_code, body)
      values (new.user_id, 'badge_earned', new.exam_code, 'Badge earned: Clean Sweep — ready on all four exams');
    end if;
  end if;

  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.cf_leaderboard()
 RETURNS TABLE(display_name text, is_me boolean, ready_count bigint, badge_count bigint, total_scaled bigint, per_exam jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with best as (
    select a.user_id, a.exam_code, a.domain_name, max(a.pct_correct) as pct
    from cf_attempts a
    group by 1, 2, 3
  ),
  scored as (
    select b.user_id, b.exam_code,
      round(100 + (sum(b.pct * d.weight) / sum(d.weight)) * 9)::int as scaled
    from best b
    join cf_domains d on d.exam_code = b.exam_code and d.name = b.domain_name
    group by 1, 2
  )
  select
    p.display_name,
    (auth.uid() = p.id) as is_me,
    count(s.exam_code) filter (where s.scaled >= 720) as ready_count,
    (select count(*) from cf_achievements ach where ach.user_id = p.id) as badge_count,
    coalesce(sum(s.scaled), 0)::bigint as total_scaled,
    coalesce(jsonb_object_agg(s.exam_code, s.scaled) filter (where s.exam_code is not null), '{}'::jsonb) as per_exam
  from cf_profiles p
  left join scored s on s.user_id = p.id
  group by p.id, p.display_name
  order by ready_count desc, total_scaled desc;
$function$
;

CREATE OR REPLACE FUNCTION public.cf_missed_items(p_exam text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.cf_my_username()
 RETURNS text
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select username from cf_credentials where user_id = auth.uid();
$function$
;

CREATE OR REPLACE FUNCTION public.cf_practice_stats()
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.cf_proctor_event(p_session uuid, p_event jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v cf_exam_sessions;
begin
  select * into v from cf_exam_sessions where id = p_session and user_id = auth.uid();
  if not found then raise exception 'session not found'; end if;
  if v.submitted_at is not null then return; end if;
  if jsonb_array_length(v.proctor_events) >= 200 then return; end if;
  update cf_exam_sessions
  set proctor_events = proctor_events || jsonb_build_array(p_event || jsonb_build_object('at', to_jsonb(now())))
  where id = p_session;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.cf_readiness()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.cf_review_counts()
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_object_agg(code, jsonb_build_object('due', due, 'seen', seen, 'new', total - seen)), '{}'::jsonb)
  from (
    select e.code,
      (select count(*) from cf_questions q where q.exam_code = e.code) as total,
      (select count(*) from cf_item_reviews r where r.user_id = auth.uid() and r.exam_code = e.code) as seen,
      (select count(*) from cf_item_reviews r where r.user_id = auth.uid() and r.exam_code = e.code and r.due_at <= now()) as due
    from cf_exams e
  ) t;
$function$
;

CREATE OR REPLACE FUNCTION public.cf_save_answer(p_session uuid, p_qid text, p_answer jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v cf_exam_sessions;
begin
  select * into v from cf_exam_sessions where id = p_session and user_id = auth.uid();
  if not found then raise exception 'session not found'; end if;
  if v.submitted_at is not null then raise exception 'session already submitted'; end if;
  if now() > v.expires_at then raise exception 'time expired'; end if;
  if not (v.question_ids ? p_qid) then
    if not exists (select 1 from jsonb_array_elements_text(v.question_ids) t where t = p_qid) then
      raise exception 'question not in session';
    end if;
  end if;
  if jsonb_typeof(p_answer) <> 'array' then raise exception 'answer must be an array of option indices'; end if;
  update cf_exam_sessions set answers = answers || jsonb_build_object(p_qid, p_answer) where id = p_session;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.cf_scaled_score(p_user uuid, p_exam text, p_exclude bigint DEFAULT NULL::bigint)
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with latest as (
    select distinct on (a.domain_name) a.domain_name, a.pct_correct
    from cf_attempts a
    where a.user_id = p_user and a.exam_code = p_exam
      and (p_exclude is null or a.id <> p_exclude)
    order by a.domain_name, a.created_at desc, a.id desc
  )
  select round(100 + (sum(l.pct_correct * d.weight) / sum(d.weight)) * 9)::int
  from latest l
  join cf_domains d on d.exam_code = p_exam and d.name = l.domain_name;
$function$
;

CREATE OR REPLACE FUNCTION public.cf_scoreboard()
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with best as (
    select a.user_id, a.exam_code, a.domain_name, max(a.pct_correct) as pct
    from cf_attempts a group by 1, 2, 3
  ),
  scored as (
    select b.user_id, b.exam_code,
      round(100 + (sum(b.pct * d.weight) / sum(d.weight)) * 9)::int as scaled
    from best b join cf_domains d on d.exam_code = b.exam_code and d.name = b.domain_name
    group by 1, 2
  ),
  per_user as (
    select p.id, p.display_name, p.share_scores, (p.id = auth.uid()) as is_me,
      count(s.exam_code) filter (where s.scaled >= 720) as ready_count,
      coalesce(sum(s.scaled), 0)::int as total_scaled,
      (select count(*) from cf_achievements a where a.user_id = p.id) as badge_count,
      coalesce(jsonb_object_agg(s.exam_code, s.scaled) filter (where s.exam_code is not null), '{}'::jsonb) as per_exam
    from cf_profiles p
    left join scored s on s.user_id = p.id
    where p.share_scores = true or p.id = auth.uid()
    group by p.id, p.display_name, p.share_scores
  )
  select jsonb_build_object(
    'me', (select jsonb_build_object(
        'display_name', display_name, 'ready_count', ready_count,
        'total_scaled', total_scaled, 'badge_count', badge_count, 'per_exam', per_exam)
      from per_user where is_me),
    'opted_in', coalesce((select share_scores from cf_profiles where id = auth.uid()), false),
    'team', (select jsonb_build_object(
        'members', count(*), 'exams_ready', coalesce(sum(ready_count), 0),
        'exams_possible', count(*) * 4, 'badges', coalesce(sum(badge_count), 0))
      from per_user where share_scores),
    'roster', coalesce((select jsonb_agg(jsonb_build_object(
        'display_name', display_name, 'is_me', is_me, 'ready_count', ready_count,
        'total_scaled', total_scaled, 'badge_count', badge_count, 'per_exam', per_exam)
        order by ready_count desc, total_scaled desc)
      from per_user where share_scores), '[]'::jsonb)
  );
$function$
;

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
$function$
;

CREATE OR REPLACE FUNCTION public.cf_set_credentials(p_username text, p_pin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare
  v_user uuid := auth.uid();
  v_name text := btrim(p_username);
begin
  if v_user is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from cf_profiles where id = v_user) then
    raise exception 'no profile for this session';
  end if;
  if v_name !~ '^[A-Za-z0-9._-]{3,24}$' then
    raise exception 'Username must be 3-24 characters: letters, numbers, dot, dash or underscore.';
  end if;
  if p_pin !~ '^[0-9]{4,10}$' then
    raise exception 'PIN must be 4-10 digits.';
  end if;
  if exists (select 1 from cf_credentials where lower(username) = lower(v_name) and user_id <> v_user) then
    raise exception 'That username is taken.';
  end if;

  insert into cf_credentials (user_id, username, pin_hash)
  values (v_user, v_name, crypt(p_pin, gen_salt('bf', 10)))
  on conflict (user_id) do update set
    username = excluded.username,
    pin_hash = excluded.pin_hash,
    updated_at = now(),
    failed_attempts = 0,
    locked_until = null;

  return jsonb_build_object('username', v_name);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.cf_start_practice(p_exam text, p_size integer DEFAULT 15)
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
$function$
;

CREATE OR REPLACE FUNCTION public.cf_start_session(p_exam text, p_mode text DEFAULT 'full'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.cf_study_activity()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.cf_submit_session(p_session uuid)
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
$function$
;

CREATE OR REPLACE FUNCTION public.cf_task_stats(p_exam text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;
