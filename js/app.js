/* ProfileForge — responsive local-first UI controller */
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => window.PF?.escapeHtml ? PF.escapeHtml(s) : String(s ?? "");
  const initials = (p) => PF.initials(p);

  const notify = (msg, type = "") => {
    let stack = $(".toast-stack");
    if (!stack) { stack = document.createElement("div"); stack.className = "toast-stack"; document.body.appendChild(stack); }
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.textContent = msg;
    stack.appendChild(el);
    setTimeout(() => el.remove(), 2800);
  };

  const avatarMarkup = (p, cls = "avatar-sm") => p?.avatar
    ? `<div class="${cls}"><img src="${esc(p.avatar)}" alt="${esc(p.displayName || p.username)}"></div>`
    : `<div class="${cls}">${esc(initials(p))}</div>`;

  window.PFUI = { $, $$, notify };

  function initMenu() {
    const button = $("[data-menu-toggle]");
    const panel = $("[data-menu-panel]");
    if (!button || !panel) return;
    const close = () => { panel.classList.remove("open"); button.setAttribute("aria-expanded", "false"); };
    button.addEventListener("click", () => {
      const open = !panel.classList.contains("open");
      panel.classList.toggle("open", open);
      button.setAttribute("aria-expanded", String(open));
    });
    panel.addEventListener("click", (e) => { if (e.target.closest("a")) close(); });
    document.addEventListener("click", (e) => { if (!panel.contains(e.target) && !button.contains(e.target)) close(); });
  }

  function nav() {
    const logged = !!PF.currentUsername();
    $$(".auth-required").forEach(el => el.classList.toggle("hidden", !logged));
    $$(".guest-only").forEach(el => el.classList.toggle("hidden", logged));
  }

  function initLanguage() {
    const saved = localStorage.getItem("pf_lang") || "en";
    const set = lang => {
      document.documentElement.lang = lang;
      document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
      localStorage.setItem("pf_lang", lang);
      $$('[data-lang-label]').forEach(el => el.textContent = lang === "ar" ? "EN" : "ع" );
    };
    set(saved);
    $("[data-lang]")?.addEventListener("click", e => {
      e.preventDefault(); set(document.documentElement.lang === "ar" ? "en" : "ar");
    });
  }

  document.addEventListener("DOMContentLoaded", async () => {
    nav(); initMenu(); initLanguage();
    $$('[data-profile-link]').forEach(a => { const me = PF.currentUsername(); if (me) a.href = `profile.html?u=${encodeURIComponent(me)}`; });
    $("[data-logout]")?.addEventListener("click", e => { e.preventDefault(); PF.clearSession(); location.href = "../index.html"; });
    const path = location.pathname.split("/").pop();
    try {
      if (path === "login.html") await initLogin();
      if (path === "signup.html") await initSignup();
      if (path === "editor.html") await initEditor();
      if (path === "profile.html") await initProfile();
      if (path === "explore.html") await initExplore();
      if (path === "friends.html") await initFriends();
      if (path === "settings.html") await initSettings();
      if (path === "messages.html") await initMessages();
    } catch (err) { console.error(err); notify(err.message || "Something went wrong", "error"); }
  });

  async function initLogin() {
    const form = $("#loginForm"); if (!form) return;
    form.addEventListener("submit", async e => {
      e.preventDefault();
      const btn = form.querySelector("button[type=submit]"); btn.disabled = true;
      $("#loginMsg") && ($("#loginMsg").textContent = "");
      try { await PF.login($("#loginUsername").value, $("#loginPassword").value); location.href = "profile.html"; }
      catch (err) { $("#loginMsg") && ($("#loginMsg").textContent = err.message); }
      finally { btn.disabled = false; }
    });
  }

  async function initSignup() {
    const form = $("#signupForm"); if (!form) return;
    $("#signupUsername")?.addEventListener("input", () => {
      const v = PF.normalizeUsername($("#signupUsername").value);
      $("#usernameHint") && ($("#usernameHint").textContent = PF.validUsername(v) ? "Username is available format-wise." : "4–26 chars: letters, numbers, . _ -");
    });
    form.addEventListener("submit", async e => {
      e.preventDefault();
      const btn = form.querySelector("button[type=submit]"); btn.disabled = true;
      $("#signupMsg") && ($("#signupMsg").textContent = "");
      try {
        const password = $("#signupPassword").value;
        if (password !== $("#signupPassword2").value) throw new Error("Passwords do not match.");
        await PF.createAccount({ username: $("#signupUsername").value, displayName: $("#signupDisplay").value, password });
        location.href = "editor.html";
      } catch (err) { $("#signupMsg") && ($("#signupMsg").textContent = err.message); }
      finally { btn.disabled = false; }
    });
  }

  const templates = {
    "discord-noir": { accent: "#7488ff", card: "glass" },
    "anime-cinema": { accent: "#ff6fb0", card: "poster" },
    "neon-arena": { accent: "#55d6ff", card: "outline" },
    "cyber-terminal": { accent: "#38ff9b", card: "terminal" },
    "dark-luxury": { accent: "#f4c879", card: "solid" },
    "minimal-ice": { accent: "#d9efff", card: "solid" },
    "samurai-ink": { accent: "#ff5f72", card: "poster" },
    "deep-space": { accent: "#9a86ff", card: "glass" },
    "creator-pulse": { accent: "#f26eea", card: "glass" },
    "monochrome-pro": { accent: "#f4f5f7", card: "outline" }
  };

  const templateNames = {
    "discord-noir": "Discord Noir",
    "anime-cinema": "Anime Cinema",
    "neon-arena": "Neon Arena",
    "cyber-terminal": "Cyber Terminal",
    "dark-luxury": "Dark Luxury",
    "minimal-ice": "Minimal Ice",
    "samurai-ink": "Samurai Ink",
    "deep-space": "Deep Space",
    "creator-pulse": "Creator Pulse",
    "monochrome-pro": "Monochrome Pro"
  };

  function applyVisual(state, target = document.documentElement) {
    const t = templates[state.template] || templates["discord-noir"];
    target.style.setProperty("--accent", state.accent || t.accent);
    target.style.setProperty("--radius", `${Number(state.cardRadius ?? 22)}px`);
    target.style.setProperty("--glow-strength", `${Number(state.glow ?? 40) / 100}`);
    target.dataset.template = state.template || "discord-noir";
    target.dataset.cardStyle = state.cardStyle || t.card;
  }

  function displayViews(n) {
    n = Number(n || 0); return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, "")}k` : String(n);
  }

  function safeLink(url) { return PF.safeUrl(url); }

  async function initEditor() {
    const me = await PF.currentProfile(); if (!me) { location.href = "login.html"; return; }
    const state = structuredClone(me);
    state.template = templates[state.template] ? state.template : "discord-noir";
    state.cardStyle = state.cardStyle || templates[state.template].card;
    state.socials ||= []; state.projects ||= []; state.badges ||= []; state.likes ||= {count:0, users:[]}; state.sections ||= PF.defaults.sections.map(x => ({...x}));
    state.sections = state.sections.filter(s => !["skills","projects"].includes(s.type));
    state.projects = [];

    const bind = (id, key, cleaner = x => x) => {
      const el = $("#" + id); if (!el) return;
      el.value = state[key] || "";
      el.addEventListener("input", () => { state[key] = cleaner(el.value); refreshPreview(); });
    };
    bind("usernameInput", "username", PF.normalizeUsername);
    bind("displayNameInput", "displayName", v => v.slice(0, 60));
    bind("bioInput", "bio", v => v.slice(0, 220));
    bind("descriptionInput", "description", v => v.slice(0, 1000));
    bind("locationInput", "location", v => v.slice(0, 100));
    bind("websiteInput", "website", v => v.slice(0, 180));

    function refreshPreview() {
      applyVisual(state);
      const root = $("#livePreviewRoot"); if (!root) return;
      root.innerHTML = renderProfileCard(state, { preview: true, isMe: true });
      bindPlayer(root);
    }

    $$(".editor-tab").forEach(tab => tab.addEventListener("click", () => {
      $$(".editor-tab").forEach(x => x.classList.remove("active")); tab.classList.add("active");
      $$('[data-panel-content]').forEach(p => p.classList.toggle("hidden-panel", p.dataset.panelContent !== tab.dataset.panel));
    }));

    $$("#templateGrid .template-choice").forEach(b => b.addEventListener("click", () => {
      state.template = b.dataset.template;
      state.cardStyle = templates[state.template].card;
      state.accent = templates[state.template].accent;
      $$("#templateGrid .template-choice").forEach(x => x.classList.remove("selected")); b.classList.add("selected");
      refreshPreview();
    }));
    $$("#cardStyleGrid .card-style-choice").forEach(b => b.addEventListener("click", () => {
      state.cardStyle = b.dataset.cardStyle;
      $$("#cardStyleGrid .card-style-choice").forEach(x => x.classList.remove("selected")); b.classList.add("selected");
      refreshPreview();
    }));
    $("#accentInput")?.addEventListener("input", e => { state.accent = e.target.value; refreshPreview(); });
    $("#radiusRange")?.addEventListener("input", e => { state.cardRadius = Number(e.target.value); refreshPreview(); });
    $("#glowRange")?.addEventListener("input", e => { state.glow = Number(e.target.value); refreshPreview(); });

    const upload = async (id, key, maxW, previewId) => {
      $("#" + id)?.addEventListener("change", async e => {
        try {
          state[key] = await PF.compressImage(e.target.files[0], maxW, .84);
          if (previewId && $("#" + previewId)) { $("#" + previewId).src = state[key]; $("#" + previewId).classList.remove("hidden"); }
          refreshPreview();
        } catch (err) { notify(err.message, "error"); }
      });
    };
    await upload("avatarUpload", "avatar", 900, "avatarMediaPreviewImg");
    await upload("bannerUpload", "banner", 1600, "bannerMediaPreviewImg");
    await upload("miniUpload", "miniImage", 500, "miniPreviewImg");

    $$("#frameGrid .frame-choice").forEach(b => b.addEventListener("click", () => {
      state.avatarFrame = b.dataset.frame;
      $$("#frameGrid .frame-choice").forEach(x => x.classList.remove("selected")); b.classList.add("selected");
      refreshPreview();
    }));

    $("#musicTitle") && ($("#musicTitle").value = state.music?.title || "", $("#musicTitle").addEventListener("input", e => { state.music = {...(state.music || {}), title: e.target.value.slice(0, 80), artist: ""}; refreshPreview(); }));
    $("#musicUpload")?.addEventListener("change", async e => {
      try {
        const m = await PF.readAudio(e.target.files[0]);
        state.music = {...(state.music || {}), audio: m.data, mime: m.mime, size: m.size, artist: ""};
        if (!(state.sections || []).some(s => s.type === "music")) state.sections.push({ id: crypto.randomUUID(), type: "music", title: "Music", visible: true });
        $("#musicFileName") && ($("#musicFileName").textContent = `${m.name} · ${(m.size / 1048576).toFixed(2)} MB`);
        refreshPreview();
      } catch (err) { notify(err.message, "error"); }
    });
    $("#musicCoverUpload")?.addEventListener("change", async e => {
      try { state.music = {...(state.music || {}), cover: await PF.compressImage(e.target.files[0], 600, .82)}; refreshPreview(); }
      catch (err) { notify(err.message, "error"); }
    });

    renderSections(state); renderSocials(state); renderBadges(state);
    $("#addSocial")?.addEventListener("click", () => { state.socials.push({label:"Website", url:""}); renderSocials(state); });

    $("#saveBtn")?.addEventListener("click", async () => {
      try {
        const oldUsername = me.username;
        const u = PF.normalizeUsername(state.username);
        if (!PF.validUsername(u)) throw new Error("Invalid username format.");
        if (u !== oldUsername && await PF.getProfile(u)) throw new Error("Username already taken.");
        state.username = u;
        state.password ||= me.password;
        state.projects = [];
        state.music = {...(state.music || {}), artist: ""};
        await PF.saveProfile(state); localStorage.setItem("pf_session", u);
        notify("Profile saved", "success");
        setTimeout(() => location.href = `profile.html?u=${encodeURIComponent(u)}`, 380);
      } catch (err) { notify(err.message, "error"); }
    });

    const t = templates[state.template];
    $("#accentInput") && ($("#accentInput").value = state.accent || t.accent);
    $("#radiusRange") && ($("#radiusRange").value = state.cardRadius ?? 22);
    $("#glowRange") && ($("#glowRange").value = state.glow ?? 40);
    $(`#templateGrid .template-choice[data-template="${state.template}"]`)?.classList.add("selected");
    $(`#cardStyleGrid .card-style-choice[data-card-style="${state.cardStyle}"]`)?.classList.add("selected");
    $(`#frameGrid .frame-choice[data-frame="${state.avatarFrame || "none"}"]`)?.classList.add("selected");
    if (state.avatar && $("#avatarMediaPreviewImg")) { $("#avatarMediaPreviewImg").src = state.avatar; $("#avatarMediaPreviewImg").parentElement.classList.remove("hidden"); }
    if (state.banner && $("#bannerMediaPreviewImg")) { $("#bannerMediaPreviewImg").src = state.banner; $("#bannerMediaPreviewImg").parentElement.classList.remove("hidden"); }
    refreshPreview();
  }

  function renderSections(state) {
    const box = $("#sectionList"); if (!box) return;
    box.innerHTML = state.sections.map((s, i) => `<div class="section-item" draggable="true" data-index="${i}"><span class="drag">⠿</span><div><b>${esc(s.title)}</b><small>${s.visible ? "Visible" : "Hidden"}</small></div><div class="row-actions"><button class="icon-btn" data-section-toggle="${i}" aria-label="Toggle">${s.visible ? "◉" : "○"}</button><button class="icon-btn" data-section-up="${i}">↑</button><button class="icon-btn" data-section-down="${i}">↓</button></div></div>`).join("");
    $$('[data-section-toggle]').forEach(b => b.onclick = () => { state.sections[+b.dataset.sectionToggle].visible = !state.sections[+b.dataset.sectionToggle].visible; renderSections(state); });
    $$('[data-section-up]').forEach(b => b.onclick = () => moveSection(state, +b.dataset.sectionUp, -1));
    $$('[data-section-down]').forEach(b => b.onclick = () => moveSection(state, +b.dataset.sectionDown, 1));
    let dragged = null;
    $$("#sectionList .section-item").forEach(el => {
      el.ondragstart = () => dragged = +el.dataset.index;
      el.ondragover = e => e.preventDefault();
      el.ondrop = () => { const to = +el.dataset.index; if (dragged !== null && dragged !== to) { const [item] = state.sections.splice(dragged, 1); state.sections.splice(to, 0, item); renderSections(state); } dragged = null; };
    });
  }
  function moveSection(state, idx, delta) { const next = idx + delta; if (next < 0 || next >= state.sections.length) return; [state.sections[idx], state.sections[next]] = [state.sections[next], state.sections[idx]]; renderSections(state); }

  function renderSocials(state) {
    const box = $("#socialList"); if (!box) return;
    box.innerHTML = state.socials.map((s, i) => `<div class="edit-row"><input class="field-input" value="${esc(s.label)}" data-social-label="${i}" placeholder="Platform"><input class="field-input" value="${esc(s.url)}" data-social-url="${i}" placeholder="https://..."><button class="btn btn-sm btn-danger" data-social-del="${i}">Remove</button></div>`).join("");
    $$('[data-social-label]').forEach(x => x.oninput = () => state.socials[+x.dataset.socialLabel].label = x.value.slice(0, 30));
    $$('[data-social-url]').forEach(x => x.oninput = () => state.socials[+x.dataset.socialUrl].url = x.value.slice(0, 500));
    $$('[data-social-del]').forEach(x => x.onclick = () => { state.socials.splice(+x.dataset.socialDel, 1); renderSocials(state); });
  }

  function renderProjects() { return; }

  function renderBadges(state) {
    const box = $("#badgeList"); if (!box) return;
    const special = new Set(["verified", "founder"]);
    const all = PF.badgeCatalog.filter(b => !special.has(b.id));
    box.innerHTML = all.map(b => `<button type="button" class="badge-choice ${state.badges.includes(b.id) ? "selected" : ""}" data-badge="${b.id}"><span>${esc(b.icon)}</span><b>${esc(b.name)}</b><small>${esc(b.rarity)}</small></button>`).join("");
    $$('[data-badge]').forEach(btn => btn.onclick = () => {
      const id = btn.dataset.badge; const has = state.badges.includes(id);
      if (!has && state.badges.length >= 3) return notify("Choose up to 3 badges.", "error");
      state.badges = has ? state.badges.filter(x => x !== id) : [...state.badges, id];
      renderBadges(state);
    });
  }

  function bannerBackground(p) {
    return `linear-gradient(115deg, color-mix(in srgb, var(--accent) 38%, #090b10), #0a0d13 72%)`;
  }

  function badgePills(p, limit = 3) {
    const list = (p.badges || []).slice(0, limit).map(id => PF.badgeCatalog.find(x => x.id === id)).filter(Boolean);
    return list.map(b => `<span class="badge-pill" title="${esc(b.name)}"><span>${esc(b.icon)}</span>${esc(b.name)}</span>`).join("");
  }

  function friendPreviewRows(friendProfiles, max = 5) {
    return friendProfiles.slice(0, max).map(p => `<a class="friend-mini" href="profile.html?u=${encodeURIComponent(p.username)}">${avatarMarkup(p, "avatar-xs")}<span><b>${esc(p.displayName)}</b><small>@${esc(p.username)}</small></span></a>`).join("");
  }

  function renderMusic(p) {
    if (!p.music?.audio) return "";
    return `<section class="section-block music-section"><div class="section-kicker">MUSIC</div><div class="pf-player" data-pf-player><div class="player-cover">${p.music.cover ? `<img src="${esc(p.music.cover)}" alt="">` : `<span>♫</span>`}</div><div class="player-main"><div class="player-title">${esc(p.music.title || "Profile Music")}</div><div class="player-meta">Profile track</div><div class="player-controls"><button type="button" data-player-play class="player-btn">▶</button><div class="player-progress"><span data-player-bar></span></div><span data-player-time>0:00</span><input data-player-volume type="range" min="0" max="1" step="0.01" value="0.8"></div></div><audio data-player-audio preload="metadata" src="${esc(p.music.audio)}"></audio></div></section>`;
  }

  function bindPlayer(root = document) {
    $$("[data-pf-player]", root).forEach(player => {
      const audio = $("[data-player-audio]", player), play = $("[data-player-play]", player), bar = $("[data-player-bar]", player), time = $("[data-player-time]", player), vol = $("[data-player-volume]", player);
      if (!audio || player.dataset.bound) return; player.dataset.bound = "1"; audio.volume = .8;
      const fmt = sec => { sec = Number(sec || 0); return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2,"0")}`; };
      play.onclick = async () => { try { if (audio.paused) { await audio.play(); play.textContent = "Ⅱ"; } else { audio.pause(); play.textContent = "▶"; } } catch { notify("Tap play to start music.", "error"); } };
      audio.ontimeupdate = () => { const pct = audio.duration ? (audio.currentTime / audio.duration) * 100 : 0; bar.style.width = `${pct}%`; time.textContent = fmt(audio.currentTime); };
      audio.onended = () => play.textContent = "▶";
      vol.oninput = () => audio.volume = Number(vol.value);
    });
  }

  function renderProfileCard(p, { preview = false, isMe = false, friendProfiles = [], relationship = "none" } = {}) {
    applyVisual(p);
    const views = displayViews(p.stats?.views);
    const friends = Array.isArray(p.friends) ? p.friends : [];
    const more = Math.max(0, friends.length - 5);
    const badges = badgePills(p);
    const likedBy = p.likes?.users || [];
    const meUsername = PF.currentUsername();
    const liked = !!meUsername && likedBy.includes(meUsername);
    const likeCount = Number(p.likes?.count ?? likedBy.length ?? 0);
    const mini = p.miniImage ? `<div class="profile-mini-float" title="Decorative image"><img src="${esc(p.miniImage)}" alt=""></div>` : "";
    const frame = `frame-${p.avatarFrame || "none"}`;
    const social = (p.socials || []).map(s => { const href = safeLink(s.url); return href ? `<a class="social-pill" href="${esc(href)}" target="_blank" rel="noreferrer">${esc(s.label || "Link")}</a>` : ""; }).join("");
    const sectionHtml = (p.sections || []).filter(s => s.visible !== false && !["skills", "projects"].includes(s.type)).map(s => {
      if (s.type === "about") return `<section class="section-block about-section"><div class="section-kicker">ABOUT</div><h2>${esc(s.title || "About Me")}</h2><p class="profile-description">${esc(p.description || p.bio || "Tell people something about you.")}</p>${p.location ? `<div class="about-meta"><span>⌖ ${esc(p.location)}</span>${p.website && safeLink(p.website) ? `<a href="${esc(safeLink(p.website))}" target="_blank" rel="noreferrer">Website ↗</a>` : ""}</div>` : ""}</section>`;
      if (s.type === "friends") return `<section class="section-block"><div class="section-head"><div><div class="section-kicker">FRIENDS</div><h2>Your circle</h2></div>${more ? `<button class="btn btn-sm" data-friends-open>+${more}</button>` : ""}</div><div class="friend-mini-grid">${friendPreviewRows(friendProfiles,5)}</div></section>`;
      if (s.type === "music") return renderMusic(p);
      return `<section class="section-block"><div class="section-kicker">CUSTOM</div><h2>${esc(s.title || "Section")}</h2><p class="profile-description">${esc(p.description || "")}</p></section>`;
    }).join("");

    const banner = p.banner
      ? `<img class="profile-banner-image" src="${esc(p.banner)}" alt="" loading="eager">`
      : `<div class="profile-banner-fallback"></div>`;
    let action = "";
    const canInteract = !preview && !isMe && !!PF.currentUsername();
    if (canInteract) {
      if (relationship === "friends") action = `<span class="relationship-badge friends-state">✓ Friends</span>`;
      else if (relationship === "outgoing") action = `<span class="relationship-badge request-state">Request sent</span>`;
      else if (relationship === "incoming") action = `<span class="relationship-badge request-state">Friend request</span>`;
      else action = `<button class="btn btn-primary" data-add-friend>+ Add Friend</button>`;
    }
    const quickLike = canInteract ? `<button class="like-btn ${liked ? "liked" : ""}" data-like-profile aria-label="${liked ? "Unlike" : "Like"}"><span class="heart">${liked ? "♥" : "♡"}</span><span class="like-count">${displayViews(likeCount)}</span></button>` : "";
    const messageAction = canInteract
      ? `<a class="btn" href="messages.html?u=${encodeURIComponent(p.username)}">Message</a>`
      : "";
    const friendActionWrap = canInteract
      ? `<div class="profile-head-actions profile-social-actions">${quickLike}${messageAction}${action}${mini}</div>`
      : "";
    const standaloneMini = !canInteract && mini ? `<div class="profile-mini-standalone">${mini}</div>` : "";

    return `<article class="profile-card template-card">
      <div class="profile-banner">${banner}</div>
      <div class="profile-content">
        <div class="profile-head">
          <div class="profile-avatar-wrap">
            <div class="profile-avatar ${frame}">${p.avatar ? `<img src="${esc(p.avatar)}" alt="${esc(p.displayName || p.username)}">` : esc(initials(p))}</div>
          </div>
          <div class="profile-identity">
            <div class="profile-topline"><span class="status-dot ${p.status === "Offline" ? "offline" : ""}"></span><span>${esc(p.status === "Custom" ? (p.customStatus || "Online") : (p.status || "Online"))}</span>${isMe ? `<span class="you-label">YOUR PROFILE</span>` : ""}</div>
            <h1>${esc(p.displayName || p.username)}</h1>
            <div class="profile-username">@${esc(p.username)}</div>
            <p>${esc(p.bio || "")}</p>
            <div class="badges-inline">${badges}</div>
          </div>
          ${friendActionWrap}
        </div>
        ${standaloneMini}
        ${!isMe && !PF.currentUsername() ? `<div class="profile-actions-row"><span class="compact-likes-label">${displayViews(likeCount)} likes</span></div>` : ""}
        <div class="profile-stats">
          <div><span>Friends</span><b>${friends.length}</b></div>
          <div class="online-stat"><span><i class="status-dot"></i> Online</span><b>Active</b></div>
          <div class="view-stat"><span><span class="eye-mini">◉</span> Views</span><b>${views}</b></div>
        </div>
        <div class="social-row">${social}</div>
        <div class="profile-sections">${sectionHtml || `<section class="section-block"><div class="section-kicker">ABOUT</div><p class="profile-description">${esc(p.description || p.bio || "No profile content yet.")}</p></section>`}</div>
      </div>
    </article>`;
  }

  async function initProfile() {
    const username = PF.normalizeUsername(new URLSearchParams(location.search).get("u") || "");
    const root = $("#profileRoot");
    if (!root || !username) { if (root) root.innerHTML = `<div class="empty-state glass"><h2>Profile not found</h2></div>`; return; }
    let p = await PF.getProfile(username);
    if (!p) { root.innerHTML = `<div class="empty-state glass"><h2>Profile not found</h2><p>This username does not exist on this device.</p></div>`; return; }
    if (!templates[p.template]) p = {...p, template:"discord-noir"};
    p.sections = (p.sections || []).filter(s => !["skills", "projects"].includes(s.type));
    const me = PF.currentUsername();
    const isMe = me === p.username;
    const viewer = !isMe ? await PF.currentProfile() : p;
    const relationship = isMe ? "self" : PF.friendshipState(viewer, p.username);
    const friends = (p.friends || []);
    const friendProfiles = await PF.getProfiles(friends);
    if (!isMe) await PF.addView(username);
    p = !isMe ? await PF.getProfile(username) : p;
    p.likes ||= {count:0, users:[]};
    p.likes.users ||= [];
    p.likes.count = p.likes.users.length;
    root.innerHTML = renderProfileCard(p, { isMe, friendProfiles, relationship });
    bindPlayer(root);
    $(`[data-add-friend]`)?.addEventListener("click", async () => {
      try {
        await PF.sendFriendRequest(p.username);
        notify("Friend request sent", "success");
        const updated = await PF.getProfile(p.username);
        const selfFresh = await PF.currentProfile();
        const rel = PF.friendshipState(selfFresh, p.username);
        root.innerHTML = renderProfileCard(updated, { isMe:false, friendProfiles, relationship:rel });
        bindPlayer(root);
        bindProfileActions(updated);
      } catch (err) { notify(err.message, "error"); }
    });
    bindProfileActions(p);
    $(`[data-friends-open]`)?.addEventListener("click", () => openFriendsModal(friendProfiles));
  }

  async function bindProfileActions(profile) {
    $("[data-like-profile]")?.addEventListener("click", async () => {
      try {
        const result = await PF.toggleLike(profile.username);
        const fresh = await PF.getProfile(profile.username);
        const viewer = await PF.currentProfile();
        const rel = PF.friendshipState(viewer, profile.username);
        const friends = (fresh?.friends || []);
        const friendProfiles = await PF.getProfiles(friends);
        const root = $("#profileRoot");
        if (root && fresh) {
          root.innerHTML = renderProfileCard(fresh, { isMe:false, friendProfiles, relationship:rel });
          bindPlayer(root);
          $("[data-friends-open]")?.addEventListener("click", () => openFriendsModal(friendProfiles));
        }
        notify(result.liked ? "Profile liked" : "Like removed", "success");
      } catch (err) { notify(err.message, "error"); }
    });
  }

  function openFriendsModal(profiles) {
    let modal = $("#friendsModal");
    if (!modal) {
      modal = document.createElement("div"); modal.id = "friendsModal"; modal.className = "modal-backdrop";
      modal.innerHTML = `<div class="modal-card glass"><div class="modal-head"><div><span class="eyebrow">FRIENDS</span><h2>Full circle</h2></div><button class="icon-btn" data-modal-close>×</button></div><input class="field-input" data-modal-search placeholder="Search friends..."><div class="modal-friends" data-modal-list></div></div>`;
      document.body.appendChild(modal);
      modal.addEventListener("click", e => { if (e.target === modal || e.target.closest("[data-modal-close]")) modal.classList.remove("open"); });
      $("[data-modal-search]", modal).addEventListener("input", () => renderModalFriends());
    }
    modal.classList.add("open");
    const renderModalFriends = () => {
      const q = $("[data-modal-search]", modal).value.trim().toLowerCase().replace(/^@/, "");
      const list = profiles.filter(p => !q || p.username.includes(q) || (p.displayName || "").toLowerCase().includes(q));
      $("[data-modal-list]", modal).innerHTML = list.length ? list.map(p => `<a class="modal-friend" href="profile.html?u=${encodeURIComponent(p.username)}">${avatarMarkup(p,"avatar-xs")}<span><b>${esc(p.displayName)}</b><small>@${esc(p.username)}</small></span></a>`).join("") : `<div class="empty-state"><p>No friends found.</p></div>`;
    };
    renderModalFriends();
  }

  async function initExplore() {
    const form = $("#searchForm"), input = $("#searchInput"), box = $("#results"); if (!box) return;
    const draw = list => box.innerHTML = list.length ? list.map(p => `<article class="user-card glass"><div class="user-top">${avatarMarkup(p)}<div><strong>${esc(p.displayName)}</strong><span>@${esc(p.username)}</span></div></div><p>${esc(p.bio || "No bio yet.")}</p><div class="badges-inline">${badgePills(p, 1)}</div><a class="btn btn-sm btn-primary" href="profile.html?u=${encodeURIComponent(p.username)}">View Profile</a></article>`).join("") : `<div class="empty-state glass" style="grid-column:1/-1"><h2>No profiles found</h2><p>Search by username or display name.</p></div>`;
    const all = await PF.listProfiles(); draw(all.slice(0, 12));
    form?.addEventListener("submit", async e => { e.preventDefault(); draw(await PF.searchUsers(input.value)); });
    let searchTimer = 0;
    input?.addEventListener("input", () => {
      clearTimeout(searchTimer);
      const q = input.value.trim();
      searchTimer = setTimeout(async () => {
        try { draw(q ? await PF.searchUsers(q) : all.slice(0, 12)); } catch (e) { notify(e.message, "error"); }
      }, 220);
    });
  }

  async function initFriends() {
    const me = await PF.currentProfile(); if (!me) { location.href = "login.html"; return; }
    const requestBox = $("#requestList"), friendBox = $("#friendList"), search = $("#friendSearch");
    const render = async query => {
      const fresh = await PF.currentProfile();
      const incoming = fresh.friendRequests?.incoming || [], friends = fresh.friends || [];
      const requestProfiles = await PF.getProfiles(incoming);
      const requests = requestProfiles.filter(Boolean);
      let profiles = (await PF.getProfiles(friends)).filter(Boolean);
      const q = String(query || "").trim().toLowerCase().replace(/^@/, "");
      if (q) profiles = profiles.filter(p => p.username.includes(q) || (p.displayName || "").toLowerCase().includes(q));
      requestBox.innerHTML = requests.length ? requests.map(p => `<article class="user-card glass"><div class="user-top">${avatarMarkup(p)}<div><strong>${esc(p.displayName)}</strong><span>@${esc(p.username)}</span></div></div><div class="hero-actions"><button class="btn btn-sm btn-primary" data-accept="${esc(p.username)}">Accept</button><button class="btn btn-sm btn-danger" data-reject="${esc(p.username)}">Decline</button></div></article>`).join("") : `<div class="empty-state glass" style="grid-column:1/-1">No pending requests.</div>`;
      friendBox.innerHTML = profiles.length ? profiles.map(p => `<article class="user-card glass"><div class="user-top">${avatarMarkup(p)}<div><strong>${esc(p.displayName)}</strong><span>@${esc(p.username)}</span></div></div><p>${esc(p.bio || "")}</p><div class="hero-actions"><a class="btn btn-sm btn-primary" href="profile.html?u=${encodeURIComponent(p.username)}">View</a><button class="btn btn-sm btn-danger" data-remove="${esc(p.username)}">Remove</button></div></article>`).join("") : `<div class="empty-state glass" style="grid-column:1/-1">No friends found.</div>`;
      $$('[data-accept]').forEach(b => b.onclick = async () => { try { await PF.acceptFriendRequest(b.dataset.accept); notify("Friend added", "success"); render(search?.value); } catch(e) { notify(e.message,"error"); } });
      $$('[data-reject]').forEach(b => b.onclick = async () => { try { await PF.rejectFriendRequest(b.dataset.reject); notify("Request declined", "success"); render(search?.value); } catch(e) { notify(e.message,"error"); } });
      $$('[data-remove]').forEach(b => b.onclick = async () => { try { await PF.removeFriend(b.dataset.remove); notify("Friend removed", "success"); render(search?.value); } catch(e) { notify(e.message,"error"); } });
    };
    search?.addEventListener("input", () => render(search.value)); await render("");
  }

  async function initMessages() {
    const me = await PF.currentProfile();
    if (!me) { location.href = "login.html"; return; }
    const list = $("#conversationList");
    const empty = $("#messageEmpty");
    const search = $("#messageSearch");
    const thread = $("#messageThread");
    const title = $("#messageThreadTitle");
    const form = $("#messageForm");
    const input = $("#messageInput");
    const status = $("#messageStatus");
    let activeUser = "";
    let conversations = [];
    let unsubscribe = null;

    const scrollThread = () => { if (thread) thread.scrollTop = thread.scrollHeight; };
    const avatarMini = p => p?.avatar ? `<img class="message-avatar" src="${esc(p.avatar)}" alt="">` : `<span class="message-avatar message-avatar-fallback">${esc(PF.initials(p))}</span>`;
    const renderConversations = () => {
      const q = String(search?.value || "").trim().toLowerCase().replace(/^@/, "");
      const filtered = conversations.filter(c => !q || c.username.includes(q) || c.displayName.toLowerCase().includes(q));
      list.innerHTML = filtered.length ? filtered.map(c => `<button type="button" class="conversation-item ${activeUser === c.username ? "active" : ""}" data-conversation="${esc(c.username)}"><span class="conversation-avatar">${avatarMini(c)}</span><span class="conversation-copy"><b>${esc(c.displayName)}</b><small>@${esc(c.username)}</small><em>${esc(c.lastMessage || "No messages yet")}</em></span><time>${esc(c.updatedLabel || "")}</time></button>`).join("") : `<div class="message-list-empty">${q ? "No matching conversations." : "No conversations yet."}</div>`;
      $$('[data-conversation]').forEach(btn => btn.onclick = () => openConversation(btn.dataset.conversation));
    };
    const renderThread = messages => {
      messages = [...messages].reverse();
      if (!activeUser) { thread.innerHTML = `<div id="messageEmpty" class="message-empty"><div class="message-empty-icon">✉</div><h2>Choose a conversation</h2><p>Select someone from the left to start messaging.</p></div>`; return; }
      thread.innerHTML = messages.length ? messages.map(m => `<div class="message-row ${m.sender_username === me.username ? "mine" : "theirs"}"><div class="message-bubble">${esc(m.content).replace(/\n/g,"<br>")}<time>${new Date(m.created_at).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"})}</time></div></div>`).join("") : `<div class="message-empty"><div class="message-empty-icon">✉</div><h2>No messages yet</h2><p>Send the first text message.</p></div>`;
      scrollThread();
    };
    async function loadConversations() {
      conversations = await PF.listConversations();
      renderConversations();
    }
    async function openConversation(username) {
      activeUser = PF.normalizeUsername(username);
      const c = conversations.find(x => x.username === activeUser);
      title.innerHTML = c ? `<span class="thread-user-avatar">${avatarMini(c)}</span><span><b>${esc(c.displayName)}</b><small>@${esc(c.username)}</small></span>` : esc("@" + activeUser);
      status.textContent = "";
      renderConversations();
      try { renderThread(await PF.getMessages(activeUser)); input.disabled = false; input.focus(); }
      catch (e) { notify(e.message, "error"); }
    }
    form?.addEventListener("submit", async e => {
      e.preventDefault();
      const text = input.value.trim();
      if (!activeUser || !text) return;
      input.disabled = true;
      try {
        await PF.sendMessage(activeUser, text);
        input.value = "";
        renderThread([...(await PF.getMessages(activeUser))]);
        await loadConversations();
      } catch (e) { notify(e.message, "error"); }
      finally { input.disabled = false; input.focus(); }
    });
    search?.addEventListener("input", renderConversations);
    unsubscribe = await PF.subscribeMessages(async msg => {
      if (msg.sender_username === activeUser || msg.receiver_username === activeUser) {
        try { renderThread(await PF.getMessages(activeUser)); } catch {}
      }
      try { await loadConversations(); } catch {}
    });
    window.addEventListener("beforeunload", () => { try { unsubscribe?.(); } catch {} });
    if (list) await loadConversations();
    input.disabled = true;
    status.textContent = "Text messages only · no voice or files";
    const initialUser = PF.normalizeUsername(new URLSearchParams(location.search).get("u") || "");
    if (initialUser && initialUser !== me.username) {
      try {
        const profile = await PF.getProfile(initialUser);
        if (profile && !conversations.some(c => c.username === initialUser)) {
          conversations.unshift({ username: profile.username, displayName: profile.displayName || profile.username, avatar: profile.avatar || "", lastMessage: "Start a new conversation", updatedLabel: "" });
          renderConversations();
        }
        if (profile) await openConversation(initialUser);
      } catch (e) { notify(e.message, "error"); }
    }
  }

  async function initSettings() {
    const me = await PF.currentProfile(); if (!me) { location.href = "login.html"; return; }
    $("#settingsUsername") && ($("#settingsUsername").textContent = "@" + me.username);
    $("#settingsDisplay") && ($("#settingsDisplay").textContent = me.displayName || me.username);
    $("#settingsLogout")?.addEventListener("click", async () => { await PF.clearSession(); location.href = "../index.html"; });
    const select = $("#messagePrivacy");
    const save = $("#messagePrivacySave");
    const hint = $("#messagePrivacyHint");
    if (select) select.value = me.messageSettings?.whoCanMessage === "friends" ? "friends" : "everyone";
    save?.addEventListener("click", async () => {
      try {
        save.disabled = true;
        const v = await PF.setMessageSetting(select.value);
        hint.textContent = v === "friends" ? "Only your accepted friends can message you." : "Anyone with a Rivo account can message you.";
        notify("Message privacy saved", "success");
      } catch (e) { notify(e.message, "error"); }
      finally { save.disabled = false; }
    });
  }
})();
