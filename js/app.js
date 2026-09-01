/* ProfileForge — responsive local-first UI controller */
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => window.PF?.escapeHtml ? PF.escapeHtml(s) : String(s ?? "");
  const initials = (p) => PF.initials(p);
  let profilePresenceUnsubscribe = null;

  const notify = (msg, type = "") => {
    let stack = $(".toast-stack");
    if (!stack) { stack = document.createElement("div"); stack.className = "toast-stack"; document.body.appendChild(stack); }
    const el = document.createElement("div");
    el.className = `toast ${type}`;
    el.textContent = msg;
    stack.appendChild(el);
    setTimeout(() => el.remove(), 2800);
  };

  const avatarMarkup = (p, cls = "avatar-sm") => {
    const username = PF.normalizeUsername(p?.username || "");
    const active = !!p?.story?.active;
    const own = !!username && username === PF.currentUsername();
    const inner = p?.avatar
      ? `<span class="${cls}"><img src="${esc(p.avatar)}" alt="${esc(p.displayName || p.username)}"></span>`
      : `<span class="${cls}">${esc(initials(p))}</span>`;
    return `<span class="avatar-story-trigger ${active ? "has-story" : ""} ${own ? "is-own-story-avatar" : ""}" data-story-user="${esc(username)}" data-story-active="${active ? "1" : "0"}" data-story-own="${own ? "1" : "0"}" title="${active ? `View ${esc(p?.displayName || username)} story` : own ? "Add a story" : ""}">${active ? `<span class="story-ring-frame" aria-hidden="true"></span>` : ""}${inner}${own && !active ? `<b class="story-add-dot" aria-hidden="true">+</b>` : ""}</span>`;
  };

  window.PFUI = { $, $$, notify };

  function initMenu() {
    const button = $("[data-menu-toggle]");
    const panel = $("[data-menu-panel]");
    if (!button || !panel) return;
    const close = () => { panel.classList.remove("open"); button.setAttribute("aria-expanded", "false"); };
    button.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const open = !panel.classList.contains("open");
      panel.classList.toggle("open", open);
      button.setAttribute("aria-expanded", String(open));
    });
    panel.addEventListener("click", (e) => { if (e.target.closest("a")) close(); });
    document.addEventListener("click", (e) => { if (!panel.contains(e.target) && !button.contains(e.target)) close(); });

    // On phones the bottom bar owns the primary destinations. Keep the menu
    // compact by removing those same destinations and retaining Home + tools.
    if (window.innerWidth <= 760) {
      // The bottom bar is the primary phone navigation. Do not repeat its
      // destinations in the overflow menu; the menu keeps only secondary tools.
      const duplicateHrefs = ["index.html", "posts.html", "explore.html", "messages.html", "profile.html"];
      panel.querySelectorAll("a").forEach(a => {
        const href = (a.getAttribute("href") || "").split("?")[0];
        if (duplicateHrefs.some(x => href.endsWith("/" + x) || href === x)) {
          a.remove();
        }
      });
    }
  }

  function initMobileBottomNav() {
    if (window.innerWidth > 760 || $("[data-rivo-mobile-bottom-nav]")) return;
    const bar = document.createElement("nav");
    bar.className = "rivo-mobile-bottom-nav";
    bar.setAttribute("data-rivo-mobile-bottom-nav", "true");
    const pageBase = location.pathname.includes("/pages/") ? "" : "pages/";
    const profileHref = () => {
      const me = PF.currentUsername();
      return me ? `${pageBase}profile.html?u=${encodeURIComponent(me)}` : `${pageBase}login.html`;
    };
    const icon = {
      menu:`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"></path></svg>`,
      profile:`<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.5"></circle><path d="M4.8 20c.8-3.2 3.2-5 7.2-5s6.4 1.8 7.2 5"></path></svg>`,
      explore:`<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.7"></circle><path d="m16 16 4 4"></path></svg>`,
      home:`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10.5 12 4l8 6.5"></path><path d="M6 9.5V19a1 1 0 0 0 1 1h3.5v-5h3v5H17a1 1 0 0 0 1-1V9.5"></path></svg>`,
      settings:`<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 13a7.97 7.97 0 0 0 0-2l2-1.5-2-3.4-2.4 1a8 8 0 0 0-1.7-1L15 3h-4l-.3 2.1a8 8 0 0 0-1.7 1l-2.4-1-2 3.4L6.6 11a8 8 0 0 0 0 2l-2 1.5 2 3.4 2.4-1a8 8 0 0 0 1.7 1L11 21h4l.3-2.1a8 8 0 0 0 1.7-1l2.4 1 2-3.4-2-1.5Z"></path></svg>`,
      messages:`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6.8A3.8 3.8 0 0 1 7.8 3h8.4A3.8 3.8 0 0 1 20 6.8v5.4a3.8 3.8 0 0 1-3.8 3.8H11l-4.7 4v-4.5A3.8 3.8 0 0 1 4 12.2Z"></path><path d="M8 9h8M8 12h5"></path></svg>`
    };
    const item = (key, label, href, extra="", iconKey=key) => `<a class="rivo-mobile-nav-item ${extra}" data-mobile-nav="${key}" href="${href}"><span class="rivo-mobile-nav-icon">${icon[iconKey]}</span><span data-i18n-nav="${key}">${label}</span></a>`;
    bar.innerHTML = `${item("menu", "Menu", "#", "rivo-mobile-menu-trigger")}${item("explore", "Search", `${pageBase}explore.html`)}${item("profile", "Profile", profileHref())}${item("messages", "Messages", `${pageBase}messages.html`)}${item("posts", "Home", `${pageBase}posts.html`, "", "home")}`;
    document.body.appendChild(bar);
    const current = location.pathname.split("/").pop() || "index.html";
    bar.querySelectorAll("[data-mobile-nav]").forEach(a => {
      const href = (a.getAttribute("href") || "").split("?")[0];
      if ((current === "index.html" && href === "#") || href.endsWith(current)) a.classList.add("is-active");
    });
    const menuTrigger = bar.querySelector("[data-mobile-nav=menu]");
    menuTrigger.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const button = $("[data-menu-toggle]");
      if (button) button.click();
    });
    const refreshProfile = () => {
      const a = bar.querySelector("[data-mobile-nav=profile]");
      if (a) a.href = profileHref();
    };
    refreshProfile();
    setTimeout(refreshProfile, 250);
    setTimeout(refreshProfile, 1000);
    const panel = $("[data-menu-panel]");
    if (panel) {
      panel.addEventListener("click", refreshProfile, {passive:true});
    }
    let lastY = window.scrollY;
    let ticking = false;
    const updateVisibility = () => {
      const y = window.scrollY;
      const delta = y - lastY;
      if (Math.abs(delta) > 5) {
        const hidden = delta > 0 && y > 36;
        bar.classList.toggle("nav-hidden", hidden);
        // On the editor page the Save bar sits directly above this nav.
        // Move it down together with the nav so it never floats mid-screen.
        const editorActions = document.querySelector(".editor-page .editor-actions");
        editorActions?.classList.toggle("editor-actions-nav-hidden", hidden);
        lastY = y;
      }
      ticking = false;
    };
    window.addEventListener("scroll", () => {
      if (!ticking) { ticking = true; requestAnimationFrame(updateVisibility); }
    }, {passive:true});
    window.addEventListener("resize", () => {
      if (window.innerWidth > 760) bar.remove();
    }, {passive:true});
  }

  function applyNavLanguage() {
    const lang = PF.applySavedLanguage ? PF.applySavedLanguage() : "en";
    const dict = (PF.NAV_I18N && PF.NAV_I18N[lang]) || {};
    const hrefMap = [
      ["posts.html", "posts"], ["communities.html", "communities"], ["explore.html", "explore"],
      ["friends.html", "friends"], ["editor.html", "editor"], ["settings.html", "settings"],
      ["messages.html", "messages"], ["login.html", "signin"], ["signup.html", "createprofile"],
      ["profile.html", "profile"]
    ];
    $$(".desktop-nav a, .menu-panel a").forEach(a => {
      const href = (a.getAttribute("href") || "").split("?")[0];
      const hit = hrefMap.find(([suffix]) => href === suffix || href.endsWith("/" + suffix));
      if (hit && dict[hit[1]]) a.textContent = dict[hit[1]];
    });
    const home = $("[data-menu-home]");
    if (home && dict.home) home.textContent = dict.home;
    const signout = $("[data-menu-logout]");
    if (signout && dict.signout) signout.textContent = dict.signout;
    $$("[data-i18n-nav]").forEach(span => {
      const key = span.getAttribute("data-i18n-nav");
      const navKey = key === "posts" ? "home" : key === "explore" ? "search" : key;
      if (dict[navKey]) span.textContent = dict[navKey];
    });
  }

  function nav() {
    const logged = !!PF.currentUsername();
    $$(".auth-required").forEach(el => el.classList.toggle("hidden", !logged));
    $$(".guest-only").forEach(el => el.classList.toggle("hidden", logged));
    const menuPanel = $("[data-menu-panel]");
    if (menuPanel) {
      let signout = menuPanel.querySelector("[data-menu-logout]");
      if (logged) {
        if (!signout) {
          signout = document.createElement("button");
          signout.type = "button";
          signout.className = "menu-auth-logout";
          signout.setAttribute("data-menu-logout", "true");
          signout.textContent = "Sign out";
          menuPanel.appendChild(signout);
          signout.addEventListener("click", async (e) => {
            e.preventDefault();
            e.stopPropagation();
            try { await PF.clearSession(); location.href = menuPanel.closest("body")?.querySelector(".brand")?.getAttribute("href") || "../index.html"; }
            catch (err) { notify(err?.message || "Could not sign out.", "error"); }
          });
        }
        signout.classList.remove("hidden");
      } else if (signout) {
        signout.classList.add("hidden");
      }
    }
    // Prevent an already-authenticated session from using any Create Account link.
    $$('a[href$="signup.html"]:not(.guest-only)').forEach(el => {
      if (!logged) return;
      el.setAttribute("aria-disabled", "true");
      el.setAttribute("tabindex", "-1");
      el.classList.add("disabled-link");
      el.addEventListener("click", e => e.preventDefault(), { once: true });
    });
    if (logged) initNotificationCenter();
  }

  async function initNotificationCenter() {
    const mobile = window.innerWidth <= 760;
    if ($("[data-rivo-notifications]")) return;

    // Desktop: keep a compact bell in the top bar.
    // Mobile: notifications are a normal menu row, not a separate icon.
    const host = mobile ? $("[data-menu-panel]") : $(".topbar-right");
    if (!host) return;

    const wrap = document.createElement("div");
    wrap.className = mobile ? "rivo-notification-wrap mobile-menu-notifications" : "rivo-notification-wrap";
    wrap.innerHTML = `
      <button class="${mobile ? "menu-notification-item" : "icon-btn notification-btn"}" type="button"
        data-rivo-notifications aria-label="Notifications" aria-expanded="false">
        ${mobile ? '<span class="menu-notification-icon" aria-hidden="true">🔔</span><span data-i18n="Notifications">Notifications</span>' : '<span>🔔</span>'}
        <i class="notification-badge hidden" data-notification-badge>0</i>
      </button>
      <div class="notification-popover glass" data-notification-popover>
        <div class="notification-head">
          <div><b data-i18n="Notifications">Notifications</b><small data-notification-count>Loading…</small></div>
          <button class="btn btn-sm btn-ghost" data-notification-readall>Mark all read</button>
        </div>
        <div class="notification-list" data-notification-list></div>
      </div>`;
    host.appendChild(wrap);

    const button = $("[data-rivo-notifications]", wrap);
    const pop = $("[data-notification-popover]", wrap);
    const list = $("[data-notification-list]", wrap);
    const badge = $("[data-notification-badge]", wrap);
    const count = $("[data-notification-count]", wrap);
    let notifications = [];

    const icon = type => type === "message" ? "✉️" :
      type === "friend_request" ? "👋" :
      type === "friend_accept" ? "🤝" : "🔔";

    const targetFor = n => {
      const username = PF.normalizeUsername(n?.actor_username || n?.payload?.username || "");
      const base = location.pathname.includes("/pages/") ? "" : "pages/";
      if (n?.type === "message") return username ? `${base}messages.html?u=${encodeURIComponent(username)}` : `${base}messages.html`;
      if (n?.type === "friend_request" || n?.type === "friend_accept") return username ? `${base}friends.html?u=${encodeURIComponent(username)}` : `${base}friends.html`;
      return n?.payload?.url || (username ? `${base}profile.html?u=${encodeURIComponent(username)}` : `${base}posts.html`);
    };

    const label = n => {
      const a = n.actor_display_name || n.actor_username || "Someone";
      if (n.type === "message") return `${a} sent you a message`;
      if (n.type === "friend_request") return `${a} sent you a friend request`;
      if (n.type === "friend_accept") return `${a} accepted your friend request`;
      return n.body || "You have a new notification";
    };

    const render = () => {
      const unread = notifications.filter(n => !n.read_at).length;
      badge.textContent = unread > 99 ? "99+" : String(unread);
      badge.classList.toggle("hidden", unread === 0);
      count.textContent = unread ? `${unread} unread` : `${notifications.length} total`;
      list.innerHTML = notifications.length
        ? notifications.map(n => `<button type="button" class="notification-item ${n.read_at ? "read" : "unread"}" data-notification-id="${esc(n.id)}">
            <span class="notification-icon">${icon(n.type)}</span>
            <span><b>${esc(label(n))}</b><small>${esc(new Date(n.created_at).toLocaleString([], {month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}))}</small></span>
          </button>`).join("")
        : `<div class="notification-empty">Nothing new.</div>`;

      if (PF.applyI18n) PF.applyI18n(list);
      $$("[data-notification-id]", wrap).forEach(btn => btn.onclick = async () => {
        const n = notifications.find(x => String(x.id) === String(btn.dataset.notificationId));
        try { await PF.markNotificationRead(btn.dataset.notificationId); } catch {}
        if (n) {
          n.read_at = n.read_at || new Date().toISOString();
          render();
          const target = targetFor(n);
          // Navigate directly to the related feature, exactly like a social app.
          if (target) location.href = target;
        }
      });
    };

    const load = async () => {
      try { notifications = await PF.listNotifications(50); render(); }
      catch { count.textContent = "Unavailable"; }
    };

    button.onclick = async e => {
      e.preventDefault();
      e.stopPropagation();
      const open = !pop.classList.contains("open");
      pop.classList.toggle("open", open);
      button.setAttribute("aria-expanded", String(open));
      if (open) await load();
    };

    $("[data-notification-readall]", wrap).onclick = async e => {
      e.preventDefault();
      e.stopPropagation();
      try {
        await PF.markAllNotificationsRead();
        notifications = notifications.map(n => ({...n, read_at: new Date().toISOString()}));
        render();
      } catch {}
    };

    document.addEventListener("click", e => {
      if (!wrap.contains(e.target) && !pop.contains(e.target)) {
        pop.classList.remove("open");
        button.setAttribute("aria-expanded", "false");
      }
    });

    try {
      const unsubscribe = await PF.subscribeNotifications(async n => {
        if (!n) return;
        notifications = [n, ...notifications.filter(x => String(x.id) !== String(n.id))].slice(0,50);
        render();
        const body = label(n);
        notify(body, "success");
      });
      window.addEventListener("beforeunload", () => { try { unsubscribe?.(); } catch {} });
    } catch {}

    await load();
    if (PF.applyI18n) PF.applyI18n(wrap);
  }

  // -----------------------------
  // Rivo Stories UI
  // -----------------------------
  function storyTimeLabel(iso) {
    const diff = Math.max(0, Date.parse(iso) - Date.now());
    const minutes = Math.max(1, Math.ceil(diff / 60000));
    if (minutes < 60) return `${minutes}m left`;
    return `${Math.ceil(minutes / 60)}h left`;
  }

  function ensureStoryPicker() {
    let input = $("#rivoStoryPicker");
    if (input) return input;
    input = document.createElement("input");
    input.id = "rivoStoryPicker";
    input.type = "file";
    input.accept = "image/jpeg,image/png,image/webp";
    input.hidden = true;
    document.body.appendChild(input);
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      input.value = "";
      if (!file) return;
      if (document.body.classList.contains("story-uploading")) return;
      try {
        const existing = await PF.getStory(PF.currentUsername(), { countView: false }).catch(() => null);
        if (existing?.active) { openStoryViewer(PF.currentUsername()); return; }
        document.body.classList.add("story-uploading");
        notify("Preparing image…", "success");
        await PF.createStoryFromFile(file);
        notify("Story added for 12 hours", "success");
        updateStoryTriggers(PF.currentUsername(), true);
        window.dispatchEvent(new CustomEvent("rivo-story-changed"));
      } catch (e) {
        notify(e.message || "Could not add story", "error");
      } finally {
        document.body.classList.remove("story-uploading");
      }
    });
    return input;
  }

  function updateStoryTriggers(username, active) {
    const u = PF.normalizeUsername(username);
    $$(`[data-story-user="${CSS.escape(u)}"]`).forEach(el => {
      el.dataset.storyActive = active ? "1" : "0";
      el.classList.toggle("has-story", active);
      let add = $(".story-add-dot", el);
      const own = u === PF.currentUsername();
      if (own && !active && !add) el.insertAdjacentHTML("beforeend", `<b class="story-add-dot" aria-hidden="true">+</b>`);
      if (active && add) add.remove();
    });
  }

  function closeStoryViewer() {
    const modal = $("#rivoStoryViewer");
    if (!modal) return;
    clearTimeout(modal._storyTimer);
    modal._storyTimer = null;
    modal.classList.remove("open");
    const progress = $("[data-story-progress]", modal);
    if (progress) { progress.style.animation = "none"; progress.style.animationPlayState = "paused"; }
    const media = $("[data-story-media]", modal);
    if (media?.tagName === "IMG") { try { media.removeAttribute("src"); } catch {} }
  }

  async function openStoryViewer(username) {
    const u = PF.normalizeUsername(username);
    if (!u) return;
    let modal = $("#rivoStoryViewer");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "rivoStoryViewer";
      modal.className = "story-viewer-backdrop";
      modal.innerHTML = `<div class="story-viewer" role="dialog" aria-modal="true" aria-label="Story"><button type="button" class="story-close icon-btn" data-story-close aria-label="Close">×</button><div class="story-progress"><span data-story-progress></span></div><div class="story-head"><span class="avatar-story-head" data-story-avatar></span><span class="story-owner-copy"><b data-story-name>Story</b><small data-story-time></small></span><button type="button" class="story-delete btn btn-sm btn-danger hidden" data-story-delete>Delete</button></div><div class="story-media-wrap" data-story-media-wrap></div><div class="story-bottom"><button type="button" class="story-like-btn" data-story-like><span data-story-like-icon>♡</span><span data-story-like-count>0</span></button><span class="story-views" data-story-owner-stats></span></div><div class="story-error hidden" data-story-error></div></div>`;
      document.body.appendChild(modal);
      modal.addEventListener("click", e => { if (e.target === modal || e.target.closest("[data-story-close]")) closeStoryViewer(); });
      $("[data-story-delete]", modal).addEventListener("click", async () => {
        const id = Number(modal.dataset.storyId || 0);
        if (!id || !confirm("Delete this story?")) return;
        try {
          await PF.deleteStory(id);
          notify("Story deleted", "success");
          updateStoryTriggers(PF.currentUsername(), false);
          closeStoryViewer();
        } catch (e) { notify(e.message || "Could not delete story", "error"); }
      });
      $("[data-story-like]", modal).addEventListener("click", async () => {
        const id = Number(modal.dataset.storyId || 0);
        if (!id) return;
        if (!PF.currentUsername()) return notify("Sign in to like stories.", "error");
        try {
          const result = await PF.toggleStoryLike(id);
          $("[data-story-like-icon]", modal).textContent = result.liked ? "♥" : "♡";
          $("[data-story-like-count]", modal).textContent = String(result.likes_count ?? 0);
        } catch (e) { notify(e.message || "Could not update story like", "error"); }
      });
    }

    clearTimeout(modal._storyTimer);
    modal._storyTimer = null;
    modal.classList.add("open");
    modal.dataset.storyId = "";
    $("[data-story-error]", modal).classList.add("hidden");
    $("[data-story-delete]", modal).classList.add("hidden");
    $("[data-story-like]", modal).classList.remove("hidden");
    $("[data-story-media-wrap]", modal).innerHTML = `<div class="story-loading">Loading story…</div>`;
    try {
      const story = await PF.getStory(u, { countView: true });
      if (!story?.active) {
        closeStoryViewer();
        updateStoryTriggers(u, false);
        return notify("This story has expired.", "error");
      }
      if (!String(story.media_type || "").startsWith("image/")) {
        closeStoryViewer();
        updateStoryTriggers(u, false);
        return notify("This story format is no longer supported. Please add an image story.", "error");
      }
      const owner = story.username === PF.currentUsername();
      modal.dataset.storyId = String(story.id);
      $("[data-story-name]", modal).textContent = story.display_name || story.username;
      $("[data-story-time]", modal).textContent = storyTimeLabel(story.expires_at);
      $("[data-story-avatar]", modal).innerHTML = story.avatar ? `<img src="${esc(story.avatar)}" alt="">` : esc(initials(story));
      $(`[data-story-delete]`, modal).classList.toggle("hidden", !owner);
      $(`[data-story-like]`, modal).classList.remove("hidden");
      $("[data-story-like-icon]", modal).textContent = story.liked ? "♥" : "♡";
      $("[data-story-like-count]", modal).textContent = String(story.likes_count ?? 0);
      $("[data-story-owner-stats]", modal).textContent = owner ? `👁 ${story.views_count ?? 0} views · ♥ ${story.likes_count ?? 0} likes` : "";
      const durationForTimer = 12;
      const progress = $("[data-story-progress]", modal);
      progress.style.animation = "none";
      void progress.offsetWidth;
      progress.style.animation = `storyProgress ${durationForTimer}s linear forwards`;
      clearTimeout(modal._storyTimer);
      const mediaWrap = $("[data-story-media-wrap]", modal);
      mediaWrap.innerHTML = `<img data-story-media src="${esc(story.media_url)}" alt="Story" decoding="async" fetchpriority="high">`;
      const media = $("[data-story-media]", modal);
      const startTimer = () => {
        clearTimeout(modal._storyTimer);
        progress.style.animationPlayState = "running";
        modal._storyTimer = setTimeout(() => closeStoryViewer(), durationForTimer * 1000);
      };
      progress.style.animationPlayState = "paused";
      if (media?.complete) startTimer();
      else media?.addEventListener("load", startTimer, { once: true });
      media?.addEventListener("error", () => {
        clearTimeout(modal._storyTimer);
        $$("[data-story-progress]", modal).forEach(el => { el.style.animation = "none"; });
        $$("[data-story-media-wrap]", modal).forEach(el => { el.innerHTML = `<div class="story-error">Unable to load this image.</div>`; });
      }, { once: true });
      updateStoryTriggers(u, true);
    } catch (e) {
      $("[data-story-error]", modal).textContent = e.message || "Could not load story";
      $("[data-story-error]", modal).classList.remove("hidden");
      $("[data-story-media-wrap]", modal).innerHTML = "";
    }
  }

  function ensureProfileAvatarViewer(){
    let box=document.querySelector("[data-profile-avatar-viewer]");
    if(box) return box;
    box=document.createElement("div");
    box.className="profile-avatar-viewer";
    box.setAttribute("data-profile-avatar-viewer","");
    box.innerHTML=`<div class="profile-avatar-viewer-backdrop" data-profile-avatar-close></div><button type="button" class="profile-avatar-viewer-close" data-profile-avatar-close aria-label="Close image">×</button><div class="profile-avatar-viewer-stage"><img class="profile-avatar-viewer-image" data-profile-avatar-image alt="Profile avatar"></div>`;
    document.body.appendChild(box);
    const close=()=>{box.classList.remove("open");const img=box.querySelector("[data-profile-avatar-image]");img.removeAttribute("src");document.body.classList.remove("profile-avatar-viewer-open");};
    box.querySelectorAll("[data-profile-avatar-close]").forEach(el=>el.addEventListener("click",close));
    document.addEventListener("keydown",e=>{if(e.key==="Escape"&&box.classList.contains("open"))close();});
    box._close=close;
    return box;
  }
  function openProfileAvatarViewer(url,name="Profile avatar"){
    if(!url)return notify("This profile has no avatar image.","error");
    const box=ensureProfileAvatarViewer(),img=box.querySelector("[data-profile-avatar-image]");
    img.alt=name||"Profile avatar";
    img.src=url;
    box.classList.add("open");
    document.body.classList.add("profile-avatar-viewer-open");
  }

  function initStorySystem() {
    ensureStoryPicker();
    document.addEventListener("click", e => {
      const trigger = e.target.closest?.("[data-story-user]");
      if (!trigger) return;
      const username = PF.normalizeUsername(trigger.dataset.storyUser || "");
      if (!username) return;
      const active = trigger.dataset.storyActive === "1";
      const own = trigger.dataset.storyOwn === "1" || username === PF.currentUsername();
      if (!active && !own) {
        e.preventDefault();
        e.stopPropagation();
        const img=trigger.querySelector?.("img");
        if(img?.src) openProfileAvatarViewer(img.src, img.alt || "Profile avatar");
        else notify("This profile has no avatar image.","error");
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (active) openStoryViewer(username);
      else ensureStoryPicker().click();
    }, true);
    document.addEventListener("keydown", e => {
      const target = e.target.closest?.("[data-story-user]");
      if (target && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); target.click(); }
      if (e.key === "Escape") closeStoryViewer();
    });
  }


  // -----------------------------
  // Rivo Calls UI / LiveKit Cloud
  // Supabase Realtime handles ringing/accept/decline/hangup; LiveKit Cloud handles media transport.
  function initCallSystem() {
    if (window.__rivoCallsReady) return;
    window.__rivoCallsReady = true;

    const LK = window.LivekitClient;
    let active = null;
    let callTimer = null;
    let qualityTimer = null;
    let callStartedAt = 0;
    let inboxClose = null;

    const ensureUI = () => {
      let h = $("#rivoCallUI");
      if (h) return h;

      h = document.createElement("div");
      h.id = "rivoCallUI";
      h.innerHTML = `
        <div class="call-backdrop" data-call-backdrop>
          <section class="call-panel glass" role="dialog" aria-modal="true" aria-label="Rivo call">
            <header class="call-panel-head">
              <div class="call-person-head">
                <span class="eyebrow">RIVO CALL</span>
                <h2 data-call-title>Ready to call</h2>
                <div class="call-time-wrap"><small data-call-subtitle>Private voice & video</small><span class="call-timer hidden" data-call-timer>00:00</span></div>
              </div>
              <div class="call-head-actions">
                <span class="call-quality" data-call-quality title="Connection quality">
                  <i></i><span data-call-quality-text>—</span>
                </span>
                <button class="icon-btn" type="button" data-call-close aria-label="Close">×</button>
              </div>
            </header>

            <div class="call-stage" data-call-stage>
              <div class="call-remote-placeholder">
                <div class="call-avatar-large" data-call-avatar>?</div>
                <b data-call-name>Contact</b>
                <small data-call-state>Calling…</small>
              </div>

              <video class="call-remote-video" data-call-remote autoplay playsinline></video>
              <video class="call-local-video" data-call-local autoplay muted playsinline></video>
            </div>

            <div class="call-controls">
              <button class="call-control" type="button" data-call-mute aria-label="Mute microphone">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="7" y="3" width="10" height="12" rx="5"></rect>
                  <path d="M5 11a7 7 0 0 0 14 0M12 18v3M8.5 21h7"></path>
                </svg>
              </button>

              <button class="call-control" type="button" data-call-camera aria-label="Camera on/off">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <rect x="3" y="7" width="12" height="10" rx="2"></rect>
                  <path d="m15 10 6-3v10l-6-3z"></path>
                </svg>
              </button>

              <button class="call-control end" type="button" data-call-end aria-label="End call">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M7.4 4.5 10 4l1.4 4-2.1 1.4a11.6 11.6 0 0 0 5.3 5.3l1.4-2.1 4 1.4-.5 2.6a2.2 2.2 0 0 1-2.4 1.8C10.2 17.5 6.5 13.8 5.6 6.9a2.2 2.2 0 0 1 1.8-2.4Z"></path>
                </svg>
              </button>
            </div>

            <div class="call-incoming-actions hidden" data-call-incoming>
              <button class="btn btn-primary" type="button" data-call-accept>Accept</button>
              <button class="btn btn-danger" type="button" data-call-decline>Decline</button>
            </div>
          </section>
        </div>`;

      document.body.appendChild(h);

      $("[data-call-backdrop]", h).onclick = e => {
        if (e.target === e.currentTarget && !active?.connected) closeUI();
      };

      $("[data-call-close]", h).onclick = () => {
        if (active) endCall(true);
        else closeUI();
      };

      $("[data-call-end]", h).onclick = () => endCall(true);
      $("[data-call-mute]", h).onclick = toggleMute;
      $("[data-call-camera]", h).onclick = toggleCamera;
      $("[data-call-accept]", h).onclick = acceptIncoming;
      $("[data-call-decline]", h).onclick = declineIncoming;

      return h;
    };

    const E = () => {
      const h = ensureUI();
      return {
        h,
        b: $("[data-call-backdrop]", h),
        panel: $(".call-panel", h),
        title: $("[data-call-title]", h),
        sub: $("[data-call-subtitle]", h),
        timer: $("[data-call-timer]", h),
        name: $("[data-call-name]", h),
        av: $("[data-call-avatar]", h),
        state: $("[data-call-state]", h),
        stage: $("[data-call-stage]", h),
        remote: $("[data-call-remote]", h),
        local: $("[data-call-local]", h),
        incoming: $("[data-call-incoming]", h),
        mute: $("[data-call-mute]", h),
        camera: $("[data-call-camera]", h),
        quality: $("[data-call-quality]", h),
        qualityText: $("[data-call-quality-text]", h),
      };
    };

    const closeRouteMenu = () => {
      const e = E();
      e.routeMenu.classList.add("hidden");
      e.route.classList.remove("active");
    };

    const closeUI = () => {
      const e = E();
      e.b.classList.remove("open");
      e.remote.classList.remove("live");
      e.local.classList.remove("live");
      e.remote.srcObject = null;
      e.local.srcObject = null;
      if (callTimer) clearInterval(callTimer);
      if (qualityTimer) clearInterval(qualityTimer);
      callTimer = null;
      qualityTimer = null;
      callStartedAt = 0;
      e.timer?.classList.add("hidden");
      if (e.timer) e.timer.textContent = "00:00";
      e.qualityText.textContent = "—";
      e.quality.className = "call-quality";
    };

    const show = () => E().b.classList.add("open");

    const state = (t, connected = false) => {
      const e = E();
      e.state.textContent = t;
      e.h.classList.toggle("call-connected", connected);
    };

    const person = p => {
      const e = E();
      e.name.textContent = p?.displayName || p?.username || "Contact";
      e.av.innerHTML = p?.avatar
        ? `<img src="${PF.safeUrl(p.avatar)}" alt="">`
        : PF.initials(p?.displayName || p?.username || "?");
    };

    const notifyCall = (m, t = "") => window.PFUI?.notify?.(m, t);

    const timer = () => {
      if (callStartedAt) return;
      callStartedAt = Date.now();
      if (callTimer) clearInterval(callTimer);
      const tick = () => {
        if (!active || !callStartedAt) return;
        const s = Math.max(0, Math.floor((Date.now() - callStartedAt) / 1000));
        const mm = String(Math.floor(s / 60)).padStart(2, "0");
        const ss = String(s % 60).padStart(2, "0");
        const e = E();
        e.sub.textContent = "Connected";
        e.timer?.classList.remove("hidden");
        if (e.timer) e.timer.textContent = `${mm}:${ss}`;
      };
      tick();
      callTimer = setInterval(tick, 1000);
    };

    const qualityLabel = q => {
      const v = String(q || "unknown").toLowerCase();
      if (v.includes("excellent")) return ["Excellent", "excellent"];
      if (v.includes("good")) return ["Good", "good"];
      if (v.includes("poor")) return ["Weak", "poor"];
      if (v.includes("lost")) return ["Reconnecting", "lost"];
      return ["Checking", "unknown"];
    };

    const updateQuality = q => {
      const e = E();
      const [label, cls] = qualityLabel(q);
      e.qualityText.textContent = label;
      e.quality.className = `call-quality ${cls}`;
    };

    const startQualityMonitor = room => {
      if (qualityTimer) clearInterval(qualityTimer);
      const refresh = () => {
        try {
          updateQuality(room?.localParticipant?.connectionQuality || "unknown");
        } catch {
          updateQuality("unknown");
        }
      };
      refresh();
      qualityTimer = setInterval(refresh, 2500);
    };

    async function token(roomName, participantName) {
      const cfg = window.RIVO_CALL_CONFIG || {};
      const session = (await window.__rivoSupabase?.auth.getSession())?.data?.session;
      if (!cfg.tokenUrl || !session?.access_token) {
        throw new Error("Call service is not configured.");
      }

      const r = await fetch(cfg.tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ roomName, participantName })
      });

      const d = await r.json().catch(() => ({}));

      if (!r.ok) {
        throw new Error(d.error || "Could not authorize the call.");
      }

      return d;
    }

    async function attachAudioTrack(track) {
      const media = track.attach();
      media.autoplay = true;
      media.playsInline = true;
      media.setAttribute("playsinline", "");
      media.setAttribute("data-rivo-call-audio", "true");
      media.className = "call-remote-audio";
      media.style.position = "fixed";
      media.style.width = "1px";
      media.style.height = "1px";
      media.style.opacity = "0";
      media.style.pointerEvents = "none";
      media.style.left = "-9999px";
      document.body.appendChild(media);
      try {
        await media.play();
      } catch {}
      active.audioEls = active.audioEls || [];
      active.audioEls.push(media);
      return media;
    }

    async function buildAudioRouteMenu() {
      const e = E();
      e.routeMenu.innerHTML = "";

      const supported = !!LK?.supportsAudioOutputSelection?.();
      const devices = (navigator.mediaDevices?.enumerateDevices)
        ? await navigator.mediaDevices.enumerateDevices().catch(() => [])
        : [];

      const outputs = devices.filter(d => d.kind === "audiooutput");

      const makeItem = (label, deviceId, disabled = false) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "call-route-item";
        b.textContent = label;
        b.disabled = disabled;
        b.onclick = async () => {
          try {
            if (!active?.room) return;
            if (!deviceId || deviceId === "default") {
              const ok = await active.room.switchActiveDevice("audiooutput", "default", false);
              if (ok !== false) {
                e.routeLabel.textContent = "Device";
                notifyCall("Audio routed to device", "success");
              }
            } else {
              await active.room.switchActiveDevice("audiooutput", deviceId, false);
              e.routeLabel.textContent = label.length > 14 ? "Output" : label;
              notifyCall(`Audio output: ${label}`, "success");
            }
                } catch {
            notifyCall("This device does not allow audio output switching.", "error");
          }
        };
        e.routeMenu.appendChild(b);
      };

      makeItem("Automatic / Device", "default");

      if (supported && outputs.length) {
        outputs
          .filter(d => d.deviceId !== "default")
          .slice(0, 6)
          .forEach(d => makeItem(d.label || "Audio device", d.deviceId));
      } else if (!supported) {
        const note = document.createElement("div");
        note.className = "call-route-note";
        note.textContent = "Your browser controls the speaker/earpiece automatically.";
        e.routeMenu.appendChild(note);
      }

      const hint = document.createElement("div");
      hint.className = "call-route-note";
      hint.textContent = "Wired/Bluetooth headsets are preferred by the phone when available.";
      e.routeMenu.appendChild(hint);
    }

    async function toggleAudioRoute(ev) {
      ev?.stopPropagation();
      const e = E();
      const opening = e.routeMenu.classList.contains("hidden");
      if (!opening) {
          return;
      }
      if (!active?.room) {
        notifyCall("Audio routing is available after the call connects.", "error");
        return;
      }
      await buildAudioRouteMenu();
      e.routeMenu.classList.remove("hidden");
      e.route.classList.add("active");
    }

    const attachLocalVideo = (track) => {
      if (!track) return;
      const e = E();
      const current = e.stage.querySelector(".call-local-video.live");
      if (current && current.dataset.rivoTrackAttached === "1") return;
      try {
        const media = track.attach();
        media.className = "call-local-video live";
        media.autoplay = true;
        media.muted = true;
        media.playsInline = true;
        media.setAttribute("playsinline", "");
        media.dataset.rivoTrackAttached = "1";
        if (current) current.replaceWith(media);
        else e.stage.appendChild(media);
        e.local = media;
        media.play?.().catch(() => {});
      } catch {}
    };

    async function connectMedia() {
      if (!LK) throw new Error("LiveKit client failed to load.");
      if (!active?.roomName) throw new Error("Call room is missing.");

      const e = E();

      const reconnectPolicy = LK.DefaultReconnectPolicy
        ? new LK.DefaultReconnectPolicy([300, 700, 1200, 2000, 3500, 6000, 10000])
        : undefined;

      const room = new LK.Room({
        adaptiveStream: true,
        dynacast: true,
        disconnectOnPageLeave: true,
        webAudioMix: true,
        reconnectPolicy,
        audioCaptureDefaults: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          voiceIsolation: true
        },
        publishDefaults: {
          simulcast: true,
          videoCodec: "vp8",
          degradationPreference: "maintain-framerate",
          videoSimulcastLayers: []
        }
      });

      if (LK.RoomEvent.LocalTrackPublished) {
        room.on(LK.RoomEvent.LocalTrackPublished, publication => {
          try {
            if (publication?.source === LK.Track.Source.Camera && publication.track) {
              attachLocalVideo(publication.track);
            }
          } catch {}
        });
      }

      room.on(LK.RoomEvent.TrackSubscribed, async (track) => {
        if (track.kind === LK.Track.Kind.Video) {
          const media = track.attach();
          media.className = "call-remote-video live";
          media.autoplay = true;
          media.playsInline = true;

          const old = e.stage.querySelector(".call-remote-video.live");
          if (old) old.remove();

          e.stage.appendChild(media);

          try { await media.play(); } catch {}
        } else if (track.kind === LK.Track.Kind.Audio) {
          await attachAudioTrack(track);
        }
      });

      room.on(LK.RoomEvent.TrackUnsubscribed, track => {
        try { track.detach().forEach(x => x.remove()); } catch {}
      });

      room.on(LK.RoomEvent.Reconnecting, () => state("Reconnecting…"));
      room.on(LK.RoomEvent.Reconnected, () => {
        state("Connected", true);
        updateQuality(room.localParticipant.connectionQuality);
        if (!callStartedAt) timer();
      });

      room.on(LK.RoomEvent.ConnectionQualityChanged, (quality) => {
        updateQuality(quality);
      });

      room.on(LK.RoomEvent.AudioPlaybackStatusChanged, playing => {
        if (!playing) notifyCall("Tap Audio to start call sound.", "error");
      });

      room.on(LK.RoomEvent.Disconnected, reason => {
        if (active) {
          notifyCall(
            reason ? `Call ended: ${reason}` : "Call connection ended.",
            "error"
          );
          endCall(false);
        }
      });

      room.on(LK.RoomEvent.ParticipantDisconnected, () => {
        if (active?.connected) endCall(false);
      });

      room.on(LK.RoomEvent.MediaDevicesError, err => {
        notifyCall(
          err?.message || "Microphone or camera permission is unavailable.",
          "error"
        );
      });

      room.on(LK.RoomEvent.TrackStreamStateChanged, (_pub, streamState) => {
        const paused = String(streamState).toLowerCase().includes("paused");
        if (paused) state("Optimizing connection…");
        else if (active?.connected) state("Connected", true);
      });

      active.room = room;
      active.audioEls = [];

      state(active.isVideo ? "Connecting video…" : "Connecting…");

      const d = await token(active.roomName, active.meId);

      if (!d.server_url || !d.participant_token) {
        throw new Error("LiveKit authorization failed.");
      }

      // Pre-warm where supported to reduce perceived connect latency.
      try { room.prepareConnection(d.server_url, d.participant_token); } catch {}

      await room.connect(
        d.server_url,
        d.participant_token,
        {
          autoSubscribe: true,
          maxRetries: 6,
          peerConnectionTimeout: 20000,
          websocketTimeout: 20000
        }
      );

      await room.localParticipant.setMicrophoneEnabled(true);

      if (active.isVideo) {
        try {
          await room.localParticipant.setCameraEnabled(true);
        } catch (cameraError) {
          console.warn("Camera enable failed:", cameraError);
          notifyCall("Camera permission or device access is unavailable.", "error");
        }

        const pub = room.localParticipant.getTrackPublication(
          LK.Track.Source.Camera
        );

        if (pub?.track) attachLocalVideo(pub.track);
      }

      active.connected = true;
      state("Connected", true);
      if (!callStartedAt) timer();
      updateQuality(room.localParticipant.connectionQuality);
      startQualityMonitor(room);
    }

    async function beginCall(username, type = "audio") {
      if (active) return notifyCall("A call is already active.", "error");
      if (!LK) throw new Error("Call system is unavailable.");

      const me = await PF.currentProfile();
      const peer = await PF.getCallUser(username);
      const isVideo = type === "video";
      const callId = crypto.randomUUID();
      const roomName = `rivo-${callId}`;

      const e = E();
      person(peer);
      e.title.textContent = isVideo ? "Starting video call" : "Starting voice call";
      e.sub.textContent = isVideo
        ? "Video · waiting for answer"
        : "Voice · waiting for answer";
      state("Ringing…");
      e.incoming.classList.add("hidden");
      show();

      active = {
        role: "caller",
        meId: me.id,
        peerId: peer.userId,
        peer,
        callId,
        isVideo,
        roomName,
        connected: false,
        inbox: null,
        channel: null,
        room: null,
        audioEls: []
      };

      try {
        active.channel = await PF.openCallChannel(
          `rivo-call-${callId}`,
          handleSignal
        );

        active.inbox = await PF.openCallChannel(
          `rivo-call-inbox-${peer.userId}`,
          handleSignal
        );

        await active.inbox.send({
          callId,
          from: me.id,
          to: peer.userId,
          type: "offer",
          payload: {
            isVideo,
            roomName,
            displayName: me.displayName || me.username,
            avatar: me.avatar || "",
            username: me.username
          }
        });
      } catch (err) {
        notifyCall(err.message || "Could not start the call", "error");
        endCall(false);
      }
    }

    async function handleSignal(msg) {
      if (!active || msg.callId !== active.callId) return;

      if (msg.type === "accept" && active.role === "caller") {
        try {
          state("Connecting…");
          await connectMedia();
        } catch (err) {
          notifyCall(err.message || "Could not connect the call", "error");
          endCall(true);
        }
      } else if (msg.type === "decline" || msg.type === "hangup") {
        notifyCall(msg.type === "decline" ? "Call declined." : "Call ended.");
        endCall(false);
      } else if (msg.type === "busy") {
        notifyCall("This person is already on a call.", "error");
        endCall(false);
      }
    }

    async function showIncoming(msg) {
      const me = await PF.currentProfile();
      const u = msg.payload?.username || "";

      if (!u || !(await PF.canReceiveCallFrom(u))) return;

      const peer = await PF.getProfile(u).catch(() => null);
      const e = E();

      person(
        peer || {
          username: u,
          displayName: msg.payload?.displayName || "Contact",
          avatar: msg.payload?.avatar || ""
        }
      );

      e.title.textContent = msg.payload?.isVideo
        ? "Incoming video call"
        : "Incoming voice call";

      e.sub.textContent = "Incoming call";
      state("Calling…");
      e.incoming.classList.remove("hidden");
      show();

      active = {
        role: "callee",
        meId: me.id,
        peerId: msg.from,
        peer: peer || {
          username: u,
          displayName: msg.payload?.displayName || "Contact"
        },
        callId: msg.callId,
        isVideo: !!msg.payload?.isVideo,
        roomName: msg.payload?.roomName,
        connected: false,
        inbox: null,
        channel: null,
        room: null,
        audioEls: []
      };
    }

    async function acceptIncoming() {
      if (!active || active.role !== "callee") return;

      const e = E();
      e.incoming.classList.add("hidden");

      try {
        active.channel = await PF.openCallChannel(
          `rivo-call-${active.callId}`,
          handleSignal
        );

        await active.channel.send({
          callId: active.callId,
          from: active.meId,
          to: active.peerId,
          type: "accept"
        });

        await connectMedia();
      } catch (err) {
        notifyCall(err.message || "Could not accept the call", "error");
        endCall(true);
      }
    }

    async function declineIncoming() {
      if (!active) return;

      try {
        const box = await PF.openCallChannel(
          `rivo-call-inbox-${active.peerId}`
        );

        await box.send({
          callId: active.callId,
          from: active.meId,
          to: active.peerId,
          type: "decline"
        });

        await box.close();
      } catch {}

      endCall(false);
    }

    async function endCall(send = true) {
      const old = active;
      active = null;

      try {
        if (send && old?.channel) {
          await old.channel.send({
            callId: old.callId,
            from: old.meId,
            to: old.peerId,
            type: "hangup"
          });
        }
      } catch {}

      try {
        if (old?.audioEls?.length) {
          old.audioEls.forEach(el => {
            try { el.srcObject = null; el.remove(); } catch {}
          });
        }

        await old?.inbox?.close?.();
        await old?.channel?.close?.();
        await old?.room?.disconnect?.();
      } catch {}

      closeUI();
    }

    async function toggleMute() {
      if (!active?.room) return;

      const e = E();
      const on = active.room.localParticipant.isMicrophoneEnabled;

      await active.room.localParticipant.setMicrophoneEnabled(!on);

      e.mute.classList.toggle("is-off", on);
      e.mute.setAttribute("aria-label", on ? "Unmute microphone" : "Mute microphone");
    }

    async function toggleCamera() {
      if (!active?.room || !active.isVideo) return;

      const e = E();
      const on = active.room.localParticipant.isCameraEnabled;

      try {
        await active.room.localParticipant.setCameraEnabled(!on);
      } catch (err) {
        notifyCall(err?.message || "Unable to change camera state.", "error");
        return;
      }

      if (!on) {
        const pub = active.room.localParticipant.getTrackPublication(LK.Track.Source.Camera);
        if (pub?.track) attachLocalVideo(pub.track);
      }

      e.camera.classList.toggle("is-off", on);
      e.camera.setAttribute("aria-label", on ? "Turn camera on" : "Turn camera off");
    }

    window.addEventListener("offline", () => {
      if (active?.connected) state("Offline · reconnecting…");
    });

    window.addEventListener("online", () => {
      if (active?.connected) state("Reconnecting…");
    });

    document.addEventListener("click", async e => {
      const b = e.target.closest?.("[data-call-user]");
      if (b) {
        e.preventDefault();
        try {
          await beginCall(
            b.dataset.callUser,
            b.dataset.callType || "audio"
          );
        } catch (err) {
          notifyCall(err.message || "Could not call", "error");
        }
        return;
      }

      const a = e.target.closest?.("[data-call-action]");
      const messageCallUser = window.__rivoActiveMessageUser || "";
      if (a && messageCallUser) {
        try {
          await beginCall(
            messageCallUser,
            a.dataset.callAction || "audio"
          );
        } catch (err) {
          notifyCall(err.message || "Could not call", "error");
        }
      }
    });

    window.RivoCalls = {
      start: beginCall,
      end: () => endCall(true)
    };

    (async () => {
      try {
        const me = await PF.currentProfile();
        if (!me?.id) return;

        inboxClose = await PF.subscribeCallInbox(
          me.id,
          async msg => {
            if (msg.type === "offer" && msg.to === me.id) {
              await showIncoming(msg);
            } else if (active && msg.callId === active.callId) {
              await handleSignal(msg);
            }
          }
        );

        window.addEventListener("beforeunload", () => {
          try { inboxClose?.(); } catch {}
        });
      } catch (e) {
        console.warn("[Rivo Calls] inbox unavailable", e);
      }
    })();
  }

  function initOverlayNavVisibility() {
    if (window.innerWidth > 760) return;
    const OVERLAY_SELECTOR = ".story-viewer-backdrop.open, .call-backdrop.open, .modal-backdrop.open, .post-image-viewer.open, .messages-layout.conversation-open, .community-room:not(.hidden)";
    const sync = () => {
      document.body.classList.toggle("rivo-overlay-open", !!document.querySelector(OVERLAY_SELECTOR));
    };
    sync();
    new MutationObserver(sync).observe(document.body, { attributes: true, subtree: true, attributeFilter: ["class"] });
  }

  document.addEventListener("DOMContentLoaded", async () => {
    nav(); initMenu(); initMobileBottomNav(); applyNavLanguage(); initOverlayNavVisibility(); initStorySystem(); initCallSystem();
    $$('[data-profile-link]').forEach(a => { const me = PF.currentUsername(); if (me) a.href = `profile.html?u=${encodeURIComponent(me)}`; });
    setTimeout(() => {
      const me = PF.currentUsername();
      $$('[data-profile-link]').forEach(a => { a.href = me ? `${location.pathname.includes('/pages/') ? '' : 'pages/'}profile.html?u=${encodeURIComponent(me)}` : a.href; });
    }, 350);
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
      if (path === "admin.html") await initAdmin();
      if (path === "messages.html") await initMessages();
      if (path === "posts.html") await initPostsPage();
      if (path === "communities.html") await initCommunitiesPage();
    } catch (err) { console.error(err); notify(err.message || "Something went wrong", "error"); }
  });


  async function runHumanChallenge(seed, bits = 18) {
    const target = Math.max(14, Math.min(20, Number(bits) || 18));
    let nonce = 0;
    const prefix = `${seed}:`;
    while (nonce < 2000000) {
      const raw = new TextEncoder().encode(prefix + nonce);
      const buf = await crypto.subtle.digest("SHA-256", raw);
      const bytes = new Uint8Array(buf);
      let zeroBits = 0;
      for (const b of bytes) {
        if (b === 0) { zeroBits += 8; continue; }
        let x = b;
        while ((x & 0x80) === 0) { zeroBits++; x <<= 1; }
        break;
      }
      if (zeroBits >= target) return String(nonce);
      nonce++;
      if ((nonce & 2047) === 0) await new Promise(r => setTimeout(r, 0));
    }
    throw new Error("Security check could not be completed. Please try again.");
  }

  function setupSignupCaptcha(form, buttonId, messageId) {
    const button = document.getElementById(buttonId);
    const message = document.getElementById(messageId);
    const modal = document.getElementById("signupCaptchaModal");
    const image = document.getElementById("signupCaptchaImage");
    const input = document.getElementById("signupCaptchaInput");
    const errorBox = document.getElementById("signupCaptchaError");
    const verify = document.getElementById("signupCaptchaVerify");
    const refresh = document.getElementById("signupCaptchaRefresh");
    const submit = form?.querySelector('button[type="submit"]');
    const security = window.RIVO_SECURITY || {};
    const trap = document.getElementById("signupWebsite");
    let verified = false;
    let challengeId = "";
    let startedAt = performance.now();
    let loading = false;

    const setNote = (text="", type="") => {
      if (message) { message.textContent = text; message.className = `captcha-note ${type}`.trim(); }
    };
    const open = () => {
      if (!modal) return;
      modal.hidden = false; modal.setAttribute("aria-hidden", "false");
      document.body.classList.add("rivo-captcha-open");
      loadChallenge(true);
    };
    const close = () => {
      if (!modal) return;
      modal.hidden = true; modal.setAttribute("aria-hidden", "true");
      document.body.classList.remove("rivo-captcha-open");
    };
    const updateSubmit = () => {
      if (submit) submit.disabled = !!security.requireHumanCheck && (!verified || !!trap?.value);
    };
    const reset = () => {
      verified = false; challengeId = ""; window.__rivoSignupCaptcha = null; loading = false; startedAt = performance.now();
      button?.setAttribute("aria-pressed", "false");
      button?.classList.remove("verified","checking");
      const status = button?.querySelector(".human-check-status");
      if (status) status.textContent = "Verify";
      if (input) input.value = "";
      if (image) image.removeAttribute("src");
      close(); setNote("");
      updateSubmit();
    };
    const markVerified = () => {
      verified = true;
      button?.setAttribute("aria-pressed", "true");
      button?.classList.remove("checking"); button?.classList.add("verified");
      const status = button?.querySelector(".human-check-status");
      if (status) status.textContent = "Verified";
      setNote("Verification complete.", "success"); updateSubmit();
    };
    async function loadChallenge(force=false) {
      if (loading) return;
      loading = true;
      if (errorBox) errorBox.textContent = "";
      if (verify) verify.disabled = true;
      if (refresh) refresh.disabled = true;
      try {
        const endpoint = String(security.signupCaptchaEndpoint || "").trim();
        if (!endpoint) throw new Error("Security check is not configured.");
        const res = await fetch(endpoint, { method:"POST", headers:{"Content-Type":"application/json","apikey":window.RIVO_SUPABASE?.anonKey || ""}, body:JSON.stringify({refresh:!!force}) });
        const payload = await res.json().catch(()=>({}));
        if (!res.ok) throw new Error(payload?.error || "Could not load the verification image.");
        challengeId = String(payload.challengeId || "");
        if (!challengeId || !payload.image) throw new Error("Could not load the verification image.");
        if (image) image.src = payload.image;
        if (input) { input.value = ""; setTimeout(()=>input.focus(), 40); }
      } catch (e) {
        if (errorBox) errorBox.textContent = e?.message || "Could not load verification.";
      } finally {
        loading = false;
        if (verify) verify.disabled = false;
        if (refresh) refresh.disabled = false;
      }
    }
    async function verifyCaptcha() {
      if (loading) return;
      const code = String(input?.value || "").trim();
      if (!/^[A-Za-z0-9]{4,6}$/.test(code)) { if (errorBox) errorBox.textContent = "Enter the 5–6 character code."; return; }
      if (!challengeId) { await loadChallenge(); return; }
      try {
        if (verify) verify.disabled = true;
        if (errorBox) errorBox.textContent = "Checking…";
        const endpoint = String(security.signupCaptchaEndpoint || "").trim();
        const res = await fetch(endpoint, {
          method:"POST", headers:{"Content-Type":"application/json","apikey":window.RIVO_SUPABASE?.anonKey || ""},
          body:JSON.stringify({ action:"verify", challengeId, captchaCode:code })
        });
        const payload = await res.json().catch(()=>({}));
        if (!res.ok || !payload?.verificationToken) throw new Error(payload?.error || "Verification failed. Try a new code.");
        verified = true;
        window.__rivoSignupCaptcha = { challengeId, verificationToken: String(payload.verificationToken) };
        markVerified(); close();
      } catch (e) { if (errorBox) errorBox.textContent = e?.message || "Verification failed. Try a new code."; }
      finally { if (verify) verify.disabled = false; }
    }
    button?.addEventListener("click", () => { if (!verified) open(); });
    verify?.addEventListener("click", verifyCaptcha);
    refresh?.addEventListener("click", () => loadChallenge(true));
    modal?.querySelectorAll("[data-captcha-close]").forEach(el => el.addEventListener("click", close));
    input?.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); verifyCaptcha(); } });
    trap?.addEventListener("input", updateSubmit);
    document.addEventListener("keydown", e => { if (e.key === "Escape" && modal && !modal.hidden) close(); });
    form.__rivoHuman = {
      isVerified: () => verified,
      reset,
      startedAt: () => startedAt,
      captcha: () => window.__rivoSignupCaptcha || null
    };
    reset();
    if (!security.requireHumanCheck) markVerified(); else updateSubmit();
    return form.__rivoHuman;
  }

  function setupHumanCheck(form, buttonId, messageId) {
    const security = window.RIVO_SECURITY || {};
    const button = document.getElementById(buttonId);
    const message = document.getElementById(messageId);
    const submit = form?.querySelector('button[type="submit"]');
    const trapId = form.id === "signupForm" ? "signupWebsite" : "loginWebsite";
    let verified = false;
    let challenge = "";
    let startedAt = performance.now();
    let clickedAt = 0;
    let pointerMoves = 0;
    let keyEvents = 0;

    const setMessage = (text = "", type = "") => {
      if (!message) return;
      message.textContent = text;
      message.className = `captcha-note ${type}`.trim();
    };
    const updateSubmit = () => {
      if (!submit) return;
      const trapFilled = !!document.getElementById(trapId)?.value;
      submit.disabled = !!security.requireHumanCheck && (!verified || trapFilled);
    };
    const reset = () => {
      verified = false;
      clickedAt = 0;
      button?.setAttribute("aria-pressed", "false");
      button?.classList.remove("verified", "checking");
      const status = button?.querySelector(".human-check-status");
      if (status) status.textContent = "Verify";
      challenge = `${crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)}:${Date.now()}`;
      startedAt = performance.now();
      updateSubmit();
    };
    const fail = msg => { verified = false; button?.classList.remove("verified","checking"); setMessage(msg,"error"); updateSubmit(); };
    const markVerified = () => {
      verified = true;
      button?.setAttribute("aria-pressed", "true");
      button?.classList.remove("checking"); button?.classList.add("verified");
      const status = button?.querySelector(".human-check-status");
      if (status) status.textContent = "Verified";
      setMessage("Verified", "success");
      updateSubmit();
    };

    form.__rivoHuman = {
      isVerified: () => verified,
      reset,
      startedAt: () => startedAt,
      signals: () => ({ pointerMoves, keyEvents, challenge, clickedAt, verified })
    };

    document.getElementById(trapId)?.addEventListener("input", updateSubmit);
    form.addEventListener("pointermove", () => { pointerMoves = Math.min(pointerMoves + 1, 80); }, { passive: true });
    form.addEventListener("keydown", () => { keyEvents = Math.min(keyEvents + 1, 80); }, { passive: true });
    button?.addEventListener("click", async () => {
      if (button.classList.contains("checking")) return;
      const elapsed = performance.now() - startedAt;
      if (elapsed < Number(security.minInteractionMs || 1800)) {
        fail("Please interact with the form normally for a moment, then verify.");
        return;
      }
      if (document.getElementById(trapId)?.value) return;
      clickedAt = Date.now();
      button.classList.add("checking");
      const status = button.querySelector(".human-check-status");
      if (status) status.textContent = "Checking…";
      setMessage("Checking…");
      try {
        await runHumanChallenge(challenge, security.challengeBits || 18);
        const humanish = pointerMoves >= 1 || keyEvents >= 1 || elapsed > (Number(security.minInteractionMs || 1800) + 700);
        if (!humanish) throw new Error("Interaction signal was insufficient.");
        markVerified();
      } catch (e) {
        fail("Verification failed. Tap the box again and try normally.");
      }
    });

    reset();
    if (!security.requireHumanCheck) markVerified();
    else updateSubmit();
    return form.__rivoHuman;
  }

  async function initLogin() {
    const form = $("#loginForm"); if (!form) return;
    setupPasswordToggles();
    const human = setupHumanCheck(form, "loginHumanCheck", "loginCaptchaMsg");
    form.addEventListener("submit", async e => {
      e.preventDefault();
      const btn = form.querySelector("button[type=submit]");
      $("#loginMsg") && ($("#loginMsg").textContent = "");
      if (human?.isVerified && !human.isVerified()) {
        $("#loginMsg") && ($("#loginMsg").textContent = "Complete the human check first."); return;
      }
      btn.disabled = true;
      try {
        const profile = await PF.login($("#loginUsername").value, $("#loginPassword").value);
        if (!profile?.username) throw new Error("Could not load your profile yet. Please try again.");
        location.href = `profile.html?u=${encodeURIComponent(profile.username)}`;
      } catch (err) {
        $("#loginMsg") && ($("#loginMsg").textContent = err.message);
        human?.reset?.();
      } finally {
        if (!window.RIVO_SECURITY?.requireHumanCheck) btn.disabled = false;
      }
    });
  }

  function setupPasswordToggles() {
    $$('[data-password-toggle]').forEach(btn => {
      const targetId = btn.getAttribute('data-password-toggle');
      const input = targetId ? document.getElementById(targetId) : null;
      if (!input || btn.dataset.ready === '1') return;
      btn.dataset.ready = '1';
      btn.addEventListener('click', () => {
        const reveal = input.type === 'password';
        input.type = reveal ? 'text' : 'password';
        btn.setAttribute('aria-pressed', String(reveal));
        btn.setAttribute('aria-label', reveal ? 'Hide password' : 'Show password');
        btn.classList.toggle('is-visible', reveal);
      });
    });
  }

  function setupBirthDatePicker() {
    const trigger = $('#signupBirthDate');
    const hidden = $('#signupBirthDateValue');
    const modal = $('#signupBirthPicker');
    const year = $('#birthYear');
    const month = $('#birthMonth');
    const day = $('#birthDay');
    const preview = $('#birthDatePreview');
    const apply = $('#birthDateApply');
    if (!trigger || !hidden || !modal || !year || !month || !day || !preview || !apply) return;

    const now = new Date();
    const currentYear = now.getFullYear();
    const minYear = currentYear - 120;
    const monthNames = [
      'January','February','March','April','May','June',
      'July','August','September','October','November','December'
    ];
    year.innerHTML = '';
    for (let y = currentYear; y >= minYear; y--) {
      const opt = document.createElement('option'); opt.value = String(y); opt.textContent = String(y); year.appendChild(opt);
    }
    month.innerHTML = '';
    monthNames.forEach((name, i) => {
      const opt = document.createElement('option'); opt.value = String(i + 1); opt.textContent = name; month.appendChild(opt);
    });

    const syncDays = (preferred = 1) => {
      const y = Number(year.value); const m = Number(month.value);
      const count = new Date(y, m, 0).getDate();
      const keep = Math.min(Math.max(1, Number(preferred) || 1), count);
      day.innerHTML = '';
      for (let d = 1; d <= count; d++) { const opt = document.createElement('option'); opt.value = String(d); opt.textContent = String(d); day.appendChild(opt); }
      day.value = String(keep);
    };
    syncDays(1);

    const formatPreview = () => {
      const y = Number(year.value), m = Number(month.value), d = Number(day.value);
      if (!y || !m || !d) { preview.textContent = 'Choose year, month and day'; return ''; }
      const date = new Date(Date.UTC(y, m - 1, d));
      const value = date.toISOString().slice(0, 10);
      preview.textContent = `${monthNames[m - 1]} ${d}, ${y}`;
      return value;
    };

    let draft = '';
    const open = () => {
      if (hidden.value) {
        const [y,m,d] = hidden.value.split('-').map(Number);
        if (y) year.value = String(y);
        if (m) month.value = String(m);
        syncDays(d || 1); day.value = String(d || 1);
      }
      draft = formatPreview();
      modal.hidden = false; modal.setAttribute('aria-hidden', 'false'); trigger.setAttribute('aria-expanded', 'true');
      document.body.classList.add('date-picker-open');
      setTimeout(() => year.focus(), 0);
    };
    const close = () => { modal.hidden = true; modal.setAttribute('aria-hidden', 'true'); trigger.setAttribute('aria-expanded', 'false'); document.body.classList.remove('date-picker-open'); };
    trigger.addEventListener('click', open);
    [year, month].forEach(select => select.addEventListener('change', () => { syncDays(Number(day.value)); draft = formatPreview(); }));
    day.addEventListener('change', () => { draft = formatPreview(); });
    modal.querySelectorAll('[data-birth-close]').forEach(el => el.addEventListener('click', close));
    apply.addEventListener('click', () => {
      const value = draft || formatPreview();
      if (!value) return;
      hidden.value = value;
      const label = trigger.querySelector('.date-picker-value');
      const placeholder = trigger.querySelector('.date-picker-placeholder');
      if (label) { label.textContent = preview.textContent; label.classList.remove('hidden'); }
      if (placeholder) placeholder.classList.add('hidden');
      close();
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) close(); });
  }

  async function initSignup() {
    const form = $("#signupForm"); if (!form) return;
    const existingSession = (await window.__rivoSupabase?.auth.getSession())?.data?.session || null;
    const submitButton = form.querySelector("button[type=submit]");
    const existingNotice = document.createElement("div");
    existingNotice.className = "auth-session-lock";
    if (existingSession?.user) {
      if (submitButton) submitButton.disabled = true;
      existingNotice.innerHTML = `You are already signed in. <a href="settings.html">Open Settings</a> to sign out before creating another account.`;
      form.prepend(existingNotice);
    }
    setupPasswordToggles();
    setupBirthDatePicker();
    const human = setupSignupCaptcha(form, "signupHumanCheck", "signupCaptchaMsg");
    if (existingSession?.user && submitButton) submitButton.disabled = true;
    $("#signupUsername")?.addEventListener("input", () => {
      const v = PF.normalizeUsername($("#signupUsername").value);
      $("#usernameHint") && ($("#usernameHint").textContent = PF.validUsername(v) ? "Username format is valid." : "3–26 chars: letters, numbers, . _ -");
    });
    form.addEventListener("submit", async e => {
      e.preventDefault();
      const liveSession = (await window.__rivoSupabase?.auth.getSession())?.data?.session || null;
      if (liveSession?.user) {
        $("#signupMsg") && ($("#signupMsg").textContent = "You are already signed in. Sign out before creating another account.");
        return;
      }
      const btn = form.querySelector("button[type=submit]");
      $("#signupMsg") && ($("#signupMsg").textContent = "");
      if (human?.isVerified && !human.isVerified()) {
        $("#signupMsg") && ($("#signupMsg").textContent = "Complete the human check first."); return;
      }
      if ((performance.now() - human.startedAt()) < Number(window.RIVO_SECURITY?.minInteractionMs || 1800)) {
        $("#signupMsg") && ($("#signupMsg").textContent = "Please take a moment and complete the form normally."); return;
      }
      btn.disabled = true;
      try {
        const password = $("#signupPassword").value;
        if (password !== $("#signupPassword2").value) throw new Error("Passwords do not match.");
        const birthDate = $("#signupBirthDateValue").value;
        if (!birthDate) throw new Error("Birth date is required.");
        await PF.createAccount({ username: $("#signupUsername").value, displayName: $("#signupDisplay").value, password, birthDate });
        location.href = "editor.html";
      } catch (err) {
        $("#signupMsg") && ($("#signupMsg").textContent = err.message);
        human?.reset?.();
        btn.disabled = false;
      }
    });
  }

  const templates = {
    "discord-noir": { accent: "#7488ff", card: "glass" },
    "anime-cinema": { accent: "#ff6fb0", card: "poster" },
    "neon-arena": { accent: "#55d6ff", card: "outline" },
    "cyber-terminal": { accent: "#38ff9b", card: "terminal" },
    "dark-luxury": { accent: "#f4c879", card: "solid" },
    "minimal-ice": { accent: "#d9efff", card: "frosted" },
    "samurai-ink": { accent: "#ff5f72", card: "notched" },
    "deep-space": { accent: "#9a86ff", card: "glass" },
    "creator-pulse": { accent: "#f26eea", card: "aurora" },
    "monochrome-pro": { accent: "#f4f5f7", card: "frame" },
    "starlight-royal": { accent: "#b9a7ff", card: "starfield" },
    "aurora-glass": { accent: "#67e8f9", card: "aurora" },
    "obsidian-court": { accent: "#f0b65b", card: "frame" },
    "pixel-arcade": { accent: "#7dff8d", card: "terminal" },
    "botanical-night": { accent: "#79d79a", card: "frosted" },
    "white-atelier": { accent: "#172033", card: "paper" },
    "white-signal": { accent: "#3157ff", card: "split" }
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
    "monochrome-pro": "Monochrome Pro",
    "starlight-royal": "Starlight Royal",
    "aurora-glass": "Aurora Glass",
    "obsidian-court": "Obsidian Court",
    "pixel-arcade": "Pixel Arcade",
    "botanical-night": "Botanical Night",
    "white-atelier": "White Atelier",
    "white-signal": "White Signal"
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

    // Economy-backed editor unlocks: no separate storefront. Every premium
    // editor option is locked until its corresponding item is owned.
    let editorInventory = [];
    let editorItems = [];
    const editorOwned = new Set();
    const editorItemByName = new Map();
    try {
      editorInventory = await PF.listMyInventory();
      editorItems = await PF.listStoreItems();
      const eb = $("#editorCoinsBalance"); if (eb) eb.textContent = Number(await PF.getCoinBalance()).toLocaleString();
      editorInventory.forEach(x => editorOwned.add(String(x.item_id)));
      editorItems.forEach(x => editorItemByName.set(String(x.name || '').toLowerCase(), x));
    } catch (e) {
      console.warn('[Rivo Economy] editor unlock catalogue unavailable', e);
    }
    const findUnlock = name => editorItemByName.get(String(name).toLowerCase()) || null;
    const ownsUnlock = name => { const it = findUnlock(name); return !!it && editorOwned.has(String(it.id)); };
    const priceUnlock = name => Number(findUnlock(name)?.price || 0);
    const unlockLabel = name => { const p = priceUnlock(name); return p > 0 ? `🔒 ${p} 🪙` : 'مجاني'; };

    let coinPurchaseModal;
    function ensureCoinPurchaseModal() {
      if (coinPurchaseModal) return coinPurchaseModal;
      coinPurchaseModal = document.createElement('div');
      coinPurchaseModal.className = 'coin-purchase-modal';
      coinPurchaseModal.hidden = true;
      coinPurchaseModal.innerHTML = `
        <div class="coin-purchase-backdrop" data-coin-buy-close></div>
        <section class="coin-purchase-dialog" role="dialog" aria-modal="true" aria-labelledby="coinPurchaseTitle">
          <button type="button" class="icon-btn coin-purchase-close" data-coin-buy-close aria-label="Close">×</button>
          <div class="coin-purchase-icon">🪙</div>
          <div class="eyebrow">RIVO COINS</div>
          <h2 id="coinPurchaseTitle">تأكيد فتح العنصر</h2>
          <p class="coin-purchase-copy" data-coin-buy-copy></p>
          <div class="coin-purchase-summary"><span>السعر</span><strong data-coin-buy-price>0 🪙</strong></div>
          <div class="coin-purchase-summary muted"><span>رصيدك</span><strong data-coin-buy-balance>0 🪙</strong></div>
          <div class="coin-purchase-actions"><button type="button" class="btn btn-ghost" data-coin-buy-close>إلغاء</button><button type="button" class="btn btn-primary" data-coin-buy-confirm>تأكيد الدفع</button></div>
        </section>`;
      document.body.appendChild(coinPurchaseModal);
      return coinPurchaseModal;
    }
    async function purchaseUnlock(name) {
      if (!PF.currentUsername()) { location.href = 'login.html'; return false; }
      const item = findUnlock(name);
      if (!item) { notify('العنصر غير متاح حاليًا. شغّل ملف اقتصاد Supabase المحدّث.', 'error'); return false; }
      if (editorOwned.has(String(item.id))) return true;
      const price = Math.max(0, Number(item.price || 0));
      if (price <= 0) {
        try {
          const result = await PF.purchaseStoreItem(item.id);
          editorOwned.add(String(item.id));
          const eb = $("#editorCoinsBalance"); if (eb) eb.textContent = Number(result?.coins_balance ?? await PF.getCoinBalance()).toLocaleString();
          notify(`تم فتح ${item.name}`, 'success');
          return true;
        } catch (e) { notify(e.message || 'تعذر فتح العنصر', 'error'); return false; }
      }

      const modal = ensureCoinPurchaseModal();
      const copy = modal.querySelector('[data-coin-buy-copy]');
      const priceEl = modal.querySelector('[data-coin-buy-price]');
      const balanceEl = modal.querySelector('[data-coin-buy-balance]');
      const confirmBtn = modal.querySelector('[data-coin-buy-confirm]');
      const balance = Number(await PF.getCoinBalance());
      copy.textContent = `هل تريد دفع ${price.toLocaleString()} عملة لفتح «${item.name}»؟`;
      priceEl.textContent = `${price.toLocaleString()} 🪙`;
      balanceEl.textContent = `${balance.toLocaleString()} 🪙`;
      modal.hidden = false;
      document.body.classList.add('coin-purchase-open');

      const approved = await new Promise(resolve => {
        let done = false;
        const cleanup = () => {
          confirmBtn?.removeEventListener('click', onConfirm);
          modal.querySelectorAll('[data-coin-buy-close]').forEach(x => x.removeEventListener('click', onCancel));
          document.removeEventListener('keydown', onKey);
        };
        const finish = value => { if (done) return; done = true; cleanup(); resolve(value); };
        const onConfirm = () => finish(true);
        const onCancel = () => finish(false);
        const onKey = e => { if (e.key === 'Escape') finish(false); };
        confirmBtn?.addEventListener('click', onConfirm);
        modal.querySelectorAll('[data-coin-buy-close]').forEach(x => x.addEventListener('click', onCancel));
        document.addEventListener('keydown', onKey);
        requestAnimationFrame(() => confirmBtn?.focus());
      });
      modal.hidden = true;
      document.body.classList.remove('coin-purchase-open');
      if (!approved) return false;

      try {
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'جارٍ الدفع…';
        const result = await PF.purchaseStoreItem(item.id);
        editorOwned.add(String(item.id));
        const eb = $("#editorCoinsBalance"); if (eb) eb.textContent = Number(result?.coins_balance ?? await PF.getCoinBalance()).toLocaleString();
        notify(`تم فتح ${item.name}`, 'success');
        return true;
      } catch (e) {
        const msg = String(e?.message || 'تعذر إتمام الدفع');
        notify(/not enough coins|insufficient/i.test(msg) ? 'رصيدك غير كافٍ لشراء هذا العنصر.' : msg, 'error');
        return false;
      } finally {
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'تأكيد الدفع';
      }
    };
    const openUnlock = async (button, unlockName, apply) => {
      if (editorOwned.has(String(findUnlock(unlockName)?.id || ''))) { apply?.(); return true; }
      const ok = await purchaseUnlock(unlockName);
      if (ok) { apply?.(); applyEditorLocks(); refreshPreview(); }
      return ok;
    };

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

    const templateUnlockName = id => `Template · ${templateNames[id] || id}`;
    const cardStyleUnlockName = id => `Template · Card Style ${id}`;
    const frameUnlockName = id => id === "none" ? null : `Frame · ${id.charAt(0).toUpperCase()}${id.slice(1)}`;

    function decorateUnlockControl(el, unlockName) {
      if (!el || !unlockName) return;
      const owned = ownsUnlock(unlockName);
      el.classList.toggle("economy-locked", !owned);
      el.classList.toggle("economy-owned", owned);
      let badge = el.querySelector(".economy-lock-badge");
      if (!owned) {
        if (!badge) { badge = document.createElement("span"); badge.className = "economy-lock-badge"; el.appendChild(badge); }
        badge.textContent = unlockLabel(unlockName);
      } else if (badge) badge.remove();
    }

    async function unlockFromField(name, fieldEl) {
      const ok = ownsUnlock(name) || await purchaseUnlock(name);
      if (ok) { applyEditorLocks(); refreshPreview(); }
      return ok;
    }
    function applyEditorLocks() {
      $$("#templateGrid .template-choice").forEach(b => decorateUnlockControl(b, templateUnlockName(b.dataset.template)));
      $$("#cardStyleGrid .card-style-choice").forEach(b => decorateUnlockControl(b, cardStyleUnlockName(b.dataset.cardStyle)));
      $$("#frameGrid .frame-choice").forEach(b => decorateUnlockControl(b, frameUnlockName(b.dataset.frame)));
      const map = [
        ["avatarUpload", "Feature · Avatar Upload"], ["bannerUpload", "Feature · Banner Upload"],
        ["miniUpload", "Feature · Floating Image"], ["musicTitle", "Feature · Profile Music"],
        ["musicUpload", "Feature · Profile Music"], ["musicCoverUpload", "Feature · Music Cover"],
        ["accentInput", "Feature · Custom Accent"], ["radiusRange", "Feature · Radius Control"],
        ["glowRange", "Feature · Glow Control"]
      ];
      map.forEach(([id,name]) => {
        const el = $("#"+id), field = el?.closest(".field"); if (!el || !field) return;
        const locked = !ownsUnlock(name);
        el.disabled = locked;
        field.classList.toggle("economy-field-locked", locked);
        let buy = field.querySelector(`[data-economy-buy-field="${CSS.escape(name)}"]`);
        if (locked) {
          if (!buy) { buy = document.createElement("button"); buy.type = "button"; buy.className = "btn btn-sm economy-field-buy"; buy.dataset.economyBuyField = name; field.appendChild(buy); buy.addEventListener("click", () => unlockFromField(name, field)); }
          buy.textContent = `🔒 فتح بـ ${priceUnlock(name)} 🪙`;
          buy.disabled = false;
        } else if (buy) buy.remove();
      });
      $$("#badgeList [data-badge]").forEach(b => { const cat = PF.badgeCatalog.find(x => x.id === b.dataset.badge); if (cat) decorateUnlockControl(b, `Badge · ${cat.name}`); });
    }

    $$("#templateGrid .template-choice").forEach(b => b.addEventListener("click", async () => {
      const unlock = templateUnlockName(b.dataset.template);
      const ok = ownsUnlock(unlock) || await purchaseUnlock(unlock); if (!ok) return;
      state.template = b.dataset.template;
      const templateCardStyle = templates[state.template].card;
      // A paid template must not silently activate another separately paid card style.
      if (ownsUnlock(cardStyleUnlockName(templateCardStyle))) state.cardStyle = templateCardStyle;
      state.accent = templates[state.template].accent;
      $$("#templateGrid .template-choice").forEach(x => x.classList.remove("selected")); b.classList.add("selected");
      applyEditorLocks(); refreshPreview();
    }));
    $$("#cardStyleGrid .card-style-choice").forEach(b => b.addEventListener("click", async () => {
      const unlock = cardStyleUnlockName(b.dataset.cardStyle);
      const ok = ownsUnlock(unlock) || await purchaseUnlock(unlock); if (!ok) return;
      state.cardStyle = b.dataset.cardStyle;
      $$("#cardStyleGrid .card-style-choice").forEach(x => x.classList.remove("selected")); b.classList.add("selected");
      refreshPreview();
    }));
    $("#accentInput")?.addEventListener("input", e => { if (!ownsUnlock("Feature · Custom Accent")) return; state.accent = e.target.value; refreshPreview(); });
    $("#radiusRange")?.addEventListener("input", e => { if (!ownsUnlock("Feature · Radius Control")) return; state.cardRadius = Number(e.target.value); refreshPreview(); });
    $("#glowRange")?.addEventListener("input", e => { if (!ownsUnlock("Feature · Glow Control")) return; state.glow = Number(e.target.value); refreshPreview(); });

    const upload = async (id, key, maxW, previewId, unlockName) => {
      $("#" + id)?.addEventListener("change", async e => {
        if (!ownsUnlock(unlockName)) { e.target.value = ""; notify(`افتح ${unlockName} بالعملات أولًا`, "error"); return; }
        try {
          state[key] = await PF.compressImage(e.target.files[0], maxW, .84);
          if (previewId && $("#" + previewId)) { $("#" + previewId).src = state[key]; $("#" + previewId).classList.remove("hidden"); }
          refreshPreview();
        } catch (err) { notify(err.message, "error"); }
      });
    };
    await upload("avatarUpload", "avatar", 900, "avatarMediaPreviewImg", "Feature · Avatar Upload");
    await upload("bannerUpload", "banner", 1600, "bannerMediaPreviewImg", "Feature · Banner Upload");
    await upload("miniUpload", "miniImage", 500, "miniPreviewImg", "Feature · Floating Image");
    [
      ["avatarUpload","Feature · Avatar Upload"],["bannerUpload","Feature · Banner Upload"],["miniUpload","Feature · Floating Image"],
      ["musicUpload","Feature · Profile Music"],["musicCoverUpload","Feature · Music Cover"]
    ].forEach(([id,name]) => {
      const el = $("#"+id), label = el?.closest("label");
      label?.addEventListener("click", async e => {
        if (ownsUnlock(name)) return;
        e.preventDefault(); e.stopPropagation();
        await unlockFromField(name, el.closest(".field"));
        if (ownsUnlock(name)) el.disabled = false;
      });
    });

    $$("#frameGrid .frame-choice").forEach(b => b.addEventListener("click", async () => {
      const unlock = frameUnlockName(b.dataset.frame);
      if (unlock && !(ownsUnlock(unlock) || await purchaseUnlock(unlock))) return;
      state.avatarFrame = b.dataset.frame;
      $$("#frameGrid .frame-choice").forEach(x => x.classList.remove("selected")); b.classList.add("selected");
      applyEditorLocks(); refreshPreview();
    }));

    $("#musicTitle") && ($("#musicTitle").value = state.music?.title || "", $("#musicTitle").addEventListener("input", e => { if (!ownsUnlock("Feature · Profile Music")) return; state.music = {...(state.music || {}), title: e.target.value.slice(0, 80), artist: ""}; refreshPreview(); }));
    $("#musicUpload")?.addEventListener("change", async e => {
      if (!ownsUnlock("Feature · Profile Music")) { e.target.value = ""; notify("افتح ميزة Profile Music أولًا", "error"); return; }
      try {
        const m = await PF.readAudio(e.target.files[0]);
        state.music = {...(state.music || {}), audio: m.data, mime: m.mime, size: m.size, artist: ""};
        if (!(state.sections || []).some(s => s.type === "music")) state.sections.push({ id: crypto.randomUUID(), type: "music", title: "Music", visible: true });
        $("#musicFileName") && ($("#musicFileName").textContent = `${m.name} · ${(m.size / 1048576).toFixed(2)} MB`);
        refreshPreview();
      } catch (err) { notify(err.message, "error"); }
    });
    $("#musicCoverUpload")?.addEventListener("change", async e => {
      if (!ownsUnlock("Feature · Music Cover")) { e.target.value = ""; notify("افتح Music Cover أولًا", "error"); return; }
      try { state.music = {...(state.music || {}), cover: await PF.compressImage(e.target.files[0], 600, .82)}; refreshPreview(); }
      catch (err) { notify(err.message, "error"); }
    });

    renderSections(state); renderSocials(state); renderBadges(state, { ownsUnlock, purchaseUnlock, applyEditorLocks: () => applyEditorLocks(), refreshPreview });
    applyEditorLocks();
    $("#addSocial")?.addEventListener("click", async () => { if (!(ownsUnlock("Feature · Social Links") || await purchaseUnlock("Feature · Social Links"))) return; state.socials.push({label:"Website", url:""}); renderSocials(state); });

    $("#saveBtn")?.addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      if (btn.disabled) return; // guard against double-tap firing two uploads/saves at once
      const originalLabel = btn.textContent;
      try {
        btn.disabled = true;
        btn.textContent = "Saving…";
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
      } catch (err) {
        notify(err.message, "error");
        btn.disabled = false;
        btn.textContent = originalLabel;
      }
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

  function renderBadges(state, economy = {}) {
    const box = $("#badgeList"); if (!box) return;
    const ownsUnlock = economy.ownsUnlock || (() => true);
    const purchaseUnlock = economy.purchaseUnlock || (async () => false);
    const rerenderLocks = economy.applyEditorLocks || (() => {});
    const refreshPreview = economy.refreshPreview || (() => {});
    const special = new Set(["verified", "founder"]);
    const all = PF.badgeCatalog.filter(b => !special.has(b.id));
    box.innerHTML = all.map(b => `<button type="button" class="badge-choice ${state.badges.includes(b.id) ? "selected" : ""}" data-badge="${esc(b.id)}"><span>${esc(b.icon)}</span><b>${esc(b.name)}</b><small>${esc(b.rarity)}</small></button>`).join("");
    rerenderLocks();
    $$('[data-badge]').forEach(btn => btn.onclick = async () => {
      const id = btn.dataset.badge; const has = state.badges.includes(id);
      if (has) {
        state.badges = state.badges.filter(x => x !== id);
        renderBadges(state, economy); refreshPreview();
        return;
      }
      if (state.badges.length >= 3) return notify("اختر 3 شارات كحد أقصى.", "error");
      const cat = PF.badgeCatalog.find(x => x.id === id); if (!cat) return;
      const unlock = `Badge · ${cat.name}`;
      if (!(ownsUnlock(unlock) || await purchaseUnlock(unlock))) return;
      state.badges = [...state.badges, id];
      renderBadges(state, economy); refreshPreview();
    });
  }

  function bannerBackground(p) {
    return `linear-gradient(115deg, color-mix(in srgb, var(--accent) 38%, #090b10), #0a0d13 72%)`;
  }

  function badgePills(p, limit = 3) {
    const list = (p.badges || []).slice(0, limit).map(id => PF.badgeCatalog.find(x => x.id === id)).filter(Boolean);
    return list.map(b => `<span class="badge-pill" title="${esc(b.name)}"><span>${esc(b.icon)}</span>${esc(b.name)}</span>`).join("");
  }

  function storeBadgePills(p, limit = 4) {
    const list = (Array.isArray(p?.equippedStoreItems) ? p.equippedStoreItems : []).filter(x => x?.type === "badge").slice(0, limit);
    return list.map(b => { const icon = b.image_url ? `<img src="${esc(b.image_url)}" alt="">` : `<span>✦</span>`; return `<span class="badge-pill store-badge-pill" title="${esc(b.name || "Store badge")}">${icon}${esc(b.name || "Badge")}</span>`; }).join("");
  }
  function storeFrameOverlay(p) {
    const frame = (Array.isArray(p?.equippedStoreItems) ? p.equippedStoreItems : []).find(x => x?.type === "frame");
    if (!frame) return "";
    return frame.image_url ? `<span class="store-frame-overlay" style="background-image:url('${esc(frame.image_url)}')" aria-hidden="true"></span>` : `<span class="store-frame-overlay store-frame-generic" aria-hidden="true"></span>`;
  }

  function identityLink(p, inner, extraClass = "") {
    const u = PF.normalizeUsername(p?.username || "");
    if (!u) return inner;
    return `<a class="rivo-identity-link ${extraClass}" href="profile.html?u=${encodeURIComponent(u)}" data-user-profile="${esc(u)}" aria-label="Open @${esc(u)} profile">${inner}</a>`;
  }

  function friendPreviewRows(friendProfiles, max = 5) {
    return friendProfiles.slice(0, max).map(p => identityLink(p, `<span class="friend-mini">${avatarMarkup(p, "avatar-xs")}<span><b>${esc(p.displayName)}</b><small>@${esc(p.username)}</small></span></span>`)).join("");
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
    const badges = `${badgePills(p)}${storeBadgePills(p)}`;
    const likedBy = p.likes?.users || [];
    const meUsername = PF.currentUsername();
    const liked = !!meUsername && likedBy.includes(meUsername);
    const likeCount = Number(p.likes?.count ?? likedBy.length ?? 0);
    const mini = p.miniImage ? `<div class="profile-mini-float" title="Decorative image"><img src="${esc(p.miniImage)}" alt=""></div>` : "";
    const ownerLikesBadge = isMe
      ? `<span class="profile-owner-likes" title="Profile likes"><span class="heart-mini">♥</span><b>${displayViews(likeCount)}</b></span>`
      : "";
    const frame = `frame-${p.avatarFrame || "none"}`;
    const social = (p.socials || []).map(s => { const href = safeLink(s.url); return href ? `<a class="social-pill" href="${esc(href)}" target="_blank" rel="noreferrer">${esc(s.label || "Link")}</a>` : ""; }).join("");
    const seenSectionTypes = new Set();
    const sectionHtml = (p.sections || [])
      .filter(s => s && s.visible !== false && !["skills", "projects", "posts"].includes(s.type))
      .filter(s => {
        const titleKey = String(s.title || "").trim().toLowerCase().replace(/\s+/g, " ");
        // Skip legacy/custom copies of canonical profile sections so only the
        // dedicated rendered section remains visible.
        const duplicateCanonicalTitle = [
          "posts", "post", "المنشورات",
          "friends", "friend", "your circle",
          "about me", "about"
        ].includes(titleKey);
        if (!s.type && duplicateCanonicalTitle) return false;
        const key = s.type || `custom:${titleKey}`;
        if (seenSectionTypes.has(key)) return false;
        seenSectionTypes.add(key);
        return true;
      })
      .map(s => {
        if (s.type === "about") return `<section class="section-block about-section"><div class="section-kicker">ABOUT</div><p class="profile-description">${esc(p.description || p.bio || "Tell people something about you.")}</p>${p.location ? `<div class="about-meta"><span>⌖ ${esc(p.location)}</span>${p.website && safeLink(p.website) ? `<a href="${esc(safeLink(p.website))}" target="_blank" rel="noreferrer">Website ↗</a>` : ""}</div>` : ""}</section>`;
        if (s.type === "friends") return `<section class="section-block"><div class="section-head"><div><div class="section-kicker">FRIENDS</div></div>${more ? `<button class="btn btn-sm" data-friends-open>+${more}</button>` : ""}</div><div class="friend-mini-grid">${friendPreviewRows(friendProfiles,5)}</div></section>`;
        if (s.type === "music") return renderMusic(p);
        return `<section class="section-block"><div class="section-kicker">CUSTOM</div><h2>${esc(s.title || "Section")}</h2><p class="profile-description">${esc(p.description || "")}</p></section>`;
      }).join("");

    const banner = p.banner
      ? `<img class="profile-banner-image" src="${esc(p.banner)}" alt="" loading="eager">`
      : `<div class="profile-banner-fallback"></div>`;
    let action = "";
    const canInteract = !preview && !isMe && !!PF.currentUsername();
    const followState = canInteract ? PF.isFollowing(p.username) : false;
    if (canInteract) {
      const primaryLabel = relationship === "friends"
        ? "Friends"
        : relationship === "outgoing"
          ? "Request sent"
          : relationship === "incoming"
            ? "Respond"
            : "+ Add Friend";
      const friendChoice = relationship === "friends"
        ? `<button type="button" class="relationship-menu-item danger" data-rel-action="remove-friend">Remove friend</button>`
        : relationship === "outgoing"
          ? `<button type="button" class="relationship-menu-item danger" data-rel-action="cancel-request">Cancel request</button>`
          : relationship === "incoming"
            ? `<button type="button" class="relationship-menu-item primary" data-rel-action="accept-friend">Accept request</button>`
            : `<button type="button" class="relationship-menu-item primary" data-rel-action="add-friend">+ Add Friend</button>`;
      const followLabel = followState ? "Unfollow" : "Follow";
      action = `<div class="relationship-action-menu" data-relationship-menu>
        <button type="button" class="btn btn-primary relationship-action-button" data-relationship-toggle aria-expanded="false" aria-haspopup="menu">${primaryLabel}<span class="relationship-action-chevron" aria-hidden="true">⌄</span></button>
        <div class="relationship-action-popover" data-relationship-popover role="menu" hidden>
          ${friendChoice}
          <button type="button" class="relationship-menu-item" data-rel-action="toggle-follow">${followLabel}</button>
        </div>
      </div>`;
    }
    const quickLike = canInteract ? `<button class="like-btn ${liked ? "liked" : ""}" data-like-profile aria-label="${liked ? "Unlike" : "Like"}"><span class="heart">${liked ? "♥" : "♡"}</span><span class="like-count">${displayViews(likeCount)}</span></button>` : "";
    const messagesClosed = p.messagePrivacy === "nobody";
    // "Friends only" used to still render a normal, clickable "Message"
    // button to non-friends — it would only fail after they opened the
    // thread and actually tried to send, which looked like the setting
    // "wasn't working" even though the send was correctly rejected.
    // Showing the real restriction up front makes the working block visible.
    const friendsOnlyBlocked = p.messagePrivacy === "friends" && relationship !== "friends";
    const messageAction = canInteract
      ? (messagesClosed
        ? `<span class="btn btn-ghost messages-closed-badge" role="note" aria-label="This user has closed their messages">🔒 Messages closed</span>`
        : friendsOnlyBlocked
          ? `<span class="btn btn-ghost messages-closed-badge" role="note" aria-label="This user only accepts messages from friends">🔒 Friends only</span>`
          : `<a class="btn" href="messages.html?u=${encodeURIComponent(p.username)}">Message</a>`)
      : "";
    const callAction = canInteract ? `<button type="button" class="icon-btn profile-call-btn" data-call-user="${esc(p.username)}" data-call-type="audio" aria-label="Call ${esc(p.displayName || p.username)}" title="Call ${esc(p.displayName || p.username)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.4 4.5 10 4l1.4 4-2.1 1.4a11.6 11.6 0 0 0 5.3 5.3l1.4-2.1 4 1.4-.5 2.6a2.2 2.2 0 0 1-2.4 1.8C10.2 17.5 6.5 13.8 5.6 6.9a2.2 2.2 0 0 1 1.8-2.4Z"></path></svg></button>` : "";
    const friendActionWrap = canInteract
      ? `<div class="profile-head-actions profile-social-actions">${quickLike}${messageAction}${action}${callAction}${mini}</div>`
      : "";
    const standaloneMini = !canInteract && mini
      ? `<div class="profile-mini-standalone">${mini}${ownerLikesBadge}</div>`
      : ownerLikesBadge
        ? `<div class="profile-mini-standalone profile-owner-likes-only">${ownerLikesBadge}</div>`
        : "";

    return `<article class="profile-card template-card">
      <div class="profile-banner">${banner}</div>
      <div class="profile-content">
        <div class="profile-head">
          <div class="profile-avatar-wrap">
            <button type="button" class="profile-avatar-button ${p.story?.active ? "has-story" : "story-empty"}" data-story-user="${esc(p.username)}" data-story-active="${p.story?.active ? "1" : "0"}" data-story-own="${isMe ? "1" : "0"}" aria-label="${p.story?.active ? "View story" : isMe ? "Add a story" : "Profile avatar"}">${p.story?.active ? `<span class="story-ring-frame" aria-hidden="true"></span>` : ""}<span class="profile-avatar ${frame}">${p.avatar ? `<img src="${esc(p.avatar)}" alt="${esc(p.displayName || p.username)}">` : esc(initials(p))}${storeFrameOverlay(p)}</span>${isMe && !p.story?.active ? `<b class="story-add-dot profile-story-plus" aria-hidden="true">+</b>` : ""}</button>
            <div class="profile-presence" data-profile-presence="${esc(p.username)}" aria-label="${esc(PF.translateString("Offline"))}" title="${esc(PF.translateString("Offline"))}"><span class="status-dot offline"></span><span>${esc(PF.translateString("Offline"))}</span></div>
          </div>
          <div class="profile-identity">
            <h1>${esc(p.displayName || p.username)}</h1>
            <div class="profile-username profile-username-meta"><span>@${esc(p.username)}</span>${p.createdAt ? `<span class="account-since" title="Account age">${esc(formatAccountSince(p.createdAt))}</span>` : ""}</div>
            <p>${esc(p.bio || "")}</p>
            <div class="badges-inline">${badges}</div>
          </div>
          ${friendActionWrap}
        </div>
        ${standaloneMini}
        ${!isMe && !PF.currentUsername() ? `<div class="profile-actions-row"><span class="compact-likes-label">${displayViews(likeCount)} likes</span></div>` : ""}
        <div class="profile-stats">
          <div><span>متابعين</span><b data-followers-count>${Number.isFinite(Number(p.followersCount)) ? Number(p.followersCount) : (Array.isArray(p.followers) ? p.followers.length : 0)}</b></div>
          <div class="view-stat"><span><span class="eye-mini">◉</span> المشاهدات</span><b>${views}</b></div>
        </div>
        <div class="social-row">${social}</div>
        <div class="profile-sections">${sectionHtml || `<section class="section-block"><div class="section-kicker">ABOUT</div><p class="profile-description">${esc(p.description || p.bio || "No profile content yet.")}</p></section>`}</div>
      </div>
    </article>`;
  }

  function formatAccountSince(value) {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    const now = new Date();
    let years = now.getFullYear() - d.getFullYear();
    let months = years * 12 + (now.getMonth() - d.getMonth());
    if (now.getDate() < d.getDate()) months -= 1;
    months = Math.max(0, months);
    if (months >= 12) {
      const y = Math.floor(months / 12);
      return y === 1 ? "منذ سنة" : `منذ ${y} سنوات`;
    }
    if (months >= 1) {
      return months === 1 ? "منذ شهر" : `منذ ${months} أشهر`;
    }
    const days = Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
    return days <= 1 ? "منذ يوم" : `منذ ${days} يوم`;
  }

  function showAdminProfileIntro(root, enabled) {
    if (!enabled || !root) return;
    const old = root.querySelector(".rivo-owner-intro");
    if (old) old.remove();
    const oldMark = document.body.querySelector(".rivo-admin-faint-mark");
    if (oldMark) oldMark.remove();
    const overlay = document.createElement("div");
    overlay.className = "rivo-owner-intro";
    overlay.setAttribute("aria-label", "Owner Rivo");
    overlay.innerHTML = `<div class="rivo-owner-aura" aria-hidden="true"></div><div class="rivo-owner-scribble" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div><div class="rivo-owner-mark"><span class="rivo-owner-kicker">RIVO</span><div class="rivo-owner-title">Owner Rivo</div><div class="rivo-owner-sub">Official Administration</div></div>`;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("is-visible"));
    window.setTimeout(() => {
      overlay.classList.add("is-leaving");
      window.setTimeout(() => {
        overlay.remove();
        if (!document.body.querySelector(".rivo-admin-faint-mark")) {
          const mark = document.createElement("div");
          mark.className = "rivo-admin-faint-mark";
          mark.textContent = "ADMIN";
          mark.setAttribute("aria-hidden", "true");
          document.body.appendChild(mark);
        }
      }, 460);
    }, 1500);
  }

  async function bindProfilePresence(username) {
    const target = PF.normalizeUsername(username);
    if (!target) return;
    if (profilePresenceUnsubscribe) {
      try { await profilePresenceUnsubscribe(); } catch {}
      profilePresenceUnsubscribe = null;
    }
    const update = (state) => {
      const online = !!(state && Object.prototype.hasOwnProperty.call(state, target));
      const el = document.querySelector(`[data-profile-presence="${CSS.escape(target)}"]`);
      if (!el) return;
      el.classList.toggle('offline', !online);
      el.classList.toggle('online', online);
      const dot = el.querySelector('.status-dot');
      const label = el.querySelector(':scope > span:last-child');
      const sourceLabel = online ? 'Online' : 'Offline';
      const translatedLabel = PF.translateString(sourceLabel);
      dot?.classList.toggle('online', online);
      dot?.classList.toggle('offline', !online);
      if (label) label.textContent = translatedLabel;
      el.setAttribute('aria-label', translatedLabel);
      el.setAttribute('title', translatedLabel);
    };
    const viewer = PF.currentUsername();
    if (!viewer) { update({}); return; }
    try {
      const api = await PF.subscribePresence(viewer, evt => update(evt?.state || {}));
      profilePresenceUnsubscribe = api.unsubscribe;
      update(api.state || {});
    } catch {
      update({});
    }
  }

async function initProfile() {
    let username = PF.normalizeUsername(new URLSearchParams(location.search).get("u") || "");
    const root = $("#profileRoot");
    if (!root) return;
    if (!username) {
      const me = PF.currentUsername();
      if (me) { location.replace(`profile.html?u=${encodeURIComponent(me)}`); return; }
      root.innerHTML = `<div class="empty-state glass"><h2>Profile not found</h2><p>Choose a profile from Explore or sign in.</p><a class="btn btn-sm" href="../index.html">Back home</a></div>`;
      return;
    }
    let p = null;
    let lastError = null;
    for (let attempt = 0; attempt < 3 && !p; attempt++) {
      try { p = await PF.getProfile(username, { force: attempt > 0 }); }
      catch (e) { lastError = e; }
      if (!p && attempt < 2) await new Promise(r => setTimeout(r, 350 * (attempt + 1)));
    }
    if (!p && username === PF.currentUsername()) {
      try { p = await PF.currentProfile({ force: true }); } catch (e) { lastError = lastError || e; }
    }
    if (!p) {
      root.innerHTML = `<div class="empty-state glass"><h2>${lastError ? "Could not load profile" : "Profile not found"}</h2><p>${lastError ? "Please try again in a moment." : "This username does not exist."}</p><a class="btn btn-sm" href="../index.html">Back home</a></div>`; return;
    }
    try { p.story = (await PF.getStory(username, { countView:false })) || p.story || null; } catch {}
    if (!templates[p.template]) p = {...p, template:"discord-noir"};
    p.sections = (p.sections || []).filter(s => !["skills", "projects"].includes(s.type));
    const me = PF.currentUsername();
    const isMe = me === p.username;

    // A public profile must never depend on secondary/private requests before
    // it is rendered. The economy rollout introduced more RPCs/tables, so a
    // failure in any optional social/economy path used to leave the whole page
    // stuck on "Loading profile" even though the public profile RPC succeeded.
    // Render the public card first, then hydrate optional data defensively.
    const viewer = isMe ? p : await PF.currentProfile().catch(() => null);
    const relationship = isMe ? "self" : PF.friendshipState(viewer, p.username);
    const friends = Array.isArray(p.friends) ? p.friends : [];
    const friendProfiles = await PF.getProfiles(friends).catch(() => []);
    if (!isMe) PF.addView(username).catch(() => {});

    p.likes ||= {count:0, users:[]};
    p.likes.users ||= [];
    p.likes.count = Number.isFinite(Number(p.likes.count)) ? Math.max(0, Number(p.likes.count)) : p.likes.users.length;

    // IMPORTANT: do not put profile rendering behind admin/story/post/counter
    // requests. Those are enhancements, not prerequisites for opening a page.
    root.innerHTML = renderProfileCard(p, { isMe, friendProfiles, relationship }) + `<section class="profile-posts-wrap"><div class="section-head profile-posts-head"><div><div class="section-kicker">POSTS</div><h2>المنشورات</h2></div>${isMe ? `<a class="btn btn-sm" href="posts.html">+ New post</a>` : ""}</div><div id="profilePostFeed" class="post-feed"><div class="empty-state glass"><h2>Loading posts…</h2></div></div></section>`;
    bindPlayer(root);
    await bindProfilePresence(p.username).catch(() => {});
    bindProfileActions(p);
    $(`[data-friends-open]`)?.addEventListener("click", () => openFriendsModal(friendProfiles));

    // Refresh volatile public data after the first paint. Failure here must not
    // blank or block the profile.
    try {
      const fresh = !isMe ? await PF.getProfile(username, {force:true}) : await PF.currentProfile({force:true});
      if (fresh) {
        try { fresh.story = (await PF.getStory(username, { countView:false })) || p.story || null; } catch {}
        fresh.likes ||= p.likes;
        p = fresh;
      }
    } catch {}

    let isRivoAdminProfile = false;
    try { isRivoAdminProfile = await PF.isAdminProfile(p.username); } catch {}
    showAdminProfileIntro(root, isRivoAdminProfile);

    // Posts are intentionally isolated from the profile card.
    await renderPostFeed($("#profilePostFeed"), p.username, { allowCompose:false });
  }

  async function refreshCurrentProfileView(username) {
    const root = $("#profileRoot");
    if (!root) return;
    const p = await PF.getProfile(username, { force: true });
    if (!p) return;
    const viewer = await PF.currentProfile({ force: true });
    const rel = PF.friendshipState(viewer, p.username);
    const friendProfiles = await PF.getProfiles(p.friends || []);
    const isMe = PF.currentUsername() === p.username;
    root.innerHTML = renderProfileCard(p, { isMe, friendProfiles, relationship: isMe ? "self" : rel }) + `<section class="profile-posts-wrap"><div class="section-head profile-posts-head"><div><div class="section-kicker">POSTS</div><h2>${isMe ? "المنشورات" : "المنشورات"}</h2></div>${isMe ? `<a class="btn btn-sm" href="posts.html">+ New post</a>` : ""}</div><div id="profilePostFeed" class="post-feed"></div></section>`;
    bindPlayer(root);
    await bindProfilePresence(p.username);
    await renderPostFeed($("#profilePostFeed"), p.username, { allowCompose:false });
    await bindProfileActions(p);
    $("[data-friends-open]")?.addEventListener("click", () => openFriendsModal(friendProfiles));
  }

  async function bindProfileActions(profile) {
    const relationshipToggle = $("[data-relationship-toggle]");
    const relationshipPopover = $("[data-relationship-popover]");

    relationshipToggle?.addEventListener("click", (event) => {
      event.stopPropagation();
      if (!relationshipPopover) return;
      const open = !relationshipPopover.hidden;
      relationshipPopover.hidden = open;
      relationshipToggle.setAttribute("aria-expanded", open ? "false" : "true");
    });

    relationshipPopover?.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-rel-action]");
      if (!button) return;
      event.stopPropagation();
      const action = button.dataset.relAction;
      button.disabled = true;
      try {
        if (action === "add-friend") {
          await PF.sendFriendRequest(profile.username);
          notify("Friend request sent", "success");
        } else if (action === "cancel-request") {
          await PF.cancelFriendRequest(profile.username);
          notify("Friend request cancelled", "success");
        } else if (action === "accept-friend") {
          await PF.acceptFriendRequest(profile.username);
          notify("Friend added", "success");
        } else if (action === "remove-friend") {
          await PF.removeFriend(profile.username);
          notify("Friend removed", "success");
        } else if (action === "toggle-follow") {
          const result = await PF.toggleFollow(profile.username);
          const followingNow = !!result?.following;
          const followerCount = Math.max(0, Number(result?.followers_count) || 0);
          button.textContent = followingNow ? "Unfollow" : "Follow";
          const countEl = $("[data-followers-count]");
          if (countEl) countEl.textContent = String(followerCount);
          notify(followingNow ? "Following" : "Unfollowed", "success");
          // Do not rebuild the whole profile after follow/unfollow. The RPC
          // already returned the authoritative follower count; updating only
          // the affected controls avoids interrupting the profile/post UI.
          return;
        } else {
          return;
        }
        await refreshCurrentProfileView(profile.username);
      } catch (err) {
        notify(err.message, "error");
      } finally {
        button.disabled = false;
      }
    });

    if (!window.__rivoRelationshipMenuBound) {
      window.__rivoRelationshipMenuBound = true;
      document.addEventListener("click", (event) => {
        $$('[data-relationship-menu]').forEach(menu => {
          if (menu.contains(event.target)) return;
          const popover = $("[data-relationship-popover]", menu);
          const toggle = $("[data-relationship-toggle]", menu);
          if (popover) popover.hidden = true;
          toggle?.setAttribute("aria-expanded", "false");
        });
      });
    }
    const likeButton = $("[data-like-profile]");
    if (likeButton && likeButton.dataset.bound !== "1") {
      likeButton.dataset.bound = "1";
      likeButton.addEventListener("click", async () => {
        if (likeButton.disabled) return;
        likeButton.disabled = true;
        try {
          const result = await PF.toggleLike(profile.username);
          // Update only the like control. Never rebuild profileRoot or the post
          // feed here: a successful Like must not interrupt the rest of the page.
          const liked = !!result?.liked;
          const count = Math.max(0, Number(result?.count) || 0);
          likeButton.classList.toggle("liked", liked);
          likeButton.setAttribute("aria-label", liked ? "Unlike" : "Like");
          const heart = likeButton.querySelector(".heart");
          const countEl = likeButton.querySelector(".like-count");
          if (heart) heart.textContent = liked ? "♥" : "♡";
          if (countEl) countEl.textContent = displayViews(count);
          notify(liked ? "Profile liked" : "Like removed", "success");
        } catch (err) {
          notify(err?.message || "Could not update the like.", "error");
        } finally {
          likeButton.disabled = false;
        }
      });
    }
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

  function storeTypeIcon(type) { return ({avatar:"◉", frame:"◇", template:"▦", badge:"✦", feature:"⚙"})[type] || "◈"; }
  function storeTypeLabel(type) { return ({avatar:"افتار", frame:"إطار", template:"قالب", badge:"شارة"})[type] || type || "عنصر"; }
  function renderStoreItemCard(item, ownedIds = new Set(), inventory = []) {
    const owned = ownedIds.has(String(item.id));
    const inv = inventory.find(x => String(x.item_id) === String(item.id));
    const price = Number(item.price || 0);
    const media = item.image_url ? `<img src="${esc(item.image_url)}" alt="" loading="lazy">` : `<span class="store-item-icon">${storeTypeIcon(item.type)}</span>`;
    const action = owned
      ? `<div class="store-owned-actions"><button type="button" class="btn btn-sm ${inv?.is_equipped ? "" : "btn-primary"}" data-store-equip="${esc(item.id)}">${inv?.is_equipped ? "إلغاء التجهيز" : "تجهيز"}</button><span class="store-owned">مملوك</span></div>`
      : `<button type="button" class="btn btn-sm btn-primary" data-store-buy="${esc(item.id)}">${price === 0 ? "مجاني" : `${price} 🪙 شراء`}</button>`;
    return `<article class="store-item glass" data-store-item="${esc(item.id)}"><div class="store-item-media">${media}</div><div class="store-item-copy"><div class="store-item-top"><span class="store-type">${storeTypeIcon(item.type)} ${esc(storeTypeLabel(item.type))}</span>${price===0?`<span class="store-free">مجاني</span>`:`<span class="store-price">${price} 🪙</span>`}</div><h3>${esc(item.name)}</h3><p>${esc(item.description || "")}</p><div class="store-item-actions">${action}</div></div></article>`;
  }
  async function initExplore() {
    const form = $("#searchForm"), input = $("#searchInput"), box = $("#results"); if (!box) return;
    const draw = list => box.innerHTML = list.length ? list.map(p => `<article class="user-card glass"><div class="user-top">${avatarMarkup(p)}<div><strong>${esc(p.displayName)}</strong><span>@${esc(p.username)}</span></div></div><p>${esc(p.bio || "No bio yet.")}</p><div class="badges-inline">${badgePills(p, 1)}${storeBadgePills(p,1)}</div><a class="btn btn-sm btn-primary" href="profile.html?u=${encodeURIComponent(p.username)}">View Profile</a></article>`).join("") : `<div class="empty-state glass" style="grid-column:1/-1"><h2>No profiles found</h2><p>Search by username or display name.</p></div>`;
    const all = await PF.listProfiles(); draw(all.slice(0, 12));
    form?.addEventListener("submit", async e => { e.preventDefault(); draw(await PF.searchUsers(input.value)); });
    let searchTimer = 0;
    input?.addEventListener("input", () => { clearTimeout(searchTimer); const q = input.value.trim(); searchTimer = setTimeout(async () => { try { draw(q ? await PF.searchUsers(q) : all.slice(0, 12)); } catch (e) { notify(e.message, "error"); } }, 220); });

  }

  async function initFriends() {
    const me = await PF.currentProfile(); if (!me) { location.href = "login.html"; return; }
    const requestBox = $("#requestList"), sentBox = $("#sentRequestList"), friendBox = $("#friendList"), search = $("#friendSearch");
    let renderSeq = 0;
    const render = async query => {
      const seq = ++renderSeq;
      const fresh = await PF.currentProfile({ force: true });
      if (seq !== renderSeq) return;
      const incoming = fresh.friendRequests?.incoming || [], outgoing = fresh.friendRequests?.outgoing || [], friends = fresh.friends || [];
      const requestProfiles = await Promise.all(incoming.map(u => PF.getProfile(u, { force: true })));
      const sentProfiles = await Promise.all(outgoing.map(u => PF.getProfile(u, { force: true })));
      const requests = requestProfiles.filter(Boolean);
      const sentRequests = sentProfiles.filter(Boolean);
      let profiles = (await PF.getProfiles(friends)).filter(Boolean);
      const q = String(query || "").trim().toLowerCase().replace(/^@/, "");
      if (q) profiles = profiles.filter(p => p.username.includes(q) || (p.displayName || "").toLowerCase().includes(q));
      requestBox.innerHTML = requests.length ? requests.map(p => `<article class="user-card glass"><div class="user-top">${avatarMarkup(p)}<div><strong>${esc(p.displayName)}</strong><span>@${esc(p.username)}</span></div></div><div class="hero-actions"><button class="btn btn-sm btn-primary" type="button" data-accept="${esc(p.username)}">Accept</button><button class="btn btn-sm btn-danger" type="button" data-reject="${esc(p.username)}">Decline</button></div></article>`).join("") : `<div class="empty-state glass" style="grid-column:1/-1">No pending requests.</div>`;
      sentBox.innerHTML = sentRequests.length ? sentRequests.map(p => `<article class="user-card glass"><div class="user-top">${avatarMarkup(p)}<div><strong>${esc(p.displayName)}</strong><span>@${esc(p.username)}</span></div></div><div class="hero-actions"><a class="btn btn-sm" href="profile.html?u=${encodeURIComponent(p.username)}">View</a><button class="btn btn-sm btn-danger" type="button" data-cancel-sent="${esc(p.username)}">Cancel request</button></div></article>`).join("") : `<div class="empty-state glass" style="grid-column:1/-1">No sent requests.</div>`;
      friendBox.innerHTML = profiles.length ? profiles.map(p => `<article class="user-card glass"><div class="user-top">${avatarMarkup(p)}<div><strong>${esc(p.displayName)}</strong><span>@${esc(p.username)}</span></div></div><p>${esc(p.bio || "")}</p><div class="hero-actions"><a class="btn btn-sm btn-primary" href="profile.html?u=${encodeURIComponent(p.username)}">View</a><button class="btn btn-sm btn-danger" type="button" data-remove="${esc(p.username)}">Remove</button></div></article>`).join("") : `<div class="empty-state glass" style="grid-column:1/-1">No friends found.</div>`;
      $$('[data-accept]').forEach(b => b.onclick = async e => { e.preventDefault(); e.stopPropagation(); try { await PF.acceptFriendRequest(b.dataset.accept); notify("Friend added", "success"); render(search?.value); } catch(e) { notify(e.message,"error"); } });
      $$('[data-reject]').forEach(b => b.onclick = async e => { e.preventDefault(); e.stopPropagation(); try { await PF.rejectFriendRequest(b.dataset.reject); notify("Request declined", "success"); render(search?.value); } catch(e) { notify(e.message,"error"); } });
      $$('[data-cancel-sent]').forEach(b => b.onclick = async e => { e.preventDefault(); e.stopPropagation(); try { await PF.cancelFriendRequest(b.dataset.cancelSent); notify("Friend request cancelled", "success"); render(search?.value); } catch(e) { notify(e.message,"error"); } });
      $$('[data-remove]').forEach(b => b.onclick = async e => { e.preventDefault(); e.stopPropagation(); try { await PF.removeFriend(b.dataset.remove); notify("Friend removed", "success"); render(search?.value); } catch(e) { notify(e.message,"error"); } });
    };
    search?.addEventListener("input", () => render(search.value)); await render("");
  }

  async function initMessages() {
    const me = await PF.currentProfile();
    if (!me) { location.href = "login.html"; return; }
    const list = $("#conversationList");
    const search = $("#messageSearch");
    const thread = $("#messageThread");
    const title = $("#messageThreadTitle");
    const form = $("#messageForm");
    const input = $("#messageInput");
    const status = $("#messageStatus");
    const messagesLayout = document.querySelector(".messages-layout");
    const mobileBack = $("#messageMobileBack");
    if (!list || !thread || !title || !form || !input || !status || !messagesLayout) return;

    let activeUser = "";
    let activeUserId = "";
    let conversations = [];
    let messageUnsubscribe = null;
    let reactionUnsubscribe = null;
    let presence = null;
    let typingTimer = null;
    let typingStopTimer = null;
    const renderedMessageIds = new Set();
    let mediaRecorder = null;
    let recordingStream = null;
    let recordingStartedAt = 0;
    let recordingTimer = null;
    let voiceDraft = null;

    const scrollThread = () => { thread.scrollTop = thread.scrollHeight; };
    const avatarMini = p => p?.avatar
      ? `<img class="message-avatar" src="${esc(p.avatar)}" alt="">`
      : `<span class="message-avatar message-avatar-fallback">${esc(PF.initials(p))}</span>`;

    const getPresenceFor = username => {
      const key = PF.normalizeUsername(username);
      if (!presence || !key) return null;
      const state = presence.state?.[key];
      return Array.isArray(state) && state.length ? state[state.length - 1] : null;
    };

    const updateThreadPresence = () => {
      if (!activeUser) { status.textContent = ""; return; }
      const peer = getPresenceFor(activeUser);
      if (!peer) {
        status.innerHTML = `<span class="presence-dot offline"></span> Offline`;
        return;
      }
      if (peer.typingTo === me.username) {
        status.innerHTML = `<span class="presence-dot online"></span> Typing…`;
      } else {
        status.innerHTML = `<span class="presence-dot online"></span> Online`;
      }
    };

    const renderConversations = () => {
      const q = String(search.value || "").trim().toLowerCase().replace(/^@/, "");
      const filtered = conversations.filter(c => !q || c.username.includes(q) || String(c.displayName || "").toLowerCase().includes(q));
      list.innerHTML = filtered.length
        ? filtered.map(c => `<button type="button" class="conversation-item ${activeUser === c.username ? "active" : ""}" data-conversation="${esc(c.username)}"><span class="conversation-avatar" data-profile-open="${esc(c.username)}" role="link" tabindex="0" aria-label="Open @${esc(c.username)} profile">${avatarMini(c)}</span><span class="conversation-copy"><span data-profile-open="${esc(c.username)}" class="conversation-person" role="link" tabindex="0"><b>${esc(c.displayName)}</b><small>@${esc(c.username)}</small></span><em>${esc(c.lastMessage || "No messages yet")}</em></span><time>${esc(c.updatedLabel || "")}</time></button>`).join("")
        : `<div class="message-list-empty">${q ? "No matching conversations." : "No conversations yet."}</div>`;
      $$('[data-conversation]').forEach(btn => btn.onclick = () => openConversation(btn.dataset.conversation));
      list.querySelectorAll('[data-profile-open]').forEach(el => {
        const open = ev => { ev.preventDefault(); ev.stopPropagation(); location.href = `profile.html?u=${encodeURIComponent(PF.normalizeUsername(el.dataset.profileOpen || ""))}`; };
        el.addEventListener('click', open);
        el.addEventListener('keydown', ev => { if (ev.key === 'Enter' || ev.key === ' ') open(ev); });
      });
    };

    const appendMessage = (m, keepBottom = true) => {
      if (!m?.id || renderedMessageIds.has(String(m.id))) return;
      renderedMessageIds.add(String(m.id));
      const row = document.createElement("div");
      row.className = `message-row ${m.sender_username === me.username ? "mine" : "theirs"}`;
      const bubble = document.createElement("div");
      bubble.className = "message-bubble";
      bubble.dir = "auto";
      bubble.setAttribute("data-message-id", String(m.id));
      if (m.message_type === "voice" && m.voice_path) {
        const voiceWrap = document.createElement("div");
        voiceWrap.className = "voice-message-bubble";
        const play = document.createElement("button");
        play.type = "button";
        play.className = "voice-play-btn";
        play.textContent = "▶";
        play.setAttribute("aria-label", "Play voice message");
        const audio = document.createElement("audio");
        audio.preload = "metadata";
        audio.controls = true;
        audio.className = "voice-audio";
        const dur = document.createElement("span");
        dur.className = "voice-duration";
        dur.textContent = "0:00";
        voiceWrap.append(play, audio, dur);
        bubble.appendChild(voiceWrap);
        play.onclick = async () => {
          try {
            if (!audio.src) audio.src = await PF.getVoiceUrl(m.voice_path);
            if (audio.paused) { await audio.play(); play.textContent = "Ⅱ"; } else { audio.pause(); play.textContent = "▶"; }
          } catch (err) { notify(err.message || "Could not play voice message", "error"); }
        };
        audio.onplay = () => { play.textContent = "Ⅱ"; };
        audio.onpause = () => { play.textContent = "▶"; };
        audio.ontimeupdate = () => { const sec = Number(m.voice_duration || audio.currentTime || 0) / (m.voice_duration ? 1000 : 1); dur.textContent = `${Math.floor(sec/60)}:${String(Math.floor(sec%60)).padStart(2,"0")}`; };
        audio.onloadedmetadata = () => { if (!m.voice_duration && Number.isFinite(audio.duration)) dur.textContent = `${Math.floor(audio.duration/60)}:${String(Math.floor(audio.duration%60)).padStart(2,"0")}`; };
      } else {
        const content = document.createElement("span");
        content.className = PF.isEmojiOnly(m.content) ? "message-content emoji-only" : "message-content";
        content.textContent = PF.normalizeMessageText(m.content);
        bubble.appendChild(content);
      }
      const time = document.createElement("time");
      time.textContent = new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      bubble.appendChild(time);
      if (!String(m.id).startsWith("pending-")) {
        const reactionBar = document.createElement("div");
        reactionBar.className = "message-reactions";
        reactionBar.innerHTML = (Array.isArray(m.reactions) ? m.reactions : []).map(r => `<button type="button" class="reaction-chip ${r.me ? "mine" : ""}" data-reaction-message="${esc(m.id)}" data-reaction-value="${esc(r.reaction)}"><span>${esc(r.reaction)}</span><b>${esc(r.count)}</b></button>`).join("");
        if (reactionBar.childElementCount) bubble.appendChild(reactionBar);

        // Reactions on desktop/touch: existing reaction chips are clickable,
        // while a press-and-hold on the message bubble opens the quick menu.
        // There is intentionally no visible "+" button, keeping the bubble
        // clean on small screens.
        reactionBar.querySelectorAll("[data-reaction-message]").forEach(btn => {
          btn.addEventListener("click", async ev => {
            ev.preventDefault();
            ev.stopPropagation();
            try {
              await PF.toggleMessageReaction(btn.dataset.reactionMessage, btn.dataset.reactionValue);
              await refreshOpenThread();
            } catch (err) {
              notify(err?.message || "Could not update reaction", "error");
            }
          });
        });

        let holdTimer = null;
        let holdTriggered = false;
        const clearHold = () => {
          if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
        };
        bubble.addEventListener("pointerdown", ev => {
          if (ev.target.closest("button,a,input,textarea,select")) return;
          holdTriggered = false;
          clearHold();
          holdTimer = setTimeout(() => {
            holdTriggered = true;
            openReactionMenu(bubble, m.id, ev.clientX, ev.clientY);
          }, 520);
        }, { passive: true });
        bubble.addEventListener("pointerup", clearHold, { passive: true });
        bubble.addEventListener("pointercancel", clearHold, { passive: true });
        bubble.addEventListener("pointerleave", clearHold, { passive: true });
        bubble.addEventListener("click", ev => {
          if (holdTriggered) {
            ev.preventDefault();
            ev.stopPropagation();
            holdTriggered = false;
          }
        });
      }
      row.appendChild(bubble);
      const placeholder = thread.querySelector(".message-empty");
      if (placeholder) thread.innerHTML = "";
      thread.appendChild(row);
      if (keepBottom) scrollThread();
    };

    function openReactionMenu(anchorEl, messageId, clientX = null, clientY = null) {
      document.querySelectorAll(".reaction-popover").forEach(x => x.remove());
      const pop = document.createElement("div");
      pop.className = "reaction-popover glass";
      pop.innerHTML = PF.REACTION_SET.map(r => `<button type="button" data-quick-reaction="${esc(r)}">${esc(r)}</button>`).join("");
      document.body.appendChild(pop);
      const rect = anchorEl.getBoundingClientRect();
      const x = Number.isFinite(clientX) ? clientX : rect.left + rect.width / 2;
      const y = Number.isFinite(clientY) ? clientY : rect.top;
      pop.style.left = `${Math.max(8, Math.min(window.innerWidth - 220, x - 90))}px`;
      pop.style.top = `${Math.max(8, y - 58)}px`;
      $$('[data-quick-reaction]', pop).forEach(btn => btn.onclick = async () => {
        try { await PF.toggleMessageReaction(messageId, btn.dataset.quickReaction); await refreshOpenThread(); } catch (e) { notify(e.message, "error"); } finally { pop.remove(); }
      });
      setTimeout(() => document.addEventListener("click", () => pop.remove(), {once:true}), 0);
    }

    async function refreshOpenThread() {
      if (!activeUser) return;
      const messages = await PF.getMessages(activeUser);
      renderThread(messages);
    }

    const renderThread = messages => {
      renderedMessageIds.clear();
      thread.innerHTML = "";
      if (!activeUser) {
        thread.innerHTML = `<div id="messageEmpty" class="message-empty"><div class="message-empty-icon">✉</div><h2>Choose a conversation</h2><p>Select someone from the left to start messaging.</p></div>`;
        return;
      }
      const ordered = [...messages].reverse();
      if (!ordered.length) {
        thread.innerHTML = `<div class="message-empty"><div class="message-empty-icon">✉</div><h2>No messages yet</h2><p>Send the first text message.</p></div>`;
        return;
      }
      ordered.forEach(m => appendMessage(m, false));
      scrollThread();
    };

    async function loadConversations() {
      conversations = await PF.listConversations();
      const active = conversations.find(c => c.username === activeUser);
      if (active?.userId) activeUserId = active.userId;
      renderConversations();
    }

    // Reflects the recipient's "who can message you" setting on the compose
    // box itself, instead of only finding out after Send is tapped. peerProfile
    // is whatever PF.getProfile returned for the open conversation (it always
    // carries messagePrivacy), or null if it couldn't be fetched.
    function applyComposeLock(peerProfile) {
      const submitBtn = form.querySelector('button[type="submit"]');
      if (!peerProfile) {
        input.disabled = false;
        input.placeholder = "Write a message...";
        if (submitBtn) submitBtn.disabled = false;
        return;
      }
      const priv = peerProfile.messagePrivacy || "everyone";
      const rel = PF.friendshipState(me, peerProfile.username);
      const closed = priv === "nobody";
      const friendsOnly = priv === "friends" && rel !== "friends";
      const locked = closed || friendsOnly;
      input.disabled = locked;
      if (submitBtn) submitBtn.disabled = locked;
      input.placeholder = closed
        ? "This user has closed their messages"
        : friendsOnly
          ? "Only this user's friends can message them"
          : "Write a message...";
      if (locked) input.value = "";
    }

    async function openConversation(username) {
      messagesLayout.classList.add("conversation-open");
      if (window.innerWidth <= 760) document.body.classList.add("rivo-chat-fullscreen");
      window.__rivoActiveMessageUser = PF.normalizeUsername(username);
      activeUser = PF.normalizeUsername(username);
      const c = conversations.find(x => x.username === activeUser);
      activeUserId = c?.userId || "";
      clearTimeout(typingStopTimer);
      if (presence) {
        try { await presence.update({ typingTo: "" }); } catch {}
      }

      let conversation = c;
      let peerProfile = null;
      try { peerProfile = await PF.getProfile(activeUser); } catch {}
      if (peerProfile) {
        activeUserId = peerProfile.userId || activeUserId;
        conversation = conversation || {
          username: peerProfile.username,
          userId: peerProfile.userId || "",
          displayName: peerProfile.displayName || peerProfile.username,
          avatar: peerProfile.avatar || "",
          lastMessage: "Start a new conversation",
          updatedLabel: "",
          createdAt: ""
        };
        if (!c) {
          conversations.unshift(conversation);
        } else if (c.userId !== activeUserId) {
          const idx = conversations.indexOf(c);
          if (idx >= 0) conversations[idx] = { ...c, userId: activeUserId };
        }
      }

      title.innerHTML = conversation
        ? `<span class="thread-user-avatar">${identityLink(conversation, avatarMini(conversation), "thread-avatar-link")}</span><span>${identityLink(conversation, `<span><b>${esc(conversation.displayName)}</b><small>@${esc(conversation.username)}</small></span>`)}</span>`
        : `<span><b>@${esc(activeUser)}</b></span>`;
      renderConversations();
      try {
        const messages = await PF.getMessages(activeUser);
        renderThread(messages);
        updateThreadPresence();
        applyComposeLock(peerProfile);
        if (!input.disabled) input.focus();
      } catch (e) { notify(e.message, "error"); }
    }

    async function updateTyping(value) {
      if (!presence) return;
      const isTyping = Boolean(value && activeUser);
      clearTimeout(typingStopTimer);
      await presence.update({ typingTo: isTyping ? activeUser : "" });
      if (isTyping) {
        typingStopTimer = setTimeout(() => { presence?.update({ typingTo: "" }); }, 1200);
      }
    }

    form.addEventListener("submit", async e => {
      e.preventDefault();
      const text = String(input.value || "").trim();
      if (!activeUser || !text) return;
      clearTimeout(typingStopTimer);

      // Optimistic send: show the bubble instantly instead of waiting on the
      // round trip, so sending *feels* fast even on a slow connection. It's
      // marked .pending until the server confirms, then swapped for the
      // real row; on failure it's removed and the text is handed back.
      input.value = "";
      const tempId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      appendMessage({ id: tempId, sender_username: me.username, receiver_username: activeUser, content: text, created_at: new Date().toISOString() });
      thread.querySelector(`[data-message-id="${tempId}"]`)?.classList.add("pending");

      const dropTemp = () => {
        renderedMessageIds.delete(tempId);
        thread.querySelector(`[data-message-id="${tempId}"]`)?.closest(".message-row")?.remove();
      };

      try {
        const sent = await PF.sendMessage(activeUser, text);
        await presence?.update({ typingTo: "" });
        dropTemp();
        if (sent) {
          appendMessage(sent);
          const idx = conversations.findIndex(c => c.username === activeUser);
          if (idx >= 0) {
            conversations[idx] = { ...conversations[idx], lastMessage: sent.content, createdAt: sent.created_at, updatedLabel: new Date(sent.created_at).toLocaleDateString([], { month: "short", day: "2-digit" }) };
          } else {
            conversations.unshift({ username: activeUser, userId: activeUserId, displayName: activeUser, avatar: "", lastMessage: sent.content, createdAt: sent.created_at, updatedLabel: "Now" });
          }
          conversations.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
          renderConversations();
        }
      } catch (e) {
        dropTemp();
        input.value = text; // hand the text back so nothing typed is lost
        notify(e.message, "error");
      }
      finally { input.focus(); }
    });

    let composing = false;
    input.addEventListener("compositionstart", () => { composing = true; });
    input.addEventListener("compositionend", () => { composing = false; input.dispatchEvent(new Event("input", { bubbles:true })); });
    input.addEventListener("input", () => {
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => updateTyping(input.value.trim()), 80);
    });
    input.addEventListener("keydown", e => {
      // Ignore Enter while a mobile keyboard's word-suggestion/composition
      // is still in progress (e.isComposing / the legacy keyCode 229).
      // Submitting mid-composition sends whatever text existed *before*
      // the phone's predictive text finished swapping in the final word,
      // which is what caused sent messages to not match what was typed.
      if (e.key === "Enter" && !e.shiftKey && !composing && !e.isComposing && e.keyCode !== 229) {
        e.preventDefault();
        form.requestSubmit();
      }
    });
    search.addEventListener("input", renderConversations);
    window.addEventListener("resize", () => {
      if (!messagesLayout.classList.contains("conversation-open")) return;
      if (window.innerWidth <= 760) document.body.classList.add("rivo-chat-fullscreen");
      else document.body.classList.remove("rivo-chat-fullscreen");
    }, { passive: true });
    mobileBack?.addEventListener("click", () => {
      messagesLayout.classList.remove("conversation-open");
      document.body.classList.remove("rivo-chat-fullscreen");
      activeUser = "";
      activeUserId = "";
      window.__rivoActiveMessageUser = "";
      title.innerHTML = `<span class="thread-placeholder">Choose a conversation</span>`;
      renderThread([]);
      input.value = "";
      input.disabled = true;
      const sendBtn = form.querySelector('button[type="submit"]');
      if (sendBtn) sendBtn.disabled = true;
    });

const voiceBar = $("#voiceMessageBar");
const voiceRecordBtn = $("#voiceRecordBtn");
const voiceMessageState = $("#voiceMessageState");
const voiceMessageTime = $("#voiceMessageTime");
const voiceMessageCancel = $("#voiceMessageCancel");
const voiceMessageSend = $("#voiceMessageSend");
const formatVoiceTime = ms => { const sec=Math.floor(Math.max(0, Number(ms)||0)/1000); return `${Math.floor(sec/60)}:${String(sec%60).padStart(2,"0")}`; };
const stopVoiceStream = () => { try { recordingStream?.getTracks?.().forEach(t => t.stop()); } catch {} recordingStream=null; };
const clearVoiceDraft = () => { voiceDraft=null; if(voiceMessageSend) voiceMessageSend.disabled=true; if(voiceBar) voiceBar.classList.add("hidden"); if(voiceMessageState) voiceMessageState.textContent="Ready"; if(voiceMessageTime) voiceMessageTime.textContent="0:00"; };
const finishVoiceRecording = () => {
  if (!mediaRecorder) return;
  try { if (mediaRecorder.state !== "inactive") mediaRecorder.stop(); } catch {}
  stopVoiceStream();
  clearInterval(recordingTimer); recordingTimer=null; mediaRecorder=null;
};
let voicePressActive = false;
let voicePointerId = null;
let voiceJustFinished = false;

const startVoiceRecording = async () => {
  if (mediaRecorder && mediaRecorder.state === "recording") return;
  if (!activeUser) { notify("Choose a conversation first.", "error"); return; }
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    notify("Voice recording is not supported in this browser.", "error"); return;
  }
  try {
    recordingStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation:true, noiseSuppression:true, autoGainControl:true }
    });
    const preferred = ["audio/webm;codecs=opus","audio/ogg;codecs=opus","audio/webm","audio/mp4"]
      .find(t => MediaRecorder.isTypeSupported(t));
    mediaRecorder = new MediaRecorder(
      recordingStream,
      preferred ? { mimeType: preferred, audioBitsPerSecond: 64000 } : undefined
    );
    const chunks = [];
    recordingStartedAt = Date.now();
    voiceDraft = null;
    mediaRecorder.ondataavailable = e => { if (e.data?.size) chunks.push(e.data); };
    mediaRecorder.onstop = () => {
      const duration = Math.min(Date.now() - recordingStartedAt, 5 * 60 * 1000);
      const mime = mediaRecorder?.mimeType || "audio/webm";
      const blob = new Blob(chunks, { type: mime });
      if (blob.size && duration >= 350) {
        voiceDraft = { blob, duration };
        if (voiceBar) voiceBar.classList.remove("hidden");
        if (voiceMessageState) voiceMessageState.textContent = "Voice ready";
        if (voiceMessageSend) voiceMessageSend.disabled = false;
      } else {
        clearVoiceDraft();
      }
      if (voiceRecordBtn) voiceRecordBtn.classList.remove("recording");
    };
    mediaRecorder.start(250);
    voiceBar?.classList.remove("hidden");
    if (voiceMessageState) voiceMessageState.textContent = "Recording… release to stop";
    if (voiceMessageTime) voiceMessageTime.textContent = "0:00";
    voiceRecordBtn?.classList.add("recording");
    recordingTimer = setInterval(() => {
      const ms = Math.min(Date.now() - recordingStartedAt, 5 * 60 * 1000);
      if (voiceMessageTime) voiceMessageTime.textContent = formatVoiceTime(ms);
      if (ms >= 5 * 60 * 1000) stopVoiceRecording();
    }, 250);
  } catch {
    stopVoiceStream();
    notify("Microphone permission is required to record a voice message.", "error");
  }
};

const stopVoiceRecording = () => {
  if (!mediaRecorder) return;
  try { if (mediaRecorder.state !== "inactive") mediaRecorder.stop(); } catch {}
  stopVoiceStream();
  clearInterval(recordingTimer);
  recordingTimer = null;
  mediaRecorder = null;
};

const endVoicePress = async () => {
  if (!voicePressActive) return;
  voicePressActive = false;
  voiceRecordBtn?.classList.remove("recording");
  stopVoiceRecording();
  voiceJustFinished = true;
  setTimeout(() => { voiceJustFinished = false; }, 250);
};

voiceRecordBtn?.addEventListener("pointerdown", async e => {
  if (e.button !== 0 && e.pointerType !== "touch") return;
  e.preventDefault();
  voicePressActive = true;
  voicePointerId = e.pointerId;
  voiceRecordBtn.setPointerCapture?.(e.pointerId);
  await startVoiceRecording();
});
voiceRecordBtn?.addEventListener("pointerup", async e => {
  if (voicePointerId !== null && e.pointerId !== voicePointerId) return;
  e.preventDefault();
  await endVoicePress();
  voicePointerId = null;
});
voiceRecordBtn?.addEventListener("pointercancel", endVoicePress);
voiceRecordBtn?.addEventListener("lostpointercapture", () => {
  if (voicePressActive) endVoicePress();
});
voiceRecordBtn?.addEventListener("contextmenu", e => e.preventDefault());

voiceMessageCancel?.addEventListener("click",()=>{ finishVoiceRecording(); clearVoiceDraft(); if(voiceRecordBtn) voiceRecordBtn.classList.remove("recording"); });
voiceMessageSend?.addEventListener("click",async()=>{
  if(!voiceDraft || !activeUser) return;
  const draft=voiceDraft; voiceMessageSend.disabled=true; if(voiceMessageState) voiceMessageState.textContent="Sending…";
  try { await PF.sendVoiceMessage(activeUser,draft.blob,draft.duration); clearVoiceDraft(); await loadConversations(); await refreshOpenThread(); }
  catch(err){ if(voiceMessageState) voiceMessageState.textContent="Failed — press Send voice to retry"; voiceMessageSend.disabled=false; notify(err.message||"Could not send voice message","error"); }
});

    let resyncing = false;
    const resyncThread = async () => {
      // Fallback catch-up: re-pulls the open thread + conversation list from
      // the server. Cheap (id-based de-dupe skips anything already shown) and
      // guarantees delivery even if a push event was missed (tab backgrounded,
      // socket hiccup, etc.) instead of requiring a manual page reload.
      if (resyncing) return;
      resyncing = true;
      try {
        await loadConversations();
        const active = conversations.find(c => c.username === activeUser);
        if (active?.userId) activeUserId = active.userId;
        if (activeUser) {
          const messages = await PF.getMessages(activeUser);
          [...messages].reverse().forEach(m => appendMessage(m));
        }
      } catch {} finally { resyncing = false; }
    };

    messageUnsubscribe = await PF.subscribeMessages(async msg => {
      if (!msg || (msg.sender_id !== me.id && msg.receiver_id !== me.id)) return;

      const otherId = msg.sender_id === me.id ? msg.receiver_id : msg.sender_id;
      const isActiveConversation = Boolean(activeUser && activeUserId && otherId === activeUserId);
      const isOwnEcho = msg.sender_id === me.id;

      if (isActiveConversation) {
        // Text rows arrive with their content directly; voice rows carry metadata
        // in the companion table, so refresh the open thread to hydrate the audio.
        if (msg.content === "[voice]") await refreshOpenThread();
        else appendMessage({
          id: msg.id,
          sender_username: isOwnEcho ? me.username : activeUser,
          receiver_username: isOwnEcho ? activeUser : me.username,
          content: msg.content,
          created_at: msg.created_at
        });
      }

      try {
        await loadConversations();
        const active = conversations.find(c => c.username === activeUser);
        if (active?.userId) activeUserId = active.userId;
      } catch {}
    }, resyncThread);

    reactionUnsubscribe = await PF.subscribeMessageReactions(async evt => {
      const id = evt?.new?.message_id || evt?.old?.message_id;
      if (!id || !activeUser) return;
      try { await refreshOpenThread(); } catch {}
    });

    presence = await PF.subscribePresence(me.username, evt => {
      if (presence) presence.state = evt?.state || {};
      updateThreadPresence();
    });

    window.addEventListener("beforeunload", () => {
      try { messageUnsubscribe?.(); } catch {}
      try { presence?.unsubscribe?.(); } catch {}
      try { reactionUnsubscribe?.(); } catch {}
      clearTimeout(typingTimer);
      clearTimeout(typingStopTimer);
    });

    await loadConversations();
    input.disabled = true;
    status.textContent = "";

    const initialUser = PF.normalizeUsername(new URLSearchParams(location.search).get("u") || "");
    if (initialUser && initialUser !== me.username) {
      try {
        let profileConversation = conversations.find(c => c.username === initialUser);
        if (!profileConversation) {
          const profile = await PF.getProfile(initialUser);
          if (profile) {
            profileConversation = { username: profile.username, userId: profile.userId || "", displayName: profile.displayName || profile.username, avatar: profile.avatar || "", lastMessage: "Start a new conversation", updatedLabel: "", createdAt: "" };
            conversations.unshift(profileConversation);
            renderConversations();
          }
        }
        if (profileConversation) await openConversation(initialUser);
      } catch (e) { notify(e.message, "error"); }
    }
  }


  async function initAdmin() {
    const root = $("#adminRoot");
    if (!root) return;
    try {
      const ok = await PF.adminStatus();
      if (!ok) { root.innerHTML = `<div class="empty-state glass"><h2>Access denied</h2><p>This area is restricted to Rivo administrators.</p></div>`; return; }
      const build = (users, selected) => `<div class="admin-grid"><section class="admin-card glass"><div class="field"><span>Find account</span><input id="adminSearch" class="field-input" placeholder="username or display name" value="${esc(selected?.username || "")}"></div><div id="adminUsers"></div></section><section id="adminDetail" class="admin-card glass"><div class="empty-state"><h2>Select an account</h2><p>Choose a user from the list to inspect or moderate.</p></div></section></div>`;
      root.innerHTML = build([], null);
      const usersBox = $("#adminUsers");
      const detail = $("#adminDetail");
      let users = [];
      let selected = "";
      const drawUsers = () => {
        usersBox.innerHTML = users.length ? users.map(u => `<button class="admin-user-row ${selected===u.username?"selected":""}" type="button" data-admin-user="${esc(u.username)}">${avatarMarkup(u)}<span class="admin-user-copy"><b>${esc(u.displayName || u.username)}</b><small>@${esc(u.username)}</small></span>${u.is_banned ? `<span class="admin-badge banned">Banned</span>`:""}</button>`).join("") : `<div class="empty-state"><p>No accounts found.</p></div>`;
        $$('[data-admin-user]', root).forEach(btn => btn.onclick = () => selectUser(btn.dataset.adminUser));
      };
      const drawDetail = async username => {
        detail.innerHTML = `<div class="empty-state"><h2>Loading account</h2></div>`;
        const d = await PF.adminGetUserDetails(username);
        if (!d) { detail.innerHTML = `<div class="empty-state"><h2>User not found</h2></div>`; return; }
        const visitorRows = (d.visitors || []).length ? d.visitors.map(v => `<div class="visitor-row"><span>${esc(v.display_name || v.username)}</span><span>@${esc(v.username)} · ${esc(new Date(v.last_seen).toLocaleDateString())}</span></div>`).join("") : `<div class="empty-state"><p>No identified visitors yet.</p></div>`;
        detail.innerHTML = `<div class="admin-detail"><div class="admin-detail-head"><div><span class="eyebrow">ACCOUNT</span><h2 style="margin:5px 0 0">${esc(d.displayName || d.username)}</h2><div class="admin-detail-meta">@${esc(d.username)} · joined ${esc(new Date(d.created_at).toLocaleDateString())}</div></div><span class="admin-badge ${d.is_banned?'banned':''}">${d.is_banned?'Banned':'Active'}</span></div><div class="admin-stats"><div class="admin-stat"><span>Profile views</span><b>${esc(d.views)}</b></div><div class="admin-stat"><span>Profile likes</span><b>${esc(d.likes)}</b></div><div class="admin-stat"><span>Friends</span><b>${esc(d.friends)}</b></div><div class="admin-stat"><span>Coins</span><b>${esc(d.coins_balance ?? 0)}</b></div></div><section class="admin-edit-section"><div class="section-kicker">ACCOUNT EDIT</div><div class="form-grid"><label class="field"><span>Username</span><input id="adminUsername" class="field-input" value="${esc(d.username)}" maxlength="26"></label><label class="field"><span>Display name</span><input id="adminDisplayName" class="field-input" value="${esc(d.displayName || d.username)}" maxlength="80"></label></div><div class="form-grid"><label class="field"><span>Birth date</span><input id="adminBirthDate" class="field-input" type="date" value="${esc(d.birthDate || "")}" max="${new Date().toISOString().slice(0,10)}"></label><label class="field"><span>New password</span><div class="input-with-action"><input id="adminPassword" class="field-input" type="password" minlength="8" maxlength="28" placeholder="Set a new password"><button type="button" class="icon-btn field-eye" id="adminPasswordToggle" aria-label="Show password" title="Show password">◉</button></div></label></div><button class="btn btn-primary" id="adminSaveAccount">Save account</button><small class="muted">For security, the current password can never be displayed or recovered. Enter a new password to replace it.</small></section><section class="admin-edit-section"><div class="section-kicker">ECONOMY</div><div class="field"><span>Set account coin balance</span><div class="form-grid"><input id="adminCoins" class="field-input" type="text" inputmode="numeric" pattern="[0-9]*" value="${esc(d.coins_balance ?? 0)}" placeholder="0" autocomplete="off"></div><small class="muted">Admin-only. The balance is changed through a protected server RPC.</small></div><button class="btn btn-primary" id="adminSaveCoins">Save coin balance</button></section><div class="field"><span>Adjust public counters</span><div class="form-grid"><input id="adminViews" class="field-input" type="number" min="0" value="${esc(d.views)}" placeholder="Views"><input id="adminLikes" class="field-input" type="number" min="0" value="${esc(d.likes)}" placeholder="Likes"></div></div><div class="admin-actions"><button class="btn btn-primary" id="adminSaveStats">Save counters</button><button class="btn" id="adminToggleBan">${d.is_banned?'Unban account':'Block account'}</button><a class="btn" href="profile.html?u=${encodeURIComponent(d.username)}" target="_blank" rel="noreferrer">Open profile</a></div><section><div class="section-head"><div><div class="section-kicker">VISITORS</div><h3>Recent profile visitors</h3></div></div><div class="visitor-list">${visitorRows}</div></section><section class="admin-card danger-zone"><div class="section-kicker">DANGER ZONE</div><h3>Delete account permanently</h3><p class="muted">Removes the auth account and cascading profile data. This cannot be undone.</p><button class="btn btn-danger" id="adminDeleteUser">Delete ${esc(d.username)}</button></section></div>`;
        $("#adminSaveAccount").onclick = async () => { try { const result = await PF.adminUpdateUser(d.username, $("#adminUsername").value, $("#adminDisplayName").value, $("#adminPassword").value, $("#adminBirthDate")?.value || ""); notify(result?.passwordChanged ? "Account and password updated" : "Account updated", "success"); selected = result?.username || $("#adminUsername").value.trim().toLowerCase(); await loadUsers(""); await selectUser(selected); } catch(e) { notify(e.message || "Could not update account", "error"); } }; $("#adminPasswordToggle")?.addEventListener("click", () => { const i=$("#adminPassword"); if (!i) return; i.type=i.type==="password"?"text":"password"; $("#adminPasswordToggle").setAttribute("aria-label", i.type==="password"?"Show password":"Hide password"); });
        $("#adminSaveStats").onclick = async () => { try { await PF.adminSetStats(d.username, $("#adminViews").value, $("#adminLikes").value); notify("Counters updated", "success"); await selectUser(d.username); } catch(e) { notify(e.message,"error"); } };
        $("#adminSaveCoins").onclick = async () => { const input = $("#adminCoins"); const value = String(input?.value || "").trim(); if (!/^\d+$/.test(value)) { notify("Enter a valid coin amount", "error"); input?.focus(); return; } try { const result = await PF.adminSetCoins(d.username, value); notify("Coin balance updated", "success"); if (result?.coins_balance != null) { const fresh = $("#adminCoins"); if (fresh) fresh.value = String(result.coins_balance); } await selectUser(d.username); } catch(e) { notify(e.message || "Could not update coin balance", "error"); } };
        $("#adminToggleBan").onclick = async () => { try { await PF.adminSetBanned(d.username, !d.is_banned); notify(d.is_banned?"Account unblocked":"Account blocked", "success"); await selectUser(d.username); } catch(e) { notify(e.message,"error"); } };
        $("#adminDeleteUser").onclick = async () => { if (!confirm(`Delete @${d.username} permanently?`)) return; try { await PF.adminDeleteUser(d.username); notify("Account deleted", "success"); selected=""; users = users.filter(u=>u.username!==d.username); drawUsers(); detail.innerHTML = `<div class="empty-state"><h2>Account deleted</h2></div>`; } catch(e) { notify(e.message,"error"); } };
      };
      async function selectUser(username) { selected = username; drawUsers(); await drawDetail(username); }
      const loadUsers = async q => { try { users = await PF.adminListUsers(q, 120); drawUsers(); if (selected && users.some(u=>u.username===selected)) await drawDetail(selected); } catch(e) { notify(e.message,"error"); } };
      let timer=0; $("#adminSearch").addEventListener("input", () => { clearTimeout(timer); timer=setTimeout(()=>loadUsers($("#adminSearch").value),180); });
      await loadUsers("");
    } catch (e) { root.innerHTML = `<div class="empty-state glass"><h2>Admin unavailable</h2><p>${esc(e.message)}</p></div>`; }
  }

  async function initSettings() {
    const me = await PF.currentProfile(); if (!me) { location.href = "login.html"; return; }
    $("#settingsUsername") && ($("#settingsUsername").textContent = "@" + me.username);
    $("#settingsDisplay") && ($("#settingsDisplay").textContent = me.displayName || me.username); $("#settingsBirthDate") && ($("#settingsBirthDate").textContent = me.birthDate ? new Date(me.birthDate+"T00:00:00").toLocaleDateString(undefined,{year:"numeric",month:"long",day:"numeric"}) : "Not set");
    $("#settingsLogout")?.addEventListener("click", async () => { await PF.clearSession(); location.href = "../index.html"; });
    const select = $("#messagePrivacy");
    const save = $("#messagePrivacySave");
    const hint = $("#messagePrivacyHint");
    const callSelect = $("#callPrivacy");
    const callSave = $("#callPrivacySave");
    const callHint = $("#callPrivacyHint");
    const messageHint = v => v === "nobody"
      ? "Nobody can message you — not even friends. Your profile shows a \u201cMessages closed\u201d badge instead of a Message button."
      : v === "friends"
        ? "Only your accepted friends can message you."
        : "Anyone with a Rivo account can message you.";
    const currentSetting = me.messageSettings?.whoCanMessage === "friends" ? "friends"
      : me.messageSettings?.whoCanMessage === "nobody" ? "nobody" : "everyone";
    const currentCallSetting = me.callSettings?.whoCanCall === "friends" ? "friends"
      : me.callSettings?.whoCanCall === "nobody" ? "nobody" : "everyone";
    const callHintText = v => v === "nobody" ? "Nobody can start a voice or video call with you." : v === "friends" ? "Only your accepted friends can start a call with you." : "Anyone with a Rivo account can start a call with you.";
    const mode = localStorage.getItem("rivo_color_scheme") || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
    $("#themeDark") && ($("#themeDark").checked = mode === "dark");
    $("#themeLight") && ($("#themeLight").checked = mode === "light");
    $$('input[name="themeMode"]').forEach(r => r.addEventListener("change", () => { localStorage.setItem("rivo_color_scheme", r.value); document.documentElement.dataset.colorScheme = r.value; }));
    const lang = PF.currentLanguage ? PF.currentLanguage() : (localStorage.getItem("rivo_language") || "en");
    $("#langAr") && ($("#langAr").checked = lang === "ar");
    $("#langEn") && ($("#langEn").checked = lang === "en");
    $$('input[name="languageMode"]').forEach(r => r.addEventListener("change", () => {
      localStorage.setItem("rivo_language", r.value);
      PF.applySavedLanguage?.();
      applyNavLanguage();
      document.dispatchEvent(new CustomEvent("rivo:languagechange", { detail: { language: r.value } }));
      notify(r.value === "ar" ? "تم حفظ اللغة" : "Language saved", "success");
    }));
    const notifOn = $("#notifOn"), notifOff = $("#notifOff"), nsupport = $("#notificationSupport");
    if (notifOn && notifOff) {
      const syncNotifUI = () => {
        const enabled = PF.notificationsEnabled();
        notifOn.checked = enabled;
        notifOff.checked = !enabled;
        nsupport.textContent = lang === "ar"
          ? "الإشعارات داخل تطبيق Rivo فقط أثناء فتح التطبيق."
          : "In-app notifications only while Rivo is open.";
      };
      notifOn.addEventListener("change", () => {
        if (!notifOn.checked) return;
        PF.setNotificationsEnabled(true);
        syncNotifUI();
      });
      notifOff.addEventListener("change", () => {
        if (!notifOff.checked) return;
        PF.setNotificationsEnabled(false);
        syncNotifUI();
      });
      syncNotifUI();
      document.addEventListener("rivo:languagechange", syncNotifUI);
    }
    // Economy: live balance, transfer modal, and reward video.
    const balanceEl = $("#coinsBalance");
    const transferModal = $("#coinTransferModal");
    const transferForm = $("#coinTransferForm");
    const transferUser = $("#coinTransferUsername");
    const transferAmount = $("#coinTransferAmount");
    const refreshEconomy = async () => {
      try {
        const balance = await PF.getCoinBalance();
        if (balanceEl) balanceEl.textContent = Number(balance).toLocaleString();
      } catch (e) {
        if (balanceEl) balanceEl.textContent = "—";
      }
    };
    const openTransfer = () => { if (!transferModal) return; transferModal.classList.add("open"); transferModal.setAttribute("aria-hidden", "false"); transferUser?.focus(); };
    const closeTransfer = () => { if (!transferModal) return; transferModal.classList.remove("open"); transferModal.setAttribute("aria-hidden", "true"); transferForm?.reset(); };
    $("#openCoinTransfer")?.addEventListener("click", openTransfer); $("#closeCoinTransfer")?.addEventListener("click", closeTransfer);
    transferModal?.addEventListener("click", e => { if (e.target === transferModal) closeTransfer(); });
    document.addEventListener("keydown", e => { if (e.key === "Escape" && transferModal?.classList.contains("open")) closeTransfer(); });
    transferForm?.addEventListener("submit", async e => {
      e.preventDefault();
      try {
        const amount = Math.floor(Number(transferAmount?.value || 0));
        if (!PF.normalizeUsername(transferUser?.value || "")) throw new Error("اكتب اسم المستخدم المستلم");
        if (amount <= 0) throw new Error("المبلغ يجب أن يكون أكبر من صفر");
        const btn = $("#confirmCoinTransfer"); if (btn) { btn.disabled = true; btn.textContent = "جارٍ التحويل…"; }
        const result = await PF.transferCoinsByUsername(transferUser.value, amount);
        if (balanceEl) balanceEl.textContent = Number(result?.coins_balance ?? await PF.getCoinBalance()).toLocaleString();
        notify("تم تحويل العملات بنجاح", "success"); closeTransfer(); await refreshEconomy();
      } catch(e) { notify(e.message || "تعذر التحويل", "error"); }
      finally { const btn = $("#confirmCoinTransfer"); if (btn) { btn.disabled = false; btn.textContent = "تأكيد التحويل"; } }
    });
    let videoRewardState = null;
    let videoRewardBusy = false;
    const ensureVideoRewardModal = () => {
      if (videoRewardState) return videoRewardState;
      const modal = document.createElement("div");
      modal.className = "video-reward-modal";
      modal.hidden = true;
      modal.innerHTML = `
        <div class="video-reward-backdrop" data-video-close></div>
        <section class="video-reward-dialog" role="dialog" aria-modal="true" aria-label="فيديو المكافأة">
          <button type="button" class="video-reward-close" data-video-close aria-label="إغلاق">×</button>
          <div class="video-reward-stage">
            <video id="coinRewardVideo" playsinline controls preload="auto"></video>
            <button type="button" class="video-reward-play" id="coinRewardPlay" aria-label="تشغيل الفيديو">▶</button>
            <div id="coinRewardState" class="sr-only">جارٍ تجهيز الفيديو…</div>
            <span id="coinRewardTimer" class="sr-only">0:30</span>
          </div>
        </section>`;
      document.body.appendChild(modal);
      const video = modal.querySelector("#coinRewardVideo");
      videoRewardState = { modal, video, stateEl: modal.querySelector("#coinRewardState"), timerEl: modal.querySelector("#coinRewardTimer"), playBtn: modal.querySelector("#coinRewardPlay"), startedAt: 0 };
      videoRewardState.playBtn?.addEventListener("click", async () => {
        try {
          video.muted = false;
          video.volume = 1;
          videoRewardState.startedAt = Date.now();
          await video.play();
          videoRewardState.playBtn.hidden = true;
          videoRewardState.stateEl.textContent = "جاري المشاهدة • الصوت يعمل";
        } catch {
          videoRewardState.startedAt = 0;
          videoRewardState.stateEl.textContent = "تعذر تشغيل الفيديو، جرّب مرة أخرى";
        }
      });
      modal.querySelectorAll("[data-video-close]").forEach(x => x.addEventListener("click", () => closeVideoReward()));
      document.addEventListener("keydown", e => { if (e.key === "Escape" && !modal.hidden) closeVideoReward(); });
      return videoRewardState;
    };
    const closeVideoReward = () => {
      if (!videoRewardState) return;
      const { modal, video } = videoRewardState;
      video.pause(); video.removeAttribute("src"); video.load(); modal.hidden = true;
      document.body.classList.remove("video-reward-open");
    };
    const loadRewardVideoList = async () => {
      const fallback = ["a1.mp4", "a2.mp4"];
      try {
        const res = await fetch("../videos/manifest.json", { cache: "no-store" });
        if (!res.ok) throw new Error("manifest unavailable");
        const list = await res.json();
        const valid = Array.isArray(list)
          ? list.filter(x => typeof x === "string" && /\.(mp4|webm|ogg)$/i.test(x) && !x.includes("..") && !x.includes("/"))
          : [];
        if (valid.length) return valid;
      } catch {}
      return fallback;
    };
    const startVideoReward = async () => {
      const btn = $("#rewardAdCoins");
      if (videoRewardBusy) return;
      videoRewardBusy = true;
      const ui = ensureVideoRewardModal();
      let rewarded = false;
      let finished = false;
      let timer = null;
      let startedAt = 0;
      try {
        if (btn) { btn.disabled = true; btn.setAttribute("aria-busy", "true"); }
        const videos = await loadRewardVideoList();
        if (!videos.length) throw new Error("لا توجد فيديوهات صالحة داخل مجلد videos.");
        const randomFile = videos[Math.floor(Math.random() * videos.length)];
        const src = `../videos/${encodeURIComponent(randomFile)}`;
        const { modal, video, stateEl, timerEl, playBtn } = ui;
        if (playBtn) playBtn.hidden = false;
        stateEl.textContent = "شاهد الفيديو حتى النهاية";
        timerEl.textContent = "0:30";
        modal.hidden = false;
        document.body.classList.add("video-reward-open");
        video.src = src;
        video.muted = false;
        video.defaultMuted = false;
        video.volume = 1;
        video.currentTime = 0;
        video.addEventListener("loadedmetadata", () => {
          // Never play beyond 30s even when the source itself is longer.
          if (Number.isFinite(video.duration) && video.duration <= 30) timerEl.textContent = `0:${String(Math.ceil(video.duration)).padStart(2,"0")}`;
        }, { once: true });
        const finishReward = async () => {
          if (finished) return;
          finished = true;
          clearInterval(timer);
          video.pause();
          stateEl.textContent = "جاري إضافة المكافأة…";
          try {
            const result = await PF.rewardAdCoins(15);
            rewarded = true;
            if (balanceEl) balanceEl.textContent = Number(result?.coins_balance ?? await PF.getCoinBalance()).toLocaleString();
            notify(`+${Number(result?.reward || 15)} عملة`, "success");
            stateEl.textContent = "تمت إضافة المكافأة";
            setTimeout(closeVideoReward, 650);
          } catch (e) {
            stateEl.textContent = "تعذر إضافة المكافأة";
            notify(e.message || "تعذر إضافة مكافأة الإعلان", "error");
            setTimeout(closeVideoReward, 800);
          }
        };
        const onTimeUpdate = () => {
          const elapsed = Math.min(30, Math.max(0, video.currentTime));
          const remaining = Math.max(0, Math.ceil(30 - elapsed));
          timerEl.textContent = `0:${String(remaining).padStart(2,"0")}`;
          if (video.currentTime >= 30) finishReward();
        };
        const onEnded = () => finishReward();
        const onError = () => { if (!finished) { finished = true; notify("تعذر تشغيل هذا الفيديو.", "error"); closeVideoReward(); } };
        video.addEventListener("timeupdate", onTimeUpdate);
        video.addEventListener("ended", onEnded, { once: true });
        video.addEventListener("error", onError, { once: true });
        // Do not autoplay. The 30s watch window starts only when the user presses Play.
        video.controls = true;
        if (ui.playBtn) ui.playBtn.hidden = false;
        stateEl.textContent = "اضغط تشغيل لبدء الفيديو";
        timer = setInterval(() => {
          if (finished) return;
          const startedAt = Number(ui.startedAt || 0);
          if (startedAt && (video.currentTime >= 30 || (Date.now() - startedAt >= 30000 && !video.paused))) finishReward();
        }, 250);
      } catch (e) {
        if (!rewarded) closeVideoReward();
        notify(e.message || "تعذر تشغيل فيديو المكافأة", "error");
      } finally {
        // Keep the CTA disabled for the entire active reward session; closing the modal releases it.
        if (!videoRewardState || videoRewardState.modal.hidden) {
          videoRewardBusy = false;
          if (btn) { btn.disabled = false; btn.removeAttribute("aria-busy"); }
        }
      }
    };
    $("#rewardAdCoins")?.addEventListener("click", startVideoReward);
    await refreshEconomy();
    if (!window.__rivoEconomyTimer) window.__rivoEconomyTimer = setInterval(() => refreshEconomy(), 15000);

    try { const isAdmin = await PF.adminStatus(); $$("[data-admin-link]").forEach(a => a.classList.toggle("hidden", !isAdmin)); } catch {}
    if (select) select.value = currentSetting;
    if (hint) hint.textContent = messageHint(currentSetting);
    if (callSelect) callSelect.value = currentCallSetting;
    if (callHint) callHint.textContent = callHintText(currentCallSetting);
    callSelect?.addEventListener("change", () => { if (callHint) callHint.textContent = callHintText(callSelect.value); });
    save?.addEventListener("click", async () => {
      try {
        save.disabled = true;
        save.textContent = "Saving…";
        const v = await PF.setMessageSetting(select.value);
        hint.textContent = messageHint(v);
        notify("Message privacy saved", "success");
      } catch (e) { notify(e.message, "error"); }
      finally { save.disabled = false; save.textContent = "Save message privacy"; }
    });
    callSave?.addEventListener("click", async () => {
      try { callSave.disabled=true; callSave.textContent="Saving…"; const v=await PF.setCallSetting(callSelect.value); if(callHint) callHint.textContent=callHintText(v); notify("Call privacy saved","success"); }
      catch(e){ notify(e.message,"error"); }
      finally { callSave.disabled=false; callSave.textContent="Save call privacy"; }
    });
  }
  const POST_REACTIONS = ["❤️","😂","👍","😮","😢"];
  function formatSocialTime(value){
    const d=new Date(value); if(Number.isNaN(d.getTime())) return "";
    const diff=Math.max(0,Date.now()-d.getTime()), mins=Math.floor(diff/60000), hrs=Math.floor(mins/60), days=Math.floor(hrs/24);
    return mins<1?"now":mins<60?`${mins}m`:hrs<24?`${hrs}h`:days<7?`${days}d`:d.toLocaleDateString(undefined,{month:"short",day:"numeric"});
  }
  function profileMini(author){
    return author?.avatar ? `<img class="avatar-sm" src="${esc(author.avatar)}" alt="">` : `<span class="avatar-sm avatar-fallback">${esc((author?.displayName||author?.username||"U").slice(0,2).toUpperCase())}</span>`;
  }
  function reactionSummary(post){
    const r=post.reactions||{};
    return POST_REACTIONS.map(x=>({x,n:Number(r[x]||0)})).filter(x=>x.n>0).map(x=>`<span class="reaction-chip">${x.x} ${x.n}</span>`).join("");
  }
  function ensurePostImageViewer(){
    let box=document.querySelector("[data-post-image-viewer]");
    if(box) return box;
    box=document.createElement("div");
    box.className="post-image-viewer";
    box.setAttribute("data-post-image-viewer","");
    box.innerHTML=`<button type="button" class="post-image-viewer-close" data-post-image-close aria-label="Close image">×</button><div class="post-image-viewer-backdrop" data-post-image-close></div><div class="post-image-viewer-stage" data-post-image-stage><img class="post-image-viewer-image" data-post-image-viewer-img alt="Post image"></div><div class="post-image-viewer-controls" role="group" aria-label="Image zoom"><button type="button" data-post-zoom-out aria-label="Zoom out">−</button><button type="button" data-post-zoom-reset aria-label="Reset zoom">1×</button><button type="button" data-post-zoom-in aria-label="Zoom in">+</button></div>`;
    document.body.appendChild(box);
    const stage=box.querySelector("[data-post-image-stage]"), img=box.querySelector("[data-post-image-viewer-img]");
    let scale=1,tx=0,ty=0,pinchStartDist=0,pinchStartScale=1,panStartX=0,panStartY=0,startTx=0,startTy=0;
    const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
    const apply=()=>{img.style.transform=`translate3d(${tx}px,${ty}px,0) scale(${scale})`;box.querySelector('[data-post-zoom-reset]').textContent=`${Number(scale.toFixed(1))}×`;};
    const reset=()=>{scale=1;tx=0;ty=0;apply();};
    const setScale=(next,anchorX=0,anchorY=0)=>{const old=scale;scale=clamp(next,1,4);if(scale===1){tx=0;ty=0;}else if(old!==scale){const ratio=scale/old;tx=anchorX-(anchorX-tx)*ratio;ty=anchorY-(anchorY-ty)*ratio;}apply();};
    const close=()=>{box.classList.remove("open");img.removeAttribute("src");reset();document.body.classList.remove("image-viewer-open");};
    box.querySelectorAll("[data-post-image-close]").forEach(b=>b.addEventListener("click",close));
    box.querySelector("[data-post-zoom-in]").addEventListener("click",()=>setScale(scale+0.5));
    box.querySelector("[data-post-zoom-out]").addEventListener("click",()=>setScale(scale-0.5));
    box.querySelector("[data-post-zoom-reset]").addEventListener("click",reset);
    stage.addEventListener("wheel",e=>{if(!box.classList.contains("open"))return;e.preventDefault();const r=stage.getBoundingClientRect();setScale(scale+(e.deltaY<0?.25:-.25),e.clientX-r.left-r.width/2,e.clientY-r.top-r.height/2);},{passive:false});
    stage.addEventListener("dblclick",e=>{const r=stage.getBoundingClientRect();setScale(scale>1?1:2,e.clientX-r.left-r.width/2,e.clientY-r.top-r.height/2);});
    stage.addEventListener("touchstart",e=>{if(e.touches.length===2){const a=e.touches[0],b=e.touches[1];pinchStartDist=Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);pinchStartScale=scale;return;}if(e.touches.length===1&&scale>1){const t=e.touches[0];panStartX=t.clientX;panStartY=t.clientY;startTx=tx;startTy=ty;}},{passive:true});
    stage.addEventListener("touchmove",e=>{if(e.touches.length===2&&pinchStartDist){e.preventDefault();const a=e.touches[0],b=e.touches[1],d=Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);setScale(pinchStartScale*d/pinchStartDist);return;}if(e.touches.length===1&&scale>1){e.preventDefault();const t=e.touches[0];tx=startTx+t.clientX-panStartX;ty=startTy+t.clientY-panStartY;apply();}},{passive:false});
    stage.addEventListener("touchend",e=>{if(e.touches.length<2)pinchStartDist=0;});
    document.addEventListener("keydown",e=>{if(e.key==="Escape"&&box.classList.contains("open"))close();});
    box._resetZoom=reset;
    return box;
  }
  function openPostImageViewer(url){if(!url)return;const box=ensurePostImageViewer(),img=box.querySelector("[data-post-image-viewer-img]");box._resetZoom?.();img.src=url;box.classList.add("open");document.body.classList.add("image-viewer-open");}
  function ensurePostCommentsModal(){
    let modal=document.querySelector("[data-post-comments-modal]");
    if(modal)return modal;
    modal=document.createElement("div");modal.className="post-comments-modal";modal.setAttribute("data-post-comments-modal","");
    modal.innerHTML=`<div class="post-comments-modal-backdrop" data-comments-close></div><section class="post-comments-sheet" role="dialog" aria-modal="true" aria-label="Comments"><header class="post-comments-head"><div><b>Comments</b><small data-comments-count>0 comments</small></div><button type="button" class="icon-btn" data-comments-close aria-label="Close comments">×</button></header><div class="post-comments-scroll" data-comments-scroll><div class="message-list-empty">Loading comments…</div></div><form class="post-comments-compose" data-comments-form><input class="field-input" data-comments-input maxlength="2000" placeholder="Write a comment…" autocomplete="off" required><button class="btn btn-sm btn-primary" type="submit">Send</button></form></section>`;
    document.body.appendChild(modal);
    const close=()=>{modal.classList.remove("open");document.body.classList.remove("comments-modal-open");modal._postId=null;};
    modal.querySelectorAll("[data-comments-close]").forEach(el=>el.addEventListener("click",close));
    modal.querySelector("[data-comments-form]").addEventListener("submit",async e=>{e.preventDefault();const input=modal.querySelector("[data-comments-input]"),postId=modal._postId,value=input.value.trim();if(!value||!postId)return;const send=modal.querySelector("[data-comments-form] button");send.disabled=true;try{await PF.commentPost(postId,value);input.value="";await loadPostCommentsModal(modal,postId,true);}catch(err){notify(err.message||"Could not add comment","error");}finally{send.disabled=false;input.focus();}});
    document.addEventListener("keydown",e=>{if(e.key==="Escape"&&modal.classList.contains("open"))close();});
    return modal;
  }
  async function loadPostCommentsModal(modal,postId,keepBottom=false){
    const scroll=modal.querySelector("[data-comments-scroll]"),count=modal.querySelector("[data-comments-count]");scroll.innerHTML=`<div class="message-list-empty">Loading comments…</div>`;
    try{const post=await PF.getPost(postId),comments=Array.isArray(post?.comments)?post.comments:[];count.textContent=`${comments.length} ${comments.length===1?"comment":"comments"}`;scroll.innerHTML=comments.length?comments.map(c=>`<div class="comment comment-modal-item">${identityLink(c.author,profileMini(c.author),"comment-avatar-link")}<div class="comment-bubble"><div class="comment-meta-line">${identityLink(c.author,`<b>${esc(c.author?.displayName||c.author?.username||"User")}</b>`)}<span>${formatSocialTime(c.created_at)}</span></div><p>${esc(c.content)}</p></div></div>`).join(""):`<div class="comments-empty"><strong>No comments yet.</strong><span>Start the conversation.</span></div>`;if(keepBottom)scroll.scrollTop=scroll.scrollHeight;}catch(err){scroll.innerHTML=`<div class="message-list-empty">${esc(err.message||"Could not load comments")}</div>`;}
  }
  async function openPostCommentsModal(postId){if(!postId)return;const modal=ensurePostCommentsModal();modal._postId=postId;modal.classList.add("open");document.body.classList.add("comments-modal-open");const input=modal.querySelector("[data-comments-input]");await loadPostCommentsModal(modal,postId,false);requestAnimationFrame(()=>input?.focus());}
  function renderPostCard(post){
    const author=post.author||{}; const medias=Array.isArray(post.media)?post.media:[];
    const myReaction=post.my_reaction||null; const reposted=!!post.reposted_by_me;
    const repNames=Array.isArray(post.reposter_names)?post.reposter_names:[];
    const mediaHtml=medias.length?`<div class="post-media count-${Math.min(5,medias.length)}">${medias.slice(0,5).map((m,i)=>`<button type="button" class="post-media-thumb" data-post-image="${esc(m.url)}" aria-label="Open image ${i+1}"><img src="${esc(m.url)}" alt="" loading="lazy"></button>`).join("")}</div>`:"";
    const note=post.profile_reposted?`<div class="repost-note">↻ Reposted to this profile</div>`:repNames.length?`<div class="repost-note">↻ Reposted by <b>${esc(repNames[0].displayName||repNames[0].username)}</b>${repNames.length>1?` and ${repNames.length-1} more`:""}</div>`:"";
    const primaryReaction=myReaction||"👍";
    const reactionTotal=POST_REACTIONS.reduce((sum,r)=>sum+Number((post.reactions||{})[r]||0),0);
    const primaryCount=myReaction?Number((post.reactions||{})[myReaction]||0):reactionTotal;
    const reactionPicker=POST_REACTIONS.map(r=>`<button type="button" class="post-reaction-option ${myReaction===r?'active':''}" data-post-react="${esc(r)}" aria-label="React ${esc(r)}">${r}</button>`).join("");
    const reactionKinds=POST_REACTIONS.map(r=>({r,n:Number((post.reactions||{})[r]||0)})).filter(x=>x.n>0);
    const reactionKindsTotal=reactionKinds.reduce((sum,x)=>sum+x.n,0);
    const reactionSummaryHtml=reactionKindsTotal
      ? `<div class="post-reaction-summary" aria-label="${reactionKindsTotal} reactions"><span class="post-reaction-emojis">${reactionKinds.slice(0,5).map(x=>`<span>${x.r}</span>`).join("")}</span><b>${reactionKindsTotal}</b></div>`
      : `<div class="post-reaction-summary empty" aria-hidden="true"></div>`;
    const iconComment=`<svg class="post-action-icon post-action-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H8l-4 2v-4.1A7.5 7.5 0 1 1 20 11.5Z"/><path d="M8 11.5h8M8 15h5"/></svg>`;
    const iconReport=`<svg class="post-action-icon post-action-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 21V4"/><path d="M6 5h11l-2.5 3L17 11H6"/></svg>`;
    const iconRepost=`<svg class="post-action-icon post-action-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 7h10a3 3 0 0 1 3 3v1"/><path d="m16 4 3 3-3 3"/><path d="M18 17H8a3 3 0 0 1-3-3v-1"/><path d="m8 20-3-3 3-3"/></svg>`;
    const reactButtons=`<div class="post-reaction-picker-wrap" data-reaction-wrap><button type="button" class="post-like-button ${myReaction?'liked':''}" data-post-like aria-label="${myReaction?'Change or remove reaction':'Like post'}"><span class="post-like-icon">${myReaction||"👍"}</span></button><div class="post-reaction-picker" data-post-reaction-picker aria-hidden="true">${reactionPicker}</div></div>`;
    const isOwner = !!author?.username && PF.normalizeUsername(author.username) === PF.normalizeUsername(PF.currentUsername() || "");
    const reportAction = !isOwner ? `<button type="button" class="post-action post-report-action" data-post-report aria-label="Report post">${iconReport}</button>` : ``;
    const actionCells = `${reactButtons ? `<div class="post-like-slot">${reactButtons}</div>` : ``}<button type="button" class="post-action" data-post-comments aria-label="Comments">${iconComment}</button>${reportAction}<button type="button" class="post-action ${reposted?'active':''}" data-post-repost aria-label="Repost">${iconRepost}</button>`;
    return `<article class="post-card glass" data-post-id="${esc(post.id)}"><div class="post-main"><div class="post-author">${identityLink(author, profileMini(author), "post-author-avatar-link")}<div class="post-author-copy">${identityLink(author, `<span><b>${esc(author.displayName||author.username||"User")}</b><small>@${esc(author.username||"")}</small></span>`)}</div><span class="post-author-meta">${formatSocialTime(post.created_at)}</span></div>${note}<div class="post-content">${esc(post.content||"")}</div>${mediaHtml}<div class="post-engagement"><div class="post-engagement-summary">${reactionSummaryHtml}<div class="post-engagement-counts"><span>${Number(post.comments_count||0)} comments</span><span>${Number(post.reposts_count||0)} reposts</span></div></div><div class="post-actions">${actionCells}</div></div></div><div class="post-comments hidden"></div></article>`;
  }

  async function renderPostComments(card, postId){await openPostCommentsModal(postId);}
  function bindPostCard(card, post){
    card.querySelectorAll('[data-post-image]').forEach(btn=>btn.addEventListener('click',e=>{e.preventDefault();openPostImageViewer(btn.dataset.postImage||"");}));
    const reactionWrap=card.querySelector('[data-reaction-wrap]');
    const likeBtn=card.querySelector('[data-post-like]');
    const picker=card.querySelector('[data-post-reaction-picker]');
    const closePicker=()=>{if(!picker)return;picker.classList.remove('open');picker.setAttribute('aria-hidden','true');picker.style.position='';picker.style.left='';picker.style.right='';picker.style.top='';picker.style.bottom='';picker.style.transform='';picker.style.transformOrigin='';};
    const positionReactionPicker=()=>{
      if(!picker || !picker.classList.contains('open')) return;
      const trigger=likeBtn?.getBoundingClientRect();
      if(!trigger) return;
      picker.style.position='fixed';
      picker.style.left='0px';
      picker.style.right='auto';
      picker.style.bottom='auto';
      picker.style.transform='none';
      const pr=picker.getBoundingClientRect();
      const gap=10;
      const margin=8;
      const centerX=trigger.left + trigger.width/2;
      const left=Math.max(margin, Math.min(centerX-pr.width/2, window.innerWidth-pr.width-margin));
      const top=Math.max(margin, trigger.top-pr.height-gap);
      picker.style.setProperty('left', `${Math.round(left)}px`, 'important');
      picker.style.setProperty('top', `${Math.round(top)}px`, 'important');
      picker.style.setProperty('right', 'auto', 'important');
      picker.style.setProperty('bottom', 'auto', 'important');
      picker.style.setProperty('transform', 'scale(1)', 'important');
      picker.style.setProperty('transform-origin', 'center bottom', 'important');
    };
    const openPicker=()=>{
      if(!picker)return;
      picker.classList.add('open');
      picker.setAttribute('aria-hidden','false');
      requestAnimationFrame(positionReactionPicker);
    };
    let pressTimer=null, longPress=false;
    const clearPress=()=>{if(pressTimer){clearTimeout(pressTimer);pressTimer=null;}};
    likeBtn?.addEventListener('pointerdown',()=>{
      longPress=false;
      clearPress();
      pressTimer=setTimeout(()=>{pressTimer=null;longPress=true;openPicker();},430);
    });
    ["pointerup","pointercancel","pointerleave"].forEach(type=>likeBtn?.addEventListener(type,clearPress));
    likeBtn?.addEventListener('contextmenu',e=>{e.preventDefault();openPicker();});
    window.addEventListener('resize',()=>{
      if(!picker || !picker.classList.contains('open')) return;
      positionReactionPicker();
    });
    // Keep the picker fixed in the viewport while scrolling; only dismiss it
    // once the originating Like button has moved sufficiently far off-screen.
    window.addEventListener('scroll',()=>{
      if(!picker || !picker.classList.contains('open')) return;
      const trigger=likeBtn?.getBoundingClientRect();
      if(!trigger) return;
      const offscreenMargin=96;
      if(trigger.bottom < -offscreenMargin || trigger.top > window.innerHeight + offscreenMargin){
        closePicker();
      }
    }, {passive:true});
    likeBtn?.addEventListener('click',async e=>{
      if(longPress){longPress=false;return;}
      if(!PF.currentUsername()){location.href='login.html';return;}
      closePicker();
      try{await PF.reactPost(post.id,myReaction||"👍");await refreshPostCard(post.id)}catch(err){notify(err.message,'error')}
    });
    card.querySelectorAll('[data-post-react]').forEach(btn=>btn.addEventListener('click',async e=>{
      e.stopPropagation();
      if(!PF.currentUsername()){location.href='login.html';return}
      try{await PF.reactPost(post.id,btn.dataset.postReact);closePicker();await refreshPostCard(post.id)}catch(err){notify(err.message,'error')}
    }));
    document.addEventListener('click',e=>{if(reactionWrap&&!reactionWrap.contains(e.target))closePicker();},{once:false});
    card.querySelector('[data-post-comments]')?.addEventListener('click',async()=>{await renderPostComments(card,post.id)});
    card.querySelector('[data-post-repost]')?.addEventListener('click',async()=>{if(!PF.currentUsername()){location.href='login.html';return}try{await PF.repostPost(post.id);await refreshPostCard(post.id)}catch(e){notify(e.message,'error')}});
    card.querySelector('[data-post-report]')?.addEventListener('click',async()=>{
      if(!PF.currentUsername()){location.href='login.html';return}
      if(!window.confirm('Report this post?')) return;
      try { const result = await PF.reportPost(post.id); notify(result?.deleted ? 'Post removed after reaching the report limit.' : 'Report submitted.', 'success'); if(result?.deleted) card.remove(); }
      catch(e){ notify(e.message||'Could not report post','error'); }
    });
    card.querySelector('[data-post-delete]')?.addEventListener('click',async()=>{
      if(!PF.currentUsername()) return;
      if(!window.confirm('Delete this post? This cannot be undone.')) return;
      try{
        await PF.deletePost(post.id);
        card.remove();
        const feed=card.closest('#postFeed,.post-feed');
        if(feed && !feed.querySelector('[data-post-id]')) await renderPostFeed(feed);
        notify('Post deleted','success');
      }catch(e){notify(e.message || 'Could not delete post','error')}
    });
  }

  async function refreshPostCard(id){
    const old=document.querySelector(`[data-post-id="${CSS.escape(String(id))}"]`); if(!old)return;
    const wasOpen=old.querySelector('.post-comments')&&!old.querySelector('.post-comments').classList.contains('hidden');
    const fresh=await PF.getPost(id); if(!fresh)return;
    old.outerHTML=renderPostCard(fresh); const n=document.querySelector(`[data-post-id="${CSS.escape(String(id))}"]`); if(n){bindPostCard(n,fresh); if(wasOpen) await renderPostComments(n,id)}
  }
  async function renderPostFeed(box, username=null, {allowCompose=false}={}){
    if(!box)return; box.innerHTML=`<div class="empty-state glass"><p>Loading posts…</p></div>`;
    try{const posts=await PF.listPosts(username,50,0);if(!posts.length){box.innerHTML=`<div class="empty-state glass"><h2>No posts yet</h2><p>${username?"This profile has not shared anything yet.":"Be the first to share something."}</p></div>`;return}box.innerHTML=posts.map(renderPostCard).join('');[...box.querySelectorAll('[data-post-id]')].forEach((c,i)=>bindPostCard(c,posts[i]));}catch(e){box.innerHTML=`<div class="empty-state glass"><h2>Feed unavailable</h2><p>${esc(e.message)}</p></div>`}
  }
  function renderComposer(me){return `<div class="composer-head">${profileMini({avatar:me.avatar,displayName:me.displayName,username:me.username})}<div class="composer-copy"><b>${esc(me.displayName||me.username)}</b><span>Public post · up to 5 images</span></div></div><textarea id="postText" class="post-textarea" maxlength="5000" placeholder="What are you thinking about?"></textarea><div id="postMediaPreview" class="media-preview-row"></div><div class="composer-bottom"><div class="composer-tools"><label class="btn btn-sm" for="postImagePicker">▧ Add photos</label><input id="postImagePicker" type="file" accept="image/*" multiple hidden><span id="postImageCount" class="composer-hint">0/5 photos</span></div><button id="publishPost" class="btn btn-sm btn-primary">Publish</button></div>`}
  async function initPostsPage(){
    const composer=$('#postComposer'),feed=$('#postFeed'); const me=await PF.currentProfile().catch(()=>null);
    if(composer){if(me){composer.innerHTML=renderComposer(me);let media=[];const picker=$('#postImagePicker'),preview=$('#postMediaPreview'),count=$('#postImageCount');const paint=()=>{preview.innerHTML=media.map((m,i)=>`<div><img src="${esc(m.url)}"><button type="button" data-remove-media="${i}">×</button></div>`).join('');count.textContent=`${media.length}/5 photos`;preview.querySelectorAll('[data-remove-media]').forEach(b=>b.onclick=()=>{media.splice(Number(b.dataset.removeMedia),1);paint()})};picker?.addEventListener('change',async e=>{const files=[...(e.target.files||[])];if(files.length+media.length>5){notify('Maximum 5 images per post','error');return}for(const f of files){try{media.push(await PF.uploadPostImage(f))}catch(err){notify(err.message,'error')}}paint();picker.value=''});$('#publishPost')?.addEventListener('click',async()=>{const text=$('#postText').value.trim();if(!text&&!media.length){notify('Write something or add a photo','error');return}try{$('#publishPost').disabled=true;await PF.createPost(text,media);$('#postText').value='';media=[];paint();notify('Post published','success');await renderPostFeed(feed)}catch(e){notify(e.message,'error')}finally{$('#publishPost').disabled=false}})}else composer.innerHTML=`<div class="empty-state"><h2>Join the conversation</h2><p>Sign in to create posts and interact.</p><a class="btn btn-primary" href="login.html">Sign in</a></div>`}
    await renderPostFeed(feed);
  }
  function communityAvatar(c, sizeClass="community-avatar"){
    const fallback=esc((c?.name||"R").trim().slice(0,1).toUpperCase());
    return c?.image_url
      ? `<span class="${sizeClass}"><img src="${esc(c.image_url)}" alt=""></span>`
      : `<span class="${sizeClass} community-avatar-fallback">${fallback}</span>`;
  }
  function communityCard(c){
    const owner=!!c?.owner?.username && PF.normalizeUsername(c.owner.username)===PF.normalizeUsername(PF.currentUsername()||"");
    const button=c.is_member
      ? `<button class="btn btn-sm btn-primary" data-open-community="${esc(c.id)}">Open chat</button>`
      : c.request_pending
        ? `<span class="relationship-badge request-state">Request pending</span>`
        : `<button class="btn btn-sm btn-primary" data-join-community="${esc(c.id)}">${c.join_policy==='request'?'Request to join':'Join community'}</button>`;
    const policy=c.join_policy==='friends'?'Friends of owner':c.join_policy==='request'?'Approval required':'Open to everyone';
    const deleteBtn=owner?`<button type="button" class="btn btn-sm btn-danger" data-delete-community="${esc(c.id)}">Delete</button>`:"";
    return `<article class="community-card glass" data-community-card="${esc(c.id)}"><div class="community-card-head">${communityAvatar(c)}<div class="community-card-copy"><h3>${esc(c.name)}</h3><span class="community-meta">${Number(c.members_count||0)} members · ${esc(policy)}</span></div></div><p>${esc(c.description||'A new Rivo community.')}</p><div class="community-actions">${button}${deleteBtn}</div></article>`;
  }
  async function openCommunityRoom(id){
    const room=$('#communityRoom');
    if(!room)return;
    const c=await PF.getCommunity(id);
    if(!c?.is_member){room.classList.add('hidden');return;}
    const me=PF.currentUsername();
    room.classList.remove('hidden');
    const owner=!!c?.owner?.username && PF.normalizeUsername(c.owner.username)===PF.normalizeUsername(me||"");
    room.innerHTML=`<div class="room-head"><div class="room-title"><div class="room-title-line">${communityAvatar(c,"room-avatar")}<div><h2>${esc(c.name)}</h2><p>${esc(c.description||'Community chat')} · ${Number(c.members_count||0)} members</p></div></div></div><div class="room-head-actions"><button class="icon-btn room-mobile-back" id="backToCommunityList" type="button" aria-label="Back to communities">‹</button>${owner?`<button class="btn btn-sm btn-danger" id="deleteCommunityFromRoom" type="button">Delete</button>`:''}<button class="icon-btn room-close-desktop" id="closeCommunityRoom" type="button" aria-label="Close">×</button></div></div><div class="room-body"><div class="room-chat"><div id="roomMessages" class="room-messages"></div><form id="roomCompose" class="room-compose"><input id="roomInput" class="field-input" maxlength="2000" placeholder="Message everyone…"><button class="btn btn-sm btn-primary">Send</button></form></div><aside class="room-sidebar"><h3>Members</h3><div id="memberList" class="member-list"></div><div id="requestListCommunity" class="request-list"></div></aside></div>`;
    let stopCommunityRealtime=async()=>{};
    const closeRoom=async()=>{await stopCommunityRealtime();room.classList.add('hidden');document.body.classList.remove('community-chat-open');history.replaceState(null,'','communities.html');};
    $('#closeCommunityRoom')?.addEventListener('click',closeRoom);
    $('#backToCommunityList')?.addEventListener('click',closeRoom);
    const deleteCommunity=async()=>{
      if(!owner) return;
      if(!window.confirm(`Delete community "${c.name}"? This cannot be undone.`)) return;
      try{await PF.deleteCommunity(id);notify('Community deleted','success');await closeRoom();location.reload()}catch(e){notify(e.message||'Could not delete community','error')}
    };
    $('#deleteCommunityFromRoom')?.addEventListener('click',deleteCommunity);
    document.body.classList.add('community-chat-open');
    const draw=async()=>{
      const msgs=await PF.getCommunityMessages(id);
      $('#roomMessages').innerHTML=msgs.map(m=>`<div class="room-message ${m.author?.username===me?'mine':''}">${m.author?.username!==me?identityLink(m.author, profileMini(m.author), "room-avatar-link"):''}<div class="room-bubble">${identityLink(m.author, `<b>${esc(m.author?.displayName||m.author?.username||'User')}</b>`)}<p>${esc(m.content)}</p></div></div>`).join('')||`<div class="message-list-empty">No messages yet.</div>`;
      const box=$('#roomMessages'); if(box) box.scrollTop=box.scrollHeight;
    };
    await draw();
    stopCommunityRealtime=await PF.subscribeCommunityMessages(id,async()=>{try{await draw()}catch{}});
    $('#roomCompose').addEventListener('submit',async e=>{e.preventDefault();const input=$('#roomInput');if(!input.value.trim())return;try{await PF.sendCommunityMessage(id,input.value);input.value='';await draw()}catch(err){notify(err.message,'error')}});
    const members=await PF.listCommunityMembers(id);
    $('#memberList').innerHTML=members.map(m=>`<div class="member-row">${identityLink(m, profileMini(m), "member-avatar-link")}<div class="member-copy">${identityLink(m, `<b>${esc(m.displayName||m.username)}</b>`)}<span>${m.role==='owner'?'Owner':'Member'}</span></div>${owner&&m.role!=='owner'?`<button class="btn btn-sm member-kick" data-kick-member="${esc(m.username)}">Remove</button>`:''}</div>`).join('');
    $('#memberList').querySelectorAll('[data-kick-member]').forEach(b=>b.onclick=async()=>{try{await PF.kickCommunityMember(id,b.dataset.kickMember);await openCommunityRoom(id);notify('Member removed','success')}catch(e){notify(e.message,'error')}});
    if(owner){
      const req=await PF.listCommunityRequests(id);
      const reqBox=$('#requestListCommunity');
      reqBox.innerHTML=req.length?`<h3>Join requests</h3>${req.map(r=>`<div class="member-row"><div class="member-copy"><b>${esc(r.displayName||r.username)}</b><span>@${esc(r.username)}</span></div><button class="btn btn-sm" data-req-accept="${esc(r.username)}">✓</button><button class="btn btn-sm btn-danger" data-req-decline="${esc(r.username)}">×</button></div>`).join('')}`:'';
      reqBox.querySelectorAll('[data-req-accept]').forEach(b=>b.onclick=async()=>{try{await PF.respondCommunityRequest(id,b.dataset.reqAccept,true);await openCommunityRoom(id)}catch(e){notify(e.message,'error')}});
      reqBox.querySelectorAll('[data-req-decline]').forEach(b=>b.onclick=async()=>{try{await PF.respondCommunityRequest(id,b.dataset.reqDecline,false);await openCommunityRoom(id)}catch(e){notify(e.message,'error')}});
    }
  }

  async function initCommunitiesPage(){
    const list=$('#communityList'),create=$('#newCommunityBtn'),search=$('#communitySearch'),limitEl=$('#communityCreateLimit');
    const me=await PF.currentProfile().catch(()=>null);
    let communities=[];
    let myCount=0;
    const updateCreateState=()=>{
      const atLimit=myCount>=3;
      if(create){
        create.classList.toggle('hidden',!me);
        create.disabled=atLimit;
        create.setAttribute('aria-disabled',String(atLimit));
        create.title=atLimit?'You can create up to 3 communities':'Create community';
      }
      if(limitEl && me){
        limitEl.textContent=`Your communities: ${Math.min(myCount,3)}/3`;
        limitEl.classList.remove('hidden');
        limitEl.classList.toggle('limit-reached',atLimit);
      }
    };
    if(me){
      try{myCount=await PF.myCommunityCount();}
      catch{myCount=0;}
    }
    updateCreateState();
    create?.addEventListener('click',()=>{if(myCount>=3){notify('You can create up to 3 communities.','error');return}openCommunityCreateModal()});
    const renderList=()=>{
      const term=String(search?.value||'').trim().toLowerCase();
      const filtered=term?communities.filter(c=>String(c?.name||'').toLowerCase().includes(term)):communities;
      list.innerHTML=filtered.length?filtered.map(communityCard).join(''):(term?`<div class="empty-state glass"><h2>No matching communities</h2><p>Try another name.</p></div>`:`<div class="empty-state glass"><h2>No communities yet</h2><p>Create the first one.</p></div>`);
      list.querySelectorAll('[data-join-community]').forEach(b=>b.onclick=async()=>{if(!PF.currentUsername()){location.href='login.html';return}try{const c=await PF.joinCommunity(b.dataset.joinCommunity);if(c?.is_member) await openCommunityRoom(b.dataset.joinCommunity);await draw()}catch(e){notify(e.message,'error')}});
      list.querySelectorAll('[data-open-community]').forEach(b=>b.onclick=async()=>{try{await openCommunityRoom(b.dataset.openCommunity)}catch(e){notify(e.message,'error')}});
      list.querySelectorAll('[data-delete-community]').forEach(b=>b.onclick=async()=>{
        if(!window.confirm('Delete this community? This cannot be undone.')) return;
        try{await PF.deleteCommunity(b.dataset.deleteCommunity);notify('Community deleted','success');await draw()}catch(e){notify(e.message||'Could not delete community','error')}
      });
    };
    const draw=async()=>{
      communities=await PF.listCommunities();
      if(me){
        try{myCount=await PF.myCommunityCount();}catch{myCount=communities.filter(c=>PF.normalizeUsername(c?.owner?.username||'')===PF.normalizeUsername(me.username||'')).length;}
      }
      updateCreateState();
      renderList();
    };
    search?.addEventListener('input',renderList);
    search?.addEventListener('search',renderList);
    await draw();
    const q=new URLSearchParams(location.search).get('community');
    if(q) await openCommunityRoom(q);
  }
  function openCommunityCreateModal(){
    let modal=$('#communityCreateModal');
    if(!modal){
      modal=document.createElement('div');modal.id='communityCreateModal';modal.className='modal-backdrop';
      modal.innerHTML=`<div class="modal-card glass"><div class="modal-head"><div><span class="eyebrow">NEW COMMUNITY</span><h2>Create a community</h2></div><button class="icon-btn" data-modal-close>×</button></div><form id="communityCreateForm" class="modal-form-grid"><div class="community-image-picker"><span class="community-image-preview" id="communityImagePreview">◈</span><label class="btn btn-sm" for="communityImagePicker">Choose image</label><input id="communityImagePicker" type="file" accept="image/*" hidden><small>Optional community picture</small></div><label>Name<input class="field-input" id="communityName" maxlength="80" required></label><label>Description<textarea class="field-input" id="communityDescription" maxlength="500" rows="4"></textarea></label><label>Who can join<select class="field-input" id="communityPolicy"><option value="public">Everyone</option><option value="friends">Friends of the owner</option><option value="request">Approval required</option></select></label><button class="btn btn-primary">Create community</button></form></div>`;
      document.body.appendChild(modal);
      modal.addEventListener('click',e=>{if(e.target===modal||e.target.closest('[data-modal-close]'))modal.classList.remove('open')});
      let imagePayload=null;
      $('#communityImagePicker',modal)?.addEventListener('change',async e=>{
        const file=e.target.files?.[0]; if(!file)return;
        try{const result=await PF.uploadCommunityImage(file);imagePayload=result;$('#communityImagePreview',modal).innerHTML=`<img src="${esc(result.url)}" alt="">`;}catch(err){notify(err.message||'Could not upload image','error')}
      });
      $('#communityCreateForm',modal).addEventListener('submit',async e=>{
        e.preventDefault();
        try{
          const c=await PF.createCommunity($('#communityName',modal).value,$('#communityDescription',modal).value,$('#communityPolicy',modal).value,imagePayload);
          modal.classList.remove('open');location.href=`communities.html?community=${encodeURIComponent(c.id)}`;
        }catch(err){notify(err.message||'Could not create community','error')}
      });
    }
    modal.classList.add('open');
  }
})();
