-- Rivo Communities V3: voice/presence permission hardening.
-- Idempotent; safe to run after supabase_communities_v2.sql.

-- Owner is the only role allowed to change moderator roles.
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

-- Moderators may remove members, but never another moderator/owner.
create or replace function public.rivo_kick_community_member(p_id bigint,p_username text)
returns boolean language plpgsql security definer set search_path=public as $$
declare
  uid uuid; actor_role text; target_role text;
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

-- Voice token eligibility is always tied to a currently active community membership.
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
