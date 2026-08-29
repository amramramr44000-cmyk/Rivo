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
