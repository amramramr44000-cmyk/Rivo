-- Rivo: convert post reactions to one star toggle.
-- Run once in Supabase SQL Editor. Existing reaction rows are preserved
-- as a single star per user/post. Comments, reposts and message reactions
-- are not changed.

DO $$
DECLARE
  c record;
BEGIN
  -- Remove any old reaction CHECK constraint(s) from this table.
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.rivo_post_reactions'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%reaction%'
  LOOP
    EXECUTE format('ALTER TABLE public.rivo_post_reactions DROP CONSTRAINT IF EXISTS %I', c.conname);
  END LOOP;
END $$;

-- Preserve existing interactions as the new single star reaction.
UPDATE public.rivo_post_reactions
SET reaction = '⭐'
WHERE reaction IS DISTINCT FROM '⭐';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.rivo_post_reactions'::regclass
      AND conname = 'rivo_post_reactions_reaction_star_check'
  ) THEN
    ALTER TABLE public.rivo_post_reactions
      ADD CONSTRAINT rivo_post_reactions_reaction_star_check
      CHECK (reaction = '⭐');
  END IF;
END $$;

create or replace function public.rivo_toggle_post_reaction(p_post_id bigint,p_reaction text default '⭐')
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  me uuid := auth.uid();
  old text;
begin
  if me is null then raise exception 'Not signed in'; end if;
  if coalesce(p_reaction,'⭐') <> '⭐' then raise exception 'Only star reaction is supported'; end if;

  select reaction into old
  from public.rivo_post_reactions
  where post_id=p_post_id and user_id=me;

  if old = '⭐' then
    delete from public.rivo_post_reactions
    where post_id=p_post_id and user_id=me;
  else
    insert into public.rivo_post_reactions(post_id,user_id,reaction)
    values(p_post_id,me,'⭐')
    on conflict(post_id,user_id)
    do update set reaction='⭐',created_at=now();
  end if;

  return public.rivo_get_post(p_post_id);
end;
$$;

revoke all on function public.rivo_toggle_post_reaction(bigint,text) from public;
grant execute on function public.rivo_toggle_post_reaction(bigint,text) to authenticated;
