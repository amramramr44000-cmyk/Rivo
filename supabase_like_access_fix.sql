-- Rivo: minimal Like access fix
-- RUN THIS FILE LAST, after ALL existing Rivo SQL migrations.
-- This migration changes ONLY the profile-like RPC. It does not alter
-- tables, RLS policies, the guard trigger, follower logic, signup logic,
-- or any frontend files.
-- Safe to run repeatedly.

create or replace function public.rivo_toggle_like(p_username text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me public.profiles;
  target public.profiles;
  users jsonb;
  idx int;
  liked boolean;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  -- The profiles guard allows trusted SECURITY DEFINER social operations
  -- to update another user's profile only when this transaction-local flag
  -- is set. Without it, Like reaches the guard and returns "Access denied".
  perform set_config('rivo.internal_profile_save','on',true);

  select * into me
  from public.profiles
  where id = auth.uid();
  if not found then
    raise exception 'Not signed in';
  end if;
  if me.is_banned then
    raise exception 'Your account is blocked';
  end if;

  select * into target
  from public.profiles
  where username = lower(trim(both '@' from p_username))
  for update;
  if not found then
    raise exception 'User not found';
  end if;
  if target.is_banned then
    raise exception 'This account is unavailable';
  end if;
  if target.id = me.id then
    raise exception 'You cannot like your own profile';
  end if;

  users := coalesce(target.public_data->'likes'->'users','[]'::jsonb);
  idx := null;

  select ordinality - 1 into idx
  from jsonb_array_elements_text(users) with ordinality
  where value = me.username
  limit 1;

  if idx is null then
    users := users || to_jsonb(me.username);
    liked := true;
  else
    users := (
      select coalesce(jsonb_agg(value order by ordinality),'[]'::jsonb)
      from jsonb_array_elements_text(users) with ordinality
      where ordinality - 1 <> idx
    );
    liked := false;
  end if;

  target.public_data := jsonb_set(
    coalesce(target.public_data,'{}'::jsonb),
    '{likes}',
    jsonb_build_object(
      'count', jsonb_array_length(users),
      'users', users
    ),
    true
  );

  update public.profiles
  set public_data = target.public_data,
      updated_at = now()
  where id = target.id;

  return jsonb_build_object(
    'liked', liked,
    'count', jsonb_array_length(users)
  );
end;
$$;

revoke all on function public.rivo_toggle_like(text) from public;
grant execute on function public.rivo_toggle_like(text) to authenticated;

select 'Rivo Like access fix installed' as status;
