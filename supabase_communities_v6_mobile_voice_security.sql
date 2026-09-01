-- Rivo Communities V6
-- Security + mobile voice reliability patch. Run after V5.
-- Idempotent.

create or replace function public.rivo_respond_community_request(p_id bigint,p_username text,p_accept boolean)
returns boolean language plpgsql security definer set search_path=public as $$
declare
  uid uuid;
  allowed_role text;
  member_count int;
begin
  perform pg_advisory_xact_lock(hashtextextended('community-members:'||p_id::text,0));
  select role into allowed_role from public.rivo_community_members where community_id=p_id and user_id=auth.uid();
  if allowed_role is null or allowed_role not in ('owner','moderator') then raise exception 'You cannot manage community requests'; end if;
  select id into uid from public.profiles where username=lower(trim(both '@' from p_username));
  if uid is null then raise exception 'User not found'; end if;
  if not exists(select 1 from public.rivo_community_join_requests q where q.community_id=p_id and q.user_id=uid) then
    raise exception 'No pending join request for this user';
  end if;
  if p_accept then
    select count(*)::int into member_count from public.rivo_community_members where community_id=p_id;
    if member_count >= 50 then raise exception 'This community is full (50 members maximum)'; end if;
  end if;
  delete from public.rivo_community_join_requests where community_id=p_id and user_id=uid;
  if p_accept then
    insert into public.rivo_community_members(community_id,user_id,role) values(p_id,uid,'member') on conflict (community_id,user_id) do nothing;
  end if;
  return true;
end;
$$;
revoke all on function public.rivo_respond_community_request(bigint,text,boolean) from public;
grant execute on function public.rivo_respond_community_request(bigint,text,boolean) to authenticated;

create or replace function public.rivo_list_community_members(p_id bigint)
returns setof jsonb language sql security definer set search_path=public as $$
select jsonb_build_object(
  'username',p.username,
  'displayName',coalesce(p.public_data->>'displayName',p.username),
  'avatar',coalesce(p.public_data->>'avatar',''),
  'role',m.role,
  'joined_at',m.joined_at,
  'voice_muted',coalesce(vm.muted,false)
)
from public.rivo_community_members m
join public.profiles p on p.id=m.user_id
left join public.rivo_community_voice_mutes vm on vm.community_id=m.community_id and vm.user_id=m.user_id and vm.muted=true
where m.community_id=p_id
  and exists(select 1 from public.rivo_community_members me where me.community_id=p_id and me.user_id=auth.uid())
order by case m.role when 'owner' then 0 when 'moderator' then 1 else 2 end, m.joined_at asc;
$$;
revoke all on function public.rivo_list_community_members(bigint) from public;
grant execute on function public.rivo_list_community_members(bigint) to authenticated;

create or replace function public.rivo_get_community_voice(p_id bigint)
returns jsonb language sql security definer set search_path=public as $$
select coalesce((
  select jsonb_build_object(
    'active',true,
    'id',v.id,
    'community_id',v.community_id,
    'room_name',v.room_name,
    'started_by',public.rivo_social_profile(v.started_by),
    'created_at',v.created_at
  )
  from public.rivo_community_voice_sessions v
  where v.community_id=p_id and v.status='active'
    and exists(select 1 from public.rivo_community_members me where me.community_id=p_id and me.user_id=auth.uid())
  order by v.created_at desc limit 1
), jsonb_build_object('active',false));
$$;
revoke all on function public.rivo_get_community_voice(bigint) from public;
grant execute on function public.rivo_get_community_voice(bigint) to authenticated;

-- Empty-room cleanup is a server-only operation. The Edge Function verifies
-- the caller as a community member, then performs this RPC with service role.
create or replace function public.rivo_cleanup_empty_community_voice(p_room_name text)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is not null then
    raise exception 'Voice cleanup is server-only';
  end if;
  update public.rivo_community_voice_sessions
     set status='ended', ended_at=coalesce(ended_at,now())
   where room_name=trim(p_room_name) and status='active';
  return found;
end;
$$;
revoke all on function public.rivo_cleanup_empty_community_voice(text) from public;
grant execute on function public.rivo_cleanup_empty_community_voice(text) to service_role;
