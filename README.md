# Rivo — Cloud Edition

Rivo is now a **GitHub Pages + Supabase** project.

GitHub Pages hosts the HTML/CSS/JavaScript. Supabase provides the shared backend:
- Supabase Auth: registration, login and persistent sessions
- PostgreSQL: profiles, settings, friends, friend requests, likes and view counters
- Supabase Storage: avatar, banner, mini image, music cover and music files

## Setup

### 1. Create a Supabase project
Create a project at https://supabase.com/.

### 2. Create the database
Open **SQL Editor** and run the entire `supabase_schema.sql` file.

### 3. Configure Auth
In **Authentication → Providers → Email**, turn **Confirm email** OFF for this version of Rivo.  
The UI uses username + password; internally each username gets a private synthetic auth email such as `username@users.rivo.app`.

### 4. Add your public keys
Open:

`js/supabase-config.js`

Replace:
- `url` with your Supabase Project URL
- `anonKey` with the Supabase **anon/public** key

Do **not** put a `service_role` or secret key in the browser.

### 5. Deploy to GitHub Pages
Push the project to GitHub and publish it with GitHub Pages.

No PHP/Python server is required. The browser talks directly to Supabase over HTTPS.

## Important migration note

The old build used IndexedDB, so data from the old local version is not automatically uploaded to Supabase.  
Accounts created after this cloud version is configured are stored centrally and can be used from other devices.

## Media

Rivo uploads selected images/audio to the `rivo-media` Storage bucket on profile save and then stores permanent URLs in PostgreSQL. This avoids keeping large base64 media blobs inside the profile row.

## Security

Supabase Auth handles passwords. Database Row Level Security limits direct profile-row access to the signed-in owner. Public profile/search/social actions are exposed through controlled PostgreSQL functions.

For a real production launch, add email verification, password reset and a custom server-side username/login flow instead of relying on synthetic auth email addresses.


## Performance + messaging

The newer build keeps the existing profile schema/data intact and adds: cached profile reads, batched friend/profile loading, debounced search, parallel media uploads, and a dedicated text-only messaging system.

After deploying the code, run the latest `supabase_schema.sql` once in Supabase SQL Editor. The migration only adds the `rivo_messages` table/functions and messaging preference data under each profile's existing `private_data`.


## Rivo v5 upgrade
This build adds PWA installation, light/dark mode, realtime notification center, browser notifications, five message reactions, emoji-only message styling, profile visitor tracking, and a protected admin dashboard.

### One-time Supabase admin bootstrap
After applying the full `supabase_schema.sql`, make your own account an admin once from the Supabase SQL Editor:
```sql
insert into public.rivo_admin_users(user_id)
select id from public.profiles where username='YOUR_USERNAME';
```
The dashboard is at `pages/admin.html`. Never expose a service-role key in the website.


## Stories
Run `supabase_schema.sql` to enable one active Story per account for 12 hours, avatar story rings, story likes, unique viewer counts, owner deletion, and expiry cleanup. Story images are resized to 1080px and videos are reduced to a mobile-friendly 720p/24fps format in browsers that support MediaRecorder.

## Story storage cleanup fix

Supabase does not permit deleting `storage.objects` directly from PostgreSQL. Story deletion now removes the database row through RPC and removes the owner's media through the Supabase Storage API in the client. Expired stories are removed from the database by the cleanup RPC; a trusted server/Edge Function should be used for unattended physical cleanup of expired Storage objects.


## Rivo v10 security + authentication fix

This build fixes the signed-out login failure by removing the pre-authenticated `profiles` lookup. The username is normalized into the same synthetic Auth email used at registration, then Supabase Auth performs the actual credential check. The old session/profile cache is also cleared on logout so switching accounts cannot reuse stale profile data.

New account creation now uses a stronger password policy (10–128 characters with at least three character classes), a hidden honeypot, minimum interaction time, and a custom Rivo Human Check. The checkbox triggers a short SHA-256 proof-of-work plus interaction-signal checks before the Auth request is allowed. This adds friction to simple automation without introducing a third-party CAPTCHA dependency. For high-risk production deployments, also add server-side rate limiting / abuse monitoring because no browser-only control can be made impossible to automate.

### Rivo Human Check

No Cloudflare or other CAPTCHA setup is required. The browser presents a single familiar “I’m human” checkbox and runs the layered local checks already included in the project. Keep the Supabase Auth rate limits enabled in production.

## Rivo Social v1 additions

This build adds:

- `pages/posts.html`: social feed with post creation, up to 5 images per post, comments, 5 reaction types (`❤️ 😂 👍 😮 😢`) with one reaction per user, and reposts.
- Profile posts: each profile now shows its published posts and posts reposted by that profile.
- `pages/communities.html`: community discovery, community creation, public/friends/request-only join policies, owner approval/decline, member removal, and group chat.
- Realtime community messages through Supabase Realtime.
- All new writes are mediated by Supabase RPC functions and the new schema is included at the end of `supabase_schema.sql`.

### Supabase update
Run the complete `supabase_schema.sql` file in the Supabase SQL Editor for the project. Keep the existing `rivo-media` storage bucket and existing RLS/storage policies. No manual data migration is required for existing profiles, friends, messages, or stories.

## Calling privacy
Calls support Everyone / Friends only / Nobody under Settings → Calls. The call permission is enforced by Supabase RPC.


## Rivo Calls — cross-network reliability

The call client now supports TURN credentials and ICE restart. This is important when two users are on different networks/NATs: STUN can discover routes, while TURN provides a relay when direct ICE candidates cannot connect.

### Supabase Edge Function
Deploy `supabase/functions/rivo-turn/index.ts` as the `rivo-turn` function.

Set these server-side Supabase Function Secrets:
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_TURN_KEY_ID`
- `CLOUDFLARE_TURN_API_TOKEN`

Create a Cloudflare Realtime TURN key first. Do NOT place the Cloudflare API token in `js/supabase-config.js` or any browser code.

The browser is configured to call:
`https://stfjcrcualeggmiygqur.supabase.co/functions/v1/rivo-turn`

The client falls back to STUN if TURN credentials are unavailable, but reliable calls between restrictive/mobile networks require the TURN function to be deployed and configured.

## Rivo Calls — LiveKit Cloud

The call UI is preserved, but media transport now uses LiveKit Cloud instead of raw WebRTC/STUN/TURN. Supabase Realtime remains responsible for ringing, accept/decline, and hangup signaling. LiveKit's browser SDK handles audio/video transport, reconnection, adaptive streaming, and cross-network routing.

Deploy the bundled token function:

```bash
supabase functions deploy rivo-livekit-token
```

The exact function source is included at `supabase/functions/rivo-livekit-token/index.ts`, so you do not need to retype it in the Supabase Editor.

Set these Supabase Edge Function secrets (Dashboard → Edge Functions → Secrets):

- `LIVEKIT_URL` — your LiveKit Cloud WebSocket URL (`wss://...livekit.cloud`)
- `LIVEKIT_API_KEY` — LiveKit API key
- `LIVEKIT_API_SECRET` — LiveKit API secret

Never put the LiveKit API secret in `js/supabase-config.js` or any browser file. The Edge Function validates the user's Supabase session and mints a short-lived room token.

The frontend calls:
`https://stfjcrcualeggmiygqur.supabase.co/functions/v1/rivo-livekit-token`

The LiveKit client SDK is loaded from jsDelivr in the HTML pages. For production, pin and self-host the SDK if you want full control over dependency delivery.


## Calls v11 improvements
- LiveKit remains the media transport; the existing Rivo call UI is preserved.
- Audio capture uses WebRTC echo cancellation, noise suppression and auto gain control.
- LiveKit adaptive streaming + dynacast are enabled to reduce video bandwidth/CPU and adapt to network conditions.
- A connection-quality indicator is shown during calls.
- In-call audio output routing is exposed where the browser supports audio output selection; wired/Bluetooth devices are allowed to follow the phone/browser routing policy.
- A true in-app mini-call mode lets the user keep the call visible while interacting with the current Rivo page.
- Reconnection policy and initial connection retry settings were strengthened.


## Final cosmetic cleanup
- Removed the in-call minimize button and its mini-call behavior from the UI.
- Removed the in-call audio-output selector UI so the browser/device keeps its normal audio output behavior.
- No call signaling, LiveKit connection, token flow, media quality, or database logic was intentionally changed in this pass.


## Targeted Phase 2 additions (v21)
- Three-line mobile menu now shows **Sign out** for authenticated users; guests see **Sign in**.
- Added compact WhatsApp-style voice-message recording/sending to Messages. Voice files use the private `rivo-voice` Storage bucket.
- Added a small **Report** action on posts; each account can report a post once, and a post is removed automatically when it reaches 10 unique reports.
- Added an admin account editor for username/display name and **password reset**. Existing passwords are never readable/retrievable; the admin UI only lets an admin set a new password.
- New SQL migration: `supabase_phase3_voice_reports_admin.sql`. Run it once in Supabase SQL Editor.
- New Edge Function: `supabase/functions/rivo-admin-update-user/index.ts`. Deploy it as `rivo-admin-update-user` and keep the Supabase service-role key server-side.


## v23 surface fixes
- Call timer starts on successful initial LiveKit connection and stops on teardown.
- Mobile notifications portal the existing popover to document.body while open to avoid sticky-header/overflow stacking issues.
- Post images are clickable and open in a lightweight viewer with close/Escape support.
