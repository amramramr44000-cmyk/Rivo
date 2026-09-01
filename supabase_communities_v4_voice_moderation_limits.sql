-- Rivo Communities V4
-- Voice reliability, hard member/voice caps, and owner/moderator voice moderation.
-- Run after supabase_communities_v3_voice_polish.sql.
-- Idempotent.

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- Persistent voice mute state (server-enforced on rejoin).
-- ------------------------------------------------------------
create table if not exists public.rivo_community_voice_mutes (
  community_id bigint not null references public.rivo_communities(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  muted boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (community_id,user_id)
);
create index if not exists rivo_community_voice_mutes_user_idx
  on public.rivo_community_voice_mutes(user_id,community_id);
alter table public.rivo_community_voice_mutes enable row level security;
drop policy if exists "rivo_community_voice_mutes_select_member" on public.rivo_community_voice_mutes;
create policy "rivo_community_voice_mutes_select_member"
on public.rivo_community_voice_mutes for select to authenticated
using (exists (
  select 1 from public.rivo_community_members m
  where m.community_id=rivo_community_voice_mutes.community_id
    and m.user_id=auth.uid()
));

-- ------------------------------------------------------------
-- Hard community capacity: 50 members.
-- ------------------------------------------------------------
create or replace function public.rivo_join_community(p_id bigint)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  me uuid:=auth.uid();
  c public.rivo_communities;
  is_friend boolean:=false;
  member_count int;
begin
  if me is null then raise exception 'Not signed in'; end if;
  perform pg_advisory_xact_lock(hashtextextended('community-members:'||p_id::text,0));
  select * into c from public.rivo_communities where id=p_id;
  if c.id is null then raise exception 'Community not found'; end if;
  if exists(select 1 from public.rivo_community_members where community_id=p_id and user_id=me) then return public.rivo_get_community(p_id); end if;
  select count(*)::int into member_count from public.rivo_community_members where community_id=p_id;
  if member_count >= 50 then raise exception 'This community is full (50 members maximum)'; end if;

  if c.join_policy='public' then
    insert into public.rivo_community_members(community_id,user_id,role) values(p_id,me,'member') on conflict do nothing;
  elsif c.join_policy='friends' then
    select exists(
      select 1 from public.profiles mep join public.profiles own on own.id=c.owner_id
      where mep.id=me and coalesce(mep.public_data->'friends','[]'::jsonb) ? own.username
    ) into is_friend;
    if not is_friend then raise exception 'Only friends of the owner can join'; end if;
    insert into public.rivo_community_members(community_id,user_id,role) values(p_id,me,'member') on conflict do nothing;
  else
    insert into public.rivo_community_join_requests(community_id,user_id) values(p_id,me) on conflict do nothing;
  end if;
  return public.rivo_get_community(p_id);
end;
$$;
revoke all on function public.rivo_join_community(bigint) from public;
grant execute on function public.rivo_join_community(bigint) to authenticated;

-- Accepting a request is also capacity-checked atomically.
create or replace function public.rivo_respond_community_request(p_id bigint,p_username text,p_accept boolean)
returns boolean language plpgsql security definer set search_path=public as $$
declare
  uid uuid;
  allowed_role text;
  member_count int;
begin
  perform pg_advisory_xact_lock(hashtextextended('community-members:'||p_id::text,0));
  select role into allowed_role
    from public.rivo_community_members
   where community_id=p_id and user_id=auth.uid();
  if allowed_role is null or allowed_role not in ('owner','moderator') then
    raise exception 'You cannot manage community requests';
  end if;
  select id into uid from public.profiles where username=lower(trim(both '@' from p_username));
  if uid is null then raise exception 'User not found'; end if;
  if not exists(
    select 1 from public.rivo_community_join_requests q
    where q.community_id=p_id and q.user_id=uid
  ) then
    raise exception 'No pending join request for this user';
  end if;
  if p_accept then
    select count(*)::int into member_count from public.rivo_community_members where community_id=p_id;
    if member_count >= 50 then raise exception 'This community is full (50 members maximum)'; end if;
  end if;
  delete from public.rivo_community_join_requests where community_id=p_id and user_id=uid;
  if p_accept then
    insert into public.rivo_community_members(community_id,user_id,role)
    values(p_id,uid,'member') on conflict (community_id,user_id) do nothing;
  end if;
  return true;
end;
$$;
revoke all on function public.rivo_respond_community_request(bigint,text,boolean) from public;
grant execute on function public.rivo_respond_community_request(bigint,text,boolean) to authenticated;

-- ------------------------------------------------------------
-- Member listing exposes voice mute status for the management UI.
-- ------------------------------------------------------------
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
left join public.rivo_community_voice_mutes vm
  on vm.community_id=m.community_id and vm.user_id=m.user_id and vm.muted=true
where m.community_id=p_id
  and exists(
    select 1 from public.rivo_community_members me
    where me.community_id=p_id and me.user_id=auth.uid()
  )
order by case m.role when 'owner' then 0 when 'moderator' then 1 else 2 end, m.joined_at asc;
$$;
revoke all on function public.rivo_list_community_members(bigint) from public;
grant execute on function public.rivo_list_community_members(bigint) to authenticated;

-- ------------------------------------------------------------
-- Secure voice mute state changes. Owner can target moderators;
-- moderators can target regular members only.
-- ------------------------------------------------------------
create or replace function public.rivo_set_community_voice_mute(p_id bigint,p_username text,p_muted boolean)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  actor_role text;
  target_id uuid;
  target_role text;
  room text;
begin
  select role into actor_role from public.rivo_community_members where community_id=p_id and user_id=auth.uid();
  if actor_role is null or actor_role not in ('owner','moderator') then raise exception 'You do not have moderation permissions'; end if;
  select id into target_id from public.profiles where username=lower(trim(both '@' from p_username));
  if target_id is null then raise exception 'User not found'; end if;
  select role into target_role from public.rivo_community_members where community_id=p_id and user_id=target_id;
  if target_role is null then raise exception 'User is not a community member'; end if;
  if target_role='owner' then raise exception 'The owner cannot be voice-muted'; end if;
  if actor_role='moderator' and target_role='moderator' then raise exception 'Moderators cannot manage another moderator'; end if;

  if p_muted then
    insert into public.rivo_community_voice_mutes(community_id,user_id,muted,updated_at)
    values(p_id,target_id,true,now())
    on conflict(community_id,user_id) do update set muted=true,updated_at=now();
  else
    delete from public.rivo_community_voice_mutes where community_id=p_id and user_id=target_id;
  end if;

  select room_name into room
  from public.rivo_community_voice_sessions
  where community_id=p_id and status='active'
  order by created_at desc limit 1;

  return jsonb_build_object('community_id',p_id,'target_user_id',target_id,'target_role',target_role,'muted',p_muted,'room_name',room);
end;
$$;
revoke all on function public.rivo_set_community_voice_mute(bigint,text,boolean) from public;
grant execute on function public.rivo_set_community_voice_mute(bigint,text,boolean) to authenticated;

-- ------------------------------------------------------------
-- Safe helper for the LiveKit Edge Function. Returns the current
-- membership, voice room and persisted mute state after permission checks.
-- ------------------------------------------------------------
create or replace function public.rivo_prepare_community_voice_moderation(p_id bigint,p_username text,p_action text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  actor_role text;
  target_id uuid;
  target_role text;
  room text;
  action text:=lower(trim(coalesce(p_action,'')));
begin
  select role into actor_role from public.rivo_community_members where community_id=p_id and user_id=auth.uid();
  if actor_role is null or actor_role not in ('owner','moderator') then raise exception 'You do not have moderation permissions'; end if;
  if action not in ('kick','mute','unmute') then raise exception 'Unsupported moderation action'; end if;
  select id into target_id from public.profiles where username=lower(trim(both '@' from p_username));
  if target_id is null then raise exception 'User not found'; end if;
  select role into target_role from public.rivo_community_members where community_id=p_id and user_id=target_id;
  if target_role is null then raise exception 'User is not a community member'; end if;
  if target_role='owner' then raise exception 'The owner cannot be managed'; end if;
  if actor_role='moderator' and target_role='moderator' then raise exception 'Moderators cannot manage another moderator'; end if;
  if action in ('mute','unmute') then
    if action='mute' then
      insert into public.rivo_community_voice_mutes(community_id,user_id,muted,updated_at)
      values(p_id,target_id,true,now())
      on conflict(community_id,user_id) do update set muted=true,updated_at=now();
    else
      delete from public.rivo_community_voice_mutes where community_id=p_id and user_id=target_id;
    end if;
  else
    delete from public.rivo_community_voice_mutes where community_id=p_id and user_id=target_id;
    delete from public.rivo_community_members where community_id=p_id and user_id=target_id;
  end if;
  select room_name into room from public.rivo_community_voice_sessions where community_id=p_id and status='active' order by created_at desc limit 1;
  return jsonb_build_object('community_id',p_id,'target_user_id',target_id,'target_role',target_role,'action',action,'room_name',room);
end;
$$;
revoke all on function public.rivo_prepare_community_voice_moderation(bigint,text,text) from public;
grant execute on function public.rivo_prepare_community_voice_moderation(bigint,text,text) to authenticated;

-- ------------------------------------------------------------
-- Existing sessions remain capped at 5 via the LiveKit Edge Function.
-- New browser-issued tokens cannot be created for non-members and honor
-- persisted voice mute state.
-- ------------------------------------------------------------
create or replace function public.rivo_get_community_voice_member_state(p_room_name text)
returns jsonb language sql security definer set search_path=public as $$
select jsonb_build_object(
  'allowed',exists(
    select 1 from public.rivo_community_voice_sessions v
    join public.rivo_community_members m on m.community_id=v.community_id and m.user_id=auth.uid()
    where v.room_name=trim(p_room_name) and v.status='active'
  ),
  'muted',coalesce((
    select vm.muted
    from public.rivo_community_voice_sessions v
    join public.rivo_community_voice_mutes vm on vm.community_id=v.community_id and vm.user_id=auth.uid()
    where v.room_name=trim(p_room_name) and v.status='active' and vm.muted=true
    order by vm.updated_at desc limit 1
  ),false)
);
$$;
revoke all on function public.rivo_get_community_voice_member_state(text) from public;
grant execute on function public.rivo_get_community_voice_member_state(text) to authenticated;
