# Rivo direct-call one-way audio fix

Changed only `js/app.js`. Direct 1-to-1 calls now:
- request microphone permission from the Call/Accept user gesture;
- avoid the more aggressive `voiceIsolation` constraint in direct calls;
- verify the microphone publication after LiveKit connects;
- explicitly publish a local audio track as a fallback if the normal helper fails;
- restore the microphone publication after reconnects;
- preserve an intentional mute state so reconnect logic does not unmute a user.

No Supabase SQL or community voice files were changed.
