-- Rivo v17: fix browser-side profile access for social actions
-- Safe/idempotent. Does not delete or mutate existing social data.
-- The current user's profile is returned only to auth.uid() via SECURITY DEFINER.

create or replace function public.rivo_get_current_profile()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare r public.profiles;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  select * into r
  from public.profiles
  where id = auth.uid()
  limit 1;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'id', r.id,
    'username', r.username,
    'public_data', coalesce(r.public_data, '{}'::jsonb),
    'private_data', coalesce(r.private_data, '{}'::jsonb),
    'created_at', r.created_at,
    'updated_at', r.updated_at
  );
end;
$$;

revoke all on function public.rivo_get_current_profile() from public;
grant execute on function public.rivo_get_current_profile() to authenticated;

notify pgrst, 'reload schema';
