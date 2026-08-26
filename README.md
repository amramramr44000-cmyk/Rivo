# ProfileForge — Local Edition

ProfileForge is a local-first interactive profile/portfolio platform. This edition is intentionally built to run without a server, hosting, Supabase, OAuth provider, or API key.

## What works

- Username-only account creation and sign-in
- Unique username validation and reserved-name protection
- Real persistent storage with IndexedDB (browser-native local database; SQLite is intentionally not bundled in the no-server build)
- Session persistence in the browser
- Profile editor with live preview
- Avatar, banner and floating mini-image upload with WebP compression
- 50 visual template identities
- Accent colors, radius and glow controls
- Re-orderable profile sections
- Social links, skills and projects
- Badge selection
- Public profile view using `profile.html?u=username`
- Search by username or display name
- Friend requests: send, accept, decline, remove
- Profile views and basic statistics
- Responsive desktop/tablet/mobile UI
- English / Arabic direction toggle
- No mock API calls and no fake Save buttons

## Run

Because this is a static local application, you can open `index.html` directly in a modern Chromium/Firefox browser.

For the most consistent IndexedDB (browser-native local database; SQLite is intentionally not bundled in the no-server build) behavior, use a local static server:

```bash
python -m http.server 8080
```

Then open:

`http://localhost:8080/`

No package installation is required.

## Data model

All profile records live in the browser's IndexedDB (browser-native local database; SQLite is intentionally not bundled in the no-server build) database named `ProfileForgeLocal`.

This means:

- Data survives refreshes and browser restarts.
- Data is local to this browser/device.
- Other devices cannot see the same accounts.
- Clearing site data removes the local database.

This local architecture is deliberate for a no-hosting environment. A hosted production release can later replace the storage adapter with Supabase without rebuilding the UI.

## Security note

This local edition does not claim to provide production-grade remote authentication. Username-only sign-in is appropriate for this offline/local product and deliberately avoids passwords and OAuth secrets.

## Structure

- `index.html` — landing page
- `pages/login.html` — sign in
- `pages/signup.html` — account creation
- `pages/profile.html` — public profile
- `pages/editor.html` — profile editor
- `pages/explore.html` — search
- `pages/friends.html` — friend management
- `css/style.css` — complete visual system
- `js/core.js` — IndexedDB (browser-native local database; SQLite is intentionally not bundled in the no-server build), authentication/session, profile data and social operations
- `js/app.js` — page controllers and UI behavior

## License

MIT — see `LICENSE`.
