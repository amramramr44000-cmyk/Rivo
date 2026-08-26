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
