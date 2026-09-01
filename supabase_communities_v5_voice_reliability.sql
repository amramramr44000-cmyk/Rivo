-- Rivo Communities V5
-- Voice reliability, automatic empty-room cleanup, and stable admin unmute.
-- Run after supabase_communities_v4_voice_moderation_limits.sql.
-- Idempotent.

create or replace function public.rivo_cleanup_empty_community_voice(p_room_name text)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  -- This RPC is called only by the LiveKit Edge Function after it has
  -- verified the caller is a community member and the LiveKit room is empty.
  if auth.uid() is not null then raise exception 'Voice cleanup is server-only'; end if;
  update public.rivo_community_voice_sessions
     set status='ended', ended_at=coalesce(ended_at,now())
   where room_name=trim(p_room_name) and status='active';
  return found;
end;
$$;
revoke all on function public.rivo_cleanup_empty_community_voice(text) from public;
grant execute on function public.rivo_cleanup_empty_community_voice(text) to service_role;
