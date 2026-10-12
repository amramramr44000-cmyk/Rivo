/* Rivo Spotify Now Playing presence.
 * OAuth uses PKCE in the browser, then the refresh token is sent once to a
 * restricted Supabase Edge Function. Playback metadata is never used to relay
 * the owner's audio; profile visitors use Spotify's official player independently.
 */
(() => {
  "use strict";

  const TABLE = "rivo_spotify_presence";
  const FUNCTION = "rivo-spotify-presence";
  const CONNECTION_KEY = "rivo_spotify_connection_v1";
  const SHARE_KEY = "rivo_spotify_share_v1";
  const OAUTH_STATE_KEY = "rivo_spotify_oauth_state_v1";
  const VERIFIER_KEY = "rivo_spotify_pkce_verifier_v1";
  const OWNER_POLL_MS = 30000;
  const PROFILE_POLL_MS = 15000;
  const PUBLIC_FRESH_MS = 90000;
  const cfg = window.RIVO_SPOTIFY_CONFIG || {};
  const supaCfg = window.RIVO_SUPABASE || {};
  const sb = window.__rivoSupabase || (window.supabase && supaCfg.url && supaCfg.anonKey
    ? window.supabase.createClient(supaCfg.url, supaCfg.anonKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
      })
    : null);
  if (sb && !window.__rivoSupabase) window.__rivoSupabase = sb;
  const isSpotifyCallbackPage = () => /\/spotify-callback\.html$/i.test(location.pathname);
  let ownerTimer = null;
  let profileTimer = null;
  let ownerPollBusy = false;
  let profilePollBusy = false;
  let booted = false;

  const getClientId = () => String(cfg.clientId || "").trim();
  const hasClientId = () => !!getClientId() && !/YOUR_|PASTE_|CHANGE_ME|CLIENT_ID_HERE/i.test(getClientId());
  const settingsRedirectUri = () => String(cfg.redirectUri || new URL("spotify-callback.html", location.href).href);
  const normalizeUser = value => String(value || "").trim().replace(/^@+/, "").toLowerCase();
  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
  const translate = text => { try { return window.PF?.translateString?.(text) || text; } catch { return text; } };

  function readConnection() {
    try {
      const item = JSON.parse(localStorage.getItem(CONNECTION_KEY) || "null");
      return item && typeof item === "object" ? item : null;
    } catch { return null; }
  }
  function saveConnection(value) {
    try { localStorage.setItem(CONNECTION_KEY, JSON.stringify(value)); } catch {}
  }
  function readSharePref() {
    try { return localStorage.getItem(SHARE_KEY) === "true"; } catch { return false; }
  }
  function saveSharePref(value) {
    try { localStorage.setItem(SHARE_KEY, value ? "true" : "false"); } catch {}
  }
  function setSettingsStatus(message, kind = "neutral") {
    const el = document.getElementById("spotifyStatus");
    if (!el) return;
    el.textContent = message;
    el.dataset.state = kind;
    el.setAttribute("role", kind === "error" ? "alert" : "status");
  }
  function updateSettingsButtons(connected, backendReady = true, sessionReady = true) {
    const connect = document.getElementById("spotifyConnect");
    const disconnect = document.getElementById("spotifyDisconnect");
    const privacy = document.getElementById("spotifyVisibility");
    if (connect) {
      connect.hidden = !!connected;
      connect.disabled = !hasClientId() || !backendReady || !sessionReady;
      connect.title = !hasClientId() ? "Set the Spotify Client ID in js/supabase-config.js first" : !backendReady ? "Deploy the Spotify presence Edge Function first" : "Connect your Spotify account";
    }
    if (disconnect) disconnect.hidden = !connected;
    if (privacy) privacy.disabled = !connected || !backendReady;
    const note = document.getElementById("spotifySetupHint");
    if (note) {
      note.hidden = hasClientId() && backendReady;
      if (!hasClientId()) note.textContent = translate("Setup needed: add your Spotify Client ID to") + " js/supabase-config.js " + translate("and register this page as the redirect URI in Spotify for Developers.");
      else if (!backendReady) note.textContent = translate("Deploy the rivo-spotify-presence Supabase Edge Function and apply the Spotify presence SQL migration.");
    }
  }

  async function getAuthSession() {
    if (!sb?.auth) return null;
    try {
      const { data, error } = await sb.auth.getSession();
      if (error) throw error;
      return data?.session || null;
    } catch (error) {
      console.warn("[Rivo Spotify] Could not read Rivo session", error?.message || error);
      return null;
    }
  }

  async function callSpotifyFunction(action, extra = {}) {
    if (!sb?.functions) throw new Error("Rivo is not connected to Supabase.");
    const { data, error } = await sb.functions.invoke(FUNCTION, { body: { action, ...extra } });
    if (error) {
      let detail = error.message || "Spotify server function is unavailable.";
      try {
        const response = error.context;
        if (response && typeof response.json === "function") {
          const payload = await response.json();
          detail = payload?.error || payload?.message || detail;
        }
      } catch {}
      throw new Error(detail);
    }
    if (data?.error) throw new Error(String(data.error));
    return data || {};
  }

  async function createPkcePair() {
    const bytes = new Uint8Array(64);
    crypto.getRandomValues(bytes);
    const verifier = Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
    const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    return { verifier, challenge };
  }

  function stripOAuthQuery() {
    const url = new URL(location.href);
    ["code", "state", "error", "error_description", "scope"].forEach(key => url.searchParams.delete(key));
    history.replaceState({}, document.title, url.pathname + (url.searchParams.toString() ? `?${url.searchParams}` : "") + url.hash);
  }
  function returnFromSpotifyCallback(notice, isError = false) {
    try { sessionStorage.setItem("rivo_spotify_oauth_notice_v1", JSON.stringify({ message: String(notice || ""), kind: isError ? "error" : "success" })); } catch {}
    const target = new URL("settings.html", location.href);
    target.search = "";
    target.hash = "";
    location.replace(target.href);
  }

  async function startConnect() {
    if (!hasClientId()) {
      setSettingsStatus(translate("Spotify setup is incomplete. Add your Spotify Client ID first."), "error");
      return;
    }
    const session = await getAuthSession();
    if (!session?.user?.id) {
      setSettingsStatus(translate("Sign in to Rivo before connecting Spotify."), "error");
      return;
    }
    try {
      const { verifier, challenge } = await createPkcePair();
      const stateBytes = new Uint8Array(24);
      crypto.getRandomValues(stateBytes);
      const state = Array.from(stateBytes, byte => byte.toString(16).padStart(2, "0")).join("");
      sessionStorage.setItem(VERIFIER_KEY, verifier);
      sessionStorage.setItem(OAUTH_STATE_KEY, state);
      sessionStorage.setItem("rivo_spotify_pending_user", session.user.id);
      const url = new URL("https://accounts.spotify.com/authorize");
      url.searchParams.set("client_id", getClientId());
      url.searchParams.set("response_type", "code");
      url.searchParams.set("redirect_uri", settingsRedirectUri());
      url.searchParams.set("scope", "user-read-currently-playing user-read-playback-state");
      url.searchParams.set("code_challenge_method", "S256");
      url.searchParams.set("code_challenge", challenge);
      url.searchParams.set("state", state);
      location.assign(url.toString());
    } catch (error) {
      setSettingsStatus(`${translate("Could not start Spotify connection.")} ${error?.message || ""}`.trim(), "error");
    }
  }

  async function finishOAuthCallback() {
    if (!isSpotifyCallbackPage() && !sessionStorage.getItem(OAUTH_STATE_KEY)) return;
    const url = new URL(location.href);
    const errorParam = url.searchParams.get("error");
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (errorParam) {
      stripOAuthQuery();
      const notice = translate("Spotify authorization was cancelled or denied.");
      if (isSpotifyCallbackPage()) returnFromSpotifyCallback(notice, true); else setSettingsStatus(notice, "error");
      return;
    }
    if (!code) {
      if (isSpotifyCallbackPage()) returnFromSpotifyCallback(translate("Spotify callback did not include an authorization code."), true);
      return;
    }
    const expectedState = sessionStorage.getItem(OAUTH_STATE_KEY) || "";
    const verifier = sessionStorage.getItem(VERIFIER_KEY) || "";
    const pendingUserId = sessionStorage.getItem("rivo_spotify_pending_user") || "";
    const session = await getAuthSession();
    if (!hasClientId() || !expectedState || !verifier || !state || state !== expectedState || !session?.user?.id || session.user.id !== pendingUserId) {
      stripOAuthQuery();
      const notice = translate("Spotify connection verification failed. Please try again.");
      if (isSpotifyCallbackPage()) returnFromSpotifyCallback(notice, true); else setSettingsStatus(notice, "error");
      return;
    }
    setSettingsStatus(translate("Finishing Spotify connection…"), "neutral");
    try {
      // Exchange the authorization code server-side. Neither access nor refresh
      // tokens are returned to this browser page.
      const connected = await callSpotifyFunction("connect", {
        code,
        code_verifier: verifier,
        redirect_uri: settingsRedirectUri()
      });
      if (!connected?.connected) throw new Error(connected?.error || "Spotify server connection could not be saved.");
      localStorage.removeItem("rivo_spotify_oauth_v1"); // clear any token from the browser-only earlier draft
      saveConnection({ connected: true, rivoUserId: session.user.id, connectedAt: new Date().toISOString() });
      saveSharePref(false);
      sessionStorage.removeItem(VERIFIER_KEY);
      sessionStorage.removeItem(OAUTH_STATE_KEY);
      sessionStorage.removeItem("rivo_spotify_pending_user");
      stripOAuthQuery();
      if (isSpotifyCallbackPage()) {
        returnFromSpotifyCallback(translate("Spotify connected. Turn on profile sharing when you're ready."), false);
        return;
      }
      setSettingsStatus(translate("Spotify connected. Turn on profile sharing when you're ready."), "success");
      await initSettings(true);
    } catch (error) {
      stripOAuthQuery();
      sessionStorage.removeItem(VERIFIER_KEY);
      sessionStorage.removeItem(OAUTH_STATE_KEY);
      sessionStorage.removeItem("rivo_spotify_pending_user");
      const notice = `${translate("Spotify could not be connected.")} ${error?.message || ""}`.trim();
      if (isSpotifyCallbackPage()) returnFromSpotifyCallback(notice, true); else setSettingsStatus(notice, "error");
    }
  }

  async function pollOwnerPresence(force = false) {
    if (ownerPollBusy || (document.visibilityState === "hidden" && !force)) return;
    ownerPollBusy = true;
    try {
      const session = await getAuthSession();
      if (!session?.user?.id) return;
      const connection = readConnection();
      if (connection?.rivoUserId !== session.user.id) return;
      const profile = await window.PF?.currentProfile?.().catch(() => null);
      const username = normalizeUser(profile?.username || window.PF?.currentUsername?.());
      if (!username) return;
      const result = await callSpotifyFunction("refresh_self");
      if (result?.connected === false) {
        localStorage.removeItem(CONNECTION_KEY);
        saveSharePref(false);
        updateSettingsButtons(false, true, true);
        if (force) setSettingsStatus(translate("Spotify session expired. Reconnect Spotify in Settings."), "error");
        return;
      }
      if (result?.show_on_profile !== undefined) saveSharePref(!!result.show_on_profile);
      if (force && result?.playing && result?.track?.track_name) {
        setSettingsStatus(`${translate("Connected · Now playing:")} ${result.track.track_name}`, "success");
      }
    } catch (error) {
      if (force && document.getElementById("spotifyStatus")) setSettingsStatus(`${translate("Spotify is connected, but playback status could not be refreshed.")} ${error?.message || ""}`.trim(), "error");
      else console.warn("[Rivo Spotify] Owner status refresh failed", error?.message || error);
    } finally {
      ownerPollBusy = false;
    }
  }

  async function saveVisibilityPreference(enabled) {
    const session = await getAuthSession();
    const connection = readConnection();
    if (!session?.user?.id || connection?.rivoUserId !== session.user.id) throw new Error("Reconnect Spotify to change profile visibility.");
    const result = await callSpotifyFunction("visibility", { show_on_profile: !!enabled });
    if (!result?.connected) throw new Error("Spotify connection was not found. Reconnect Spotify in Settings.");
    saveSharePref(!!result.show_on_profile);
    return result;
  }

  async function disconnectSpotify() {
    const button = document.getElementById("spotifyDisconnect");
    if (button) button.disabled = true;
    try {
      await callSpotifyFunction("disconnect");
      localStorage.removeItem(CONNECTION_KEY);
      localStorage.removeItem("rivo_spotify_oauth_v1");
      saveSharePref(false);
      const privacy = document.getElementById("spotifyVisibility");
      if (privacy) privacy.checked = false;
      updateSettingsButtons(false, true, true);
      setSettingsStatus(translate("Spotify disconnected."), "success");
      await refreshProfilePresence();
    } catch (error) {
      setSettingsStatus(`${translate("Could not disconnect Spotify.")} ${error?.message || ""}`.trim(), "error");
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function initSettings(force = false) {
    const connect = document.getElementById("spotifyConnect");
    const disconnect = document.getElementById("spotifyDisconnect");
    const privacy = document.getElementById("spotifyVisibility");
    if (!connect && !disconnect && !privacy) return;
    const session = await getAuthSession();
    if (!hasClientId()) {
      updateSettingsButtons(false, true, !!session?.user?.id);
      setSettingsStatus(translate("Add your Spotify Client ID in js/supabase-config.js to enable connection."), "error");
      return;
    }
    if (!session?.user?.id) {
      updateSettingsButtons(false, true, false);
      setSettingsStatus(translate("Sign in to Rivo before connecting Spotify."), "neutral");
      return;
    }
    let status;
    try {
      status = await callSpotifyFunction("status");
    } catch (error) {
      updateSettingsButtons(false, false, true);
      setSettingsStatus(`${translate("Spotify backend is not ready. Deploy the Edge Function and apply its SQL migration.")} ${error?.message || ""}`.trim(), "error");
      return;
    }
    const connected = !!status?.connected;
    saveConnection(connected ? { connected: true, rivoUserId: session.user.id } : null);
    if (!connected) localStorage.removeItem(CONNECTION_KEY);
    saveSharePref(!!status?.show_on_profile);
    updateSettingsButtons(connected, true, true);
    if (privacy) privacy.checked = !!status?.show_on_profile;
    if (!connected) setSettingsStatus(translate("Connect Spotify to show your current track on your Rivo profile."), "neutral");
    else {
      setSettingsStatus(status.show_on_profile
        ? translate("Spotify connected. Profile sharing is enabled.")
        : translate("Spotify connected. Profile sharing is off until you enable it."), "success");
      if (force) await pollOwnerPresence(true);
    }
    if (connect) connect.onclick = () => startConnect();
    if (disconnect) disconnect.onclick = () => disconnectSpotify();
    if (privacy) privacy.onchange = async () => {
      privacy.disabled = true;
      try {
        const result = await saveVisibilityPreference(privacy.checked);
        setSettingsStatus(result.show_on_profile
          ? translate("Your Spotify activity can appear on your public profile while playing.")
          : translate("Spotify activity is hidden from your public profile."), "success");
        await refreshProfilePresence();
      } catch (error) {
        privacy.checked = readSharePref();
        setSettingsStatus(`${translate("Could not save Spotify visibility.")} ${error?.message || ""}`.trim(), "error");
      } finally {
        const activeSession = await getAuthSession();
        const connection = readConnection();
        privacy.disabled = !(activeSession?.user?.id && connection?.connected && connection.rivoUserId === activeSession.user.id);
      }
    };
  }

  function makeSpotifyCard(track) {
    const card = document.createElement("section");
    card.className = "section-block music-section rivo-spotify-live-section";
    const id = /^[A-Za-z0-9]{22}$/.test(String(track.track_id || "")) ? String(track.track_id) : "";
    const cover = /^https:\/\/(i\.scdn\.co|image-cdn-ak\.spotifycdn\.com)\//i.test(String(track.album_art_url || "")) ? track.album_art_url : "";
    const link = /^https:\/\/open\.spotify\.com\/track\/[A-Za-z0-9]{22}(?:\?.*)?$/i.test(String(track.track_url || ""))
      ? track.track_url : (id ? `https://open.spotify.com/track/${id}` : "https://open.spotify.com/");
    card.dataset.trackId = id || track.track_url || track.track_name || "unknown";
    card.innerHTML = `
      <div class="section-kicker spotify-live-kicker"><span class="spotify-live-dot" aria-hidden="true"></span> NOW PLAYING ON SPOTIFY</div>
      <div class="rivo-spotify-now-row">
        <div class="rivo-spotify-cover">${cover ? `<img src="${esc(cover)}" alt="Album cover for ${esc(track.album_name || track.track_name)}" loading="lazy" decoding="async">` : `<span aria-hidden="true">♫</span>`}</div>
        <div class="rivo-spotify-track-meta"><strong>${esc(track.track_name || "Unknown track")}</strong><span>${esc(track.artist_names || "Unknown artist")}</span>${track.album_name ? `<small>${esc(track.album_name)}</small>` : ""}<a class="rivo-spotify-open" href="${esc(link)}" target="_blank" rel="noopener noreferrer">Open in Spotify ↗</a></div>
        <span class="rivo-spotify-mark" aria-label="Spotify">●</span>
      </div>
      ${id ? `<div class="rivo-spotify-embed-wrap"><iframe title="Official Spotify player: ${esc(track.track_name || "track")}" src="https://open.spotify.com/embed/track/${id}?utm_source=generator&theme=0" width="100%" height="152" style="border:0;border-radius:12px" loading="lazy" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin"></iframe></div>` : `<p class="rivo-spotify-player-note">${translate("Open the track in Spotify to listen.")}</p>`}
      <p class="rivo-spotify-attribution">${translate("Track information provided by Spotify. Each visitor starts playback independently.")}</p>`;
    return card;
  }

  function readCurrentProfileUsername() {
    const queryUser = normalizeUser(new URLSearchParams(location.search).get("u"));
    if (queryUser) return queryUser;
    return normalizeUser(window.PF?.currentUsername?.());
  }

  async function refreshProfilePresence() {
    if (profilePollBusy) return;
    const sections = document.querySelector("#profileRoot .profile-sections");
    const username = readCurrentProfileUsername();
    if (!sections || !username || !sb) return;
    profilePollBusy = true;
    try {
      let data = null;
      let edgeRefreshSucceeded = false;
      try {
        const refreshed = await callSpotifyFunction("refresh_public", { username });
        edgeRefreshSucceeded = true;
        if (refreshed?.playing && refreshed?.track) data = refreshed.track;
      } catch (error) {
        console.warn("[Rivo Spotify] Server refresh is unavailable; trying the fresh public row.", error?.message || error);
      }
      if (!edgeRefreshSucceeded) {
        const cutoff = new Date(Date.now() - PUBLIC_FRESH_MS).toISOString();
        const { data: row, error } = await sb.from(TABLE)
          .select("username,track_id,track_name,artist_names,album_name,album_art_url,track_url,spotify_uri,progress_ms,duration_ms,updated_at")
          .eq("username", username).eq("show_on_profile", true).eq("is_playing", true).gte("updated_at", cutoff).maybeSingle();
        if (error) {
          if (!/does not exist|schema cache|permission denied/i.test(String(error.message || ""))) console.warn("[Rivo Spotify] Public presence lookup failed", error.message);
          return;
        }
        data = row;
      }
      const existing = sections.querySelector(".rivo-spotify-live-section");
      if (!data) {
        if (existing) {
          const savedManual = existing.__rivoManualOuterHTML || "";
          if (savedManual) existing.insertAdjacentHTML("beforebegin", savedManual);
          existing.remove();
          if (savedManual) window.PF?.applyI18n?.(sections);
        }
        return;
      }
      const fingerprint = `${data.track_id || ""}|${data.track_name || ""}|${data.artist_names || ""}|${data.album_art_url || ""}`;
      if (existing && existing.dataset.trackFingerprint === fingerprint) return;
      const freshCard = makeSpotifyCard(data);
      freshCard.dataset.trackFingerprint = fingerprint;
      if (existing) {
        freshCard.__rivoManualOuterHTML = existing.__rivoManualOuterHTML || "";
        existing.replaceWith(freshCard);
      } else {
        const manual = sections.querySelector(":scope > .music-section:not(.rivo-spotify-live-section)");
        freshCard.__rivoManualOuterHTML = manual ? manual.outerHTML : "";
        if (manual) manual.replaceWith(freshCard); else sections.prepend(freshCard);
      }
    } catch (error) {
      console.warn("[Rivo Spotify] Could not update profile music section", error?.message || error);
    } finally {
      profilePollBusy = false;
    }
  }

  function startPollers() {
    clearInterval(ownerTimer);
    clearInterval(profileTimer);
    ownerTimer = setInterval(() => pollOwnerPresence(false), OWNER_POLL_MS);
    if (document.querySelector("#profileRoot")) {
      profileTimer = setInterval(() => refreshProfilePresence(), PROFILE_POLL_MS);
      refreshProfilePresence();
    }
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        pollOwnerPresence(true);
        refreshProfilePresence();
      }
    }, { passive: true });
    window.addEventListener("rivo:profile-rendered", event => {
      const renderedUser = normalizeUser(event?.detail?.username);
      if (!renderedUser || renderedUser === readCurrentProfileUsername()) refreshProfilePresence();
    });
  }

  async function boot() {
    if (booted) return;
    booted = true;
    if (isSpotifyCallbackPage()) {
      await finishOAuthCallback();
      return;
    }
    await finishOAuthCallback();
    await initSettings(false);
    try {
      const rawNotice = sessionStorage.getItem("rivo_spotify_oauth_notice_v1");
      if (rawNotice) {
        sessionStorage.removeItem("rivo_spotify_oauth_notice_v1");
        const notice = JSON.parse(rawNotice);
        if (notice?.message && document.getElementById("spotifyStatus")) setSettingsStatus(notice.message, notice.kind === "error" ? "error" : "success");
      }
    } catch {}
    startPollers();
    await pollOwnerPresence(false);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
  else void boot();

  window.RivoSpotify = Object.freeze({
    refreshProfilePresence,
    connect: startConnect,
    disconnect: disconnectSpotify,
    isConnected: () => !!readConnection()?.connected,
    hasClientId
  });
})();
