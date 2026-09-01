-- Rivo final social/economy interoperability fix
-- Run this AFTER supabase_schema.sql and supabase_economy.sql.
-- Safe to run repeatedly.
--
-- Fixes the exact "Access denied" failures caused by the legacy profile-write
-- guard rejecting legitimate SECURITY DEFINER social RPCs. It also keeps the
-- guard bypass transaction-local, so direct client writes remain protected.

create or replace function public.rivo_send_friend_request(p_target_username text)
returns boolean language plpgsql security definer set search_path=public as $$
declare me public.profiles; target public.profiles; incoming jsonb; outgoing jsonb;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  perform set_config('rivo.internal_profile_save','on',true);
  select * into me from public.profiles where id=auth.uid() for update;
  if not found then raise exception 'Not signed in'; end if;
  if me.is_banned then raise exception 'Your account is blocked'; end if;
  select * into target from public.profiles where username=lower(trim(both '@' from p_target_username)) for update;
  if not found then raise exception 'User not found'; end if;
  if target.is_banned then raise exception 'This account is unavailable'; end if;
  if me.id=target.id then raise exception 'You cannot add yourself'; end if;
  if coalesce(me.public_data->'friends','[]'::jsonb) ? target.username then raise exception 'Already friends'; end if;
  incoming:=coalesce(target.private_data->'friendRequests'->'incoming','[]'::jsonb);
  outgoing:=coalesce(me.private_data->'friendRequests'->'outgoing','[]'::jsonb);
  if incoming ? me.username then raise exception 'Request already sent'; end if;
  if coalesce(me.private_data->'friendRequests'->'incoming','[]'::jsonb) ? target.username then raise exception 'This user has already requested you'; end if;
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

create or replace function public.rivo_accept_friend_request(p_from_username text)
returns boolean language plpgsql security definer set search_path=public as $$
declare me public.profiles; other public.profiles; incoming jsonb; outgoing jsonb; mefriends jsonb; otherfriends jsonb;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  perform set_config('rivo.internal_profile_save','on',true);
  select * into me from public.profiles where id=auth.uid() for update;
  select * into other from public.profiles where username=lower(trim(both '@' from p_from_username)) for update;
  if me.id is null or other.id is null then raise exception 'User not found'; end if;
  incoming:=coalesce(me.private_data->'friendRequests'->'incoming','[]'::jsonb);
  if not (incoming ? other.username) then raise exception 'Request not found'; end if;
  outgoing:=coalesce(other.private_data->'friendRequests'->'outgoing','[]'::jsonb);
  incoming:=(select coalesce(jsonb_agg(x),'[]'::jsonb) from jsonb_array_elements_text(incoming) x where x <> other.username);
  outgoing:=(select coalesce(jsonb_agg(x),'[]'::jsonb) from jsonb_array_elements_text(outgoing) x where x <> me.username);
  mefriends:=coalesce(me.public_data->'friends','[]'::jsonb); otherfriends:=coalesce(other.public_data->'friends','[]'::jsonb);
  if not (mefriends ? other.username) then mefriends:=mefriends||to_jsonb(other.username); end if;
  if not (otherfriends ? me.username) then otherfriends:=otherfriends||to_jsonb(me.username); end if;
  me.private_data:=jsonb_set(jsonb_set(coalesce(me.private_data,'{}'::jsonb),'{friendRequests,incoming}',incoming,true),'{friendRequests,outgoing}',coalesce(me.private_data->'friendRequests'->'outgoing','[]'::jsonb),true);
  other.private_data:=jsonb_set(jsonb_set(coalesce(other.private_data,'{}'::jsonb),'{friendRequests,outgoing}',outgoing,true),'{friendRequests,incoming}',coalesce(other.private_data->'friendRequests'->'incoming','[]'::jsonb),true);
  me.public_data:=jsonb_set(coalesce(me.public_data,'{}'::jsonb),'{friends}',mefriends,true);
  other.public_data:=jsonb_set(coalesce(other.public_data,'{}'::jsonb),'{friends}',otherfriends,true);
  update public.profiles set public_data=me.public_data,private_data=me.private_data,updated_at=now() where id=me.id;
  update public.profiles set public_data=other.public_data,private_data=other.private_data,updated_at=now() where id=other.id;
  return true;
end; $$;
revoke all on function public.rivo_accept_friend_request(text) from public;
grant execute on function public.rivo_accept_friend_request(text) to authenticated;

create or replace function public.rivo_reject_friend_request(p_from_username text)
returns boolean language plpgsql security definer set search_path=public as $$
declare me public.profiles; other public.profiles; incoming jsonb; outgoing jsonb;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  perform set_config('rivo.internal_profile_save','on',true);
  select * into me from public.profiles where id=auth.uid() for update;
  select * into other from public.profiles where username=lower(trim(both '@' from p_from_username)) for update;
  if me.id is null or other.id is null then raise exception 'User not found'; end if;
  incoming:=coalesce(me.private_data->'friendRequests'->'incoming','[]'::jsonb); outgoing:=coalesce(other.private_data->'friendRequests'->'outgoing','[]'::jsonb);
  incoming:=(select coalesce(jsonb_agg(x),'[]'::jsonb) from jsonb_array_elements_text(incoming) x where x <> other.username);
  outgoing:=(select coalesce(jsonb_agg(x),'[]'::jsonb) from jsonb_array_elements_text(outgoing) x where x <> me.username);
  me.private_data:=jsonb_set(coalesce(me.private_data,'{}'::jsonb),'{friendRequests,incoming}',incoming,true);
  other.private_data:=jsonb_set(coalesce(other.private_data,'{}'::jsonb),'{friendRequests,outgoing}',outgoing,true);
  update public.profiles set private_data=me.private_data,updated_at=now() where id=me.id;
  update public.profiles set private_data=other.private_data,updated_at=now() where id=other.id;
  return true;
end; $$;
revoke all on function public.rivo_reject_friend_request(text) from public;
grant execute on function public.rivo_reject_friend_request(text) to authenticated;

create or replace function public.rivo_remove_friend(p_username text)
returns boolean language plpgsql security definer set search_path=public as $$
declare me public.profiles; other public.profiles; f jsonb;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  perform set_config('rivo.internal_profile_save','on',true);
  select * into me from public.profiles where id=auth.uid() for update;
  select * into other from public.profiles where username=lower(trim(both '@' from p_username)) for update;
  if me.id is null or other.id is null then raise exception 'User not found'; end if;
  f:=coalesce(me.public_data->'friends','[]'::jsonb);
  me.public_data:=jsonb_set(coalesce(me.public_data,'{}'::jsonb),'{friends}',(select coalesce(jsonb_agg(x),'[]'::jsonb) from jsonb_array_elements_text(f) x where x <> other.username),true);
  f:=coalesce(other.public_data->'friends','[]'::jsonb);
  other.public_data:=jsonb_set(coalesce(other.public_data,'{}'::jsonb),'{friends}',(select coalesce(jsonb_agg(x),'[]'::jsonb) from jsonb_array_elements_text(f) x where x <> me.username),true);
  update public.profiles set public_data=me.public_data,updated_at=now() where id=me.id;
  update public.profiles set public_data=other.public_data,updated_at=now() where id=other.id;
  return true;
end; $$;
revoke all on function public.rivo_remove_friend(text) from public;
grant execute on function public.rivo_remove_friend(text) to authenticated;
