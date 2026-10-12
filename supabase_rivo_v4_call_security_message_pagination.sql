-- Rivo Hub v4: secured direct-call sessions + keyset-paginated private-message history.
-- Apply on staging first. Does not modify existing user messages or profile rows.

begin;

-- Stop before making changes if the prerequisite private-messaging migration
-- was not installed completely. The transaction then rolls back cleanly.
do $preflight$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.rivo_messages') is null
     or to_regclass('public.rivo_voice_messages') is null
     or to_regclass('public.rivo_message_attachments') is null
     or to_regclass('public.rivo_message_hidden') is null
     or to_regclass('public.rivo_message_reactions') is null
     or to_regprocedure('public.rivo_can_call_user(text)') is null then
    raise exception 'Rivo v4 requires the existing core schema and the corrected supabase_private_messaging_v2.sql migration first.';
  end if;
  if not exists (select 1 from information_schema.columns where table_schema='public' and table_name='rivo_messages' and column_name='read_at')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='rivo_messages' and column_name='edited_at')
     or not exists (select 1 from information_schema.columns where table_schema='public' and table_name='profiles' and column_name='is_banned') then
    raise exception 'Rivo v4 requires read_at and edited_at from private messaging v2 and is_banned from the core schema.';
  end if;
end;
$preflight$;

-- 1) Direct-call signaling is stored as a minimal call-session row and delivered
--    through authenticated Postgres Changes, not public Broadcast topics.
create table if not exists public.rivo_call_sessions (
  call_id uuid primary key,
  room_name text not null unique,
  caller_id uuid not null references auth.users(id) on delete cascade,
  callee_id uuid not null references auth.users(id) on delete cascade,
  caller_username text not null,
  is_video boolean not null default false,
  status text not null default 'ringing' check (status in ('ringing','active','declined','busy','ended')),
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '2 minutes'),
  constraint rivo_call_sessions_different_users check (caller_id <> callee_id),
  constraint rivo_call_sessions_room_matches_call check (room_name = 'rivo-' || call_id::text)
);

-- Safe add/backfill for a partially-created v4 table; only ephemeral call metadata is touched.
alter table public.rivo_call_sessions add column if not exists caller_username text;
alter table public.rivo_call_sessions add column if not exists updated_by uuid references auth.users(id) on delete set null;
update public.rivo_call_sessions s
   set caller_username = p.username
  from public.profiles p
 where s.caller_id = p.id and (s.caller_username is null or s.caller_username = '');

create index if not exists rivo_call_sessions_active_expiry_idx
  on public.rivo_call_sessions (expires_at)
  where status in ('ringing','active');

alter table public.rivo_call_sessions enable row level security;
revoke all on table public.rivo_call_sessions from public, anon, authenticated;
grant select on table public.rivo_call_sessions to authenticated;
drop policy if exists "rivo_call_sessions_participants_read" on public.rivo_call_sessions;
create policy "rivo_call_sessions_participants_read"
  on public.rivo_call_sessions for select to authenticated
  using (caller_id = auth.uid() or callee_id = auth.uid());

create or replace function public.rivo_create_call_session(
  p_call_id uuid,
  p_callee_username text,
  p_room_name text,
  p_is_video boolean default false
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_me uuid := auth.uid();
  v_callee uuid;
  v_caller_username text;
  v_callee_setting text;
  v_callee_friends jsonb;
  v_caller_banned boolean := false;
  v_callee_banned boolean := false;
  v_username text := lower(trim(both '@' from coalesce(p_callee_username,'')));
begin
  if v_me is null then raise exception 'Not signed in'; end if;
  if p_call_id is null or p_room_name is distinct from ('rivo-' || p_call_id::text) then
    raise exception 'Invalid call session';
  end if;
  if v_username = '' then raise exception 'Recipient is required'; end if;

  select username, coalesce(is_banned,false) into v_caller_username, v_caller_banned
    from public.profiles where id = v_me;
  select id, coalesce(private_data->'callSettings'->>'whoCanCall','everyone'),
         coalesce(public_data->'friends','[]'::jsonb), coalesce(is_banned,false)
    into v_callee, v_callee_setting, v_callee_friends, v_callee_banned
    from public.profiles where username = v_username;
  if v_caller_username is null or v_callee is null or v_callee = v_me then raise exception 'Invalid call recipient'; end if;
  if v_caller_banned then raise exception 'Your account is blocked from calling'; end if;
  if v_callee_banned then raise exception 'This user is unavailable for calls'; end if;
  if coalesce(public.rivo_can_call_user(v_username), false) is not true then
    raise exception 'This user is not accepting calls from you';
  end if;
  -- Enforce the callee's preference server-side too; the browser is not an
  -- authority for deciding whether an incoming call may be created.
  if v_callee_setting = 'nobody' then raise exception 'This user is not accepting calls'; end if;
  if v_callee_setting = 'friends' and not (coalesce(v_callee_friends,'[]'::jsonb) ? v_caller_username) then
    raise exception 'Only this user''s friends can call them';
  end if;

  -- Lock both participants deterministically so simultaneous calls cannot race
  -- past the busy check for either user.
  perform pg_advisory_xact_lock(hashtextextended(least(v_me::text, v_callee::text), 0));
  perform pg_advisory_xact_lock(hashtextextended(greatest(v_me::text, v_callee::text), 0));

  -- Historical call-session rows are deliberately retained in this migration.
  -- A retention/cleanup job should be added only after the owner approves a policy.

  if exists (
    select 1 from public.rivo_call_sessions s
    where s.status in ('ringing','active') and s.expires_at > now()
      and (s.caller_id in (v_me, v_callee) or s.callee_id in (v_me, v_callee))
  ) then
    raise exception 'One participant is already in a call';
  end if;

  insert into public.rivo_call_sessions(call_id, room_name, caller_id, callee_id, caller_username, is_video, status, expires_at)
  values (p_call_id, p_room_name, v_me, v_callee, v_caller_username, coalesce(p_is_video,false), 'ringing', now() + interval '2 minutes');

  return jsonb_build_object('call_id', p_call_id, 'room_name', p_room_name, 'status', 'ringing');
end;
$$;
revoke all on function public.rivo_create_call_session(uuid,text,text,boolean) from public, anon;
grant execute on function public.rivo_create_call_session(uuid,text,text,boolean) to authenticated;

create or replace function public.rivo_update_call_session(p_call_id uuid, p_status text)
returns boolean
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_me uuid := auth.uid();
  v_rows integer := 0;
begin
  if v_me is null then raise exception 'Not signed in'; end if;
  if p_status not in ('active','declined','busy','ended') then raise exception 'Invalid call status'; end if;

  if p_status = 'active' then
    -- Only the callee may accept; the caller cannot mark its own outgoing call
    -- as accepted and force the recipient into a room without consent.
    update public.rivo_call_sessions
       set status = 'active', updated_by = v_me, updated_at = now(), expires_at = now() + interval '8 hours'
     where call_id = p_call_id
       and callee_id = v_me
       and status in ('ringing','active') and expires_at > now();
  elsif p_status in ('declined','busy') then
    -- Only the recipient may decline or report busy for a pending incoming call.
    update public.rivo_call_sessions
       set status = p_status, updated_by = v_me, updated_at = now(), expires_at = now()
     where call_id = p_call_id
       and callee_id = v_me
       and status = 'ringing' and expires_at > now();
  else
    update public.rivo_call_sessions
       set status = 'ended', updated_by = v_me, updated_at = now(), expires_at = now()
     where call_id = p_call_id
       and (caller_id = v_me or callee_id = v_me)
       and status in ('ringing','active','ended');
  end if;

  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;
revoke all on function public.rivo_update_call_session(uuid,text) from public, anon;
grant execute on function public.rivo_update_call_session(uuid,text) to authenticated;

create or replace function public.rivo_validate_incoming_call_session(
  p_call_id uuid,
  p_caller_id uuid,
  p_room_name text,
  p_caller_username text,
  p_is_video boolean
) returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from public.rivo_call_sessions s
      join public.profiles caller_profile on caller_profile.id = s.caller_id
     where s.call_id = p_call_id
       and s.caller_id = p_caller_id
       and s.callee_id = auth.uid()
       and s.room_name = p_room_name
       and caller_profile.username = lower(trim(both '@' from coalesce(p_caller_username,'')))
       and s.is_video = coalesce(p_is_video,false)
       and s.status = 'ringing'
       and s.expires_at > now()
  );
$$;
revoke all on function public.rivo_validate_incoming_call_session(uuid,uuid,text,text,boolean) from public, anon;
grant execute on function public.rivo_validate_incoming_call_session(uuid,uuid,text,text,boolean) to authenticated;

-- Stream session inserts/updates to participants. Rows are only visible to those
-- two participants by RLS; browsers cannot write status directly, only through RPCs.
do $$ begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'rivo_call_sessions'
  ) then
    alter publication supabase_realtime add table public.rivo_call_sessions;
  end if;
end $$;

-- 2) Cursor-paginated private-message history. Fetches one extra row so the
--    frontend can tell whether an older page exists. Existing DM RPCs are unchanged.
create or replace function public.rivo_get_messages_page(
  p_other_username text,
  p_before_created_at timestamptz default null,
  p_before_id bigint default null,
  p_limit integer default 40
) returns setof jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  me_id uuid := auth.uid();
  other_id uuid;
  v_limit integer := greatest(10, least(coalesce(p_limit,40),80));
begin
  if me_id is null then raise exception 'Not signed in'; end if;
  if (p_before_created_at is null) <> (p_before_id is null) then
    raise exception 'Both message cursor values must be supplied together';
  end if;

  select id into other_id from public.profiles
   where username = lower(trim(both '@' from p_other_username));
  if other_id is null then raise exception 'User not found'; end if;

  return query
  select jsonb_build_object(
    'id',m.id,
    'sender_username',s.username,
    'receiver_username',r.username,
    'content',case when v.message_id is not null or a.message_id is not null then '' else m.content end,
    'message_type',case when v.message_id is not null then 'voice' when a.message_id is not null then 'image' else 'text' end,
    'voice_path',v.storage_path,
    'voice_duration',v.duration_ms,
    'image_path',a.storage_path,
    'image_mime',a.mime_type,
    'created_at',m.created_at,
    'read_at',m.read_at,
    'edited_at',m.edited_at,
    'reactions',coalesce((
      select jsonb_agg(jsonb_build_object('reaction',x.reaction,'count',x.count,'me',x.me) order by x.reaction)
      from (
        select mr.reaction,count(*)::int as count,bool_or(mr.user_id=me_id) as me
        from public.rivo_message_reactions mr
        where mr.message_id=m.id
        group by mr.reaction
      ) x
    ),'[]'::jsonb)
  )
  from public.rivo_messages m
  join public.profiles s on s.id=m.sender_id
  join public.profiles r on r.id=m.receiver_id
  left join public.rivo_voice_messages v on v.message_id=m.id
  left join public.rivo_message_attachments a on a.message_id=m.id
  where ((m.sender_id=me_id and m.receiver_id=other_id) or (m.sender_id=other_id and m.receiver_id=me_id))
    and not exists (
      select 1 from public.rivo_message_hidden h
       where h.message_id=m.id and h.user_id=me_id
    )
    and (p_before_id is null or m.created_at < p_before_created_at
      or (m.created_at = p_before_created_at and m.id < p_before_id))
  order by m.created_at desc, m.id desc
  limit v_limit + 1;
end;
$$;
revoke all on function public.rivo_get_messages_page(text,timestamptz,bigint,integer) from public, anon;
grant execute on function public.rivo_get_messages_page(text,timestamptz,bigint,integer) to authenticated;

commit;
