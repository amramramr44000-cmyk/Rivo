-- Rivo v35: persist friend request privacy and enforce it for every request path.
-- Safe to rerun. Existing settings and social data are preserved.

create or replace function public.rivo_set_friend_request_setting(p_who_can_request text)
returns text
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_me uuid := auth.uid();
  v_setting text := case
    when p_who_can_request = 'friends' then 'friends'
    when p_who_can_request = 'nobody' then 'nobody'
    else 'everyone'
  end;
begin
  if v_me is null then raise exception 'Not signed in'; end if;
  update public.profiles
     set private_data = jsonb_set(coalesce(private_data,'{}'::jsonb), '{friendRequestSettings,whoCanRequest}', to_jsonb(v_setting), true),
         updated_at = now()
   where id = v_me;
  if not found then raise exception 'Profile not found'; end if;
  return v_setting;
end;
$$;
revoke all on function public.rivo_set_friend_request_setting(text) from public, anon;
grant execute on function public.rivo_set_friend_request_setting(text) to authenticated;

create or replace function public.rivo_enforce_friend_request_privacy()
returns trigger
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_requester record;
  v_policy text;
  v_old_incoming jsonb := coalesce(old.private_data->'friendRequests'->'incoming', '[]'::jsonb);
  v_new_incoming jsonb := coalesce(new.private_data->'friendRequests'->'incoming', '[]'::jsonb);
  v_name text;
begin
  if v_new_incoming = v_old_incoming then return new; end if;
  v_policy := coalesce(new.private_data->'friendRequestSettings'->>'whoCanRequest', 'everyone');
  for v_name in
    select value from jsonb_array_elements_text(v_new_incoming) as values(value)
    where not (v_old_incoming ? value)
  loop
    if v_policy = 'nobody' then raise exception 'This user is not accepting friend requests'; end if;
    if v_policy = 'friends' then
      select p.username, coalesce(p.public_data->'friends','[]'::jsonb) as friends
        into v_requester from public.profiles p where p.username = v_name;
      if v_requester.username is null or not exists (
        select 1
          from jsonb_array_elements_text(coalesce(new.public_data->'friends','[]'::jsonb)) as target_friend(username)
         where v_requester.friends ? target_friend.username
      ) then
        raise exception 'Only friends of friends can send a request';
      end if;
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function public.rivo_enforce_friend_request_privacy() from public, anon, authenticated;

drop trigger if exists rivo_friend_request_privacy_guard on public.profiles;
create trigger rivo_friend_request_privacy_guard
before update of private_data on public.profiles
for each row execute function public.rivo_enforce_friend_request_privacy();

notify pgrst, 'reload schema';
