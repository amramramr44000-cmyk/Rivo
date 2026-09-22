-- Rivo: secure profile updates
-- Step 1: install a server-side function for safe profile updates.
-- Do NOT revoke the existing profiles UPDATE policy yet.
-- The frontend will be switched to this function in the next step.

create or replace function public.rivo_update_my_profile(p_public_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  old_data jsonb;
  new_data jsonb;
begin
  if me is null then
    raise exception 'Not signed in';
  end if;

  if p_public_data is null
     or jsonb_typeof(p_public_data) <> 'object' then
    raise exception 'Invalid profile data';
  end if;

  select public_data
    into old_data
  from public.profiles
  where id = me
  for update;

  if old_data is null then
    raise exception 'Profile not found';
  end if;

  -- Only user-editable profile fields are accepted here.
  -- System-owned fields are intentionally ignored.

  new_data :=
    coalesce(old_data, '{}'::jsonb)
    || jsonb_strip_nulls(
      jsonb_build_object(
        'displayName',       p_public_data->'displayName',
        'bio',               p_public_data->'bio',
        'description',       p_public_data->'description',
        'location',          p_public_data->'location',
        'website',           p_public_data->'website',
        'avatar',            p_public_data->'avatar',
        'banner',            p_public_data->'banner',
        'miniImage',         p_public_data->'miniImage',
        'status',            p_public_data->'status',
        'customStatus',      p_public_data->'customStatus',
        'theme',             p_public_data->'theme',
        'template',          p_public_data->'template',
        'accent',             p_public_data->'accent',
        'cardRadius',        p_public_data->'cardRadius',
        'cardStyle',         p_public_data->'cardStyle',
        'glow',              p_public_data->'glow',
        'background',        p_public_data->'background',
        'animation',         p_public_data->'animation',
        'socials',           p_public_data->'socials',
        'skills',            p_public_data->'skills',
        'projects',          p_public_data->'projects',
        'sections',          p_public_data->'sections',
        'music',             p_public_data->'music',
        'avatarFrame',       p_public_data->'avatarFrame',
        'avatarFrameColor',  p_public_data->'avatarFrameColor',
        'avatarFrameGlow',   p_public_data->'avatarFrameGlow',
        'avatarFrameWidth',  p_public_data->'avatarFrameWidth'
      )
    );

  update public.profiles
  set
    public_data = new_data,
    updated_at = now()
  where id = me;

  return jsonb_build_object(
    'id', me,
    'username', (
      select username
      from public.profiles
      where id = me
    ),
    'public_data', new_data,
    'updated_at', (
      select updated_at
      from public.profiles
      where id = me
    )
  );
end;
$$;

revoke all on function public.rivo_update_my_profile(jsonb) from public;
grant execute on function public.rivo_update_my_profile(jsonb) to authenticated;

select 'Rivo profile update hardening function installed' as status;
