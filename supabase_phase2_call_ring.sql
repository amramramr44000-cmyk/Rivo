-- Rivo Phase 2: persistent call signaling / ringing
-- Non-destructive migration. Keeps existing LiveKit/media code intact.

create table if not exists public.rivo_call_sessions (
  id uuid primary key,
  caller_id uuid not null references auth.users(id) on delete cascade,
  callee_id uuid not null references auth.users(id) on delete cascade,
  room_name text not null,
  call_type text not null default 'audio' check (call_type in ('audio','video')),
  status text not null default 'ringing' check (status in ('ringing','accepted','declined','ended','expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '45 seconds'),
  updated_at timestamptz not null default now(),
  check (caller_id <> callee_id)
);

create index if not exists rivo_call_sessions_callee_status_idx
  on public.rivo_call_sessions(callee_id, status, created_at desc);
create index if not exists rivo_call_sessions_caller_status_idx
  on public.rivo_call_sessions(caller_id, status, created_at desc);

create unique index if not exists rivo_call_sessions_one_active_caller_idx
  on public.rivo_call_sessions(caller_id)
  where status in ('ringing','accepted');
create unique index if not exists rivo_call_sessions_one_active_callee_idx
  on public.rivo_call_sessions(callee_id)
  where status in ('ringing','accepted');

alter table public.rivo_call_sessions enable row level security;

drop policy if exists "rivo_call_sessions_select_participant" on public.rivo_call_sessions;
create policy "rivo_call_sessions_select_participant"
on public.rivo_call_sessions
for select to authenticated
using (caller_id = auth.uid() or callee_id = auth.uid());

-- Server-authoritative call-session creation.
create or replace function public.rivo_create_call_session(
  p_call_id uuid,
  p_target_username text,
  p_room_name text,
  p_call_type text default 'audio'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  target public.profiles;
  v_type text := case when p_call_type = 'video' then 'video' else 'audio' end;
  v_existing public.rivo_call_sessions;
  v_row public.rivo_call_sessions;
begin
  if me is null then raise exception 'Unauthorized'; end if;
  if p_call_id is null then raise exception 'Invalid call id'; end if;
  if coalesce(trim(p_room_name),'') = '' then raise exception 'Invalid room'; end if;

  select * into target
  from public.profiles
  where username = lower(trim(both '@' from p_target_username))
  limit 1;

  if target.id is null or target.id = me then
    raise exception 'User is unavailable for calling';
  end if;

  if not public.rivo_can_call_user(target.username) then
    raise exception 'This user is not accepting calls from you';
  end if;

  -- Lock both identities in stable order to prevent race conditions.
  if me < target.id then
    perform pg_advisory_xact_lock(hashtext(me::text));
    perform pg_advisory_xact_lock(hashtext(target.id::text));
  else
    perform pg_advisory_xact_lock(hashtext(target.id::text));
    perform pg_advisory_xact_lock(hashtext(me::text));
  end if;

  -- Do not allow duplicate/parallel active calls for either side.
  select * into v_existing
  from public.rivo_call_sessions
  where status in ('ringing','accepted')
    and (caller_id = me or callee_id = me or caller_id = target.id or callee_id = target.id)
  order by created_at desc
  limit 1;

  if v_existing.id is not null then
    raise exception 'User is busy';
  end if;

  insert into public.rivo_call_sessions(
    id, caller_id, callee_id, room_name, call_type, status, expires_at, updated_at
  ) values (
    p_call_id, me, target.id, trim(p_room_name), v_type, 'ringing', now() + interval '45 seconds', now()
  )
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id,
    'caller_id', v_row.caller_id,
    'callee_id', v_row.callee_id,
    'room_name', v_row.room_name,
    'call_type', v_row.call_type,
    'status', v_row.status,
    'created_at', v_row.created_at,
    'expires_at', v_row.expires_at
  );
end;
$$;
revoke all on function public.rivo_create_call_session(uuid,text,text,text) from public;
grant execute on function public.rivo_create_call_session(uuid,text,text,text) to authenticated;

-- Return missed incoming rings that are still valid.
create or replace function public.rivo_list_incoming_call_sessions()
returns setof jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.rivo_call_sessions
  set status = 'expired', updated_at = now()
  where callee_id = auth.uid()
    and status = 'ringing'
    and expires_at <= now();

  return query
  select jsonb_build_object(
    'id', s.id,
    'callId', s.id,
    'from', s.caller_id,
    'to', s.callee_id,
    'type', 'offer',
    'payload', jsonb_build_object(
      'isVideo', s.call_type = 'video',
      'roomName', s.room_name,
      'username', coalesce(p.username,''),
      'displayName', coalesce(p.public_data->>'displayName', p.username),
      'avatar', coalesce(p.public_data->>'avatar','')
    )
  )
  from public.rivo_call_sessions s
  join public.profiles p on p.id = s.caller_id
  where s.callee_id = auth.uid()
    and s.status = 'ringing'
    and s.expires_at > now()
  order by s.created_at desc;
end;
$$;
revoke all on function public.rivo_list_incoming_call_sessions() from public;
grant execute on function public.rivo_list_incoming_call_sessions() to authenticated;

create or replace function public.rivo_accept_call_session(p_call_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.rivo_call_sessions;
begin
  select * into s from public.rivo_call_sessions where id = p_call_id for update;
  if s.id is null then raise exception 'Call session not found'; end if;
  if s.callee_id <> auth.uid() then raise exception 'Access denied'; end if;
  if s.status <> 'ringing' or s.expires_at <= now() then
    update public.rivo_call_sessions set status='expired', updated_at=now() where id=s.id;
    raise exception 'Call is no longer available';
  end if;

  if not public.rivo_can_receive_call((select username from public.profiles where id=s.caller_id)) then
    raise exception 'You are not accepting calls from this user';
  end if;

  update public.rivo_call_sessions
  set status='accepted', updated_at=now()
  where id=s.id;
  return true;
end;
$$;
revoke all on function public.rivo_accept_call_session(uuid) from public;
grant execute on function public.rivo_accept_call_session(uuid) to authenticated;

create or replace function public.rivo_update_call_session(
  p_call_id uuid,
  p_status text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text := case
    when p_status = 'declined' then 'declined'
    when p_status = 'expired' then 'expired'
    else 'ended'
  end;
begin
  update public.rivo_call_sessions
  set status=v_status, updated_at=now()
  where id=p_call_id
    and (caller_id=auth.uid() or callee_id=auth.uid())
    and status in ('ringing','accepted');
  return found;
end;
$$;
revoke all on function public.rivo_update_call_session(uuid,text) from public;
grant execute on function public.rivo_update_call_session(uuid,text) to authenticated;

-- Realtime delivery for persistent call state.
alter table public.rivo_call_sessions replica identity full;
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='rivo_call_sessions'
  ) then
    alter publication supabase_realtime add table public.rivo_call_sessions;
  end if;
end $$;
