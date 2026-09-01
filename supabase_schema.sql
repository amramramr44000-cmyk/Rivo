-- Rivo / Supabase database setup
-- Run this whole file in Supabase SQL Editor.
-- Then create a Storage bucket named: rivo-media
-- and configure Auth -> Email -> "Confirm email" = OFF for the current username/password flow.

create extension if not exists pgcrypto;
-- v10 security notes:
-- * RLS intentionally prevents guest SELECT access to profiles. Login therefore
--   must not query public.profiles before authentication; the browser derives
--   the deterministic synthetic Auth email from the normalized username.
-- * Bot protection is layered in the browser with a dedicated Rivo human-check.
-- * Do not add a guest SELECT policy for auth_email. That would weaken account
--   privacy and was the root of the previous login implementation's RLS conflict.


create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9](?:[a-z0-9._-]{1,24})[a-z0-9]$'),
  auth_email text not null unique,
  public_data jsonb not null default '{}'::jsonb,
  private_data jsonb not null default jsonb_build_object(
    'friendRequests', jsonb_build_object('incoming', '[]'::jsonb, 'outgoing', '[]'::jsonb)
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Keep the live database constraint synchronized with the application validator.
-- CREATE TABLE IF NOT EXISTS does not modify an existing constraint, so this
-- explicit migration also fixes databases created by an older Rivo build.
alter table public.profiles drop constraint if exists profiles_username_check;
alter table public.profiles
  add constraint profiles_username_check
  check (username ~ '^[a-z0-9](?:[a-z0-9._-]{1,24})[a-z0-9]$');

create index if not exists profiles_username_idx on public.profiles(lower(username));
create index if not exists profiles_updated_idx on public.profiles(updated_at desc);

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles for select to authenticated
using (auth.uid() = id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
on public.profiles for insert to authenticated
with check (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles for update to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists "profiles_delete_own" on public.profiles;
create policy "profiles_delete_own"
on public.profiles for delete to authenticated
using (auth.uid() = id);

-- Used only as a rollback when signup created an Auth user but the
-- corresponding profile insert failed. The caller can delete only itself.
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

create or replace function public.rivo_username_exists(p_username text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists(
    select 1 from public.profiles
    where username = lower(trim(both '@' from p_username))
  );
$$;
revoke all on function public.rivo_username_exists(text) from public;
grant execute on function public.rivo_username_exists(text) to anon, authenticated;

create or replace function public.rivo_get_public_profile(p_username text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare r public.profiles;
begin
  select * into r from public.profiles
  where username = lower(trim(both '@' from p_username))
  limit 1;

  if not found then return null; end if;

  return jsonb_build_object(
    'userId', r.id,
    'username', r.username,
    'displayName', coalesce(r.public_data->>'displayName', r.username),
    'bio', coalesce(r.public_data->>'bio',''),
    'description', coalesce(r.public_data->>'description',''),
    'location', coalesce(r.public_data->>'location',''),
    'website', coalesce(r.public_data->>'website',''),
    'avatar', coalesce(r.public_data->>'avatar',''),
    'banner', coalesce(r.public_data->>'banner',''),
    'miniImage', coalesce(r.public_data->>'miniImage',''),
    'status', coalesce(r.public_data->>'status','Online'),
    'customStatus', coalesce(r.public_data->>'customStatus',''),
    'theme', coalesce(r.public_data->>'theme','obsidian'),
    'template', coalesce(r.public_data->>'template','discord-noir'),
    'accent', coalesce(r.public_data->>'accent','#7488ff'),
    'cardRadius', coalesce((r.public_data->>'cardRadius')::numeric,24),
    'cardStyle', coalesce(r.public_data->>'cardStyle','glass'),
    'glow', coalesce((r.public_data->>'glow')::numeric,45),
    'background', coalesce(r.public_data->>'background','aurora'),
    'animation', coalesce(r.public_data->>'animation','soft'),
    'socials', coalesce(r.public_data->'socials','[]'::jsonb),
    'skills', coalesce(r.public_data->'skills','[]'::jsonb),
    'badges', coalesce(r.public_data->'badges','[]'::jsonb),
    'projects', coalesce(r.public_data->'projects','[]'::jsonb),
    'friends', coalesce(r.public_data->'friends','[]'::jsonb),
    'sections', coalesce(r.public_data->'sections','[]'::jsonb),
    'music', coalesce(r.public_data->'music','{}'::jsonb),
    'avatarFrame', coalesce(r.public_data->>'avatarFrame','none'),
    'avatarFrameColor', coalesce(r.public_data->>'avatarFrameColor','#8b5cf6'),
    'avatarFrameGlow', coalesce((r.public_data->>'avatarFrameGlow')::numeric,35),
    'avatarFrameWidth', coalesce((r.public_data->>'avatarFrameWidth')::numeric,3),
    'stats', coalesce(r.public_data->'stats', jsonb_build_object('views',0)),
    'likes', jsonb_build_object(
      'count', coalesce((r.public_data->'likes'->>'count')::int,0),
      'users', coalesce(r.public_data->'likes'->'users','[]'::jsonb)
    ),
    -- Only the privacy *choice* is exposed publicly (never the friend list or
    -- requests) so a viewer's profile page can show a "Messages closed"
    -- state instead of a Message button that would just fail on send.
    'messagePrivacy', coalesce(r.private_data->'messageSettings'->>'whoCanMessage','everyone'),
    'createdAt', r.created_at,
    'updatedAt', r.updated_at
  );
end;
$$;
revoke all on function public.rivo_get_public_profile(text) from public;
grant execute on function public.rivo_get_public_profile(text) to anon, authenticated;

create or replace function public.rivo_list_public_profiles(p_limit int default 24)
returns setof jsonb
language sql
security definer
set search_path = public
as $$
  select public.rivo_get_public_profile(p.username)
  from public.profiles p
  order by p.updated_at desc
  limit greatest(1, least(p_limit, 100));
$$;
revoke all on function public.rivo_list_public_profiles(int) from public;
grant execute on function public.rivo_list_public_profiles(int) to anon, authenticated;

create or replace function public.rivo_search_profiles(p_query text, p_limit int default 24)
returns setof jsonb
language sql
security definer
set search_path = public
as $$
  select public.rivo_get_public_profile(p.username)
  from public.profiles p
  where p.username ilike '%' || lower(trim(both '@' from p_query)) || '%'
     or coalesce(p.public_data->>'displayName','') ilike '%' || trim(p_query) || '%'
  order by
    case when p.username = lower(trim(both '@' from p_query)) then 0 else 1 end,
    p.updated_at desc
  limit greatest(1, least(p_limit, 100));
$$;
revoke all on function public.rivo_search_profiles(text,int) from public;
grant execute on function public.rivo_search_profiles(text,int) to anon, authenticated;

create or replace function public.rivo_send_friend_request(p_target_username text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare me public.profiles; target public.profiles;
declare incoming jsonb; outgoing jsonb;
begin
  select * into me from public.profiles where id = auth.uid() for update;
  if not found then raise exception 'Not signed in'; end if;

  select * into target from public.profiles
  where username = lower(trim(both '@' from p_target_username)) for update;
  if not found then raise exception 'User not found'; end if;
  if me.id = target.id then raise exception 'You cannot add yourself'; end if;

  if coalesce(me.public_data->'friends','[]'::jsonb) ? target.username then
    raise exception 'Already friends';
  end if;

  outgoing := coalesce(me.private_data->'friendRequests'->'outgoing','[]'::jsonb);
  incoming := coalesce(target.private_data->'friendRequests'->'incoming','[]'::jsonb);

  if outgoing ? target.username or incoming ? me.username then
    raise exception 'Request already exists';
  end if;

  me.private_data := jsonb_set(
    coalesce(me.private_data,'{}'::jsonb),
    '{friendRequests,outgoing}',
    outgoing || to_jsonb(target.username)
  );
  target.private_data := jsonb_set(
    coalesce(target.private_data,'{}'::jsonb),
    '{friendRequests,incoming}',
    incoming || to_jsonb(me.username)
  );

  update public.profiles set private_data = me.private_data, updated_at = now() where id = me.id;
  update public.profiles set private_data = target.private_data, updated_at = now() where id = target.id;
  return true;
end;
$$;
grant execute on function public.rivo_send_friend_request(text) to authenticated;

create or replace function public.rivo_accept_friend_request(p_from_username text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare me public.profiles; other public.profiles;
declare incoming jsonb; outgoing jsonb;
declare mefriends jsonb; otherfriends jsonb;
begin
  select * into me from public.profiles where id = auth.uid() for update;
  select * into other from public.profiles where username = lower(trim(both '@' from p_from_username)) for update;
  if me.id is null or other.id is null then raise exception 'User not found'; end if;

  incoming := coalesce(me.private_data->'friendRequests'->'incoming','[]'::jsonb);
  if not (incoming ? other.username) then raise exception 'Request not found'; end if;
  outgoing := coalesce(other.private_data->'friendRequests'->'outgoing','[]'::jsonb);

  incoming := (select coalesce(jsonb_agg(x),'[]'::jsonb) from jsonb_array_elements_text(incoming) x where x <> other.username);
  outgoing := (select coalesce(jsonb_agg(x),'[]'::jsonb) from jsonb_array_elements_text(outgoing) x where x <> me.username);

  mefriends := coalesce(me.public_data->'friends','[]'::jsonb);
  otherfriends := coalesce(other.public_data->'friends','[]'::jsonb);
  if not (mefriends ? other.username) then mefriends := mefriends || to_jsonb(other.username); end if;
  if not (otherfriends ? me.username) then otherfriends := otherfriends || to_jsonb(me.username); end if;

  me.private_data := jsonb_set(jsonb_set(coalesce(me.private_data,'{}'::jsonb),'{friendRequests,incoming}',incoming),'{friendRequests,outgoing}',coalesce(me.private_data->'friendRequests'->'outgoing','[]'::jsonb));
  other.private_data := jsonb_set(jsonb_set(coalesce(other.private_data,'{}'::jsonb),'{friendRequests,outgoing}',outgoing),'{friendRequests,incoming}',coalesce(other.private_data->'friendRequests'->'incoming','[]'::jsonb));

  me.public_data := jsonb_set(coalesce(me.public_data,'{}'::jsonb),'{friends}',mefriends);
  other.public_data := jsonb_set(coalesce(other.public_data,'{}'::jsonb),'{friends}',otherfriends);

  update public.profiles set public_data=me.public_data, private_data=me.private_data, updated_at=now() where id=me.id;
  update public.profiles set public_data=other.public_data, private_data=other.private_data, updated_at=now() where id=other.id;
  return true;
end;
$$;
grant execute on function public.rivo_accept_friend_request(text) to authenticated;

create or replace function public.rivo_reject_friend_request(p_from_username text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare me public.profiles; other public.profiles;
declare incoming jsonb; outgoing jsonb;
begin
  select * into me from public.profiles where id=auth.uid() for update;
  select * into other from public.profiles where username=lower(trim(both '@' from p_from_username)) for update;
  if me.id is null or other.id is null then raise exception 'User not found'; end if;
  incoming := coalesce(me.private_data->'friendRequests'->'incoming','[]'::jsonb);
  outgoing := coalesce(other.private_data->'friendRequests'->'outgoing','[]'::jsonb);
  incoming := (select coalesce(jsonb_agg(x),'[]'::jsonb) from jsonb_array_elements_text(incoming) x where x <> other.username);
  outgoing := (select coalesce(jsonb_agg(x),'[]'::jsonb) from jsonb_array_elements_text(outgoing) x where x <> me.username);
  me.private_data := jsonb_set(coalesce(me.private_data,'{}'::jsonb),'{friendRequests,incoming}',incoming);
  other.private_data := jsonb_set(coalesce(other.private_data,'{}'::jsonb),'{friendRequests,outgoing}',outgoing);
  update public.profiles set private_data=me.private_data,updated_at=now() where id=me.id;
  update public.profiles set private_data=other.private_data,updated_at=now() where id=other.id;
  return true;
end;
$$;
grant execute on function public.rivo_reject_friend_request(text) to authenticated;

create or replace function public.rivo_remove_friend(p_username text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare me public.profiles; other public.profiles;
declare f jsonb;
begin
  select * into me from public.profiles where id=auth.uid() for update;
  select * into other from public.profiles where username=lower(trim(both '@' from p_username)) for update;
  if me.id is null or other.id is null then raise exception 'User not found'; end if;

  f := coalesce(me.public_data->'friends','[]'::jsonb);
  me.public_data := jsonb_set(coalesce(me.public_data,'{}'::jsonb),'{friends}',
    (select coalesce(jsonb_agg(x),'[]'::jsonb) from jsonb_array_elements_text(f) x where x <> other.username));
  f := coalesce(other.public_data->'friends','[]'::jsonb);
  other.public_data := jsonb_set(coalesce(other.public_data,'{}'::jsonb),'{friends}',
    (select coalesce(jsonb_agg(x),'[]'::jsonb) from jsonb_array_elements_text(f) x where x <> me.username));

  update public.profiles set public_data=me.public_data,updated_at=now() where id=me.id;
  update public.profiles set public_data=other.public_data,updated_at=now() where id=other.id;
  return true;
end;
$$;
grant execute on function public.rivo_remove_friend(text) to authenticated;

create or replace function public.rivo_toggle_like(p_username text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare me public.profiles; target public.profiles;
declare users jsonb; idx int; liked boolean;
begin
  select * into me from public.profiles where id=auth.uid();
  select * into target from public.profiles where username=lower(trim(both '@' from p_username)) for update;
  if me.id is null or target.id is null then raise exception 'User not found'; end if;
  if me.username = target.username then raise exception 'You cannot like your own profile'; end if;

  users := coalesce(target.public_data->'likes'->'users','[]'::jsonb);
  idx := null;
  select ordinality-1 into idx
    from jsonb_array_elements_text(users) with ordinality
    where value = me.username
    limit 1;
  if idx is null then
    users := users || to_jsonb(me.username); liked := true;
  else
    users := (select coalesce(jsonb_agg(value),'[]'::jsonb) from jsonb_array_elements_text(users) with ordinality where ordinality-1 <> idx);
    liked := false;
  end if;

  target.public_data := jsonb_set(
    coalesce(target.public_data,'{}'::jsonb),
    '{likes}',
    jsonb_build_object('count',jsonb_array_length(users),'users',users)
  );
  update public.profiles set public_data=target.public_data,updated_at=now() where id=target.id;
  return jsonb_build_object('liked',liked,'count',jsonb_array_length(users));
end;
$$;
grant execute on function public.rivo_toggle_like(text) to authenticated;

create or replace function public.rivo_add_view(p_username text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare target public.profiles;
begin
  select * into target from public.profiles where username=lower(trim(both '@' from p_username)) for update;
  if target.id is null then return false; end if;
  target.public_data := jsonb_set(
    coalesce(target.public_data,'{}'::jsonb),
    '{stats,views}',
    to_jsonb(coalesce((target.public_data->'stats'->>'views')::int,0)+1)
  );
  update public.profiles set public_data=target.public_data,updated_at=now() where id=target.id;
  return true;
end;
$$;
grant execute on function public.rivo_add_view(text) to anon, authenticated;

-- Storage bucket
insert into storage.buckets (id, name, public)
values ('rivo-media','rivo-media',true)
on conflict (id) do update set public = true;

drop policy if exists "rivo_media_read" on storage.objects;
create policy "rivo_media_read"
on storage.objects for select to public
using (bucket_id='rivo-media');

drop policy if exists "rivo_media_insert" on storage.objects;
create policy "rivo_media_insert"
on storage.objects for insert to authenticated
with check (bucket_id='rivo-media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "rivo_media_update" on storage.objects;
create policy "rivo_media_update"
on storage.objects for update to authenticated
using (bucket_id='rivo-media' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id='rivo-media' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "rivo_media_delete" on storage.objects;
create policy "rivo_media_delete"
on storage.objects for delete to authenticated
using (bucket_id='rivo-media' and (storage.foldername(name))[1] = auth.uid()::text);


-- ============================================================
-- Rivo messaging (text only)
-- Safe migration: does not alter or delete existing profile data.
-- ============================================================


-- Batch public-profile lookup used by Friends/Profile pages to avoid N network calls.
create or replace function public.rivo_get_public_profiles(p_usernames text[])
returns setof jsonb
language sql
security definer
set search_path = public
as $$
  select public.rivo_get_public_profile(p.username)
  from public.profiles p
  where p.username = any(
    array(
      select lower(trim(both '@' from x))
      from unnest(coalesce(p_usernames, '{}'::text[])) as x
    )
  )
  order by array_position(
    array(
      select lower(trim(both '@' from x))
      from unnest(coalesce(p_usernames, '{}'::text[])) as x
    ),
    p.username
  );
$$;
revoke all on function public.rivo_get_public_profiles(text[]) from public;
grant execute on function public.rivo_get_public_profiles(text[]) to anon, authenticated;

-- Call privacy is stored privately alongside message privacy.
create or replace function public.rivo_set_call_setting(p_who_can_call text)
returns text language plpgsql security definer set search_path = public as $$
declare v text := case
  when p_who_can_call = 'friends' then 'friends'
  when p_who_can_call = 'nobody' then 'nobody'
  else 'everyone' end;
begin
  update public.profiles set private_data = jsonb_set(coalesce(private_data,'{}'::jsonb), '{callSettings,whoCanCall}', to_jsonb(v), true), updated_at=now() where id=auth.uid();
  if not found then raise exception 'Profile not found'; end if;
  return v;
end; $$;
revoke all on function public.rivo_set_call_setting(text) from public;
grant execute on function public.rivo_set_call_setting(text) to authenticated;

create or replace function public.rivo_can_call_user(p_target_username text)
returns boolean language plpgsql security definer set search_path = public as $$
declare me public.profiles; target public.profiles; setting text; is_friend boolean := false;
begin
  select * into me from public.profiles where id=auth.uid();
  select * into target from public.profiles where username=lower(trim(both '@' from p_target_username));
  if me.id is null or target.id is null or me.id=target.id then return false; end if;
  setting := coalesce(target.private_data->'callSettings'->>'whoCanCall','everyone');
  if setting='nobody' then return false; end if;
  if setting='friends' then
    is_friend := coalesce(me.public_data->'friends','[]'::jsonb) ? target.username;
    return is_friend;
  end if;
  return true;
end; $$;
revoke all on function public.rivo_can_call_user(text) from public;
grant execute on function public.rivo_can_call_user(text) to authenticated;

create or replace function public.rivo_can_receive_call(p_caller_username text)
returns boolean language plpgsql security definer set search_path=public as $$
declare me public.profiles; caller public.profiles; setting text;
begin
  select * into me from public.profiles where id=auth.uid();
  select * into caller from public.profiles where username=lower(trim(both '@' from p_caller_username));
  if me.id is null or caller.id is null or me.id=caller.id then return false; end if;
  setting:=coalesce(me.private_data->'callSettings'->>'whoCanCall','everyone');
  if setting='nobody' then return false; end if;
  if setting='friends' then return coalesce(me.public_data->'friends','[]'::jsonb) ? caller.username; end if;
  return true;
end; $$;
revoke all on function public.rivo_can_receive_call(text) from public;
grant execute on function public.rivo_can_receive_call(text) to authenticated;

-- Messaging tables
create table if not exists public.rivo_messages (
  id bigint generated by default as identity primary key,
  sender_id uuid not null references auth.users(id) on delete cascade,
  receiver_id uuid not null references auth.users(id) on delete cascade,
  content text not null check (char_length(trim(content)) between 1 and 2000),
  created_at timestamptz not null default now(),
  check (sender_id <> receiver_id)
);

create index if not exists rivo_messages_sender_receiver_idx
  on public.rivo_messages(sender_id, receiver_id, created_at desc);
create index if not exists rivo_messages_receiver_sender_idx
  on public.rivo_messages(receiver_id, sender_id, created_at desc);
create index if not exists rivo_messages_created_idx
  on public.rivo_messages(created_at desc);

alter table public.rivo_messages enable row level security;

drop policy if exists "rivo_messages_select_own" on public.rivo_messages;
create policy "rivo_messages_select_own"
on public.rivo_messages for select to authenticated
using (auth.uid() = sender_id or auth.uid() = receiver_id);

drop policy if exists "rivo_messages_insert_sender" on public.rivo_messages;
-- Clients cannot insert directly. Messages are created only through
-- the security-definer RPC below, which validates the recipient policy.


-- Store messaging preference privately inside the existing private_data JSON.
-- Default is everyone, so existing users keep their current behavior.
-- 'nobody' fully closes messages: nobody at all can message this user,
-- friends included.
create or replace function public.rivo_set_message_setting(p_who_can_message text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare v text := case
  when p_who_can_message = 'friends' then 'friends'
  when p_who_can_message = 'nobody' then 'nobody'
  else 'everyone'
end;
begin
  update public.profiles
  set private_data = jsonb_set(
    coalesce(private_data,'{}'::jsonb),
    '{messageSettings,whoCanMessage}',
    to_jsonb(v), true
  ),
  updated_at = now()
  where id = auth.uid();
  if not found then raise exception 'Profile not found'; end if;
  return v;
end;
$$;
revoke all on function public.rivo_set_message_setting(text) from public;
grant execute on function public.rivo_set_message_setting(text) to authenticated;

-- NOTE: rivo_send_message is defined once, further down (search for
-- "Message notification + banned-account guard."), together with
-- rivo_send_friend_request, rivo_get_messages and rivo_add_view. This file
-- used to define each of those twice — once here, once again lower down
-- with added checks (banned-account guard, notifications) — which is
-- confusing to maintain and risks the *wrong* copy being the one still
-- live on your Supabase project if only part of the file was ever re-run.
-- The weaker, older copy that used to sit here has been removed; only the
-- complete version further down remains.

create or replace function public.rivo_get_messages(p_other_username text, p_limit int default 80)
returns setof jsonb
language plpgsql
security definer
set search_path = public
as $$
declare me_id uuid := auth.uid();
other_id uuid;
begin
  select id into other_id from public.profiles
  where username = lower(trim(both '@' from p_other_username));
  if me_id is null then raise exception 'Not signed in'; end if;
  if other_id is null then raise exception 'User not found'; end if;

  return query
  select jsonb_build_object(
    'id', m.id,
    'sender_username', s.username,
    'receiver_username', r.username,
    'content', m.content,
    'created_at', m.created_at
  )
  from public.rivo_messages m
  join public.profiles s on s.id = m.sender_id
  join public.profiles r on r.id = m.receiver_id
  where (m.sender_id = me_id and m.receiver_id = other_id)
     or (m.sender_id = other_id and m.receiver_id = me_id)
  order by m.created_at desc
  limit greatest(1, least(coalesce(p_limit,80), 200));
end;
$$;
revoke all on function public.rivo_get_messages(text,int) from public;
grant execute on function public.rivo_get_messages(text,int) to authenticated;

create or replace function public.rivo_list_conversations()
returns setof jsonb
language sql
security definer
set search_path = public
as $$
with ranked as (
  select
    m.*,
    row_number() over (
      partition by least(m.sender_id,m.receiver_id), greatest(m.sender_id,m.receiver_id)
      order by m.created_at desc
    ) as rn
  from public.rivo_messages m
  where m.sender_id = auth.uid() or m.receiver_id = auth.uid()
), latest as (
  select * from ranked where rn = 1
)
select jsonb_build_object(
  'userId', other.id,
  'username', other.username,
  'displayName', coalesce(other.public_data->>'displayName', other.username),
  'avatar', coalesce(other.public_data->>'avatar',''),
  'lastMessage', latest.content,
  'createdAt', latest.created_at,
  'updatedLabel', to_char(latest.created_at at time zone 'UTC', 'Mon DD')
)
from latest
join public.profiles other on other.id = case when latest.sender_id = auth.uid() then latest.receiver_id else latest.sender_id end
order by latest.created_at desc;
$$;
revoke all on function public.rivo_list_conversations() from public;
grant execute on function public.rivo_list_conversations() to authenticated;

-- Realtime for live incoming text messages.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'rivo_messages'
  ) then
    alter publication supabase_realtime add table public.rivo_messages;
  end if;
end $$;


-- ============================================================
-- Rivo v5: notifications, message reactions, profile visitors,
-- moderation/admin controls and privacy-safe account controls.
-- ============================================================

alter table public.profiles add column if not exists is_banned boolean not null default false;
create index if not exists profiles_banned_idx on public.profiles(is_banned);

create table if not exists public.rivo_notifications (
  id bigint generated by default as identity primary key,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  type text not null check (type in ('message','friend_request','friend_accept','system')),
  body text not null default '',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists rivo_notifications_recipient_idx on public.rivo_notifications(recipient_id, created_at desc);
alter table public.rivo_notifications enable row level security;
drop policy if exists "rivo_notifications_select_own" on public.rivo_notifications;
create policy "rivo_notifications_select_own" on public.rivo_notifications for select to authenticated using (auth.uid() = recipient_id);
drop policy if exists "rivo_notifications_update_own" on public.rivo_notifications;
create policy "rivo_notifications_update_own" on public.rivo_notifications for update to authenticated using (auth.uid() = recipient_id) with check (auth.uid() = recipient_id);

create table if not exists public.rivo_message_reactions (
  message_id bigint not null references public.rivo_messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reaction text not null check (reaction in ('❤️','😂','👍','😮','😢')),
  created_at timestamptz not null default now(),
  primary key(message_id,user_id)
);
create index if not exists rivo_message_reactions_message_idx on public.rivo_message_reactions(message_id);
alter table public.rivo_message_reactions replica identity full;
alter table public.rivo_message_reactions enable row level security;
drop policy if exists "rivo_message_reactions_select_conversation" on public.rivo_message_reactions;
create policy "rivo_message_reactions_select_conversation" on public.rivo_message_reactions for select to authenticated using (
  exists (select 1 from public.rivo_messages m where m.id = message_id and (m.sender_id = auth.uid() or m.receiver_id = auth.uid()))
);

create table if not exists public.rivo_profile_views (
  id bigint generated by default as identity primary key,
  profile_id uuid not null references auth.users(id) on delete cascade,
  viewer_id uuid references auth.users(id) on delete set null,
  viewed_at timestamptz not null default now()
);
create index if not exists rivo_profile_views_profile_idx on public.rivo_profile_views(profile_id, viewed_at desc);
create index if not exists rivo_profile_views_viewer_idx on public.rivo_profile_views(viewer_id, viewed_at desc);
alter table public.rivo_profile_views enable row level security;


create table if not exists public.rivo_admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.rivo_admin_users enable row level security;
drop policy if exists "rivo_admin_users_select_self" on public.rivo_admin_users;
create policy "rivo_admin_users_select_self" on public.rivo_admin_users for select to authenticated using (user_id = auth.uid());

create or replace function public.rivo_is_admin(p_user_id uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.rivo_admin_users where user_id = p_user_id and p_user_id = auth.uid());
$$;
revoke all on function public.rivo_is_admin(uuid) from public;

create or replace function public.rivo_admin_is_admin()
returns boolean language sql stable security definer set search_path=public as $$ select public.rivo_is_admin(auth.uid()); $$;
revoke all on function public.rivo_admin_is_admin() from public;
grant execute on function public.rivo_admin_is_admin() to authenticated;

create or replace function public.rivo_write_notification(p_recipient uuid, p_actor uuid, p_type text, p_body text, p_payload jsonb default '{}'::jsonb)
returns bigint language plpgsql security definer set search_path=public as $$
declare nid bigint;
begin
  if p_recipient is null or p_type not in ('message','friend_request','friend_accept','system') then return null; end if;
  insert into public.rivo_notifications(recipient_id,actor_id,type,body,payload)
  values(p_recipient,p_actor,p_type,coalesce(p_body,''),coalesce(p_payload,'{}'::jsonb)) returning id into nid;
  return nid;
end; $$;
revoke all on function public.rivo_write_notification(uuid,uuid,text,text,jsonb) from public;

create or replace function public.rivo_list_notifications(p_limit int default 40)
returns setof jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object(
    'id',n.id,'recipient_id',n.recipient_id,'actor_id',n.actor_id,'type',n.type,'body',n.body,'payload',n.payload,
    'read_at',n.read_at,'created_at',n.created_at,
    'actor_username',coalesce(p.username,''),'actor_display_name',coalesce(p.public_data->>'displayName','')
  )
  from public.rivo_notifications n left join public.profiles p on p.id=n.actor_id
  where n.recipient_id=auth.uid() order by n.created_at desc limit greatest(1,least(coalesce(p_limit,40),100));
$$;
revoke all on function public.rivo_list_notifications(int) from public;
grant execute on function public.rivo_list_notifications(int) to authenticated;

create or replace function public.rivo_mark_notification_read(p_notification_id bigint)
returns boolean language sql security definer set search_path=public as $$
 update public.rivo_notifications set read_at=coalesce(read_at,now()) where id=p_notification_id and recipient_id=auth.uid();
 select true;
$$;
revoke all on function public.rivo_mark_notification_read(bigint) from public;
grant execute on function public.rivo_mark_notification_read(bigint) to authenticated;

create or replace function public.rivo_mark_notifications_read()
returns boolean language sql security definer set search_path=public as $$
 update public.rivo_notifications set read_at=coalesce(read_at,now()) where recipient_id=auth.uid() and read_at is null;
 select true;
$$;
revoke all on function public.rivo_mark_notifications_read() from public;
grant execute on function public.rivo_mark_notifications_read() to authenticated;

create or replace function public.rivo_toggle_message_reaction(p_message_id bigint, p_reaction text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare m public.rivo_messages; existing text; totals jsonb;
begin
  if p_reaction not in ('❤️','😂','👍','😮','😢') then raise exception 'Unsupported reaction'; end if;
  select * into m from public.rivo_messages where id=p_message_id;
  if m.id is null or (m.sender_id<>auth.uid() and m.receiver_id<>auth.uid()) then raise exception 'Message not found'; end if;
  select reaction into existing from public.rivo_message_reactions where message_id=p_message_id and user_id=auth.uid();
  if existing = p_reaction then delete from public.rivo_message_reactions where message_id=p_message_id and user_id=auth.uid();
  else insert into public.rivo_message_reactions(message_id,user_id,reaction) values(p_message_id,auth.uid(),p_reaction) on conflict(message_id,user_id) do update set reaction=excluded.reaction,created_at=now(); end if;
  select coalesce(jsonb_agg(x order by x.reaction),'[]'::jsonb) into totals from (
    select reaction, count(*)::int as count, bool_or(user_id=auth.uid()) as me from public.rivo_message_reactions where message_id=p_message_id group by reaction
  ) x;
  return jsonb_build_object('message_id',m.id,'reactions',totals);
end; $$;
revoke all on function public.rivo_toggle_message_reaction(bigint,text) from public;
grant execute on function public.rivo_toggle_message_reaction(bigint,text) to authenticated;

-- Replace message fetch with reaction aggregates and emoji metadata.
create or replace function public.rivo_get_messages(p_other_username text, p_limit int default 80)
returns setof jsonb language plpgsql security definer set search_path=public as $$
declare me_id uuid := auth.uid(); other_id uuid;
begin
  select id into other_id from public.profiles where username=lower(trim(both '@' from p_other_username));
  if me_id is null then raise exception 'Not signed in'; end if;
  if other_id is null then raise exception 'User not found'; end if;
  return query
  select jsonb_build_object(
    'id',m.id,'sender_username',s.username,'receiver_username',r.username,'content',m.content,'created_at',m.created_at,
    'reactions',coalesce((select jsonb_agg(jsonb_build_object('reaction',x.reaction,'count',x.count,'me',x.me) order by x.reaction) from (
      select mr.reaction,count(*)::int as count,bool_or(mr.user_id=me_id) as me from public.rivo_message_reactions mr where mr.message_id=m.id group by mr.reaction
    ) x),'[]'::jsonb)
  )
  from public.rivo_messages m join public.profiles s on s.id=m.sender_id join public.profiles r on r.id=m.receiver_id
  where (m.sender_id=me_id and m.receiver_id=other_id) or (m.sender_id=other_id and m.receiver_id=me_id)
  order by m.created_at desc limit greatest(1,least(coalesce(p_limit,80),200));
end; $$;
revoke all on function public.rivo_get_messages(text,int) from public;
grant execute on function public.rivo_get_messages(text,int) to authenticated;

-- Make views useful: keep the total counter, and additionally record identified visitors.
create or replace function public.rivo_add_view(p_username text)
returns boolean language plpgsql security definer set search_path=public as $$
declare target public.profiles; viewer uuid:=auth.uid();
begin
  select * into target from public.profiles where username=lower(trim(both '@' from p_username)) for update;
  if target.id is null then return false; end if;
  target.public_data := jsonb_set(coalesce(target.public_data,'{}'::jsonb),'{stats,views}',to_jsonb(coalesce((target.public_data->'stats'->>'views')::int,0)+1),true);
  update public.profiles set public_data=target.public_data,updated_at=now() where id=target.id;
  insert into public.rivo_profile_views(profile_id,viewer_id) values(target.id,viewer);
  return true;
end; $$;
revoke all on function public.rivo_add_view(text) from public;
grant execute on function public.rivo_add_view(text) to anon, authenticated;

create or replace function public.rivo_get_profile_visitors(p_username text, p_limit int default 50)
returns setof jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object('username',p.username,'display_name',coalesce(p.public_data->>'displayName',p.username),'last_seen',max(v.viewed_at),'visits',count(*)::int)
  from public.rivo_profile_views v join public.profiles target on target.id=v.profile_id left join public.profiles p on p.id=v.viewer_id
  where target.username=lower(trim(both '@' from p_username)) and target.id=auth.uid() and v.viewer_id is not null and p.id is not null
  group by p.id,p.username,p.public_data->>'displayName' order by max(v.viewed_at) desc limit greatest(1,least(coalesce(p_limit,50),100));
$$;
revoke all on function public.rivo_get_profile_visitors(text,int) from public;
grant execute on function public.rivo_get_profile_visitors(text,int) to authenticated;

create or replace function public.rivo_admin_list_users(p_query text default '', p_limit int default 100)
returns setof jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object('userId',p.id,'username',p.username,'displayName',coalesce(p.public_data->>'displayName',p.username),'avatar',coalesce(p.public_data->>'avatar',''),'is_banned',p.is_banned,
    'views',coalesce((p.public_data->'stats'->>'views')::int,0),'likes',coalesce((p.public_data->'likes'->>'count')::int,0),'created_at',p.created_at)
  from public.profiles p where public.rivo_is_admin(auth.uid()) and (p_query='' or p.username ilike '%'||lower(p_query)||'%' or coalesce(p.public_data->>'displayName','') ilike '%'||p_query||'%')
  order by p.created_at desc limit greatest(1,least(coalesce(p_limit,100),200));
$$;
revoke all on function public.rivo_admin_list_users(text,int) from public;
grant execute on function public.rivo_admin_list_users(text,int) to authenticated;

create or replace function public.rivo_admin_get_user_details(p_username text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare p public.profiles; vis jsonb;
begin
  if not public.rivo_is_admin(auth.uid()) then raise exception 'Access denied'; end if;
  select * into p from public.profiles where username=lower(trim(both '@' from p_username));
  if p.id is null then return null; end if;
  select coalesce(jsonb_agg(x order by x.last_seen desc),'[]'::jsonb) into vis from (
    select pr.username,coalesce(pr.public_data->>'displayName',pr.username) as display_name,max(v.viewed_at) as last_seen,count(*)::int as visits
    from public.rivo_profile_views v join public.profiles pr on pr.id=v.viewer_id where v.profile_id=p.id group by pr.id,pr.username,pr.public_data->>'displayName'
    order by max(v.viewed_at) desc limit 50
  ) x;
  return jsonb_build_object('userId',p.id,'username',p.username,'displayName',coalesce(p.public_data->>'displayName',p.username),'is_banned',p.is_banned,'created_at',p.created_at,
    'views',coalesce((p.public_data->'stats'->>'views')::int,0),'likes',coalesce((p.public_data->'likes'->>'count')::int,0),'friends',jsonb_array_length(coalesce(p.public_data->'friends','[]'::jsonb)),'visitors',vis);
end; $$;
revoke all on function public.rivo_admin_get_user_details(text) from public;
grant execute on function public.rivo_admin_get_user_details(text) to authenticated;

create or replace function public.rivo_admin_set_banned(p_username text,p_banned boolean)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  if not public.rivo_is_admin(auth.uid()) then raise exception 'Access denied'; end if;
  update public.profiles set is_banned=coalesce(p_banned,false),updated_at=now() where username=lower(trim(both '@' from p_username));
  return found;
end; $$;
revoke all on function public.rivo_admin_set_banned(text,boolean) from public;
grant execute on function public.rivo_admin_set_banned(text,boolean) to authenticated;

create or replace function public.rivo_admin_set_stats(p_username text,p_views int,p_likes int)
returns boolean language plpgsql security definer set search_path=public as $$
 declare target public.profiles;
begin
  if not public.rivo_is_admin(auth.uid()) then raise exception 'Access denied'; end if;
  select * into target from public.profiles where username=lower(trim(both '@' from p_username)) for update;
  if target.id is null then return false; end if;
  target.public_data := jsonb_set(coalesce(target.public_data,'{}'::jsonb),'{stats,views}',to_jsonb(greatest(0,coalesce(p_views,0))),true);
  target.public_data := jsonb_set(coalesce(target.public_data,'{}'::jsonb),'{likes,count}',to_jsonb(greatest(0,coalesce(p_likes,0))),true);
  update public.profiles set public_data=target.public_data,updated_at=now() where id=target.id;
  return true;
end; $$;
revoke all on function public.rivo_admin_set_stats(text,int,int) from public;
grant execute on function public.rivo_admin_set_stats(text,int,int) to authenticated;

create or replace function public.rivo_admin_delete_user(p_username text)
returns boolean language plpgsql security definer set search_path=public as $$
declare target uuid;
begin
  if not public.rivo_is_admin(auth.uid()) then raise exception 'Access denied'; end if;
  select id into target from public.profiles where username=lower(trim(both '@' from p_username));
  if target is null then return false; end if;
  if target=auth.uid() then raise exception 'You cannot delete the current admin account from this dashboard'; end if;
  delete from auth.users where id=target;
  return true;
end; $$;
revoke all on function public.rivo_admin_delete_user(text) from public;
grant execute on function public.rivo_admin_delete_user(text) to authenticated;

create or replace function public.rivo_set_profile_view_preference(p_enabled boolean)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  update public.profiles set private_data=jsonb_set(coalesce(private_data,'{}'::jsonb),'{privacy,showVisitors}',to_jsonb(coalesce(p_enabled,true)),true),updated_at=now() where id=auth.uid();
  return found;
end; $$;
revoke all on function public.rivo_set_profile_view_preference(boolean) from public;
grant execute on function public.rivo_set_profile_view_preference(boolean) to authenticated;

-- Friend-request notifications.
create or replace function public.rivo_send_friend_request(p_target_username text)
returns boolean language plpgsql security definer set search_path=public as $$
declare me public.profiles; target public.profiles; incoming jsonb; outgoing jsonb;
begin
  select * into me from public.profiles where id=auth.uid() for update; if not found then raise exception 'Not signed in'; end if;
  if me.is_banned then raise exception 'Your account is blocked'; end if;
  select * into target from public.profiles where username=lower(trim(both '@' from p_target_username)) for update; if not found then raise exception 'User not found'; end if;
  if target.is_banned then raise exception 'This account is unavailable'; end if;
  if me.id=target.id then raise exception 'You cannot add yourself'; end if;
  if coalesce(me.public_data->'friends','[]'::jsonb) ? target.username then raise exception 'Already friends'; end if;
  incoming:=coalesce(target.private_data->'friendRequests'->'incoming','[]'::jsonb); outgoing:=coalesce(me.private_data->'friendRequests'->'outgoing','[]'::jsonb);
  if incoming ? me.username then raise exception 'Request already sent'; end if;
  if (me.private_data->'friendRequests'->'incoming') ? target.username then raise exception 'This user has already requested you'; end if;
  incoming:=incoming||to_jsonb(me.username); outgoing:=outgoing||to_jsonb(target.username);
  me.private_data:=jsonb_set(coalesce(me.private_data,'{}'::jsonb),'{friendRequests,outgoing}',outgoing,true);
  target.private_data:=jsonb_set(coalesce(target.private_data,'{}'::jsonb),'{friendRequests,incoming}',incoming,true);
  update public.profiles set private_data=me.private_data,updated_at=now() where id=me.id;
  update public.profiles set private_data=target.private_data,updated_at=now() where id=target.id;
  perform public.rivo_write_notification(target.id,me.id,'friend_request',me.username||' sent you a friend request',jsonb_build_object('username',me.username));
  return true;
end; $$;
revoke all on function public.rivo_send_friend_request(text) from public;
grant execute on function public.rivo_send_friend_request(text) to authenticated;

-- Message notification + banned-account guard.
create or replace function public.rivo_send_message(p_receiver_username text, p_content text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me public.profiles; target public.profiles; text_value text:=trim(coalesce(p_content,'')); can_receive text; are_friends boolean:=false; m public.rivo_messages;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if char_length(text_value)<1 then raise exception 'Message cannot be empty'; end if;
  if char_length(text_value)>2000 then raise exception 'Message is too long'; end if;
  select * into me from public.profiles where id=auth.uid(); select * into target from public.profiles where username=lower(trim(both '@' from p_receiver_username));
  if me.id is null or target.id is null then raise exception 'User not found'; end if;
  if me.is_banned then raise exception 'Your account is blocked'; end if;
  if target.is_banned then raise exception 'This account is unavailable'; end if;
  if me.id=target.id then raise exception 'You cannot message yourself'; end if;
  can_receive:=coalesce(target.private_data->'messageSettings'->>'whoCanMessage','everyone'); if can_receive='nobody' then raise exception 'This user has closed their messages'; end if;
  are_friends:=coalesce(target.public_data->'friends','[]'::jsonb) ? me.username; if can_receive='friends' and not are_friends then raise exception 'This user accepts messages from friends only'; end if;
  insert into public.rivo_messages(sender_id,receiver_id,content) values(me.id,target.id,text_value) returning * into m;
  perform public.rivo_write_notification(target.id,me.id,'message',me.username||' sent you a message',jsonb_build_object('message_id',m.id,'username',me.username));
  return jsonb_build_object('id',m.id,'sender_username',me.username,'receiver_username',target.username,'content',m.content,'created_at',m.created_at,'reactions','[]'::jsonb);
end; $$;
revoke all on function public.rivo_send_message(text,text) from public;
grant execute on function public.rivo_send_message(text,text) to authenticated;

-- Block banned users from using profile saves through the existing update RPC by wrapping its caller check is left to client/RLS.

-- Realtime publication additions.
do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='rivo_notifications') then alter publication supabase_realtime add table public.rivo_notifications; end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='rivo_message_reactions') then alter publication supabase_realtime add table public.rivo_message_reactions; end if;
end $$;

-- IMPORTANT: after creating your account, make that account an admin once:
-- insert into public.rivo_admin_users(user_id) select id from public.profiles where username='YOUR_USERNAME';


-- ============================================================
-- Rivo Stories v1
-- One active image story per account, 12-hour lifetime, optimized image upload,
-- likes, unique viewers, owner delete, and expiry cleanup.
-- ============================================================
create table if not exists public.rivo_stories (
  id bigint generated by default as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  media_url text not null,
  storage_path text not null,
  media_type text not null check (media_type like 'image/%' or media_type like 'video/%'),
  duration_seconds numeric(6,2) not null default 12 check (duration_seconds > 0 and duration_seconds <= 30),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '12 hours')
);
alter table public.rivo_stories add column if not exists duration_seconds numeric(6,2) not null default 12;
create index if not exists rivo_stories_user_idx on public.rivo_stories(user_id, created_at desc);
create index if not exists rivo_stories_expiry_idx on public.rivo_stories(expires_at);
alter table public.rivo_stories enable row level security;
drop policy if exists "rivo_stories_select_public" on public.rivo_stories;

create table if not exists public.rivo_story_views (
  story_id bigint not null references public.rivo_stories(id) on delete cascade,
  viewer_id uuid not null references auth.users(id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key(story_id, viewer_id)
);
create index if not exists rivo_story_views_story_idx on public.rivo_story_views(story_id, viewed_at desc);
alter table public.rivo_story_views enable row level security;
drop policy if exists "rivo_story_views_select_owner" on public.rivo_story_views;
create policy "rivo_story_views_select_owner" on public.rivo_story_views for select to authenticated using (exists(select 1 from public.rivo_stories s where s.id=story_id and s.user_id=auth.uid()));

create table if not exists public.rivo_story_likes (
  story_id bigint not null references public.rivo_stories(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  liked_at timestamptz not null default now(),
  primary key(story_id, user_id)
);
create index if not exists rivo_story_likes_story_idx on public.rivo_story_likes(story_id);
alter table public.rivo_story_likes enable row level security;
drop policy if exists "rivo_story_likes_select_public" on public.rivo_story_likes;

create or replace function public.rivo_cleanup_expired_stories()
returns integer language plpgsql security definer set search_path=public as $$
declare deleted_count integer := 0;
begin
  create temporary table if not exists tmp_rivo_story_paths(path text) on commit drop;
  truncate tmp_rivo_story_paths;
  insert into tmp_rivo_story_paths(path) select storage_path from public.rivo_stories where expires_at <= now();
  -- Supabase does not allow direct DELETEs from storage.objects from SQL.
  -- Remove expired DB rows here; media objects must be removed through the Storage API.
  delete from public.rivo_stories where expires_at <= now();
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;
revoke all on function public.rivo_cleanup_expired_stories() from public;
grant execute on function public.rivo_cleanup_expired_stories() to anon, authenticated;

create or replace function public.rivo_create_story(p_media_url text, p_storage_path text, p_media_type text, p_duration_seconds numeric default 12)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me uuid := auth.uid(); s public.rivo_stories; duration numeric := least(30,greatest(1,coalesce(p_duration_seconds,12)));
begin
  if me is null then raise exception 'Not signed in'; end if;
  if p_media_url is null or p_storage_path is null then raise exception 'Story media is required'; end if;
  if p_storage_path not like me::text || '/stories/%' then raise exception 'Invalid story storage path'; end if;
  if p_media_type not like 'image/%' then raise exception 'Stories support images only'; end if;
  perform pg_advisory_xact_lock(hashtextextended(me::text, 934231));
  perform public.rivo_cleanup_expired_stories();
  if exists(select 1 from public.rivo_stories where user_id=me and expires_at > now()) then raise exception 'You already have an active story'; end if;
  insert into public.rivo_stories(user_id,media_url,storage_path,media_type,duration_seconds,expires_at)
  values(me,p_media_url,p_storage_path,p_media_type,duration,now()+interval '12 hours')
  returning * into s;
  return jsonb_build_object('id',s.id,'user_id',s.user_id,'media_url',s.media_url,'media_type',s.media_type,'duration_seconds',s.duration_seconds,'created_at',s.created_at,'expires_at',s.expires_at,'active',true,'likes_count',0,'views_count',0,'liked',false);
end;
$$;
revoke all on function public.rivo_create_story(text,text,text,numeric) from public;
grant execute on function public.rivo_create_story(text,text,text,numeric) to authenticated;

create or replace function public.rivo_get_story(p_username text, p_count_view boolean default true)
returns jsonb language plpgsql security definer set search_path=public as $$
declare target public.profiles; s public.rivo_stories; me uuid := auth.uid(); liked boolean := false; views_count integer := 0; likes_count integer := 0;
begin
  perform public.rivo_cleanup_expired_stories();
  select * into target from public.profiles where username=lower(trim(both '@' from p_username));
  if not found then return null; end if;
  select * into s from public.rivo_stories where user_id=target.id and expires_at > now() and media_type like 'image/%' order by created_at desc limit 1;
  if not found then return null; end if;
  if p_count_view and me is not null and me <> target.id then
    insert into public.rivo_story_views(story_id,viewer_id) values(s.id,me) on conflict(story_id,viewer_id) do update set viewed_at=now();
  end if;
  select count(*)::int into views_count from public.rivo_story_views where story_id=s.id;
  select count(*)::int into likes_count from public.rivo_story_likes where story_id=s.id;
  if me is not null then select exists(select 1 from public.rivo_story_likes where story_id=s.id and user_id=me) into liked; end if;
  return jsonb_build_object('id',s.id,'user_id',s.user_id,'username',target.username,'display_name',coalesce(target.public_data->>'displayName',target.username),'avatar',coalesce(target.public_data->>'avatar',''),'media_url',s.media_url,'media_type',s.media_type,'duration_seconds',s.duration_seconds,'created_at',s.created_at,'expires_at',s.expires_at,'active',true,'likes_count',likes_count,'views_count',views_count,'liked',liked);
end;
$$;
revoke all on function public.rivo_get_story(text,boolean) from public;
grant execute on function public.rivo_get_story(text,boolean) to anon, authenticated;

create or replace function public.rivo_get_story_statuses(p_usernames text[])
returns setof jsonb language plpgsql security definer set search_path=public as $$
begin
  perform public.rivo_cleanup_expired_stories();
  return query select jsonb_build_object('username',p.username,'active',true,'story_id',s.id,'created_at',s.created_at,'expires_at',s.expires_at)
  from public.profiles p join lateral (select * from public.rivo_stories rs where rs.user_id=p.id and rs.expires_at > now() and rs.media_type like 'image/%' order by rs.created_at desc limit 1) s on true
  where p.username = any(array(select lower(trim(both '@' from x)) from unnest(coalesce(p_usernames,'{}'::text[])) as x));
end;
$$;
revoke all on function public.rivo_get_story_statuses(text[]) from public;
grant execute on function public.rivo_get_story_statuses(text[]) to anon, authenticated;

create or replace function public.rivo_delete_story(p_story_id bigint)
returns jsonb language plpgsql security definer set search_path=public as $$
declare s public.rivo_stories;
begin
  select * into s from public.rivo_stories where id=p_story_id for update;
  if s.id is null then return jsonb_build_object('deleted',false); end if;
  if s.user_id <> auth.uid() then raise exception 'Access denied'; end if;
  delete from public.rivo_stories where id=s.id;
  return jsonb_build_object('deleted',true,'storage_path',s.storage_path);
end;
$$;
revoke all on function public.rivo_delete_story(bigint) from public;
grant execute on function public.rivo_delete_story(bigint) to authenticated;

create or replace function public.rivo_toggle_story_like(p_story_id bigint)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me uuid := auth.uid(); existing boolean := false; likes_count integer := 0;
begin
  if me is null then raise exception 'Not signed in'; end if;
  perform public.rivo_cleanup_expired_stories();
  if not exists(select 1 from public.rivo_stories where id=p_story_id and expires_at > now()) then raise exception 'Story not found or expired'; end if;
  select exists(select 1 from public.rivo_story_likes where story_id=p_story_id and user_id=me) into existing;
  if existing then delete from public.rivo_story_likes where story_id=p_story_id and user_id=me; else insert into public.rivo_story_likes(story_id,user_id) values(p_story_id,me) on conflict do nothing; end if;
  select count(*)::int into likes_count from public.rivo_story_likes where story_id=p_story_id;
  return jsonb_build_object('liked',not existing,'likes_count',likes_count);
end;
$$;
revoke all on function public.rivo_toggle_story_like(bigint) from public;
grant execute on function public.rivo_toggle_story_like(bigint) to authenticated;

-- Add only safe story metadata to public profiles so every avatar can show a story ring.
create or replace function public.rivo_get_public_profile(p_username text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.profiles; story_row public.rivo_stories;
begin
  perform public.rivo_cleanup_expired_stories();
  select * into r from public.profiles where username=lower(trim(both '@' from p_username)) limit 1;
  if not found then return null; end if;
  select * into story_row from public.rivo_stories where user_id=r.id and expires_at > now() and media_type like 'image/%' order by created_at desc limit 1;
  return jsonb_build_object(
    'userId',r.id,'username',r.username,'displayName',coalesce(r.public_data->>'displayName',r.username),'bio',coalesce(r.public_data->>'bio',''),'description',coalesce(r.public_data->>'description',''),'location',coalesce(r.public_data->>'location',''),'website',coalesce(r.public_data->>'website',''),'avatar',coalesce(r.public_data->>'avatar',''),'banner',coalesce(r.public_data->>'banner',''),'miniImage',coalesce(r.public_data->>'miniImage',''),'status',coalesce(r.public_data->>'status','Online'),'customStatus',coalesce(r.public_data->>'customStatus',''),'theme',coalesce(r.public_data->>'theme','obsidian'),'template',coalesce(r.public_data->>'template','discord-noir'),'accent',coalesce(r.public_data->>'accent','#7488ff'),'cardRadius',coalesce((r.public_data->>'cardRadius')::numeric,24),'cardStyle',coalesce(r.public_data->>'cardStyle','glass'),'glow',coalesce((r.public_data->>'glow')::numeric,45),'background',coalesce(r.public_data->>'background','aurora'),'animation',coalesce(r.public_data->>'animation','soft'),'socials',coalesce(r.public_data->'socials','[]'::jsonb),'skills',coalesce(r.public_data->'skills','[]'::jsonb),'badges',coalesce(r.public_data->'badges','[]'::jsonb),'projects',coalesce(r.public_data->'projects','[]'::jsonb),'friends',coalesce(r.public_data->'friends','[]'::jsonb),'sections',coalesce(r.public_data->'sections','[]'::jsonb),'music',coalesce(r.public_data->'music','{}'::jsonb),'avatarFrame',coalesce(r.public_data->>'avatarFrame','none'),'avatarFrameColor',coalesce(r.public_data->>'avatarFrameColor','#8b5cf6'),'avatarFrameGlow',coalesce((r.public_data->>'avatarFrameGlow')::numeric,35),'avatarFrameWidth',coalesce((r.public_data->>'avatarFrameWidth')::numeric,3),'stats',coalesce(r.public_data->'stats',jsonb_build_object('views',0)),'likes',jsonb_build_object('count',coalesce((r.public_data->'likes'->>'count')::int,0),'users',coalesce(r.public_data->'likes'->'users','[]'::jsonb)),'messagePrivacy',coalesce(r.private_data->'messageSettings'->>'whoCanMessage','everyone'),'callPrivacy',coalesce(r.private_data->'callSettings'->>'whoCanCall','everyone'),'story',case when story_row.id is null then null else jsonb_build_object('active',true,'story_id',story_row.id,'created_at',story_row.created_at,'expires_at',story_row.expires_at) end,'createdAt',r.created_at,'updatedAt',r.updated_at
  );
end;
$$;
revoke all on function public.rivo_get_public_profile(text) from public;
grant execute on function public.rivo_get_public_profile(text) to anon, authenticated;

-- Physical cleanup is also triggered by every story/profile read. For unattended
-- deletion at exactly expiry time, enable a Supabase scheduled job/pg_cron to call
-- public.rivo_cleanup_expired_stories() every 10-15 minutes.


-- Ensure admin deletion also removes Story media objects, not only database rows.
create or replace function public.rivo_admin_delete_user(p_username text)
returns boolean language plpgsql security definer set search_path=public as $$
declare target uuid;
begin
  if not public.rivo_is_admin(auth.uid()) then raise exception 'Access denied'; end if;
  select id into target from public.profiles where username=lower(trim(both '@' from p_username));
  if target is null then return false; end if;
  if target=auth.uid() then raise exception 'You cannot delete the current admin account from this dashboard'; end if;
  -- Storage objects must be deleted through the Storage API / server-side service role.
  -- Account deletion still removes DB rows through the auth cascade.
  delete from auth.users where id=target;
  return true;
end; $$;
revoke all on function public.rivo_admin_delete_user(text) from public;
grant execute on function public.rivo_admin_delete_user(text) to authenticated;


-- Optional true scheduled cleanup: Supabase projects that expose pg_cron will
-- clean expired Story rows/media every 15 minutes. Projects without pg_cron
-- simply use the safe cleanup performed by the Story APIs above.
do $$
begin
  if exists(select 1 from pg_available_extensions where name='pg_cron') then
    begin
      execute 'create extension if not exists pg_cron';
      if not exists(select 1 from cron.job where jobname='rivo-story-cleanup') then
        perform cron.schedule('rivo-story-cleanup','*/15 * * * *','select public.rivo_cleanup_expired_stories()');
      end if;
    exception when others then
      null;
    end;
  end if;
end $$;

-- ============================================================
-- Rivo Social v1: Posts, comments, reactions, reposts + Communities
-- ============================================================

create table if not exists public.rivo_posts (
  id bigint generated by default as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null default '' check (char_length(content) <= 5000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists rivo_posts_user_idx on public.rivo_posts(user_id, created_at desc);
create index if not exists rivo_posts_created_idx on public.rivo_posts(created_at desc);
alter table public.rivo_posts enable row level security;
drop policy if exists "rivo_posts_select_public" on public.rivo_posts;
create policy "rivo_posts_select_public" on public.rivo_posts for select to anon, authenticated using (true);

create table if not exists public.rivo_post_media (
  id bigint generated by default as identity primary key,
  post_id bigint not null references public.rivo_posts(id) on delete cascade,
  media_url text not null,
  storage_path text not null,
  media_type text not null default 'image/webp',
  sort_order smallint not null default 0 check (sort_order between 0 and 4),
  created_at timestamptz not null default now()
);
create index if not exists rivo_post_media_post_idx on public.rivo_post_media(post_id, sort_order);
alter table public.rivo_post_media enable row level security;
drop policy if exists "rivo_post_media_select_public" on public.rivo_post_media;
create policy "rivo_post_media_select_public" on public.rivo_post_media for select to anon, authenticated using (true);

create table if not exists public.rivo_post_comments (
  id bigint generated by default as identity primary key,
  post_id bigint not null references public.rivo_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null check (char_length(trim(content)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists rivo_post_comments_post_idx on public.rivo_post_comments(post_id, created_at asc);
alter table public.rivo_post_comments enable row level security;
drop policy if exists "rivo_post_comments_select_public" on public.rivo_post_comments;
create policy "rivo_post_comments_select_public" on public.rivo_post_comments for select to anon, authenticated using (true);

create table if not exists public.rivo_post_reactions (
  post_id bigint not null references public.rivo_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reaction text not null check (reaction in ('❤️','😂','👍','😮','😢')),
  created_at timestamptz not null default now(),
  primary key(post_id,user_id)
);
create index if not exists rivo_post_reactions_post_idx on public.rivo_post_reactions(post_id);
alter table public.rivo_post_reactions enable row level security;
drop policy if exists "rivo_post_reactions_select_public" on public.rivo_post_reactions;
create policy "rivo_post_reactions_select_public" on public.rivo_post_reactions for select to anon, authenticated using (true);

create table if not exists public.rivo_post_reposts (
  post_id bigint not null references public.rivo_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(post_id,user_id)
);
create index if not exists rivo_post_reposts_post_idx on public.rivo_post_reposts(post_id, created_at desc);
alter table public.rivo_post_reposts enable row level security;
drop policy if exists "rivo_post_reposts_select_public" on public.rivo_post_reposts;
create policy "rivo_post_reposts_select_public" on public.rivo_post_reposts for select to anon, authenticated using (true);

create table if not exists public.rivo_communities (
  id bigint generated by default as identity primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 80),
  description text not null default '' check (char_length(description) <= 500),
  join_policy text not null default 'public' check (join_policy in ('public','friends','request')),
  created_at timestamptz not null default now()
);
alter table public.rivo_communities add column if not exists image_url text;
alter table public.rivo_communities add column if not exists image_path text;
create index if not exists rivo_communities_owner_idx on public.rivo_communities(owner_id);
create index if not exists rivo_communities_created_idx on public.rivo_communities(created_at desc);
alter table public.rivo_communities enable row level security;
drop policy if exists "rivo_communities_select_public" on public.rivo_communities;
create policy "rivo_communities_select_public" on public.rivo_communities for select to anon, authenticated using (true);

create table if not exists public.rivo_community_members (
  community_id bigint not null references public.rivo_communities(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','member')),
  joined_at timestamptz not null default now(),
  primary key(community_id,user_id)
);
create index if not exists rivo_community_members_user_idx on public.rivo_community_members(user_id, joined_at desc);
alter table public.rivo_community_members enable row level security;
drop policy if exists "rivo_community_members_select_member" on public.rivo_community_members;
create policy "rivo_community_members_select_member" on public.rivo_community_members for select to authenticated using (
  rivo_community_members.user_id = auth.uid() or exists(select 1 from public.rivo_community_members x where x.community_id = rivo_community_members.community_id and x.user_id = auth.uid())
);

create table if not exists public.rivo_community_join_requests (
  community_id bigint not null references public.rivo_communities(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(community_id,user_id)
);
create index if not exists rivo_community_join_requests_user_idx on public.rivo_community_join_requests(user_id, created_at desc);
alter table public.rivo_community_join_requests enable row level security;
drop policy if exists "rivo_community_join_requests_select_related" on public.rivo_community_join_requests;
create policy "rivo_community_join_requests_select_related" on public.rivo_community_join_requests for select to authenticated using (
  user_id = auth.uid() or exists(select 1 from public.rivo_communities c where c.id = community_id and c.owner_id = auth.uid())
);

create table if not exists public.rivo_community_messages (
  id bigint generated by default as identity primary key,
  community_id bigint not null references public.rivo_communities(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  content text not null check (char_length(trim(content)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists rivo_community_messages_idx on public.rivo_community_messages(community_id, created_at desc);
alter table public.rivo_community_messages enable row level security;
drop policy if exists "rivo_community_messages_select_member" on public.rivo_community_messages;
create policy "rivo_community_messages_select_member" on public.rivo_community_messages for select to authenticated using (
  exists(select 1 from public.rivo_community_members m where m.community_id = rivo_community_messages.community_id and m.user_id = auth.uid())
);

-- Helper: profile card data without exposing private auth fields.
create or replace function public.rivo_social_profile(p_user_id uuid)
returns jsonb language sql stable security definer set search_path=public as $$
  select jsonb_build_object('userId',p.id,'username',p.username,'displayName',coalesce(p.public_data->>'displayName',p.username),'avatar',coalesce(p.public_data->>'avatar',''))
  from public.profiles p where p.id = p_user_id;
$$;
revoke all on function public.rivo_social_profile(uuid) from public;
grant execute on function public.rivo_social_profile(uuid) to anon, authenticated;

create or replace function public.rivo_list_posts(p_username text default null, p_limit int default 30, p_offset int default 0)
returns setof jsonb language sql security definer set search_path=public as $$
  select jsonb_build_object(
    'id',p.id,'content',p.content,'created_at',p.created_at,
    'author',public.rivo_social_profile(p.user_id),
    'media',coalesce((select jsonb_agg(jsonb_build_object('url',m.media_url,'type',m.media_type) order by m.sort_order) from public.rivo_post_media m where m.post_id=p.id),'[]'::jsonb),
    'comments_count',(select count(*) from public.rivo_post_comments c where c.post_id=p.id),
    'reposts_count',(select count(*) from public.rivo_post_reposts r where r.post_id=p.id),
    'reactions',coalesce((select jsonb_object_agg(x.reaction,x.count) from (select reaction,count(*)::int as count from public.rivo_post_reactions where post_id=p.id group by reaction) x),'{}'::jsonb),
    'my_reaction',(select reaction from public.rivo_post_reactions where post_id=p.id and user_id=auth.uid()),
    'reposted_by_me',exists(select 1 from public.rivo_post_reposts where post_id=p.id and user_id=auth.uid()),
    'reposter_names',coalesce((select jsonb_agg(jsonb_build_object('username',z.username,'displayName',z.display_name) order by z.created_at desc) from (select pr.username,coalesce(pr.public_data->>'displayName',pr.username) as display_name,r.created_at from public.rivo_post_reposts r join public.profiles pr on pr.id=r.user_id where r.post_id=p.id order by r.created_at desc limit 3) z),'[]'::jsonb),
    'profile_reposted',case when p_username is null then false else exists(select 1 from public.rivo_post_reposts rr join public.profiles rp on rp.id=rr.user_id where rr.post_id=p.id and rp.username=lower(trim(both '@' from p_username))) end
  )
  from public.rivo_posts p
  left join public.profiles au on au.id=p.user_id
  where (p_username is null or au.username=lower(trim(both '@' from p_username)) or exists(select 1 from public.rivo_post_reposts rr join public.profiles rp on rp.id=rr.user_id where rr.post_id=p.id and rp.username=lower(trim(both '@' from p_username))))
  order by p.created_at desc limit greatest(1,least(coalesce(p_limit,30),60)) offset greatest(0,coalesce(p_offset,0));
$$;
revoke all on function public.rivo_list_posts(text,int,int) from public;
grant execute on function public.rivo_list_posts(text,int,int) to anon, authenticated;

create or replace function public.rivo_get_post(p_post_id bigint)
returns jsonb language sql security definer set search_path=public as $$
  select jsonb_build_object(
    'id',p.id,'content',p.content,'created_at',p.created_at,
    'author',public.rivo_social_profile(p.user_id),
    'media',coalesce((select jsonb_agg(jsonb_build_object('url',m.media_url,'type',m.media_type) order by m.sort_order) from public.rivo_post_media m where m.post_id=p.id),'[]'::jsonb),
    'comments',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'content',c.content,'created_at',c.created_at,'author',public.rivo_social_profile(c.user_id)) order by c.created_at asc) from public.rivo_post_comments c where c.post_id=p.id),'[]'::jsonb),
    'comments_count',(select count(*) from public.rivo_post_comments c where c.post_id=p.id),
    'reposts_count',(select count(*) from public.rivo_post_reposts r where r.post_id=p.id),
    'reactions',coalesce((select jsonb_object_agg(x.reaction,x.count) from (select reaction,count(*)::int as count from public.rivo_post_reactions where post_id=p.id group by reaction) x),'{}'::jsonb),
    'my_reaction',(select reaction from public.rivo_post_reactions where post_id=p.id and user_id=auth.uid()),
    'reposted_by_me',exists(select 1 from public.rivo_post_reposts where post_id=p.id and user_id=auth.uid()),
    'reposter_names',coalesce((select jsonb_agg(jsonb_build_object('username',z.username,'displayName',z.display_name) order by z.created_at desc) from (select pr.username,coalesce(pr.public_data->>'displayName',pr.username) as display_name,r.created_at from public.rivo_post_reposts r join public.profiles pr on pr.id=r.user_id where r.post_id=p.id order by r.created_at desc limit 3) z),'[]'::jsonb)
  ) from public.rivo_posts p where p.id=p_post_id limit 1;
$$;
revoke all on function public.rivo_get_post(bigint) from public;
grant execute on function public.rivo_get_post(bigint) to anon, authenticated;

create or replace function public.rivo_create_post(p_content text, p_media jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me uuid:=auth.uid(); pid bigint; item jsonb; n int:=0;
begin
  if me is null then raise exception 'Not signed in'; end if;
  if exists(select 1 from public.profiles where id=me and is_banned) then raise exception 'Account is restricted'; end if;
  if char_length(coalesce(p_content,''))>5000 then raise exception 'Post is too long'; end if;
  if jsonb_typeof(coalesce(p_media,'[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_media,'[]'::jsonb)) > 5 then raise exception 'Maximum 5 images per post'; end if;
  insert into public.rivo_posts(user_id,content) values(me,trim(coalesce(p_content,''))) returning id into pid;
  for item in select * from jsonb_array_elements(coalesce(p_media,'[]'::jsonb)) loop
    insert into public.rivo_post_media(post_id,media_url,storage_path,media_type,sort_order)
    values(pid,item->>'url',item->>'path',coalesce(item->>'type','image/webp'),n); n:=n+1;
  end loop;
  return public.rivo_get_post(pid);
end; $$;
revoke all on function public.rivo_create_post(text,jsonb) from public;
grant execute on function public.rivo_create_post(text,jsonb) to authenticated;

create or replace function public.rivo_toggle_post_reaction(p_post_id bigint,p_reaction text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me uuid:=auth.uid(); old text;
begin
  if me is null then raise exception 'Not signed in'; end if;
  if p_reaction not in ('❤️','😂','👍','😮','😢') then raise exception 'Unsupported reaction'; end if;
  select reaction into old from public.rivo_post_reactions where post_id=p_post_id and user_id=me;
  if old=p_reaction then delete from public.rivo_post_reactions where post_id=p_post_id and user_id=me;
  else insert into public.rivo_post_reactions(post_id,user_id,reaction) values(p_post_id,me,p_reaction) on conflict(post_id,user_id) do update set reaction=excluded.reaction,created_at=now(); end if;
  return public.rivo_get_post(p_post_id);
end; $$;
revoke all on function public.rivo_toggle_post_reaction(bigint,text) from public;
grant execute on function public.rivo_toggle_post_reaction(bigint,text) to authenticated;

create or replace function public.rivo_add_post_comment(p_post_id bigint,p_content text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me uuid:=auth.uid(); cid bigint;
begin
  if me is null then raise exception 'Not signed in'; end if;
  insert into public.rivo_post_comments(post_id,user_id,content) values(p_post_id,me,trim(p_content)) returning id into cid;
  return public.rivo_get_post(p_post_id);
end; $$;
revoke all on function public.rivo_add_post_comment(bigint,text) from public;
grant execute on function public.rivo_add_post_comment(bigint,text) to authenticated;

create or replace function public.rivo_toggle_post_repost(p_post_id bigint)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me uuid:=auth.uid();
begin
  if me is null then raise exception 'Not signed in'; end if;
  if exists(select 1 from public.rivo_post_reposts where post_id=p_post_id and user_id=me) then delete from public.rivo_post_reposts where post_id=p_post_id and user_id=me;
  else insert into public.rivo_post_reposts(post_id,user_id) values(p_post_id,me); end if;
  return public.rivo_get_post(p_post_id);
end; $$;
revoke all on function public.rivo_toggle_post_repost(bigint) from public;
grant execute on function public.rivo_toggle_post_repost(bigint) to authenticated;

create or replace function public.rivo_create_community(p_name text,p_description text,p_join_policy text,p_image_url text default null,p_image_path text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me uuid:=auth.uid(); cid bigint; owned_count int; policy text:=case when p_join_policy='friends' then 'friends' when p_join_policy='request' then 'request' else 'public' end;
begin
  if me is null then raise exception 'Not signed in'; end if;
  perform pg_advisory_xact_lock(hashtextextended(me::text,0));
  select count(*)::int into owned_count from public.rivo_communities where owner_id=me;
  if owned_count >= 3 then raise exception 'You can create up to 3 communities'; end if;
  if nullif(trim(coalesce(p_name,'')),'') is null then raise exception 'Community name is required'; end if;
  insert into public.rivo_communities(owner_id,name,description,join_policy,image_url,image_path)
  values(me,trim(p_name),trim(coalesce(p_description,'')),policy,nullif(trim(p_image_url),''),nullif(trim(p_image_path),'')) returning id into cid;
  insert into public.rivo_community_members(community_id,user_id,role) values(cid,me,'owner');
  return public.rivo_get_community(cid);
end; $$;
revoke all on function public.rivo_create_community(text,text,text,text,text) from public;
grant execute on function public.rivo_create_community(text,text,text,text,text) to authenticated;

create or replace function public.rivo_my_community_count()
returns integer language sql security definer set search_path=public as $$
  select count(*)::int from public.rivo_communities where owner_id=auth.uid();
$$;
revoke all on function public.rivo_my_community_count() from public;
grant execute on function public.rivo_my_community_count() to authenticated;

create or replace function public.rivo_list_communities(p_limit int default 30)
returns setof jsonb language sql security definer set search_path=public as $$
select jsonb_build_object('id',c.id,'name',c.name,'description',c.description,'join_policy',c.join_policy,'image_url',c.image_url,'image_path',c.image_path,'created_at',c.created_at,'owner',public.rivo_social_profile(c.owner_id),'members_count',(select count(*) from public.rivo_community_members m where m.community_id=c.id),'is_member',exists(select 1 from public.rivo_community_members m where m.community_id=c.id and m.user_id=auth.uid()),'request_pending',exists(select 1 from public.rivo_community_join_requests q where q.community_id=c.id and q.user_id=auth.uid())) from public.rivo_communities c order by c.created_at desc limit greatest(1,least(coalesce(p_limit,30),80));
$$;
revoke all on function public.rivo_list_communities(int) from public;
grant execute on function public.rivo_list_communities(int) to anon, authenticated;

create or replace function public.rivo_get_community(p_id bigint)
returns jsonb language sql security definer set search_path=public as $$
select jsonb_build_object('id',c.id,'name',c.name,'description',c.description,'join_policy',c.join_policy,'image_url',c.image_url,'image_path',c.image_path,'created_at',c.created_at,'owner',public.rivo_social_profile(c.owner_id),'members_count',(select count(*) from public.rivo_community_members m where m.community_id=c.id),'is_member',exists(select 1 from public.rivo_community_members m where m.community_id=c.id and m.user_id=auth.uid()),'request_pending',exists(select 1 from public.rivo_community_join_requests q where q.community_id=c.id and q.user_id=auth.uid())) from public.rivo_communities c where c.id=p_id;
$$;
revoke all on function public.rivo_get_community(bigint) from public;
grant execute on function public.rivo_get_community(bigint) to anon, authenticated;

create or replace function public.rivo_join_community(p_id bigint)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me uuid:=auth.uid(); c public.rivo_communities; is_friend boolean:=false;
begin
  if me is null then raise exception 'Not signed in'; end if;
  select * into c from public.rivo_communities where id=p_id;
  if c.id is null then raise exception 'Community not found'; end if;
  if exists(select 1 from public.rivo_community_members where community_id=p_id and user_id=me) then return public.rivo_get_community(p_id); end if;
  if c.join_policy='public' then insert into public.rivo_community_members values(p_id,me,'member') on conflict do nothing;
  elsif c.join_policy='friends' then
    select exists(select 1 from public.profiles mep join public.profiles own on own.id=c.owner_id where mep.id=me and coalesce(mep.public_data->'friends','[]'::jsonb) ? own.username) into is_friend;
    if not is_friend then raise exception 'Only friends of the owner can join'; end if;
    insert into public.rivo_community_members values(p_id,me,'member') on conflict do nothing;
  else
    insert into public.rivo_community_join_requests values(p_id,me) on conflict do nothing;
  end if;
  return public.rivo_get_community(p_id);
end; $$;
revoke all on function public.rivo_join_community(bigint) from public;
grant execute on function public.rivo_join_community(bigint) to authenticated;

create or replace function public.rivo_leave_community(p_id bigint)
returns boolean language plpgsql security definer set search_path=public as $$
declare me uuid:=auth.uid(); is_owner boolean;
begin
  if me is null then raise exception 'Not signed in'; end if;
  select exists(select 1 from public.rivo_community_members where community_id=p_id and user_id=me and role='owner') into is_owner;
  if is_owner then raise exception 'Owner cannot leave; transfer ownership is not supported yet'; end if;
  delete from public.rivo_community_members where community_id=p_id and user_id=me;
  return true;
end; $$;
revoke all on function public.rivo_leave_community(bigint) from public;
grant execute on function public.rivo_leave_community(bigint) to authenticated;

create or replace function public.rivo_list_community_requests(p_id bigint)
returns setof jsonb language sql security definer set search_path=public as $$
select jsonb_build_object('username',p.username,'displayName',coalesce(p.public_data->>'displayName',p.username),'avatar',coalesce(p.public_data->>'avatar',''),'created_at',q.created_at)
from public.rivo_community_join_requests q join public.rivo_communities c on c.id=q.community_id join public.profiles p on p.id=q.user_id
where q.community_id=p_id and c.owner_id=auth.uid() order by q.created_at asc;
$$;
revoke all on function public.rivo_list_community_requests(bigint) from public;
grant execute on function public.rivo_list_community_requests(bigint) to authenticated;

create or replace function public.rivo_respond_community_request(p_id bigint,p_username text,p_accept boolean)
returns boolean language plpgsql security definer set search_path=public as $$
declare uid uuid; allowed boolean;
begin
  select c.owner_id=auth.uid() into allowed from public.rivo_communities c where c.id=p_id;
  if not coalesce(allowed,false) then raise exception 'Only the owner can manage requests'; end if;
  select id into uid from public.profiles where username=lower(trim(both '@' from p_username));
  if uid is null then raise exception 'User not found'; end if;
  delete from public.rivo_community_join_requests where community_id=p_id and user_id=uid;
  if p_accept then insert into public.rivo_community_members(community_id,user_id,role) values(p_id,uid,'member') on conflict do nothing; end if;
  return true;
end; $$;
revoke all on function public.rivo_respond_community_request(bigint,text,boolean) from public;
grant execute on function public.rivo_respond_community_request(bigint,text,boolean) to authenticated;

create or replace function public.rivo_kick_community_member(p_id bigint,p_username text)
returns boolean language plpgsql security definer set search_path=public as $$
declare uid uuid;
begin
  if not exists(select 1 from public.rivo_communities where id=p_id and owner_id=auth.uid()) then raise exception 'Only the owner can remove members'; end if;
  select id into uid from public.profiles where username=lower(trim(both '@' from p_username));
  delete from public.rivo_community_members where community_id=p_id and user_id=uid and role<>'owner';
  return true;
end; $$;
revoke all on function public.rivo_kick_community_member(bigint,text) from public;
grant execute on function public.rivo_kick_community_member(bigint,text) to authenticated;

create or replace function public.rivo_list_community_members(p_id bigint)
returns setof jsonb language sql security definer set search_path=public as $$
select jsonb_build_object('username',p.username,'displayName',coalesce(p.public_data->>'displayName',p.username),'avatar',coalesce(p.public_data->>'avatar',''),'role',m.role) from public.rivo_community_members m join public.profiles p on p.id=m.user_id where m.community_id=p_id order by m.role desc,m.joined_at asc;
$$;
revoke all on function public.rivo_list_community_members(bigint) from public;
grant execute on function public.rivo_list_community_members(bigint) to authenticated;

create or replace function public.rivo_get_community_messages(p_id bigint,p_limit int default 120)
returns setof jsonb language sql security definer set search_path=public as $$
select jsonb_build_object('id',m.id,'content',m.content,'created_at',m.created_at,'author',public.rivo_social_profile(m.user_id)) from public.rivo_community_messages m where m.community_id=p_id and exists(select 1 from public.rivo_community_members cm where cm.community_id=p_id and cm.user_id=auth.uid()) order by m.created_at desc limit greatest(1,least(coalesce(p_limit,120),200));
$$;
revoke all on function public.rivo_get_community_messages(bigint,int) from public;
grant execute on function public.rivo_get_community_messages(bigint,int) to authenticated;

create or replace function public.rivo_send_community_message(p_id bigint,p_content text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me uuid:=auth.uid(); mid bigint;
begin
  if me is null or not exists(select 1 from public.rivo_community_members where community_id=p_id and user_id=me) then raise exception 'Join the community first'; end if;
  insert into public.rivo_community_messages(community_id,user_id,content) values(p_id,me,trim(p_content)) returning id into mid;
  return (select jsonb_build_object('id',m.id,'content',m.content,'created_at',m.created_at,'author',public.rivo_social_profile(m.user_id)) from public.rivo_community_messages m where m.id=mid);
end; $$;
revoke all on function public.rivo_send_community_message(bigint,text) from public;
grant execute on function public.rivo_send_community_message(bigint,text) to authenticated;

-- Owner/member changes are mediated through RPCs. No direct INSERT/UPDATE/DELETE policies are granted to anon.

-- Realtime for community chat.
do $$ begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='rivo_community_messages') then alter publication supabase_realtime add table public.rivo_community_messages; end if;
end $$;

-- ============================================================
-- Rivo Social v3: owner-only deletion for posts/communities
-- ============================================================
create or replace function public.rivo_delete_post(p_post_id bigint)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me uuid:=auth.uid(); owner_id uuid;
begin
  if me is null then raise exception 'Not signed in'; end if;
  select user_id into owner_id from public.rivo_posts where id=p_post_id;
  if owner_id is null then raise exception 'Post not found'; end if;
  if owner_id <> me then raise exception 'Only the post owner can delete this post'; end if;
  delete from public.rivo_posts where id=p_post_id;
  return jsonb_build_object('deleted',true,'id',p_post_id);
end; $$;
revoke all on function public.rivo_delete_post(bigint) from public;
grant execute on function public.rivo_delete_post(bigint) to authenticated;

create or replace function public.rivo_delete_community(p_id bigint)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me uuid:=auth.uid(); owner_id uuid;
begin
  if me is null then raise exception 'Not signed in'; end if;
  select owner_id into owner_id from public.rivo_communities where id=p_id;
  if owner_id is null then raise exception 'Community not found'; end if;
  if owner_id <> me then raise exception 'Only the community owner can delete it'; end if;
  delete from public.rivo_communities where id=p_id;
  return jsonb_build_object('deleted',true,'id',p_id);
end; $$;
revoke all on function public.rivo_delete_community(bigint) from public;
grant execute on function public.rivo_delete_community(bigint) to authenticated;

-- Rivo Economy System
-- Run after the existing Rivo schema. Safe to re-run.

create extension if not exists pgcrypto;

alter table public.profiles
  add column if not exists coins_balance bigint not null default 0;

alter table public.profiles
  drop constraint if exists profiles_coins_balance_nonnegative;
alter table public.profiles
  add constraint profiles_coins_balance_nonnegative check (coins_balance >= 0);

create table if not exists public.store_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  type text not null check (type in ('avatar','frame','template','badge','feature')),
  price bigint not null default 0 check (price >= 0),
  image_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists store_items_name_type_uq on public.store_items(lower(name), type);
create index if not exists store_items_active_type_idx on public.store_items(is_active, type, price);

-- Backward-compatible migration for an older v19 database that allowed only four item types.
alter table public.store_items drop constraint if exists store_items_type_check;
alter table public.store_items add constraint store_items_type_check check (type in ('avatar','frame','template','badge','feature'));

create table if not exists public.user_inventory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  item_id uuid not null references public.store_items(id) on delete cascade,
  purchased_at timestamptz not null default now(),
  is_equipped boolean not null default false,
  unique(user_id, item_id)
);
create index if not exists user_inventory_user_idx on public.user_inventory(user_id, is_equipped, purchased_at desc);

create table if not exists public.coin_transactions (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid references public.profiles(id) on delete set null,
  receiver_id uuid references public.profiles(id) on delete set null,
  amount bigint not null check (amount > 0),
  type text not null check (type in ('transfer','ad_reward','purchase')),
  item_id uuid references public.store_items(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists coin_transactions_sender_idx on public.coin_transactions(sender_id, created_at desc);
create index if not exists coin_transactions_receiver_idx on public.coin_transactions(receiver_id, created_at desc);

-- Server-side throttle for ad-reward claims. This does not replace a real ad
-- provider's server callback, but prevents an unrestricted RPC farming loop.
create table if not exists public.coin_ad_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  reward_amount bigint not null check (reward_amount between 10 and 25),
  created_at timestamptz not null default now()
);
create index if not exists coin_ad_claims_user_created_idx on public.coin_ad_claims(user_id, created_at desc);

alter table public.store_items enable row level security;
alter table public.user_inventory enable row level security;
alter table public.coin_transactions enable row level security;
alter table public.coin_ad_claims enable row level security;

drop policy if exists "store_items_select_active" on public.store_items;
create policy "store_items_select_active" on public.store_items
for select to anon, authenticated using (is_active = true);

drop policy if exists "user_inventory_select_own" on public.user_inventory;
create policy "user_inventory_select_own" on public.user_inventory
for select to authenticated using (auth.uid() = user_id);

drop policy if exists "coin_transactions_select_own" on public.coin_transactions;
create policy "coin_transactions_select_own" on public.coin_transactions
for select to authenticated using (auth.uid() = sender_id or auth.uid() = receiver_id);

-- No direct client writes to economy tables. RPCs below are the write path.
revoke insert, update, delete on public.store_items from anon, authenticated;
revoke insert, update, delete on public.user_inventory from anon, authenticated;
revoke insert, update, delete on public.coin_transactions from anon, authenticated;
revoke select, insert, update, delete on public.coin_ad_claims from anon, authenticated;
grant select on public.store_items to anon, authenticated;
grant select on public.user_inventory to authenticated;
grant select on public.coin_transactions to authenticated;

create or replace function public.rivo_get_coin_balance()
returns bigint
language sql
security definer
set search_path = public
as $$
  select coins_balance from public.profiles where id = auth.uid();
$$;
revoke all on function public.rivo_get_coin_balance() from public;
grant execute on function public.rivo_get_coin_balance() to authenticated;

create or replace function public.rivo_list_store_items(p_type text default null)
returns setof jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', s.id,
    'name', s.name,
    'description', s.description,
    'type', s.type,
    'price', s.price,
    'image_url', s.image_url,
    'is_active', s.is_active
  )
  from public.store_items s
  where s.is_active = true
    and (p_type is null or s.type = lower(trim(p_type)))
  order by s.price asc, s.created_at asc;
$$;
revoke all on function public.rivo_list_store_items(text) from public;
grant execute on function public.rivo_list_store_items(text) to anon, authenticated;

create or replace function public.rivo_list_my_inventory()
returns setof jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'inventory_id', ui.id,
    'item_id', s.id,
    'name', s.name,
    'description', s.description,
    'type', s.type,
    'price', s.price,
    'image_url', s.image_url,
    'purchased_at', ui.purchased_at,
    'is_equipped', ui.is_equipped
  )
  from public.user_inventory ui
  join public.store_items s on s.id = ui.item_id
  where ui.user_id = auth.uid()
  order by ui.purchased_at desc;
$$;
revoke all on function public.rivo_list_my_inventory() from public;
grant execute on function public.rivo_list_my_inventory() to authenticated;

create or replace function public.purchase_store_item(target_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  item public.store_items;
  balance bigint;
  already_owned boolean;
  new_balance bigint;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  perform set_config('rivo.internal_coin_update','on',true);

  select * into item
  from public.store_items
  where id = target_item_id and is_active = true
  for update;
  if not found then raise exception 'Store item is unavailable'; end if;

  select exists(
    select 1 from public.user_inventory where user_id = uid and item_id = target_item_id
  ) into already_owned;
  if already_owned then raise exception 'You already own this item'; end if;

  select coins_balance into balance from public.profiles where id = uid for update;
  if balance is null then raise exception 'Profile not found'; end if;
  if balance < item.price then raise exception 'Not enough coins'; end if;

  new_balance := balance - item.price;
  update public.profiles set coins_balance = new_balance, updated_at = now() where id = uid;
  insert into public.user_inventory(user_id, item_id, is_equipped)
  values(uid, item.id, false);
  if item.price > 0 then
    insert into public.coin_transactions(sender_id, receiver_id, amount, type, item_id)
    values(uid, null, item.price, 'purchase', item.id);
  end if;

  return jsonb_build_object(
    'item_id', item.id,
    'price', item.price,
    'coins_balance', new_balance
  );
end;
$$;
revoke all on function public.purchase_store_item(uuid) from public;
grant execute on function public.purchase_store_item(uuid) to authenticated;

create or replace function public.transfer_coins_by_username(target_username text, transfer_amount bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  target_id uuid;
  sender_balance bigint;
  receiver_balance bigint;
  new_sender_balance bigint;
  new_receiver_balance bigint;
  lookup text := lower(trim(both '@' from coalesce(target_username, '')));
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  perform set_config('rivo.internal_coin_update','on',true);
  if transfer_amount is null or transfer_amount <= 0 then raise exception 'Transfer amount must be greater than 0'; end if;
  if transfer_amount > 1000000000 then raise exception 'Transfer amount is too large'; end if;

  select p.id into target_id
  from public.profiles p
  where lower(p.username) = lookup or lower(p.auth_email) = lookup
  limit 1;
  if target_id is null then raise exception 'Recipient not found'; end if;
  if target_id = uid then raise exception 'You cannot transfer coins to yourself'; end if;

  -- Lock both profiles before reading balances; deterministic ordering avoids
  -- the classic sender/receiver deadlock when two users transfer concurrently.
  perform 1 from public.profiles p where p.id in (uid, target_id) order by p.id for update;
  select coins_balance into sender_balance from public.profiles where id = uid;
  select coins_balance into receiver_balance from public.profiles where id = target_id;

  if sender_balance < transfer_amount then raise exception 'Not enough coins'; end if;
  new_sender_balance := sender_balance - transfer_amount;
  new_receiver_balance := receiver_balance + transfer_amount;

  update public.profiles set coins_balance = new_sender_balance, updated_at = now() where id = uid;
  update public.profiles set coins_balance = new_receiver_balance, updated_at = now() where id = target_id;
  insert into public.coin_transactions(sender_id, receiver_id, amount, type)
  values(uid, target_id, transfer_amount, 'transfer');

  return jsonb_build_object(
    'amount', transfer_amount,
    'coins_balance', new_sender_balance,
    'receiver_id', target_id
  );
end;
$$;
revoke all on function public.transfer_coins_by_username(text, bigint) from public;
grant execute on function public.transfer_coins_by_username(text, bigint) to authenticated;

create or replace function public.reward_ad_coins(reward_amount bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  current_balance bigint;
  new_balance bigint;
  last_claim timestamptz;
  day_claims integer;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  perform set_config('rivo.internal_coin_update','on',true);
  if reward_amount is null or reward_amount < 10 or reward_amount > 25 then raise exception 'Reward must be between 10 and 25 coins'; end if;

  -- Lock the user's profile before checking limits so concurrent reward
  -- requests cannot both pass the cooldown/daily-cap checks.
  select coins_balance into current_balance from public.profiles where id = uid for update;
  if current_balance is null then raise exception 'Profile not found'; end if;

  select max(created_at) into last_claim
  from public.coin_ad_claims where user_id = uid;
  if last_claim is not null and last_claim > now() - interval '30 seconds' then
    raise exception 'Please wait before claiming another ad reward';
  end if;

  select count(*)::int into day_claims
  from public.coin_ad_claims
  where user_id = uid and created_at >= date_trunc('day', now());
  if day_claims >= 20 then raise exception 'Daily ad reward limit reached'; end if;

  new_balance := current_balance + reward_amount;

  update public.profiles set coins_balance = new_balance, updated_at = now() where id = uid;
  insert into public.coin_ad_claims(user_id, reward_amount) values(uid, reward_amount);
  insert into public.coin_transactions(sender_id, receiver_id, amount, type)
  values(null, uid, reward_amount, 'ad_reward');

  return jsonb_build_object('reward', reward_amount, 'coins_balance', new_balance);
end;
$$;
revoke all on function public.reward_ad_coins(bigint) from public;
grant execute on function public.reward_ad_coins(bigint) to authenticated;

create or replace function public.equip_store_item(target_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  inv public.user_inventory;
  item public.store_items;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select ui.id, ui.user_id, ui.item_id, ui.purchased_at, ui.is_equipped into inv
  from public.user_inventory ui
  where ui.user_id = uid and ui.item_id = target_item_id
  for update;
  select * into item from public.store_items where id = target_item_id and is_active = true;
  if inv.id is null or item.id is null then raise exception 'You do not own this item'; end if;

  if item.type in ('frame','avatar','template') then
    update public.user_inventory ui
    set is_equipped = false
    from public.store_items s
    where ui.user_id = uid and ui.item_id = s.id and s.type = item.type;
  end if;

  update public.user_inventory set is_equipped = not is_equipped
  where id = inv.id;

  return jsonb_build_object('item_id', item.id, 'type', item.type);
end;
$$;
revoke all on function public.equip_store_item(uuid) from public;
grant execute on function public.equip_store_item(uuid) to authenticated;

-- Public profiles expose only equipped cosmetic items, never the inventory.
-- Public profile RPC is finalized by the latest profile migration.
-- Keep the economy migration focused on economy tables/RPCs so rerunning it
-- cannot accidentally overwrite Story, followers, calls, or equipped cosmetics.


-- Editor-unlock catalogue. These items are surfaced inside the profile editor,
-- not through a separate storefront. Ownership unlocks the corresponding editor option.
insert into public.store_items (name, description, type, price, image_url, is_active)
values
  ('Starter Avatar', 'Basic avatar option.', 'avatar', 0, null, true),
  ('Starter Frame', 'Basic clean avatar frame.', 'frame', 0, null, true),
  ('Starter Badge', 'Basic starter badge.', 'badge', 0, null, true),

  ('Frame · Ring', 'Accent outline frame.', 'frame', 75, null, true),
  ('Frame · Double', 'Layered premium frame.', 'frame', 120, null, true),
  ('Frame · Diamond', 'Sharp diamond frame.', 'frame', 180, null, true),
  ('Frame · Glow', 'Soft luminous halo.', 'frame', 250, null, true),
  ('Frame · Scan', 'Animated scan frame.', 'frame', 350, null, true),
  ('Frame · Hologram', 'Glass hologram frame.', 'frame', 600, null, true),
  ('Frame · Orbit', 'Orbiting satellite frame.', 'frame', 800, null, true),
  ('Frame · Prism', 'Faceted prism frame.', 'frame', 1000, null, true),
  ('Frame · Starburst', 'Stellar burst frame.', 'frame', 1500, null, true),
  ('Frame · Halo', 'Soft orbital crown.', 'frame', 1800, null, true),
  ('Frame · Ribbon', 'Layered side sweep.', 'frame', 2200, null, true),
  ('Frame · Circuit', 'Tech circuit frame.', 'frame', 2600, null, true),
  ('Frame · Lattice', 'Geometric mesh frame.', 'frame', 3200, null, true),

  ('Badge · Developer', 'Developer profile badge.', 'badge', 100, null, true),
  ('Badge · Creator', 'Creator profile badge.', 'badge', 120, null, true),
  ('Badge · Gamer', 'Gamer profile badge.', 'badge', 80, null, true),
  ('Badge · Early User', 'Early supporter badge.', 'badge', 250, null, true),
  ('Badge · VIP', 'VIP cosmetic badge.', 'badge', 500, null, true),
  ('Badge · Top Creator', 'Rare creator badge.', 'badge', 1500, null, true),
  ('Badge · Trusted', 'Trusted member badge.', 'badge', 800, null, true),

  ('Template · Discord Noir', 'Core Rivo social HUD.', 'template', 0, null, true),
  ('Template · Anime Cinema', 'Cinematic editorial profile.', 'template', 450, null, true),
  ('Template · Neon Arena', 'Competitive luminous profile.', 'template', 700, null, true),
  ('Template · Cyber Terminal', 'Technical console profile.', 'template', 900, null, true),
  ('Template · Dark Luxury', 'Luxury obsidian profile.', 'template', 1200, null, true),
  ('Template · Minimal Ice', 'Ultra-clean precision profile.', 'template', 1400, null, true),
  ('Template · Samurai Ink', 'Ink poster profile.', 'template', 1700, null, true),
  ('Template · Deep Space', 'Cosmic depth profile.', 'template', 1900, null, true),
  ('Template · Creator Pulse', 'Media-first creator profile.', 'template', 2200, null, true),
  ('Template · Monochrome Pro', 'Executive grayscale profile.', 'template', 2500, null, true),
  ('Template · Starlight Royal', 'Constellation profile.', 'template', 3000, null, true),
  ('Template · Aurora Glass', 'Crystalline aurora profile.', 'template', 3500, null, true),
  ('Template · Obsidian Court', 'Luxury court profile.', 'template', 5000, null, true),
  ('Template · Pixel Arcade', 'Retro arcade profile.', 'template', 2800, null, true),
  ('Template · Botanical Night', 'Night garden profile.', 'template', 2400, null, true),
  ('Template · White Atelier', 'Editorial white profile.', 'template', 3200, null, true),
  ('Template · White Signal', 'Crisp white tech profile.', 'template', 3600, null, true),

  ('Template · Card Style Glass', 'Glass card surface.', 'template', 0, null, true),
  ('Template · Card Style Solid', 'Strong solid card surface.', 'template', 100, null, true),
  ('Template · Card Style Outline', 'Clean outlined card surface.', 'template', 150, null, true),
  ('Template · Card Style Poster', 'Cinematic poster card surface.', 'template', 250, null, true),
  ('Template · Card Style Terminal', 'Technical terminal card surface.', 'template', 300, null, true),
  ('Template · Card Style Frosted', 'Crystal frosted card surface.', 'template', 350, null, true),
  ('Template · Card Style Notched', 'Cut-corner card surface.', 'template', 450, null, true),
  ('Template · Card Style Frame', 'Gallery frame card surface.', 'template', 550, null, true),
  ('Template · Card Style Aurora', 'Aurora glow card surface.', 'template', 700, null, true),
  ('Template · Card Style Starfield', 'Night sky card surface.', 'template', 800, null, true),
  ('Template · Card Style Paper', 'Editorial paper card surface.', 'template', 900, null, true),
  ('Template · Card Style Split', 'Dual-surface card layout.', 'template', 1000, null, true),
  ('Template · Card Style Ticket', 'Notched ticket card surface.', 'template', 1200, null, true),

  ('Feature · Avatar Upload', 'Unlock custom avatar uploads.', 'feature', 150, null, true),
  ('Feature · Banner Upload', 'Unlock custom profile banner uploads.', 'feature', 200, null, true),
  ('Feature · Floating Image', 'Unlock your floating profile image.', 'feature', 250, null, true),
  ('Feature · Profile Music', 'Unlock profile music and audio.', 'feature', 500, null, true),
  ('Feature · Music Cover', 'Unlock custom music cover art.', 'feature', 150, null, true),
  ('Feature · Custom Accent', 'Unlock custom accent colors.', 'feature', 120, null, true),
  ('Feature · Radius Control', 'Unlock advanced card radius control.', 'feature', 100, null, true),
  ('Feature · Glow Control', 'Unlock advanced glow control.', 'feature', 180, null, true),
  ('Feature · Social Links', 'Unlock custom social links.', 'feature', 100, null, true),
  ('Feature · Profile Sections', 'Unlock advanced profile section controls.', 'feature', 300, null, true)
on conflict (lower(name), type) do update set
  description = excluded.description,
  price = excluded.price,
  image_url = excluded.image_url,
  is_active = excluded.is_active;

-- ================================================================
-- Server-side anti-bypass protection for paid editor cosmetics.
-- A client may update public_data, so paid values must be validated on
-- the database too; otherwise a modified browser could unlock badges,
-- frames, templates or media features without spending coins.
-- ================================================================
create or replace function public.rivo_inventory_owned_by_name(p_user_id uuid, p_name text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_inventory ui
    join public.store_items si on si.id = ui.item_id
    where ui.user_id = p_user_id
      and si.is_active = true
      and lower(si.name) = lower(trim(p_name))
  );
$$;
revoke all on function public.rivo_inventory_owned_by_name(uuid,text) from public;


create or replace function public.rivo_validate_paid_profile_data()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := NEW.id;
  value text;
  badge_name text;
  template_name text;
  frame_name text;
  old_data jsonb;
  new_data jsonb := coalesce(NEW.public_data, '{}'::jsonb);
begin
  old_data := case when TG_OP = 'UPDATE' then coalesce(OLD.public_data, '{}'::jsonb) else '{}'::jsonb end;

  if TG_OP = 'INSERT' or new_data->'badges' is distinct from old_data->'badges' then
    for value in select jsonb_array_elements_text(coalesce(new_data->'badges','[]'::jsonb)) loop
      if value in ('verified','founder') then continue; end if;
      badge_name := case value
        when 'developer' then 'Badge · Developer'
        when 'creator' then 'Badge · Creator'
        when 'gamer' then 'Badge · Gamer'
        when 'early' then 'Badge · Early User'
        when 'vip' then 'Badge · VIP'
        when 'top' then 'Badge · Top Creator'
        when 'trusted' then 'Badge · Trusted'
        else null
      end;
      if badge_name is null or not public.rivo_inventory_owned_by_name(uid, badge_name) then
        raise exception 'This badge is not owned';
      end if;
    end loop;
  end if;

  if TG_OP = 'INSERT' or new_data->>'template' is distinct from old_data->>'template' then
    value := coalesce(new_data->>'template','discord-noir');
    template_name := case value
      when 'discord-noir' then null
      when 'anime-cinema' then 'Template · Anime Cinema'
      when 'neon-arena' then 'Template · Neon Arena'
      when 'cyber-terminal' then 'Template · Cyber Terminal'
      when 'dark-luxury' then 'Template · Dark Luxury'
      when 'minimal-ice' then 'Template · Minimal Ice'
      when 'samurai-ink' then 'Template · Samurai Ink'
      when 'deep-space' then 'Template · Deep Space'
      when 'creator-pulse' then 'Template · Creator Pulse'
      when 'monochrome-pro' then 'Template · Monochrome Pro'
      when 'starlight-royal' then 'Template · Starlight Royal'
      when 'aurora-glass' then 'Template · Aurora Glass'
      when 'obsidian-court' then 'Template · Obsidian Court'
      when 'pixel-arcade' then 'Template · Pixel Arcade'
      when 'botanical-night' then 'Template · Botanical Night'
      when 'white-atelier' then 'Template · White Atelier'
      when 'white-signal' then 'Template · White Signal'
      else null
    end;
    if value <> 'discord-noir' and (template_name is null or not public.rivo_inventory_owned_by_name(uid, template_name)) then
      raise exception 'This template is not owned';
    end if;
  end if;

  if TG_OP = 'INSERT' or new_data->>'cardStyle' is distinct from old_data->>'cardStyle' then
    value := coalesce(new_data->>'cardStyle','glass');
    if value <> 'glass' and not public.rivo_inventory_owned_by_name(uid, 'Template · Card Style ' || initcap(value)) then
      raise exception 'This card style is not owned';
    end if;
  end if;

  if TG_OP = 'INSERT' or new_data->>'avatarFrame' is distinct from old_data->>'avatarFrame' then
    value := coalesce(new_data->>'avatarFrame','none');
    if value <> 'none' then
      frame_name := 'Frame · ' || initcap(value);
      if not public.rivo_inventory_owned_by_name(uid, frame_name) then
        raise exception 'This frame is not owned';
      end if;
    end if;
  end if;

  if coalesce(new_data->>'avatar','') <> coalesce(old_data->>'avatar','') and coalesce(new_data->>'avatar','') <> ''
     and not public.rivo_inventory_owned_by_name(uid,'Feature · Avatar Upload') then raise exception 'Avatar upload feature is not owned'; end if;
  if coalesce(new_data->>'banner','') <> coalesce(old_data->>'banner','') and coalesce(new_data->>'banner','') <> ''
     and not public.rivo_inventory_owned_by_name(uid,'Feature · Banner Upload') then raise exception 'Banner upload feature is not owned'; end if;
  if coalesce(new_data->>'miniImage','') <> coalesce(old_data->>'miniImage','') and coalesce(new_data->>'miniImage','') <> ''
     and not public.rivo_inventory_owned_by_name(uid,'Feature · Floating Image') then raise exception 'Floating image feature is not owned'; end if;
  if coalesce(new_data->'music'->>'audio','') <> coalesce(old_data->'music'->>'audio','')
     and coalesce(new_data->'music'->>'audio','') <> ''
     and not public.rivo_inventory_owned_by_name(uid,'Feature · Profile Music') then raise exception 'Profile music feature is not owned'; end if;
  if coalesce(new_data->'music'->>'cover','') <> coalesce(old_data->'music'->>'cover','') and coalesce(new_data->'music'->>'cover','') <> ''
     and not public.rivo_inventory_owned_by_name(uid,'Feature · Music Cover') then raise exception 'Music cover feature is not owned'; end if;

  if (new_data ? 'accent') and coalesce(new_data->>'accent','#7488ff') <> coalesce(old_data->>'accent','#7488ff')
     and coalesce(new_data->>'accent','#7488ff') <> '#7488ff'
     and not public.rivo_inventory_owned_by_name(uid,'Feature · Custom Accent') then raise exception 'Custom accent feature is not owned'; end if;
  if TG_OP = 'UPDATE' and new_data ? 'cardRadius'
     and coalesce((new_data->>'cardRadius')::numeric,24) <> coalesce((old_data->>'cardRadius')::numeric,24)
     and not public.rivo_inventory_owned_by_name(uid,'Feature · Radius Control') then raise exception 'Radius control feature is not owned'; end if;
  if TG_OP = 'UPDATE' and new_data ? 'glow'
     and coalesce((new_data->>'glow')::numeric,45) <> coalesce((old_data->>'glow')::numeric,45)
     and not public.rivo_inventory_owned_by_name(uid,'Feature · Glow Control') then raise exception 'Glow control feature is not owned'; end if;
  if jsonb_array_length(coalesce(new_data->'socials','[]'::jsonb)) > 0
     and jsonb_array_length(coalesce(old_data->'socials','[]'::jsonb)) = 0
     and not public.rivo_inventory_owned_by_name(uid,'Feature · Social Links') then raise exception 'Social links feature is not owned'; end if;

  return NEW;
end;
$$;

revoke all on function public.rivo_validate_paid_profile_data() from public;

drop trigger if exists trg_rivo_validate_paid_profile_data on public.profiles;
create trigger trg_rivo_validate_paid_profile_data
before insert or update of public_data on public.profiles
for each row execute function public.rivo_validate_paid_profile_data();


-- ================================================================
-- v22 economy hardening
-- ================================================================
create or replace function public.rivo_guard_coin_balance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if NEW.coins_balance is distinct from OLD.coins_balance
     and coalesce(current_setting('rivo.internal_coin_update', true), '') <> 'on' then
    raise exception 'Coins balance can only be changed by the Rivo economy';
  end if;
  return NEW;
end;
$$;
revoke all on function public.rivo_guard_coin_balance() from public;
drop trigger if exists trg_rivo_guard_coin_balance on public.profiles;
create trigger trg_rivo_guard_coin_balance
before update of coins_balance on public.profiles
for each row execute function public.rivo_guard_coin_balance();

update public.profiles
set public_data = public_data - 'coinsBalance' - 'coins_balance'
where public_data ? 'coinsBalance' or public_data ? 'coins_balance';

create or replace function public.rivo_grant_starter_inventory(p_user_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.user_inventory(user_id, item_id, is_equipped)
  select p_user_id, s.id, false
  from public.store_items s
  where s.is_active = true
    and s.price = 0
    and s.name in ('Starter Avatar','Starter Frame','Starter Badge')
    and not exists (select 1 from public.user_inventory ui where ui.user_id = p_user_id and ui.item_id = s.id);
$$;
revoke all on function public.rivo_grant_starter_inventory(uuid) from public;

create or replace function public.rivo_grant_starter_inventory_on_profile_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.rivo_grant_starter_inventory(NEW.id);
  return NEW;
end;
$$;
revoke all on function public.rivo_grant_starter_inventory_on_profile_insert() from public;
drop trigger if exists trg_rivo_grant_starter_inventory on public.profiles;
create trigger trg_rivo_grant_starter_inventory
after insert on public.profiles
for each row execute function public.rivo_grant_starter_inventory_on_profile_insert();

insert into public.user_inventory(user_id, item_id, is_equipped)
select p.id, s.id, false
from public.profiles p
cross join public.store_items s
where s.is_active = true
  and s.price = 0
  and s.name in ('Starter Avatar','Starter Frame','Starter Badge')
  and not exists (select 1 from public.user_inventory ui where ui.user_id = p.id and ui.item_id = s.id);


create or replace function public.rivo_get_public_profile(p_username text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare r public.profiles;
begin
  select * into r from public.profiles
  where username = lower(trim(both '@' from p_username))
  limit 1;
  if not found then return null; end if;

  return jsonb_build_object(
    'userId', r.id,
    'username', r.username,
    'displayName', coalesce(r.public_data->>'displayName', r.username),
    'bio', coalesce(r.public_data->>'bio',''),
    'description', coalesce(r.public_data->>'description',''),
    'location', coalesce(r.public_data->>'location',''),
    'website', coalesce(r.public_data->>'website',''),
    'avatar', coalesce(r.public_data->>'avatar',''),
    'banner', coalesce(r.public_data->>'banner',''),
    'miniImage', coalesce(r.public_data->>'miniImage',''),
    'status', coalesce(r.public_data->>'status','Online'),
    'customStatus', coalesce(r.public_data->>'customStatus',''),
    'theme', coalesce(r.public_data->>'theme','obsidian'),
    'template', coalesce(r.public_data->>'template','discord-noir'),
    'accent', coalesce(r.public_data->>'accent','#7488ff'),
    'cardRadius', coalesce((r.public_data->>'cardRadius')::numeric,24),
    'cardStyle', coalesce(r.public_data->>'cardStyle','glass'),
    'glow', coalesce((r.public_data->>'glow')::numeric,45),
    'background', coalesce(r.public_data->>'background','aurora'),
    'animation', coalesce(r.public_data->>'animation','soft'),
    'socials', coalesce(r.public_data->'socials','[]'::jsonb),
    'skills', coalesce(r.public_data->'skills','[]'::jsonb),
    'badges', coalesce(r.public_data->'badges','[]'::jsonb),
    'projects', coalesce(r.public_data->'projects','[]'::jsonb),
    'friends', coalesce(r.public_data->'friends','[]'::jsonb),
    'sections', coalesce(r.public_data->'sections','[]'::jsonb),
    'music', coalesce(r.public_data->'music','{}'::jsonb),
    'avatarFrame', coalesce(r.public_data->>'avatarFrame','none'),
    'avatarFrameColor', coalesce(r.public_data->>'avatarFrameColor','#8b5cf6'),
    'avatarFrameGlow', coalesce((r.public_data->>'avatarFrameGlow')::numeric,35),
    'avatarFrameWidth', coalesce((r.public_data->>'avatarFrameWidth')::numeric,3),
    'stats', coalesce(r.public_data->'stats', jsonb_build_object('views',0)),
    'likes', jsonb_build_object(
      'count', coalesce((r.public_data->'likes'->>'count')::int,0),
      'users', coalesce(r.public_data->'likes'->'users','[]'::jsonb)
    ),
    'messagePrivacy', coalesce(r.private_data->'messageSettings'->>'whoCanMessage','everyone'),
    'equippedStoreItems', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'name', s.name,
        'description', s.description,
        'type', s.type,
        'price', s.price,
        'image_url', s.image_url,
        'is_equipped', ui.is_equipped
      ) order by s.type, s.name)
      from public.user_inventory ui
      join public.store_items s on s.id = ui.item_id
      where ui.user_id = r.id and ui.is_equipped and s.is_active
    ), '[]'::jsonb),
    'createdAt', r.created_at,
    'updatedAt', r.updated_at
  );
end;
$$;
revoke all on function public.rivo_get_public_profile(text) from public;
grant execute on function public.rivo_get_public_profile(text) to anon, authenticated;
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

-- Rivo Communities V2
-- Community creation economy, moderation roles, voice-room permissions and
-- secure LiveKit authorization. Run after the existing Rivo schema/economy files.
-- Safe to run repeatedly.

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- Community settings
-- ------------------------------------------------------------
alter table public.rivo_communities
  add column if not exists voice_start_policy text not null default 'everyone';

alter table public.rivo_communities
  drop constraint if exists rivo_communities_voice_start_policy_check;
alter table public.rivo_communities
  add constraint rivo_communities_voice_start_policy_check
  check (voice_start_policy in ('everyone','moderators','owner'));

-- Moderation roles: owner > moderator > member.
alter table public.rivo_community_members
  drop constraint if exists rivo_community_members_role_check;
alter table public.rivo_community_members
  add constraint rivo_community_members_role_check
  check (role in ('owner','moderator','member'));

-- Older economy schemas only allow a small fixed transaction list.
alter table public.coin_transactions
  drop constraint if exists coin_transactions_type_check;
alter table public.coin_transactions
  add constraint coin_transactions_type_check
  check (type in ('transfer','ad_reward','purchase','community_create'));

-- ------------------------------------------------------------
-- Active community voice sessions
-- ------------------------------------------------------------
create table if not exists public.rivo_community_voice_sessions (
  id uuid primary key default gen_random_uuid(),
  community_id bigint not null references public.rivo_communities(id) on delete cascade,
  started_by uuid not null references auth.users(id) on delete cascade,
  room_name text not null unique,
  status text not null default 'active' check (status in ('active','ended')),
  created_at timestamptz not null default now(),
  ended_at timestamptz
);
create index if not exists rivo_community_voice_sessions_community_idx
  on public.rivo_community_voice_sessions(community_id, created_at desc);
create unique index if not exists rivo_community_voice_active_uq
  on public.rivo_community_voice_sessions(community_id)
  where status = 'active';

alter table public.rivo_community_voice_sessions enable row level security;
drop policy if exists "rivo_community_voice_select_member" on public.rivo_community_voice_sessions;
create policy "rivo_community_voice_select_member"
on public.rivo_community_voice_sessions for select to authenticated
using (exists (
  select 1 from public.rivo_community_members m
  where m.community_id = rivo_community_voice_sessions.community_id
    and m.user_id = auth.uid()
));

-- Keep room events live in Supabase Realtime.
do $$ begin
  if not exists(
    select 1 from pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public'
      and tablename='rivo_community_voice_sessions'
  ) then
    alter publication supabase_realtime add table public.rivo_community_voice_sessions;
  end if;
end $$;

-- ------------------------------------------------------------
-- Secure community creation: 10,000 coins, atomically charged.
-- ------------------------------------------------------------
create or replace function public.rivo_create_community(
  p_name text,
  p_description text,
  p_join_policy text,
  p_image_url text default null,
  p_image_path text default null,
  p_voice_start_policy text default 'everyone'
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  me uuid := auth.uid();
  cid bigint;
  owned_count int;
  balance bigint;
  new_balance bigint;
  policy text := case when p_join_policy='friends' then 'friends' when p_join_policy='request' then 'request' else 'public' end;
  voice_policy text := case
    when p_voice_start_policy='moderators' then 'moderators'
    when p_voice_start_policy='owner' then 'owner'
    else 'everyone'
  end;
begin
  if me is null then raise exception 'Not signed in'; end if;
  perform pg_advisory_xact_lock(hashtextextended(me::text,0));
  select count(*)::int into owned_count from public.rivo_communities where owner_id=me;
  if owned_count >= 3 then raise exception 'You can create up to 3 communities'; end if;
  if nullif(trim(coalesce(p_name,'')),'') is null then raise exception 'Community name is required'; end if;
  if char_length(trim(p_name)) > 80 then raise exception 'Community name is too long'; end if;
  if char_length(coalesce(p_description,'')) > 500 then raise exception 'Community description is too long'; end if;

  select coins_balance into balance from public.profiles where id=me for update;
  if balance is null then raise exception 'Account balance is unavailable'; end if;
  if balance < 10000 then raise exception 'You need 10,000 coins to create a community. Current balance: %', balance; end if;
  new_balance := balance - 10000;

  perform set_config('rivo.internal_coin_update','on',true);
  update public.profiles
     set coins_balance = new_balance,
         updated_at = now()
   where id = me;

  insert into public.rivo_communities(
    owner_id,name,description,join_policy,image_url,image_path,voice_start_policy
  ) values(
    me,trim(p_name),trim(coalesce(p_description,'')),policy,
    nullif(trim(p_image_url),''),nullif(trim(p_image_path),''),voice_policy
  ) returning id into cid;

  insert into public.rivo_community_members(community_id,user_id,role)
  values(cid,me,'owner');

  insert into public.coin_transactions(sender_id,amount,type)
  values(me,10000,'community_create');

  return jsonb_build_object(
    'id',cid,
    'coins_balance',new_balance,
    'creation_cost',10000,
    'voice_start_policy',voice_policy
  ) || coalesce((public.rivo_get_community(cid))::jsonb,'{}'::jsonb);
end;
$$;
revoke all on function public.rivo_create_community(text,text,text,text,text,text) from public;
grant execute on function public.rivo_create_community(text,text,text,text,text,text) to authenticated;

-- Preserve compatibility with callers still using the old five-argument RPC.
create or replace function public.rivo_create_community(
  p_name text,
  p_description text,
  p_join_policy text,
  p_image_url text default null,
  p_image_path text default null
)
returns jsonb language sql security definer set search_path=public as $$
  select public.rivo_create_community(p_name,p_description,p_join_policy,p_image_url,p_image_path,'everyone');
$$;
revoke all on function public.rivo_create_community(text,text,text,text,text) from public;
grant execute on function public.rivo_create_community(text,text,text,text,text) to authenticated;

-- ------------------------------------------------------------
-- Rich community payload
-- ------------------------------------------------------------
create or replace function public.rivo_get_community(p_id bigint)
returns jsonb language sql security definer set search_path=public as $$
select jsonb_build_object(
  'id',c.id,
  'name',c.name,
  'description',c.description,
  'join_policy',c.join_policy,
  'image_url',c.image_url,
  'image_path',c.image_path,
  'created_at',c.created_at,
  'voice_start_policy',coalesce(c.voice_start_policy,'everyone'),
  'owner',public.rivo_social_profile(c.owner_id),
  'members_count',(select count(*) from public.rivo_community_members m where m.community_id=c.id),
  'is_member',exists(select 1 from public.rivo_community_members m where m.community_id=c.id and m.user_id=auth.uid()),
  'request_pending',exists(select 1 from public.rivo_community_join_requests q where q.community_id=c.id and q.user_id=auth.uid()),
  'my_role',coalesce((select m.role from public.rivo_community_members m where m.community_id=c.id and m.user_id=auth.uid()),'guest'),
  'voice',coalesce((
    select jsonb_build_object(
      'active',true,
      'id',v.id,
      'room_name',v.room_name,
      'started_by',public.rivo_social_profile(v.started_by),
      'created_at',v.created_at
    )
    from public.rivo_community_voice_sessions v
    where v.community_id=c.id and v.status='active'
    order by v.created_at desc limit 1
  ), jsonb_build_object('active',false))
)
from public.rivo_communities c where c.id=p_id;
$$;
revoke all on function public.rivo_get_community(bigint) from public;
grant execute on function public.rivo_get_community(bigint) to anon, authenticated;

create or replace function public.rivo_list_communities(p_limit int default 80)
returns setof jsonb language sql security definer set search_path=public as $$
select jsonb_build_object(
  'id',c.id,'name',c.name,'description',c.description,'join_policy',c.join_policy,
  'image_url',c.image_url,'image_path',c.image_path,'created_at',c.created_at,
  'voice_start_policy',coalesce(c.voice_start_policy,'everyone'),
  'owner',public.rivo_social_profile(c.owner_id),
  'members_count',(select count(*) from public.rivo_community_members m where m.community_id=c.id),
  'is_member',exists(select 1 from public.rivo_community_members m where m.community_id=c.id and m.user_id=auth.uid()),
  'request_pending',exists(select 1 from public.rivo_community_join_requests q where q.community_id=c.id and q.user_id=auth.uid()),
  'my_role',coalesce((select m.role from public.rivo_community_members m where m.community_id=c.id and m.user_id=auth.uid()),'guest'),
  'voice_active',exists(select 1 from public.rivo_community_voice_sessions v where v.community_id=c.id and v.status='active')
)
from public.rivo_communities c
order by c.created_at desc
limit greatest(1,least(coalesce(p_limit,80),100));
$$;
revoke all on function public.rivo_list_communities(int) from public;
grant execute on function public.rivo_list_communities(int) to anon, authenticated;

-- ------------------------------------------------------------
-- Moderation role controls
-- ------------------------------------------------------------
create or replace function public.rivo_set_community_moderator(p_id bigint,p_username text,p_enabled boolean)
returns boolean language plpgsql security definer set search_path=public as $$
declare
  me uuid:=auth.uid(); uid uuid; target_role text;
begin
  if me is null then raise exception 'Not signed in'; end if;
  if not exists(select 1 from public.rivo_community_members where community_id=p_id and user_id=me and role='owner') then
    raise exception 'Only the community owner can manage moderators';
  end if;
  select id into uid from public.profiles where username=lower(trim(both '@' from p_username));
  if uid is null then raise exception 'User not found'; end if;
  select role into target_role from public.rivo_community_members where community_id=p_id and user_id=uid;
  if target_role is null then raise exception 'User is not a community member'; end if;
  if target_role='owner' then raise exception 'The owner cannot be changed'; end if;
  update public.rivo_community_members
     set role=case when p_enabled then 'moderator' else 'member' end
   where community_id=p_id and user_id=uid;
  return true;
end;
$$;
revoke all on function public.rivo_set_community_moderator(bigint,text,boolean) from public;
grant execute on function public.rivo_set_community_moderator(bigint,text,boolean) to authenticated;

create or replace function public.rivo_set_community_voice_policy(p_id bigint,p_policy text)
returns text language plpgsql security definer set search_path=public as $$
declare v text:=case when p_policy='moderators' then 'moderators' when p_policy='owner' then 'owner' else 'everyone' end;
begin
  if not exists(select 1 from public.rivo_community_members where community_id=p_id and user_id=auth.uid() and role='owner') then
    raise exception 'Only the community owner can change voice permissions';
  end if;
  update public.rivo_communities set voice_start_policy=v where id=p_id;
  return v;
end;
$$;
revoke all on function public.rivo_set_community_voice_policy(bigint,text) from public;
grant execute on function public.rivo_set_community_voice_policy(bigint,text) to authenticated;

-- Owner + moderators can review and respond to join requests.
create or replace function public.rivo_list_community_requests(p_id bigint)
returns setof jsonb language sql security definer set search_path=public as $$
select jsonb_build_object(
  'username',p.username,
  'displayName',coalesce(p.public_data->>'displayName',p.username),
  'avatar',coalesce(p.public_data->>'avatar',''),
  'created_at',q.created_at
)
from public.rivo_community_join_requests q
join public.rivo_communities c on c.id=q.community_id
join public.profiles p on p.id=q.user_id
where q.community_id=p_id
  and exists(select 1 from public.rivo_community_members me where me.community_id=p_id and me.user_id=auth.uid() and me.role in ('owner','moderator'))
order by q.created_at asc;
$$;
revoke all on function public.rivo_list_community_requests(bigint) from public;
grant execute on function public.rivo_list_community_requests(bigint) to authenticated;

create or replace function public.rivo_respond_community_request(p_id bigint,p_username text,p_accept boolean)
returns boolean language plpgsql security definer set search_path=public as $$
declare uid uuid; allowed_role text;
begin
  select role into allowed_role from public.rivo_community_members where community_id=p_id and user_id=auth.uid();
  if allowed_role is null or allowed_role not in ('owner','moderator') then raise exception 'You cannot manage community requests'; end if;
  select id into uid from public.profiles where username=lower(trim(both '@' from p_username));
  if uid is null then raise exception 'User not found'; end if;
  delete from public.rivo_community_join_requests where community_id=p_id and user_id=uid;
  if p_accept then
    insert into public.rivo_community_members(community_id,user_id,role)
    values(p_id,uid,'member') on conflict (community_id,user_id) do nothing;
  end if;
  return true;
end;
$$;
revoke all on function public.rivo_respond_community_request(bigint,text,boolean) from public;
grant execute on function public.rivo_respond_community_request(bigint,text,boolean) to authenticated;

-- Owner can remove anyone except owner. Moderator can remove normal members only.
create or replace function public.rivo_kick_community_member(p_id bigint,p_username text)
returns boolean language plpgsql security definer set search_path=public as $$
declare uid uuid; actor_role text; target_role text;
begin
  select role into actor_role from public.rivo_community_members where community_id=p_id and user_id=auth.uid();
  if actor_role is null or actor_role not in ('owner','moderator') then raise exception 'You do not have moderation permissions'; end if;
  select id into uid from public.profiles where username=lower(trim(both '@' from p_username));
  if uid is null then raise exception 'User not found'; end if;
  select role into target_role from public.rivo_community_members where community_id=p_id and user_id=uid;
  if target_role is null then return true; end if;
  if target_role='owner' then raise exception 'The owner cannot be removed'; end if;
  if actor_role='moderator' and target_role='moderator' then raise exception 'Moderators cannot remove another moderator'; end if;
  delete from public.rivo_community_members where community_id=p_id and user_id=uid;
  return true;
end;
$$;
revoke all on function public.rivo_kick_community_member(bigint,text) from public;
grant execute on function public.rivo_kick_community_member(bigint,text) to authenticated;

create or replace function public.rivo_list_community_members(p_id bigint)
returns setof jsonb language sql security definer set search_path=public as $$
select jsonb_build_object(
  'username',p.username,
  'displayName',coalesce(p.public_data->>'displayName',p.username),
  'avatar',coalesce(p.public_data->>'avatar',''),
  'role',m.role,
  'joined_at',m.joined_at
)
from public.rivo_community_members m
join public.profiles p on p.id=m.user_id
where m.community_id=p_id
order by case m.role when 'owner' then 0 when 'moderator' then 1 else 2 end, m.joined_at asc;
$$;
revoke all on function public.rivo_list_community_members(bigint) from public;
grant execute on function public.rivo_list_community_members(bigint) to authenticated;

-- ------------------------------------------------------------
-- Community voice lifecycle
-- ------------------------------------------------------------
create or replace function public.rivo_start_community_voice(p_id bigint)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  me uuid:=auth.uid(); c public.rivo_communities; my_role text; existing public.rivo_community_voice_sessions; sid uuid; room text;
begin
  if me is null then raise exception 'Not signed in'; end if;
  perform pg_advisory_xact_lock(hashtextextended('community-voice:'||p_id::text,0));
  select * into c from public.rivo_communities where id=p_id;
  if c.id is null then raise exception 'Community not found'; end if;
  select role into my_role from public.rivo_community_members where community_id=p_id and user_id=me;
  if my_role is null then raise exception 'Join the community first'; end if;
  if coalesce(c.voice_start_policy,'everyone')='owner' and my_role<>'owner' then raise exception 'Only the owner can start voice calls'; end if;
  if coalesce(c.voice_start_policy,'everyone')='moderators' and my_role not in ('owner','moderator') then raise exception 'Only owners and moderators can start voice calls'; end if;

  select * into existing from public.rivo_community_voice_sessions where community_id=p_id and status='active' order by created_at desc limit 1;
  if existing.id is not null then
    return jsonb_build_object('id',existing.id,'room_name',existing.room_name,'active',true,'started_by',public.rivo_social_profile(existing.started_by),'created_at',existing.created_at);
  end if;

  sid:=gen_random_uuid();
  room:='rivo-community-'||p_id::text||'-'||replace(sid::text,'-','');
  insert into public.rivo_community_voice_sessions(id,community_id,started_by,room_name,status)
  values(sid,p_id,me,room,'active');

  return jsonb_build_object('id',sid,'room_name',room,'active',true,'started_by',public.rivo_social_profile(me),'created_at',now());
end;
$$;
revoke all on function public.rivo_start_community_voice(bigint) from public;
grant execute on function public.rivo_start_community_voice(bigint) to authenticated;

create or replace function public.rivo_end_community_voice(p_id bigint)
returns boolean language plpgsql security definer set search_path=public as $$
declare my_role text;
begin
  select m.role into my_role from public.rivo_community_members m where m.community_id=p_id and m.user_id=auth.uid();
  if my_role is null or my_role not in ('owner','moderator') then raise exception 'You cannot end the community voice room'; end if;
  if not exists(select 1 from public.rivo_community_voice_sessions where community_id=p_id and status='active') then return true; end if;
  update public.rivo_community_voice_sessions set status='ended', ended_at=now() where community_id=p_id and status='active';
  return true;
end;
$$;
revoke all on function public.rivo_end_community_voice(bigint) from public;
grant execute on function public.rivo_end_community_voice(bigint) to authenticated;

create or replace function public.rivo_get_community_voice(p_id bigint)
returns jsonb language sql security definer set search_path=public as $$
select coalesce((
  select jsonb_build_object(
    'active',true,
    'id',v.id,
    'community_id',v.community_id,
    'room_name',v.room_name,
    'started_by',public.rivo_social_profile(v.started_by),
    'created_at',v.created_at
  )
  from public.rivo_community_voice_sessions v
  where v.community_id=p_id and v.status='active'
  order by v.created_at desc limit 1
), jsonb_build_object('active',false));
$$;
revoke all on function public.rivo_get_community_voice(bigint) from public;
grant execute on function public.rivo_get_community_voice(bigint) to authenticated;

-- This is intentionally narrow and is called by the LiveKit Edge Function.
create or replace function public.rivo_can_join_community_voice(p_room_name text)
returns boolean language sql security definer set search_path=public as $$
select exists(
  select 1
  from public.rivo_community_voice_sessions v
  join public.rivo_community_members m on m.community_id=v.community_id and m.user_id=auth.uid()
  where v.room_name=trim(p_room_name)
    and v.status='active'
);
$$;
revoke all on function public.rivo_can_join_community_voice(text) from public;
grant execute on function public.rivo_can_join_community_voice(text) to authenticated;

-- Secure delete also ends any active room through cascade.
create or replace function public.rivo_delete_community(p_id bigint)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me uuid:=auth.uid(); owner_id uuid;
begin
  if me is null then raise exception 'Not signed in'; end if;
  select owner_id into owner_id from public.rivo_communities where id=p_id;
  if owner_id is null then raise exception 'Community not found'; end if;
  if owner_id <> me then raise exception 'Only the community owner can delete it'; end if;
  delete from public.rivo_communities where id=p_id;
  return jsonb_build_object('deleted',true,'id',p_id);
end;
$$;
revoke all on function public.rivo_delete_community(bigint) from public;
grant execute on function public.rivo_delete_community(bigint) to authenticated;
-- Rivo Communities V3: voice/presence permission hardening.
-- Idempotent; safe to run after supabase_communities_v2.sql.

-- Owner is the only role allowed to change moderator roles.
create or replace function public.rivo_set_community_moderator(p_id bigint,p_username text,p_enabled boolean)
returns boolean language plpgsql security definer set search_path=public as $$
declare
  me uuid:=auth.uid(); uid uuid; target_role text;
begin
  if me is null then raise exception 'Not signed in'; end if;
  if not exists(select 1 from public.rivo_community_members where community_id=p_id and user_id=me and role='owner') then
    raise exception 'Only the community owner can manage moderators';
  end if;
  select id into uid from public.profiles where username=lower(trim(both '@' from p_username));
  if uid is null then raise exception 'User not found'; end if;
  select role into target_role from public.rivo_community_members where community_id=p_id and user_id=uid;
  if target_role is null then raise exception 'User is not a community member'; end if;
  if target_role='owner' then raise exception 'The owner cannot be changed'; end if;
  update public.rivo_community_members
     set role=case when p_enabled then 'moderator' else 'member' end
   where community_id=p_id and user_id=uid;
  return true;
end;
$$;
revoke all on function public.rivo_set_community_moderator(bigint,text,boolean) from public;
grant execute on function public.rivo_set_community_moderator(bigint,text,boolean) to authenticated;

-- Moderators may remove members, but never another moderator/owner.
create or replace function public.rivo_kick_community_member(p_id bigint,p_username text)
returns boolean language plpgsql security definer set search_path=public as $$
declare
  uid uuid; actor_role text; target_role text;
begin
  select role into actor_role from public.rivo_community_members where community_id=p_id and user_id=auth.uid();
  if actor_role is null or actor_role not in ('owner','moderator') then raise exception 'You do not have moderation permissions'; end if;
  select id into uid from public.profiles where username=lower(trim(both '@' from p_username));
  if uid is null then raise exception 'User not found'; end if;
  select role into target_role from public.rivo_community_members where community_id=p_id and user_id=uid;
  if target_role is null then return true; end if;
  if target_role='owner' then raise exception 'The owner cannot be removed'; end if;
  if actor_role='moderator' and target_role='moderator' then raise exception 'Moderators cannot remove another moderator'; end if;
  delete from public.rivo_community_members where community_id=p_id and user_id=uid;
  return true;
end;
$$;
revoke all on function public.rivo_kick_community_member(bigint,text) from public;
grant execute on function public.rivo_kick_community_member(bigint,text) to authenticated;

-- Voice token eligibility is always tied to a currently active community membership.
create or replace function public.rivo_can_join_community_voice(p_room_name text)
returns boolean language sql security definer set search_path=public as $$
select exists(
  select 1
  from public.rivo_community_voice_sessions v
  join public.rivo_community_members m on m.community_id=v.community_id and m.user_id=auth.uid()
  where v.room_name=trim(p_room_name)
    and v.status='active'
);
$$;
revoke all on function public.rivo_can_join_community_voice(text) from public;
grant execute on function public.rivo_can_join_community_voice(text) to authenticated;

-- ============================================================
-- Rivo Communities V4 patch
-- Voice reliability, hard community/voice limits, moderation.
-- ============================================================

-- Rivo Communities V4
-- Voice reliability, hard member/voice caps, and owner/moderator voice moderation.
-- Run after supabase_communities_v3_voice_polish.sql.
-- Idempotent.

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- Persistent voice mute state (server-enforced on rejoin).
-- ------------------------------------------------------------
create table if not exists public.rivo_community_voice_mutes (
  community_id bigint not null references public.rivo_communities(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  muted boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (community_id,user_id)
);
create index if not exists rivo_community_voice_mutes_user_idx
  on public.rivo_community_voice_mutes(user_id,community_id);
alter table public.rivo_community_voice_mutes enable row level security;
drop policy if exists "rivo_community_voice_mutes_select_member" on public.rivo_community_voice_mutes;
create policy "rivo_community_voice_mutes_select_member"
on public.rivo_community_voice_mutes for select to authenticated
using (exists (
  select 1 from public.rivo_community_members m
  where m.community_id=rivo_community_voice_mutes.community_id
    and m.user_id=auth.uid()
));

-- ------------------------------------------------------------
-- Hard community capacity: 50 members.
-- ------------------------------------------------------------
create or replace function public.rivo_join_community(p_id bigint)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  me uuid:=auth.uid();
  c public.rivo_communities;
  is_friend boolean:=false;
  member_count int;
begin
  if me is null then raise exception 'Not signed in'; end if;
  perform pg_advisory_xact_lock(hashtextextended('community-members:'||p_id::text,0));
  select * into c from public.rivo_communities where id=p_id;
  if c.id is null then raise exception 'Community not found'; end if;
  if exists(select 1 from public.rivo_community_members where community_id=p_id and user_id=me) then return public.rivo_get_community(p_id); end if;
  select count(*)::int into member_count from public.rivo_community_members where community_id=p_id;
  if member_count >= 50 then raise exception 'This community is full (50 members maximum)'; end if;

  if c.join_policy='public' then
    insert into public.rivo_community_members(community_id,user_id,role) values(p_id,me,'member') on conflict do nothing;
  elsif c.join_policy='friends' then
    select exists(
      select 1 from public.profiles mep join public.profiles own on own.id=c.owner_id
      where mep.id=me and coalesce(mep.public_data->'friends','[]'::jsonb) ? own.username
    ) into is_friend;
    if not is_friend then raise exception 'Only friends of the owner can join'; end if;
    insert into public.rivo_community_members(community_id,user_id,role) values(p_id,me,'member') on conflict do nothing;
  else
    insert into public.rivo_community_join_requests(community_id,user_id) values(p_id,me) on conflict do nothing;
  end if;
  return public.rivo_get_community(p_id);
end;
$$;
revoke all on function public.rivo_join_community(bigint) from public;
grant execute on function public.rivo_join_community(bigint) to authenticated;

-- Accepting a request is also capacity-checked atomically.
create or replace function public.rivo_respond_community_request(p_id bigint,p_username text,p_accept boolean)
returns boolean language plpgsql security definer set search_path=public as $$
declare
  uid uuid;
  allowed_role text;
  member_count int;
begin
  perform pg_advisory_xact_lock(hashtextextended('community-members:'||p_id::text,0));
  select role into allowed_role
    from public.rivo_community_members
   where community_id=p_id and user_id=auth.uid();
  if allowed_role is null or allowed_role not in ('owner','moderator') then
    raise exception 'You cannot manage community requests';
  end if;
  select id into uid from public.profiles where username=lower(trim(both '@' from p_username));
  if uid is null then raise exception 'User not found'; end if;
  if not exists(
    select 1 from public.rivo_community_join_requests q
    where q.community_id=p_id and q.user_id=uid
  ) then
    raise exception 'No pending join request for this user';
  end if;
  if p_accept then
    select count(*)::int into member_count from public.rivo_community_members where community_id=p_id;
    if member_count >= 50 then raise exception 'This community is full (50 members maximum)'; end if;
  end if;
  delete from public.rivo_community_join_requests where community_id=p_id and user_id=uid;
  if p_accept then
    insert into public.rivo_community_members(community_id,user_id,role)
    values(p_id,uid,'member') on conflict (community_id,user_id) do nothing;
  end if;
  return true;
end;
$$;
revoke all on function public.rivo_respond_community_request(bigint,text,boolean) from public;
grant execute on function public.rivo_respond_community_request(bigint,text,boolean) to authenticated;

-- ------------------------------------------------------------
-- Member listing exposes voice mute status for the management UI.
-- ------------------------------------------------------------
create or replace function public.rivo_list_community_members(p_id bigint)
returns setof jsonb language sql security definer set search_path=public as $$
select jsonb_build_object(
  'username',p.username,
  'displayName',coalesce(p.public_data->>'displayName',p.username),
  'avatar',coalesce(p.public_data->>'avatar',''),
  'role',m.role,
  'joined_at',m.joined_at,
  'voice_muted',coalesce(vm.muted,false)
)
from public.rivo_community_members m
join public.profiles p on p.id=m.user_id
left join public.rivo_community_voice_mutes vm
  on vm.community_id=m.community_id and vm.user_id=m.user_id and vm.muted=true
where m.community_id=p_id
  and exists(select 1 from public.rivo_community_members me where me.community_id=p_id and me.user_id=auth.uid())
order by case m.role when 'owner' then 0 when 'moderator' then 1 else 2 end, m.joined_at asc;
$$;
revoke all on function public.rivo_list_community_members(bigint) from public;
grant execute on function public.rivo_list_community_members(bigint) to authenticated;

-- ------------------------------------------------------------
-- Secure voice mute state changes. Owner can target moderators;
-- moderators can target regular members only.
-- ------------------------------------------------------------
create or replace function public.rivo_set_community_voice_mute(p_id bigint,p_username text,p_muted boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  actor_role text;
  target_id uuid;
  target_role text;
  room text;
begin
  select role into actor_role from public.rivo_community_members where community_id=p_id and user_id=auth.uid();
  if actor_role is null or actor_role not in ('owner','moderator') then raise exception 'You do not have moderation permissions'; end if;
  select id into target_id from public.profiles where username=lower(trim(both '@' from p_username));
  if target_id is null then raise exception 'User not found'; end if;
  select role into target_role from public.rivo_community_members where community_id=p_id and user_id=target_id;
  if target_role is null then raise exception 'User is not a community member'; end if;
  if target_role='owner' then raise exception 'The owner cannot be voice-muted'; end if;
  if actor_role='moderator' and target_role='moderator' then raise exception 'Moderators cannot manage another moderator'; end if;

  if p_muted then
    insert into public.rivo_community_voice_mutes(community_id,user_id,muted,updated_at)
    values(p_id,target_id,true,now())
    on conflict(community_id,user_id) do update set muted=true,updated_at=now();
  else
    delete from public.rivo_community_voice_mutes where community_id=p_id and user_id=target_id;
  end if;

  select room_name into room
  from public.rivo_community_voice_sessions
  where community_id=p_id and status='active'
  order by created_at desc limit 1;

  return jsonb_build_object('community_id',p_id,'target_user_id',target_id,'target_role',target_role,'muted',p_muted,'room_name',room);
end;
$$;
revoke all on function public.rivo_set_community_voice_mute(bigint,text,boolean) from public;
grant execute on function public.rivo_set_community_voice_mute(bigint,text,boolean) to authenticated;

-- ------------------------------------------------------------
-- Safe helper for the LiveKit Edge Function. Returns the current
-- membership, voice room and persisted mute state after permission checks.
-- ------------------------------------------------------------
create or replace function public.rivo_prepare_community_voice_moderation(p_id bigint,p_username text,p_action text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  actor_role text;
  target_id uuid;
  target_role text;
  room text;
  action text:=lower(trim(coalesce(p_action,'')));
begin
  select role into actor_role from public.rivo_community_members where community_id=p_id and user_id=auth.uid();
  if actor_role is null or actor_role not in ('owner','moderator') then raise exception 'You do not have moderation permissions'; end if;
  if action not in ('kick','mute','unmute') then raise exception 'Unsupported moderation action'; end if;
  select id into target_id from public.profiles where username=lower(trim(both '@' from p_username));
  if target_id is null then raise exception 'User not found'; end if;
  select role into target_role from public.rivo_community_members where community_id=p_id and user_id=target_id;
  if target_role is null then raise exception 'User is not a community member'; end if;
  if target_role='owner' then raise exception 'The owner cannot be managed'; end if;
  if actor_role='moderator' and target_role='moderator' then raise exception 'Moderators cannot manage another moderator'; end if;
  if action in ('mute','unmute') then
    if action='mute' then
      insert into public.rivo_community_voice_mutes(community_id,user_id,muted,updated_at)
      values(p_id,target_id,true,now())
      on conflict(community_id,user_id) do update set muted=true,updated_at=now();
    else
      delete from public.rivo_community_voice_mutes where community_id=p_id and user_id=target_id;
    end if;
  else
    delete from public.rivo_community_voice_mutes where community_id=p_id and user_id=target_id;
    delete from public.rivo_community_members where community_id=p_id and user_id=target_id;
  end if;
  select room_name into room from public.rivo_community_voice_sessions where community_id=p_id and status='active' order by created_at desc limit 1;
  return jsonb_build_object('community_id',p_id,'target_user_id',target_id,'target_role',target_role,'action',action,'room_name',room);
end;
$$;
revoke all on function public.rivo_prepare_community_voice_moderation(bigint,text,text) from public;
grant execute on function public.rivo_prepare_community_voice_moderation(bigint,text,text) to authenticated;

-- ------------------------------------------------------------
-- Existing sessions remain capped at 5 via the LiveKit Edge Function.
-- New browser-issued tokens cannot be created for non-members and honor
-- persisted voice mute state.
-- ------------------------------------------------------------
create or replace function public.rivo_get_community_voice_member_state(p_room_name text)
returns jsonb language sql security definer set search_path=public as $$
select jsonb_build_object(
  'allowed',exists(
    select 1 from public.rivo_community_voice_sessions v
    join public.rivo_community_members m on m.community_id=v.community_id and m.user_id=auth.uid()
    where v.room_name=trim(p_room_name) and v.status='active'
  ),
  'muted',coalesce((
    select vm.muted
    from public.rivo_community_voice_sessions v
    join public.rivo_community_voice_mutes vm on vm.community_id=v.community_id and vm.user_id=auth.uid()
    where v.room_name=trim(p_room_name) and v.status='active' and vm.muted=true
    order by vm.updated_at desc limit 1
  ),false)
);
$$;
revoke all on function public.rivo_get_community_voice_member_state(text) from public;
grant execute on function public.rivo_get_community_voice_member_state(text) to authenticated;

-- ------------------------------------------------------------
-- V5: automatically end a community voice session after LiveKit
-- reports that the room has zero participants.
-- ------------------------------------------------------------
create or replace function public.rivo_cleanup_empty_community_voice(p_room_name text)
returns boolean language plpgsql security definer set search_path=public as $$
declare
  cid bigint;
  is_member boolean;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select v.community_id into cid
  from public.rivo_community_voice_sessions v
  where v.room_name=trim(p_room_name) and v.status='active'
  order by v.created_at desc limit 1;
  if cid is null then return false; end if;
  select exists(
    select 1 from public.rivo_community_members m
    where m.community_id=cid and m.user_id=auth.uid()
  ) into is_member;
  if not is_member then raise exception 'You are not a community member'; end if;
  update public.rivo_community_voice_sessions
     set status='ended', ended_at=coalesce(ended_at,now())
   where room_name=trim(p_room_name) and status='active';
  return true;
end;
$$;
revoke all on function public.rivo_cleanup_empty_community_voice(text) from public;
grant execute on function public.rivo_cleanup_empty_community_voice(text) to authenticated;


-- V6 security/mobile voice overrides (included for complete-schema installs).
-- The Edge Function verifies the caller as a community member, then performs
-- this RPC with service role.
create or replace function public.rivo_cleanup_empty_community_voice(p_room_name text)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is not null then
    raise exception 'Voice cleanup is server-only';
  end if;
  update public.rivo_community_voice_sessions
     set status='ended', ended_at=coalesce(ended_at,now())
   where room_name=trim(p_room_name) and status='active';
  return found;
end;
$$;
revoke all on function public.rivo_cleanup_empty_community_voice(text) from public;
grant execute on function public.rivo_cleanup_empty_community_voice(text) to service_role;
