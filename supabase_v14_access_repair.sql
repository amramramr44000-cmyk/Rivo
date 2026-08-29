-- Rivo v14: resilient friends/profile access repair
-- Safe/idempotent: does not delete users or existing friendship data.

-- Keep friend-request RPCs executable for signed-in users.
revoke all on function public.rivo_send_friend_request(text) from public;
grant execute on function public.rivo_send_friend_request(text) to authenticated;

revoke all on function public.rivo_accept_friend_request(text) from public;
grant execute on function public.rivo_accept_friend_request(text) to authenticated;

revoke all on function public.rivo_reject_friend_request(text) from public;
grant execute on function public.rivo_reject_friend_request(text) to authenticated;

revoke all on function public.rivo_remove_friend(text) from public;
grant execute on function public.rivo_remove_friend(text) to authenticated;

-- Public profile lookup must be callable by authenticated users.
revoke all on function public.rivo_get_public_profile(text) from public;
grant execute on function public.rivo_get_public_profile(text) to anon, authenticated;

revoke all on function public.rivo_get_public_profiles(text[]) from public;
grant execute on function public.rivo_get_public_profiles(text[]) to anon, authenticated;

-- Keep profile-view analytics non-blocking for readers.
revoke all on function public.rivo_add_view(text) from public;
grant execute on function public.rivo_add_view(text) to anon, authenticated;

-- Existing media bucket should remain readable so public profile media opens
-- even when the viewer is not the uploader.
drop policy if exists "rivo_media_read" on storage.objects;
create policy "rivo_media_read"
on storage.objects for select to public
using (bucket_id = 'rivo-media');

-- Refresh schema cache after RPC changes.
notify pgrst, 'reload schema';
