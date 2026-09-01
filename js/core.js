/* Rivo Cloud Engine
   GitHub Pages + Supabase edition.
   Auth/session -> Supabase Auth
   Profiles/social data -> PostgreSQL
   Images/audio -> Supabase Storage
*/
(() => {
  "use strict";

  const cfg = window.RIVO_SUPABASE || {};
  const READY = !!(window.supabase && cfg.url && cfg.anonKey &&
    !String(cfg.url).includes("YOUR_SUPABASE") &&
    !String(cfg.anonKey).includes("YOUR_SUPABASE"));

  if (!READY) {
    console.warn("[Rivo] Supabase is not configured. Edit js/supabase-config.js first.");
  }

  const sb = READY ? window.supabase.createClient(cfg.url, cfg.anonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  }) : null;
  window.__rivoSupabase = sb;

  const CACHE_KEY = "rivo_username";
  const MEDIA_BUCKET = "rivo-media";
  const PROFILE_CACHE_PREFIX = "rivo_profile_v2:";
  // Shortened from the previous 45s/20s: long TTLs made message-privacy
  // changes, new avatars, etc. feel like they "didn't save" because a
  // stale cached copy kept getting served. Short TTLs + the explicit
  // invalidateProfileCache() calls after every write keep things both
  // fast (still cached for rapid repeat reads) and accurate.
  const PROFILE_CACHE_TTL = 20 * 1000;
  const CURRENT_PROFILE_CACHE_KEY = "rivo_current_profile_v2";
  const CURRENT_PROFILE_CACHE_TTL = 8 * 1000;

  function cacheRead(key, ttl) {
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return null;
      const item = JSON.parse(raw);
      if (!item || Date.now() - Number(item.t) > ttl) { sessionStorage.removeItem(key); return null; }
      return item.v ?? null;
    } catch { return null; }
  }
  function cacheWrite(key, value) {
    try { sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), v: value })); } catch {}
  }
  function cacheDelete(key) { try { sessionStorage.removeItem(key); } catch {} }
  function invalidateProfileCache(username = "") {
    if (username) cacheDelete(PROFILE_CACHE_PREFIX + normalizeUsername(username));
    cacheDelete(CURRENT_PROFILE_CACHE_KEY);
  }

  const defaults = {
    username: "", displayName: "", bio: "", description: "", location: "", website: "",
    avatar: "", banner: "", miniImage: "", status: "Online", customStatus: "",
    theme: "obsidian", template: "discord-noir", accent: "#7488ff", cardRadius: 24,
    cardStyle: "glass", glow: 45, background: "aurora", animation: "soft",
    socials: [], skills: [], badges: [], projects: [], friends: [],
    friendRequests: { incoming: [], outgoing: [] },
    following: [],
    followers: [],
    sections: [
      { id: crypto.randomUUID ? crypto.randomUUID() : "about", type: "about", title: "About Me", visible: true },
      { id: crypto.randomUUID ? crypto.randomUUID() : "friends", type: "friends", title: "Friends", visible: true }
    ],
    music: { title: "", artist: "", cover: "", audio: "", mime: "", size: 0 },
    avatarFrame: "none", avatarFrameColor: "#8b5cf6", avatarFrameGlow: 35, avatarFrameWidth: 3,
    stats: { views: 0 }, likes: { count: 0, users: [] },
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  };

  const badgeCatalog = [
    { id:"verified", name:"Verified", icon:"✓", rarity:"Legendary" },
    { id:"developer", name:"Developer", icon:"⌘", rarity:"Rare" },
    { id:"creator", name:"Creator", icon:"✦", rarity:"Rare" },
    { id:"gamer", name:"Gamer", icon:"◈", rarity:"Common" },
    { id:"early", name:"Early User", icon:"⚡", rarity:"Epic" },
    { id:"vip", name:"VIP", icon:"◆", rarity:"Epic" },
    { id:"top", name:"Top Creator", icon:"★", rarity:"Legendary" },
    { id:"trusted", name:"Trusted", icon:"◉", rarity:"Rare" }
  ];

  const templates = [
    ["discord-noir","Discord Noir","Compact social HUD with layered panels"],
    ["anime-cinema","Anime Cinema","Cinematic portrait stage with editorial framing"],
    ["neon-arena","Neon Arena","Competitive energy with luminous stat rails"],
    ["cyber-terminal","Cyber Terminal","Technical console surfaces and diagnostic accents"],
    ["dark-luxury","Dark Luxury","Editorial obsidian with premium metallic details"],
    ["minimal-ice","Minimal Ice","Quiet ultra-clean portfolio with precision spacing"],
    ["samurai-ink","Samurai Ink","Ink-poster composition with sharp blade dividers"],
    ["deep-space","Deep Space","Cosmic depth with orbit-like atmosphere"],
    ["creator-pulse","Creator Pulse","Media-first layout with rhythmic signal details"],
    ["monochrome-pro","Monochrome Pro","Executive grayscale with strict geometry"],
    ["starlight-royal","Starlight Royal","Starfield identity with constellation highlights"],
    ["aurora-glass","Aurora Glass","Aurora gradients through crystalline glass layers"],
    ["obsidian-court","Obsidian Court","Luxury court-inspired layout with rich framing"],
    ["pixel-arcade","Pixel Arcade","Retro pixel-inspired HUD with game-status details"],
    ["botanical-night","Botanical Night","Organic night-garden identity with elegant leaf motifs"],
    ["white-atelier","White Atelier","Editorial white canvas with gallery-grade spacing"],
    ["white-signal","White Signal","Crisp white tech card with precise signal geometry"]
  ];

  function requireClient() {
    if (!READY || !sb) throw new Error("Rivo is not connected to Supabase. Configure js/supabase-config.js.");
  }
  function normalizeUsername(value) {
    return String(value || "").trim().replace(/^@+/, "").toLowerCase();
  }
  function validUsername(value) {
    const u = normalizeUsername(value);
    return /^(?=.{3,26}$)[a-z0-9](?:[a-z0-9._-]*[a-z0-9])$/.test(u) &&
      !["admin","administrator","support","help","rivo","root","system","api","null","undefined"].includes(u);
  }
  function currentUsername() { return localStorage.getItem(CACHE_KEY) || ""; }
  function cacheUsername(username) {
    const u = normalizeUsername(username);
    if (u) localStorage.setItem(CACHE_KEY, u); else localStorage.removeItem(CACHE_KEY);
  }
  function setSession(username) { cacheUsername(username); }
  async function clearSession() {
    // Clear browser-side identity data BEFORE navigation so a later login
    // can never hydrate a stale account from the previous session.
    cacheUsername("");
    cacheDelete(CURRENT_PROFILE_CACHE_KEY);
    try { sessionStorage.removeItem("rivo_profiles_list_v2"); } catch {}
    if (sb) {
      const { error } = await sb.auth.signOut();
      if (error) throw error;
    }
  }
  function publicData(profile) {
    const p = structuredClone(profile || {});
    delete p.password;
    delete p.friendRequests;
    return p;
  }
  function mergeProfile(row, includePrivate = false) {
    const p = structuredClone(row?.public_data || {});
    p.username = row?.username || p.username || "";
    p.createdAt = row?.created_at || p.createdAt;
    if (row && row.coins_balance != null) p.coinsBalance = Number(row.coins_balance) || 0;
    p.updatedAt = row?.updated_at || p.updatedAt;
    if (includePrivate) {
      const priv = row?.private_data || {};
      p.friendRequests = priv.friendRequests || { incoming: [], outgoing: [] };
      p.messageSettings = { whoCanMessage: ["friends","nobody"].includes(priv.messageSettings?.whoCanMessage) ? priv.messageSettings.whoCanMessage : "everyone" };
      p.callSettings = { whoCanCall: ["friends","nobody"].includes(priv.callSettings?.whoCanCall) ? priv.callSettings.whoCanCall : "everyone" };
      p.birthDate = typeof priv.birthDate === "string" ? priv.birthDate : (p.birthDate || "");
    }
    return p;
  }

  // ---------------------------------------------------------------------
  // Session-authoritative operation guard.
  //
  // Every operation below identifies "who is doing this" strictly from
  // Supabase Auth (auth.getSession() on the client / auth.uid() on the
  // server) — never from the cached username in localStorage. That cache
  // exists only for instant, non-authoritative UI decisions (e.g. showing
  // a "sign in" link), and is refreshed from the real session on every
  // auth state change, login and logout so it cannot leak between accounts.
  //
  // Root cause this section fixes: a desktop tab left open in the
  // background for a long stretch gets its JS timers throttled by the
  // browser, so supabase-js's built-in autoRefreshToken can miss its
  // window and the access token silently goes stale. The next click
  // (Like, friend request, opening a profile, ...) then goes out with a
  // dead token, Postgres/PostgREST reject it, and the UI either showed a
  // generic "Access denied" or quietly reverted. Phones rarely hit this
  // because backgrounding a mobile browser tab usually reloads the page on
  // return, re-authenticating from scratch. Desktop tabs do not.
  //
  // The fix: before every authenticated call we make sure the session is
  // live, and if the call still fails with an auth-shaped error we force
  // exactly ONE token refresh and retry the SAME call ONE time — never
  // more, so a genuinely dead session fails fast with a clear message
  // instead of looping.
  // ---------------------------------------------------------------------
  function isAuthError(error) {
    if (!error) return false;
    const code = String(error.code || "").toLowerCase();
    const status = Number(error.status || 0);
    const msg = String(error.message || "").toLowerCase();
    return status === 401 || status === 403 ||
      code === "pgrst301" || code === "42501" ||
      msg.includes("jwt") || msg.includes("token") || msg.includes("expired") ||
      msg.includes("not signed in") || msg.includes("invalid refresh token") ||
      msg.includes("row-level security") || msg.includes("row level security") ||
      msg.includes("permission denied");
  }

  async function getLiveSession() {
    try {
      const { data, error } = await sb.auth.getSession();
      if (error) return null;
      return data?.session || null;
    } catch { return null; }
  }

  let refreshInFlight = null;
  async function forceRefreshSession() {
    // Coalesce concurrent refresh attempts (e.g. several buttons clicked at
    // once right as the token expires) into a single network round-trip.
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async () => {
      try {
        const { data, error } = await sb.auth.refreshSession();
        if (error) return null;
        return data?.session || null;
      } catch { return null; }
    })();
    try { return await refreshInFlight; } finally { refreshInFlight = null; }
  }

  function opError(opName, message, meta) {
    const e = new Error(message);
    e.op = opName;
    if (meta) Object.assign(e, meta);
    return e;
  }

  // Runs fn(session) against a guaranteed-live session. On any failure it
  // logs full diagnostics (operation name, auth.uid(), the target of the
  // operation, and the real Supabase error code/message) instead of
  // swallowing them into a generic message. If the failure looks
  // auth-shaped, it forces one token refresh and retries fn() exactly once.
  async function withAuthedOp(opName, target, fn) {
    requireClient();
    let session = await getLiveSession();
    if (!session?.user?.id) session = await forceRefreshSession();
    if (!session?.user?.id) {
      console.error("[Rivo]", opName, { auth_uid: null, target, error: "no active session" });
      throw opError(opName, "Your session expired. Please sign in again.", { code: "NO_SESSION" });
    }
    await syncRealtimeAuth(session);
    try {
      return await fn(session);
    } catch (error) {
      if (!isAuthError(error)) {
        console.error("[Rivo]", opName, { auth_uid: session.user.id, target, code: error?.code, message: error?.message });
        throw opError(opName, error?.message || "Something went wrong.", { code: error?.code });
      }
      console.warn("[Rivo]", opName, "auth-shaped failure — refreshing session and retrying once", { auth_uid: session.user.id, target, code: error?.code, message: error?.message });
      const refreshed = await forceRefreshSession();
      if (!refreshed?.user?.id) {
        console.error("[Rivo]", opName, { auth_uid: session.user.id, target, code: error?.code, message: error?.message, retried: false });
        throw opError(opName, "Your session expired. Please sign in again.", { code: "SESSION_EXPIRED" });
      }
      await syncRealtimeAuth(refreshed);
      try {
        return await fn(refreshed);
      } catch (error2) {
        console.error("[Rivo]", opName, { auth_uid: refreshed.user.id, target, code: error2?.code, message: error2?.message, retried: true });
        throw opError(opName, error2?.message || "Something went wrong.", { code: error2?.code });
      }
    }
  }

  // Same retry-on-auth-error diagnostics as withAuthedOp, but for reads
  // that are also allowed for signed-out guests (e.g. viewing a public
  // profile) — so, unlike withAuthedOp, it must NOT treat "no session" as
  // a failure by itself.
  async function withRetryOnAuthError(opName, target, fn) {
    requireClient();
    try {
      return await fn();
    } catch (error) {
      if (!isAuthError(error)) {
        console.error("[Rivo]", opName, { target, code: error?.code, message: error?.message });
        throw opError(opName, error?.message || "Something went wrong.", { code: error?.code });
      }
      const session = await getLiveSession();
      console.warn("[Rivo]", opName, "auth-shaped failure — refreshing session and retrying once", { auth_uid: session?.user?.id || null, target, code: error?.code, message: error?.message });
      const refreshed = await forceRefreshSession();
      if (refreshed?.user?.id) await syncRealtimeAuth(refreshed);
      try {
        return await fn();
      } catch (error2) {
        console.error("[Rivo]", opName, { auth_uid: refreshed?.user?.id || null, target, code: error2?.code, message: error2?.message, retried: true });
        throw opError(opName, error2?.message || "Something went wrong.", { code: error2?.code });
      }
    }
  }

  // Prevents a rapid double-click (Like spammed, Add Friend mashed, Accept
  // pressed twice) from firing the same mutation twice before the first
  // response lands. Keyed per operation+target so unrelated actions never
  // block each other, and never blocks a *second, different* operation.
  const inFlightOps = new Map();
  function withInFlightGuard(key, fn) {
    if (inFlightOps.has(key)) return inFlightOps.get(key);
    const p = (async () => {
      try { return await fn(); }
      finally { inFlightOps.delete(key); }
    })();
    inFlightOps.set(key, p);
    return p;
  }

  async function currentProfile(options = {}) {
    requireClient();
    const force = !!options.force;
    if (!force) {
      const cached = cacheRead(CURRENT_PROFILE_CACHE_KEY, CURRENT_PROFILE_CACHE_TTL);
      if (cached?.id) return cached;
    }
    return withAuthedOp("PROFILE_READ", "self", async (session) => {
      for (let attempt = 0; attempt < 4; attempt++) {
        const { data, error } = await sb.from("profiles")
          .select("id,username,public_data,private_data,coins_balance,created_at,updated_at")
          .eq("id", session.user.id).maybeSingle();
        if (error) throw error;
        if (data) {
          cacheUsername(data.username);
          const merged = mergeProfile(data, true);
          merged.id = data.id;
          cacheWrite(CURRENT_PROFILE_CACHE_KEY, merged);
          return merged;
        }
        // Row not visible yet right after signup — not an auth failure,
        // just replication lag. Keep waiting instead of bailing out.
        if (attempt < 3) await new Promise(r => setTimeout(r, 300 * (attempt + 1)));
      }
      return null;
    });
  }

  async function getProfile(username, options = {}) {
    requireClient();
    const u = normalizeUsername(username);
    if (!u) return null;
    if (!options.force) {
      const cached = cacheRead(PROFILE_CACHE_PREFIX + u, PROFILE_CACHE_TTL);
      if (cached) return cached;
    }
    const data = await withRetryOnAuthError("PROFILE_READ", u, async () => {
      const { data, error } = await sb.rpc("rivo_get_public_profile", { p_username: u });
      if (error) throw error;
      return data;
    });
    if (!data) return null;
    cacheWrite(PROFILE_CACHE_PREFIX + u, data);
    return data;
  }

  async function getProfiles(usernames) {
    requireClient();
    const names = [...new Set((usernames || []).map(normalizeUsername).filter(Boolean))];
    if (!names.length) return [];
    const missing = [];
    const ready = [];
    for (const u of names) {
      const cached = cacheRead(PROFILE_CACHE_PREFIX + u, PROFILE_CACHE_TTL);
      if (cached) ready.push(cached); else missing.push(u);
    }
    if (missing.length) {
      const data = await withRetryOnAuthError("PROFILE_READ", missing, async () => {
        const { data, error } = await sb.rpc("rivo_get_public_profiles", { p_usernames: missing });
        if (error) throw error;
        return data;
      });
      for (const p of (Array.isArray(data) ? data : [])) { cacheWrite(PROFILE_CACHE_PREFIX + p.username, p); ready.push(p); }
    }
    const byName = new Map(ready.map(p => [p.username, p]));
    return names.map(u => byName.get(u)).filter(Boolean);
  }

  async function listProfiles() {
    requireClient();
    const key = "rivo_profiles_list_v2";
    const cached = cacheRead(key, 30 * 1000);
    if (cached) return cached;
    const data = await withRetryOnAuthError("PROFILE_LIST", null, async () => {
      const { data, error } = await sb.rpc("rivo_list_public_profiles", { p_limit: 24 });
      if (error) throw error;
      return data;
    });
    const list = Array.isArray(data) ? data : [];
    list.forEach(p => cacheWrite(PROFILE_CACHE_PREFIX + p.username, p));
    cacheWrite(key, list);
    return list;
  }

  async function searchUsers(query) {
    requireClient();
    const q = String(query || "").trim().toLowerCase().replace(/^@/, "");
    if (!q) return [];
    const data = await withRetryOnAuthError("PROFILE_SEARCH", q, async () => {
      const { data, error } = await sb.rpc("rivo_search_profiles", { p_query: q, p_limit: 24 });
      if (error) throw error;
      return data;
    });
    return Array.isArray(data) ? data : [];
  }

  function dataUrlToBlob(dataUrl) {
    const [meta, body] = String(dataUrl).split(",");
    const mime = (meta.match(/data:([^;]+)/) || [,"application/octet-stream"])[1];
    const bin = atob(body || "");
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  async function uploadBlob(blob, path, mime) {
    requireClient();
    if (!(blob instanceof Blob)) throw new Error("Invalid media data.");
    const { error } = await sb.storage.from(MEDIA_BUCKET).upload(path, blob, {
      contentType: blob.type || mime || "application/octet-stream",
      cacheControl: "3600",
      upsert: false
    });
    if (error) throw error;
    return sb.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
  }

  async function uploadDataUrl(dataUrl, path, mime) {
    return uploadBlob(dataUrlToBlob(dataUrl), path, mime);
  }

  async function persistMedia(profile) {
    const { data: { session } } = await sb.auth.getSession();
    const uid = session?.user?.id;
    if (!uid) throw new Error("Your session expired. Please sign in again.");
    const out = structuredClone(profile);
    const stamp = `${Date.now()}-${crypto.randomUUID()}`;
    const media = [
      ["avatar", "image/webp"], ["banner", "image/webp"], ["miniImage", "image/webp"],
      ["music.cover", "image/webp"], ["music.audio", out.music?.mime || "audio/mpeg"]
    ];
    await Promise.all(media.map(async ([key, fallbackMime]) => {
      const parts = key.split(".");
      const value = parts.length === 1 ? out[key] : out[parts[0]]?.[parts[1]];
      if (!String(value || "").startsWith("data:")) return;
      const ext = fallbackMime.startsWith("image/") ? "webp" :
        (fallbackMime.includes("ogg") ? "ogg" : fallbackMime.includes("wav") ? "wav" : fallbackMime.includes("mp4") ? "m4a" : "mp3");
      const path = `${uid}/${stamp}-${parts.join("-")}.${ext}`;
      const url = await uploadDataUrl(value, path, fallbackMime);
      if (parts.length === 1) out[key] = url;
      else { out[parts[0]] ||= {}; out[parts[0]][parts[1]] = url; }
    }));
    return out;
  }

  async function saveProfile(profile) {
    requireClient();
    if (!profile?.username) throw new Error("Invalid profile.");
    const me = await currentProfile();
    if (!me) throw new Error("No signed-in profile.");
    const row = await persistMedia(profile);
    row.username = normalizeUsername(row.username);
    row.friendRequests = undefined;
    const payload = {
      username: row.username,
      public_data: publicData(row),
      updated_at: new Date().toISOString()
    };
    return withAuthedOp("PROFILE_UPDATE", row.username, async (session) => {
      const { data, error } = await sb.from("profiles")
        .update(payload).eq("id", session.user.id)
        .select("id,username,public_data,private_data,coins_balance,created_at,updated_at").single();
      if (error) throw error;
      cacheUsername(data.username);
      invalidateProfileCache(data.username);
      const merged = mergeProfile(data, true);
      merged.id = data.id;
      cacheWrite(CURRENT_PROFILE_CACHE_KEY, merged);
      cacheWrite(PROFILE_CACHE_PREFIX + data.username, merged);
      return merged;
    });
  }

  async function updateProfile(patch) {
    const current = await currentProfile();
    if (!current) throw new Error("No signed-in profile.");
    return saveProfile({ ...current, ...patch });
  }

  async function createAccount({ username, displayName, password, birthDate }) {
    requireClient();
    const u = normalizeUsername(username);
    if (!validUsername(u)) throw new Error("Username must be 3–26 characters: letters, numbers, . _ -.");
    if (!String(displayName || "").trim()) throw new Error("Display name is required.");
    const birthDateValue = String(birthDate || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDateValue)) throw new Error("Birth date is required.");
    const parsedBirthDate = new Date(`${birthDateValue}T00:00:00Z`);
    if (Number.isNaN(parsedBirthDate.getTime())) throw new Error("Enter a valid birth date.");
    if (parsedBirthDate > new Date()) throw new Error("Birth date cannot be in the future.");
    const passwordValue = String(password || "");
    if (passwordValue.length < 8) throw new Error("Password must be at least 8 characters.");
    if (passwordValue.length > 28) throw new Error("Password must be 28 characters or fewer.");
    const classes = [/[a-z]/.test(passwordValue), /[A-Z]/.test(passwordValue), /\d/.test(passwordValue), /[^A-Za-z0-9]/.test(passwordValue)].filter(Boolean).length;
    if (classes < 3) throw new Error("Use a stronger password: mix uppercase, lowercase, numbers and/or symbols.");
    const weak = new Set(["password123", "password123!", "qwerty1234", "1234567890", "letmein123", "welcome123"]);
    if (weak.has(passwordValue.toLowerCase())) throw new Error("Choose a less predictable password.");
    const { data: existing, error: lookupError } = await sb.rpc("rivo_username_exists", { p_username: u });
    if (lookupError) throw lookupError;
    if (existing) throw new Error("That username is already taken.");

    const syntheticEmail = `${u}@users.rivo.app`;
    const captcha = window.__rivoSignupCaptcha || null;
    if (!captcha?.challengeId || !captcha?.verificationToken) {
      throw new Error("Complete the security verification first.");
    }
    const captchaEndpoint = String(window.RIVO_SECURITY?.signupCaptchaEndpoint || "").trim();
    if (!captchaEndpoint) throw new Error("Security check is not configured.");
    const captchaReserve = await fetch(captchaEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "apikey": window.RIVO_SUPABASE?.anonKey || "" },
      body: JSON.stringify({ action: "consume_signup", challengeId: String(captcha.challengeId), verificationToken: String(captcha.verificationToken) })
    });
    const captchaPayload = await captchaReserve.json().catch(() => ({}));
    if (!captchaReserve.ok) throw new Error(String(captchaPayload?.error || "Security verification failed. Please verify again."));

    const signUpOptions = {};
    const { data: auth, error: authError } = await sb.auth.signUp({
      email: syntheticEmail,
      password: passwordValue,
      options: signUpOptions
    });
    if (authError) throw authError;
    if (!auth.user || !auth.session) {
      throw new Error("Supabase email confirmations are enabled. Disable email confirmation in Supabase Auth, then create the account again.");
    }

    const now = new Date().toISOString();
    const base = structuredClone(defaults);
    base.username = u;
    base.displayName = String(displayName).trim().slice(0, 28);
    base.birthDate = birthDateValue;
    base.createdAt = now; base.updatedAt = now;
    const { error } = await sb.from("profiles").insert({
      id: auth.user.id,
      username: u,
      auth_email: syntheticEmail,
      public_data: publicData(base),
      private_data: { birthDate: birthDateValue, friendRequests: { incoming: [], outgoing: [] } }
    });
    if (error) {
      const msg = String(error.message || "");
      // The profile row is created immediately after Auth. If it fails, remove
      // the just-created Auth user as well, so signup never leaves an orphan
      // auth.users record that blocks the same username/email on retry.
      try { await sb.rpc("rivo_delete_current_auth_user"); } catch {}
      try { await sb.auth.signOut(); } catch {}
      if (msg.includes("duplicate")) throw new Error("That username is already taken.");
      if (msg.includes("profiles_username_check") || msg.includes("violates check constraint")) {
        throw new Error("That username is not accepted by the database. Please use 3–26 lowercase letters, numbers, . _ - and no symbol at the beginning or end.");
      }
      throw error;
    }
    cacheUsername(u);
    return base;
  }

  async function login(username, password) {
    requireClient();
    const u = normalizeUsername(username);
    if (!u) throw new Error("Enter your username.");
    const passwordValue = String(password || "");
    if (!passwordValue) throw new Error("Enter your password.");

    // The auth email is deterministic from the username, so do not query
    // public.profiles while signed out. RLS correctly blocks that query for
    // guests, which was the cause of the post-logout "correct password" bug.
    const syntheticEmail = `${u}@users.rivo.app`;
    const signInOptions = {};
    cacheDelete(CURRENT_PROFILE_CACHE_KEY);
    cacheUsername("");
    const { data, error } = await sb.auth.signInWithPassword({
      email: syntheticEmail,
      password: passwordValue,
      options: signInOptions
    });
    if (error || !data.user) throw new Error("Incorrect username or password.");
    cacheUsername(u);
    const profile = await currentProfile({ force: true });
    if (!profile) {
      await sb.auth.signOut();
      cacheUsername("");
      throw new Error("Your account was authenticated, but the profile data is still syncing. Please try again.");
    }
    return profile;
  }

  async function deleteProfile(username) {
    // Kept for API compatibility. Deleting a profile must be an explicit account action.
    return false;
  }

  async function callRpc(name, args, opName) {
    return withAuthedOp(opName || name, args, async () => {
      const { data, error } = await sb.rpc(name, args || {});
      if (error) throw error;
      return data;
    });
  }

  async function sendFriendRequest(targetUsername) {
    const u = normalizeUsername(targetUsername);
    return withInFlightGuard(`FRIEND_REQUEST_INSERT:${u}`, async () => {
      const result = await callRpc("rivo_send_friend_request", { p_target_username: u }, "FRIEND_REQUEST_INSERT");
      invalidateProfileCache(u);
      return result;
    });
  }
  async function acceptFriendRequest(fromUsername) {
    const u = normalizeUsername(fromUsername);
    return withInFlightGuard(`FRIEND_REQUEST_ACCEPT:${u}`, async () => {
      // Accepting is what actually creates the friendship server-side
      // (FRIENDSHIP_CREATE), so a failure here is tagged with both codes
      // in the console diagnostics.
      const result = await callRpc("rivo_accept_friend_request", { p_from_username: u }, "FRIEND_REQUEST_ACCEPT/FRIENDSHIP_CREATE");
      invalidateProfileCache(u);
      return result;
    });
  }
  async function rejectFriendRequest(fromUsername) {
    const u = normalizeUsername(fromUsername);
    return withInFlightGuard(`FRIEND_REQUEST_REJECT:${u}`, async () => {
      const result = await callRpc("rivo_reject_friend_request", { p_from_username: u }, "FRIEND_REQUEST_REJECT");
      invalidateProfileCache(u);
      return result;
    });
  }
  async function cancelFriendRequest(targetUsername) {
    const u = normalizeUsername(targetUsername);
    return withInFlightGuard(`FRIEND_REQUEST_CANCEL:${u}`, async () => {
      const result = await callRpc("rivo_cancel_friend_request", { p_target_username: u }, "FRIEND_REQUEST_CANCEL");
      invalidateProfileCache(u);
      return result;
    });
  }
  function isFollowing(targetUsername) {
    const u = normalizeUsername(targetUsername);
    return !!u && currentProfileCachedSnapshot().following.includes(u);
  }
  function currentProfileCachedSnapshot() {
    try {
      const raw = sessionStorage.getItem(CURRENT_PROFILE_CACHE_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      const p = parsed?.v || {};
      return { following: Array.isArray(p.following) ? p.following : [] };
    } catch { return { following: [] }; }
  }
  async function toggleFollow(targetUsername) {
    const u = normalizeUsername(targetUsername);
    return withInFlightGuard(`FOLLOW_TOGGLE:${u}`, async () => {
      const result = await callRpc("rivo_toggle_follow", { p_target_username: u }, "FOLLOW_TOGGLE");
      invalidateProfileCache(u);
      return result;
    });
  }
  async function removeFriend(username) {
    const u = normalizeUsername(username);
    return withInFlightGuard(`FRIENDSHIP_REMOVE:${u}`, async () => {
      const result = await callRpc("rivo_remove_friend", { p_username: u }, "FRIENDSHIP_REMOVE");
      invalidateProfileCache(u);
      return result;
    });
  }
  async function toggleLike(username) {
    const u = normalizeUsername(username);
    return withInFlightGuard(`LIKE_TOGGLE:${u}`, async () => {
      const result = await callRpc("rivo_toggle_like", { p_username: u }, "LIKE_TOGGLE");
      invalidateProfileCache(u);
      return result;
    });
  }
  function friendshipState(profile, targetUsername) {
    const u = normalizeUsername(targetUsername);
    if (!profile || !u) return "none";
    if ((profile.friends || []).includes(u)) return "friends";
    if ((profile.friendRequests?.outgoing || []).includes(u)) return "outgoing";
    if ((profile.friendRequests?.incoming || []).includes(u)) return "incoming";
    return "none";
  }
  async function addView(username) {
    return callRpc("rivo_add_view", { p_username: normalizeUsername(username) }, "PROFILE_VIEW_ADD");
  }

  function normalizeWhoCanMessage(value) {
    return value === "friends" ? "friends" : value === "nobody" ? "nobody" : "everyone";
  }
  function normalizeWhoCanCall(value) {
    return value === "friends" ? "friends" : value === "nobody" ? "nobody" : "everyone";
  }
  async function getCallSettings() {
    const me = await currentProfile();
    return { whoCanCall: normalizeWhoCanCall(me?.callSettings?.whoCanCall) };
  }
  async function setCallSetting(value) {
    const v = normalizeWhoCanCall(value);
    await callRpc("rivo_set_call_setting", { p_who_can_call: v });
    invalidateProfileCache(currentUsername());
    return v;
  }
  async function getMessageSettings() {
    const me = await currentProfile();
    return { whoCanMessage: normalizeWhoCanMessage(me?.messageSettings?.whoCanMessage) };
  }
  async function setMessageSetting(value) {
    const v = normalizeWhoCanMessage(value);
    await callRpc("rivo_set_message_setting", { p_who_can_message: v });
    // Invalidate both the private (own) cache and the public-profile cache so
    // the "Messages closed" state shows up immediately on anyone viewing this
    // profile, instead of waiting out the old cached copy.
    invalidateProfileCache(currentUsername());
    return v;
  }
  async function sendMessage(username, content) {
    const u = normalizeUsername(username);
    // Normalize to NFC so the same word typed on different devices/keyboards
    // (phones in particular often produce differently-composed Unicode for
    // the same visible Arabic text) is always stored and compared consistently.
    const text = String(content || "").trim().normalize("NFC");
    if (!u || !text) throw new Error("Message and recipient are required.");
    if (text.length > 2000) throw new Error("Message is too long (max 2000 characters).");
    return callRpc("rivo_send_message", { p_receiver_username: u, p_content: text });
  }
  async function listConversations() {
    return callRpc("rivo_list_conversations");
  }
  async function getMessages(username, limit = 80) {
    return callRpc("rivo_get_messages", { p_other_username: normalizeUsername(username), p_limit: Math.max(1, Math.min(Number(limit) || 80, 200)) });
  }

  async function getCoinBalance() { return Number(await callRpc("rivo_get_coin_balance", {}, "COIN_BALANCE_READ")) || 0; }
  async function listStoreItems(type = null) { return callRpc("rivo_list_store_items", { p_type: type || null }, "STORE_LIST"); }
  async function listMyInventory() { return callRpc("rivo_list_my_inventory", {}, "INVENTORY_LIST"); }
  async function purchaseStoreItem(itemId) { return withInFlightGuard(`STORE_PURCHASE:${itemId}`, async () => { const result = await callRpc("purchase_store_item", { target_item_id: itemId }, "STORE_PURCHASE"); invalidateProfileCache(currentUsername()); return result; }); }
  async function transferCoinsByUsername(username, amount) { return withInFlightGuard(`COIN_TRANSFER:${normalizeUsername(username)}:${Number(amount)}`, async () => { const result = await callRpc("transfer_coins_by_username", { target_username: String(username || ""), transfer_amount: Math.floor(Number(amount) || 0) }, "COIN_TRANSFER"); invalidateProfileCache(currentUsername()); return result; }); }
  async function rewardAdCoins(amount = 15) { return withInFlightGuard("COIN_AD_REWARD", async () => { const result = await callRpc("reward_ad_coins", { reward_amount: Math.floor(Number(amount) || 15) }, "COIN_AD_REWARD"); invalidateProfileCache(currentUsername()); return result; }); }
  async function equipStoreItem(itemId) { return withInFlightGuard(`STORE_EQUIP:${itemId}`, async () => { const result = await callRpc("equip_store_item", { target_item_id: itemId }, "STORE_EQUIP"); invalidateProfileCache(currentUsername()); return result; }); }
  async function getEquippedStoreItems(username) {
    requireClient();
    return callRpc("rivo_get_public_profile", { p_username: normalizeUsername(username) }, "EQUIPPED_ITEMS_READ").then(p => Array.isArray(p?.equippedStoreItems) ? p.equippedStoreItems : []);
  }

  // Live message delivery. Rebuilt to be self-healing: it keeps the Realtime
  // websocket authenticated with the current session, listens with a tight
  // per-user filter (instead of the whole table) for speed and accuracy,
  // automatically reconnects if the socket drops or errors out, and
  // resyncs whenever the tab/app comes back to the foreground so nothing
  // requires a manual page reload to show up.
  async function subscribeMessages(callback, onResync) {
    requireClient();
    let stopped = false;
    let channel = null;
    let retryDelay = 1000;
    let retryTimer = null;
    let heartbeatTimer = null;

    const seen = new Set(); // de-dupe: INSERT can be delivered by both filtered channels below
    const emit = row => {
      if (!row || !row.id) return;
      const key = String(row.id);
      if (seen.has(key)) return;
      seen.add(key);
      if (seen.size > 500) { const first = seen.values().next().value; seen.delete(first); }
      callback?.(row);
    };

    async function connect() {
      if (stopped) return;
      const { data: { session } } = await sb.auth.getSession();
      const myId = session?.user?.id || null;
      if (!myId) return;
      await syncRealtimeAuth(session);

      if (channel) { try { await sb.removeChannel(channel); } catch {} channel = null; }

      channel = sb.channel(`rivo-messages-${myId}`)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "rivo_messages", filter: `sender_id=eq.${myId}` }, payload => emit(payload?.new))
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "rivo_messages", filter: `receiver_id=eq.${myId}` }, payload => emit(payload?.new))
        .subscribe(status => {
          if (stopped) return;
          if (status === "SUBSCRIBED") {
            retryDelay = 1000;
            onResync?.();
          } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            scheduleReconnect();
          }
        });
    }

    function scheduleReconnect() {
      if (stopped || retryTimer) return;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        retryDelay = Math.min(retryDelay * 2, 15000);
        connect();
      }, retryDelay);
    }

    const onVisible = () => {
      if (document.visibilityState !== "visible" || stopped) return;
      // Coming back from background: make sure the socket is alive and
      // pull anything that may have been missed while it was suspended.
      connect();
      onResync?.();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("online", onVisible);

    // Safety-net poll: if for any reason the socket silently stalls
    // (some mobile browsers suspend websockets without firing a close
    // event), this nudges a resync every 20s so messages never sit
    // unseen for more than a few seconds.
    heartbeatTimer = setInterval(() => { onResync?.(); }, 12000);

    await connect();

    return async () => {
      stopped = true;
      clearTimeout(retryTimer);
      clearInterval(heartbeatTimer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("online", onVisible);
      if (channel) { try { await sb.removeChannel(channel); } catch {} }
    };
  }

  // -----------------------------
  // Lightweight WebRTC call signaling
  // -----------------------------
  async function getCallUser(username) {
    const p = await getProfile(username, { force: false });
    if (!p?.userId || !p?.username) throw new Error("User is unavailable for calling.");
    const allowed = await callRpc("rivo_can_call_user", { p_target_username: normalizeUsername(username) });
    if (!allowed) throw new Error("This user is not accepting calls from you.");
    return p;
  }
  async function canReceiveCallFrom(username) {
    return !!(await callRpc("rivo_can_receive_call", { p_caller_username: normalizeUsername(username) }));
  }

  async function openCallChannel(channelName, onSignal) {
    requireClient();
    const session = (await sb.auth.getSession()).data?.session;
    if (!session?.user?.id) throw new Error("Please sign in to call.");
    await syncRealtimeAuth(session);
    const channel = sb.channel(String(channelName), {
      config: { broadcast: { self: false } }
    });
    channel.on("broadcast", { event: "signal" }, ({ payload }) => {
      try { onSignal?.(payload || {}); } catch {}
    });
    await channel.subscribe();
    return {
      send: payload => channel.send({ type: "broadcast", event: "signal", payload }),
      close: async () => { try { await sb.removeChannel(channel); } catch {} }
    };
  }

  async function subscribeCallInbox(userId, onSignal) {
    const id = String(userId || "").trim();
    if (!id) return async () => {};
    const box = await openCallChannel(`rivo-call-inbox-${id}`, onSignal);
    return box.close;
  }

  async function subscribePresence(username, onChange) {
    requireClient();
    const me = normalizeUsername(username);
    if (!me) return { unsubscribe: async () => {}, update: async () => {} };
    const channel = sb.channel("rivo-presence", {
      config: { presence: { key: me } }
    });
    const state = { username: me, online: true, typingTo: "" };
    const api = { state: {}, update: async () => {}, unsubscribe: async () => {} };
    const emit = (event = "sync") => {
      api.state = channel.presenceState();
      onChange?.({ event, state: api.state });
    };
    channel.on("presence", { event: "sync" }, () => emit("sync"));
    channel.on("presence", { event: "join" }, () => emit("join"));
    channel.on("presence", { event: "leave" }, ({ key }) => onChange?.({ event: "leave", key, state: channel.presenceState() }));
    await channel.subscribe(async s => {
      if (s === "SUBSCRIBED") {
        await channel.track(state);
        emit("sync");
      }
    });
    api.update = async patch => {
      Object.assign(state, patch || {});
      try { await channel.track(state); } catch {}
    };
    api.unsubscribe = async () => {
      try { await channel.untrack(); } catch {}
      await sb.removeChannel(channel);
    };
    return api;
  }

  async function ensureDemoAccount() { return false; }

  async function compressImage(file, maxW=1280, quality=.8) {
    if (!file || !file.type.startsWith("image/")) throw new Error("Please choose a valid image.");
    if (file.size > 10 * 1024 * 1024) throw new Error("Image must be 10 MB or smaller.");
    if (file.type === "image/gif") {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Could not read GIF."));
        reader.readAsDataURL(file);
      });
    }
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxW / bitmap.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d", {alpha:true});
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    return canvas.toDataURL("image/webp", quality);
  }

  // -----------------------------
  // Rivo Stories (12-hour, one active story per account)
  // -----------------------------
  async function getStory(username, options = {}) {
    requireClient();
    const u = normalizeUsername(username);
    if (!u) return null;
    const { data, error } = await sb.rpc("rivo_get_story", {
      p_username: u,
      p_count_view: options.countView !== false
    });
    if (error) throw error;
    return data || null;
  }

  async function listStoryStatuses(usernames) {
    requireClient();
    const names = [...new Set((usernames || []).map(normalizeUsername).filter(Boolean))];
    if (!names.length) return [];
    const { data, error } = await sb.rpc("rivo_get_story_statuses", { p_usernames: names });
    if (error) throw error;
    return Array.isArray(data) ? data : [];
  }

  async function createStoryFromFile(file) {
    requireClient();
    if (!file) throw new Error("Choose an image for your story.");
    if (!String(file.type || "").startsWith("image/")) throw new Error("Stories support images only.");
    const allowed = ["image/jpeg", "image/png", "image/webp"];
    if (!allowed.includes(file.type)) throw new Error("Supported story images: JPG, PNG, or WebP.");
    const { data: { session } } = await sb.auth.getSession();
    const uid = session?.user?.id;
    const username = currentUsername();
    if (!uid || !username) throw new Error("Your session expired. Please sign in again.");

    const existing = await getStory(username, { countView: false });
    if (existing?.active) throw new Error("You already have an active story. Open it and delete it before adding another.");

    const stamp = `${Date.now()}-${crypto.randomUUID()}`;
    if (file.size > 12 * 1024 * 1024) throw new Error("Story image must be 12 MB or smaller.");
    const dataUrl = await compressImage(file, 1080, .84);
    const blob = dataUrlToBlob(dataUrl);
    const mime = "image/webp";
    const storagePath = `${uid}/stories/${stamp}.webp`;
    const publicUrl = await uploadBlob(blob, storagePath, mime);
    try {
      const { data, error } = await sb.rpc("rivo_create_story", {
        p_media_url: publicUrl,
        p_storage_path: storagePath,
        p_media_type: mime,
        p_duration_seconds: 12
      });
      if (error) throw error;
      invalidateProfileCache(username);
      return data;
    } catch (e) {
      try { await sb.storage.from(MEDIA_BUCKET).remove([storagePath]); } catch {}
      throw e;
    }
  }

  async function deleteStory(storyId) {
    requireClient();
    const { data, error } = await sb.rpc("rivo_delete_story", { p_story_id: Number(storyId) });
    if (error) throw error;
    const result = data || {};
    // Supabase Storage objects must be removed through the Storage API, never by SQL.
    if (result.deleted && result.storage_path) {
      const { error: storageError } = await sb.storage.from(MEDIA_BUCKET).remove([result.storage_path]);
      if (storageError) {
        console.warn("Story row deleted but media cleanup failed:", storageError);
      }
    }
    invalidateProfileCache(currentUsername());
    return result;
  }

  async function toggleStoryLike(storyId) {
    requireClient();
    const { data, error } = await sb.rpc("rivo_toggle_story_like", { p_story_id: Number(storyId) });
    if (error) throw error;
    return data || { liked: false, likes_count: 0 };
  }

  async function readAudio(file) {
    if (!file || !file.type.startsWith("audio/")) throw new Error("Please choose a valid audio file.");
    if (file.size > 10 * 1024 * 1024) throw new Error("Audio must be 10 MB or smaller.");
    const allowed = ["audio/mpeg","audio/mp3","audio/ogg","audio/wav","audio/x-wav","audio/mp4","audio/aac","audio/webm"];
    if (!allowed.includes(file.type) && !/\.(mp3|ogg|wav|m4a|aac|webm)$/i.test(file.name)) {
      throw new Error("Supported audio: MP3, OGG, WAV, M4A, AAC or WebM.");
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({ data:String(reader.result), mime:file.type || "audio/mpeg", size:file.size, name:file.name });
      reader.onerror = () => reject(new Error("Could not read audio."));
      reader.readAsDataURL(file);
    });
  }

  function initials(p) {
    return (p?.displayName || p?.username || "?").split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join("").toUpperCase();
  }
  function safeUrl(value) {
    try {
      const u = new URL(String(value || "").trim());
      return ["http:","https:"].includes(u.protocol) ? u.href : "";
    } catch { return ""; }
  }
  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  // Keep Realtime's websocket auth in sync with the current session at all times.
  // Without this, a channel opened before the session token is (re)applied will be
  // treated as unauthenticated by the RLS-protected `rivo_messages` table, silently
  // dropping every postgres_changes event until the page is fully reloaded.
  async function syncRealtimeAuth(session) {
    if (!sb) return;
    try { await sb.realtime.setAuth(session?.access_token || null); } catch {}
  }


  function applySavedColorScheme() {
    const saved = localStorage.getItem("rivo_color_scheme");
    const mode = saved === "light" || saved === "dark" ? saved : (window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark");
    document.documentElement.dataset.colorScheme = mode;
  }
  applySavedColorScheme();

  // Rivo full interface language layer.
  // Arabic translates the app chrome/UI only and deliberately keeps the document LTR.
  // User-created names, usernames, bios, posts and messages are never translated.
  const NAV_I18N = {
    en: { menu:"Menu", search:"Search", profile:"Profile", messages:"Messages", home:"Home",
      posts:"Posts", communities:"Communities", explore:"Explore", friends:"Friends",
      editor:"Editor", settings:"Settings", signin:"Sign in", signout:"Sign out", createprofile:"Create profile",
      notifications:"Notifications" },
    ar: { menu:"القائمة", search:"بحث", profile:"الملف الشخصي", messages:"الرسائل", home:"الرئيسية",
      posts:"المنشورات", communities:"المجتمعات", explore:"استكشاف", friends:"الأصدقاء",
      editor:"المحرر", settings:"الإعدادات", signin:"تسجيل الدخول", signout:"تسجيل الخروج", createprofile:"إنشاء حساب",
      notifications:"الإشعارات" }
  };

  const I18N = {
    "Home":"الرئيسية","Posts":"المنشورات","Communities":"المجتمعات","Explore":"استكشاف","Search":"بحث",
    "Messages":"الرسائل","Friends":"الأصدقاء","Profile":"الملف الشخصي","Editor":"المحرر","Edit profile":"تعديل الملف الشخصي",
    "Settings":"الإعدادات","Sign in":"تسجيل الدخول","Sign out":"تسجيل الخروج","Create profile":"إنشاء حساب",
    "Create your profile":"أنشئ ملفك الشخصي","Create my profile":"إنشاء ملفي الشخصي","Already have a profile?":"لديك ملف شخصي بالفعل؟",
    "New here?":"جديد هنا؟","Verify":"تحقق","Verified":"تم التحقق","Save":"حفظ","Send":"إرسال","Cancel":"إلغاء",
    "Upload":"رفع","Edit":"تعديل","Delete":"حذف","Remove":"إزالة","Accept":"قبول","Decline":"رفض","View":"عرض",
    "Ready":"جاهز","Loading…":"جارٍ التحميل…","Loading feed…":"جارٍ تحميل المنشورات…","Loading communities…":"جارٍ تحميل المجتمعات…",
    "Loading profile":"جارٍ تحميل الملف الشخصي","Loading admin tools":"جارٍ تحميل أدوات الإدارة","Unavailable":"غير متاح",
    "None":"لا يوجد","Everyone":"الجميع","Friends only":"الأصدقاء فقط","Nobody":"لا أحد","Nobody (close messages)":"لا أحد (إغلاق الرسائل)",
    "ACCOUNT":"الحساب","Appearance":"المظهر","Calls":"المكالمات","Messages.":"الرسائل","Notifications":"الإشعارات",
    "About":"حول","About Rivo":"حول Rivo","Storage":"التخزين","Cloud data":"البيانات السحابية","Session":"الجلسة",
    "Display name":"اسم العرض","Username":"اسم المستخدم","Password":"كلمة المرور","Confirm password":"تأكيد كلمة المرور",
    "Birth date":"تاريخ الميلاد","Location":"الموقع","Bio":"نبذة","Social links":"الروابط الاجتماعية",
    "Projects & music":"المشاريع والموسيقى","Projects and music":"المشاريع والموسيقى","Avatar":"الصورة الشخصية","Banner":"الغلاف",
    "Badges":"الشارات","Avatar frame":"إطار الصورة","Accent color":"اللون المميز","Card shape":"شكل البطاقة",
    "Sections":"الأقسام","Media":"الوسائط","Music cover":"غلاف الموسيقى","Upload audio":"رفع ملف صوتي","Choose audio":"اختيار ملف صوتي",
    "Choose image":"اختيار صورة","Choose cover":"اختيار الغلاف","Gallery":"المعرض","Preview":"معاينة",
    "LIVE PREVIEW":"المعاينة المباشرة","Templates":"القوالب","Profile basics":"أساسيات الملف الشخصي","Profile account":"حساب الملف الشخصي",
    "Account settings":"إعدادات الحساب","Manage your account details from one place.":"أدر تفاصيل حسابك من مكان واحد.",
    "Account details and the safe sign-out area.":"تفاصيل الحساب ومنطقة تسجيل الخروج الآمنة.",
    "Choose the interface theme for this device. Your profile design stays unchanged.":"اختر مظهر الواجهة لهذا الجهاز. يظل تصميم ملفك الشخصي كما هو.",
    "Choose your preferred language. This translates navigation and is saved across pages — full in-page content translation is coming soon.":"اختر لغتك المفضلة. سيتم حفظها وتطبيقها على واجهة التطبيق.",
    "Who can call you?":"من يمكنه الاتصال بك؟","Who can message you?":"من يمكنه مراسلتك؟",
    "Save call privacy":"حفظ خصوصية المكالمات","Save message privacy":"حفظ خصوصية الرسائل",
    "Private conversations with voice and video calling.":"محادثات خاصة مع المكالمات الصوتية والمرئية.",
    "Choose who is allowed to start a voice or video call with you.":"اختر من يمكنه بدء مكالمة صوتية أو مرئية معك.",
    "Choose who can start a text conversation with you.":"اختر من يمكنه بدء محادثة نصية معك.",
    "Your messages.":"رسائلك.","Conversations":"المحادثات","Choose a conversation":"اختر محادثة",
    "Select someone from the left to start messaging.":"اختر شخصًا من القائمة لبدء المراسلة.",
    "Search people…":"البحث عن أشخاص…","Search people...":"البحث عن أشخاص…","Search friends...":"البحث عن الأصدقاء…",
    "Write a message...":"اكتب رسالة…","Write a message…":"اكتب رسالة…","Send voice":"إرسال الرسالة الصوتية",
    "Hold to record":"اضغط باستمرار للتسجيل","Voice message":"رسالة صوتية","Voice ready":"الرسالة الصوتية جاهزة",
    "Choose an image":"اختر صورة","Choose a conversation":"اختر محادثة","Private messages":"الرسائل الخاصة",
    "Find people.":"اعثر على أشخاص.","Find your room.":"اعثر على مجتمعك.","Your circle.":"دائرتك.",
    "Friends and requests":"الأصدقاء والطلبات","Requests":"الطلبات","No pending requests.":"لا توجد طلبات معلقة.",
    "No friends found.":"لم يتم العثور على أصدقاء.","Friend added":"تمت إضافة الصديق","Friend removed":"تم حذف الصديق",
    "Request declined":"تم رفض الطلب","View Profile":"عرض الملف الشخصي","View":"عرض",
    "Search by username or display name.":"ابحث باسم المستخدم أو اسم العرض.",
    "No profiles found":"لم يتم العثور على ملفات شخصية","No friends found.":"لم يتم العثور على أصدقاء",
    "Create a profile":"إنشاء ملف شخصي","Create Profile — Rivo":"إنشاء حساب — Rivo","Sign In — Rivo":"تسجيل الدخول — Rivo",
    "Sign in to your Rivo account.":"سجّل الدخول إلى حسابك في Rivo.",
    "3–26 characters: letters, numbers, . _ -":"من 3 إلى 26 حرفًا: حروف وأرقام و . _ -",
    "3–26 chars: letters, numbers, . _ -":"من 3 إلى 26 حرفًا: حروف وأرقام و . _ -",
    "Choose year, month and day":"اختر السنة والشهر واليوم","Select your birth date":"اختر تاريخ ميلادك",
    "Enter Profile":"أدخل إلى الملف الشخصي","Verification code":"رمز التحقق","Type the code":"اكتب الرمز",
    "Verification complete.":"اكتمل التحقق.","Security check is not configured.":"لم يتم إعداد فحص الأمان.",
    "Security check could not be completed. Please try again.":"تعذر إكمال فحص الأمان. حاول مرة أخرى.",
    "Enter the 5–6 character code.":"أدخل الرمز المكوّن من 5–6 أحرف.",
    "Checking…":"جارٍ التحقق…","Verification failed. Try a new code.":"فشل التحقق. جرّب رمزًا جديدًا.",
    "I'm human":"أنا لست روبوتًا","SECURITY CHECK":"فحص الأمان",
    "One local app, five real tools":"تطبيق واحد بخمس أدوات حقيقية","Local-first interactive profiles":"ملفات شخصية تفاعلية محلية أولًا",
    "Built for phones":"مصمم للهواتف","Same profile engine used on the public page":"نفس محرك الملف المستخدم في الصفحة العامة",
    "Full editor control":"تحكم كامل في المحرر","Cloud database + media storage":"قاعدة بيانات سحابية + تخزين الوسائط",
    "Avatar, banner & music":"الصورة والغلاف والموسيقى","Choose up to 3":"اختر حتى 3",
    "Add link":"+ إضافة رابط","+ Add link":" إضافة رابط",
    "Social":"اجتماعي","People":"الأشخاص","Feed":"المنشورات","ABOUT RIVO":"حول Rivo","CONTROL ROOM":"لوحة التحكم",
    "WELCOME BACK":"مرحبًا بعودتك","LIVE PREVIEW":"المعاينة المباشرة","SOCIAL FEED":"المنشورات الاجتماعية",
    "COMMUNITIES":"المجتمعات","MESSAGING":"المراسلة","DISCOVER":"استكشاف","IDENTITY":"الهوية","START YOUR IDENTITY":"ابدأ هويتك",
    "INTERACTIVE IDENTITY":"هوية تفاعلية","Make it yours":"اجعلها بطريقتك","Live identity":"هوية حية",
    "Your Profile.":"ملفك الشخصي.","Your Identity.":"هويتك.","Your Profile. Your Identity.":"ملفك الشخصي. هويتك.",
    "Developer":"مطور","Creator":"صانع محتوى","Online":"متصل","Offline":"غير متصل",
    "Loading":"جارٍ التحميل","Choose a date":"اختر تاريخًا","Select a date":"اختر تاريخًا",
    "January":"يناير","February":"فبراير","March":"مارس","April":"أبريل","May":"مايو","June":"يونيو",
    "July":"يوليو","August":"أغسطس","September":"سبتمبر","October":"أكتوبر","November":"نوفمبر","December":"ديسمبر",
    "Dark":"داكن","Light":"فاتح","🔔 Enabled":"🔔 مفعّل","🔕 Disabled":"🔕 معطّل",
    "Night sky":"سماء ليلية","Clean edge":"حافة نظيفة","Soft depth":"عمق ناعم","Strong surface":"سطح قوي",
    "Gallery border":"إطار معرض","Layered frame":"إطار متعدد الطبقات","Crystal layers":"طبقات كريستالية",
    "Faceted light":"إضاءة متعددة الأوجه","Geometric mesh":"شبكة هندسية","Floating image":"صورة عائمة",
    "Subtle motion":"حركة خفيفة","Glass circuit":"دائرة زجاجية","Tech corner nodes":"عقد تقنية في الزوايا",
    "Layered side sweep":"تموج جانبي متعدد الطبقات","Soft orbital crown":"تاج مداري ناعم","Notched badge edge":"حافة شارة مقصوصة",
    "Glow ribbons":"شرائط متوهجة","Satellite arcs":"أقواس قمرية","Starburst":"انفجار نجمي","Stellar sparks":"شرارات نجمية",
    "Hologram":"هولوغرام","Terminal":"طرفية","Circuit":"دائرة","Aurora":"أورورا","Prism":"منشور",
    "Frosted":"زجاج مصنفر","Notched":"مقصوص","Poster":"ملصق","Solid":"صلب","Outline":"مخطط",
    "Double":"مزدوج","Split":"مقسم","Ribbon":"شريط","Halo":"هالة","Ring":"حلقة","Glow":"توهج","Paper":"ورق","Glass":"زجاج",
    "Style":"النمط","STYLE":"النمط","LAYOUT":"التخطيط","BADGES":"الشارات","LINKS":"الروابط","MEDIA":"الوسائط","BASIC":"أساسي",
    "Basic":"أساسي","Scan":"مسح","Day":"يوم","Month":"شهر","Year":"سنة","Clean":"نظيف","Ticket":"تذكرة",
    "Rivo Admin.":"إدارة Rivo.","Admin":"الإدارة","Posts.":"المنشورات.","Loading admin tools":"جارٍ تحميل أدوات الإدارة",
    "Call service is not configured.":"خدمة المكالمات غير مهيأة.","Connection quality":"جودة الاتصال","Connected":"متصل",
    "Connecting…":"جارٍ الاتصال…","Reconnecting…":"جارٍ إعادة الاتصال…","Excellent":"ممتاز","Checking":"جارٍ الفحص",
    "End call":"إنهاء المكالمة","Mute microphone":"كتم الميكروفون","Unmute microphone":"إلغاء كتم الميكروفون",
    "Turn camera on":"تشغيل الكاميرا","Turn camera off":"إيقاف الكاميرا","Camera on/off":"تشغيل/إيقاف الكاميرا",
    "Incoming video call":"مكالمة فيديو واردة","Incoming voice call":"مكالمة صوتية واردة","Incoming call":"مكالمة واردة",
    "Calling…":"جارٍ الاتصال…","Ringing…":"يرن…","Call declined.":"تم رفض المكالمة.","Call ended.":"انتهت المكالمة.",
    "Starting video call":"جارٍ بدء مكالمة فيديو","Starting voice call":"جارٍ بدء مكالمة صوتية","Voice · waiting for answer":"صوتية · في انتظار الرد",
    "Video · waiting for answer":"فيديو · في انتظار الرد","Optimizing connection…":"جارٍ تحسين الاتصال…","Connecting video…":"جارٍ اتصال الفيديو…",
    "Something went wrong":"حدث خطأ ما","Could not sign out.":"تعذر تسجيل الخروج.","Could not load your profile yet. Please try again.":"تعذر تحميل ملفك الشخصي. حاول مرة أخرى.",
    "Please try again.":"حاول مرة أخرى.","Passwords do not match.":"كلمتا المرور غير متطابقتين.","Birth date is required.":"تاريخ الميلاد مطلوب.",
    "You are already signed in. Sign out before creating another account.":"أنت مسجل الدخول بالفعل. سجّل الخروج قبل إنشاء حساب آخر.",
    "Please take a moment and complete the form normally.":"أكمل النموذج بشكل طبيعي من فضلك.","Username format is valid.":"صيغة اسم المستخدم صحيحة.",
    "Maximum 5 images per post":"الحد الأقصى 5 صور للمنشور","Write something or add a photo":"اكتب شيئًا أو أضف صورة",
    "Post published":"تم نشر المنشور","Profile liked":"تم الإعجاب بالملف الشخصي","Like removed":"تم إلغاء الإعجاب",
    "Profile deleted":"تم حذف الملف الشخصي","Story added for 12 hours":"تمت إضافة القصة لمدة 12 ساعة","Delete this story?":"حذف هذه القصة؟",
    "Story deleted":"تم حذف القصة","Could not delete story":"تعذر حذف القصة","This story has expired.":"انتهت صلاحية هذه القصة.",
    "Nothing new.":"لا توجد إشعارات جديدة.","Mark all read":"تعليم الكل كمقروء","Loading…":"جارٍ التحميل…",
    "Ready":"جاهز","Preparing image…":"جارٍ تجهيز الصورة…","Start a new conversation":"بدء محادثة جديدة",
    "Please choose a valid image.":"اختر صورة صالحة من فضلك.","No audio selected":"لم يتم اختيار ملف صوتي",
    "Music":"الموسيقى","Website":"موقع إلكتروني","Save message privacy":"حفظ خصوصية الرسائل",
    "Nobody (close messages)":"لا أحد (إغلاق الرسائل)","Friends only":"الأصدقاء فقط",
    "Close":"إغلاق","Theme":"المظهر","Language":"اللغة","Your Name":"اسمك","Your profile":"ملفك الشخصي",
    "Open menu":"فتح القائمة","Voice call":"مكالمة صوتية","Video call":"مكالمة فيديو","Send message":"إرسال الرسالة",
    "Song title":"اسم الأغنية","Show password":"إظهار كلمة المرور","Your password":"كلمة المرور الخاصة بك",
    "Enter the code":"أدخل الرمز","Hold to record":"اضغط باستمرار للتسجيل","Hold to record voice message":"اضغط باستمرار لتسجيل رسالة صوتية",
    "Repeat password":"أعد كلمة المرور","8–28 characters":"8–28 حرفًا","Get another code":"الحصول على رمز آخر",
    "Create community":"إنشاء مجتمع","Search communities":"البحث في المجتمعات","Confirm you are human":"أكد أنك إنسان",
    "Search by community name…":"البحث باسم المجتمع…","Search @username or name...":"البحث باسم المستخدم أو الاسم…",
    "Search your friends by username or name...":"ابحث عن أصدقائك باسم المستخدم أو الاسم…",
    "Search by username or display name.":"ابحث باسم المستخدم أو اسم العرض.",
    "Rivo — Your Profile. Your Identity.":"Rivo — ملفك الشخصي. هويتك.",
    "Posts — Rivo":"المنشورات — Rivo","Admin — Rivo":"الإدارة — Rivo","Editor — Rivo":"المحرر — Rivo",
    "Explore — Rivo":"استكشاف — Rivo","Profile — Rivo":"الملف الشخصي — Rivo","Friends — Rivo":"الأصدقاء — Rivo",
    "Settings — Rivo":"الإعدادات — Rivo","Messages — Rivo":"الرسائل — Rivo","Communities — Rivo":"المجتمعات — Rivo",
    "Create Profile — Rivo":"إنشاء حساب — Rivo",
    "Rivo Admin.":"إدارة Rivo.",
    "+ Add link":"+ إضافة رابط",
    "Accent outline":"إطار اللون المميز",
    "Account details and the safe sign-out area.":"تفاصيل الحساب ومنطقة تسجيل الخروج الآمنة.",
    "Accounts, friends and profiles are saved on your device — fast, private, and available offline.":"الحسابات والأصدقاء والملفات الشخصية محفوظة على جهازك — بسرعة وخصوصية ومتاحة دون اتصال.",
    "Accounts, friends, profiles, media and settings persist in the shared cloud database.":"الحسابات والأصدقاء والملفات الشخصية والوسائط والإعدادات محفوظة في قاعدة البيانات السحابية المشتركة.",
    "Compact navigation, controlled preview sizes and responsive profile cards.":"تنقل مدمج وأحجام معاينة مضبوطة وبطاقات ملفات شخصية متجاوبة.",
    "Create your Rivo account with secure authentication.":"أنشئ حساب Rivo الخاص بك بمصادقة آمنة.",
    "Cut corners":"زوايا مقصوصة",
    "Developer · creator · digital builder. A profile that feels like an identity card.":"مطور · صانع · منشئ رقمي. ملف شخصي يشبه بطاقة هوية.",
    "Enter the 4–6 characters shown in the image. Uppercase and lowercase are different.":"أدخل الأحرف من 4 إلى 6 الظاهرة في الصورة. الأحرف الكبيرة والصغيرة مختلفة.",
    "Every editor change is reflected in the same profile engine used publicly.":"كل تغيير في المحرر ينعكس على نفس محرك الملف الشخصي المستخدم في الصفحة العامة.",
    "Feature project cards with links and thumbnails, or embed a music player styled to match your profile.":"اعرض بطاقات مشاريع مع روابط وصور مصغرة، أو أضف مشغل موسيقى بتصميم يناسب ملفك الشخصي.",
    "Feature project cards with thumbnails and links, plus a music player styled to match your card.":"اعرض بطاقات مشاريع مع صور مصغرة وروابط، بالإضافة إلى مشغل موسيقى بتصميم يناسب بطاقتك.",
    "Get in-app alerts when someone sends you a message or a friend request while Rivo is open.":"احصل على تنبيهات داخل التطبيق عندما يرسل لك شخص رسالة أو طلب صداقة أثناء فتح Rivo.",
    "Join public spaces, request access, or create your own group chat.":"انضم إلى المساحات العامة، أو اطلب الانضمام، أو أنشئ مجموعة الدردشة الخاصة بك.",
    "Live — the public profile uses this color.":"مباشر — يستخدم الملف الشخصي العام هذا اللون.",
    "Manage your account details from one place.":"أدر تفاصيل حسابك من مكان واحد.",
    "No audio selected":"لم يتم اختيار ملف صوتي",
    "One local app, five real tools":"تطبيق محلي واحد، خمس أدوات حقيقية",
    "Pick a template, frame, theme color and card style, then rearrange sections exactly how you want them shown.":"اختر قالبًا وإطارًا ولونًا للمظهر ونمطًا للبطاقة، ثم أعد ترتيب الأقسام تمامًا كما تريد ظهورها.",
    "Private moderation, account lookup, profile editing and safe password reset.":"إدارة خاصة ومراجعة الحسابات وتعديل الملفات الشخصية وإعادة تعيين كلمة المرور بأمان.",
    "Protected by Supabase Auth plus layered anti-automation checks. Never share your password.":"محمي بواسطة Supabase Auth وطبقات متعددة لمكافحة الاستخدام الآلي. لا تشارك كلمة المرور أبدًا.",
    "Search people by username or display name and open their public card directly.":"ابحث عن الأشخاص باسم المستخدم أو اسم العرض وافتح بطاقتهم العامة مباشرة.",
    "Send and accept friend requests, browse your circle, and search people by username or display name.":"أرسل طلبات الصداقة واقبلها وتصفح دائرتك وابحث عن الأشخاص باسم المستخدم أو اسم العرض.",
    "Send, accept and browse friend requests, and keep track of your circle.":"أرسل طلبات الصداقة واقبلها وتصفحها وتابع دائرتك.",
    "Share a thought, photos, reactions and conversations — all in one place.":"شارك فكرة وصورًا وتفاعلات ومحادثات — كل ذلك في مكان واحد.",
    "Shown as a small decorative card near your avatar.":"يظهر كبطاقة زخرفية صغيرة بجوار صورتك الشخصية.",
    "Sign out from this device. Your profile data remains saved in the cloud.":"سجّل الخروج من هذا الجهاز. تظل بيانات ملفك الشخصي محفوظة في السحابة.",
    "Templates, frames, themes, card styles and reorderable sections, with a live preview beside every change.":"قوالب وإطارات ومظاهر وأنماط بطاقات وأقسام قابلة لإعادة الترتيب، مع معاينة مباشرة لكل تغيير.",
    "Type the code":"اكتب الرمز",
    "Use a unique password. Automated submissions are rejected when the human-check signals are missing or inconsistent.":"استخدم كلمة مرور فريدة. يتم رفض المحاولات الآلية عند غياب إشارات التحقق البشري أو عدم اتساقها.",
    "Use date":"استخدم التاريخ",
    "Select a date":"اختر تاريخًا",
    "Accounts": "الحسابات",
    "Cloud database":"قاعدة البيانات السحابية",
    "English":"العربية",
    "Light":"فاتح",
    "Dark":"داكن",
    "Enabled":"مفعّل",
    "Disabled":"معطّل",

    /* Social / Posts */
    "Posts.":"المنشورات.",
    "POSTS":"المنشورات",
    "Your posts":"منشوراتك",
    "Active":"نشط",
    "Views":"المشاهدات",
    "VIEWS":"المشاهدات",
    "views":"المشاهدات",
    "Badges":"الشارات",
    "NEW POST":"منشور جديد",
    "New Post":"منشور جديد",
    "Report this post?":"هل تريد الإبلاغ عن هذا المنشور؟",
    "Could not report post":"تعذر الإبلاغ عن المنشور",
    "Post removed after reaching the report limit.":"تمت إزالة المنشور بعد وصول عدد البلاغات إلى الحد المسموح.",
    "Report submitted.":"تم إرسال البلاغ.",
    "Maximum 5 images per post":"الحد الأقصى 5 صور لكل منشور",
    "Write something or add a photo":"اكتب شيئًا أو أضف صورة",
    "Publish":"نشر",
    "Share a thought, photos, reactions and conversations — all in one place.":"شارك فكرة أو صورًا أو تفاعلات ومحادثات — كل ذلك في مكان واحد.",
    "Feed":"المنشورات",
    "People":"الأشخاص",
    "Share":"مشاركة",
    "Like":"إعجاب",
    "Likes":"الإعجابات",
    "Comment":"تعليق",
    "Comments":"التعليقات",
    "Repost":"إعادة نشر",
    "Reposted":"تمت إعادة النشر",
    "Publish":"نشر",
    "Post published":"تم نشر المنشور",
    "Post deleted":"تم حذف المنشور",
    "Post removed after reaching the report limit.":"تمت إزالة المنشور بعد وصول البلاغات إلى الحد المسموح.",
    "Report submitted.":"تم إرسال البلاغ.",
    "No posts yet":"لا توجد منشورات بعد",
    "Be the first to share something.":"كن أول من يشارك شيئًا.",
    "This profile has not shared anything yet.":"هذا الملف الشخصي لم يشارك أي شيء بعد.",
    "Feed unavailable":"المنشورات غير متاحة",
    "What are you thinking about?":"بماذا تفكر؟",
    "Add photos":"إضافة صور",
    "Add photo":"إضافة صورة",
    "0/5 photos":"0/5 صور",
    "Maximum 5 images per post":"الحد الأقصى 5 صور لكل منشور",
    "Write something or add a photo":"اكتب شيئًا أو أضف صورة",
    "Public post · up to 5 images":"منشور عام · حتى 5 صور",
    "No comments yet. Start the conversation.":"لا توجد تعليقات بعد. ابدأ المحادثة.",
    "Write a comment…":"اكتب تعليقًا…",
    "Write a comment...":"اكتب تعليقًا…",
    "Add a comment":"إضافة تعليق",
    "Reposted to this profile":"تمت إعادة نشره في هذا الملف الشخصي",
    "Reposted by":"أعاد نشره",
    " and ":" و",
    " more":" آخرين",
    "Remove post":"إزالة المنشور",
    "Delete post":"حذف المنشور",
    "Report":"إبلاغ",
    "Open image":"فتح الصورة",
    "Close image":"إغلاق الصورة",

    /* Composer / creation menus */
    "Create post":"إنشاء منشور",
    "New post":"منشور جديد",
    "YOUR POSTS":"منشوراتك",
    "NEW POST":"منشور جديد",
    "PROFILE VIEWS":"مشاهدات الملف الشخصي",
    "YOUR PROFILE":"ملفك الشخصي",
    "NO POSTS YET":"لا توجد منشورات بعد",
    "Create":"إنشاء",
    "Add":"إضافة",
    "Add link":"إضافة رابط",
    "Add photos":"إضافة صور",
    "Add media":"إضافة وسائط",
    "Add section":"إضافة قسم",
    "Add project":"إضافة مشروع",
    "Add badge":"إضافة شارة",
    "Add social link":"إضافة رابط اجتماعي",
    "Choose image":"اختيار صورة",
    "Choose audio":"اختيار ملف صوتي",
    "Choose cover":"اختيار الغلاف",
    "No audio selected":"لم يتم اختيار ملف صوتي",
    "Upload image":"رفع صورة",
    "Remove image":"إزالة الصورة",
    "Save changes":"حفظ التغييرات",
    "Changes saved":"تم حفظ التغييرات",
    "Discard changes":"تجاهل التغييرات",
    "Close":"إغلاق",
    "Open":"فتح",
    "Back":"رجوع",
    "Next":"التالي",
    "Previous":"السابق",
    "Done":"تم",

    /* Community */
    "Find your room.":"اعثر على مجتمعك.",
    "Join public spaces, request access, or create your own group chat.":"انضم إلى المساحات العامة، أو اطلب الوصول، أو أنشئ محادثتك الجماعية الخاصة.",
    "Search communities":"البحث عن المجتمعات",
    "Search by community name…":"ابحث باسم المجتمع…",
    "Search by community name...":"ابحث باسم المجتمع…",
    "Create community":"إنشاء مجتمع",
    "New community":"مجتمع جديد",
    "Community":"المجتمع",
    "Community name":"اسم المجتمع",
    "Description":"الوصف",
    "Public":"عام",
    "Private":"خاص",
    "Join":"انضمام",
    "Leave":"مغادرة",
    "Request access":"طلب الوصول",
    "Pending":"قيد الانتظار",
    "Members":"الأعضاء",
    "No communities found.":"لم يتم العثور على مجتمعات.",

    /* Explore / Friends */
    "Find people.":"اعثر على أشخاص.",
    "Search by username or display name.":"ابحث باسم المستخدم أو اسم العرض.",
    "Search":"بحث",
    "Search people…":"البحث عن أشخاص…",
    "Search people...":"البحث عن أشخاص…",
    "Send friend request":"إرسال طلب صداقة",
    "Friend request sent":"تم إرسال طلب الصداقة",
    "Cancel request":"إلغاء الطلب",
    "Accept request":"قبول الطلب",
    "Decline request":"رفض الطلب",
    "Remove friend":"إزالة الصديق",
    "No profiles found":"لم يتم العثور على ملفات شخصية",
    "No friends found.":"لم يتم العثور على أصدقاء.",
    "No pending requests.":"لا توجد طلبات معلقة.",
    "Your circle.":"دائرتك.",

    /* Messages */
    "Your messages.":"رسائلك.",
    "Private conversations with voice and video calling.":"محادثات خاصة مع المكالمات الصوتية والمرئية.",
    "Conversations":"المحادثات",
    "Choose a conversation":"اختر محادثة",
    "Select someone from the left to start messaging.":"اختر شخصًا من القائمة لبدء المراسلة.",
    "Start a new conversation":"ابدأ محادثة جديدة",
    "Type a message":"اكتب رسالة",
    "Write a message...":"اكتب رسالة…",
    "Write a message…":"اكتب رسالة…",
    "Send voice":"إرسال رسالة صوتية",
    "Hold to record":"اضغط باستمرار للتسجيل",
    "Voice message":"رسالة صوتية",
    "Ready":"جاهز",
    "Mute microphone":"كتم الميكروفون",
    "Unmute microphone":"تشغيل الميكروفون",
    "Start call":"بدء المكالمة",
    "End call":"إنهاء المكالمة",
    "Video call":"مكالمة فيديو",
    "Voice call":"مكالمة صوتية",

    /* Editor */
    "Profile Editor":"محرر الملف الشخصي",
    "Profile basics":"أساسيات الملف الشخصي",
    "Avatar, banner & music":"الصورة والغلاف والموسيقى",
    "Floating image":"الصورة العائمة",
    "Shown as a small decorative card near your avatar.":"تظهر كبطاقة زخرفية صغيرة بجوار صورتك الشخصية.",
    "Profile music · max 10 MB":"موسيقى الملف الشخصي · الحد الأقصى 10 ميجابايت",
    "Make it yours":"اجعلها بطريقتك",
    "Radius":"الاستدارة",
    "Live — the public profile uses this color.":"مباشر — الملف الشخصي العام يستخدم هذا اللون.",
    "Same profile engine used on the public page":"نفس محرك الملف المستخدم في الصفحة العامة",
    "No audio selected":"لم يتم اختيار ملف صوتي",
    "Choose up to 3":"اختر حتى 3",
    "Section":"قسم",
    "Sections":"الأقسام",
    "Layout":"التخطيط",
    "Badges":"الشارات",
    "Media":"الوسائط",
    "Links":"الروابط",

    /* Auth */
    "Create your Rivo account with secure authentication.":"أنشئ حساب Rivo الخاص بك باستخدام مصادقة آمنة.",
    "Protected by Supabase Auth plus layered anti-automation checks. Never share your password.":"محمي بواسطة مصادقة Supabase وطبقات متعددة لمكافحة الأتمتة. لا تشارك كلمة المرور.",
    "Select your birth date":"اختر تاريخ ميلادك",
    "Repeat password":"أعد كتابة كلمة المرور",
    "Your Name":"اسمك",
    "Set a new password":"تعيين كلمة مرور جديدة",
    "Show password":"إظهار كلمة المرور",
    "Hide password":"إخفاء كلمة المرور",
    "Use a unique password. Automated submissions are rejected when the human-check signals are missing or inconsistent.":"استخدم كلمة مرور فريدة. يتم رفض المحاولات الآلية عند غياب إشارات التحقق البشري أو عدم اتساقها.",
    "Already have a profile?":"لديك ملف شخصي بالفعل؟",
    "New here?":"جديد هنا؟",
    "Create a profile":"إنشاء ملف شخصي",
    "Enter Profile":"دخول إلى الملف الشخصي",
    "Type the code":"اكتب الرمز",
    "Enter the 4–6 characters shown in the image. Uppercase and lowercase are different.":"أدخل الأحرف الأربعة إلى الستة الظاهرة في الصورة. الأحرف الكبيرة والصغيرة مختلفة.",
    "Use date":"استخدام التاريخ",

    /* Admin */
    "Rivo Admin.":"إدارة Rivo.",
    "Private moderation, account lookup, profile editing and safe password reset.":"إدارة خاصة، والبحث عن الحسابات، وتعديل الملفات الشخصية، وإعادة تعيين آمنة لكلمات المرور.",
    "Find account":"البحث عن حساب",
    "username or display name":"اسم المستخدم أو اسم العرض",
    "Select an account":"اختر حسابًا",
    "Choose a user from the list to inspect or moderate.":"اختر مستخدمًا من القائمة لفحصه أو إدارته.",
    "No accounts found.":"لم يتم العثور على حسابات.",
    "User not found":"المستخدم غير موجود",
    "Active":"نشط",
    "Banned":"محظور",
    "Unban account":"إلغاء حظر الحساب",
    "Block account":"حظر الحساب",
    "Open profile":"فتح الملف الشخصي",
    "Profile views":"مشاهدات الملف الشخصي",
    "Profile likes":"إعجابات الملف الشخصي",
    "Adjust public counters":"تعديل العدادات العامة",
    "Save counters":"حفظ العدادات",
    "Counters updated":"تم تحديث العدادات",
    "Recent profile visitors":"زوار الملف الشخصي مؤخرًا",
    "No identified visitors yet.":"لا يوجد زوار معروفون حتى الآن.",
    "Delete account permanently":"حذف الحساب نهائيًا",
    "Delete":"حذف",
    "Removes the auth account and cascading profile data. This cannot be undone.":"يحذف حساب المصادقة وبيانات الملف المرتبطة به. لا يمكن التراجع عن هذا الإجراء.",
    "For security, the current password can never be displayed or recovered. Enter a new password to replace it.":"لأسباب أمنية، لا يمكن عرض كلمة المرور الحالية أو استعادتها. أدخل كلمة مرور جديدة لاستبدالها.",

    /* Generic UI / status */
    "Nothing new.":"لا توجد إشعارات جديدة.",
    "Mark all read":"تحديد الكل كمقروء",
    "unread":"غير مقروء",
    "total":"الإجمالي",
    "Unavailable":"غير متاح",
    "Not set":"غير محدد",
    "Could not sign out.":"تعذر تسجيل الخروج.",
    "Access denied":"تم رفض الوصول",
    "This area is restricted to Rivo administrators.":"هذه المنطقة مخصصة لمسؤولي Rivo فقط.",
    "Loading account":"جارٍ تحميل الحساب",
    "joined":"انضم في",
    "DANGER ZONE":"منطقة خطرة",
    "VISITORS":"الزوار",
    "ACCOUNT EDIT":"تعديل الحساب",
    "CLOUD":"السحابة",
    "SOCIAL":"اجتماعي",
    "BASIC":"أساسي",
    "LIVE":"مباشر",
    "Scan":"مسح",
    "Not configured":"غير مهيأ",

    /* Additional page labels and editor choices */
    "ABOUT RIVO":"حول Rivo", "CONTROL ROOM":"لوحة التحكم", "SOCIAL FEED":"منشورات اجتماعية",
    "DISCOVER":"اكتشاف", "MESSAGING":"المراسلة", "IDENTITY":"الهوية", "ACCOUNT EDIT":"تعديل الحساب",
    "Avatar":"الصورة الشخصية", "Avatar frame":"إطار الصورة", "Banner":"الغلاف", "Bio":"النبذة",
    "Website":"الموقع الإلكتروني", "Location":"الموقع", "Music cover":"غلاف الموسيقى",
    "Appearance":"المظهر", "Card shape":"شكل البطاقة", "Cinematic":"سينمائي", "Technical":"تقني",
    "Dual-surface layout":"تخطيط بسطحين", "Gallery sheet":"ورقة معرض", "Diamond":"مُعين",
    "Sharp shape":"شكل حاد", "Light halo":"هالة مضيئة", "Orbit":"مدار", "Lattice":"شبكة",
    "Layered frame":"إطار متعدد الطبقات", "Social links":"الروابط الاجتماعية", "Upload audio":"رفع ملف صوتي",
    "Save":"حفظ", "Preview":"معاينة", "Requests":"الطلبات", "Edit":"تعديل", "Edit profile":"تعديل الملف الشخصي",
    "Confirm password":"تأكيد كلمة المرور", "SECURITY CHECK":"فحص الأمان", "START YOUR IDENTITY":"ابدأ هويتك",
    "YOUR BIRTH DATE":"تاريخ ميلادك", "Verification code":"رمز التحقق", "Verify":"تحقق",
    "Cancel":"إلغاء", "Send":"إرسال", "0:00":"0:00",
    "Cloud database + media storage":"قاعدة بيانات سحابية + تخزين الوسائط",
    "Save message privacy":"حفظ خصوصية الرسائل", "Session":"الجلسة", "Sign out":"تسجيل الخروج",
    "Enable notifications":"تفعيل الإشعارات", "Disable notifications":"تعطيل الإشعارات",
    "Notifications are enabled":"الإشعارات مفعّلة", "Notifications are disabled":"الإشعارات معطّلة",
    "Get in-app alerts when someone sends you a message or a friend request while Rivo is open.":"احصل على إشعارات داخل التطبيق عند إرسال رسالة أو طلب صداقة أثناء فتح Rivo.",
    "Choose the interface theme for this device. Your profile design stays unchanged.":"اختر مظهر الواجهة لهذا الجهاز. يظل تصميم ملفك الشخصي كما هو.",
    "Choose your preferred language. This translates navigation and is saved across pages — full in-page content translation is coming soon.":"اختر لغتك المفضلة. سيتم حفظها وتطبيقها على واجهة التطبيق.",
    "Cloud data":"البيانات السحابية", "Local-first interactive profiles":"ملفات شخصية تفاعلية محلية أولًا",
    "Local-first":"محلي أولًا", "Global X":"Global X", "Trusted":"موثوق", "Online":"متصل",
    "Live identity":"هوية حية", "Projects and music":"المشاريع والموسيقى", "Creator":"صانع محتوى",
    "Communities":"المجتمعات", "Posts":"المنشورات", "Explore":"استكشاف", "Friends":"الأصدقاء", "Profile":"الملف الشخصي",
    "Editor":"المحرر", "Settings":"الإعدادات", "Messages":"الرسائل", "Sign in":"تسجيل الدخول",
    "Create profile":"إنشاء حساب", "Profile":"الملف الشخصي",

    /* Frequently rendered dynamic states */
    "Loading feed…":"جارٍ تحميل المنشورات…", "Loading communities…":"جارٍ تحميل المجتمعات…",
    "Loading profile":"جارٍ تحميل الملف الشخصي", "Loading admin tools":"جارٍ تحميل أدوات الإدارة",
    "Loading account":"جارٍ تحميل الحساب", "No accounts found.":"لم يتم العثور على حسابات.",
    "No comments yet. Start the conversation.":"لا توجد تعليقات بعد. ابدأ المحادثة.",
    "Nothing new.":"لا توجد إشعارات جديدة.", "Mark all read":"تحديد الكل كمقروء",
    "This area is restricted to Rivo administrators.":"هذه المنطقة مخصصة لمسؤولي Rivo فقط.",
    "Could not sign out.":"تعذر تسجيل الخروج.", "Access denied":"تم رفض الوصول"
  };

  const SKIP_ANCESTORS = [
    "textarea","input","select","option","script","style","code","pre",
    ".post-content",".message-bubble",".message-text",".bio",".profile-bio",
    ".comment-content",".user-content",".story-caption"
  ];

  function currentLanguage() { return localStorage.getItem("rivo_language") === "ar" ? "ar" : "en"; }

  function translateString(value) {
    const s = String(value ?? "");
    if (currentLanguage() !== "ar" || !s.trim()) return s;
    if (I18N[s] != null) return I18N[s];

    // Preserve names/usernames while translating notification system text.
    let m = s.match(/^(.+?) sent you a message$/); if (m) return `${m[1]} أرسل لك رسالة`;
    m = s.match(/^(.+?) sent you a friend request$/); if (m) return `${m[1]} أرسل لك طلب صداقة`;
    m = s.match(/^(.+?) accepted your friend request$/); if (m) return `${m[1]} وافق على طلب صداقتك`;
    m = s.match(/^(\d+) unread$/); if (m) return `${m[1]} غير مقروء`;
    m = s.match(/^(\d+) total$/); if (m) return `${m[1]} الإجمالي`;
    m = s.match(/^(\d+)m left$/); if (m) return `${m[1]} د متبقية`;
    m = s.match(/^(\d+)h left$/); if (m) return `${m[1]} س متبقية`;
    m = s.match(/^(\d+)\/5 photos$/); if (m) return `${m[1]}/5 صور`;
    m = s.match(/^joined (.+)$/); if (m) return `انضم في ${m[1]}`;
    return s;
  }

  function isSkippableTextNode(node) {
    const p = node?.parentElement;
    if (!p) return true;
    if (SKIP_ANCESTORS.some(sel => p.closest?.(sel))) return true;
    return false;
  }

  function applyI18n(root = document) {
    const lang = currentLanguage();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    for (const node of nodes) {
      if (isSkippableTextNode(node)) continue;
      const current = node.nodeValue || "";
      const trimmed = current.trim();
      if (!trimmed) continue;

      // Keep the original UI string so changing the language back to English
      // restores the exact source text instead of leaving Arabic behind.
      if (!node.__rivoI18nSource && lang === "ar") {
        node.__rivoI18nSource = current;
      }

      if (lang === "ar") {
        const source = node.__rivoI18nSource || current;
        const sourceTrimmed = source.trim();
        const translated = translateString(sourceTrimmed);
        if (translated !== sourceTrimmed) {
          node.nodeValue = source.replace(sourceTrimmed, translated);
        }
      } else if (node.__rivoI18nSource) {
        node.nodeValue = node.__rivoI18nSource;
        delete node.__rivoI18nSource;
      }
    }

    root.querySelectorAll?.("input[placeholder], textarea[placeholder], [aria-label], [title]").forEach(el => {
      el.__rivoI18nAttrs ||= {};
      for (const attr of ["placeholder","aria-label","title"]) {
        if (!el.hasAttribute(attr)) continue;
        const val = el.getAttribute(attr) || "";
        if (lang === "ar") {
          if (!(attr in el.__rivoI18nAttrs)) el.__rivoI18nAttrs[attr] = val;
          const source = el.__rivoI18nAttrs[attr];
          const translated = translateString(source);
          if (translated !== source) el.setAttribute(attr, translated);
        } else if (attr in el.__rivoI18nAttrs) {
          el.setAttribute(attr, el.__rivoI18nAttrs[attr]);
          delete el.__rivoI18nAttrs[attr];
        }
      }
    });
  }

  function applySavedLanguage() {
    const lang = currentLanguage();
    document.documentElement.dataset.language = lang;
    document.documentElement.lang = lang;
    // IMPORTANT: keep the visual/layout direction unchanged; Arabic changes text only.
    document.documentElement.dir = "ltr";
    document.body?.setAttribute("dir","ltr");
    applyI18n(document);
    return lang;
  }

  applySavedLanguage();

  // Translate newly rendered UI without observing characterData changes.
  // Watching characterData while rewriting translated text can create a
  // mutation loop that freezes the page during language switching.
  const i18nObserver = new MutationObserver(mutations => {
    if (currentLanguage() !== "ar") return;
    for (const m of mutations) {
      if (m.addedNodes?.length) {
        m.addedNodes.forEach(n => {
          if (n.nodeType === 1) applyI18n(n);
        });
      }
    }
  });
  i18nObserver.observe(document.documentElement, { childList: true, subtree: true });


  if (sb) {
    sb.auth.onAuthStateChange((_event, session) => {
      syncRealtimeAuth(session);
      if (session?.user) {
        sb.from("profiles").select("username").eq("id", session.user.id).maybeSingle()
          .then(({data}) => { if (data?.username) cacheUsername(data.username); });
      } else {
        cacheUsername("");
      }
    });
    sb.auth.getSession().then(({ data }) => {
      syncRealtimeAuth(data?.session || null);
      if (data?.session?.user) {
        sb.from("profiles").select("username").eq("id", data.session.user.id).maybeSingle()
          .then(({data: row}) => { if (row?.username) cacheUsername(row.username); });
      }
    });

    // Proactively keep the session alive on desktop.
    //
    // Backgrounding a mobile browser tab usually reloads the page when the
    // user comes back to it, which re-authenticates for free. A desktop
    // tab left open (or just unfocused) for a long stretch does not reload
    // — its timers just get throttled, so the built-in autoRefreshToken can
    // miss its window and the access token quietly goes stale. If we wait
    // for the user's next click to discover that, it looks like a random
    // "Access denied". Instead, every time the tab becomes visible/focused
    // again, comes back online, or every few minutes while visible, we
    // check the token's remaining lifetime and refresh it ahead of time.
    let lastResumeSync = 0;
    async function resyncSessionOnResume() {
      const now = Date.now();
      if (now - lastResumeSync < 5000) return; // debounce bursts of focus/visibility/online firing together
      lastResumeSync = now;
      const session = await getLiveSession();
      if (!session) return;
      const msRemaining = session.expires_at ? (session.expires_at * 1000 - now) : Infinity;
      if (msRemaining < 90 * 1000) {
        const refreshed = await forceRefreshSession();
        await syncRealtimeAuth(refreshed);
      } else {
        await syncRealtimeAuth(session);
      }
    }
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") resyncSessionOnResume(); });
    window.addEventListener("focus", resyncSessionOnResume);
    window.addEventListener("online", resyncSessionOnResume);
    setInterval(() => { if (document.visibilityState === "visible") resyncSessionOnResume(); }, 4 * 60 * 1000);
  }


  const REACTION_SET = ["❤️","😂","👍","😮","😢"];

  function normalizeMessageText(value) {
    return String(value ?? "").replace(/\r\n?/g, "\n").normalize("NFC").trim();
  }

  function isEmojiOnly(text) {
    const value = normalizeMessageText(text).replace(/[\s\u200d\ufe0f]/gu, "");
    if (!value) return false;
    try {
      return [...value].every(ch => /\p{Extended_Pictographic}|\p{Emoji_Presentation}|\p{Emoji_Modifier}/u.test(ch));
    } catch {
      return /^(?:[\u2600-\u27ff]|[\ud800-\udbff][\udc00-\udfff])+$/u.test(value);
    }
  }

  async function toggleMessageReaction(messageId, reaction) {
    requireClient();
    const r = String(reaction || "");
    if (!REACTION_SET.includes(r)) throw new Error("Unsupported reaction");
    const { data, error } = await sb.rpc("rivo_toggle_message_reaction", { p_message_id: Number(messageId), p_reaction: r });
    if (error) throw error;
    return data;
  }

  async function listNotifications(limit = 40) {
    requireClient();
    const { data, error } = await sb.rpc("rivo_list_notifications", { p_limit: Math.max(1, Math.min(Number(limit)||40,100)) });
    if (error) throw error;
    return Array.isArray(data) ? data : [];
  }

  async function markNotificationRead(id) {
    requireClient();
    const { data, error } = await sb.rpc("rivo_mark_notification_read", { p_notification_id: Number(id) });
    if (error) throw error;
    return data;
  }

  async function markAllNotificationsRead() {
    requireClient();
    const { data, error } = await sb.rpc("rivo_mark_notifications_read", {});
    if (error) throw error;
    return data;
  }

  async function subscribeMessageReactions(callback) {
    requireClient();
    const session = (await sb.auth.getSession()).data?.session;
    if (!session?.user?.id) return async () => {};
    await syncRealtimeAuth(session);
    const channel = sb.channel(`rivo-reactions-${session.user.id}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "rivo_message_reactions" }, payload => callback?.(payload || null))
      .subscribe();
    return async () => { try { await sb.removeChannel(channel); } catch {} };
  }

  async function subscribeNotifications(callback) {
    requireClient();
    const session = (await sb.auth.getSession()).data?.session;
    if (!session?.user?.id) return async () => {};
    await syncRealtimeAuth(session);
    const channel = sb.channel(`rivo-notifications-${session.user.id}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "rivo_notifications", filter: `recipient_id=eq.${session.user.id}` }, payload => callback?.(payload?.new || null))
      .subscribe();
    return async () => { try { await sb.removeChannel(channel); } catch {} };
  }

  // Notifications are intentionally in-app only. No browser permission,
  // Web Push, VAPID keys, or background delivery are required. Realtime
  // notifications work while the Rivo app is open.
  const NOTIFICATIONS_PREF_KEY = "rivo_notifications_enabled";
  function notificationsEnabled() {
    const v = localStorage.getItem(NOTIFICATIONS_PREF_KEY);
    return v === null ? true : v === "1";
  }
  function setNotificationsEnabled(on) {
    localStorage.setItem(NOTIFICATIONS_PREF_KEY, on ? "1" : "0");
    return !!on;
  }


  async function listProfileVisitors(username, limit = 50) {
    requireClient();
    const { data, error } = await sb.rpc("rivo_get_profile_visitors", { p_username: normalizeUsername(username), p_limit: Math.max(1, Math.min(Number(limit)||50,100)) });
    if (error) throw error;
    return Array.isArray(data) ? data : [];
  }

  async function isAdminProfile(username) {
    requireClient();
    const u = normalizeUsername(username);
    if (!u) return false;
    try {
      const { data, error } = await sb.rpc("rivo_is_admin_profile", { p_username: u });
      if (error) throw error;
      return !!data;
    } catch (error) {
      console.warn("[Rivo] isAdminProfile check failed", { username: u, code: error?.code, message: error?.message });
      return false;
    }
  }

  async function adminStatus() {
    requireClient();
    const { data, error } = await sb.rpc("rivo_admin_is_admin", {});
    if (error) throw error;
    return !!data;
  }

  async function adminListUsers(query = "", limit = 100) {
    requireClient();
    const { data, error } = await sb.rpc("rivo_admin_list_users", { p_query: String(query||""), p_limit: Math.max(1, Math.min(Number(limit)||100,200)) });
    if (error) throw error;
    return Array.isArray(data) ? data : [];
  }

  async function adminSetBanned(username, banned) {
    requireClient();
    const { data, error } = await sb.rpc("rivo_admin_set_banned", { p_username: normalizeUsername(username), p_banned: !!banned });
    if (error) throw error;
    return data;
  }

  async function adminSetStats(username, views, likes) {
    requireClient();
    const { data, error } = await sb.rpc("rivo_admin_set_stats", { p_username: normalizeUsername(username), p_views: Math.max(0, Math.floor(Number(views)||0)), p_likes: Math.max(0, Math.floor(Number(likes)||0)) });
    if (error) throw error;
    invalidateProfileCache(username);
    return data;
  }

  async function adminDeleteUser(username) {
    requireClient();
    const { data, error } = await sb.rpc("rivo_admin_delete_user", { p_username: normalizeUsername(username) });
    if (error) throw error;
    invalidateProfileCache(username);
    return data;
  }

async function adminUpdateUser(username, newUsername, displayName, newPassword, birthDate) {
  requireClient();
  const cleanBirthDate = typeof birthDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(birthDate) ? birthDate : "";
  const { data, error } = await sb.functions.invoke("rivo-admin-update-user", {
    body: {
      username: normalizeUsername(username),
      newUsername: normalizeUsername(newUsername),
      displayName: String(displayName || "").trim().slice(0,80),
      newPassword: String(newPassword || ""),
      birthDate: cleanBirthDate
    }
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  invalidateProfileCache(username);
  invalidateProfileCache(newUsername);
  return data;
}

  async function adminGetUserDetails(username) {
    requireClient();
    const { data, error } = await sb.rpc("rivo_admin_get_user_details", { p_username: normalizeUsername(username) });
    if (error) throw error;
    return data;
  }

  async function setProfileViewPreference(enabled) {
    requireClient();
    const { data, error } = await sb.rpc("rivo_set_profile_view_preference", { p_enabled: !!enabled });
    if (error) throw error;
    return data;
  }



async function uploadVoiceBlob(blob) {
  requireClient();
  if (!(blob instanceof Blob) || !blob.size) throw new Error("No voice recording found.");
  if (blob.size > 8 * 1024 * 1024) throw new Error("Voice message is too large.");
  const me = await currentProfile();
  if (!me?.id) throw new Error("No signed-in profile.");
  const mime = blob.type || "audio/webm";
  const ext = mime.includes("ogg") ? "ogg" : mime.includes("mp4") || mime.includes("m4a") ? "m4a" : "webm";
  const path = `${me.id}/voice/${Date.now()}-${crypto.randomUUID()}.${ext}`;
  const { error } = await sb.storage.from("rivo-voice").upload(path, blob, {
    contentType: mime,
    cacheControl: "3600",
    upsert: false
  });
  if (error) throw error;
  return { path, mime };
}

async function sendVoiceMessage(username, blob, durationMs) {
  const media = await uploadVoiceBlob(blob);
  try {
    return await callRpc("rivo_send_voice_message", {
      p_receiver_username: normalizeUsername(username),
      p_storage_path: media.path,
      p_duration_ms: Math.max(1, Math.min(Number(durationMs) || 0, 5 * 60 * 1000)),
      p_mime_type: media.mime
    }, "VOICE_MESSAGE_SEND");
  } catch (error) {
    try { await sb.storage.from("rivo-voice").remove([media.path]); } catch {}
    throw error;
  }
}

async function getVoiceUrl(path) {
  requireClient();
  const safePath = String(path || "");
  if (!safePath) return "";
  const { data, error } = await sb.storage.from("rivo-voice").createSignedUrl(safePath, 3600);
  if (error) throw error;
  return data?.signedUrl || "";
}

  async function uploadPostImage(file) {
    requireClient();
    const me = await currentProfile();
    if (!me?.id) throw new Error("No signed-in profile.");
    if (!(file instanceof File)) throw new Error("Choose an image.");
    if (!file.type.startsWith("image/")) throw new Error("Only images are supported.");
    if (file.size > 8 * 1024 * 1024) throw new Error("Each image must be 8 MB or less.");
    const dataUrl = await compressImage(file, 1800, .86);
    const blob = dataUrlToBlob(dataUrl);
    const path = `${me.id}/posts/${Date.now()}-${crypto.randomUUID()}.webp`;
    const url = await uploadBlob(blob, path, "image/webp");
    return { url, path, type: "image/webp" };
  }
  async function listPosts(username=null, limit=30, offset=0) { return callRpc("rivo_list_posts", { p_username: username || null, p_limit: limit, p_offset: offset }); }
  async function getPost(id) { return callRpc("rivo_get_post", { p_post_id: Number(id) }); }
  async function createPost(content, media=[]) { return callRpc("rivo_create_post", { p_content: String(content||""), p_media: media.slice(0,5) }); }
  async function deletePost(id) { return callRpc("rivo_delete_post", { p_post_id:Number(id) }); }
  async function reactPost(id, reaction) {
    return withInFlightGuard(`POST_REACTION_TOGGLE:${id}`, () => callRpc("rivo_toggle_post_reaction", { p_post_id:Number(id), p_reaction:reaction }, "POST_REACTION_TOGGLE"));
  }
  async function commentPost(id, content) { return callRpc("rivo_add_post_comment", { p_post_id:Number(id), p_content:String(content||"") }, "POST_COMMENT_ADD"); }
  async function reportPost(id) { return callRpc("rivo_report_post", { p_post_id:Number(id) }, "POST_REPORT"); }
  async function repostPost(id) {
    return withInFlightGuard(`POST_REPOST_TOGGLE:${id}`, () => callRpc("rivo_toggle_post_repost", { p_post_id:Number(id) }, "POST_REPOST_TOGGLE"));
  }
  async function uploadCommunityImage(file) {
    requireClient();
    const me=await currentProfile();
    if(!me?.id) throw new Error("No signed-in profile.");
    if(!(file instanceof File) || !file.type.startsWith("image/")) throw new Error("Choose a valid image.");
    if(file.size > 8*1024*1024) throw new Error("Community image must be 8 MB or smaller.");
    const dataUrl=await compressImage(file,900,.86);
    const blob=dataUrlToBlob(dataUrl);
    const path=`${me.id}/communities/${Date.now()}-${crypto.randomUUID()}.webp`;
    const url=await uploadBlob(blob,path,"image/webp");
    return {url,path,type:"image/webp"};
  }
  async function createCommunity(name, description, joinPolicy, image=null) {
    return callRpc("rivo_create_community", {
      p_name:name,p_description:description,p_join_policy:joinPolicy,
      p_image_url:image?.url||null,p_image_path:image?.path||null
    });
  }
  async function deleteCommunity(id) { return callRpc("rivo_delete_community", { p_id:Number(id) }); }
  async function listCommunities() { return callRpc("rivo_list_communities", { p_limit:80 }); }
  async function myCommunityCount() { return Number(await callRpc("rivo_my_community_count", {})) || 0; }
  async function getCommunity(id) { return callRpc("rivo_get_community", { p_id:Number(id) }); }
  async function joinCommunity(id) { return callRpc("rivo_join_community", { p_id:Number(id) }); }
  async function leaveCommunity(id) { return callRpc("rivo_leave_community", { p_id:Number(id) }); }
  async function listCommunityMembers(id) { return callRpc("rivo_list_community_members", { p_id:Number(id) }); }
  async function listCommunityRequests(id) { return callRpc("rivo_list_community_requests", { p_id:Number(id) }); }
  async function respondCommunityRequest(id, username, accept) { return callRpc("rivo_respond_community_request", { p_id:Number(id), p_username:username, p_accept:!!accept }); }
  async function kickCommunityMember(id, username) { return callRpc("rivo_kick_community_member", { p_id:Number(id), p_username:username }); }
  async function getCommunityMessages(id) { return callRpc("rivo_get_community_messages", { p_id:Number(id), p_limit:160 }); }
  async function sendCommunityMessage(id, content) { return callRpc("rivo_send_community_message", { p_id:Number(id), p_content:String(content||"") }); }
  async function subscribeCommunityMessages(communityId, callback) {
    requireClient();
    const session=(await sb.auth.getSession()).data?.session;
    if(!session?.user?.id) return async()=>{};
    await syncRealtimeAuth(session);
    const channel=sb.channel(`rivo-community-${communityId}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", {event:"INSERT",schema:"public",table:"rivo_community_messages",filter:`community_id=eq.${Number(communityId)}`}, payload=>callback?.(payload?.new||null))
      .subscribe();
    return async()=>{try{await sb.removeChannel(channel)}catch{}};
  }

  window.PF = {
    defaults, badgeCatalog, templates, getProfile, listProfiles, putProfile: saveProfile, deleteProfile,
    normalizeUsername, validUsername, currentUsername, currentProfile, createAccount, login, clearSession,
    updateProfile, saveProfile, searchUsers, getProfiles, sendFriendRequest, acceptFriendRequest, rejectFriendRequest,
    removeFriend, cancelFriendRequest, toggleFollow, isFollowing, toggleLike, friendshipState, addView, getMessageSettings, setMessageSetting, getCallSettings, setCallSetting, sendMessage,
    listConversations, getMessages, subscribeMessages, subscribePresence, ensureDemoAccount, compressImage, readAudio,
    REACTION_SET, isEmojiOnly, normalizeMessageText, toggleMessageReaction, listNotifications, markNotificationRead, markAllNotificationsRead,
    subscribeNotifications, subscribeMessageReactions, notificationsEnabled, setNotificationsEnabled, listProfileVisitors, isAdminProfile, adminStatus, adminListUsers, adminSetBanned, adminSetStats, adminDeleteUser, adminUpdateUser, adminGetUserDetails,
    setProfileViewPreference, getStory, listStoryStatuses, createStoryFromFile, deleteStory, toggleStoryLike, initials, escapeHtml, safeUrl, uploadPostImage, uploadCommunityImage, listPosts, getPost, createPost, deletePost, reactPost, commentPost, reportPost, repostPost, getCoinBalance, listStoreItems, listMyInventory, purchaseStoreItem, transferCoinsByUsername, rewardAdCoins, equipStoreItem, getEquippedStoreItems, createCommunity, deleteCommunity, listCommunities, getCommunity, joinCommunity, leaveCommunity, listCommunityMembers, listCommunityRequests, respondCommunityRequest, kickCommunityMember, getCommunityMessages, sendCommunityMessage, myCommunityCount, subscribeCommunityMessages, getCallUser, canReceiveCallFrom, openCallChannel, subscribeCallInbox, uploadVoiceBlob, sendVoiceMessage, getVoiceUrl,
    NAV_I18N, I18N, currentLanguage, translateString, applyI18n, applySavedLanguage
  };
})();
