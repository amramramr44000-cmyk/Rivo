-- Rivo fix: pgcrypto digest() is installed in the Supabase extensions schema.
-- Run this once in Supabase SQL Editor.

create extension if not exists pgcrypto with schema extensions;

create or replace function public.rivo_moderation_text_hash(p_kind text,p_content text)
returns text language sql immutable set search_path=public as $$
  select encode(extensions.digest(coalesce(p_kind,'') || ':' || trim(coalesce(p_content,'')), 'sha256'),'hex');
$$;

revoke all on function public.rivo_moderation_text_hash(text,text) from public,anon,authenticated;

-- After this succeeds, the rest of the migration can continue using the fixed full SQL file.
