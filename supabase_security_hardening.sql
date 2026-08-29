-- Rivo security hardening: server-side signup CAPTCHA challenges
-- Run this once in Supabase SQL Editor before deploying the new Edge Functions.

create extension if not exists pgcrypto;

create table if not exists public.rivo_captcha_challenges (
  id uuid primary key,
  code_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  verified_at timestamptz,
  verification_token_hash text,
  attempts integer not null default 0 check (attempts >= 0 and attempts <= 5),
  ip_hash text not null
);

alter table public.rivo_captcha_challenges add column if not exists verified_at timestamptz;
alter table public.rivo_captcha_challenges add column if not exists verification_token_hash text;

create index if not exists rivo_captcha_created_idx on public.rivo_captcha_challenges(created_at desc);
create index if not exists rivo_captcha_ip_idx on public.rivo_captcha_challenges(ip_hash, created_at desc);

alter table public.rivo_captcha_challenges enable row level security;
revoke all on table public.rivo_captcha_challenges from anon, authenticated;

-- Do not expose the challenge table to browser clients. The Edge Functions use
-- the server-only service_role key and therefore bypass these RLS restrictions.

-- Keep direct profile lookup protected. Signup is performed by the Edge Function.
-- Existing application RPCs and profile RLS are intentionally left unchanged.

-- Cleanup old challenges; safe to run periodically from a scheduled job if desired.
delete from public.rivo_captcha_challenges
where expires_at < now() - interval '1 day';


-- Prevent an authenticated user from enumerating members of communities they have not joined.
create or replace function public.rivo_list_community_members(p_id bigint)
returns setof jsonb language sql security definer set search_path=public as $$
select jsonb_build_object('username',p.username,'displayName',coalesce(p.public_data->>'displayName',p.username),'avatar',coalesce(p.public_data->>'avatar',''),'role',m.role)
from public.rivo_community_members m
join public.profiles p on p.id=m.user_id
where m.community_id=p_id
  and exists (select 1 from public.rivo_community_members me where me.community_id=p_id and me.user_id=auth.uid())
order by m.role desc,m.joined_at asc;
$$;
revoke all on function public.rivo_list_community_members(bigint) from public;
grant execute on function public.rivo_list_community_members(bigint) to authenticated;


-- The browser no longer needs username existence checks; the secure signup Edge Function performs them with service_role.
revoke all on function public.rivo_username_exists(text) from public;
