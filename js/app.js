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
    if ($("[data-rivo-notifications]")) return;
    const host = $(".topbar-right");
    if (!host) return;
    const wrap = document.createElement("div");
    wrap.className = "rivo-notification-wrap";
    wrap.innerHTML = `<button class="icon-btn notification-btn" type="button" data-rivo-notifications aria-label="Notifications"><span>🔔</span><i class="notification-badge hidden" data-notification-badge>0</i></button><div class="notification-popover glass" data-notification-popover><div class="notification-head"><div><b>Notifications</b><small data-notification-count>Loading…</small></div><button class="btn btn-sm btn-ghost" data-notification-readall>Mark all read</button></div><div class="notification-list" data-notification-list></div></div>`;
    host.prepend(wrap);
    const button = $("[data-rivo-notifications]", wrap);
    const pop = $("[data-notification-popover]", wrap);
    const list = $("[data-notification-list]", wrap);
    const badge = $("[data-notification-badge]", wrap);
    const count = $("[data-notification-count]", wrap);
    let notifications = [];
    const icon = type => type === "message" ? "✉️" : type === "friend_request" ? "👋" : type === "friend_accept" ? "🤝" : "🔔";
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
      list.innerHTML = notifications.length ? notifications.map(n => `<button type="button" class="notification-item ${n.read_at ? "read" : "unread"}" data-notification-id="${esc(n.id)}"><span class="notification-icon">${icon(n.type)}</span><span><b>${esc(label(n))}</b><small>${esc(new Date(n.created_at).toLocaleString([], {month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}))}</small></span></button>`).join("") : `<div class="notification-empty">Nothing new.</div>`;
      $$('[data-notification-id]', wrap).forEach(btn => btn.onclick = async () => {
        try { await PF.markNotificationRead(btn.dataset.notificationId); notifications = notifications.map(n => String(n.id) === String(btn.dataset.notificationId) ? {...n, read_at:new Date().toISOString()} : n); render(); } catch {}
      });
    };
    const load = async () => { try { notifications = await PF.listNotifications(50); render(); } catch { count.textContent = "Unavailable"; } };
    button.onclick = async e => {
      e.preventDefault();
      e.stopPropagation();
      const open = !pop.classList.contains("open");

      if (open) {
        // Mobile browsers can trap absolute popovers inside sticky/transformed headers.
        // Portal the existing popover to body only while it is open, without changing
        // its data bindings or notification logic.
        if (window.innerWidth <= 760 && pop.parentElement !== document.body) {
          document.body.appendChild(pop);
        }

        if (window.innerWidth <= 760) {
          const r = button.getBoundingClientRect();
          pop.style.position = "fixed";
          pop.style.top = `${Math.min(window.innerHeight - 80, r.bottom + 8)}px`;
          pop.style.right = "8px";
          pop.style.left = "8px";
          pop.style.width = "auto";
          pop.style.maxHeight = "calc(100vh - 90px)";
          pop.style.zIndex = "2147483000";
        }

        pop.classList.add("open");
        await load();

        if ("Notification" in window && Notification.permission === "default") {
          await PF.requestBrowserNotifications();
        }
      } else {
        pop.classList.remove("open");
      }
    };

    $("[data-notification-readall]", wrap).onclick = async () => {
      try {
        await PF.markAllNotificationsRead();
        notifications = notifications.map(n => ({...n,read_at:new Date().toISOString()}));
        render();
      } catch {}
    };

    document.addEventListener("click", e => {
      if (!wrap.contains(e.target) && !pop.contains(e.target)) {
        pop.classList.remove("open");
      }
    });
    try {
      const unsubscribe = await PF.subscribeNotifications(async n => {
        if (!n) return;
        notifications = [n, ...notifications.filter(x => String(x.id) !== String(n.id))].slice(0,50);
        render();
        const body = label(n);
        notify(body, "success");
        if (document.hidden) await PF.notifyBrowser("Rivo", {body, tag:`rivo-${n.id}`});
      });
      window.addEventListener("beforeunload", () => { try { unsubscribe?.(); } catch {} });
    } catch {}
    load();
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

  function initStorySystem() {
    ensureStoryPicker();
    document.addEventListener("click", e => {
      const trigger = e.target.closest?.("[data-story-user]");
      if (!trigger) return;
      const username = PF.normalizeUsername(trigger.dataset.storyUser || "");
      if (!username) return;
      const active = trigger.dataset.storyActive === "1";
      const own = trigger.dataset.storyOwn === "1" || username === PF.currentUsername();
      if (!active && !own) return;
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
        await room.localParticipant.setCameraEnabled(true);
        const pub = room.localParticipant.getTrackPublication(
          LK.Track.Source.Camera
        );

        if (pub?.track) {
          const v = pub.track.attach();
          v.className = "call-local-video live";
          v.autoplay = true;
          v.muted = true;
          v.playsInline = true;
          e.local.replaceWith(v);
          e.local = v;
          try { await v.play(); } catch {}
        }
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

      await active.room.localParticipant.setCameraEnabled(!on);

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

  document.addEventListener("DOMContentLoaded", async () => {
    nav(); initMenu(); initStorySystem(); initCallSystem();
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
    const human = setupHumanCheck(form, "signupHumanCheck", "signupCaptchaMsg");
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
        await PF.createAccount({ username: $("#signupUsername").value, displayName: $("#signupDisplay").value, password });
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
    const badges = badgePills(p);
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
            <button type="button" class="profile-avatar-button ${p.story?.active ? "has-story" : "story-empty"}" data-story-user="${esc(p.username)}" data-story-active="${p.story?.active ? "1" : "0"}" data-story-own="${isMe ? "1" : "0"}" aria-label="${p.story?.active ? "View story" : isMe ? "Add a story" : "Profile avatar"}">${p.story?.active ? `<span class="story-ring-frame" aria-hidden="true"></span>` : ""}<span class="profile-avatar ${frame}">${p.avatar ? `<img src="${esc(p.avatar)}" alt="${esc(p.displayName || p.username)}">` : esc(initials(p))}</span>${isMe && !p.story?.active ? `<b class="story-add-dot profile-story-plus" aria-hidden="true">+</b>` : ""}</button>
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
    const viewer = !isMe ? await PF.currentProfile() : p;
    const relationship = isMe ? "self" : PF.friendshipState(viewer, p.username);
    const friends = (p.friends || []);
    const friendProfiles = await PF.getProfiles(friends);
    if (!isMe) await PF.addView(username);
    p = !isMe ? await PF.getProfile(username, {force:true}) : await PF.currentProfile({force:true});
    try { p.story = (await PF.getStory(username, { countView:false })) || p.story || null; } catch {}
    p.likes ||= {count:0, users:[]};
    p.likes.users ||= [];
    p.likes.count = Number.isFinite(Number(p.likes.count)) ? Math.max(0, Number(p.likes.count)) : p.likes.users.length;
    root.innerHTML = renderProfileCard(p, { isMe, friendProfiles, relationship }) + `<section class="profile-posts-wrap"><div class="section-head"><div><div class="section-kicker">POSTS</div><h2>${isMe ? "Your posts" : "Posts"}</h2></div>${isMe ? `<a class="btn btn-sm" href="posts.html">+ New post</a>` : ""}</div><div id="profilePostFeed" class="post-feed"><div class="empty-state glass"><h2>Loading posts…</h2></div></div></section>`;
    bindPlayer(root);
    await renderPostFeed($("#profilePostFeed"), p.username, { allowCompose:false });
    $(`[data-add-friend]`)?.addEventListener("click", async () => {
      try {
        await PF.sendFriendRequest(p.username);
        notify("Friend request sent", "success");
        const updated = await PF.getProfile(p.username);
        const selfFresh = await PF.currentProfile();
        const rel = PF.friendshipState(selfFresh, p.username);
        root.innerHTML = renderProfileCard(updated, { isMe:false, friendProfiles, relationship:rel }) + `<section class="profile-posts-wrap"><div class="section-head"><div><div class="section-kicker">POSTS</div><h2>Posts</h2></div></div><div id="profilePostFeed" class="post-feed"></div></section>`;
        bindPlayer(root);
        await renderPostFeed($("#profilePostFeed"), updated.username, { allowCompose:false });
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
          root.innerHTML = renderProfileCard(fresh, { isMe:false, friendProfiles, relationship:rel }) + `<section class="profile-posts-wrap"><div class="section-head"><div><div class="section-kicker">POSTS</div><h2>Posts</h2></div></div><div id="profilePostFeed" class="post-feed"></div></section>`;
          bindPlayer(root);
          await renderPostFeed($("#profilePostFeed"), fresh.username, { allowCompose:false });
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
        const reactionToggle = document.createElement("button");
        reactionToggle.type = "button"; reactionToggle.className = "reaction-add"; reactionToggle.textContent = "＋"; reactionToggle.setAttribute("aria-label","Add reaction");
        reactionToggle.onclick = ev => { ev.stopPropagation(); openReactionMenu(reactionToggle, m.id); };
        bubble.appendChild(reactionToggle);
      }
      row.appendChild(bubble);
      const placeholder = thread.querySelector(".message-empty");
      if (placeholder) thread.innerHTML = "";
      thread.appendChild(row);
      if (keepBottom) scrollThread();
    };

    function openReactionMenu(anchorEl, messageId) {
      document.querySelectorAll(".reaction-popover").forEach(x => x.remove());
      const pop = document.createElement("div");
      pop.className = "reaction-popover glass";
      pop.innerHTML = PF.REACTION_SET.map(r => `<button type="button" data-quick-reaction="${esc(r)}">${esc(r)}</button>`).join("");
      document.body.appendChild(pop);
      const rect = anchorEl.getBoundingClientRect();
      pop.style.left = `${Math.max(8, Math.min(window.innerWidth-210, rect.left))}px`;
      pop.style.top = `${Math.max(8, rect.top - 54)}px`;
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
    mobileBack?.addEventListener("click", () => {
      messagesLayout.classList.remove("conversation-open");
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
        detail.innerHTML = `<div class="admin-detail"><div class="admin-detail-head"><div><span class="eyebrow">ACCOUNT</span><h2 style="margin:5px 0 0">${esc(d.displayName || d.username)}</h2><div class="admin-detail-meta">@${esc(d.username)} · joined ${esc(new Date(d.created_at).toLocaleDateString())}</div></div><span class="admin-badge ${d.is_banned?'banned':''}">${d.is_banned?'Banned':'Active'}</span></div><div class="admin-stats"><div class="admin-stat"><span>Profile views</span><b>${esc(d.views)}</b></div><div class="admin-stat"><span>Profile likes</span><b>${esc(d.likes)}</b></div><div class="admin-stat"><span>Friends</span><b>${esc(d.friends)}</b></div></div><section class="admin-edit-section"><div class="section-kicker">ACCOUNT EDIT</div><div class="form-grid"><label class="field"><span>Username</span><input id="adminUsername" class="field-input" value="${esc(d.username)}" maxlength="26"></label><label class="field"><span>Display name</span><input id="adminDisplayName" class="field-input" value="${esc(d.displayName || d.username)}" maxlength="80"></label></div><label class="field"><span>New password (leave blank to keep current password)</span><input id="adminPassword" class="field-input" type="password" minlength="8" maxlength="128" placeholder="Set a new password"></label><button class="btn btn-primary" id="adminSaveAccount">Save account</button><small class="muted">For security, the existing password is never displayed or retrievable; admins can only set a new password.</small></section><div class="field"><span>Adjust public counters</span><div class="form-grid"><input id="adminViews" class="field-input" type="number" min="0" value="${esc(d.views)}" placeholder="Views"><input id="adminLikes" class="field-input" type="number" min="0" value="${esc(d.likes)}" placeholder="Likes"></div></div><div class="admin-actions"><button class="btn btn-primary" id="adminSaveStats">Save counters</button><button class="btn" id="adminToggleBan">${d.is_banned?'Unban account':'Block account'}</button><a class="btn" href="profile.html?u=${encodeURIComponent(d.username)}" target="_blank" rel="noreferrer">Open profile</a></div><section><div class="section-head"><div><div class="section-kicker">VISITORS</div><h3>Recent profile visitors</h3></div></div><div class="visitor-list">${visitorRows}</div></section><section class="admin-card danger-zone"><div class="section-kicker">DANGER ZONE</div><h3>Delete account permanently</h3><p class="muted">Removes the auth account and cascading profile data. This cannot be undone.</p><button class="btn btn-danger" id="adminDeleteUser">Delete ${esc(d.username)}</button></section></div>`;
        $("#adminSaveAccount").onclick = async () => { try { const result = await PF.adminUpdateUser(d.username, $("#adminUsername").value, $("#adminDisplayName").value, $("#adminPassword").value); notify(result?.passwordChanged ? "Account and password updated" : "Account updated", "success"); selected = result?.username || $("#adminUsername").value.trim().toLowerCase(); await loadUsers(""); await selectUser(selected); } catch(e) { notify(e.message || "Could not update account", "error"); } };
        $("#adminSaveStats").onclick = async () => { try { await PF.adminSetStats(d.username, $("#adminViews").value, $("#adminLikes").value); notify("Counters updated", "success"); await selectUser(d.username); } catch(e) { notify(e.message,"error"); } };
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
    $("#settingsDisplay") && ($("#settingsDisplay").textContent = me.displayName || me.username);
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
    const notifOn = $("#notifOn"), notifOff = $("#notifOff"), nsupport = $("#notificationSupport");
    if (notifOn && notifOff) {
      const supported = "Notification" in window;
      const syncNotifUI = () => {
        const enabled = supported && Notification.permission === "granted" && PF.notificationsEnabled();
        notifOn.checked = enabled;
        notifOff.checked = !enabled;
        nsupport.textContent = !supported
          ? "This browser does not support web notifications."
          : Notification.permission === "denied"
            ? "Blocked in browser settings — allow notifications for this site to enable them here."
            : `Browser permission: ${Notification.permission}`;
      };
      notifOn.disabled = notifOff.disabled = !supported;
      notifOn.addEventListener("change", async () => {
        if (!notifOn.checked) return;
        const result = await PF.requestBrowserNotifications();
        if (result !== "granted") notify("Allow notifications in your browser to enable this.", "error");
        syncNotifUI();
      });
      notifOff.addEventListener("change", () => {
        if (!notifOff.checked) return;
        PF.setNotificationsEnabled(false);
        syncNotifUI();
      });
      syncNotifUI();
    }
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
    box.innerHTML=`<button type="button" class="post-image-viewer-close" data-post-image-close aria-label="Close image">×</button><div class="post-image-viewer-backdrop" data-post-image-close></div><img class="post-image-viewer-image" data-post-image-viewer-img alt="Post image">`;
    document.body.appendChild(box);
    const close=()=>{box.classList.remove("open");const img=box.querySelector("[data-post-image-viewer-img]");if(img)img.removeAttribute("src");};
    box.querySelectorAll("[data-post-image-close]").forEach(b=>b.addEventListener("click",close));
    document.addEventListener("keydown",e=>{if(e.key==="Escape" && box.classList.contains("open"))close();});
    return box;
  }

  function openPostImageViewer(url){
    if(!url) return;
    const box=ensurePostImageViewer();
    const img=box.querySelector("[data-post-image-viewer-img]");
    img.src=url;
    box.classList.add("open");
  }

  function renderPostCard(post){
    const author=post.author||{}; const medias=Array.isArray(post.media)?post.media:[];
    const myReaction=post.my_reaction||null; const reposted=!!post.reposted_by_me;
    const repNames=Array.isArray(post.reposter_names)?post.reposter_names:[];
    const mediaHtml=medias.length?`<div class="post-media count-${Math.min(5,medias.length)}">${medias.slice(0,5).map((m,i)=>`<button type="button" class="post-media-thumb" data-post-image="${esc(m.url)}" aria-label="Open image ${i+1}"><img src="${esc(m.url)}" alt="" loading="lazy"></button>`).join("")}</div>`:"";
    const note=post.profile_reposted?`<div class="repost-note">↻ Reposted to this profile</div>`:repNames.length?`<div class="repost-note">↻ Reposted by <b>${esc(repNames[0].displayName||repNames[0].username)}</b>${repNames.length>1?` and ${repNames.length-1} more`:""}</div>`:"";
    const reactButtons=POST_REACTIONS.map(r=>`<button type="button" class="reaction-chip ${myReaction===r?'active':''}" data-post-react="${esc(r)}">${r}<span>${Number((post.reactions||{})[r]||0)}</span></button>`).join('');
    const isOwner = !!author?.username && PF.normalizeUsername(author.username) === PF.normalizeUsername(PF.currentUsername() || "");
    const ownerActions = isOwner ? `<button type="button" class="post-action post-delete-action" data-post-delete>🗑 Delete</button>` : "";
    const reportAction = !isOwner ? `<button type="button" class="post-action post-report-action" data-post-report aria-label="Report post">⚑ Report</button>` : "";
    return `<article class="post-card glass" data-post-id="${esc(post.id)}"><div class="post-main"><div class="post-author">${identityLink(author, profileMini(author), "post-author-avatar-link")}<div class="post-author-copy">${identityLink(author, `<span><b>${esc(author.displayName||author.username||"User")}</b><small>@${esc(author.username||"")}</small></span>`)}</div><span class="post-author-meta">${formatSocialTime(post.created_at)}</span>${ownerActions}</div>${note}<div class="post-content">${esc(post.content||"")}</div>${mediaHtml}<div class="post-reaction-row">${reactButtons}</div><div class="post-actions"><button class="post-action" data-post-comments>💬 ${Number(post.comments_count||0)} Comment</button><button class="post-action ${reposted?'active':''}" data-post-repost>↻ ${Number(post.reposts_count||0)} Repost</button>${reportAction}<span class="post-action" aria-hidden="true">${reposted?'✓ Reposted':''}</span></div></div><div class="post-comments hidden"></div></article>`;
  }

  async function renderPostComments(card, postId){
    const box=card.querySelector('.post-comments'); if(!box) return;
    box.classList.remove('hidden'); box.innerHTML=`<div class="empty-state"><p>Loading comments…</p></div>`;
    const post=await PF.getPost(postId); const comments=Array.isArray(post?.comments)?post.comments:[];
    box.innerHTML=`<div class="comment-list">${comments.length?comments.map(c=>`<div class="comment">${identityLink(c.author, profileMini(c.author), "comment-avatar-link")}<div class="comment-bubble">${identityLink(c.author, `<b>${esc(c.author?.displayName||c.author?.username||"User")}</b>`)}<p>${esc(c.content)}</p></div></div>`).join(""): `<div class="message-list-empty">No comments yet. Start the conversation.</div>`}</div><form class="comment-form"><input class="field-input" maxlength="2000" placeholder="Write a comment…" required><button class="btn btn-sm btn-primary">Send</button></form>`;
    box.querySelector('form')?.addEventListener('submit',async e=>{e.preventDefault();const input=e.currentTarget.querySelector('input');try{await PF.commentPost(postId,input.value);input.value='';await renderPostComments(card,postId);}catch(err){notify(err.message,'error')}});
  }
  function bindPostCard(card, post){
    card.querySelectorAll('[data-post-image]').forEach(btn=>btn.addEventListener('click',e=>{e.preventDefault();openPostImageViewer(btn.dataset.postImage||"");}));
    card.querySelectorAll('[data-post-react]').forEach(btn=>btn.addEventListener('click',async()=>{if(!PF.currentUsername()){location.href='login.html';return}try{await PF.reactPost(post.id,btn.dataset.postReact);await refreshPostCard(post.id)}catch(e){notify(e.message,'error')}}));
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
