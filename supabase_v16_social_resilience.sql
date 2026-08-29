-- Rivo v16 social reliability migration
-- Safe/idempotent. Does not delete existing social data.

create or replace function public.rivo_send_friend_request(p_target_username text)
returns boolean language plpgsql security definer set search_path=public as $$
declare me public.profiles; target public.profiles; a uuid; b uuid; incoming_me jsonb; outgoing_me jsonb; incoming_target jsonb; outgoing_target jsonb; mefriends jsonb; targetfriends jsonb; reciprocal boolean;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select id into a from public.profiles where id=auth.uid();
  select id into b from public.profiles where lower(username)=lower(trim(both '@' from p_target_username));
  if a is null or b is null then raise exception 'User not found'; end if;
  if a=b then raise exception 'You cannot add yourself'; end if;
  if a<b then
    select * into me from public.profiles where id=a for update;
    select * into target from public.profiles where id=b for update;
  else
    select * into target from public.profiles where id=b for update;
    select * into me from public.profiles where id=a for update;
  end if;
  if coalesce(me.is_banned,false) then raise exception 'Your account is blocked'; end if;
  if coalesce(target.is_banned,false) then raise exception 'This account is unavailable'; end if;
  mefriends:=coalesce(me.public_data->'friends','[]'::jsonb); targetfriends:=coalesce(target.public_data->'friends','[]'::jsonb);
  if mefriends ? target.username then return true; end if;
  incoming_me:=coalesce(me.private_data->'friendRequests'->'incoming','[]'::jsonb); outgoing_me:=coalesce(me.private_data->'friendRequests'->'outgoing','[]'::jsonb); incoming_target:=coalesce(target.private_data->'friendRequests'->'incoming','[]'::jsonb); outgoing_target:=coalesce(target.private_data->'friendRequests'->'outgoing','[]'::jsonb);
  reciprocal := (incoming_me ? target.username) or (outgoing_target ? me.username);
  if reciprocal then
    incoming_me:=(select coalesce(jsonb_agg(v),'[]'::jsonb) from jsonb_array_elements_text(incoming_me) v where v<>target.username);
    outgoing_me:=(select coalesce(jsonb_agg(v),'[]'::jsonb) from jsonb_array_elements_text(outgoing_me) v where v<>target.username);
    incoming_target:=(select coalesce(jsonb_agg(v),'[]'::jsonb) from jsonb_array_elements_text(incoming_target) v where v<>me.username);
    outgoing_target:=(select coalesce(jsonb_agg(v),'[]'::jsonb) from jsonb_array_elements_text(outgoing_target) v where v<>me.username);
    if not(mefriends ? target.username) then mefriends:=mefriends||to_jsonb(target.username); end if;
    if not(targetfriends ? me.username) then targetfriends:=targetfriends||to_jsonb(me.username); end if;
    me.private_data:=jsonb_set(jsonb_set(coalesce(me.private_data,'{}'::jsonb),'{friendRequests,incoming}',incoming_me,true),'{friendRequests,outgoing}',outgoing_me,true);
    target.private_data:=jsonb_set(jsonb_set(coalesce(target.private_data,'{}'::jsonb),'{friendRequests,incoming}',incoming_target,true),'{friendRequests,outgoing}',outgoing_target,true);
    me.public_data:=jsonb_set(coalesce(me.public_data,'{}'::jsonb),'{friends}',mefriends,true); target.public_data:=jsonb_set(coalesce(target.public_data,'{}'::jsonb),'{friends}',targetfriends,true);
    update public.profiles set public_data=me.public_data,private_data=me.private_data,updated_at=now() where id=me.id; update public.profiles set public_data=target.public_data,private_data=target.private_data,updated_at=now() where id=target.id; return true;
  end if;
  if (outgoing_me ? target.username) or (incoming_target ? me.username) then return true; end if;
  outgoing_me:=outgoing_me||to_jsonb(target.username); incoming_target:=incoming_target||to_jsonb(me.username);
  me.private_data:=jsonb_set(coalesce(me.private_data,'{}'::jsonb),'{friendRequests,outgoing}',outgoing_me,true); target.private_data:=jsonb_set(coalesce(target.private_data,'{}'::jsonb),'{friendRequests,incoming}',incoming_target,true);
  update public.profiles set private_data=me.private_data,updated_at=now() where id=me.id; update public.profiles set private_data=target.private_data,updated_at=now() where id=target.id;
  return true;
end; $$;

create or replace function public.rivo_accept_friend_request(p_from_username text)
returns boolean language plpgsql security definer set search_path=public as $$
declare me public.profiles; other public.profiles; a uuid; b uuid; incoming jsonb; outgoing jsonb; mf jsonb; ofr jsonb;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select id into a from public.profiles where id=auth.uid(); select id into b from public.profiles where lower(username)=lower(trim(both '@' from p_from_username));
  if a is null or b is null then raise exception 'User not found'; end if; if a=b then raise exception 'Invalid friend request'; end if;
  if a<b then select * into me from public.profiles where id=a for update; select * into other from public.profiles where id=b for update; else select * into other from public.profiles where id=b for update; select * into me from public.profiles where id=a for update; end if;
  incoming:=coalesce(me.private_data->'friendRequests'->'incoming','[]'::jsonb); outgoing:=coalesce(other.private_data->'friendRequests'->'outgoing','[]'::jsonb); mf:=coalesce(me.public_data->'friends','[]'::jsonb); ofr:=coalesce(other.public_data->'friends','[]'::jsonb);
  if not(incoming ? other.username) and not(outgoing ? me.username) then if (mf ? other.username) and (ofr ? me.username) then return true; end if; raise exception 'Request not found'; end if;
  incoming:=(select coalesce(jsonb_agg(v),'[]'::jsonb) from jsonb_array_elements_text(incoming) v where v<>other.username); outgoing:=(select coalesce(jsonb_agg(v),'[]'::jsonb) from jsonb_array_elements_text(outgoing) v where v<>me.username);
  if not(mf ? other.username) then mf:=mf||to_jsonb(other.username); end if; if not(ofr ? me.username) then ofr:=ofr||to_jsonb(me.username); end if;
  me.private_data:=jsonb_set(coalesce(me.private_data,'{}'::jsonb),'{friendRequests,incoming}',incoming,true); other.private_data:=jsonb_set(coalesce(other.private_data,'{}'::jsonb),'{friendRequests,outgoing}',outgoing,true); me.public_data:=jsonb_set(coalesce(me.public_data,'{}'::jsonb),'{friends}',mf,true); other.public_data:=jsonb_set(coalesce(other.public_data,'{}'::jsonb),'{friends}',ofr,true);
  update public.profiles set public_data=me.public_data,private_data=me.private_data,updated_at=now() where id=me.id; update public.profiles set public_data=other.public_data,private_data=other.private_data,updated_at=now() where id=other.id; return true;
end; $$;

create or replace function public.rivo_reject_friend_request(p_from_username text)
returns boolean language plpgsql security definer set search_path=public as $$
declare me public.profiles; other public.profiles; a uuid; b uuid; inc jsonb; outg jsonb;
begin
 if auth.uid() is null then raise exception 'Not signed in'; end if; select id into a from public.profiles where id=auth.uid(); select id into b from public.profiles where lower(username)=lower(trim(both '@' from p_from_username)); if a is null or b is null then raise exception 'User not found'; end if;
 if a<b then select * into me from public.profiles where id=a for update; select * into other from public.profiles where id=b for update; else select * into other from public.profiles where id=b for update; select * into me from public.profiles where id=a for update; end if;
 inc:=coalesce(me.private_data->'friendRequests'->'incoming','[]'::jsonb); outg:=coalesce(other.private_data->'friendRequests'->'outgoing','[]'::jsonb); inc:=(select coalesce(jsonb_agg(v),'[]'::jsonb) from jsonb_array_elements_text(inc) v where v<>other.username); outg:=(select coalesce(jsonb_agg(v),'[]'::jsonb) from jsonb_array_elements_text(outg) v where v<>me.username); me.private_data:=jsonb_set(coalesce(me.private_data,'{}'::jsonb),'{friendRequests,incoming}',inc,true); other.private_data:=jsonb_set(coalesce(other.private_data,'{}'::jsonb),'{friendRequests,outgoing}',outg,true); update public.profiles set private_data=me.private_data,updated_at=now() where id=me.id; update public.profiles set private_data=other.private_data,updated_at=now() where id=other.id; return true;
end; $$;

create or replace function public.rivo_toggle_like(p_username text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare me public.profiles; target public.profiles; users jsonb; uname text; was boolean;
begin
 if auth.uid() is null then raise exception 'Not signed in'; end if; select * into me from public.profiles where id=auth.uid(); uname:=lower(trim(both '@' from p_username)); select * into target from public.profiles where lower(username)=uname for update; if me.id is null or target.id is null then raise exception 'User not found'; end if; if me.username=target.username then raise exception 'You cannot like your own profile'; end if;
 users:=coalesce(target.public_data->'likes'->'users','[]'::jsonb); was:=exists(select 1 from jsonb_array_elements_text(users) v where v=me.username); if was then users:=(select coalesce(jsonb_agg(v),'[]'::jsonb) from jsonb_array_elements_text(users) v where v<>me.username); else users:=users||to_jsonb(me.username); end if;
 target.public_data:=jsonb_set(coalesce(target.public_data,'{}'::jsonb),'{likes}',jsonb_build_object('count',jsonb_array_length(users),'users',users),true); update public.profiles set public_data=target.public_data,updated_at=now() where id=target.id; return jsonb_build_object('liked',not was,'count',jsonb_array_length(users));
end; $$;

revoke all on function public.rivo_send_friend_request(text) from public; grant execute on function public.rivo_send_friend_request(text) to authenticated;
revoke all on function public.rivo_accept_friend_request(text) from public; grant execute on function public.rivo_accept_friend_request(text) to authenticated;
revoke all on function public.rivo_reject_friend_request(text) from public; grant execute on function public.rivo_reject_friend_request(text) to authenticated;
revoke all on function public.rivo_toggle_like(text) from public; grant execute on function public.rivo_toggle_like(text) to authenticated;
revoke all on function public.rivo_remove_friend(text) from public; grant execute on function public.rivo_remove_friend(text) to authenticated;

do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='profiles') then
    execute 'alter publication supabase_realtime add table public.profiles';
  end if;
exception when undefined_object then null; end $$;

notify pgrst,'reload schema';
