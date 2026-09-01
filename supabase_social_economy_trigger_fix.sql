-- Rivo social/economy trigger fix
-- Run this AFTER supabase_economy.sql on an existing Supabase project.
-- Fixes the 'This badge is not owned' toast/error when following, unfollowing,
-- adding/removing friends, or otherwise changing unrelated public_data fields.

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
    if value <> 'glass' and not public.rivo_inventory_owned_by_name(uid, 'Template · Card Style ' || initcap(value)) then
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
  if coalesce(new_data->'music','{}'::jsonb) <> coalesce(old_data->'music','{}'::jsonb)
     and coalesce(new_data->'music','{}'::jsonb) <> '{}'::jsonb
     and not public.rivo_inventory_owned_by_name(uid,'Feature · Profile Music') then raise exception 'Profile music feature is not owned'; end if;
  if coalesce(new_data->'music'->>'cover','') <> coalesce(old_data->'music'->>'cover','') and coalesce(new_data->'music'->>'cover','') <> ''
     and not public.rivo_inventory_owned_by_name(uid,'Feature · Music Cover') then raise exception 'Music cover feature is not owned'; end if;

  if (new_data ? 'accent') and coalesce(new_data->>'accent','#7488ff') <> coalesce(old_data->>'accent','#7488ff')
     and coalesce(new_data->>'accent','#7488ff') <> '#7488ff'
     and not public.rivo_inventory_owned_by_name(uid,'Feature · Custom Accent') then raise exception 'Custom accent feature is not owned'; end if;
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

select 'Rivo social/economy trigger fix installed' as status;
