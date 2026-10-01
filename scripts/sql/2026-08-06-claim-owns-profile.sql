-- Cert Forge — cf_claim_profile creates its own profile row
-- 2026-08-06
--
-- The login page was pre-creating a placeholder profile ("…") before calling
-- cf_claim_profile, then deleting it if the claim failed. That delete silently
-- did nothing: cf_profiles has select/insert/update policies for the owner but
-- no DELETE policy, so RLS dropped it and every wrong-PIN attempt left a
-- placeholder profile behind. Caught in E2E — a stray "…" profile.
--
-- The claim now upserts the profile itself, so the client never creates one
-- speculatively and a failed attempt leaves nothing behind but the anonymous
-- auth shell (no profile, no data), which the existing orphan-session handling
-- in src/app/page.tsx already bounces back to /login.

begin;

create or replace function public.cf_claim_profile(p_username text, p_pin text)
returns jsonb
language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
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
$function$;

commit;
