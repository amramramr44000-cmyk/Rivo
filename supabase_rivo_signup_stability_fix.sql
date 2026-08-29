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
