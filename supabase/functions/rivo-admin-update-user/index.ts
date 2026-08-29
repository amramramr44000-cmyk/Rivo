
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  try {
    const auth = req.headers.get("Authorization") || "";
    if (!auth.startsWith("Bearer ")) throw new Error("Unauthorized");
    const url = Deno.env.get("SUPABASE_URL");
    const anon = Deno.env.get("SUPABASE_ANON_KEY");
    const service = Deno.env.get("SERVICE_ROLE_KEY");
    if (!url || !anon || !service) throw new Error("Server configuration is incomplete");

    const caller = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const { data: me, error: meError } = await caller.auth.getUser();
    if (meError || !me.user) throw new Error("Unauthorized");
    const { data: adminOk, error: adminError } = await caller.rpc("rivo_admin_is_admin", {});
    if (adminError || !adminOk) throw new Error("Access denied");

    const body = await req.json();
    const currentUsername = String(body?.username || "").trim().toLowerCase();
    const newUsername = String(body?.newUsername || "").trim().toLowerCase();
    const displayName = String(body?.displayName || "").trim().slice(0,80);
    const birthDate = String(body?.birthDate || "").trim();
    const newPassword = String(body?.newPassword || "");
    if (!currentUsername || !newUsername) throw new Error("Username is required");
    if (newPassword && newPassword.length < 8) throw new Error("New password must be at least 8 characters");

    const admin = createClient(url, service);
    const { data: oldProfile, error: profileError } = await admin
      .from("profiles")
      .select("id,username,public_data,private_data")
      .eq("username", currentUsername)
      .maybeSingle();
    if (profileError || !oldProfile) throw new Error("User not found");

    const oldDisplayName = String(oldProfile?.public_data?.displayName || oldProfile.username || "").slice(0, 80);
    const oldBirthDate = String(oldProfile?.private_data?.birthDate || "");
    const usernameChanged = newUsername !== currentUsername;
    let authEmailChanged = false;
    let profileChanged = false;
    let passwordChanged = false;
    let updated = null;

    try {
      // Keep Auth and profile username in sync. Auth email is changed first,
      // then the profile row, and finally the password.
      if (usernameChanged) {
        const { error } = await admin.auth.admin.updateUserById(oldProfile.id, {
          email: `${newUsername}@users.rivo.app`
        });
        if (error) throw error;
        authEmailChanged = true;
      }

      const { data, error: updateProfileError } = await caller.rpc("rivo_admin_update_profile", {
        p_current_username: currentUsername,
        p_new_username: newUsername,
        p_display_name: displayName,
        p_birth_date: birthDate || null,
      });
      if (updateProfileError) throw updateProfileError;
      updated = data;
      profileChanged = true;

      if (newPassword) {
        const { error } = await admin.auth.admin.updateUserById(oldProfile.id, { password: newPassword });
        if (error) throw error;
        passwordChanged = true;
      }
    } catch (error) {
      // Roll back reversible profile/Auth-email changes if any later step fails.
      if (profileChanged) {
        try {
          await caller.rpc("rivo_admin_update_profile", {
            p_current_username: newUsername,
            p_new_username: currentUsername,
            p_display_name: oldDisplayName,
            p_birth_date: oldBirthDate || null,
          });
        } catch {}
      }
      if (authEmailChanged) {
        try {
          await admin.auth.admin.updateUserById(oldProfile.id, {
            email: `${currentUsername}@users.rivo.app`
          });
        } catch {}
      }
      throw error;
    }

    return new Response(JSON.stringify({
      ok: true,
      username: updated?.username || newUsername,
      displayName: updated?.display_name || displayName || newUsername,
      birthDate: updated?.birth_date || birthDate || "",
      passwordChanged,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Request failed" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
