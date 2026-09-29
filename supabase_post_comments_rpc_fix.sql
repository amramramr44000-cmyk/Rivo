-- Rivo: restore the exact post-comment RPC expected by js/core.js/PostgREST.
-- Safe to run repeatedly. Does not delete comments or posts.
-- Run this migration in Supabase SQL Editor, then hard-refresh Rivo.

create or replace function public.rivo_add_post_comment(
  p_post_id bigint,
  p_content text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  cid bigint;
  text_value text := trim(coalesce(p_content, ''));
begin
  if me is null then
    raise exception 'Not signed in';
  end if;

  if p_post_id is null or p_post_id <= 0 then
    raise exception 'Invalid post';
  end if;

  if char_length(text_value) < 1 then
    raise exception 'Comment cannot be empty';
  end if;

  if char_length(text_value) > 2000 then
    raise exception 'Comment is too long';
  end if;

  if not exists (
    select 1
    from public.rivo_posts
    where id = p_post_id
  ) then
    raise exception 'Post not found';
  end if;

  if exists (
    select 1
    from public.profiles
    where id = me
      and coalesce(is_banned, false)
  ) then
    raise exception 'Account is restricted';
  end if;

  insert into public.rivo_post_comments(post_id, user_id, content)
  values (p_post_id, me, text_value)
  returning id into cid;

  return public.rivo_get_post(p_post_id);
end;
$$;

revoke all on function public.rivo_add_post_comment(bigint, text) from public;
grant execute on function public.rivo_add_post_comment(bigint, text) to authenticated;

-- Make PostgREST refresh its function/schema cache immediately.
notify pgrst, 'reload schema';

select 'rivo_add_post_comment RPC restored' as status;
