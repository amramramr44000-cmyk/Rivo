-- Rivo: post publishing RPC repair
-- Fixes: "Could not find the function public.rivo_create_post(p_content, p_media) in the schema cache"
--
-- This migration is safe for an already-running project:
--   * CREATE OR REPLACE keeps the existing function signature.
--   * No tables, rows, policies, or existing posts are changed.
--   * The frontend already calls this exact RPC signature.

create or replace function public.rivo_create_post(
  p_content text,
  p_media jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  me uuid := auth.uid();
  pid bigint;
  item jsonb;
  n int := 0;
begin
  if me is null then
    raise exception 'Not signed in';
  end if;

  if exists(
    select 1
    from public.profiles
    where id = me and is_banned
  ) then
    raise exception 'Account is restricted';
  end if;

  if char_length(coalesce(p_content, '')) > 5000 then
    raise exception 'Post is too long';
  end if;

  if jsonb_typeof(coalesce(p_media, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_media, '[]'::jsonb)) > 5 then
    raise exception 'Maximum 5 images per post';
  end if;

  insert into public.rivo_posts(user_id, content)
  values(me, trim(coalesce(p_content, '')))
  returning id into pid;

  for item in
    select * from jsonb_array_elements(coalesce(p_media, '[]'::jsonb))
  loop
    insert into public.rivo_post_media(
      post_id,
      media_url,
      storage_path,
      media_type,
      sort_order
    )
    values(
      pid,
      item->>'url',
      item->>'path',
      coalesce(item->>'type', 'image/webp'),
      n
    );
    n := n + 1;
  end loop;

  return public.rivo_get_post(pid);
end;
$$;

revoke all on function public.rivo_create_post(text, jsonb) from public;
grant execute on function public.rivo_create_post(text, jsonb) to authenticated;

-- Ask PostgREST to refresh its schema cache immediately after the function is created/replaced.
notify pgrst, 'reload schema';
