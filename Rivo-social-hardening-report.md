# Rivo Social/Auth Hardening Report

## Root cause found

1. `PF.currentUsername()` was directly reading `localStorage("rivo_username")`. That value was a browser cache, not Supabase Auth identity, so an old username could survive session transitions and be used by UI code for self/owner checks.
2. `currentProfile()` used a single global `sessionStorage` cache key (`rivo_current_profile_v2`). A profile object from account A could therefore be returned to account B on the same browser/tab until the short TTL expired.
3. The service worker used a fixed shell cache version, so a desktop browser could continue serving an older `core.js/app.js` build after deployment.
4. Friend-request RPCs locked the two profile rows in caller-dependent order. A simultaneous A→B and B→A request could therefore deadlock or conflict.
5. Profile Like was a toggle operation. A repeated click or duplicate request could turn a successful Like back into Unlike.
6. Post-action UI refreshes sometimes used cached reads instead of explicitly forcing a database reread.

## Fix implemented

- Current identity is now an in-memory mirror of Supabase Auth only.
- Critical operations call `auth.getUser()` before the RPC.
- `currentProfile()` uses a cache key containing the authenticated Supabase user UUID and rejects cache entries whose `id` does not match that UUID.
- Legacy `rivo_username` and old current-profile cache state are cleared and never trusted for authorization/identity decisions.
- Login explicitly clears the previous local Auth context before switching accounts.
- RPC failures log operation, authenticated UID, target ID/username, Supabase error code and message.
- Auth-expiry failures refresh the session once and retry the RPC once; no retry loop is allowed.
- Social actions force-refresh both current and target profile state after a successful database operation.
- Profile Like now uses an explicit idempotent `rivo_set_profile_like(username, liked)` RPC, preventing accidental toggle reversal on duplicate requests.
- Friend-request/accept/reject/remove RPCs lock both profiles in deterministic UUID order.
- Own-profile Realtime subscription keeps the authenticated profile cache synchronized across tabs/devices where the user's own row changes.
- Realtime publication now includes `profiles` so the own-profile subscription can receive updates.
- Service-worker cache version bumped to `rivo-shell-v12` so the hardened JS is not intentionally held behind the old v11 shell cache.
- UI disables Like/Add Friend/Accept/Reject/Remove buttons while their authoritative operation is in flight.

## Database model verified

This project does **not** have standalone `likes`, `friend_requests`, or `friendships` tables. Profile likes and friend relationships are stored in JSONB fields inside `public.profiles`.

Therefore the fix preserves that existing schema instead of introducing a destructive or unnecessary migration. `profiles` RLS remains based on `auth.uid() = id`, while social writes remain security-definer RPC operations whose actor is obtained from `auth.uid()`.

## Files changed

- `js/core.js`
- `js/app.js`
- `sw.js`
- `supabase_schema.sql`
- `supabase_identity_social_hardening.sql` (new safe migration)

No LiveKit call UI/code or messaging implementation was intentionally changed.

## Static verification completed

- `node --check` passed for every JavaScript file in the project.
- Repository scan found no direct use of `localStorage/sessionStorage` to determine the current Rivo account.
- No `window.currentUser`, `window.userId`, `window.profileId`, `cachedUser`, or `cachedProfile` authorization variables were found.
- Hardening migration contains no destructive commands such as table drops, truncates, profile/post deletes, schema drops, or auth-user deletes.

## Deployment requirement

The browser changes and the SQL migration must both be deployed. The new SQL migration is safe to run on the existing database and does not reset application data.

Recommended order:

1. Run `supabase_identity_social_hardening.sql` in the existing Supabase SQL Editor.
2. Deploy the project files.
3. Hard-refresh/open a fresh browser tab so the v12 service worker replaces the old shell.
4. Re-test the A/B scenarios from real authenticated sessions.

## Live test limitation

This artifact was inspected and statically validated locally. A real end-to-end test of two Supabase accounts across two physical clients cannot be truthfully reported as completed here without access to authenticated test accounts and the live Supabase environment.
