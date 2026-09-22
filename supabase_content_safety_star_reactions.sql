-- Rivo: one reaction (⭐) + server-side content moderation gate.
-- Run this migration AFTER the existing Rivo schema.
-- Requires an Edge Function named: rivo-content-moderate
-- and the Supabase secret: OPENAI_API_KEY

create extension if not exists pgcrypto with schema extensions;

-- ------------------------------------------------------------
-- One reaction only: ⭐
-- ------------------------------------------------------------
do $$ begin
  alter table public.rivo_post_reactions drop constraint if exists rivo_post_reactions_reaction_check;
  alter table public.rivo_post_reactions drop constraint if exists rivo_post_reactions_reaction_star_check;
  alter table public.rivo_message_reactions drop constraint if exists rivo_message_reactions_reaction_check;
  alter table public.rivo_message_reactions drop constraint if exists rivo_message_reactions_reaction_star_check;
exception when undefined_table then null;
end $$;

update public.rivo_post_reactions set reaction='⭐' where reaction is distinct from '⭐';
update public.rivo_message_reactions set reaction='⭐' where reaction is distinct from '⭐';

alter table public.rivo_post_reactions
  add constraint rivo_post_reactions_reaction_star_check check (reaction='⭐');
alter table public.rivo_message_reactions
  add constraint rivo_message_reactions_reaction_star_check check (reaction='⭐');

create or replace function public.rivo_toggle_post_reaction(p_post_id bigint,p_reaction text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me uuid:=auth.uid(); old text;
begin
  if me is null then raise exception 'Not signed in'; end if;
  if p_reaction <> '⭐' then raise exception 'Only star reactions are supported'; end if;
  if not exists(select 1 from public.rivo_posts where id=p_post_id) then raise exception 'Post not found'; end if;
  select reaction into old from public.rivo_post_reactions where post_id=p_post_id and user_id=me;
  if old='⭐' then
    delete from public.rivo_post_reactions where post_id=p_post_id and user_id=me;
  else
    insert into public.rivo_post_reactions(post_id,user_id,reaction)
    values(p_post_id,me,'⭐')
    on conflict(post_id,user_id) do update set reaction='⭐',created_at=now();
  end if;
  return public.rivo_get_post(p_post_id);
end; $$;
revoke all on function public.rivo_toggle_post_reaction(bigint,text) from public;
grant execute on function public.rivo_toggle_post_reaction(bigint,text) to authenticated;

create or replace function public.rivo_toggle_message_reaction(p_message_id bigint, p_reaction text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare m public.rivo_messages; existing text; totals jsonb;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if p_reaction <> '⭐' then raise exception 'Only star reactions are supported'; end if;
  select * into m from public.rivo_messages where id=p_message_id;
  if m.id is null or (m.sender_id<>auth.uid() and m.receiver_id<>auth.uid()) then raise exception 'Message not found'; end if;
  select reaction into existing from public.rivo_message_reactions where message_id=p_message_id and user_id=auth.uid();
  if existing='⭐' then
    delete from public.rivo_message_reactions where message_id=p_message_id and user_id=auth.uid();
  else
    insert into public.rivo_message_reactions(message_id,user_id,reaction)
    values(m.id,auth.uid(),'⭐')
    on conflict(message_id,user_id) do update set reaction='⭐',created_at=now();
  end if;
  select coalesce(jsonb_agg(x order by x.reaction),'[]'::jsonb) into totals from (
    select '⭐'::text as reaction,count(*)::int as count,bool_or(user_id=auth.uid()) as me
    from public.rivo_message_reactions where message_id=m.id and reaction='⭐'
    group by reaction
  ) x;
  return jsonb_build_object('message_id',m.id,'reactions',totals);
end; $$;
revoke all on function public.rivo_toggle_message_reaction(bigint,text) from public;
grant execute on function public.rivo_toggle_message_reaction(bigint,text) to authenticated;

-- ------------------------------------------------------------
-- Moderation proof ledger. Only the moderation Edge Function can create rows.
-- Each proof is one-time and expires quickly.
-- ------------------------------------------------------------
create table if not exists public.rivo_content_moderation_checks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('post_text','comment_text','message_text','community_message_text','image')),
  content_hash text not null,
  metadata jsonb not null default '{}'::jsonb,
  approved boolean not null default false,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
create index if not exists rivo_content_moderation_checks_user_idx
  on public.rivo_content_moderation_checks(user_id,created_at desc);
create index if not exists rivo_content_moderation_checks_expiry_idx
  on public.rivo_content_moderation_checks(expires_at);
alter table public.rivo_content_moderation_checks enable row level security;
revoke all on table public.rivo_content_moderation_checks from anon, authenticated;

create or replace function public.rivo_moderation_text_hash(p_kind text,p_content text)
returns text language sql immutable set search_path=public as $$
  select encode(extensions.digest(coalesce(p_kind,'') || ':' || trim(coalesce(p_content,'')), 'sha256'),'hex');
$$;
revoke all on function public.rivo_moderation_text_hash(text,text) from public,anon,authenticated;

create or replace function public.rivo_consume_moderation_check(
  p_check_id uuid,
  p_kind text,
  p_content_hash text default null,
  p_storage_path text default null
)
returns boolean language plpgsql security definer set search_path=public as $$
declare c public.rivo_content_moderation_checks;
begin
  if auth.uid() is null or p_check_id is null then raise exception 'Content moderation is required'; end if;
  select * into c from public.rivo_content_moderation_checks where id=p_check_id for update;
  if c.id is null or c.user_id<>auth.uid() or c.kind<>p_kind or c.approved<>true or c.used_at is not null or c.expires_at<=now() then
    raise exception 'Content moderation check is invalid or expired';
  end if;
  if p_content_hash is not null and c.content_hash<>p_content_hash then
    raise exception 'Content moderation check does not match this content';
  end if;
  if p_storage_path is not null and coalesce(c.metadata->>'storage_path','')<>p_storage_path then
    raise exception 'Image moderation check does not match this file';
  end if;
  update public.rivo_content_moderation_checks set used_at=now() where id=c.id;
  return true;
end; $$;
revoke all on function public.rivo_consume_moderation_check(uuid,text,text,text) from public,anon,authenticated;

-- ------------------------------------------------------------
-- Secure social writes: moderation proof is mandatory.
-- ------------------------------------------------------------
drop function if exists public.rivo_create_post(text,jsonb);
create or replace function public.rivo_create_post(p_content text,p_media jsonb,p_moderation_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me uuid:=auth.uid(); pid bigint; item jsonb; n int:=0; check_id uuid; media_path text;
begin
  if me is null then raise exception 'Not signed in'; end if;
  if exists(select 1 from public.profiles where id=me and is_banned) then raise exception 'Account is restricted'; end if;
  if char_length(coalesce(p_content,''))>5000 then raise exception 'Post is too long'; end if;
  if jsonb_typeof(coalesce(p_media,'[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_media,'[]'::jsonb)) > 5 then raise exception 'Maximum 5 images per post'; end if;
  if nullif(trim(coalesce(p_content,'')),'') is not null then
    perform public.rivo_consume_moderation_check(p_moderation_id,'post_text',public.rivo_moderation_text_hash('post_text',trim(coalesce(p_content,''))),null);
  end if;
  insert into public.rivo_posts(user_id,content) values(me,trim(coalesce(p_content,''))) returning id into pid;
  for item in select * from jsonb_array_elements(coalesce(p_media,'[]'::jsonb)) loop
    media_path:=trim(coalesce(item->>'path',''));
    if media_path !~ ('^' || me::text || '/posts/') then raise exception 'Invalid post media path'; end if;
    check_id:=nullif(item->>'moderation_id','')::uuid;
    perform public.rivo_consume_moderation_check(check_id,'image',null,media_path);
    insert into public.rivo_post_media(post_id,media_url,storage_path,media_type,sort_order)
    values(pid,item->>'url',media_path,coalesce(item->>'type','image/webp'),n);
    n:=n+1;
  end loop;
  return public.rivo_get_post(pid);
end; $$;
revoke all on function public.rivo_create_post(text,jsonb,uuid) from public;
grant execute on function public.rivo_create_post(text,jsonb,uuid) to authenticated;

-- Remove the old unprotected 2-argument form if it exists.
drop function if exists public.rivo_create_post(text,jsonb);

DROP FUNCTION IF EXISTS public.rivo_add_post_comment(bigint,text);
create or replace function public.rivo_add_post_comment(p_post_id bigint,p_content text,p_moderation_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me uuid:=auth.uid(); cid bigint; clean text:=trim(coalesce(p_content,''));
begin
  if me is null then raise exception 'Not signed in'; end if;
  if char_length(clean)<1 or char_length(clean)>2000 then raise exception 'Comment is invalid'; end if;
  if not exists(select 1 from public.rivo_posts where id=p_post_id) then raise exception 'Post not found'; end if;
  perform public.rivo_consume_moderation_check(p_moderation_id,'comment_text',public.rivo_moderation_text_hash('comment_text',clean),null);
  insert into public.rivo_post_comments(post_id,user_id,content) values(p_post_id,me,clean) returning id into cid;
  return public.rivo_get_post(p_post_id);
end; $$;
revoke all on function public.rivo_add_post_comment(bigint,text,uuid) from public;
grant execute on function public.rivo_add_post_comment(bigint,text,uuid) to authenticated;

DROP FUNCTION IF EXISTS public.rivo_send_message(text,text);
create or replace function public.rivo_send_message(p_receiver_username text,p_content text,p_moderation_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me public.profiles; target public.profiles; text_value text:=trim(coalesce(p_content,'')); can_receive text; are_friends boolean:=false; m public.rivo_messages;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if char_length(text_value)<1 then raise exception 'Message cannot be empty'; end if;
  if char_length(text_value)>2000 then raise exception 'Message is too long'; end if;
  select * into me from public.profiles where id=auth.uid();
  select * into target from public.profiles where username=lower(trim(both '@' from p_receiver_username));
  if me.id is null or target.id is null then raise exception 'User not found'; end if;
  if me.is_banned then raise exception 'Your account is blocked'; end if;
  if target.is_banned then raise exception 'This account is unavailable'; end if;
  if me.id=target.id then raise exception 'You cannot message yourself'; end if;
  can_receive:=coalesce(target.private_data->'messageSettings'->>'whoCanMessage','everyone');
  if can_receive='nobody' then raise exception 'This user has closed their messages'; end if;
  are_friends:=coalesce(target.public_data->'friends','[]'::jsonb) ? me.username;
  if can_receive='friends' and not are_friends then raise exception 'This user accepts messages from friends only'; end if;
  perform public.rivo_consume_moderation_check(p_moderation_id,'message_text',public.rivo_moderation_text_hash('message_text',text_value),null);
  insert into public.rivo_messages(sender_id,receiver_id,content) values(me.id,target.id,text_value) returning * into m;
  perform public.rivo_write_notification(target.id,me.id,'message',me.username||' sent you a message',jsonb_build_object('message_id',m.id,'username',me.username));
  return jsonb_build_object('id',m.id,'sender_username',me.username,'receiver_username',target.username,'content',m.content,'created_at',m.created_at,'reactions','[]'::jsonb);
end; $$;
revoke all on function public.rivo_send_message(text,text,uuid) from public;
grant execute on function public.rivo_send_message(text,text,uuid) to authenticated;

DROP FUNCTION IF EXISTS public.rivo_send_community_message(bigint,text);
create or replace function public.rivo_send_community_message(p_id bigint,p_content text,p_moderation_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me uuid:=auth.uid(); mid bigint; clean text:=trim(coalesce(p_content,''));
begin
  if me is null or not exists(select 1 from public.rivo_community_members where community_id=p_id and user_id=me) then raise exception 'Join the community first'; end if;
  if char_length(clean)<1 or char_length(clean)>2000 then raise exception 'Message is invalid'; end if;
  if exists(select 1 from public.profiles where id=me and is_banned) then raise exception 'Your account is blocked'; end if;
  perform public.rivo_consume_moderation_check(p_moderation_id,'community_message_text',public.rivo_moderation_text_hash('community_message_text',clean),null);
  insert into public.rivo_community_messages(community_id,user_id,content) values(p_id,me,clean) returning id into mid;
  return (select jsonb_build_object('id',m.id,'content',m.content,'created_at',m.created_at,'author',public.rivo_social_profile(m.user_id)) from public.rivo_community_messages m where m.id=mid);
end; $$;
revoke all on function public.rivo_send_community_message(bigint,text,uuid) from public;
grant execute on function public.rivo_send_community_message(bigint,text,uuid) to authenticated;

-- Remove expired moderation proofs. Safe to run repeatedly; can also be called from pg_cron.
delete from public.rivo_content_moderation_checks where expires_at < now() - interval '1 day';
