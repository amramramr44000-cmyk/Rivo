# Rivo deployment checklist

## New Supabase project

1. Create the Supabase project and save its project URL and **publishable/anon** key.
2. Run `supabase_schema.sql` once.
3. Run `supabase_economy.sql` if the store, coin inventory, or paid cosmetics are enabled.
4. For direct calls and paginated message history, make sure the private messaging prerequisites are installed, then run the current `supabase_rivo_v4_call_security_message_pagination.sql`. It enforces call privacy when ringing and accepting, and closes pending rings when a stricter setting is saved. See `RIVO_V4_DEPLOYMENT_AR.md`.
5. If signup protection is enabled, run `supabase_signup_captcha.sql` and deploy both `rivo-signup-captcha` and `rivo-signup` from this archive.
6. Deploy the `rivo-livekit-token` function from `supabase/functions/rivo-livekit-token`. Keep `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET` in Supabase Function Secrets. The function also uses the Supabase-provided `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` environment values.
7. Verify the Edge Function uses JWT verification and that the frontend points to the same Supabase project in `js/supabase-config.js`.
8. Deploy `rivo-admin-update-user` if you plan to use admin account editing. It uses the standard `SUPABASE_SERVICE_ROLE_KEY` environment variable and still checks the caller's admin status.
9. Test on a staging project before inviting real users.

The complete `supabase_schema.sql` contains the community and community voice schema. Existing projects may need `supabase_communities_v6_mobile_voice_security.sql` if V6 was not applied; that migration makes empty-room cleanup server-only. Existing projects should use their migration history to determine which community migrations are missing; do not replay the full schema as a general update.

## Existing Supabase project

- Take a database backup and record the current deployed commit and applied migrations.
- Do not run the full schema or a stack of historical `*_fix.sql` files without checking dependencies.
- Do not mix the legacy `supabase_phase2_call_ring.sql` table with the current v4 call schema. If the legacy table exists, stop and prepare a reviewed staging conversion first.
- Apply only migrations that are not already installed, in their documented order, on staging first.
- Deploy Edge Functions only after their required tables and RPCs exist.
- Confirm Auth settings, Storage bucket policies, RLS, and Function Secrets in the target project.
- Keep service-role keys, LiveKit secrets, and Spotify secrets out of browser files and Git history.

## Optional feature intentionally inactive

Spotify Now Playing is parked until you choose to configure it. Its browser integration and SQL migration are present, but the Edge Function source is not included in this archive. No Spotify configuration is needed for the rest of Rivo; keep the integration inactive until you are ready to implement and deploy its server function.

## Profile animation V33

Before using Ember Rise, Firefly Drift, or Orbital Passage in production, run `supabase_profile_animations_v33.sql` after V32. This seeds the exact catalog items and updates the profile ownership guard. Existing profile animation values remain valid.