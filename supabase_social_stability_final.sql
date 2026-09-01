-- Rivo social stability final migration
-- Run AFTER the current schema/economy migrations.
-- Safe to run repeatedly.
--
-- Goals:
-- 1) Keep Like/Unlike and Follow/Unfollow authorized through SECURITY DEFINER RPCs.
-- 2) Set the transaction-local profile-write bypass before trusted cross-profile writes.
-- 3) Return an authoritative follower count from the follow RPC and public profile RPC.
-- 4) Keep direct client profile writes protected by the existing guard/RLS.

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
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  perform set_config('rivo.internal_profile_save','on',true);

  select * into me
  from public.profiles
  where id = auth.uid()
  for update;
  if not found then raise exception 'Not signed in'; end if;
  if me.is_banned then raise exception 'Your account is blocked'; end if;

  select * into target
  from public.profiles
  where username = lower(trim(both '@' from p_username))
  for update;
  if not found then raise exception 'User not found'; end if;
  if target.is_banned then raise exception 'This account is unavailable'; end if;
  if target.id = me.id then raise exception 'You cannot like your own profile'; end if;

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

  update public.profiles
  set public_data = jsonb_set(
    coalesce(public_data,'{}'::jsonb),
    '{likes}',
    jsonb_build_object('count',jsonb_array_length(users),'users',users),
    true
  ),
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

create or replace function public.rivo_toggle_follow(p_target_username text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me public.profiles;
  target public.profiles;
  following jsonb;
  followers jsonb;
  now_following boolean;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  perform set_config('rivo.internal_profile_save','on',true);

  select * into me
  from public.profiles
  where id = auth.uid()
  for update;
  if not found then raise exception 'Not signed in'; end if;
  if me.is_banned then raise exception 'Your account is blocked'; end if;

  select * into target
  from public.profiles
  where username = lower(trim(both '@' from p_target_username))
  for update;
  if not found then raise exception 'User not found'; end if;
  if target.is_banned then raise exception 'This account is unavailable'; end if;
  if me.id = target.id then raise exception 'You cannot follow yourself'; end if;

  following := coalesce(me.public_data->'following','[]'::jsonb);
  followers := coalesce(target.public_data->'followers','[]'::jsonb);
  now_following := following ? target.username;

  if now_following then
    select coalesce(jsonb_agg(v order by v),'[]'::jsonb) into following
    from jsonb_array_elements(following) v
    where v <> to_jsonb(target.username);

    select coalesce(jsonb_agg(v order by v),'[]'::jsonb) into followers
    from jsonb_array_elements(followers) v
    where v <> to_jsonb(me.username);

    now_following := false;
  else
    if not (following ? target.username) then
      following := following || to_jsonb(target.username);
    end if;
    if not (followers ? me.username) then
      followers := followers || to_jsonb(me.username);
    end if;
    now_following := true;
  end if;

  update public.profiles
  set public_data = jsonb_set(coalesce(public_data,'{}'::jsonb),'{following}',following,true),
      updated_at = now()
  where id = me.id;

  update public.profiles
  set public_data = jsonb_set(coalesce(public_data,'{}'::jsonb),'{followers}',followers,true),
      updated_at = now()
  where id = target.id;

  return jsonb_build_object(
    'following', now_following,
    'followers_count', jsonb_array_length(followers)
  );
end;
$$;
revoke all on function public.rivo_toggle_follow(text) from public;
grant execute on function public.rivo_toggle_follow(text) to authenticated;

create or replace function public.rivo_add_view(p_username text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  target public.profiles;
  viewer uuid := auth.uid();
begin
  perform set_config('rivo.internal_profile_save','on',true);
  select * into target
  from public.profiles
  where username = lower(trim(both '@' from p_username))
  for update;
  if not found then return false; end if;

  update public.profiles
  set public_data = jsonb_set(
        coalesce(public_data,'{}'::jsonb),
        '{stats,views}',
        to_jsonb(coalesce((public_data->'stats'->>'views')::int,0) + 1),
        true
      ),
      updated_at = now()
  where id = target.id;

  if viewer is not null then
    insert into public.rivo_profile_views(profile_id,viewer_id)
    values(target.id,viewer);
  end if;
  return true;
end;
$$;
revoke all on function public.rivo_add_view(text) from public;
grant execute on function public.rivo_add_view(text) to anon, authenticated;

create or replace function public.rivo_get_public_profile(p_username text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.profiles;
  follower_names jsonb;
  follower_count int;
  story_row public.rivo_stories;
begin
  perform public.rivo_cleanup_expired_stories();

  select * into r
  from public.profiles
  where username = lower(trim(both '@' from p_username))
  limit 1;
  if not found then return null; end if;

  -- Canonical follower list/count comes from the actual following graph.
  select coalesce(jsonb_agg(p.username order by p.username),'[]'::jsonb), count(*)::int
    into follower_names, follower_count
  from public.profiles p
  where coalesce(p.public_data->'following','[]'::jsonb) ? r.username;

  select * into story_row
  from public.rivo_stories
  where user_id = r.id
    and expires_at > now()
    and media_type like 'image/%'
  order by created_at desc
  limit 1;

  return jsonb_build_object(
    'userId',r.id,
    'username',r.username,
    'displayName',coalesce(r.public_data->>'displayName',r.username),
    'bio',coalesce(r.public_data->>'bio',''),
    'description',coalesce(r.public_data->>'description',''),
    'location',coalesce(r.public_data->>'location',''),
    'website',coalesce(r.public_data->>'website',''),
    'avatar',coalesce(r.public_data->>'avatar',''),
    'banner',coalesce(r.public_data->>'banner',''),
    'miniImage',coalesce(r.public_data->>'miniImage',''),
    'status',coalesce(r.public_data->>'status','Online'),
    'customStatus',coalesce(r.public_data->>'customStatus',''),
    'theme',coalesce(r.public_data->>'theme','obsidian'),
    'template',coalesce(r.public_data->>'template','discord-noir'),
    'accent',coalesce(r.public_data->>'accent','#7488ff'),
    'cardRadius',coalesce((r.public_data->>'cardRadius')::numeric,24),
    'cardStyle',coalesce(r.public_data->>'cardStyle','glass'),
    'glow',coalesce((r.public_data->>'glow')::numeric,45),
    'background',coalesce(r.public_data->>'background','aurora'),
    'animation',coalesce(r.public_data->>'animation','soft'),
    'socials',coalesce(r.public_data->'socials','[]'::jsonb),
    'skills',coalesce(r.public_data->'skills','[]'::jsonb),
    'badges',coalesce(r.public_data->'badges','[]'::jsonb),
    'projects',coalesce(r.public_data->'projects','[]'::jsonb),
    'friends',coalesce(r.public_data->'friends','[]'::jsonb),
    'followers',follower_names,
    'followersCount',follower_count,
    'sections',coalesce(r.public_data->'sections','[]'::jsonb),
    'music',coalesce(r.public_data->'music','{}'::jsonb),
    'avatarFrame',coalesce(r.public_data->>'avatarFrame','none'),
    'avatarFrameColor',coalesce(r.public_data->>'avatarFrameColor','#8b5cf6'),
    'avatarFrameGlow',coalesce((r.public_data->>'avatarFrameGlow')::numeric,35),
    'avatarFrameWidth',coalesce((r.public_data->>'avatarFrameWidth')::numeric,3),
    'stats',coalesce(r.public_data->'stats',jsonb_build_object('views',0)),
    'likes',jsonb_build_object(
      'count',coalesce((r.public_data->'likes'->>'count')::int,0),
      'users',coalesce(r.public_data->'likes'->'users','[]'::jsonb)
    ),
    'messagePrivacy',coalesce(r.private_data->'messageSettings'->>'whoCanMessage','everyone'),
    'callPrivacy',coalesce(r.private_data->'callSettings'->>'whoCanCall','everyone'),
    'story',case when story_row.id is null then null else jsonb_build_object(
      'active',true,
      'story_id',story_row.id,
      'created_at',story_row.created_at,
      'expires_at',story_row.expires_at
    ) end,
    'equippedStoreItems',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',s.id,'name',s.name,'description',s.description,'type',s.type,
        'price',s.price,'image_url',s.image_url,'is_equipped',ui.is_equipped
      ) order by s.type,s.name)
      from public.user_inventory ui
      join public.store_items s on s.id = ui.item_id
      where ui.user_id = r.id and ui.is_equipped and s.is_active
    ),'[]'::jsonb),
    'createdAt',r.created_at,
    'updatedAt',r.updated_at
  );
end;
$$;
revoke all on function public.rivo_get_public_profile(text) from public;
grant execute on function public.rivo_get_public_profile(text) to anon, authenticated;

select 'Rivo social stability final migration installed' as status;


-- ---------------------------------------------------------------------------
-- FINAL FOLLOWER CONSISTENCY RECONCILIATION
-- ---------------------------------------------------------------------------
-- Rebuild each profile's cached followers array from the canonical following graph.
-- Run once after installing this migration; safe to repeat.
create or replace function public.rivo_reconcile_follower_caches()
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare
  changed integer := 0;
  r public.profiles;
  names jsonb;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if not public.rivo_is_admin(auth.uid()) then
    raise exception 'Access denied';
  end if;

  for r in select * from public.profiles loop
    select coalesce(jsonb_agg(p.username order by p.username),'[]'::jsonb)
      into names
    from public.profiles p
    where coalesce(p.public_data->'following','[]'::jsonb) ? r.username;

    if coalesce(r.public_data->'followers','[]'::jsonb) is distinct from names then
      perform set_config('rivo.internal_profile_save','on',true);
      update public.profiles
      set public_data=jsonb_set(coalesce(public_data,'{}'::jsonb),'{followers}',names,true),
          updated_at=now()
      where id=r.id;
      changed := changed + 1;
    end if;
  end loop;
  return changed;
end;
$$;
revoke all on function public.rivo_reconcile_follower_caches() from public;
grant execute on function public.rivo_reconcile_follower_caches() to authenticated;

select 'Rivo final signup radius + follower consistency fixes installed' as status;
