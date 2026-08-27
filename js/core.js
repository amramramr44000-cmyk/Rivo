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

  const CACHE_KEY = "rivo_username";
  const MEDIA_BUCKET = "rivo-media";

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
    ["discord-noir","Discord Noir","Clean social identity with compact status HUD"],
    ["anime-cinema","Anime Cinema","Cinematic character composition with portrait focus"],
    ["neon-arena","Neon Arena","Competitive gaming card with luminous stats"],
    ["cyber-terminal","Cyber Terminal","Terminal surfaces and technical diagnostics"],
    ["dark-luxury","Dark Luxury","Editorial black surfaces with refined gold accents"],
    ["minimal-ice","Minimal Ice","Bright, quiet portfolio card with precise spacing"],
    ["samurai-ink","Samurai Ink","Poster-like ink composition with sharp separators"],
    ["deep-space","Deep Space","Cosmic profile identity with atmospheric depth"],
    ["creator-pulse","Creator Pulse","Media-first creator card with energetic rhythm"],
    ["monochrome-pro","Monochrome Pro","High-contrast executive portfolio presentation"]
  ];

  function requireClient() {
    if (!READY || !sb) throw new Error("Rivo is not connected to Supabase. Configure js/supabase-config.js.");
  }
  function normalizeUsername(value) {
    return String(value || "").trim().replace(/^@+/, "").toLowerCase();
  }
  function validUsername(value) {
    const u = normalizeUsername(value);
    return /^[a-z0-9](?:[a-z0-9._-]{2,24})[a-z0-9]$/.test(u) &&
      !["admin","administrator","support","help","rivo","root","system","api","null","undefined"].includes(u);
  }
  function currentUsername() { return localStorage.getItem(CACHE_KEY) || ""; }
  function cacheUsername(username) {
    const u = normalizeUsername(username);
    if (u) localStorage.setItem(CACHE_KEY, u); else localStorage.removeItem(CACHE_KEY);
  }
  function setSession(username) { cacheUsername(username); }
  async function clearSession() {
    cacheUsername("");
    if (sb) await sb.auth.signOut();
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
    }
    return p;
  }

  async function currentProfile() {
    requireClient();
    const { data: { user }, error: userError } = await sb.auth.getUser();
    if (userError || !user) return null;
    const { data, error } = await sb.from("profiles")
      .select("id,username,public_data,private_data,created_at,updated_at")
      .eq("id", user.id).maybeSingle();
    if (error) throw error;
    if (!data) return null;
    cacheUsername(data.username);
    return mergeProfile(data, true);
  }

  async function getProfile(username) {
    requireClient();
    const u = normalizeUsername(username);
    if (!u) return null;
    const { data, error } = await sb.rpc("rivo_get_public_profile", { p_username: u });
    if (error) throw error;
    if (!data) return null;
    return data;
  }

  async function listProfiles() {
    requireClient();
    const { data, error } = await sb.rpc("rivo_list_public_profiles", { p_limit: 24 });
    if (error) throw error;
    return Array.isArray(data) ? data : [];
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

  async function uploadDataUrl(dataUrl, path, mime) {
    requireClient();
    const blob = dataUrlToBlob(dataUrl);
    const { error } = await sb.storage.from(MEDIA_BUCKET).upload(path, blob, {
      contentType: blob.type || mime || "application/octet-stream",
      upsert: false
    });
    if (error) throw error;
    return sb.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
  }

  async function persistMedia(profile) {
    const uid = (await sb.auth.getUser()).data.user?.id;
    if (!uid) throw new Error("Your session expired. Please sign in again.");
    const out = structuredClone(profile);
    const stamp = `${Date.now()}-${crypto.randomUUID()}`;
    const media = [
      ["avatar", "image/webp"], ["banner", "image/webp"], ["miniImage", "image/webp"],
      ["music.cover", "image/webp"], ["music.audio", out.music?.mime || "audio/mpeg"]
    ];
    for (const [key, fallbackMime] of media) {
      const parts = key.split(".");
      const value = parts.length === 1 ? out[key] : out[parts[0]]?.[parts[1]];
      if (!String(value || "").startsWith("data:")) continue;
      const ext = fallbackMime.startsWith("image/") ? "webp" :
        (fallbackMime.includes("ogg") ? "ogg" : fallbackMime.includes("wav") ? "wav" : "mp3");
      const path = `${uid}/${stamp}-${parts.join("-")}.${ext}`;
      const url = await uploadDataUrl(value, path, fallbackMime);
      if (parts.length === 1) out[key] = url;
      else { out[parts[0]] ||= {}; out[parts[0]][parts[1]] = url; }
    }
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
    const { data, error } = await sb.from("profiles")
      .update(payload).eq("id", (await sb.auth.getUser()).data.user.id)
      .select("username,public_data,private_data,created_at,updated_at").single();
    if (error) throw error;
    cacheUsername(data.username);
    return mergeProfile(data, true);
  }

  async function updateProfile(patch) {
    const current = await currentProfile();
    if (!current) throw new Error("No signed-in profile.");
    return saveProfile({ ...current, ...patch });
  }

  async function createAccount({ username, displayName, password }) {
    requireClient();
    const u = normalizeUsername(username);
    if (!validUsername(u)) throw new Error("Username must use 4–26 chars: letters, numbers, . _ -.");
    if (!String(displayName || "").trim()) throw new Error("Display name is required.");
    if (String(password || "").length < 6) throw new Error("Password must be at least 6 characters.");
    const { data: existing, error: lookupError } = await sb.rpc("rivo_username_exists", { p_username: u });
    if (lookupError) throw lookupError;
    if (existing) throw new Error("That username is already taken.");

    const syntheticEmail = `${u}@users.rivo.app`;
    const { data: auth, error: authError } = await sb.auth.signUp({
      email: syntheticEmail,
      password: String(password)
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
    const { data: row, error: lookupError } = await sb.from("profiles")
      .select("auth_email,username").eq("username", u).maybeSingle();
    if (lookupError) throw lookupError;
    if (!row) throw new Error("Incorrect username or password.");
    const { data, error } = await sb.auth.signInWithPassword({
      email: row.auth_email, password: String(password || "")
    });
    if (error || !data.user) throw new Error("Incorrect username or password.");
    cacheUsername(row.username);
    return currentProfile();
  }

  async function deleteProfile(username) {
    // Kept for API compatibility. Deleting a profile must be an explicit account action.
    return false;
  }

  async function callRpc(name, args) {
    requireClient();
    const { data, error } = await sb.rpc(name, args || {});
    if (error) throw error;
    return data;
  }

  async function sendFriendRequest(targetUsername) {
    return callRpc("rivo_send_friend_request", { p_target_username: normalizeUsername(targetUsername) });
  }
  async function acceptFriendRequest(fromUsername) {
    return callRpc("rivo_accept_friend_request", { p_from_username: normalizeUsername(fromUsername) });
  }
  async function rejectFriendRequest(fromUsername) {
    return callRpc("rivo_reject_friend_request", { p_from_username: normalizeUsername(fromUsername) });
  }
  async function removeFriend(username) {
    return callRpc("rivo_remove_friend", { p_username: normalizeUsername(username) });
  }
  async function toggleLike(username) {
    return callRpc("rivo_toggle_like", { p_username: normalizeUsername(username) });
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
    return callRpc("rivo_add_view", { p_username: normalizeUsername(username) });
  }

  async function ensureDemoAccount() { return false; }

  async function compressImage(file, maxW=1400, quality=.82) {
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

  if (sb) {
    sb.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        sb.from("profiles").select("username").eq("id", session.user.id).maybeSingle()
          .then(({data}) => { if (data?.username) cacheUsername(data.username); });
      } else {
        cacheUsername("");
      }
    });
    sb.auth.getSession().then(({ data }) => {
      if (data?.session?.user) {
        sb.from("profiles").select("username").eq("id", data.session.user.id).maybeSingle()
          .then(({data: row}) => { if (row?.username) cacheUsername(row.username); });
      }
    });
  }

  window.PF = {
    defaults, badgeCatalog, templates, getProfile, listProfiles, putProfile: saveProfile, deleteProfile,
    normalizeUsername, validUsername, currentUsername, currentProfile, createAccount, login, clearSession,
    updateProfile, saveProfile, searchUsers, sendFriendRequest, acceptFriendRequest, rejectFriendRequest,
    removeFriend, toggleLike, friendshipState, addView, ensureDemoAccount, compressImage, readAudio,
    initials, escapeHtml, safeUrl
  };
})();
