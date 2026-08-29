-- Rivo signup/admin stability fixes
-- Safe to run on an existing database.

-- Fix stale/older username check constraints.
alter table public.profiles drop constraint if exists profiles_username_check;
alter table public.profiles
  add constraint profiles_username_check
  check (username ~ '^[a-z0-9](?:[a-z0-9._-]{1,24})[a-z0-9]$');

-- Delete only the currently authenticated Auth user. This is used solely to
-- clean up an Auth account if profile creation fails immediately after signup.
create or replace function public.rivo_delete_current_auth_user()
returns boolean
language plpgsql
security definer
set search_path=public,auth
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  delete from auth.users where id = auth.uid();
  return true;
end;
$$;

revoke all on function public.rivo_delete_current_auth_user() from public;
grant execute on function public.rivo_delete_current_auth_user() to authenticated;


-- Server-only profile initialization used by the secure signup Edge Function.
-- The internal flag lets hardened databases whose profile-write trigger blocks
-- direct inserts accept this trusted server-side initialization path.
create or replace function public.rivo_initialize_profile(
  p_id uuid,
  p_username text,
  p_auth_email text,
  p_public_data jsonb,
  p_private_data jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if p_id is null then
    raise exception 'Profile user id is required';
  end if;

  if not exists (select 1 from auth.users where id = p_id) then
    raise exception 'Auth user not found';
  end if;

  if p_username is null or p_username !~ '^[a-z0-9](?:[a-z0-9._-]{1,24})[a-z0-9]$' then
    raise exception 'Invalid username';
  end if;

  if p_auth_email is null or p_auth_email <> p_username || '@users.rivo.app' then
    raise exception 'Invalid auth email';
  end if;

  -- Bypass only the trusted profile-write trigger guard for this server-owned
  -- initialization transaction. RLS remains enabled and no browser role gets
  -- execute permission on this function.
  perform set_config('rivo.internal_profile_save', 'on', true);

  insert into public.profiles (
    id, username, auth_email, public_data, private_data
  ) values (
    p_id, p_username, p_auth_email, coalesce(p_public_data, '{}'::jsonb),
    coalesce(p_private_data, jsonb_build_object(
      'friendRequests', jsonb_build_object('incoming', '[]'::jsonb, 'outgoing', '[]'::jsonb)
    ))
  );

  return true;
end;
$$;

revoke all on function public.rivo_initialize_profile(uuid, text, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.rivo_initialize_profile(uuid, text, text, jsonb, jsonb) to service_role;
