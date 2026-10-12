-- Rivo Spotify Now Playing presence v1
-- Apply once on Staging first, then on the intended database. OAuth refresh tokens
-- are stored only in rivo_spotify_connections, which has no client-role grants.

begin;

create table if not exists public.rivo_spotify_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null check (char_length(username) between 1 and 26),
  refresh_token text not null,
  show_on_profile boolean not null default false,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists rivo_spotify_connections_username_uidx
  on public.rivo_spotify_connections (lower(username));
alter table public.rivo_spotify_connections enable row level security;
revoke all on table public.rivo_spotify_connections from public, anon, authenticated;
grant all on table public.rivo_spotify_connections to service_role;
comment on table public.rivo_spotify_connections is
  'Private Spotify OAuth connection data. Refresh tokens are accessible only to the service-role Edge Function; never expose this table via client APIs.';

create table if not exists public.rivo_spotify_presence (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null check (char_length(username) between 1 and 26),
  show_on_profile boolean not null default false,
  is_playing boolean not null default false,
  track_id text,
  track_name text,
  artist_names text,
  album_name text,
  album_art_url text,
  track_url text,
  spotify_uri text,
  progress_ms integer,
  duration_ms integer,
  updated_at timestamptz not null default now(),
  constraint rivo_spotify_progress_nonnegative check (progress_ms is null or progress_ms >= 0),
  constraint rivo_spotify_duration_nonnegative check (duration_ms is null or duration_ms >= 0)
);
create index if not exists rivo_spotify_presence_username_idx
  on public.rivo_spotify_presence (lower(username));
create index if not exists rivo_spotify_presence_public_live_idx
  on public.rivo_spotify_presence (lower(username), updated_at desc)
  where show_on_profile is true and is_playing is true;

alter table public.rivo_spotify_presence enable row level security;
revoke all on table public.rivo_spotify_presence from public;
grant select on table public.rivo_spotify_presence to anon, authenticated;
revoke insert, update, delete on table public.rivo_spotify_presence from anon, authenticated, public;
grant all on table public.rivo_spotify_presence to service_role;

drop policy if exists rivo_spotify_presence_read_visible on public.rivo_spotify_presence;
create policy rivo_spotify_presence_read_visible
  on public.rivo_spotify_presence
  for select to anon, authenticated
  using (
    auth.uid() = user_id
    or (
      show_on_profile is true
      and is_playing is true
      and updated_at > now() - interval '90 seconds'
    )
  );
drop policy if exists rivo_spotify_presence_insert_owner on public.rivo_spotify_presence;
drop policy if exists rivo_spotify_presence_update_owner on public.rivo_spotify_presence;
drop policy if exists rivo_spotify_presence_delete_owner on public.rivo_spotify_presence;
comment on table public.rivo_spotify_presence is
  'Public Spotify now-playing metadata only. Public reads are restricted to opted-in, actively playing rows refreshed within 90 seconds. OAuth tokens never belong in this table.';

commit;
