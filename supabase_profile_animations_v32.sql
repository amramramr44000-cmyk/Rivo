-- Rivo V32: adds three more independent Profile Animations.
-- Safe to run after the fixed V31 migration. Existing ownership and Avatar Frames stay unchanged.

insert into public.store_items (name, description, type, price, image_url, is_active)
select v.name, v.description, 'feature', v.price, null, true
from (values
  ('Feature · Profile Animation · Pure Rainfall', 'Fine transparent rain streaks that move over the profile without tinting the template.', 8200::bigint),
  ('Feature · Profile Animation · Autumn Leaves', 'Layered drifting leaves with natural rotation and soft depth.', 9800::bigint),
  ('Feature · Profile Animation · Frost Spark', 'Delicate crystal snow sparks that fade and reappear around the profile.', 10800::bigint)
) as v(name, description, price)
where not exists (
  select 1 from public.store_items s
  where lower(s.name)=lower(v.name) and s.type='feature'
);

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
  template_accent text;
  social_slot_count integer := 0;
  old_social_count integer := 0;
  new_social_count integer := 0;
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

  if TG_OP = 'INSERT' or new_data->>'animation' is distinct from old_data->>'animation' then
    value := coalesce(new_data->>'animation','none');
    if value not in ('none','soft') then
      value := case value
        when 'rain' then 'Rainfall'
        when 'lightning' then 'Lightning'
        when 'clouds' then 'Cloud Drift'
        when 'money' then 'Moneyfall'
        when 'ocean' then 'Ocean Waves'
        when 'aurora' then 'Royal Aurora'
        when 'rainfall' then 'Pure Rainfall'
        when 'leaves' then 'Autumn Leaves'
        when 'frost' then 'Frost Spark'
        else null
      end;
      if value is null or not public.rivo_inventory_owned_by_name(uid,'Feature · Profile Animation · ' || value) then
        raise exception 'This profile animation is not owned';
      end if;
    end if;
  end if;

  if coalesce(new_data->>'avatar','') <> coalesce(old_data->>'avatar','')
     and coalesce(new_data->>'avatar','') <> ''
     and not public.rivo_inventory_owned_by_name(uid,'Feature · Avatar Upload') then
    raise exception 'Avatar upload feature is not owned';
  end if;

  if coalesce(new_data->>'banner','') <> coalesce(old_data->>'banner','')
     and coalesce(new_data->>'banner','') <> ''
     and not public.rivo_inventory_owned_by_name(uid,'Feature · Banner Upload') then
    raise exception 'Banner upload feature is not owned';
  end if;

  if coalesce(new_data->>'miniImage','') <> coalesce(old_data->>'miniImage','')
     and coalesce(new_data->>'miniImage','') <> ''
     and not public.rivo_inventory_owned_by_name(uid,'Feature · Floating Image') then
    raise exception 'Floating image feature is not owned';
  end if;

  if coalesce(new_data->'music'->>'audio','') <> coalesce(old_data->'music'->>'audio','')
     and coalesce(new_data->'music'->>'audio','') <> ''
     and not public.rivo_inventory_owned_by_name(uid,'Feature · Profile Music') then
    raise exception 'Profile music feature is not owned';
  end if;

  if coalesce(new_data->'music'->>'cover','') <> coalesce(old_data->'music'->>'cover','')
     and coalesce(new_data->'music'->>'cover','') <> ''
     and not public.rivo_inventory_owned_by_name(uid,'Feature · Music Cover') then
    raise exception 'Music cover feature is not owned';
  end if;

  template_accent := case coalesce(new_data->>'template','discord-noir')
    when 'discord-noir' then '#7488ff'
    when 'anime-cinema' then '#ff6fb0'
    when 'neon-arena' then '#55d6ff'
    when 'cyber-terminal' then '#38ff9b'
    when 'dark-luxury' then '#f4c879'
    when 'minimal-ice' then '#d9efff'
    when 'samurai-ink' then '#ff5f72'
    when 'deep-space' then '#9a86ff'
    when 'creator-pulse' then '#f26eea'
    when 'monochrome-pro' then '#f4f5f7'
    when 'starlight-royal' then '#b9a7ff'
    when 'aurora-glass' then '#67e8f9'
    when 'obsidian-court' then '#f0b65b'
    when 'pixel-arcade' then '#7dff8d'
    when 'botanical-night' then '#79d79a'
    when 'white-atelier' then '#172033'
    when 'white-signal' then '#3157ff'
    else '#7488ff'
  end;

  if (new_data ? 'accent')
     and lower(trim(coalesce(new_data->>'accent','#7488ff'))) <> lower(trim(coalesce(old_data->>'accent','#7488ff')))
     and lower(trim(coalesce(new_data->>'accent','#7488ff'))) <> lower(trim(template_accent))
     and not public.rivo_inventory_owned_by_name(uid,'Feature · Custom Accent') then
    raise exception 'Custom accent feature is not owned';
  end if;

  if TG_OP = 'UPDATE' and new_data ? 'cardRadius'
     and coalesce((new_data->>'cardRadius')::numeric,24) <> coalesce((old_data->>'cardRadius')::numeric,24)
     and not public.rivo_inventory_owned_by_name(uid,'Feature · Radius Control') then
    raise exception 'Radius control feature is not owned';
  end if;

  if TG_OP = 'UPDATE' and new_data ? 'glow'
     and coalesce((new_data->>'glow')::numeric,45) <> coalesce((old_data->>'glow')::numeric,45)
     and not public.rivo_inventory_owned_by_name(uid,'Feature · Glow Control') then
    raise exception 'Glow control feature is not owned';
  end if;

  if TG_OP = 'INSERT' or new_data->'socials' is distinct from old_data->'socials' then
    old_social_count := jsonb_array_length(coalesce(old_data->'socials','[]'::jsonb));
    new_social_count := jsonb_array_length(coalesce(new_data->'socials','[]'::jsonb));
    select coalesce(purchased_slots, 0) into social_slot_count
      from public.user_social_link_slots where user_id = uid;
    social_slot_count := coalesce(social_slot_count, 0);

    if new_social_count > 0 and old_social_count = 0
       and not public.rivo_inventory_owned_by_name(uid,'Feature · Social Links') then
      raise exception 'Social links feature is not owned';
    end if;

    if new_social_count > old_social_count
       and new_social_count > 5 + social_slot_count then
      raise exception 'Additional social link slot is not owned';
    end if;

    if TG_OP = 'INSERT' and new_social_count > 5 + social_slot_count then
      raise exception 'Additional social link slot is not owned';
    end if;
  end if;

  return NEW;
end;
$$;

notify pgrst, 'reload schema';
