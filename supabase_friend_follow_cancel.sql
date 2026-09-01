-- Rivo friend-request cancellation + follow system.
-- Safe additive migration: does not alter existing friend-request behavior.

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
  select * into me from public.profiles where id=auth.uid();
  if not found then raise exception 'Not signed in'; end if;
  if me.is_banned then raise exception 'Your account is blocked'; end if;

  select * into target
  from public.profiles
  where username=lower(trim(both '@' from p_target_username));
  if not found then raise exception 'User not found'; end if;
  if me.id=target.id then raise exception 'Invalid friend request'; end if;
  if target.is_banned then raise exception 'This account is unavailable'; end if;

  outgoing:=coalesce(me.private_data->'friendRequests'->'outgoing','[]'::jsonb);
  if not (outgoing ? target.username) then return false; end if;

  incoming:=coalesce(target.private_data->'friendRequests'->'incoming','[]'::jsonb);
  select coalesce(jsonb_agg(v),'[]'::jsonb) into outgoing
  from jsonb_array_elements(outgoing) v
  where v <> to_jsonb(target.username);
  select coalesce(jsonb_agg(v),'[]'::jsonb) into incoming
  from jsonb_array_elements(incoming) v
  where v <> to_jsonb(me.username);

  update public.profiles
    set private_data=jsonb_set(
      jsonb_set(coalesce(private_data,'{}'::jsonb),'{friendRequests,outgoing}',outgoing,true),
      '{friendRequests,incoming}', coalesce(private_data->'friendRequests'->'incoming','[]'::jsonb), true
    ), updated_at=now()
  where id=me.id;

  update public.profiles
    set private_data=jsonb_set(
      jsonb_set(coalesce(private_data,'{}'::jsonb),'{friendRequests,incoming}',incoming,true),
      '{friendRequests,outgoing}', coalesce(private_data->'friendRequests'->'outgoing','[]'::jsonb), true
    ), updated_at=now()
  where id=target.id;
  return true;
end; $$;
revoke all on function public.rivo_cancel_friend_request(text) from public;
grant execute on function public.rivo_cancel_friend_request(text) to authenticated;

create or replace function public.rivo_toggle_follow(p_target_username text)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  me public.profiles;
  target public.profiles;
  following jsonb;
  followers jsonb;
  now_following boolean;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into me from public.profiles where id=auth.uid();
  if not found then raise exception 'Not signed in'; end if;
  if me.is_banned then raise exception 'Your account is blocked'; end if;

  select * into target from public.profiles
  where username=lower(trim(both '@' from p_target_username));
  if not found then raise exception 'User not found'; end if;
  if target.is_banned then raise exception 'This account is unavailable'; end if;
  if me.id=target.id then raise exception 'You cannot follow yourself'; end if;

  following:=coalesce(me.public_data->'following','[]'::jsonb);
  followers:=coalesce(target.public_data->'followers','[]'::jsonb);
  now_following:=following ? target.username;

  if now_following then
    select coalesce(jsonb_agg(v),'[]'::jsonb) into following
    from jsonb_array_elements(following) v
    where v <> to_jsonb(target.username);
    select coalesce(jsonb_agg(v),'[]'::jsonb) into followers
    from jsonb_array_elements(followers) v
    where v <> to_jsonb(me.username);
    now_following:=false;
  else
    following:=following || to_jsonb(target.username);
    if not (followers ? me.username) then followers:=followers || to_jsonb(me.username); end if;
    now_following:=true;
  end if;

  update public.profiles set public_data=jsonb_set(coalesce(public_data,'{}'::jsonb),'{following}',following,true),updated_at=now() where id=me.id;
  update public.profiles set public_data=jsonb_set(coalesce(public_data,'{}'::jsonb),'{followers}',followers,true),updated_at=now() where id=target.id;
  return jsonb_build_object('following',now_following);
end; $$;
revoke all on function public.rivo_toggle_follow(text) from public;
grant execute on function public.rivo_toggle_follow(text) to authenticated;
