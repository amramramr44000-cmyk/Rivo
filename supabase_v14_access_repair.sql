-- Rivo v14: resilient friends/profile access repair
-- Safe/idempotent: does not delete users or existing friendship data.

-- Keep friend-request RPCs executable for signed-in users.
revoke all on function public.rivo_send_friend_request(text) from public;
grant execute on function public.rivo_send_friend_request(text) to authenticated;

revoke all on function public.rivo_accept_friend_request(text) from public;
grant execute on function public.rivo_accept_friend_request(text) to authenticated;

revoke all on function public.rivo_reject_friend_request(text) from public;
grant execute on function public.rivo_reject_friend_request(text) to authenticated;

revoke all on function public.rivo_remove_friend(text) from public;
grant execute on function public.rivo_remove_friend(text) to authenticated;

-- Public profile lookup must be callable by authenticated users.
revoke all on function public.rivo_get_public_profile(text) from public;
grant execute on function public.rivo_get_public_profile(text) to anon, authenticated;

revoke all on function public.rivo_get_public_profiles(text[]) from public;
grant execute on function public.rivo_get_public_profiles(text[]) to anon, authenticated;

-- Keep profile-view analytics non-blocking for readers.
revoke all on function public.rivo_add_view(text) from public;
grant execute on function public.rivo_add_view(text) to anon, authenticated;

-- Existing media bucket should remain readable so public profile media opens
-- even when the viewer is not the uploader.
drop policy if exists "rivo_media_read" on storage.objects;
create policy "rivo_media_read"
on storage.objects for select to public
using (bucket_id = 'rivo-media');

-- Refresh schema cache after RPC changes.
notify pgrst, 'reload schema';

-- ============================================================
-- v15 friend-request consistency repair
--
-- Handles the important reciprocal-request case safely:
-- A sends to B while B has already sent to A (or both actions happen
-- almost simultaneously). Instead of leaving two stale "sent" states,
-- the second action completes the friendship atomically.
-- Rows are locked in UUID order to avoid deadlocks when both users act
-- at the same time.
-- ============================================================

create or replace function public.rivo_send_friend_request(p_target_username text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  me public.profiles;
  target public.profiles;
  first_id uuid;
  second_id uuid;
  incoming_me jsonb;
  outgoing_me jsonb;
  incoming_target jsonb;
  outgoing_target jsonb;
  mefriends jsonb;
  targetfriends jsonb;
  reverse_request boolean := false;
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;

  select id into first_id
  from public.profiles
  where id = auth.uid();

  if first_id is null then
    raise exception 'Not signed in';
  end if;

  select id into second_id
  from public.profiles
  where username = lower(trim(both '@' from p_target_username));

  if second_id is null then
    raise exception 'User not found';
  end if;

  if first_id = second_id then
    raise exception 'You cannot add yourself';
  end if;

  -- Always lock both rows in the same order. This prevents a deadlock when
  -- two users press Add at almost exactly the same time.
  if first_id < second_id then
    select * into me from public.profiles where id = first_id for update;
    select * into target from public.profiles where id = second_id for update;
  else
    select * into target from public.profiles where id = second_id for update;
    select * into me from public.profiles where id = first_id for update;
  end if;

  if me.is_banned then
    raise exception 'Your account is blocked';
  end if;
  if target.is_banned then
    raise exception 'This account is unavailable';
  end if;

  mefriends := coalesce(me.public_data->'friends','[]'::jsonb);
  targetfriends := coalesce(target.public_data->'friends','[]'::jsonb);

  if mefriends ? target.username then
    raise exception 'Already friends';
  end if;

  incoming_me := coalesce(me.private_data->'friendRequests'->'incoming','[]'::jsonb);
  outgoing_me := coalesce(me.private_data->'friendRequests'->'outgoing','[]'::jsonb);
  incoming_target := coalesce(target.private_data->'friendRequests'->'incoming','[]'::jsonb);
  outgoing_target := coalesce(target.private_data->'friendRequests'->'outgoing','[]'::jsonb);

  -- If the other user already requested me, this is a reciprocal request.
  -- Complete the friendship instead of producing two pending states.
  reverse_request := (incoming_me ? target.username) and (outgoing_target ? me.username);

  if reverse_request then
    incoming_me := (
      select coalesce(jsonb_agg(x),'[]'::jsonb)
      from jsonb_array_elements_text(incoming_me) x
      where x <> target.username
    );
    outgoing_target := (
      select coalesce(jsonb_agg(x),'[]'::jsonb)
      from jsonb_array_elements_text(outgoing_target) x
      where x <> me.username
    );

    if not (mefriends ? target.username) then
      mefriends := mefriends || to_jsonb(target.username);
    end if;
    if not (targetfriends ? me.username) then
      targetfriends := targetfriends || to_jsonb(me.username);
    end if;

    me.private_data := jsonb_set(
      coalesce(me.private_data,'{}'::jsonb),
      '{friendRequests,incoming}', incoming_me, true
    );
    target.private_data := jsonb_set(
      coalesce(target.private_data,'{}'::jsonb),
      '{friendRequests,outgoing}', outgoing_target, true
    );
    me.public_data := jsonb_set(
      coalesce(me.public_data,'{}'::jsonb),
      '{friends}', mefriends, true
    );
    target.public_data := jsonb_set(
      coalesce(target.public_data,'{}'::jsonb),
      '{friends}', targetfriends, true
    );

    update public.profiles
      set public_data = me.public_data,
          private_data = me.private_data,
          updated_at = now()
      where id = me.id;

    update public.profiles
      set public_data = target.public_data,
          private_data = target.private_data,
          updated_at = now()
      where id = target.id;

    perform public.rivo_write_notification(
      target.id,
      me.id,
      'friend_accept',
      me.username || ' and you are now friends',
      jsonb_build_object('username',me.username)
    );

    return true;
  end if;

  -- A normal request is idempotent and never duplicates entries.
  if incoming_target ? me.username or outgoing_me ? target.username then
    raise exception 'Request already exists';
  end if;

  outgoing_me := outgoing_me || to_jsonb(target.username);
  incoming_target := incoming_target || to_jsonb(me.username);

  me.private_data := jsonb_set(
    coalesce(me.private_data,'{}'::jsonb),
    '{friendRequests,outgoing}', outgoing_me, true
  );
  target.private_data := jsonb_set(
    coalesce(target.private_data,'{}'::jsonb),
    '{friendRequests,incoming}', incoming_target, true
  );

  update public.profiles
    set private_data = me.private_data,
        updated_at = now()
    where id = me.id;

  update public.profiles
    set private_data = target.private_data,
        updated_at = now()
    where id = target.id;

  perform public.rivo_write_notification(
    target.id,
    me.id,
    'friend_request',
    me.username || ' sent you a friend request',
    jsonb_build_object('username',me.username)
  );

  return true;
end;
$$;

revoke all on function public.rivo_send_friend_request(text) from public;
grant execute on function public.rivo_send_friend_request(text) to authenticated;

notify pgrst, 'reload schema';
