-- Rivo signup CAPTCHA storage
-- Run once in Supabase SQL Editor before deploying the CAPTCHA Edge Function.

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

delete from public.rivo_captcha_challenges
where expires_at < now() - interval '1 day';
