-- Rivo social v3 migration: run once on the existing Supabase project.
alter table public.rivo_communities add column if not exists image_url text;
alter table public.rivo_communities add column if not exists image_path text;

create or replace function public.rivo_create_community(p_name text,p_description text,p_join_policy text,p_image_url text default null,p_image_path text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me uuid:=auth.uid(); cid bigint; policy text:=case when p_join_policy='friends' then 'friends' when p_join_policy='request' then 'request' else 'public' end;
begin
  if me is null then raise exception 'Not signed in'; end if;
  insert into public.rivo_communities(owner_id,name,description,join_policy,image_url,image_path)
  values(me,trim(p_name),trim(coalesce(p_description,'')),policy,nullif(trim(p_image_url),''),nullif(trim(p_image_path),'')) returning id into cid;
  insert into public.rivo_community_members(community_id,user_id,role) values(cid,me,'owner');
  return public.rivo_get_community(cid);
end; $$;
revoke all on function public.rivo_create_community(text,text,text,text,text) from public;
grant execute on function public.rivo_create_community(text,text,text,text,text) to authenticated;

create or replace function public.rivo_delete_post(p_post_id bigint)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me uuid:=auth.uid(); owner_id uuid;
begin
 if me is null then raise exception 'Not signed in'; end if;
 select user_id into owner_id from public.rivo_posts where id=p_post_id;
 if owner_id is null then raise exception 'Post not found'; end if;
 if owner_id <> me then raise exception 'Only the post owner can delete this post'; end if;
 delete from public.rivo_posts where id=p_post_id;
 return jsonb_build_object('deleted',true,'id',p_post_id);
end; $$;
revoke all on function public.rivo_delete_post(bigint) from public;
grant execute on function public.rivo_delete_post(bigint) to authenticated;

create or replace function public.rivo_delete_community(p_id bigint)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me uuid:=auth.uid(); owner_id uuid;
begin
 if me is null then raise exception 'Not signed in'; end if;
 select owner_id into owner_id from public.rivo_communities where id=p_id;
 if owner_id is null then raise exception 'Community not found'; end if;
 if owner_id <> me then raise exception 'Only the community owner can delete it'; end if;
 delete from public.rivo_communities where id=p_id;
 return jsonb_build_object('deleted',true,'id',p_id);
end; $$;
revoke all on function public.rivo_delete_community(bigint) from public;
grant execute on function public.rivo_delete_community(bigint) to authenticated;
