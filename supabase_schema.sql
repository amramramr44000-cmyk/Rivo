-- Rivo / Supabase database setup
-- Run this whole file in Supabase SQL Editor.
-- Then create a Storage bucket named: rivo-media
-- and configure Auth -> Email -> "Confirm email" = OFF for the current username/password flow.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9](?:[a-z0-9._-]{2,24})[a-z0-9]$'),
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
      'count', coalesce((r.public_data->'likes'->>'count')::int,0)
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

create or replace function public.rivo_send_message(p_receiver_username text, p_content text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me public.profiles;
  target public.profiles;
  text_value text := trim(coalesce(p_content,''));
  can_receive text;
  are_friends boolean := false;
  m public.rivo_messages;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if char_length(text_value) < 1 then raise exception 'Message cannot be empty'; end if;
  if char_length(text_value) > 2000 then raise exception 'Message is too long'; end if;

  select * into me from public.profiles where id = auth.uid();
  select * into target from public.profiles
  where username = lower(trim(both '@' from p_receiver_username));
  if me.id is null or target.id is null then raise exception 'User not found'; end if;
  if me.id = target.id then raise exception 'You cannot message yourself'; end if;

  can_receive := coalesce(target.private_data->'messageSettings'->>'whoCanMessage','everyone');
  if can_receive = 'nobody' then
    raise exception 'This user has closed their messages';
  end if;
  -- Friendship must be verified against the *receiver's* own friend list,
  -- not the sender's. Reading it off `me` meant a stale/one-sided friends
  -- entry on the sender's side could let a non-friend slip past a
  -- "friends only" setting; checking `target` is the actual source of
  -- truth for who target has accepted.
  are_friends := coalesce(target.public_data->'friends','[]'::jsonb) ? me.username;
  if can_receive = 'friends' and not are_friends then
    raise exception 'This user accepts messages from friends only';
  end if;

  insert into public.rivo_messages(sender_id, receiver_id, content)
  values (me.id, target.id, text_value)
  returning * into m;

  return jsonb_build_object(
    'id', m.id,
    'sender_username', me.username,
    'receiver_username', target.username,
    'content', m.content,
    'created_at', m.created_at
  );
end;
$$;
revoke all on function public.rivo_send_message(text,text) from public;
grant execute on function public.rivo_send_message(text,text) to authenticated;

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
