-- Rivo: secure deletion for the signed-in user's own direct messages and post comments.
-- Run this migration in Supabase SQL Editor after the existing schema/migrations.

create or replace function public.rivo_delete_message(p_message_id bigint)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  deleted_count integer;
begin
  if me is null then raise exception 'Not signed in'; end if;

  delete from public.rivo_messages
  where id = p_message_id
    and sender_id = me;

  get diagnostics deleted_count = row_count;
  if deleted_count = 0 then
    raise exception 'Message not found or you are not allowed to delete it';
  end if;

  return true;
end;
$$;

revoke all on function public.rivo_delete_message(bigint) from public;
grant execute on function public.rivo_delete_message(bigint) to authenticated;

create or replace function public.rivo_delete_post_comment(p_comment_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  post_id_value bigint;
begin
  if me is null then raise exception 'Not signed in'; end if;

  select c.post_id into post_id_value
  from public.rivo_post_comments c
  where c.id = p_comment_id
    and c.user_id = me;

  if post_id_value is null then
    raise exception 'Comment not found or you are not allowed to delete it';
  end if;

  delete from public.rivo_post_comments
  where id = p_comment_id
    and user_id = me;

  return public.rivo_get_post(post_id_value);
end;
$$;

revoke all on function public.rivo_delete_post_comment(bigint) from public;
grant execute on function public.rivo_delete_post_comment(bigint) to authenticated;
