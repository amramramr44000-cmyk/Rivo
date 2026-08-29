-- ============================================================================
-- Rivo — fix: trusted RPCs blocked by rivo_guard_profile_writes ("Access denied")
-- ============================================================================
-- ROOT CAUSE (confirmed on the live database, not reproducible from a stale
-- client/session):
--
--   The trigger public.rivo_guard_profile_writes() (BEFORE INSERT/UPDATE on
--   public.profiles) was written with an intentional escape hatch for
--   trusted, server-side SECURITY DEFINER functions that legitimately need
--   to write into *another* user's profile row (adding a friend request to
--   the other person's incoming list, bumping their like count, recording a
--   profile view, creating a friendship on both sides, ...):
--
--       if current_setting('rivo.internal_profile_save', true) = 'on' then
--         return NEW;
--       end if;
--
--   No function in the project ever actually sets that flag before writing
--   to someone else's row. So every one of these legitimate operations hits
--   the trigger's final owner check:
--
--       if auth.uid() is null or OLD.id<>auth.uid() then
--         raise exception 'Access denied';
--       end if;
--
--   which is always true when the row being written belongs to someone
--   other than the caller — even though the caller reached that write
--   through a fully authorized, auth.uid()-gated RPC. This is why Like,
--   friend requests, accepting/rejecting, and profile views were failing:
--   not a session/device problem, a database-trigger problem.
--
-- FIX: set the trigger's own escape-hatch flag, scoped to the current
-- transaction only (set_config(..., true) = transaction-local, resets
-- itself automatically — nothing to "turn back off" and nothing that can
-- leak into another request), at the top of every SECURITY DEFINER
-- function that writes to a profiles row other than auth.uid()'s own. The
-- trigger itself, its direct-owner check, and its admin bypass are
-- untouched — a client can still never write another user's row directly.
--
-- This file only does `create or replace function ...` on the 6 affected
-- functions. It does not touch any table, does not delete or reset any
-- data, does not change RLS, and does not change the guard trigger.
-- Safe to run multiple times.
-- ============================================================================

-- 1) rivo_send_friend_request — writes the target's private_data.friendRequests.incoming
create or replace function public.rivo_send_friend_request(p_target_username text)
returns boolean language plpgsql security definer set search_path=public as $$
declare me public.profiles; target public.profiles; incoming jsonb; outgoing jsonb;
begin
  perform set_config('rivo.internal_profile_save','on',true);
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

-- 2) rivo_accept_friend_request — writes both my row and the other person's row (creates the friendship)
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
  perform set_config('rivo.internal_profile_save','on',true);
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

-- 3) rivo_reject_friend_request — writes the other person's row (removes their outgoing request)
create or replace function public.rivo_reject_friend_request(p_from_username text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare me public.profiles; other public.profiles;
declare incoming jsonb; outgoing jsonb;
begin
  perform set_config('rivo.internal_profile_save','on',true);
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

-- 4) rivo_remove_friend — writes the other person's row (removes me from their friends list)
create or replace function public.rivo_remove_friend(p_username text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare me public.profiles; other public.profiles;
declare f jsonb;
begin
  perform set_config('rivo.internal_profile_save','on',true);
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

-- 5) rivo_toggle_like — writes the target's row (their like count/list)
create or replace function public.rivo_toggle_like(p_username text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare me public.profiles; target public.profiles;
declare users jsonb; idx int; liked boolean;
begin
  perform set_config('rivo.internal_profile_save','on',true);
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

-- 6) rivo_add_view — writes the target's row (their view counter)
create or replace function public.rivo_add_view(p_username text)
returns boolean language plpgsql security definer set search_path=public as $$
declare target public.profiles; viewer uuid:=auth.uid();
begin
  perform set_config('rivo.internal_profile_save','on',true);
  select * into target from public.profiles where username=lower(trim(both '@' from p_username)) for update;
  if target.id is null then return false; end if;
  target.public_data := jsonb_set(coalesce(target.public_data,'{}'::jsonb),'{stats,views}',to_jsonb(coalesce((target.public_data->'stats'->>'views')::int,0)+1),true);
  update public.profiles set public_data=target.public_data,updated_at=now() where id=target.id;
  insert into public.rivo_profile_views(profile_id,viewer_id) values(target.id,viewer);
  return true;
end; $$;
revoke all on function public.rivo_add_view(text) from public;
grant execute on function public.rivo_add_view(text) to anon, authenticated;

-- ============================================================================
-- After running this file:
--  * Like / Unlike, Send/Accept/Reject friend request, Remove friend, and
--    profile view counting will all succeed for real accounts through the
--    normal RPC path — the guard trigger still blocks any *direct* client
--    write to a profiles row that is not the caller's own.
--  * Nothing about rivo_guard_profile_writes itself changed, so its
--    protection against a client tampering with someone else's row (or
--    forging their own stats/likes/friends) is fully intact.
-- ============================================================================
