-- Rivo Social + Economy interoperability fix v2
-- Run AFTER: supabase_economy.sql
-- Safe to run repeatedly.
--
-- Root cause fixed here:
-- trusted SECURITY DEFINER social RPCs write to another user's profiles row.
-- On installations that still have the legacy profile-write guard, those
-- legitimate RPC writes are rejected unless the transaction-local trusted
-- flag is enabled. The previous patch covered likes/views/friendship but did
-- not cover follow/unfollow and request cancellation.
--
-- This migration also refreshes the public profile payload so follower
-- counters are derived from the actual following graph and the viewer's
-- own following list remains available through currentProfile().

-- ---------------------------------------------------------------------------
-- 1) FOLLOW / UNFOLLOW
-- ---------------------------------------------------------------------------
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

  -- Allow this trusted RPC to update the target profile row when the legacy
  -- profile guard is installed. This is transaction-local only.
  perform set_config('rivo.internal_profile_save','on',true);

  select * into me from public.profiles where id=auth.uid() for update;
  if not found then raise exception 'Not signed in'; end if;
  if me.is_banned then raise exception 'Your account is blocked'; end if;

  select * into target
  from public.profiles
  where username=lower(trim(both '@' from p_target_username))
  for update;
  if not found then raise exception 'User not found'; end if;
  if target.is_banned then raise exception 'This account is unavailable'; end if;
  if me.id=target.id then raise exception 'You cannot follow yourself'; end if;

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
    set public_data=jsonb_set(coalesce(public_data,'{}'::jsonb),'{following}',following,true),
        updated_at=now()
  where id=me.id;

  update public.profiles
    set public_data=jsonb_set(coalesce(public_data,'{}'::jsonb),'{followers}',followers,true),
        updated_at=now()
  where id=target.id;

  return jsonb_build_object(
    'following', now_following,
    'followers_count', jsonb_array_length(followers)
  );
end;
$$;
revoke all on function public.rivo_toggle_follow(text) from public;
grant execute on function public.rivo_toggle_follow(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2) CANCEL FRIEND REQUEST
-- ---------------------------------------------------------------------------
create or replace function public.rivo_cancel_friend_request(p_target_username text)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
declare
  me public.profiles;
  target public.profiles;
  outgoing jsonb;
  incoming jsonb;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  perform set_config('rivo.internal_profile_save','on',true);

  select * into me from public.profiles where id=auth.uid() for update;
  if not found then raise exception 'Not signed in'; end if;
  if me.is_banned then raise exception 'Your account is blocked'; end if;

  select * into target
  from public.profiles
  where username=lower(trim(both '@' from p_target_username))
  for update;
  if not found then raise exception 'User not found'; end if;
  if me.id=target.id then raise exception 'Invalid friend request'; end if;
  if target.is_banned then raise exception 'This account is unavailable'; end if;

  outgoing:=coalesce(me.private_data->'friendRequests'->'outgoing','[]'::jsonb);
  if not (outgoing ? target.username) then return false; end if;

  incoming:=coalesce(target.private_data->'friendRequests'->'incoming','[]'::jsonb);
  select coalesce(jsonb_agg(v order by v),'[]'::jsonb) into outgoing
  from jsonb_array_elements(outgoing) v
  where v <> to_jsonb(target.username);
  select coalesce(jsonb_agg(v order by v),'[]'::jsonb) into incoming
  from jsonb_array_elements(incoming) v
  where v <> to_jsonb(me.username);

  me.private_data:=jsonb_set(coalesce(me.private_data,'{}'::jsonb),'{friendRequests,outgoing}',outgoing,true);
  target.private_data:=jsonb_set(coalesce(target.private_data,'{}'::jsonb),'{friendRequests,incoming}',incoming,true);

  update public.profiles
    set private_data=me.private_data, updated_at=now()
  where id=me.id;
  update public.profiles
    set private_data=target.private_data, updated_at=now()
  where id=target.id;
  return true;
end;
$$;
revoke all on function public.rivo_cancel_friend_request(text) from public;
grant execute on function public.rivo_cancel_friend_request(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) FINAL PUBLIC PROFILE RPC
-- ---------------------------------------------------------------------------
create or replace function public.rivo_get_public_profile(p_username text)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  r public.profiles;
  story_row public.rivo_stories;
  follower_names jsonb;
  follower_count int;
begin
  perform public.rivo_cleanup_expired_stories();

  select * into r
  from public.profiles
  where username=lower(trim(both '@' from p_username))
  limit 1;
  if not found then return null; end if;

  select coalesce(jsonb_agg(p.username order by p.username),'[]'::jsonb), count(*)::int
    into follower_names, follower_count
  from public.profiles p
  where coalesce(p.public_data->'following','[]'::jsonb) ? r.username;

  select * into story_row
  from public.rivo_stories
  where user_id=r.id and expires_at > now() and media_type like 'image/%'
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
    -- Keep the existing followers array compatible, but expose a canonical
    -- list/count derived from the actual following graph as well.
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
        'id',s.id,
        'name',s.name,
        'description',s.description,
        'type',s.type,
        'price',s.price,
        'image_url',s.image_url,
        'is_equipped',ui.is_equipped
      ) order by s.type,s.name)
      from public.user_inventory ui
      join public.store_items s on s.id=ui.item_id
      where ui.user_id=r.id and ui.is_equipped and s.is_active
    ),'[]'::jsonb),
    'createdAt',r.created_at,
    'updatedAt',r.updated_at
  );
end;
$$;
revoke all on function public.rivo_get_public_profile(text) from public;
grant execute on function public.rivo_get_public_profile(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4) Refresh ALL cross-profile social RPCs in the same migration.
--    This makes the database self-consistent even if an older guard bypass
--    migration was never run.
-- ---------------------------------------------------------------------------

create or replace function public.rivo_toggle_like(p_username text)
returns jsonb
language plpgsql
security definer
set search_path=public
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
  select * into me from public.profiles where id=auth.uid();
  select * into target from public.profiles where username=lower(trim(both '@' from p_username)) for update;
  if me.id is null or target.id is null then raise exception 'User not found'; end if;
  if me.username=target.username then raise exception 'You cannot like your own profile'; end if;

  users:=coalesce(target.public_data->'likes'->'users','[]'::jsonb);
  idx:=null;
  select ordinality-1 into idx
  from jsonb_array_elements_text(users) with ordinality
  where value=me.username limit 1;

  if idx is null then
    users:=users||to_jsonb(me.username);
    liked:=true;
  else
    users:=(select coalesce(jsonb_agg(value order by ordinality),'[]'::jsonb)
            from jsonb_array_elements_text(users) with ordinality
            where ordinality-1<>idx);
    liked:=false;
  end if;

  target.public_data:=jsonb_set(
    coalesce(target.public_data,'{}'::jsonb),
    '{likes}',
    jsonb_build_object('count',jsonb_array_length(users),'users',users),
    true
  );
  update public.profiles set public_data=target.public_data,updated_at=now() where id=target.id;
  return jsonb_build_object('liked',liked,'count',jsonb_array_length(users));
end;
$$;
revoke all on function public.rivo_toggle_like(text) from public;
grant execute on function public.rivo_toggle_like(text) to authenticated;

create or replace function public.rivo_add_view(p_username text)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
declare
  target public.profiles;
  viewer uuid:=auth.uid();
begin
  perform set_config('rivo.internal_profile_save','on',true);
  select * into target
  from public.profiles
  where username=lower(trim(both '@' from p_username))
  for update;
  if target.id is null then return false; end if;
  if viewer is not null and viewer=target.id then return true; end if;

  target.public_data:=jsonb_set(
    coalesce(target.public_data,'{}'::jsonb),
    '{stats,views}',
    to_jsonb(coalesce((target.public_data->'stats'->>'views')::int,0)+1),
    true
  );
  update public.profiles set public_data=target.public_data,updated_at=now() where id=target.id;

  insert into public.rivo_profile_views(profile_id,viewer_id)
  values(target.id,viewer);
  return true;
end;
$$;
revoke all on function public.rivo_add_view(text) from public;
grant execute on function public.rivo_add_view(text) to anon, authenticated;

select 'Rivo social/economy interoperability fix v2 installed' as status;
