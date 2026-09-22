-- Rivo post reaction toggle fix: the only supported reaction is ⭐
create or replace function public.rivo_toggle_post_reaction(p_post_id bigint,p_reaction text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me uuid:=auth.uid(); old text;
begin
  if me is null then raise exception 'Not signed in'; end if;
  if p_reaction <> '⭐' then raise exception 'Only star reactions are supported'; end if;
  select reaction into old from public.rivo_post_reactions where post_id=p_post_id and user_id=me;
  if old='⭐' then delete from public.rivo_post_reactions where post_id=p_post_id and user_id=me;
  else insert into public.rivo_post_reactions(post_id,user_id,reaction) values(p_post_id,me,'⭐') on conflict(post_id,user_id) do update set reaction='⭐',created_at=now(); end if;
  return public.rivo_get_post(p_post_id);
end; $$;
revoke all on function public.rivo_toggle_post_reaction(bigint,text) from public;
grant execute on function public.rivo_toggle_post_reaction(bigint,text) to authenticated;
