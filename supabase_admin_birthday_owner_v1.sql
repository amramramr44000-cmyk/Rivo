
-- Rivo admin birthday + profile-owner animation support.
-- Safe additive migration: no existing data is deleted.

create or replace function public.rivo_admin_get_user_details(p_username text)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  p public.profiles;
  vis jsonb;
  bd text;
begin
  if not public.rivo_is_admin(auth.uid()) then
    raise exception 'Access denied';
  end if;

  select * into p
  from public.profiles
  where username=lower(trim(both '@' from p_username));

  if p.id is null then
    return null;
  end if;

  bd := coalesce(p.private_data->>'birthDate', p.public_data->>'birthDate', '');

  select coalesce(jsonb_agg(x order by x.last_seen desc),'[]'::jsonb)
  into vis
  from (
    select
      pr.username,
      coalesce(pr.public_data->>'displayName',pr.username) as display_name,
      max(v.viewed_at) as last_seen,
      count(*)::int as visits
    from public.rivo_profile_views v
    join public.profiles pr on pr.id=v.viewer_id
    where v.profile_id=p.id
    group by pr.id,pr.username,pr.public_data->>'displayName'
    order by max(v.viewed_at) desc
    limit 50
  ) x;

  return jsonb_build_object(
    'userId',p.id,
    'username',p.username,
    'displayName',coalesce(p.public_data->>'displayName',p.username),
    'is_banned',p.is_banned,
    'created_at',p.created_at,
    'views',coalesce((p.public_data->'stats'->>'views')::int,0),
    'likes',coalesce((p.public_data->'likes'->>'count')::int,0),
    'friends',jsonb_array_length(coalesce(p.public_data->'friends','[]'::jsonb)),
    'birthDate',nullif(bd,''),
    'visitors',vis
  );
end;
$$;

revoke all on function public.rivo_admin_get_user_details(text) from public;
grant execute on function public.rivo_admin_get_user_details(text) to authenticated;

create or replace function public.rivo_admin_update_profile(
  p_current_username text,
  p_new_username text,
  p_display_name text,
  p_birth_date text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  target public.profiles;
  oldu text := lower(trim(both '@' from p_current_username));
  newu text := lower(trim(both '@' from p_new_username));
  clean_birth text := nullif(trim(coalesce(p_birth_date,'')), '');
begin
  if not public.rivo_is_admin(auth.uid()) then
    raise exception 'Access denied';
  end if;

  select * into target
  from public.profiles
  where username=oldu
  for update;

  if target.id is null then
    raise exception 'User not found';
  end if;

  if newu is null or newu !~ '^[a-z0-9][a-z0-9._-]{1,24}[a-z0-9]$' then
    raise exception 'Invalid username';
  end if;

  if newu <> oldu and exists (
    select 1 from public.profiles where username=newu
  ) then
    raise exception 'Username already exists';
  end if;

  if clean_birth is not null and clean_birth !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'Invalid birth date';
  end if;

  if clean_birth is not null
     and clean_birth::date > current_date then
    raise exception 'Birth date cannot be in the future';
  end if;

  update public.profiles
  set
    username = newu,
    public_data = jsonb_set(
      coalesce(public_data,'{}'::jsonb),
      '{displayName}',
      to_jsonb(coalesce(nullif(trim(p_display_name),''),newu)),
      true
    ),
    private_data = case
      when clean_birth is null then
        jsonb_set(
          coalesce(private_data,'{}'::jsonb),
          '{birthDate}',
          'null'::jsonb,
          true
        )
      else
        jsonb_set(
          coalesce(private_data,'{}'::jsonb),
          '{birthDate}',
          to_jsonb(clean_birth),
          true
        )
    end,
    updated_at = now()
  where id=target.id;

  return jsonb_build_object(
    'user_id',target.id,
    'username',newu,
    'display_name',coalesce(nullif(trim(p_display_name),''),newu),
    'birth_date',clean_birth
  );
end;
$$;

revoke all on function public.rivo_admin_update_profile(text,text,text,text) from public;
grant execute on function public.rivo_admin_update_profile(text,text,text,text) to authenticated;

create or replace function public.rivo_is_admin_profile(p_username text)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists(
    select 1
    from public.rivo_admin_users au
    join public.profiles p on p.id=au.user_id
    where p.username=lower(trim(both '@' from p_username))
  );
$$;

revoke all on function public.rivo_is_admin_profile(text) from public;
grant execute on function public.rivo_is_admin_profile(text) to anon, authenticated;
