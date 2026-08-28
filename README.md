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

No third-party CAPTCHA setup is required. The browser presents a single familiar verification square and runs the layered local anti-automation checks already included in the project. Keep the Supabase Auth rate limits enabled in production.
