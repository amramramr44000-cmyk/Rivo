# Rivo LiveKit token function

Deploy this function to the same Supabase project as Rivo.

Required Edge Function secrets:
- LIVEKIT_URL = your LiveKit Cloud WebSocket URL, e.g. wss://your-project.livekit.cloud
- LIVEKIT_API_KEY = LiveKit API key
- LIVEKIT_API_SECRET = LiveKit API secret

The browser never receives LIVEKIT_API_SECRET. The function validates the caller's Supabase JWT and mints a short-lived room token.

Deploy:

supabase functions deploy rivo-livekit-token

Then test Rivo from two devices on different networks.
