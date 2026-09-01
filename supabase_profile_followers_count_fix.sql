-- Focused Rivo fix: return the target follower list/count from the public profile RPC.
-- This does not alter follow/unfollow behavior; it only exposes the existing
-- public_data.followers value so the Profile counter can update after a follow.

create or replace function public.rivo_get_public_profile(p_username text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.profiles; story_row public.rivo_stories;
begin
  perform public.rivo_cleanup_expired_stories();
  select * into r from public.profiles where username=lower(trim(both '@' from p_username)) limit 1;
  if not found then return null; end if;
  select * into story_row from public.rivo_stories where user_id=r.id and expires_at > now() and media_type like 'image/%' order by created_at desc limit 1;
  return jsonb_build_object(
    'userId',r.id,'username',r.username,'displayName',coalesce(r.public_data->>'displayName',r.username),'bio',coalesce(r.public_data->>'bio',''),'description',coalesce(r.public_data->>'description',''),'location',coalesce(r.public_data->>'location',''),'website',coalesce(r.public_data->>'website',''),'avatar',coalesce(r.public_data->>'avatar',''),'banner',coalesce(r.public_data->>'banner',''),'miniImage',coalesce(r.public_data->>'miniImage',''),'status',coalesce(r.public_data->>'status','Online'),'customStatus',coalesce(r.public_data->>'customStatus',''),'theme',coalesce(r.public_data->>'theme','obsidian'),'template',coalesce(r.public_data->>'template','discord-noir'),'accent',coalesce(r.public_data->>'accent','#7488ff'),'cardRadius',coalesce((r.public_data->>'cardRadius')::numeric,24),'cardStyle',coalesce(r.public_data->>'cardStyle','glass'),'glow',coalesce((r.public_data->>'glow')::numeric,45),'background',coalesce(r.public_data->>'background','aurora'),'animation',coalesce(r.public_data->>'animation','soft'),'socials',coalesce(r.public_data->'socials','[]'::jsonb),'skills',coalesce(r.public_data->'skills','[]'::jsonb),'badges',coalesce(r.public_data->'badges','[]'::jsonb),'projects',coalesce(r.public_data->'projects','[]'::jsonb),'friends',coalesce(r.public_data->'friends','[]'::jsonb),'followers',coalesce(r.public_data->'followers','[]'::jsonb),'sections',coalesce(r.public_data->'sections','[]'::jsonb),'music',coalesce(r.public_data->'music','{}'::jsonb),'avatarFrame',coalesce(r.public_data->>'avatarFrame','none'),'avatarFrameColor',coalesce(r.public_data->>'avatarFrameColor','#8b5cf6'),'avatarFrameGlow',coalesce((r.public_data->>'avatarFrameGlow')::numeric,35),'avatarFrameWidth',coalesce((r.public_data->>'avatarFrameWidth')::numeric,3),'stats',coalesce(r.public_data->'stats',jsonb_build_object('views',0)),'likes',jsonb_build_object('count',coalesce((r.public_data->'likes'->>'count')::int,0),'users',coalesce(r.public_data->'likes'->'users','[]'::jsonb)),'messagePrivacy',coalesce(r.private_data->'messageSettings'->>'whoCanMessage','everyone'),'callPrivacy',coalesce(r.private_data->'callSettings'->>'whoCanCall','everyone'),'story',case when story_row.id is null then null else jsonb_build_object('active',true,'story_id',story_row.id,'created_at',story_row.created_at,'expires_at',story_row.expires_at) end,'createdAt',r.created_at,'updatedAt',r.updated_at
  );
end;
$$;
revoke all on function public.rivo_get_public_profile(text) from public;
grant execute on function public.rivo_get_public_profile(text) to anon, authenticated;
