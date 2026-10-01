-- Cert Forge — allow 4-digit PINs
-- 2026-09-24
--
-- Owner decision (2026-09-24): accept 4-10 digit PINs so a 4-digit PIN
-- can be used. Trade-off accepted knowingly: with the 10-attempt / 15-minute
-- lockout in cf_claim_profile, exhausting a 4-digit space takes ~10 days of
-- continuous guessing vs ~2.8 years at 6 digits. This is a study tracker with
-- no sensitive data; users may still choose longer PINs. Everything else in
-- the function is identical to 2026-08-06-username-pin.sql (verified against
-- the live definition before this change).

begin;

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
$function$;

commit;
