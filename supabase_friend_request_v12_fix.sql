-- Rivo v12 final fix: robust friend-request acceptance.
-- Safe to run more than once. It preserves existing friend requests and
-- atomically moves the accepted usernames into both friends arrays.
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
  other_outgoing jsonb;
  me_friends jsonb;
  other_friends jsonb;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  select * into me
  from public.profiles
  where id = auth.uid()
  for update;

  select * into other
  from public.profiles
  where username = lower(trim(both '@' from p_from_username))
  for update;

  if me.id is null or other.id is null then
    raise exception 'User not found';
  end if;

  incoming := coalesce(me.private_data->'friendRequests'->'incoming','[]'::jsonb);
  if not (incoming ? other.username) then
    raise exception 'Request not found';
  end if;

  other_outgoing := coalesce(other.private_data->'friendRequests'->'outgoing','[]'::jsonb);
  me_friends := coalesce(me.public_data->'friends','[]'::jsonb);
  other_friends := coalesce(other.public_data->'friends','[]'::jsonb);

  select coalesce(jsonb_agg(v order by ord),'[]'::jsonb) into incoming
  from jsonb_array_elements_text(incoming) with ordinality as t(v,ord)
  where v <> other.username;

  select coalesce(jsonb_agg(v order by ord),'[]'::jsonb) into other_outgoing
  from jsonb_array_elements_text(other_outgoing) with ordinality as t(v,ord)
  where v <> me.username;

  if not (me_friends ? other.username) then
    me_friends := me_friends || jsonb_build_array(other.username);
  end if;
  if not (other_friends ? me.username) then
    other_friends := other_friends || jsonb_build_array(me.username);
  end if;

  me.private_data := jsonb_set(
    coalesce(me.private_data,'{}'::jsonb),
    '{friendRequests,incoming}',
    incoming,
    true
  );
  other.private_data := jsonb_set(
    coalesce(other.private_data,'{}'::jsonb),
    '{friendRequests,outgoing}',
    other_outgoing,
    true
  );

  me.public_data := jsonb_set(
    coalesce(me.public_data,'{}'::jsonb),
    '{friends}',
    me_friends,
    true
  );
  other.public_data := jsonb_set(
    coalesce(other.public_data,'{}'::jsonb),
    '{friends}',
    other_friends,
    true
  );

  update public.profiles
  set public_data = me.public_data,
      private_data = me.private_data,
      updated_at = now()
  where id = me.id;

  update public.profiles
  set public_data = other.public_data,
      private_data = other.private_data,
      updated_at = now()
  where id = other.id;

  begin
    perform public.rivo_write_notification(
      other.id,
      me.id,
      'friend_accept',
      me.username || ' accepted your friend request',
      jsonb_build_object('username', me.username)
    );
  exception when undefined_function then
    null;
  end;

  return true;
end;
$$;

revoke all on function public.rivo_accept_friend_request(text) from public;
grant execute on function public.rivo_accept_friend_request(text) to authenticated;
