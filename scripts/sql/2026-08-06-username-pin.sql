-- Cert Forge — durable identity: username + PIN
-- 2026-08-06
--
-- THE DEFECT
-- Login is name-only Supabase anonymous auth: a new device, a new browser, or
-- cleared storage mints a fresh uid and a blank profile, silently. One user ended
-- up with three same-name profiles (7/15, 7/16, 8/03) holding 22 / 2 / 0 item
-- reviews and 0 attempts between them, so Readiness — the whole point of the
-- app — has never had a complete picture. Nothing in the UI ever said so.
--
-- WHY NOT UPGRADE THE ANONYMOUS USER IN PLACE
-- Supabase supports attaching an email+password to an anonymous user, which
-- would keep auth.uid() stable. Probed it: the project has email confirmation
-- enabled, so PUT /auth/v1/user fires a confirmation mail (observed as
-- over_email_send_rate_limit on a valid domain, email_address_invalid on a fake
-- one). Turning confirmation off is a dashboard-only setting. So identity here
-- is handled entirely in our own tables, sends no mail, and needs no dashboard
-- change.
--
-- THE DESIGN
-- Anonymous auth stays exactly as it is. A user optionally claims a username +
-- PIN. On a new device they sign in anonymously as usual, then "restore" —
-- which verifies the PIN and REASSIGNS every row from the old uid to the new
-- one, then removes the old shell account.
--
-- Trade-off, stated in the UI: one active device at a time. Restoring on a new
-- device orphans the old session, which lands back on /login. For a personal
-- study tracker that is the expected "move to my new laptop" behaviour, and it
-- is strictly better than silently starting over.

begin;

-- ---------------------------------------------------------------------------
-- 1. cf_credentials — hashes live here, NOT on cf_profiles
-- ---------------------------------------------------------------------------
-- cf_profiles is readable by its owner, so a pin_hash column there would be
-- fetchable by the client. This table follows cf_questions: RLS on, zero
-- policies, reachable only through SECURITY DEFINER functions.
create table if not exists cf_credentials (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  username        text not null,
  pin_hash        text not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  failed_attempts int not null default 0,
  locked_until    timestamptz
);

create unique index if not exists cf_credentials_username_key
  on cf_credentials (lower(username));

alter table cf_credentials enable row level security;
revoke all on cf_credentials from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. cf_set_credentials — claim or update your username + PIN
-- ---------------------------------------------------------------------------
create or replace function public.cf_set_credentials(p_username text, p_pin text)
returns jsonb
language plpgsql security definer set search_path to 'public', 'extensions'
as $function$
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
  if p_pin !~ '^[0-9]{6,10}$' then
    raise exception 'PIN must be 6-10 digits.';
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
$function$;

-- ---------------------------------------------------------------------------
-- 3. cf_my_username — so the UI can show claimed / unclaimed state
-- ---------------------------------------------------------------------------
create or replace function public.cf_my_username()
returns text
language sql security definer set search_path to 'public'
as $function$
  select username from cf_credentials where user_id = auth.uid();
$function$;

-- ---------------------------------------------------------------------------
-- 4. cf_claim_profile — restore an account onto the current session
-- ---------------------------------------------------------------------------
-- Called by a freshly signed-in anonymous user. On success every row belonging
-- to the old uid is reassigned to the caller and the old shell is removed.
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

  -- Same message whether the username is unknown or the PIN is wrong, so the
  -- endpoint cannot be used to enumerate usernames.
  if not found then
    perform pg_sleep(0.3);
    raise exception 'Username or PIN is incorrect.';
  end if;

  if v_cred.locked_until is not null and v_cred.locked_until > now() then
    raise exception 'Too many attempts. Try again in % minutes.',
      ceil(extract(epoch from (v_cred.locked_until - now())) / 60);
  end if;

  if v_cred.pin_hash <> crypt(p_pin, v_cred.pin_hash) then
    update cf_credentials
    set failed_attempts = failed_attempts + 1,
        locked_until = case when failed_attempts + 1 >= 10 then now() + interval '15 minutes' end
    where user_id = v_cred.user_id;
    perform pg_sleep(0.3);
    raise exception 'Username or PIN is incorrect.';
  end if;

  v_old := v_cred.user_id;
  if v_old = v_new then
    return jsonb_build_object('already_current', true,
      'display_name', (select display_name from cf_profiles where id = v_new));
  end if;

  select display_name into v_name from cf_profiles where id = v_old;

  -- Where the throwaway session already has a row that would collide with the
  -- claimed history, the claimed history wins.
  delete from cf_item_reviews t
   where t.user_id = v_new
     and exists (select 1 from cf_item_reviews s where s.user_id = v_old and s.question_id = t.question_id);
  delete from cf_achievements t
   where t.user_id = v_new
     and exists (select 1 from cf_achievements s where s.user_id = v_old and s.badge_id = t.badge_id);

  update cf_item_reviews     set user_id = v_new where user_id = v_old;
  update cf_achievements     set user_id = v_new where user_id = v_old;
  update cf_attempts         set user_id = v_new where user_id = v_old;
  update cf_chronicle        set user_id = v_new where user_id = v_old;
  update cf_exam_sessions    set user_id = v_new where user_id = v_old;
  update cf_practice_sessions set user_id = v_new where user_id = v_old;
  update cf_practice_answers set user_id = v_new where user_id = v_old;

  update cf_profiles p
     set display_name = v_name,
         share_scores = coalesce((select share_scores from cf_profiles where id = v_old), false)
   where p.id = v_new;

  -- Move the credential across, then drop the old shell. The auth.users delete
  -- cascades the now-empty old profile away.
  delete from cf_credentials where user_id = v_new;
  update cf_credentials set user_id = v_new, failed_attempts = 0, locked_until = null
   where user_id = v_old;
  delete from cf_profiles where id = v_old;
  delete from auth.users where id = v_old;

  return jsonb_build_object('display_name', v_name, 'restored_from', v_old);
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Grants — authenticated only
-- ---------------------------------------------------------------------------
revoke execute on function public.cf_set_credentials(text, text) from public, anon;
revoke execute on function public.cf_claim_profile(text, text) from public, anon;
revoke execute on function public.cf_my_username() from public, anon;

grant execute on function public.cf_set_credentials(text, text) to authenticated;
grant execute on function public.cf_claim_profile(text, text) to authenticated;
grant execute on function public.cf_my_username() to authenticated;

commit;
