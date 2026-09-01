-- Rivo Admin Economy Controls
-- Run AFTER the current Rivo schema/economy migrations.
-- Adds an admin-only RPC for setting a user's coin balance.

create or replace function public.rivo_admin_set_coins(p_username text, p_coins bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.profiles;
  clean_username text := lower(trim(both '@' from coalesce(p_username, '')));
begin
  if not public.rivo_is_admin(auth.uid()) then
    raise exception 'Access denied';
  end if;

  if p_coins is null or p_coins < 0 then
    raise exception 'Coin amount must be zero or greater';
  end if;

  select * into target
  from public.profiles
  where username = clean_username
  for update;

  if target.id is null then
    raise exception 'User not found';
  end if;

  -- Allow only this trusted server-side admin operation to cross the
  -- coins_balance trigger. The setting is local to this transaction.
  perform set_config('rivo.internal_coin_update', 'on', true);

  update public.profiles
  set coins_balance = p_coins,
      updated_at = now()
  where id = target.id;

  return jsonb_build_object(
    'userId', target.id,
    'username', target.username,
    'coins_balance', p_coins
  );
end;
$$;

revoke all on function public.rivo_admin_set_coins(text, bigint) from public;
grant execute on function public.rivo_admin_set_coins(text, bigint) to authenticated;

-- Include the balance in admin account lookup/list results.
create or replace function public.rivo_admin_list_users(p_query text default '', p_limit int default 100)
returns setof jsonb
language sql
stable
security definer
set search_path=public
as $$
  select jsonb_build_object(
    'userId',p.id,
    'username',p.username,
    'displayName',coalesce(p.public_data->>'displayName',p.username),
    'avatar',coalesce(p.public_data->>'avatar',''),
    'is_banned',p.is_banned,
    'views',coalesce((p.public_data->'stats'->>'views')::int,0),
    'likes',coalesce((p.public_data->'likes'->>'count')::int,0),
    'coins_balance',p.coins_balance,
    'created_at',p.created_at
  )
  from public.profiles p
  where public.rivo_is_admin(auth.uid())
    and (p_query='' or p.username ilike '%'||lower(p_query)||'%' or coalesce(p.public_data->>'displayName','') ilike '%'||p_query||'%')
  order by p.created_at desc
  limit greatest(1,least(coalesce(p_limit,100),200));
$$;
revoke all on function public.rivo_admin_list_users(text,int) from public;
grant execute on function public.rivo_admin_list_users(text,int) to authenticated;

create or replace function public.rivo_admin_get_user_details(p_username text)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  p public.profiles;
  vis jsonb;
begin
  if not public.rivo_is_admin(auth.uid()) then raise exception 'Access denied'; end if;

  select * into p
  from public.profiles
  where username=lower(trim(both '@' from p_username));

  if p.id is null then return null; end if;

  select coalesce(jsonb_agg(x order by x.last_seen desc),'[]'::jsonb) into vis
  from (
    select pr.username,
           coalesce(pr.public_data->>'displayName',pr.username) as display_name,
           max(v.viewed_at) as last_seen,
           count(*)::int as visits
    from public.rivo_profile_views v
    join public.profiles pr on pr.id=v.viewer_id
    where v.profile_id=p.id
    group by pr.id,pr.username,pr.public_data->>'displayName'
    order by max(v.viewed_at) desc
    limit 50
  ) x;

  return jsonb_build_object(
    'userId',p.id,
    'username',p.username,
    'displayName',coalesce(p.public_data->>'displayName',p.username),
    'is_banned',p.is_banned,
    'created_at',p.created_at,
    'coins_balance',coalesce(p.coins_balance,0),
    'views',coalesce((p.public_data->'stats'->>'views')::int,0),
    'likes',coalesce((p.public_data->'likes'->>'count')::int,0),
    'friends',jsonb_array_length(coalesce(p.public_data->'friends','[]'::jsonb)),
    'visitors',vis
  );
end;
$$;
revoke all on function public.rivo_admin_get_user_details(text) from public;
grant execute on function public.rivo_admin_get_user_details(text) to authenticated;

select 'Rivo admin economy controls installed' as status;
