# Rivo Hub v4 — Notes

See `docs/RIVO_V4_TECHNICAL_REPORT_AR.md` for what changed and `docs/RIVO_V4_DEPLOYMENT_AR.md` for the staged deployment sequence.

This build includes a new additive migration (`supabase_rivo_v4_call_security_message_pagination.sql`). It depends on the corrected private messaging v2 schema, must be tested on staging first, and has not been executed against any database as part of this delivery.
