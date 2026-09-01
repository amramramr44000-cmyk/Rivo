-- Rivo login compatibility fix
-- Resolves the real Supabase Auth email by username before password login.
-- This fixes accounts whose username was changed after signup or by an older admin flow.
-- Safe to run after supabase_schema.sql.

create or replace function public.rivo_get_login_email(p_username text)
returns text
language sql
security definer
set search_path = public, auth
as $$
  select u.email
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.username = lower(trim(both '@' from coalesce(p_username, '')))
  limit 1;
$$;

revoke all on function public.rivo_get_login_email(text) from public;
grant execute on function public.rivo_get_login_email(text) to anon, authenticated;

-- Repair the denormalized profile copy for any existing account whose Auth
-- email and profile.auth_email drifted apart.
update public.profiles p
set auth_email = u.email,
    updated_at = now()
from auth.users u
where u.id = p.id
  and p.auth_email is distinct from u.email;
