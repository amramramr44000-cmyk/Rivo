-- Rivo community chat incremental-delivery migration
-- Replaces only the member-list RPC definition; does not alter user/content rows or table structure.
-- Apply once in the Supabase SQL Editor after reviewing the project deployment state.
-- This version preserves joined_at and voice_muted fields from the current schema while adding userId.

begin;

create or replace function public.rivo_list_community_members(p_id bigint)
returns setof jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'userId', p.id,
    'username', p.username,
    'displayName', coalesce(p.public_data->>'displayName', p.username),
    'avatar', coalesce(p.public_data->>'avatar', ''),
    'role', m.role,
    'joined_at', m.joined_at,
    'voice_muted', coalesce(vm.muted, false)
  )
  from public.rivo_community_members m
  join public.profiles p on p.id = m.user_id
  left join public.rivo_community_voice_mutes vm
    on vm.community_id = m.community_id and vm.user_id = m.user_id and vm.muted = true
  where m.community_id = p_id
    and exists (
      select 1
      from public.rivo_community_members viewer
      where viewer.community_id = p_id
        and viewer.user_id = auth.uid()
    )
  order by case m.role when 'owner' then 0 when 'moderator' then 1 else 2 end, m.joined_at asc;
$$;

revoke all on function public.rivo_list_community_members(bigint) from public;
grant execute on function public.rivo_list_community_members(bigint) to authenticated;

commit;
