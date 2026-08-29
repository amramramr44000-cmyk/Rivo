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

  const CACHE_KEY = "rivo_username"; // legacy key; never trusted for identity
  const CURRENT_PROFILE_CACHE_PREFIX = "rivo_current_profile_v3:";
  let authIdentity = { id: null, username: "" };
  const MEDIA_BUCKET = "rivo-media";
  const PROFILE_CACHE_PREFIX = "rivo_profile_v2:";
  // Shortened from the previous 45s/20s: long TTLs made message-privacy
  // changes, new avatars, etc. feel like they "didn't save" because a
  // stale cached copy kept getting served. Short TTLs + the explicit
  // invalidateProfileCache() calls after every write keep things both
  // fast (still cached for rapid repeat reads) and accurate.
  const PROFILE_CACHE_TTL = 20 * 1000;
  const CURRENT_PROFILE_CACHE_KEY = "rivo_current_profile_v2"; // legacy key; deleted on bootstrap
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
  function currentProfileCacheKey(uid) { return uid ? CURRENT_PROFILE_CACHE_PREFIX + String(uid) : ""; }
  function invalidateProfileCache(username = "", uid = authIdentity.id) {
    if (username) cacheDelete(PROFILE_CACHE_PREFIX + normalizeUsername(username));
    if (uid) cacheDelete(currentProfileCacheKey(uid));
    cacheDelete(CURRENT_PROFILE_CACHE_KEY);
  }
  function setAuthIdentity(user, username = "") {
    authIdentity = user?.id ? { id: user.id, username: normalizeUsername(username) } : { id: null, username: "" };
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
    ["botanical-night","Botanical Night","Organic night-garden identity with elegant leaf motifs"]
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
  // Compatibility API: this is now an in-memory mirror of Supabase Auth only.
  // localStorage/sessionStorage can never define the current account.
  function currentUsername() { return authIdentity.username || ""; }
  function cacheUsername(username, uid = authIdentity.id) {
    const u = normalizeUsername(username);
    if (!uid || uid !== authIdentity.id) return;
    authIdentity.username = u;
  }
  function setSession(username) { cacheUsername(username); }
  async function clearSession() {
    authIdentity = { id: null, username: "" };
    cacheDelete(CURRENT_PROFILE_CACHE_KEY);
    try {
      sessionStorage.removeItem("rivo_profiles_list_v2");
      for (const k of Object.keys(sessionStorage)) {
        if (k.startsWith(PROFILE_CACHE_PREFIX) || k.startsWith(CURRENT_PROFILE_CACHE_PREFIX)) sessionStorage.removeItem(k);
      }
      localStorage.removeItem(CACHE_KEY); // remove legacy identity residue
    } catch {}
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

  async function currentProfile(options = {}) {
    requireClient();
    const force = !!options.force;
    let session = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data: sessionData, error: sessionError } = await sb.auth.getSession();
      if (!sessionError && sessionData?.session?.user) { session = sessionData.session; break; }
      if (attempt < 2) await new Promise(r => setTimeout(r, 250 * (attempt + 1)));
    }
    if (!session?.user?.id) { setAuthIdentity(null); return null; }
    const uid = session.user.id;
    const cacheKey = currentProfileCacheKey(uid);
    if (!force) {
      const cached = cacheRead(cacheKey, CURRENT_PROFILE_CACHE_TTL);
      if (cached?.id === uid) { setAuthIdentity(session.user, cached.username); return cached; }
    }
    for (let attempt = 0; attempt < 4; attempt++) {
      const { data, error } = await sb.from("profiles")
        .select("id,username,public_data,private_data,created_at,updated_at")
        .eq("id", uid).maybeSingle();
      if (error) throw error;
      if (data) {
        if (data.id !== uid) throw new Error("Authenticated profile identity mismatch.");
        setAuthIdentity(session.user, data.username);
        const merged = mergeProfile(data, true);
        merged.id = data.id;
        cacheWrite(cacheKey, merged);
        return merged;
      }
      if (attempt < 3) await new Promise(r => setTimeout(r, 300 * (attempt + 1)));
    }
    return null;
  }

  async function getProfile(username, options = {}) {
    requireClient();
    const u = normalizeUsername(username);
    if (!u) return null;
    if (!options.force) {
      const cached = cacheRead(PROFILE_CACHE_PREFIX + u, PROFILE_CACHE_TTL);
      if (cached) return cached;
    }
    const { data, error } = await sb.rpc("rivo_get_public_profile", { p_username: u });
    if (error) throw error;
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
      const { data, error } = await sb.rpc("rivo_get_public_profiles", { p_usernames: missing });
      if (error) throw error;
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
    const { data, error } = await sb.rpc("rivo_list_public_profiles", { p_limit: 24 });
    if (error) throw error;
    const list = Array.isArray(data) ? data : [];
    list.forEach(p => cacheWrite(PROFILE_CACHE_PREFIX + p.username, p));
    cacheWrite(key, list);
    return list;
  }

  async function searchUsers(query) {
    requireClient();
    const q = String(query || "").trim().toLowerCase().replace(/^@/, "");
    if (!q) return [];
    const { data, error } = await sb.rpc("rivo_search_profiles", { p_query: q, p_limit: 24 });
    if (error) throw error;
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
    const { data: { session } } = await sb.auth.getSession();
    if (!session?.user?.id) throw new Error("Your session expired. Please sign in again.");
    const { data, error } = await sb.from("profiles")
      .update(payload).eq("id", session.user.id)
      .select("username,public_data,private_data,created_at,updated_at").single();
    if (error) throw error;
    setAuthIdentity({ id: data.id }, data.username);
    invalidateProfileCache(data.username, data.id);
    const merged = mergeProfile(data, true);
    merged.id = data.id;
    cacheWrite(currentProfileCacheKey(data.id), merged);
    cacheWrite(PROFILE_CACHE_PREFIX + data.username, merged);
    return merged;
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
    setAuthIdentity(auth.user, u);
    cacheDelete(CURRENT_PROFILE_CACHE_KEY);
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
    authIdentity = { id: null, username: "" };
    cacheDelete(CURRENT_PROFILE_CACHE_KEY);
    try { localStorage.removeItem(CACHE_KEY); } catch {}
    // Ensure a clean local Auth context when switching accounts on the same device.
    try { await sb.auth.signOut({ scope: "local" }); } catch {}
    const { data, error } = await sb.auth.signInWithPassword({
      email: syntheticEmail,
      password: passwordValue,
      options: signInOptions
    });
    if (error || !data.user) throw new Error("Incorrect username or password.");
    setAuthIdentity(data.user, "");
    const profile = await currentProfile({ force: true });
    if (!profile) {
      await sb.auth.signOut();
      setAuthIdentity(null);
      try { localStorage.removeItem(CACHE_KEY); } catch {}
      throw new Error("Your account was authenticated, but the profile data is still syncing. Please try again.");
    }
    return profile;
  }

  async function deleteProfile(username) {
    // Kept for API compatibility. Deleting a profile must be an explicit account action.
    return false;
  }

  function rpcOperationLabel(name) {
    const map = {
      rivo_send_friend_request: "FRIEND_REQUEST_INSERT",
      rivo_accept_friend_request: "FRIEND_REQUEST_ACCEPT",
      rivo_reject_friend_request: "FRIEND_REQUEST_REJECT",
      rivo_remove_friend: "FRIENDSHIP_REMOVE",
      rivo_set_profile_like: "LIKE_PROFILE",
      rivo_toggle_like: "LIKE_TOGGLE",
      rivo_toggle_post_reaction: "POST_REACTION"
    };
    return map[name] || name.toUpperCase();
  }
  function isAuthFailure(error) {
    const code = String(error?.code || error?.status || "");
    const msg = String(error?.message || error || "").toLowerCase();
    return ["401", "403", "pgrst301", "jwt", "token", "not signed in", "invalid jwt", "jwt expired"].some(x => code.toLowerCase() === x || msg.includes(x));
  }
  async function ensureAuthenticated() {
    requireClient();
    const { data, error } = await sb.auth.getUser();
    if (error || !data?.user?.id) {
      setAuthIdentity(null);
      const e = error || new Error("Session expired. Please sign in again.");
      console.error("[Rivo][AUTH_SESSION]", { operation: "AUTH_CHECK", errorCode: e.code || e.status || "", errorMessage: e.message || String(e) });
      throw e;
    }
    if (authIdentity.id !== data.user.id) {
      setAuthIdentity(data.user, "");
      await currentProfile({ force: true });
    }
    return data.user;
  }
  async function refreshAuthOnce() {
    const { data, error } = await sb.auth.refreshSession();
    if (error || !data?.session?.user) throw (error || new Error("Session expired. Please sign in again."));
    await syncRealtimeAuth(data.session);
    setAuthIdentity(data.session.user, authIdentity.id === data.session.user.id ? authIdentity.username : "");
    return data.session;
  }
  async function callRpc(name, args, operation = rpcOperationLabel(name), diagnostics = {}) {
    requireClient();
    let user = await ensureAuthenticated();
    let retried = false;
    while (true) {
      try {
        const { data, error } = await sb.rpc(name, args || {});
        if (error) throw error;
        console.debug("[Rivo][DB_OK]", { operation, authUid: user.id });
        return data;
      } catch (error) {
        console.error("[Rivo][DB_ERROR]", {
          operation, authUid: user.id, targetUserId: diagnostics.targetUserId || null,
          targetUsername: diagnostics.targetUsername || args?.p_target_username || args?.p_username || args?.p_from_username || null,
          errorCode: error?.code || error?.status || "", errorMessage: error?.message || String(error)
        });
        if (!retried && isAuthFailure(error)) {
          retried = true;
          try {
            await refreshAuthOnce();
            user = await ensureAuthenticated();
            continue;
          } catch (refreshError) {
            console.error("[Rivo][AUTH_REFRESH_ERROR]", { operation, authUid: user.id, errorCode: refreshError?.code || refreshError?.status || "", errorMessage: refreshError?.message || String(refreshError) });
          }
        }
        throw error;
      }
    }
  }
  async function socialTarget(username) {
    const target = await getProfile(username, { force: true });
    if (!target?.userId) throw new Error("User not found");
    const me = await ensureAuthenticated();
    if (target.userId === me.id) throw new Error("You cannot perform this action on your own profile");
    return target;
  }
  async function sendFriendRequest(targetUsername) {
    const target = await socialTarget(targetUsername);
    const result = await callRpc("rivo_send_friend_request", { p_target_username: target.username }, "FRIEND_REQUEST_INSERT", { targetUserId: target.userId, targetUsername: target.username });
    invalidateProfileCache(target.username, target.userId);
    const me = await currentProfile({ force: true });
    const freshTarget = await getProfile(target.username, { force: true });
    return { ok: true, result, operation: "FRIEND_REQUEST_INSERT", me, target: freshTarget };
  }
  async function acceptFriendRequest(fromUsername) {
    const target = await socialTarget(fromUsername);
    const result = await callRpc("rivo_accept_friend_request", { p_from_username: target.username }, "FRIEND_REQUEST_ACCEPT", { targetUserId: target.userId, targetUsername: target.username });
    invalidateProfileCache(target.username, target.userId);
    const me = await currentProfile({ force: true });
    const freshTarget = await getProfile(target.username, { force: true });
    return { ok: true, result, operation: "FRIEND_REQUEST_ACCEPT", me, target: freshTarget };
  }
  async function rejectFriendRequest(fromUsername) {
    const target = await socialTarget(fromUsername);
    const result = await callRpc("rivo_reject_friend_request", { p_from_username: target.username }, "FRIEND_REQUEST_REJECT", { targetUserId: target.userId, targetUsername: target.username });
    invalidateProfileCache(target.username, target.userId);
    const me = await currentProfile({ force: true });
    const freshTarget = await getProfile(target.username, { force: true });
    return { ok: true, result, operation: "FRIEND_REQUEST_REJECT", me, target: freshTarget };
  }
  async function removeFriend(username) {
    const target = await socialTarget(username);
    const result = await callRpc("rivo_remove_friend", { p_username: target.username }, "FRIENDSHIP_REMOVE", { targetUserId: target.userId, targetUsername: target.username });
    invalidateProfileCache(target.username, target.userId);
    const me = await currentProfile({ force: true });
    const freshTarget = await getProfile(target.username, { force: true });
    return { ok: true, result, operation: "FRIENDSHIP_REMOVE", me, target: freshTarget };
  }
  async function toggleLike(username) {
    const target = await socialTarget(username);
    const me = await currentProfile({ force: true });
    const users = Array.isArray(target.likes?.users) ? target.likes.users : [];
    const alreadyLiked = Boolean(me?.username && users.includes(me.username));
    const desired = !alreadyLiked;
    const result = await callRpc("rivo_set_profile_like", { p_username: target.username, p_liked: desired }, desired ? "LIKE_INSERT" : "LIKE_DELETE", { targetUserId: target.userId, targetUsername: target.username });
    invalidateProfileCache(target.username, target.userId);
    const fresh = await getProfile(target.username, { force: true });
    return { ...(result || {}), liked: desired, operation: desired ? "LIKE_INSERT" : "LIKE_DELETE", profile: fresh, me };
  }
  async function addView(username) {
    return callRpc("rivo_add_view", { p_username: normalizeUsername(username) });
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

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      const onPages = /\/pages\//.test(location.pathname);
      const swPath = onPages ? "../sw.js" : "sw.js";
      navigator.serviceWorker.register(swPath, { scope: onPages ? "../" : "./" }).catch(err => console.warn("[Rivo] Service worker registration failed", err));
    });
  }

  if (sb) {
    try { localStorage.removeItem(CACHE_KEY); } catch {}
    sb.auth.onAuthStateChange((_event, session) => {
      // Supabase warns against awaiting network calls inside onAuthStateChange.
      // Schedule hydration after the Auth callback returns to avoid lock contention.
      setAuthIdentity(session?.user || null, "");
      setTimeout(() => {
        syncRealtimeAuth(session).catch(() => {});
        syncOwnProfileRealtime(session).catch(() => {});
        if (session?.user?.id) {
          sb.from("profiles").select("username").eq("id", session.user.id).maybeSingle()
            .then(({ data, error }) => { if (!error && data?.username) setAuthIdentity(session.user, data.username); })
            .catch(() => {});
        }
      }, 0);
    });
    sb.auth.getSession().then(async ({ data }) => {
      await syncRealtimeAuth(data?.session || null);
      await syncOwnProfileRealtime(data?.session || null);
      if (data?.session?.user?.id) {
        setAuthIdentity(data.session.user, "");
        try {
          const { data: row, error } = await sb.from("profiles").select("username").eq("id", data.session.user.id).maybeSingle();
          if (!error && row?.username) setAuthIdentity(data.session.user, row.username);
        } catch {}
      }
    });
  }


  let ownProfileChannel = null;
  async function syncOwnProfileRealtime(session) {
    if (ownProfileChannel) { try { await sb.removeChannel(ownProfileChannel); } catch {} ownProfileChannel = null; }
    if (!sb || !session?.user?.id) return;
    await syncRealtimeAuth(session);
    const uid = session.user.id;
    ownProfileChannel = sb.channel(`rivo-profile-${uid}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "profiles", filter: `id=eq.${uid}` }, payload => {
        const row = payload?.new;
        if (!row?.id || row.id !== authIdentity.id) return;
        try {
          const merged = mergeProfile(row, true);
          merged.id = row.id;
          setAuthIdentity(session.user, row.username);
          cacheWrite(currentProfileCacheKey(row.id), merged);
          cacheDelete(CURRENT_PROFILE_CACHE_KEY);
          console.debug("[Rivo][REALTIME_PROFILE_SYNC]", { authUid: row.id });
        } catch (error) {
          console.warn("[Rivo][REALTIME_PROFILE_SYNC_ERROR]", error);
        }
      })
      .subscribe();
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
  async function reactPost(id, reaction) { return callRpc("rivo_toggle_post_reaction", { p_post_id:Number(id), p_reaction:reaction }); }
  async function commentPost(id, content) { return callRpc("rivo_add_post_comment", { p_post_id:Number(id), p_content:String(content||"") }); }
  async function repostPost(id) { return callRpc("rivo_toggle_post_repost", { p_post_id:Number(id) }); }
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
    ensureAuthenticated,
    updateProfile, saveProfile, searchUsers, getProfiles, sendFriendRequest, acceptFriendRequest, rejectFriendRequest,
    removeFriend, toggleLike, friendshipState, addView, getMessageSettings, setMessageSetting, getCallSettings, setCallSetting, sendMessage,
    listConversations, getMessages, subscribeMessages, subscribePresence, ensureDemoAccount, compressImage, readAudio,
    REACTION_SET, isEmojiOnly, normalizeMessageText, toggleMessageReaction, listNotifications, markNotificationRead, markAllNotificationsRead,
    subscribeNotifications, subscribeMessageReactions, requestBrowserNotifications, notifyBrowser, notificationsEnabled, setNotificationsEnabled, listProfileVisitors, adminStatus, adminListUsers, adminSetBanned, adminSetStats, adminDeleteUser, adminGetUserDetails,
    setProfileViewPreference, getStory, listStoryStatuses, createStoryFromFile, deleteStory, toggleStoryLike, initials, escapeHtml, safeUrl, uploadPostImage, uploadCommunityImage, listPosts, getPost, createPost, deletePost, reactPost, commentPost, repostPost, createCommunity, deleteCommunity, listCommunities, getCommunity, joinCommunity, leaveCommunity, listCommunityMembers, listCommunityRequests, respondCommunityRequest, kickCommunityMember, getCommunityMessages, sendCommunityMessage, myCommunityCount, subscribeCommunityMessages, getCallUser, canReceiveCallFrom, openCallChannel, subscribeCallInbox
  };
})();
