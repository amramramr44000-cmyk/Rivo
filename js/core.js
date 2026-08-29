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
    p.updatedAt = row?.updated_at || p.updatedAt;
    if (includePrivate) {
      const priv = row?.private_data || {};
      p.friendRequests = priv.friendRequests || { incoming: [], outgoing: [] };
      p.messageSettings = { whoCanMessage: ["friends","nobody"].includes(priv.messageSettings?.whoCanMessage) ? priv.messageSettings.whoCanMessage : "everyone" };
      p.callSettings = { whoCanCall: ["friends","nobody"].includes(priv.callSettings?.whoCanCall) ? priv.callSettings.whoCanCall : "everyone" };
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
          .select("id,username,public_data,private_data,created_at,updated_at")
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
        .select("username,public_data,private_data,created_at,updated_at").single();
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

  async function createAccount({ username, displayName, password }) {
    requireClient();
    const u = normalizeUsername(username);
    if (!validUsername(u)) throw new Error("Username must be 3–26 characters: letters, numbers, . _ -.");
    if (!String(displayName || "").trim()) throw new Error("Display name is required.");
    const passwordValue = String(password || "");
    if (passwordValue.length < 10) throw new Error("Password must be at least 10 characters.");
    if (passwordValue.length > 128) throw new Error("Password must be 128 characters or fewer.");
    const classes = [/[a-z]/.test(passwordValue), /[A-Z]/.test(passwordValue), /\d/.test(passwordValue), /[^A-Za-z0-9]/.test(passwordValue)].filter(Boolean).length;
    if (classes < 3) throw new Error("Use a stronger password: mix uppercase, lowercase, numbers and/or symbols.");
    const weak = new Set(["password123", "password123!", "qwerty1234", "1234567890", "letmein123", "welcome123"]);
    if (weak.has(passwordValue.toLowerCase())) throw new Error("Choose a less predictable password.");
    const { data: existing, error: lookupError } = await sb.rpc("rivo_username_exists", { p_username: u });
    if (lookupError) throw lookupError;
    if (existing) throw new Error("That username is already taken.");

    const syntheticEmail = `${u}@users.rivo.app`;
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
    base.displayName = String(displayName).trim().slice(0, 60);
    base.createdAt = now; base.updatedAt = now;
    const { error } = await sb.from("profiles").insert({
      id: auth.user.id,
      username: u,
      auth_email: syntheticEmail,
      public_data: publicData(base),
      private_data: { friendRequests: { incoming: [], outgoing: [] } }
    });
    if (error) {
      await sb.auth.signOut();
      if (String(error.message || "").includes("duplicate")) throw new Error("That username is already taken.");
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
  // Phase 2 call signaling: persistent DB-backed call sessions + Realtime.
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

  async function createCallSession(targetUsername, roomName, callId, callType = "audio") {
    return callRpc("rivo_create_call_session", {
      p_call_id: String(callId),
      p_target_username: normalizeUsername(targetUsername),
      p_room_name: String(roomName),
      p_call_type: callType === "video" ? "video" : "audio"
    }, "CALL_SESSION_CREATE");
  }

  async function acceptCallSession(callId) {
    return callRpc("rivo_accept_call_session", { p_call_id: String(callId) }, "CALL_SESSION_ACCEPT");
  }

  async function updateCallSession(callId, status = "ended") {
    return callRpc("rivo_update_call_session", {
      p_call_id: String(callId),
      p_status: ["declined", "expired", "ended"].includes(status) ? status : "ended"
    }, "CALL_SESSION_UPDATE");
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
    requireClient();
    const id = String(userId || "").trim();
    if (!id) return async () => {};

    const session = (await sb.auth.getSession()).data?.session;
    if (!session?.user?.id || session.user.id !== id) return async () => {};
    await syncRealtimeAuth(session);

    let stopped = false;
    const seen = new Set();

    const emit = msg => {
      if (stopped || !msg?.callId) return;
      const key = `${msg.callId}:${msg.type}:${msg.status || ""}`;
      if (seen.has(key)) return;
      seen.add(key);
      if (seen.size > 300) seen.delete(seen.values().next().value);
      try { onSignal?.(msg); } catch {}
    };

    const fromRow = async row => {
      if (!row?.id) return;
      const base = {
        callId: row.id,
        from: row.caller_id,
        to: row.callee_id,
        status: row.status,
        roomName: row.room_name,
        callType: row.call_type
      };

      if (row.status === "ringing" && row.callee_id === id) {
        const { data: p } = await sb.rpc("rivo_social_profile", { p_user_id: row.caller_id });
        emit({
          ...base,
          type: "offer",
          payload: {
            isVideo: row.call_type === "video",
            roomName: row.room_name,
            username: p?.username || "",
            displayName: p?.displayName || p?.username || "Contact",
            avatar: p?.avatar || ""
          }
        });
        return;
      }

      if (row.caller_id === id && row.status === "accepted") {
        emit({ ...base, type: "accept", payload: { roomName: row.room_name } });
        return;
      }

      if (row.status === "declined" && (row.caller_id === id || row.callee_id === id)) {
        emit({ ...base, type: "decline" });
        return;
      }

      if (row.status === "ended" && (row.caller_id === id || row.callee_id === id)) {
        emit({ ...base, type: "hangup" });
        return;
      }

      if (row.status === "expired" && (row.caller_id === id || row.callee_id === id)) {
        emit({ ...base, type: "decline" });
      }
    };

    const channel = sb.channel(`rivo-call-sessions-${id}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", {
        event: "INSERT", schema: "public", table: "rivo_call_sessions",
        filter: `callee_id=eq.${id}`
      }, payload => { void fromRow(payload?.new); })
      .on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "rivo_call_sessions",
        filter: `caller_id=eq.${id}`
      }, payload => { void fromRow(payload?.new); })
      .on("postgres_changes", {
        event: "UPDATE", schema: "public", table: "rivo_call_sessions",
        filter: `callee_id=eq.${id}`
      }, payload => { void fromRow(payload?.new); })
      .subscribe();

    let broadcastBox = null;
    try {
      broadcastBox = await openCallChannel(`rivo-call-inbox-${id}`, onSignal);
    } catch {}

    // Catch rings that happened while the browser was asleep/offline.
    try {
      const { data, error } = await sb.rpc("rivo_list_incoming_call_sessions");
      if (!error) {
        for (const row of data || []) emit(row);
      }
    } catch {}

    return async () => {
      stopped = true;
      try { await sb.removeChannel(channel); } catch {}
      try { await broadcastBox?.close?.(); } catch {}
    };
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

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      const onPages = /\/pages\//.test(location.pathname);
      const swPath = onPages ? "../sw.js" : "sw.js";
      navigator.serviceWorker.register(swPath, { scope: onPages ? "../" : "./" }).catch(err => console.warn("[Rivo] Service worker registration failed", err));
    });
  }

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

  async function requestBrowserNotifications() {
    if (!("Notification" in window)) return "unsupported";
    if (Notification.permission === "granted") { setNotificationsEnabled(true); return "granted"; }
    const result = await Notification.requestPermission();
    if (result === "granted") setNotificationsEnabled(true);
    return result;
  }

  // Browser permission is one-way: once granted, a site can never revoke it
  // itself (only the user can, from the browser's own settings), so a
  // second click on "Enable" always just reported "granted" again with no
  // way to turn notifications back off. This adds a real app-level on/off
  // switch on top of the browser permission: notifyBrowser() checks both,
  // so turning it "off" here reliably stops notifications regardless of
  // what the browser permission still says.
  const NOTIFICATIONS_PREF_KEY = "rivo_notifications_enabled";
  function notificationsEnabled() {
    const v = localStorage.getItem(NOTIFICATIONS_PREF_KEY);
    return v === null ? true : v === "1";
  }
  function setNotificationsEnabled(on) {
    localStorage.setItem(NOTIFICATIONS_PREF_KEY, on ? "1" : "0");
    return on;
  }

  async function notifyBrowser(title, options = {}) {
    try {
      if (!notificationsEnabled()) return false;
      if (!("Notification" in window) || Notification.permission !== "granted") return false;
      const reg = await navigator.serviceWorker?.getRegistration?.();
      if (reg?.showNotification) {
        await reg.showNotification(title, { icon: options.icon || undefined, badge: options.badge || undefined, body: options.body || "", tag: options.tag || "rivo", data: options.data || {}, renotify: true });
        return true;
      }
      new Notification(title, options);
      return true;
    } catch { return false; }
  }

  async function listProfileVisitors(username, limit = 50) {
    requireClient();
    const { data, error } = await sb.rpc("rivo_get_profile_visitors", { p_username: normalizeUsername(username), p_limit: Math.max(1, Math.min(Number(limit)||50,100)) });
    if (error) throw error;
    return Array.isArray(data) ? data : [];
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
    removeFriend, toggleLike, friendshipState, addView, getMessageSettings, setMessageSetting, getCallSettings, setCallSetting, sendMessage,
    listConversations, getMessages, subscribeMessages, subscribePresence, ensureDemoAccount, compressImage, readAudio,
    REACTION_SET, isEmojiOnly, normalizeMessageText, toggleMessageReaction, listNotifications, markNotificationRead, markAllNotificationsRead,
    subscribeNotifications, subscribeMessageReactions, requestBrowserNotifications, notifyBrowser, notificationsEnabled, setNotificationsEnabled, listProfileVisitors, adminStatus, adminListUsers, adminSetBanned, adminSetStats, adminDeleteUser, adminGetUserDetails,
    setProfileViewPreference, getStory, listStoryStatuses, createStoryFromFile, deleteStory, toggleStoryLike, initials, escapeHtml, safeUrl, uploadPostImage, uploadCommunityImage, listPosts, getPost, createPost, deletePost, reactPost, commentPost, repostPost, createCommunity, deleteCommunity, listCommunities, getCommunity, joinCommunity, leaveCommunity, listCommunityMembers, listCommunityRequests, respondCommunityRequest, kickCommunityMember, getCommunityMessages, sendCommunityMessage, myCommunityCount, subscribeCommunityMessages, getCallUser, canReceiveCallFrom, createCallSession, acceptCallSession, updateCallSession, openCallChannel, subscribeCallInbox
  };
})();
