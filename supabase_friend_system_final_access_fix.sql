-- Rivo — Friend system final access fix
-- Scope: friend requests only. Does not alter tables, RLS, profiles, likes,
-- follows, login, signup, posts, or UI.
--
-- Fixes all friend-request write paths so the existing trusted profile-write
-- trigger escape hatch is enabled inside the SECURITY DEFINER transaction.
-- This is transaction-local and resets automatically after each RPC call.

-- 1) Send friend request
create or replace function public.rivo_send_friend_request(p_target_username text)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
declare
  me public.profiles;
  target public.profiles;
  incoming jsonb;
  outgoing jsonb;
begin
  perform set_config('rivo.internal_profile_save','on',true);

  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into me from public.profiles where id=auth.uid() for update;
  if not found then raise exception 'Not signed in'; end if;
  if me.is_banned then raise exception 'Your account is blocked'; end if;

  select * into target
  from public.profiles
  where username=lower(trim(both '@' from p_target_username))
  for update;
  if not found then raise exception 'User not found'; end if;
  if target.is_banned then raise exception 'This account is unavailable'; end if;
  if me.id=target.id then raise exception 'You cannot add yourself'; end if;

  if coalesce(me.public_data->'friends','[]'::jsonb) ? target.username then
    raise exception 'Already friends';
  end if;

  incoming:=coalesce(target.private_data->'friendRequests'->'incoming','[]'::jsonb);
  outgoing:=coalesce(me.private_data->'friendRequests'->'outgoing','[]'::jsonb);

  if incoming ? me.username then raise exception 'Request already sent'; end if;
  if coalesce(me.private_data->'friendRequests'->'incoming','[]'::jsonb) ? target.username then
    raise exception 'This user has already requested you';
  end if;

  incoming:=incoming || to_jsonb(me.username);
  outgoing:=outgoing || to_jsonb(target.username);

  me.private_data:=jsonb_set(coalesce(me.private_data,'{}'::jsonb),'{friendRequests,outgoing}',outgoing,true);
  target.private_data:=jsonb_set(coalesce(target.private_data,'{}'::jsonb),'{friendRequests,incoming}',incoming,true);

  update public.profiles
    set private_data=me.private_data, updated_at=now()
  where id=me.id;

  update public.profiles
    set private_data=target.private_data, updated_at=now()
  where id=target.id;

  begin
    perform public.rivo_write_notification(
      target.id, me.id, 'friend_request',
      me.username||' sent you a friend request',
      jsonb_build_object('username',me.username)
    );
  exception when others then
    -- Notification failure must not roll back the actual friend request.
    null;
  end;

  return true;
end;
$$;
revoke all on function public.rivo_send_friend_request(text) from public;
grant execute on function public.rivo_send_friend_request(text) to authenticated;

-- 2) Accept incoming request and create friendship on both profiles
create or replace function public.rivo_accept_friend_request(p_from_username text)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
declare
  me public.profiles;
  other public.profiles;
  incoming jsonb;
  outgoing jsonb;
  mefriends jsonb;
  otherfriends jsonb;
begin
  perform set_config('rivo.internal_profile_save','on',true);

  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into me from public.profiles where id=auth.uid() for update;
  if not found then raise exception 'Not signed in'; end if;
  if me.is_banned then raise exception 'Your account is blocked'; end if;

  select * into other
  from public.profiles
  where username=lower(trim(both '@' from p_from_username))
  for update;
  if not found then raise exception 'User not found'; end if;
  if other.is_banned then raise exception 'This account is unavailable'; end if;
  if me.id=other.id then raise exception 'Invalid friend request'; end if;

  incoming:=coalesce(me.private_data->'friendRequests'->'incoming','[]'::jsonb);
  if not (incoming ? other.username) then raise exception 'Request not found'; end if;
  outgoing:=coalesce(other.private_data->'friendRequests'->'outgoing','[]'::jsonb);

  incoming := (
    select coalesce(jsonb_agg(x),'[]'::jsonb)
    from jsonb_array_elements_text(incoming) x
    where x <> other.username
  );
  outgoing := (
    select coalesce(jsonb_agg(x),'[]'::jsonb)
    from jsonb_array_elements_text(outgoing) x
    where x <> me.username
  );

  mefriends:=coalesce(me.public_data->'friends','[]'::jsonb);
  otherfriends:=coalesce(other.public_data->'friends','[]'::jsonb);
  if not (mefriends ? other.username) then mefriends:=mefriends || to_jsonb(other.username); end if;
  if not (otherfriends ? me.username) then otherfriends:=otherfriends || to_jsonb(me.username); end if;

  me.private_data:=jsonb_set(
    jsonb_set(coalesce(me.private_data,'{}'::jsonb),'{friendRequests,incoming}',incoming,true),
    '{friendRequests,outgoing}',coalesce(me.private_data->'friendRequests'->'outgoing','[]'::jsonb),true
  );
  other.private_data:=jsonb_set(
    jsonb_set(coalesce(other.private_data,'{}'::jsonb),'{friendRequests,outgoing}',outgoing,true),
    '{friendRequests,incoming}',coalesce(other.private_data->'friendRequests'->'incoming','[]'::jsonb),true
  );

  me.public_data:=jsonb_set(coalesce(me.public_data,'{}'::jsonb),'{friends}',mefriends,true);
  other.public_data:=jsonb_set(coalesce(other.public_data,'{}'::jsonb),'{friends}',otherfriends,true);

  update public.profiles
    set public_data=me.public_data, private_data=me.private_data, updated_at=now()
  where id=me.id;

  update public.profiles
    set public_data=other.public_data, private_data=other.private_data, updated_at=now()
  where id=other.id;

  return true;
end;
$$;
revoke all on function public.rivo_accept_friend_request(text) from public;
grant execute on function public.rivo_accept_friend_request(text) to authenticated;

-- 3) Decline incoming request
create or replace function public.rivo_reject_friend_request(p_from_username text)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
declare
  me public.profiles;
  other public.profiles;
  incoming jsonb;
  outgoing jsonb;
begin
  perform set_config('rivo.internal_profile_save','on',true);

  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into me from public.profiles where id=auth.uid() for update;
  if not found then raise exception 'Not signed in'; end if;
  if me.is_banned then raise exception 'Your account is blocked'; end if;

  select * into other
  from public.profiles
  where username=lower(trim(both '@' from p_from_username))
  for update;
  if not found then raise exception 'User not found'; end if;

  incoming:=coalesce(me.private_data->'friendRequests'->'incoming','[]'::jsonb);
  outgoing:=coalesce(other.private_data->'friendRequests'->'outgoing','[]'::jsonb);
  if not (incoming ? other.username) then raise exception 'Request not found'; end if;

  incoming := (
    select coalesce(jsonb_agg(x),'[]'::jsonb)
    from jsonb_array_elements_text(incoming) x
    where x <> other.username
  );
  outgoing := (
    select coalesce(jsonb_agg(x),'[]'::jsonb)
    from jsonb_array_elements_text(outgoing) x
    where x <> me.username
  );

  me.private_data:=jsonb_set(coalesce(me.private_data,'{}'::jsonb),'{friendRequests,incoming}',incoming,true);
  other.private_data:=jsonb_set(coalesce(other.private_data,'{}'::jsonb),'{friendRequests,outgoing}',outgoing,true);

  update public.profiles
    set private_data=me.private_data, updated_at=now()
  where id=me.id;
  update public.profiles
    set private_data=other.private_data, updated_at=now()
  where id=other.id;

  return true;
end;
$$;
revoke all on function public.rivo_reject_friend_request(text) from public;
grant execute on function public.rivo_reject_friend_request(text) to authenticated;

-- 4) Cancel a sent request
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
  perform set_config('rivo.internal_profile_save','on',true);

  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into me from public.profiles where id=auth.uid() for update;
  if not found then raise exception 'Not signed in'; end if;
  if me.is_banned then raise exception 'Your account is blocked'; end if;

  select * into target
  from public.profiles
  where username=lower(trim(both '@' from p_target_username))
  for update;
  if not found then raise exception 'User not found'; end if;
  if me.id=target.id then raise exception 'Invalid friend request'; end if;

  outgoing:=coalesce(me.private_data->'friendRequests'->'outgoing','[]'::jsonb);
  if not (outgoing ? target.username) then return false; end if;

  incoming:=coalesce(target.private_data->'friendRequests'->'incoming','[]'::jsonb);
  outgoing := (
    select coalesce(jsonb_agg(v),'[]'::jsonb)
    from jsonb_array_elements_text(outgoing) v
    where v <> target.username
  );
  incoming := (
    select coalesce(jsonb_agg(v),'[]'::jsonb)
    from jsonb_array_elements_text(incoming) v
    where v <> me.username
  );

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

-- 5) Remove an existing friendship
create or replace function public.rivo_remove_friend(p_username text)
returns boolean
language plpgsql
security definer
set search_path=public
as $$
declare
  me public.profiles;
  other public.profiles;
  f jsonb;
begin
  perform set_config('rivo.internal_profile_save','on',true);

  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into me from public.profiles where id=auth.uid() for update;
  if not found then raise exception 'Not signed in'; end if;
  if me.is_banned then raise exception 'Your account is blocked'; end if;

  select * into other
  from public.profiles
  where username=lower(trim(both '@' from p_username))
  for update;
  if not found then raise exception 'User not found'; end if;
  if me.id=other.id then raise exception 'Invalid friend'; end if;

  f:=coalesce(me.public_data->'friends','[]'::jsonb);
  me.public_data:=jsonb_set(
    coalesce(me.public_data,'{}'::jsonb),
    '{friends}',
    (select coalesce(jsonb_agg(x),'[]'::jsonb) from jsonb_array_elements_text(f) x where x <> other.username),
    true
  );

  f:=coalesce(other.public_data->'friends','[]'::jsonb);
  other.public_data:=jsonb_set(
    coalesce(other.public_data,'{}'::jsonb),
    '{friends}',
    (select coalesce(jsonb_agg(x),'[]'::jsonb) from jsonb_array_elements_text(f) x where x <> me.username),
    true
  );

  update public.profiles
    set public_data=me.public_data, updated_at=now()
  where id=me.id;
  update public.profiles
    set public_data=other.public_data, updated_at=now()
  where id=other.id;

  return true;
end;
$$;
revoke all on function public.rivo_remove_friend(text) from public;
grant execute on function public.rivo_remove_friend(text) to authenticated;

-- No data migration. No UI changes.
