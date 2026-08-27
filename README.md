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
