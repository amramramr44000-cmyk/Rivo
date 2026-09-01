-- Rivo FINAL: signup creation + follower persistence fix
-- Run this file LAST after the current Rivo schema/economy/social migrations.
-- Safe to run repeatedly.

-- 1) Creating a normal profile must not require paid Radius/Glow inventory.
--    The free defaults are radius=24 and glow=45. Premium checks only apply
--    when an existing account changes those values away from their defaults.
create or replace function public.rivo_validate_paid_profile_data()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := NEW.id;
  value text;
  badge_name text;
  template_name text;
  frame_name text;
  old_data jsonb;
  new_data jsonb := coalesce(NEW.public_data, '{}'::jsonb);
begin
  old_data := case when TG_OP = 'UPDATE' then coalesce(OLD.public_data, '{}'::jsonb) else '{}'::jsonb end;

  if TG_OP = 'INSERT' or new_data->'badges' is distinct from old_data->'badges' then
    for value in select jsonb_array_elements_text(coalesce(new_data->'badges','[]'::jsonb)) loop
      if value in ('verified','founder') then continue; end if;
      badge_name := case value
        when 'developer' then 'Badge · Developer'
        when 'creator' then 'Badge · Creator'
        when 'gamer' then 'Badge · Gamer'
        when 'early' then 'Badge · Early User'
        when 'vip' then 'Badge · VIP'
        when 'top' then 'Badge · Top Creator'
        when 'trusted' then 'Badge · Trusted'
        else null
      end;
      if badge_name is null or not public.rivo_inventory_owned_by_name(uid, badge_name) then
        raise exception 'This badge is not owned';
      end if;
    end loop;
  end if;

  if TG_OP = 'INSERT' or new_data->>'template' is distinct from old_data->>'template' then
    value := coalesce(new_data->>'template','discord-noir');
    template_name := case value
      when 'discord-noir' then null
      when 'anime-cinema' then 'Template · Anime Cinema'
      when 'neon-arena' then 'Template · Neon Arena'
      when 'cyber-terminal' then 'Template · Cyber Terminal'
      when 'dark-luxury' then 'Template · Dark Luxury'
      when 'minimal-ice' then 'Template · Minimal Ice'
      when 'samurai-ink' then 'Template · Samurai Ink'
      when 'deep-space' then 'Template · Deep Space'
      when 'creator-pulse' then 'Template · Creator Pulse'
      when 'monochrome-pro' then 'Template · Monochrome Pro'
      when 'starlight-royal' then 'Template · Starlight Royal'
      when 'aurora-glass' then 'Template · Aurora Glass'
      when 'obsidian-court' then 'Template · Obsidian Court'
      when 'pixel-arcade' then 'Template · Pixel Arcade'
      when 'botanical-night' then 'Template · Botanical Night'
      when 'white-atelier' then 'Template · White Atelier'
      when 'white-signal' then 'Template · White Signal'
      else null
    end;
    if value <> 'discord-noir' and (template_name is null or not public.rivo_inventory_owned_by_name(uid, template_name)) then
      raise exception 'This template is not owned';
    end if;
  end if;

  if TG_OP = 'INSERT' or new_data->>'cardStyle' is distinct from old_data->>'cardStyle' then
    value := coalesce(new_data->>'cardStyle','glass');
    if value <> 'glass' and not public.rivo_inventory_owned_by_name(uid,'Template · Card Style ' || initcap(value)) then
      raise exception 'This card style is not owned';
    end if;
  end if;

  if TG_OP = 'INSERT' or new_data->>'avatarFrame' is distinct from old_data->>'avatarFrame' then
    value := coalesce(new_data->>'avatarFrame','none');
    if value <> 'none' then
      frame_name := 'Frame · ' || initcap(value);
      if not public.rivo_inventory_owned_by_name(uid, frame_name) then
        raise exception 'This frame is not owned';
      end if;
    end if;
  end if;

  if coalesce(new_data->>'avatar','') <> coalesce(old_data->>'avatar','') and coalesce(new_data->>'avatar','') <> ''
     and not public.rivo_inventory_owned_by_name(uid,'Feature · Avatar Upload') then raise exception 'Avatar upload feature is not owned'; end if;
  if coalesce(new_data->>'banner','') <> coalesce(old_data->>'banner','') and coalesce(new_data->>'banner','') <> ''
     and not public.rivo_inventory_owned_by_name(uid,'Feature · Banner Upload') then raise exception 'Banner upload feature is not owned'; end if;
  if coalesce(new_data->>'miniImage','') <> coalesce(old_data->>'miniImage','') and coalesce(new_data->>'miniImage','') <> ''
     and not public.rivo_inventory_owned_by_name(uid,'Feature · Floating Image') then raise exception 'Floating image feature is not owned'; end if;
  if coalesce(new_data->'music'->>'audio','') <> coalesce(old_data->'music'->>'audio','')
     and coalesce(new_data->'music'->>'audio','') <> ''
     and not public.rivo_inventory_owned_by_name(uid,'Feature · Profile Music') then raise exception 'Profile music feature is not owned'; end if;
  if coalesce(new_data->'music'->>'cover','') <> coalesce(old_data->'music'->>'cover','') and coalesce(new_data->'music'->>'cover','') <> ''
     and not public.rivo_inventory_owned_by_name(uid,'Feature · Music Cover') then raise exception 'Music cover feature is not owned'; end if;
  if (new_data ? 'accent') and coalesce(new_data->>'accent','#7488ff') <> coalesce(old_data->>'accent','#7488ff')
     and coalesce(new_data->>'accent','#7488ff') <> '#7488ff'
     and not public.rivo_inventory_owned_by_name(uid,'Feature · Custom Accent') then raise exception 'Custom accent feature is not owned'; end if;

  -- IMPORTANT: do not run this on INSERT. Signup creates cardRadius=24 by default.
  if TG_OP = 'UPDATE' and new_data ? 'cardRadius'
     and coalesce((new_data->>'cardRadius')::numeric,24) <> coalesce((old_data->>'cardRadius')::numeric,24)
     and not public.rivo_inventory_owned_by_name(uid,'Feature · Radius Control') then raise exception 'Radius control feature is not owned'; end if;
  if TG_OP = 'UPDATE' and new_data ? 'glow'
     and coalesce((new_data->>'glow')::numeric,45) <> coalesce((old_data->>'glow')::numeric,45)
     and not public.rivo_inventory_owned_by_name(uid,'Feature · Glow Control') then raise exception 'Glow control feature is not owned'; end if;

  if jsonb_array_length(coalesce(new_data->'socials','[]'::jsonb)) > 0
     and jsonb_array_length(coalesce(old_data->'socials','[]'::jsonb)) = 0
     and not public.rivo_inventory_owned_by_name(uid,'Feature · Social Links') then raise exception 'Social links feature is not owned'; end if;
  return NEW;
end;
$$;
revoke all on function public.rivo_validate_paid_profile_data() from public;
drop trigger if exists trg_rivo_validate_paid_profile_data on public.profiles;
create trigger trg_rivo_validate_paid_profile_data
before insert or update of public_data on public.profiles
for each row execute function public.rivo_validate_paid_profile_data();

-- 2) Canonical follower source: any profile whose following array contains
--    this username. This makes refresh/reopen show the real value.
create or replace function public.rivo_get_public_profile(p_username text)
returns jsonb
language plpgsql security definer set search_path=public
as $$
declare r public.profiles; follower_names jsonb; follower_count int; story_row public.rivo_stories;
begin
  perform public.rivo_cleanup_expired_stories();
  select * into r from public.profiles where username=lower(trim(both '@' from p_username)) limit 1;
  if not found then return null; end if;
  select coalesce(jsonb_agg(p.username order by p.username),'[]'::jsonb), count(*)::int
    into follower_names, follower_count
  from public.profiles p
  where coalesce(p.public_data->'following','[]'::jsonb) ? r.username;
  select * into story_row from public.rivo_stories where user_id=r.id and expires_at > now() and media_type like 'image/%' order by created_at desc limit 1;
  return jsonb_build_object(
    'userId',r.id,'username',r.username,'displayName',coalesce(r.public_data->>'displayName',r.username),
    'bio',coalesce(r.public_data->>'bio',''),'description',coalesce(r.public_data->>'description',''),
    'location',coalesce(r.public_data->>'location',''),'website',coalesce(r.public_data->>'website',''),
    'avatar',coalesce(r.public_data->>'avatar',''),'banner',coalesce(r.public_data->>'banner',''),
    'miniImage',coalesce(r.public_data->>'miniImage',''),'status',coalesce(r.public_data->>'status','Online'),
    'customStatus',coalesce(r.public_data->>'customStatus',''),'theme',coalesce(r.public_data->>'theme','obsidian'),
    'template',coalesce(r.public_data->>'template','discord-noir'),'accent',coalesce(r.public_data->>'accent','#7488ff'),
    'cardRadius',coalesce((r.public_data->>'cardRadius')::numeric,24),'cardStyle',coalesce(r.public_data->>'cardStyle','glass'),
    'glow',coalesce((r.public_data->>'glow')::numeric,45),'background',coalesce(r.public_data->>'background','aurora'),
    'animation',coalesce(r.public_data->>'animation','soft'),'socials',coalesce(r.public_data->'socials','[]'::jsonb),
    'skills',coalesce(r.public_data->'skills','[]'::jsonb),'badges',coalesce(r.public_data->'badges','[]'::jsonb),
    'projects',coalesce(r.public_data->'projects','[]'::jsonb),'friends',coalesce(r.public_data->'friends','[]'::jsonb),
    'followers',follower_names,'followersCount',follower_count,
    'sections',coalesce(r.public_data->'sections','[]'::jsonb),'music',coalesce(r.public_data->'music','{}'::jsonb),
    'avatarFrame',coalesce(r.public_data->>'avatarFrame','none'),'avatarFrameColor',coalesce(r.public_data->>'avatarFrameColor','#8b5cf6'),
    'avatarFrameGlow',coalesce((r.public_data->>'avatarFrameGlow')::numeric,35),'avatarFrameWidth',coalesce((r.public_data->>'avatarFrameWidth')::numeric,3),
    'stats',coalesce(r.public_data->'stats',jsonb_build_object('views',0)),
    'likes',jsonb_build_object('count',coalesce((r.public_data->'likes'->>'count')::int,0),'users',coalesce(r.public_data->'likes'->'users','[]'::jsonb)),
    'messagePrivacy',coalesce(r.private_data->'messageSettings'->>'whoCanMessage','everyone'),
    'callPrivacy',coalesce(r.private_data->'callSettings'->>'whoCanCall','everyone'),
    'story',case when story_row.id is null then null else jsonb_build_object('active',true,'story_id',story_row.id,'created_at',story_row.created_at,'expires_at',story_row.expires_at) end,
    'createdAt',r.created_at,'updatedAt',r.updated_at
  );
end;
$$;
revoke all on function public.rivo_get_public_profile(text) from public;
grant execute on function public.rivo_get_public_profile(text) to anon, authenticated;

-- 3) Follow/unfollow writes both sides and returns the authoritative post-write count.
create or replace function public.rivo_toggle_follow(p_target_username text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me public.profiles; target public.profiles; following jsonb; followers jsonb; now_following boolean; follower_count int;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  perform set_config('rivo.internal_profile_save','on',true);
  select * into me from public.profiles where id=auth.uid() for update;
  if not found then raise exception 'Not signed in'; end if;
  if me.is_banned then raise exception 'Your account is blocked'; end if;
  select * into target from public.profiles where username=lower(trim(both '@' from p_target_username)) for update;
  if not found then raise exception 'User not found'; end if;
  if target.is_banned then raise exception 'This account is unavailable'; end if;
  if me.id=target.id then raise exception 'You cannot follow yourself'; end if;

  following:=coalesce(me.public_data->'following','[]'::jsonb);
  if following ? target.username then
    select coalesce(jsonb_agg(v order by v),'[]'::jsonb) into following from jsonb_array_elements(following) v where v <> to_jsonb(target.username);
    now_following:=false;
  else
    following:=following || to_jsonb(target.username); now_following:=true;
  end if;

  update public.profiles set public_data=jsonb_set(coalesce(public_data,'{}'::jsonb),'{following}',following,true),updated_at=now() where id=me.id;

  -- Recompute the target's followers from the graph, avoiding stale cached arrays.
  select coalesce(jsonb_agg(p.username order by p.username),'[]'::jsonb), count(*)::int into followers,follower_count
  from public.profiles p
  where coalesce(
    case when p.id=me.id then jsonb_set(coalesce(p.public_data,'{}'::jsonb),'{following}',following,true) else p.public_data end->'following','[]'::jsonb
  ) ? target.username;

  update public.profiles set public_data=jsonb_set(coalesce(public_data,'{}'::jsonb),'{followers}',followers,true),updated_at=now() where id=target.id;
  return jsonb_build_object('following',now_following,'followers_count',follower_count);
end;
$$;
revoke all on function public.rivo_toggle_follow(text) from public;
grant execute on function public.rivo_toggle_follow(text) to authenticated;

select 'Rivo final signup/follow fix installed' as status;
