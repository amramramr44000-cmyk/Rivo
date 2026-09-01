-- Rivo Communities V2
-- Community creation economy, moderation roles, voice-room permissions and
-- secure LiveKit authorization. Run after the existing Rivo schema/economy files.
-- Safe to run repeatedly.

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- Community settings
-- ------------------------------------------------------------
alter table public.rivo_communities
  add column if not exists voice_start_policy text not null default 'everyone';

alter table public.rivo_communities
  drop constraint if exists rivo_communities_voice_start_policy_check;
alter table public.rivo_communities
  add constraint rivo_communities_voice_start_policy_check
  check (voice_start_policy in ('everyone','moderators','owner'));

-- Moderation roles: owner > moderator > member.
alter table public.rivo_community_members
  drop constraint if exists rivo_community_members_role_check;
alter table public.rivo_community_members
  add constraint rivo_community_members_role_check
  check (role in ('owner','moderator','member'));

-- Older economy schemas only allow a small fixed transaction list.
alter table public.coin_transactions
  drop constraint if exists coin_transactions_type_check;
alter table public.coin_transactions
  add constraint coin_transactions_type_check
  check (type in ('transfer','ad_reward','purchase','community_create'));

-- ------------------------------------------------------------
-- Active community voice sessions
-- ------------------------------------------------------------
create table if not exists public.rivo_community_voice_sessions (
  id uuid primary key default gen_random_uuid(),
  community_id bigint not null references public.rivo_communities(id) on delete cascade,
  started_by uuid not null references auth.users(id) on delete cascade,
  room_name text not null unique,
  status text not null default 'active' check (status in ('active','ended')),
  created_at timestamptz not null default now(),
  ended_at timestamptz
);
create index if not exists rivo_community_voice_sessions_community_idx
  on public.rivo_community_voice_sessions(community_id, created_at desc);
create unique index if not exists rivo_community_voice_active_uq
  on public.rivo_community_voice_sessions(community_id)
  where status = 'active';

alter table public.rivo_community_voice_sessions enable row level security;
drop policy if exists "rivo_community_voice_select_member" on public.rivo_community_voice_sessions;
create policy "rivo_community_voice_select_member"
on public.rivo_community_voice_sessions for select to authenticated
using (exists (
  select 1 from public.rivo_community_members m
  where m.community_id = rivo_community_voice_sessions.community_id
    and m.user_id = auth.uid()
));

-- Keep room events live in Supabase Realtime.
do $$ begin
  if not exists(
    select 1 from pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public'
      and tablename='rivo_community_voice_sessions'
  ) then
    alter publication supabase_realtime add table public.rivo_community_voice_sessions;
  end if;
end $$;

-- ------------------------------------------------------------
-- Secure community creation: 10,000 coins, atomically charged.
-- ------------------------------------------------------------
create or replace function public.rivo_create_community(
  p_name text,
  p_description text,
  p_join_policy text,
  p_image_url text default null,
  p_image_path text default null,
  p_voice_start_policy text default 'everyone'
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  me uuid := auth.uid();
  cid bigint;
  owned_count int;
  balance bigint;
  new_balance bigint;
  policy text := case when p_join_policy='friends' then 'friends' when p_join_policy='request' then 'request' else 'public' end;
  voice_policy text := case
    when p_voice_start_policy='moderators' then 'moderators'
    when p_voice_start_policy='owner' then 'owner'
    else 'everyone'
  end;
begin
  if me is null then raise exception 'Not signed in'; end if;
  perform pg_advisory_xact_lock(hashtextextended(me::text,0));
  select count(*)::int into owned_count from public.rivo_communities where owner_id=me;
  if owned_count >= 3 then raise exception 'You can create up to 3 communities'; end if;
  if nullif(trim(coalesce(p_name,'')),'') is null then raise exception 'Community name is required'; end if;
  if char_length(trim(p_name)) > 80 then raise exception 'Community name is too long'; end if;
  if char_length(coalesce(p_description,'')) > 500 then raise exception 'Community description is too long'; end if;

  select coins_balance into balance from public.profiles where id=me for update;
  if balance is null then raise exception 'Account balance is unavailable'; end if;
  if balance < 10000 then raise exception 'You need 10,000 coins to create a community. Current balance: %', balance; end if;
  new_balance := balance - 10000;

  perform set_config('rivo.internal_coin_update','on',true);
  update public.profiles
     set coins_balance = new_balance,
         updated_at = now()
   where id = me;

  insert into public.rivo_communities(
    owner_id,name,description,join_policy,image_url,image_path,voice_start_policy
  ) values(
    me,trim(p_name),trim(coalesce(p_description,'')),policy,
    nullif(trim(p_image_url),''),nullif(trim(p_image_path),''),voice_policy
  ) returning id into cid;

  insert into public.rivo_community_members(community_id,user_id,role)
  values(cid,me,'owner');

  insert into public.coin_transactions(sender_id,amount,type)
  values(me,10000,'community_create');

  return jsonb_build_object(
    'id',cid,
    'coins_balance',new_balance,
    'creation_cost',10000,
    'voice_start_policy',voice_policy
  ) || coalesce((public.rivo_get_community(cid))::jsonb,'{}'::jsonb);
end;
$$;
revoke all on function public.rivo_create_community(text,text,text,text,text,text) from public;
grant execute on function public.rivo_create_community(text,text,text,text,text,text) to authenticated;

-- Preserve compatibility with callers still using the old five-argument RPC.
create or replace function public.rivo_create_community(
  p_name text,
  p_description text,
  p_join_policy text,
  p_image_url text default null,
  p_image_path text default null
)
returns jsonb language sql security definer set search_path=public as $$
  select public.rivo_create_community(p_name,p_description,p_join_policy,p_image_url,p_image_path,'everyone');
$$;
revoke all on function public.rivo_create_community(text,text,text,text,text) from public;
grant execute on function public.rivo_create_community(text,text,text,text,text) to authenticated;

-- ------------------------------------------------------------
-- Rich community payload
-- ------------------------------------------------------------
create or replace function public.rivo_get_community(p_id bigint)
returns jsonb language sql security definer set search_path=public as $$
select jsonb_build_object(
  'id',c.id,
  'name',c.name,
  'description',c.description,
  'join_policy',c.join_policy,
  'image_url',c.image_url,
  'image_path',c.image_path,
  'created_at',c.created_at,
  'voice_start_policy',coalesce(c.voice_start_policy,'everyone'),
  'owner',public.rivo_social_profile(c.owner_id),
  'members_count',(select count(*) from public.rivo_community_members m where m.community_id=c.id),
  'is_member',exists(select 1 from public.rivo_community_members m where m.community_id=c.id and m.user_id=auth.uid()),
  'request_pending',exists(select 1 from public.rivo_community_join_requests q where q.community_id=c.id and q.user_id=auth.uid()),
  'my_role',coalesce((select m.role from public.rivo_community_members m where m.community_id=c.id and m.user_id=auth.uid()),'guest'),
  'voice',coalesce((
    select jsonb_build_object(
      'active',true,
      'id',v.id,
      'room_name',v.room_name,
      'started_by',public.rivo_social_profile(v.started_by),
      'created_at',v.created_at
    )
    from public.rivo_community_voice_sessions v
    where v.community_id=c.id and v.status='active'
    order by v.created_at desc limit 1
  ), jsonb_build_object('active',false))
)
from public.rivo_communities c where c.id=p_id;
$$;
revoke all on function public.rivo_get_community(bigint) from public;
grant execute on function public.rivo_get_community(bigint) to anon, authenticated;

create or replace function public.rivo_list_communities(p_limit int default 80)
returns setof jsonb language sql security definer set search_path=public as $$
select jsonb_build_object(
  'id',c.id,'name',c.name,'description',c.description,'join_policy',c.join_policy,
  'image_url',c.image_url,'image_path',c.image_path,'created_at',c.created_at,
  'voice_start_policy',coalesce(c.voice_start_policy,'everyone'),
  'owner',public.rivo_social_profile(c.owner_id),
  'members_count',(select count(*) from public.rivo_community_members m where m.community_id=c.id),
  'is_member',exists(select 1 from public.rivo_community_members m where m.community_id=c.id and m.user_id=auth.uid()),
  'request_pending',exists(select 1 from public.rivo_community_join_requests q where q.community_id=c.id and q.user_id=auth.uid()),
  'my_role',coalesce((select m.role from public.rivo_community_members m where m.community_id=c.id and m.user_id=auth.uid()),'guest'),
  'voice_active',exists(select 1 from public.rivo_community_voice_sessions v where v.community_id=c.id and v.status='active')
)
from public.rivo_communities c
order by c.created_at desc
limit greatest(1,least(coalesce(p_limit,80),100));
$$;
revoke all on function public.rivo_list_communities(int) from public;
grant execute on function public.rivo_list_communities(int) to anon, authenticated;

-- ------------------------------------------------------------
-- Moderation role controls
-- ------------------------------------------------------------
create or replace function public.rivo_set_community_moderator(p_id bigint,p_username text,p_enabled boolean)
returns boolean language plpgsql security definer set search_path=public as $$
declare
  me uuid:=auth.uid(); uid uuid; target_role text;
begin
  if me is null then raise exception 'Not signed in'; end if;
  if not exists(select 1 from public.rivo_community_members where community_id=p_id and user_id=me and role='owner') then
    raise exception 'Only the community owner can manage moderators';
  end if;
  select id into uid from public.profiles where username=lower(trim(both '@' from p_username));
  if uid is null then raise exception 'User not found'; end if;
  select role into target_role from public.rivo_community_members where community_id=p_id and user_id=uid;
  if target_role is null then raise exception 'User is not a community member'; end if;
  if target_role='owner' then raise exception 'The owner cannot be changed'; end if;
  update public.rivo_community_members
     set role=case when p_enabled then 'moderator' else 'member' end
   where community_id=p_id and user_id=uid;
  return true;
end;
$$;
revoke all on function public.rivo_set_community_moderator(bigint,text,boolean) from public;
grant execute on function public.rivo_set_community_moderator(bigint,text,boolean) to authenticated;

create or replace function public.rivo_set_community_voice_policy(p_id bigint,p_policy text)
returns text language plpgsql security definer set search_path=public as $$
declare v text:=case when p_policy='moderators' then 'moderators' when p_policy='owner' then 'owner' else 'everyone' end;
begin
  if not exists(select 1 from public.rivo_community_members where community_id=p_id and user_id=auth.uid() and role='owner') then
    raise exception 'Only the community owner can change voice permissions';
  end if;
  update public.rivo_communities set voice_start_policy=v where id=p_id;
  return v;
end;
$$;
revoke all on function public.rivo_set_community_voice_policy(bigint,text) from public;
grant execute on function public.rivo_set_community_voice_policy(bigint,text) to authenticated;

-- Owner + moderators can review and respond to join requests.
create or replace function public.rivo_list_community_requests(p_id bigint)
returns setof jsonb language sql security definer set search_path=public as $$
select jsonb_build_object(
  'username',p.username,
  'displayName',coalesce(p.public_data->>'displayName',p.username),
  'avatar',coalesce(p.public_data->>'avatar',''),
  'created_at',q.created_at
)
from public.rivo_community_join_requests q
join public.rivo_communities c on c.id=q.community_id
join public.profiles p on p.id=q.user_id
where q.community_id=p_id
  and exists(select 1 from public.rivo_community_members me where me.community_id=p_id and me.user_id=auth.uid() and me.role in ('owner','moderator'))
order by q.created_at asc;
$$;
revoke all on function public.rivo_list_community_requests(bigint) from public;
grant execute on function public.rivo_list_community_requests(bigint) to authenticated;

create or replace function public.rivo_respond_community_request(p_id bigint,p_username text,p_accept boolean)
returns boolean language plpgsql security definer set search_path=public as $$
declare uid uuid; allowed_role text;
begin
  select role into allowed_role from public.rivo_community_members where community_id=p_id and user_id=auth.uid();
  if allowed_role is null or allowed_role not in ('owner','moderator') then raise exception 'You cannot manage community requests'; end if;
  select id into uid from public.profiles where username=lower(trim(both '@' from p_username));
  if uid is null then raise exception 'User not found'; end if;
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

-- Owner can remove anyone except owner. Moderator can remove normal members only.
create or replace function public.rivo_kick_community_member(p_id bigint,p_username text)
returns boolean language plpgsql security definer set search_path=public as $$
declare uid uuid; actor_role text; target_role text;
begin
  select role into actor_role from public.rivo_community_members where community_id=p_id and user_id=auth.uid();
  if actor_role is null or actor_role not in ('owner','moderator') then raise exception 'You do not have moderation permissions'; end if;
  select id into uid from public.profiles where username=lower(trim(both '@' from p_username));
  if uid is null then raise exception 'User not found'; end if;
  select role into target_role from public.rivo_community_members where community_id=p_id and user_id=uid;
  if target_role is null then return true; end if;
  if target_role='owner' then raise exception 'The owner cannot be removed'; end if;
  if actor_role='moderator' and target_role='moderator' then raise exception 'Moderators cannot remove another moderator'; end if;
  delete from public.rivo_community_members where community_id=p_id and user_id=uid;
  return true;
end;
$$;
revoke all on function public.rivo_kick_community_member(bigint,text) from public;
grant execute on function public.rivo_kick_community_member(bigint,text) to authenticated;

create or replace function public.rivo_list_community_members(p_id bigint)
returns setof jsonb language sql security definer set search_path=public as $$
select jsonb_build_object(
  'username',p.username,
  'displayName',coalesce(p.public_data->>'displayName',p.username),
  'avatar',coalesce(p.public_data->>'avatar',''),
  'role',m.role,
  'joined_at',m.joined_at
)
from public.rivo_community_members m
join public.profiles p on p.id=m.user_id
where m.community_id=p_id
order by case m.role when 'owner' then 0 when 'moderator' then 1 else 2 end, m.joined_at asc;
$$;
revoke all on function public.rivo_list_community_members(bigint) from public;
grant execute on function public.rivo_list_community_members(bigint) to authenticated;

-- ------------------------------------------------------------
-- Community voice lifecycle
-- ------------------------------------------------------------
create or replace function public.rivo_start_community_voice(p_id bigint)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  me uuid:=auth.uid(); c public.rivo_communities; my_role text; existing public.rivo_community_voice_sessions; sid uuid; room text;
begin
  if me is null then raise exception 'Not signed in'; end if;
  perform pg_advisory_xact_lock(hashtextextended('community-voice:'||p_id::text,0));
  select * into c from public.rivo_communities where id=p_id;
  if c.id is null then raise exception 'Community not found'; end if;
  select role into my_role from public.rivo_community_members where community_id=p_id and user_id=me;
  if my_role is null then raise exception 'Join the community first'; end if;
  if coalesce(c.voice_start_policy,'everyone')='owner' and my_role<>'owner' then raise exception 'Only the owner can start voice calls'; end if;
  if coalesce(c.voice_start_policy,'everyone')='moderators' and my_role not in ('owner','moderator') then raise exception 'Only owners and moderators can start voice calls'; end if;

  select * into existing from public.rivo_community_voice_sessions where community_id=p_id and status='active' order by created_at desc limit 1;
  if existing.id is not null then
    return jsonb_build_object('id',existing.id,'room_name',existing.room_name,'active',true,'started_by',public.rivo_social_profile(existing.started_by),'created_at',existing.created_at);
  end if;

  sid:=gen_random_uuid();
  room:='rivo-community-'||p_id::text||'-'||replace(sid::text,'-','');
  insert into public.rivo_community_voice_sessions(id,community_id,started_by,room_name,status)
  values(sid,p_id,me,room,'active');

  return jsonb_build_object('id',sid,'room_name',room,'active',true,'started_by',public.rivo_social_profile(me),'created_at',now());
end;
$$;
revoke all on function public.rivo_start_community_voice(bigint) from public;
grant execute on function public.rivo_start_community_voice(bigint) to authenticated;

create or replace function public.rivo_end_community_voice(p_id bigint)
returns boolean language plpgsql security definer set search_path=public as $$
declare my_role text;
begin
  select m.role into my_role from public.rivo_community_members m where m.community_id=p_id and m.user_id=auth.uid();
  if my_role is null or my_role not in ('owner','moderator') then raise exception 'You cannot end the community voice room'; end if;
  if not exists(select 1 from public.rivo_community_voice_sessions where community_id=p_id and status='active') then return true; end if;
  update public.rivo_community_voice_sessions set status='ended', ended_at=now() where community_id=p_id and status='active';
  return true;
end;
$$;
revoke all on function public.rivo_end_community_voice(bigint) from public;
grant execute on function public.rivo_end_community_voice(bigint) to authenticated;

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
  order by v.created_at desc limit 1
), jsonb_build_object('active',false));
$$;
revoke all on function public.rivo_get_community_voice(bigint) from public;
grant execute on function public.rivo_get_community_voice(bigint) to authenticated;

-- This is intentionally narrow and is called by the LiveKit Edge Function.
create or replace function public.rivo_can_join_community_voice(p_room_name text)
returns boolean language sql security definer set search_path=public as $$
select exists(
  select 1
  from public.rivo_community_voice_sessions v
  join public.rivo_community_members m on m.community_id=v.community_id and m.user_id=auth.uid()
  where v.room_name=trim(p_room_name)
    and v.status='active'
);
$$;
revoke all on function public.rivo_can_join_community_voice(text) from public;
grant execute on function public.rivo_can_join_community_voice(text) to authenticated;

-- Secure delete also ends any active room through cascade.
create or replace function public.rivo_delete_community(p_id bigint)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me uuid:=auth.uid(); owner_id uuid;
begin
  if me is null then raise exception 'Not signed in'; end if;
  select owner_id into owner_id from public.rivo_communities where id=p_id;
  if owner_id is null then raise exception 'Community not found'; end if;
  if owner_id <> me then raise exception 'Only the community owner can delete it'; end if;
  delete from public.rivo_communities where id=p_id;
  return jsonb_build_object('deleted',true,'id',p_id);
end;
$$;
revoke all on function public.rivo_delete_community(bigint) from public;
grant execute on function public.rivo_delete_community(bigint) to authenticated;
