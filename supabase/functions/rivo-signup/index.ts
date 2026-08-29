import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const USERNAME_RE = /^[a-z0-9](?:[a-z0-9._-]{1,24})[a-z0-9]$/;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const service = Deno.env.get("SERVICE_ROLE_KEY");
    if (!url || !service) return json({ error: "Server configuration is missing" }, 500);
    const admin = createClient(url, service);

    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return json({ error: "Invalid request" }, 400); }

    const username = String(body.username || "").trim().toLowerCase();
    const displayName = String(body.displayName || "").trim().slice(0, 28);
    const password = String(body.password || "");
    const birthDate = String(body.birthDate || "").trim();
    const challengeId = String(body.challengeId || "").trim();
    const verificationToken = String(body.verificationToken || "");

    if (!USERNAME_RE.test(username)) return json({ error: "Invalid username." }, 400);
    if (!displayName) return json({ error: "Display name is required." }, 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return json({ error: "Birth date is required." }, 400);
    const date = new Date(`${birthDate}T00:00:00Z`);
    if (Number.isNaN(date.getTime()) || date > new Date()) return json({ error: "Invalid birth date." }, 400);
    if (password.length < 8 || password.length > 28) return json({ error: "Password must be 8–28 characters." }, 400);
    const classes = [/[a-z]/.test(password), /[A-Z]/.test(password), /\d/.test(password), /[^A-Za-z0-9]/.test(password)].filter(Boolean).length;
    if (classes < 3) return json({ error: "Use a stronger password: mix uppercase, lowercase, numbers and/or symbols." }, 400);
    const weak = new Set(["password123", "password123!", "qwerty1234", "1234567890", "letmein123", "welcome123"]);
    if (weak.has(password.toLowerCase())) return json({ error: "Choose a less predictable password." }, 400);
    if (!challengeId || !/^[0-9a-f-]{36}$/i.test(challengeId) || !/^[0-9a-f-]{72}$/.test(verificationToken)) {
      return json({ error: "Complete the security check." }, 400);
    }

    const { data: cap, error: capError } = await admin
      .from("rivo_captcha_challenges")
      .select("id,expires_at,used_at,verified_at,verification_token_hash")
      .eq("id", challengeId).maybeSingle();
    if (capError || !cap) return json({ error: "Verification expired. Please try again." }, 400);
    if (cap.used_at || !cap.verified_at || !cap.verification_token_hash || new Date(cap.expires_at).getTime() < Date.now()) {
      return json({ error: "Complete the security check again." }, 400);
    }
    const suppliedTokenHash = await sha256(`rivo-captcha-token:${challengeId}:${verificationToken}`);
    if (suppliedTokenHash !== cap.verification_token_hash) return json({ error: "Security verification is invalid. Please try again." }, 400);
    const { data: claimed, error: claimError } = await admin
      .from("rivo_captcha_challenges")
      .update({ used_at: new Date().toISOString() })
      .eq("id", challengeId).is("used_at", null)
      .select("id").maybeSingle();
    if (claimError || !claimed) return json({ error: "Verification is no longer valid. Please try again." }, 400);

    const { data: taken } = await admin.from("profiles").select("id").eq("username", username).maybeSingle();
    if (taken) return json({ error: "That username is already taken." }, 409);

    const syntheticEmail = `${username}@users.rivo.app`;
    const { data: auth, error: authError } = await admin.auth.admin.createUser({
      email: syntheticEmail,
      password,
      email_confirm: true,
      user_metadata: { username }
    });
    if (authError || !auth.user) {
      const msg = String(authError?.message || "Could not create account");
      if (/already registered|already been registered|duplicate/i.test(msg)) return json({ error: "That username is already taken." }, 409);
      return json({ error: msg }, 400);
    }

    const now = new Date().toISOString();
    const publicData = {
      username, displayName, bio: "", description: "", location: "", website: "",
      avatar: "", banner: "", miniImage: "", status: "Online", customStatus: "",
      theme: "obsidian", template: "discord-noir", accent: "#7488ff", cardRadius: 24,
      cardStyle: "glass", glow: 45, background: "aurora", animation: "soft",
      socials: [], skills: [], badges: [], projects: [], friends: [],
      sections: [
        { id: crypto.randomUUID(), type: "about", title: "About Me", visible: true },
        { id: crypto.randomUUID(), type: "friends", title: "Friends", visible: true }
      ],
      music: { title: "", artist: "", cover: "", audio: "", mime: "", size: 0 },
      avatarFrame: "none", avatarFrameColor: "#8b5cf6", avatarFrameGlow: 35, avatarFrameWidth: 3,
      stats: { views: 0 }, likes: { count: 0, users: [] },
      createdAt: now, updatedAt: now
    };
    const privateData = { birthDate, friendRequests: { incoming: [], outgoing: [] } };
    // Initialize the profile through a server-only RPC. This keeps the signup
    // path compatible with the profile-write guard used by hardened databases
    // while still ensuring the browser never receives elevated write access.
    const { error: profileError } = await admin.rpc("rivo_initialize_profile", {
      p_id: auth.user.id,
      p_username: username,
      p_auth_email: syntheticEmail,
      p_public_data: publicData,
      p_private_data: privateData
    });
    if (profileError) {
      await admin.auth.admin.deleteUser(auth.user.id);
      if (/duplicate|unique|profiles_username_check/i.test(profileError.message || "")) {
        return json({ error: "That username is already taken." }, 409);
      }
      console.error("rivo-signup profile initialization failed", profileError);
      return json({ error: "Account could not be initialized. Please try again." }, 500);
    }

    return json({ ok: true, username });
  } catch (error) {
    console.error("rivo-signup error", error);
    return json({ error: error instanceof Error ? error.message : "Could not create account" }, 500);
  }
});
