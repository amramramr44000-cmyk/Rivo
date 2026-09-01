-- Rivo one-time 1000-coin welcome bonus
-- Safe migration: grants exactly once per profile, on account creation.
-- Also backfills existing profiles exactly once.

create table if not exists public.coin_welcome_bonus_grants (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  amount bigint not null default 1000 check (amount = 1000),
  granted_at timestamptz not null default now()
);

alter table public.coin_welcome_bonus_grants enable row level security;
revoke all on public.coin_welcome_bonus_grants from anon, authenticated;

create or replace function public.rivo_grant_welcome_bonus(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_user uuid;
begin
  if p_user_id is null then
    return;
  end if;

  insert into public.coin_welcome_bonus_grants(user_id, amount)
  values (p_user_id, 1000)
  on conflict (user_id) do nothing
  returning user_id into inserted_user;

  if inserted_user is not null then
    -- Allow only this trusted server-side path to change the protected balance.
    perform set_config('rivo.internal_coin_update', 'on', true);
    update public.profiles
       set coins_balance = coalesce(coins_balance, 0) + 1000,
           updated_at = now()
     where id = p_user_id;
  end if;
end;
$$;
revoke all on function public.rivo_grant_welcome_bonus(uuid) from public;

create or replace function public.rivo_grant_welcome_bonus_on_profile_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.rivo_grant_welcome_bonus(NEW.id);
  return NEW;
end;
$$;
revoke all on function public.rivo_grant_welcome_bonus_on_profile_insert() from public;

drop trigger if exists trg_rivo_grant_welcome_bonus on public.profiles;
create trigger trg_rivo_grant_welcome_bonus
after insert on public.profiles
for each row execute function public.rivo_grant_welcome_bonus_on_profile_insert();

-- One-time backfill for accounts that already exist.
do $$
declare
  r record;
begin
  for r in select id from public.profiles loop
    perform public.rivo_grant_welcome_bonus(r.id);
  end loop;
end;
$$;

select 'Rivo 1000-coin welcome bonus installed' as status;
