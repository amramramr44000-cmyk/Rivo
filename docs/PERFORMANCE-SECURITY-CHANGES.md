# Security and performance notes

## LiveKit authorization

The `rivo-livekit-token` Edge Function validates the caller's Supabase bearer token and attaches it to authenticated RPC calls. Direct-call tokens require an active `rivo_call_sessions` row where the caller is one of the two participants. Community voice tokens require an active room and current community membership. The server enforces the five-participant community voice cap and persisted mute state.

Presence reconciliation is a separate `sync_presence` action. It checks the caller's membership and the room/community identifier before using the server-only LiveKit Room Service API. Empty-room cleanup runs through the server-only database RPC.

Required database objects are provided by `supabase_schema.sql`, the Community V6 migration where needed, and `supabase_rivo_v4_call_security_message_pagination.sql` for direct-call sessions. Review `DEPLOYMENT-CHECKLIST.md` before deploying.

## Limits

- The frontend is a static client. Database authorization and service secrets must remain server-side.
- JavaScript parsing does not prove that Supabase policies, migrations, LiveKit networking, or cross-device UI behavior work in the target deployment.
- Large images, realtime feeds, voice/video calls, and moderation require staging and load testing before a public launch.
- Spotify Now Playing is intentionally inactive until configured. Its server function is not part of this archive.
