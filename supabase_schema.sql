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

  incoming := (select coalesce(jsonb_agg(x.value),'[]'::jsonb) from jsonb_array_elements_text(incoming) x where x <> other.username);
  outgoing := (select coalesce(jsonb_agg(x.value),'[]'::jsonb) from jsonb_array_elements_text(outgoing) x where x <> me.username);

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
  incoming := (select coalesce(jsonb_agg(x.value),'[]'::jsonb) from jsonb_array_elements_text(incoming) x where x <> other.username);
  outgoing := (select coalesce(jsonb_agg(x.value),'[]'::jsonb) from jsonb_array_elements_text(outgoing) x where x <> me.username);
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
    (select coalesce(jsonb_agg(x.value),'[]'::jsonb) from jsonb_array_elements_text(f) x where x <> other.username));
  f := coalesce(other.public_data->'friends','[]'::jsonb);
  other.public_data := jsonb_set(coalesce(other.public_data,'{}'::jsonb),'{friends}',
    (select coalesce(jsonb_agg(x.value),'[]'::jsonb) from jsonb_array_elements_text(f) x where x <> me.username));

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

-- Rivo identity/social hardening v1
-- Safe migration: function/publication changes only. No rows are deleted or reset.
-- Current Rivo stores profile likes and friend relationships in profiles JSONB,
-- not in standalone likes/friend_requests/friendships tables.

-- --------------------------------------------------------------------------
-- Idempotent profile Like/Unlike. The desired state is explicit, so a retry,
-- double click, or duplicate network request can never accidentally toggle it.
-- The actor is ALWAYS auth.uid(); p_username only identifies the target.
-- --------------------------------------------------------------------------
create or replace function public.rivo_set_profile_like(p_username text, p_liked boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me public.profiles;
  target public.profiles;
  users jsonb;
  next_users jsonb;
  me_username text;
  final_liked boolean;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;

  select * into me from public.profiles where id = auth.uid();
  if not found then raise exception 'Not signed in'; end if;
  me_username := me.username;

  select * into target
  from public.profiles
  where username = lower(trim(both '@' from p_username))
  for update;
  if not found then raise exception 'User not found'; end if;
  if target.id = me.id then raise exception 'You cannot like your own profile'; end if;

  users := coalesce(target.public_data->'likes'->'users','[]'::jsonb);

  if p_liked then
    if users ? me_username then
      next_users := users;
      final_liked := true;
    else
      next_users := users || to_jsonb(me_username);
      final_liked := true;
    end if;
  else
    next_users := (
      select coalesce(jsonb_agg(x.value),'[]'::jsonb)
      from jsonb_array_elements_text(users) as x(value)
      where x.value <> me_username
    );
    final_liked := false;
  end if;

  target.public_data := jsonb_set(
    coalesce(target.public_data,'{}'::jsonb),
    '{likes}',
    jsonb_build_object('count', jsonb_array_length(next_users), 'users', next_users),
    true
  );
  update public.profiles
  set public_data = target.public_data, updated_at = now()
  where id = target.id;

  return jsonb_build_object(
    'liked', final_liked,
    'count', jsonb_array_length(next_users),
    'operation', case when final_liked then 'LIKE_INSERT' else 'LIKE_DELETE' end,
    'target_user_id', target.id,
    'actor_user_id', me.id
  );
end;
$$;
revoke all on function public.rivo_set_profile_like(text,boolean) from public;
grant execute on function public.rivo_set_profile_like(text,boolean) to authenticated;

-- Preserve the legacy toggle RPC for compatibility, but make it delegate to the
-- explicit/idempotent operation above.
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
  currently_liked boolean;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into me from public.profiles where id = auth.uid();
  if not found then raise exception 'Not signed in'; end if;
  select * into target from public.profiles where username=lower(trim(both '@' from p_username));
  if not found then raise exception 'User not found'; end if;
  if me.id = target.id then raise exception 'You cannot like your own profile'; end if;
  users := coalesce(target.public_data->'likes'->'users','[]'::jsonb);
  currently_liked := users ? me.username;
  return public.rivo_set_profile_like(target.username, not currently_liked);
end;
$$;
revoke all on function public.rivo_toggle_like(text) from public;
grant execute on function public.rivo_toggle_like(text) to authenticated;

-- --------------------------------------------------------------------------
-- Friend requests: lock both profile rows in deterministic UUID order.
-- This prevents A->B and B->A from deadlocking each other.
-- --------------------------------------------------------------------------
create or replace function public.rivo_send_friend_request(p_target_username text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  me public.profiles;
  target public.profiles;
  incoming jsonb;
  outgoing jsonb;
  target_incoming jsonb;
  me_outgoing jsonb;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into me from public.profiles where id = auth.uid();
  if not found then raise exception 'Not signed in'; end if;
  if me.is_banned then raise exception 'Your account is blocked'; end if;

  select * into target
  from public.profiles
  where username = lower(trim(both '@' from p_target_username));
  if not found then raise exception 'User not found'; end if;
  if target.is_banned then raise exception 'This account is unavailable'; end if;
  if me.id = target.id then raise exception 'You cannot add yourself'; end if;

  -- Lock both rows in one globally consistent order.
  if me.id < target.id then
    select * into me from public.profiles where id = me.id for update;
    select * into target from public.profiles where id = target.id for update;
  else
    select * into target from public.profiles where id = target.id for update;
    select * into me from public.profiles where id = me.id for update;
  end if;

  if coalesce(me.public_data->'friends','[]'::jsonb) ? target.username then
    raise exception 'Already friends';
  end if;

  me_outgoing := coalesce(me.private_data->'friendRequests'->'outgoing','[]'::jsonb);
  target_incoming := coalesce(target.private_data->'friendRequests'->'incoming','[]'::jsonb);
  if me_outgoing ? target.username or target_incoming ? me.username then
    raise exception 'Request already exists';
  end if;

  -- Reverse direction is also rejected atomically.
  if (me.private_data->'friendRequests'->'incoming') ? target.username then
    raise exception 'This user has already requested you';
  end if;

  outgoing := me_outgoing || to_jsonb(target.username);
  incoming := target_incoming || to_jsonb(me.username);

  me.private_data := jsonb_set(coalesce(me.private_data,'{}'::jsonb), '{friendRequests,outgoing}', outgoing, true);
  target.private_data := jsonb_set(coalesce(target.private_data,'{}'::jsonb), '{friendRequests,incoming}', incoming, true);

  update public.profiles set private_data=me.private_data,updated_at=now() where id=me.id;
  update public.profiles set private_data=target.private_data,updated_at=now() where id=target.id;
  perform public.rivo_write_notification(target.id,me.id,'friend_request',me.username||' sent you a friend request',jsonb_build_object('username',me.username));
  return true;
end;
$$;
revoke all on function public.rivo_send_friend_request(text) from public;
grant execute on function public.rivo_send_friend_request(text) to authenticated;

create or replace function public.rivo_accept_friend_request(p_from_username text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  me public.profiles;
  other public.profiles;
  incoming jsonb;
  outgoing jsonb;
  mefriends jsonb;
  otherfriends jsonb;
  me_outgoing jsonb;
  other_incoming jsonb;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into me from public.profiles where id=auth.uid();
  select * into other from public.profiles where username=lower(trim(both '@' from p_from_username));
  if me.id is null or other.id is null then raise exception 'User not found'; end if;
  if me.id = other.id then raise exception 'Invalid friend request'; end if;

  if me.id < other.id then
    select * into me from public.profiles where id=me.id for update;
    select * into other from public.profiles where id=other.id for update;
  else
    select * into other from public.profiles where id=other.id for update;
    select * into me from public.profiles where id=me.id for update;
  end if;

  incoming := coalesce(me.private_data->'friendRequests'->'incoming','[]'::jsonb);
  if not (incoming ? other.username) then raise exception 'Request not found'; end if;
  outgoing := coalesce(other.private_data->'friendRequests'->'outgoing','[]'::jsonb);
  me_outgoing := coalesce(me.private_data->'friendRequests'->'outgoing','[]'::jsonb);
  other_incoming := coalesce(other.private_data->'friendRequests'->'incoming','[]'::jsonb);

  incoming := (select coalesce(jsonb_agg(x.value),'[]'::jsonb) from jsonb_array_elements_text(incoming) as x(value) where x.value <> other.username);
  outgoing := (select coalesce(jsonb_agg(x.value),'[]'::jsonb) from jsonb_array_elements_text(outgoing) as x(value) where x.value <> me.username);
  me_outgoing := (select coalesce(jsonb_agg(x.value),'[]'::jsonb) from jsonb_array_elements_text(me_outgoing) as x(value) where x.value <> other.username);
  other_incoming := (select coalesce(jsonb_agg(x.value),'[]'::jsonb) from jsonb_array_elements_text(other_incoming) as x(value) where x.value <> me.username);

  mefriends := coalesce(me.public_data->'friends','[]'::jsonb);
  otherfriends := coalesce(other.public_data->'friends','[]'::jsonb);
  if not (mefriends ? other.username) then mefriends := mefriends || to_jsonb(other.username); end if;
  if not (otherfriends ? me.username) then otherfriends := otherfriends || to_jsonb(me.username); end if;

  me.private_data := jsonb_set(jsonb_set(coalesce(me.private_data,'{}'::jsonb),'{friendRequests,incoming}',incoming,true),'{friendRequests,outgoing}',me_outgoing,true);
  other.private_data := jsonb_set(jsonb_set(coalesce(other.private_data,'{}'::jsonb),'{friendRequests,outgoing}',outgoing,true),'{friendRequests,incoming}',other_incoming,true);
  me.public_data := jsonb_set(coalesce(me.public_data,'{}'::jsonb),'{friends}',mefriends,true);
  other.public_data := jsonb_set(coalesce(other.public_data,'{}'::jsonb),'{friends}',otherfriends,true);

  update public.profiles set public_data=me.public_data,private_data=me.private_data,updated_at=now() where id=me.id;
  update public.profiles set public_data=other.public_data,private_data=other.private_data,updated_at=now() where id=other.id;
  perform public.rivo_write_notification(other.id,me.id,'friend_accept',me.username||' accepted your friend request',jsonb_build_object('username',me.username));
  return true;
end;
$$;
revoke all on function public.rivo_accept_friend_request(text) from public;
grant execute on function public.rivo_accept_friend_request(text) to authenticated;

create or replace function public.rivo_reject_friend_request(p_from_username text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  me public.profiles;
  other public.profiles;
  incoming jsonb;
  outgoing jsonb;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into me from public.profiles where id=auth.uid();
  select * into other from public.profiles where username=lower(trim(both '@' from p_from_username));
  if me.id is null or other.id is null then raise exception 'User not found'; end if;
  if me.id = other.id then raise exception 'Invalid friend request'; end if;

  if me.id < other.id then
    select * into me from public.profiles where id=me.id for update;
    select * into other from public.profiles where id=other.id for update;
  else
    select * into other from public.profiles where id=other.id for update;
    select * into me from public.profiles where id=me.id for update;
  end if;

  incoming := coalesce(me.private_data->'friendRequests'->'incoming','[]'::jsonb);
  if not (incoming ? other.username) then raise exception 'Request not found'; end if;
  outgoing := coalesce(other.private_data->'friendRequests'->'outgoing','[]'::jsonb);
  incoming := (select coalesce(jsonb_agg(x.value),'[]'::jsonb) from jsonb_array_elements_text(incoming) as x(value) where x.value <> other.username);
  outgoing := (select coalesce(jsonb_agg(x.value),'[]'::jsonb) from jsonb_array_elements_text(outgoing) as x(value) where x.value <> me.username);

  me.private_data := jsonb_set(coalesce(me.private_data,'{}'::jsonb),'{friendRequests,incoming}',incoming,true);
  other.private_data := jsonb_set(coalesce(other.private_data,'{}'::jsonb),'{friendRequests,outgoing}',outgoing,true);
  update public.profiles set private_data=me.private_data,updated_at=now() where id=me.id;
  update public.profiles set private_data=other.private_data,updated_at=now() where id=other.id;
  return true;
end;
$$;
revoke all on function public.rivo_reject_friend_request(text) from public;
grant execute on function public.rivo_reject_friend_request(text) to authenticated;

create or replace function public.rivo_remove_friend(p_username text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare me public.profiles; other public.profiles; f jsonb;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into me from public.profiles where id=auth.uid();
  select * into other from public.profiles where username=lower(trim(both '@' from p_username));
  if me.id is null or other.id is null then raise exception 'User not found'; end if;
  if me.id = other.id then raise exception 'Invalid friendship'; end if;

  if me.id < other.id then
    select * into me from public.profiles where id=me.id for update;
    select * into other from public.profiles where id=other.id for update;
  else
    select * into other from public.profiles where id=other.id for update;
    select * into me from public.profiles where id=me.id for update;
  end if;

  f := coalesce(me.public_data->'friends','[]'::jsonb);
  me.public_data := jsonb_set(coalesce(me.public_data,'{}'::jsonb),'{friends}',(select coalesce(jsonb_agg(x.value),'[]'::jsonb) from jsonb_array_elements_text(f) as x(value) where x.value <> other.username),true);
  f := coalesce(other.public_data->'friends','[]'::jsonb);
  other.public_data := jsonb_set(coalesce(other.public_data,'{}'::jsonb),'{friends}',(select coalesce(jsonb_agg(x.value),'[]'::jsonb) from jsonb_array_elements_text(f) as x(value) where x.value <> me.username),true);

  update public.profiles set public_data=me.public_data,updated_at=now() where id=me.id;
  update public.profiles set public_data=other.public_data,updated_at=now() where id=other.id;
  return true;
end;
$$;
revoke all on function public.rivo_remove_friend(text) from public;
grant execute on function public.rivo_remove_friend(text) to authenticated;

-- --------------------------------------------------------------------------
-- RLS audit guards for direct client access. Writes remain RPC-authoritative.
-- Public profile reads continue through security-definer public-profile RPCs.
-- --------------------------------------------------------------------------
alter table public.profiles enable row level security;
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own" on public.profiles for select to authenticated using (auth.uid() = id);
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles for insert to authenticated with check (auth.uid() = id);
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);
drop policy if exists "profiles_delete_own" on public.profiles;
create policy "profiles_delete_own" on public.profiles for delete to authenticated using (auth.uid() = id);

alter table public.rivo_posts enable row level security;
drop policy if exists "rivo_posts_select_public" on public.rivo_posts;
create policy "rivo_posts_select_public" on public.rivo_posts for select to anon, authenticated using (true);

alter table public.rivo_post_reactions enable row level security;
drop policy if exists "rivo_post_reactions_select_public" on public.rivo_post_reactions;
create policy "rivo_post_reactions_select_public" on public.rivo_post_reactions for select to anon, authenticated using (true);

-- No destructive migration: these tables are intentionally absent in this Rivo build.
-- Profile Likes/Friend Requests/Friendships live in JSONB inside profiles and are
-- protected by the profiles RLS + security-definer RPCs above.

-- Make own-profile updates available to the client's Realtime subscription.
do $$
begin
  if not exists(
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='profiles'
  ) then
    alter publication supabase_realtime add table public.profiles;
  end if;
end $$;
