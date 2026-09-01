-- Rivo Economy System
-- Run after the existing Rivo schema. Safe to re-run.

create extension if not exists pgcrypto;

alter table public.profiles
  add column if not exists coins_balance bigint not null default 0;

alter table public.profiles
  drop constraint if exists profiles_coins_balance_nonnegative;
alter table public.profiles
  add constraint profiles_coins_balance_nonnegative check (coins_balance >= 0);

create table if not exists public.store_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  type text not null check (type in ('avatar','frame','template','badge','feature')),
  price bigint not null default 0 check (price >= 0),
  image_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists store_items_name_type_uq on public.store_items(lower(name), type);
create index if not exists store_items_active_type_idx on public.store_items(is_active, type, price);

-- Backward-compatible migration for an older v19 database that allowed only four item types.
alter table public.store_items drop constraint if exists store_items_type_check;
alter table public.store_items add constraint store_items_type_check check (type in ('avatar','frame','template','badge','feature'));

create table if not exists public.user_inventory (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  item_id uuid not null references public.store_items(id) on delete cascade,
  purchased_at timestamptz not null default now(),
  is_equipped boolean not null default false,
  unique(user_id, item_id)
);
create index if not exists user_inventory_user_idx on public.user_inventory(user_id, is_equipped, purchased_at desc);

create table if not exists public.coin_transactions (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid references public.profiles(id) on delete set null,
  receiver_id uuid references public.profiles(id) on delete set null,
  amount bigint not null check (amount >= 0),
  type text not null check (type in ('transfer','ad_reward','purchase')),
  item_id uuid references public.store_items(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists coin_transactions_sender_idx on public.coin_transactions(sender_id, created_at desc);
create index if not exists coin_transactions_receiver_idx on public.coin_transactions(receiver_id, created_at desc);

-- Server-side throttle for ad-reward claims. This does not replace a real ad
-- provider's server callback, but prevents an unrestricted RPC farming loop.
create table if not exists public.coin_ad_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  reward_amount bigint not null check (reward_amount between 10 and 25),
  created_at timestamptz not null default now()
);
create index if not exists coin_ad_claims_user_created_idx on public.coin_ad_claims(user_id, created_at desc);

alter table public.store_items enable row level security;
alter table public.user_inventory enable row level security;
alter table public.coin_transactions enable row level security;
alter table public.coin_ad_claims enable row level security;

drop policy if exists "store_items_select_active" on public.store_items;
create policy "store_items_select_active" on public.store_items
for select to anon, authenticated using (is_active = true);

drop policy if exists "user_inventory_select_own" on public.user_inventory;
create policy "user_inventory_select_own" on public.user_inventory
for select to authenticated using (auth.uid() = user_id);

drop policy if exists "coin_transactions_select_own" on public.coin_transactions;
create policy "coin_transactions_select_own" on public.coin_transactions
for select to authenticated using (auth.uid() = sender_id or auth.uid() = receiver_id);

-- No direct client writes to economy tables. RPCs below are the write path.
revoke insert, update, delete on public.store_items from anon, authenticated;
revoke insert, update, delete on public.user_inventory from anon, authenticated;
revoke insert, update, delete on public.coin_transactions from anon, authenticated;
revoke select, insert, update, delete on public.coin_ad_claims from anon, authenticated;
grant select on public.store_items to anon, authenticated;
grant select on public.user_inventory to authenticated;
grant select on public.coin_transactions to authenticated;

create or replace function public.rivo_get_coin_balance()
returns bigint
language sql
security definer
set search_path = public
as $$
  select coins_balance from public.profiles where id = auth.uid();
$$;
revoke all on function public.rivo_get_coin_balance() from public;
grant execute on function public.rivo_get_coin_balance() to authenticated;

create or replace function public.rivo_list_store_items(p_type text default null)
returns setof jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', s.id,
    'name', s.name,
    'description', s.description,
    'type', s.type,
    'price', s.price,
    'image_url', s.image_url,
    'is_active', s.is_active
  )
  from public.store_items s
  where s.is_active = true
    and (p_type is null or s.type = lower(trim(p_type)))
  order by s.price asc, s.created_at asc;
$$;
revoke all on function public.rivo_list_store_items(text) from public;
grant execute on function public.rivo_list_store_items(text) to anon, authenticated;

create or replace function public.rivo_list_my_inventory()
returns setof jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'inventory_id', ui.id,
    'item_id', s.id,
    'name', s.name,
    'description', s.description,
    'type', s.type,
    'price', s.price,
    'image_url', s.image_url,
    'purchased_at', ui.purchased_at,
    'is_equipped', ui.is_equipped
  )
  from public.user_inventory ui
  join public.store_items s on s.id = ui.item_id
  where ui.user_id = auth.uid()
  order by ui.purchased_at desc;
$$;
revoke all on function public.rivo_list_my_inventory() from public;
grant execute on function public.rivo_list_my_inventory() to authenticated;

create or replace function public.purchase_store_item(target_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  item public.store_items;
  balance bigint;
  already_owned boolean;
  new_balance bigint;
begin
  if uid is null then raise exception 'Not authenticated'; end if;

  select * into item
  from public.store_items
  where id = target_item_id and is_active = true
  for update;
  if not found then raise exception 'Store item is unavailable'; end if;

  select exists(
    select 1 from public.user_inventory where user_id = uid and item_id = target_item_id
  ) into already_owned;
  if already_owned then raise exception 'You already own this item'; end if;

  select coins_balance into balance from public.profiles where id = uid for update;
  if balance is null then raise exception 'Profile not found'; end if;
  if balance < item.price then raise exception 'Not enough coins'; end if;

  new_balance := balance - item.price;
  update public.profiles set coins_balance = new_balance, updated_at = now() where id = uid;
  insert into public.user_inventory(user_id, item_id, is_equipped)
  values(uid, item.id, false);
  insert into public.coin_transactions(sender_id, receiver_id, amount, type, item_id)
  values(uid, null, item.price, 'purchase', item.id);

  return jsonb_build_object(
    'item_id', item.id,
    'price', item.price,
    'coins_balance', new_balance
  );
end;
$$;
revoke all on function public.purchase_store_item(uuid) from public;
grant execute on function public.purchase_store_item(uuid) to authenticated;

create or replace function public.transfer_coins_by_username(target_username text, transfer_amount bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  target_id uuid;
  sender_balance bigint;
  receiver_balance bigint;
  new_sender_balance bigint;
  new_receiver_balance bigint;
  lookup text := lower(trim(both '@' from coalesce(target_username, '')));
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if transfer_amount is null or transfer_amount <= 0 then raise exception 'Transfer amount must be greater than 0'; end if;
  if transfer_amount > 1000000000 then raise exception 'Transfer amount is too large'; end if;

  select p.id into target_id
  from public.profiles p
  where lower(p.username) = lookup or lower(p.auth_email) = lookup
  limit 1;
  if target_id is null then raise exception 'Recipient not found'; end if;
  if target_id = uid then raise exception 'You cannot transfer coins to yourself'; end if;

  -- Lock both profiles before reading balances; deterministic ordering avoids
  -- the classic sender/receiver deadlock when two users transfer concurrently.
  perform 1 from public.profiles p where p.id in (uid, target_id) order by p.id for update;
  select coins_balance into sender_balance from public.profiles where id = uid;
  select coins_balance into receiver_balance from public.profiles where id = target_id;

  if sender_balance < transfer_amount then raise exception 'Not enough coins'; end if;
  new_sender_balance := sender_balance - transfer_amount;
  new_receiver_balance := receiver_balance + transfer_amount;

  update public.profiles set coins_balance = new_sender_balance, updated_at = now() where id = uid;
  update public.profiles set coins_balance = new_receiver_balance, updated_at = now() where id = target_id;
  insert into public.coin_transactions(sender_id, receiver_id, amount, type)
  values(uid, target_id, transfer_amount, 'transfer');

  return jsonb_build_object(
    'amount', transfer_amount,
    'coins_balance', new_sender_balance,
    'receiver_id', target_id
  );
end;
$$;
revoke all on function public.transfer_coins_by_username(text, bigint) from public;
grant execute on function public.transfer_coins_by_username(text, bigint) to authenticated;

create or replace function public.reward_ad_coins(reward_amount bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  current_balance bigint;
  new_balance bigint;
  last_claim timestamptz;
  day_claims integer;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  if reward_amount is null or reward_amount < 10 or reward_amount > 25 then raise exception 'Reward must be between 10 and 25 coins'; end if;

  -- Lock the user's profile before checking limits so concurrent reward
  -- requests cannot both pass the cooldown/daily-cap checks.
  select coins_balance into current_balance from public.profiles where id = uid for update;
  if current_balance is null then raise exception 'Profile not found'; end if;

  select max(created_at) into last_claim
  from public.coin_ad_claims where user_id = uid;
  if last_claim is not null and last_claim > now() - interval '30 seconds' then
    raise exception 'Please wait before claiming another ad reward';
  end if;

  select count(*)::int into day_claims
  from public.coin_ad_claims
  where user_id = uid and created_at >= date_trunc('day', now());
  if day_claims >= 20 then raise exception 'Daily ad reward limit reached'; end if;

  new_balance := current_balance + reward_amount;

  update public.profiles set coins_balance = new_balance, updated_at = now() where id = uid;
  insert into public.coin_ad_claims(user_id, reward_amount) values(uid, reward_amount);
  insert into public.coin_transactions(sender_id, receiver_id, amount, type)
  values(null, uid, reward_amount, 'ad_reward');

  return jsonb_build_object('reward', reward_amount, 'coins_balance', new_balance);
end;
$$;
revoke all on function public.reward_ad_coins(bigint) from public;
grant execute on function public.reward_ad_coins(bigint) to authenticated;

create or replace function public.equip_store_item(target_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  inv public.user_inventory;
  item public.store_items;
begin
  if uid is null then raise exception 'Not authenticated'; end if;
  select ui.id, ui.user_id, ui.item_id, ui.purchased_at, ui.is_equipped into inv
  from public.user_inventory ui
  where ui.user_id = uid and ui.item_id = target_item_id
  for update;
  select * into item from public.store_items where id = target_item_id and is_active = true;
  if inv.id is null or item.id is null then raise exception 'You do not own this item'; end if;

  if item.type in ('frame','avatar','template') then
    update public.user_inventory ui
    set is_equipped = false
    from public.store_items s
    where ui.user_id = uid and ui.item_id = s.id and s.type = item.type;
  end if;

  update public.user_inventory set is_equipped = not is_equipped
  where id = inv.id;

  return jsonb_build_object('item_id', item.id, 'type', item.type);
end;
$$;
revoke all on function public.equip_store_item(uuid) from public;
grant execute on function public.equip_store_item(uuid) to authenticated;

-- Public profiles expose only equipped cosmetic items, never the inventory.
-- Public profile RPC is finalized by the latest profile migration.
-- Keep the economy migration focused on economy tables/RPCs so rerunning it
-- cannot accidentally overwrite Story, followers, calls, or equipped cosmetics.


-- Editor-unlock catalogue. These items are surfaced inside the profile editor,
-- not through a separate storefront. Ownership unlocks the corresponding editor option.
insert into public.store_items (name, description, type, price, image_url, is_active)
values
  ('Starter Avatar', 'Basic avatar option.', 'avatar', 0, null, true),
  ('Starter Frame', 'Basic clean avatar frame.', 'frame', 0, null, true),
  ('Starter Badge', 'Basic starter badge.', 'badge', 0, null, true),

  ('Frame · Ring', 'Accent outline frame.', 'frame', 75, null, true),
  ('Frame · Double', 'Layered premium frame.', 'frame', 120, null, true),
  ('Frame · Diamond', 'Sharp diamond frame.', 'frame', 180, null, true),
  ('Frame · Glow', 'Soft luminous halo.', 'frame', 250, null, true),
  ('Frame · Scan', 'Animated scan frame.', 'frame', 350, null, true),
  ('Frame · Hologram', 'Glass hologram frame.', 'frame', 600, null, true),
  ('Frame · Orbit', 'Orbiting satellite frame.', 'frame', 800, null, true),
  ('Frame · Prism', 'Faceted prism frame.', 'frame', 1000, null, true),
  ('Frame · Starburst', 'Stellar burst frame.', 'frame', 1500, null, true),
  ('Frame · Halo', 'Soft orbital crown.', 'frame', 1800, null, true),
  ('Frame · Ribbon', 'Layered side sweep.', 'frame', 2200, null, true),
  ('Frame · Circuit', 'Tech circuit frame.', 'frame', 2600, null, true),
  ('Frame · Lattice', 'Geometric mesh frame.', 'frame', 3200, null, true),

  ('Badge · Developer', 'Developer profile badge.', 'badge', 100, null, true),
  ('Badge · Creator', 'Creator profile badge.', 'badge', 120, null, true),
  ('Badge · Gamer', 'Gamer profile badge.', 'badge', 80, null, true),
  ('Badge · Early User', 'Early supporter badge.', 'badge', 250, null, true),
  ('Badge · VIP', 'VIP cosmetic badge.', 'badge', 500, null, true),
  ('Badge · Top Creator', 'Rare creator badge.', 'badge', 1500, null, true),
  ('Badge · Trusted', 'Trusted member badge.', 'badge', 800, null, true),

  ('Template · Discord Noir', 'Core Rivo social HUD.', 'template', 0, null, true),
  ('Template · Anime Cinema', 'Cinematic editorial profile.', 'template', 450, null, true),
  ('Template · Neon Arena', 'Competitive luminous profile.', 'template', 700, null, true),
  ('Template · Cyber Terminal', 'Technical console profile.', 'template', 900, null, true),
  ('Template · Dark Luxury', 'Luxury obsidian profile.', 'template', 1200, null, true),
  ('Template · Minimal Ice', 'Ultra-clean precision profile.', 'template', 1400, null, true),
  ('Template · Samurai Ink', 'Ink poster profile.', 'template', 1700, null, true),
  ('Template · Deep Space', 'Cosmic depth profile.', 'template', 1900, null, true),
  ('Template · Creator Pulse', 'Media-first creator profile.', 'template', 2200, null, true),
  ('Template · Monochrome Pro', 'Executive grayscale profile.', 'template', 2500, null, true),
  ('Template · Starlight Royal', 'Constellation profile.', 'template', 3000, null, true),
  ('Template · Aurora Glass', 'Crystalline aurora profile.', 'template', 3500, null, true),
  ('Template · Obsidian Court', 'Luxury court profile.', 'template', 5000, null, true),
  ('Template · Pixel Arcade', 'Retro arcade profile.', 'template', 2800, null, true),
  ('Template · Botanical Night', 'Night garden profile.', 'template', 2400, null, true),
  ('Template · White Atelier', 'Editorial white profile.', 'template', 3200, null, true),
  ('Template · White Signal', 'Crisp white tech profile.', 'template', 3600, null, true),

  ('Template · Card Style Glass', 'Glass card surface.', 'template', 0, null, true),
  ('Template · Card Style Solid', 'Strong solid card surface.', 'template', 100, null, true),
  ('Template · Card Style Outline', 'Clean outlined card surface.', 'template', 150, null, true),
  ('Template · Card Style Poster', 'Cinematic poster card surface.', 'template', 250, null, true),
  ('Template · Card Style Terminal', 'Technical terminal card surface.', 'template', 300, null, true),
  ('Template · Card Style Frosted', 'Crystal frosted card surface.', 'template', 350, null, true),
  ('Template · Card Style Notched', 'Cut-corner card surface.', 'template', 450, null, true),
  ('Template · Card Style Frame', 'Gallery frame card surface.', 'template', 550, null, true),
  ('Template · Card Style Aurora', 'Aurora glow card surface.', 'template', 700, null, true),
  ('Template · Card Style Starfield', 'Night sky card surface.', 'template', 800, null, true),
  ('Template · Card Style Paper', 'Editorial paper card surface.', 'template', 900, null, true),
  ('Template · Card Style Split', 'Dual-surface card layout.', 'template', 1000, null, true),
  ('Template · Card Style Ticket', 'Notched ticket card surface.', 'template', 1200, null, true),

  ('Feature · Avatar Upload', 'Unlock custom avatar uploads.', 'feature', 150, null, true),
  ('Feature · Banner Upload', 'Unlock custom profile banner uploads.', 'feature', 200, null, true),
  ('Feature · Floating Image', 'Unlock your floating profile image.', 'feature', 250, null, true),
  ('Feature · Profile Music', 'Unlock profile music and audio.', 'feature', 500, null, true),
  ('Feature · Music Cover', 'Unlock custom music cover art.', 'feature', 150, null, true),
  ('Feature · Custom Accent', 'Unlock custom accent colors.', 'feature', 120, null, true),
  ('Feature · Radius Control', 'Unlock advanced card radius control.', 'feature', 100, null, true),
  ('Feature · Glow Control', 'Unlock advanced glow control.', 'feature', 180, null, true),
  ('Feature · Social Links', 'Unlock custom social links.', 'feature', 100, null, true),
  ('Feature · Profile Sections', 'Unlock advanced profile section controls.', 'feature', 300, null, true)
on conflict (lower(name), type) do update set
  description = excluded.description,
  price = excluded.price,
  image_url = excluded.image_url,
  is_active = excluded.is_active;

-- ================================================================
-- Server-side anti-bypass protection for paid editor cosmetics.
-- A client may update public_data, so paid values must be validated on
-- the database too; otherwise a modified browser could unlock badges,
-- frames, templates or media features without spending coins.
-- ================================================================
create or replace function public.rivo_inventory_owned_by_name(p_user_id uuid, p_name text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_inventory ui
    join public.store_items si on si.id = ui.item_id
    where ui.user_id = p_user_id
      and si.is_active = true
      and lower(si.name) = lower(trim(p_name))
  );
$$;
revoke all on function public.rivo_inventory_owned_by_name(uuid,text) from public;


create or replace function public.rivo_validate_paid_profile_data()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := coalesce(auth.uid(), NEW.id);
  value text;
  badge_name text;
  template_name text;
  frame_name text;
  old_data jsonb;
  new_data jsonb := coalesce(NEW.public_data, '{}'::jsonb);
begin
  old_data := case when TG_OP = 'UPDATE' then coalesce(OLD.public_data, '{}'::jsonb) else '{}'::jsonb end;

  -- Existing trusted/verification badges are system-controlled and remain valid.
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

  -- Premium profile templates.
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

  -- Premium card surfaces.
  value := coalesce(new_data->>'cardStyle','glass');
  if value <> 'glass' and not public.rivo_inventory_owned_by_name(uid, 'Template · Card Style ' || initcap(value)) then
    raise exception 'This card style is not owned';
  end if;

  -- Premium avatar frames.
  value := coalesce(new_data->>'avatarFrame','none');
  if value <> 'none' then
    frame_name := 'Frame · ' || initcap(value);
    if not public.rivo_inventory_owned_by_name(uid, frame_name) then
      raise exception 'This frame is not owned';
    end if;
  end if;

  -- Feature-gated media. Only a transition to non-empty custom data requires ownership.
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

  -- Advanced visual controls.
  if (new_data ? 'accent') and coalesce(new_data->>'accent','#7488ff') <> coalesce(old_data->>'accent','#7488ff')
     and coalesce(new_data->>'accent','#7488ff') <> '#7488ff'
     and not public.rivo_inventory_owned_by_name(uid,'Feature · Custom Accent') then raise exception 'Custom accent feature is not owned'; end if;
  if (new_data ? 'cardRadius') and coalesce((new_data->>'cardRadius')::numeric,22) <> coalesce((old_data->>'cardRadius')::numeric,22)
     and not public.rivo_inventory_owned_by_name(uid,'Feature · Radius Control') then raise exception 'Radius control feature is not owned'; end if;
  if (new_data ? 'glow') and coalesce((new_data->>'glow')::numeric,40) <> coalesce((old_data->>'glow')::numeric,40)
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
