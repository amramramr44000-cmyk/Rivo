/* ProfileForge Local Engine
   Local-first: no server, no API, no hosting required.
   Data is persisted in IndexedDB; session state is kept in localStorage.
*/
(() => {
  "use strict";

  const DB_NAME = "ProfileForgeLocal";
  const DB_VERSION = 2;
  const STORE = "profiles";
  const SESSION_KEY = "pf_session";

  const defaults = {
    username: "",
    displayName: "",
    bio: "",
    description: "",
    location: "",
    website: "",
    avatar: "",
    banner: "",
    miniImage: "",
    status: "Online",
    customStatus: "",
    theme: "obsidian",
    template: "discord",
    accent: "#8b5cf6",
    cardRadius: 24,
    cardStyle: "glass",
    glow: 45,
    background: "aurora",
    animation: "soft",
    socials: [],
    skills: [],
    badges: [],
    projects: [],
    friends: [],
    friendRequests: { incoming: [], outgoing: [] },
    sections: [
      { id: (crypto.randomUUID ? crypto.randomUUID() : Date.now()+"-"+Math.random().toString(16).slice(2)), type: "about", title: "About Me", visible: true },
      { id: (crypto.randomUUID ? crypto.randomUUID() : Date.now()+"-"+Math.random().toString(16).slice(2)), type: "friends", title: "Friends", visible: true }
    ],
    music: { title: "", artist: "", cover: "", audio: "", mime: "", size: 0 },
    avatarFrame: "none",
    avatarFrameColor: "#8b5cf6",
    avatarFrameGlow: 35,
    avatarFrameWidth: 3,
    stats: { views: 0 },
    likes: { count: 0, users: [] },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
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

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: "username" });
          store.createIndex("displayName", "displayName", { unique: false });
          store.createIndex("updatedAt", "updatedAt", { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function tx(mode, action) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const store = t.objectStore(STORE);
      let result;
      try { result = action(store); } catch (e) { reject(e); return; }
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
    });
  }

  async function getProfile(username) {
    if (!username) return null;
    return tx("readonly", store => new Promise((resolve, reject) => {
      const req = store.get(normalizeUsername(username));
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    }));
  }

  async function listProfiles() {
    return tx("readonly", store => new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    }));
  }

  async function putProfile(profile) {
    profile.updatedAt = new Date().toISOString();
    return tx("readwrite", store => store.put(profile));
  }

  async function deleteProfile(username) {
    return tx("readwrite", store => store.delete(normalizeUsername(username)));
  }

  function normalizeUsername(value) {
    return String(value || "").trim().replace(/^@+/, "").toLowerCase();
  }

  function validUsername(value) {
    const u = normalizeUsername(value);
    return /^[a-z0-9](?:[a-z0-9._-]{2,24})[a-z0-9]$/.test(u) &&
      !["admin","administrator","support","help","profileforge","root","system","api","null","undefined"].includes(u);
  }

  function currentUsername() { return localStorage.getItem(SESSION_KEY) || ""; }
  function setSession(username) { localStorage.setItem(SESSION_KEY, normalizeUsername(username)); }
  function clearSession() { localStorage.removeItem(SESSION_KEY); }
  async function currentProfile() { return getProfile(currentUsername()); }

  const PASSWORD_ITERATIONS = 120000;
  const PASSWORD_MIN = 6;

  function bytesToBase64(bytes) {
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }
  function base64ToBytes(value) {
    const binary = atob(value);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }
  function randomSalt() {
    const salt = new Uint8Array(16);
    crypto.getRandomValues(salt);
    return bytesToBase64(salt);
  }
  async function hashPassword(password, saltBase64) {
    const salt = saltBase64 ? base64ToBytes(saltBase64) : base64ToBytes(randomSalt());
    const salt64 = saltBase64 || bytesToBase64(salt);
    const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt, iterations: PASSWORD_ITERATIONS, hash: "SHA-256" },
      material,
      256
    );
    return { salt: salt64, hash: bytesToBase64(new Uint8Array(bits)) };
  }
  async function verifyPassword(password, stored) {
    if (!stored?.salt || !stored?.hash) return false;
    const result = await hashPassword(password, stored.salt);
    const a = base64ToBytes(result.hash), b = base64ToBytes(stored.hash);
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
  }

  async function createAccount({ username, displayName, password }) {
    const u = normalizeUsername(username);
    if (!validUsername(u)) throw new Error("Username must use 4–26 chars: letters, numbers, . _ -.");
    if (!String(displayName || "").trim()) throw new Error("Display name is required.");
    if (String(password || "").length < PASSWORD_MIN) throw new Error(`Password must be at least ${PASSWORD_MIN} characters.`);
    if (await getProfile(u)) throw new Error("That username is already taken.");
    const profile = structuredClone(defaults);
    profile.username = u;
    profile.displayName = displayName.trim().slice(0, 60);
    profile.password = await hashPassword(String(password));
    profile.createdAt = new Date().toISOString();
    profile.updatedAt = profile.createdAt;
    await putProfile(profile);
    setSession(u);
    return profile;
  }

  async function login(username, password) {
    const u = normalizeUsername(username);
    const profile = await getProfile(u);
    if (!profile) throw new Error("Incorrect username or password.");
    if (!profile.password) {
      if (String(password || "").length < PASSWORD_MIN) throw new Error(`Password must be at least ${PASSWORD_MIN} characters.`);
      profile.password = await hashPassword(String(password));
      await putProfile(profile);
    } else if (!password || !(await verifyPassword(String(password), profile.password))) {
      throw new Error("Incorrect username or password.");
    }
    setSession(u);
    return profile;
  }

  async function updateProfile(patch) {
    const profile = await currentProfile();
    if (!profile) throw new Error("No signed-in profile.");
    const next = { ...profile, ...patch };
    if (patch.socials) next.socials = patch.socials;
    if (patch.skills) next.skills = patch.skills;
    if (patch.projects) next.projects = patch.projects;
    if (patch.sections) next.sections = patch.sections;
    await putProfile(next);
    return next;
  }

  async function saveProfile(profile) {
    if (!profile || !profile.username) throw new Error("Invalid profile.");
    await putProfile(profile);
    return profile;
  }

  async function searchUsers(query) {
    const q = String(query || "").trim().toLowerCase().replace(/^@/, "");
    if (!q) return [];
    const all = await listProfiles();
    return all.filter(p =>
      p.username.includes(q) || (p.displayName || "").toLowerCase().includes(q)
    ).slice(0, 24);
  }

  async function sendFriendRequest(targetUsername) {
    const me = await currentProfile();
    const target = await getProfile(targetUsername);
    if (!me || !target) throw new Error("User not found.");
    if (me.username === target.username) throw new Error("You cannot add yourself.");
    me.friendRequests ||= { incoming: [], outgoing: [] };
    target.friendRequests ||= { incoming: [], outgoing: [] };
    if ((me.friends || []).includes(target.username)) throw new Error("Already friends.");
    if (me.friendRequests.outgoing.includes(target.username)) throw new Error("Request already sent.");
    if (target.friendRequests.incoming.includes(me.username)) throw new Error("Request already exists.");
    me.friendRequests.outgoing.push(target.username);
    target.friendRequests.incoming.push(me.username);
    await putProfile(me);
    await putProfile(target);
  }

  async function acceptFriendRequest(fromUsername) {
    const me = await currentProfile();
    const other = await getProfile(fromUsername);
    if (!me || !other) throw new Error("User not found.");
    me.friendRequests ||= { incoming: [], outgoing: [] };
    other.friendRequests ||= { incoming: [], outgoing: [] };
    me.friendRequests.incoming = me.friendRequests.incoming.filter(x => x !== other.username);
    other.friendRequests.outgoing = other.friendRequests.outgoing.filter(x => x !== me.username);
    me.friends = [...new Set([...(me.friends || []), other.username])];
    other.friends = [...new Set([...(other.friends || []), me.username])];
    await putProfile(me);
    await putProfile(other);
  }

  async function rejectFriendRequest(fromUsername) {
    const me = await currentProfile();
    const other = await getProfile(fromUsername);
    if (!me || !other) throw new Error("User not found.");
    me.friendRequests ||= { incoming: [], outgoing: [] };
    other.friendRequests ||= { incoming: [], outgoing: [] };
    me.friendRequests.incoming = me.friendRequests.incoming.filter(x => x !== other.username);
    other.friendRequests.outgoing = other.friendRequests.outgoing.filter(x => x !== me.username);
    await putProfile(me); await putProfile(other);
  }

  async function removeFriend(username) {
    const me = await currentProfile();
    const other = await getProfile(username);
    if (!me || !other) throw new Error("User not found.");
    me.friends = (me.friends || []).filter(x => x !== other.username);
    other.friends = (other.friends || []).filter(x => x !== me.username);
    await putProfile(me); await putProfile(other);
  }


  async function toggleLike(username) {
    const me = await currentProfile();
    const target = await getProfile(username);
    if (!me || !target) throw new Error("User not found.");
    if (me.username === target.username) throw new Error("You cannot like your own profile.");
    target.likes ||= { count: 0, users: [] };
    target.likes.users ||= [];
    const index = target.likes.users.indexOf(me.username);
    const liked = index >= 0;
    if (liked) target.likes.users.splice(index, 1);
    else target.likes.users.push(me.username);
    target.likes.count = target.likes.users.length;
    await putProfile(target);
    return { liked: !liked, count: target.likes.count };
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
    const p = await getProfile(username);
    if (!p) return;
    p.stats ||= { views: 0 };
    const key = `pf_view_${p.username}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, "1");
    p.stats.views = Number(p.stats.views || 0) + 1;
    await putProfile(p);
  }

  async function ensureDemoAccount() {
    const list = await listProfiles();
    if (list.length) return false;
    const samples = [
      {username:"gx", displayName:"GX", bio:"Building digital identities, interfaces and game worlds.", template:"neon-arena", badges:["developer","creator"]},
      {username:"nova", displayName:"Nova", bio:"Designer • gamer • visual storyteller", template:"anime-cinema", badges:["creator"]}
    ];
    for (const s of samples) {
      const p = structuredClone(defaults);
      Object.assign(p, s);
      p.accent = templates.find(t => t[0] === s.template)?.[0] === "anime-cinema" ? "#ff6fb0" : "#55d6ff";
      p.sections = structuredClone(defaults.sections);
      await putProfile(p);
    }
    return true;
  }

  async function compressImage(file, maxW=1400, quality=.82) {
    if (!file || !file.type.startsWith("image/")) throw new Error("Please choose a valid image.");
    if (file.size > 10 * 1024 * 1024) throw new Error("Image must be 10 MB or smaller.");
    // Keep animated GIFs intact. Canvas would destroy animation.
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
    if (!file || !file.type.startsWith("audio/")) throw new Error("Please choose an audio file.");
    if (file.size > 10 * 1024 * 1024) throw new Error("Audio must be 10 MB or smaller.");
    const allowed = ["audio/mpeg","audio/mp3","audio/ogg","audio/wav","audio/x-wav","audio/mp4","audio/aac","audio/webm"];
    if (!allowed.includes(file.type) && !/\.(mp3|ogg|wav|m4a|aac|webm)$/i.test(file.name)) {
      throw new Error("Supported audio: MP3, OGG, WAV, M4A, AAC or WebM.");
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({ data: String(reader.result), mime: file.type || "audio/mpeg", size: file.size, name: file.name });
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

  window.PF = {
    defaults, badgeCatalog, templates, openDB, getProfile, listProfiles, putProfile, deleteProfile,
    normalizeUsername, validUsername, currentUsername, currentProfile, createAccount, login, clearSession,
    updateProfile, saveProfile, searchUsers, sendFriendRequest, acceptFriendRequest, rejectFriendRequest,
    removeFriend, toggleLike, friendshipState, addView, ensureDemoAccount, compressImage, readAudio, initials, escapeHtml, hashPassword, verifyPassword, safeUrl,
    paths: {home:"../index.html", login:"login.html", signup:"signup.html", profile:"profile.html", editor:"editor.html", explore:"explore.html", friends:"friends.html"}
  };
})();
