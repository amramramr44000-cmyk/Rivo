import { createClient } from "npm:@supabase/supabase-js@2";
import { AccessToken } from "npm:livekit-server-sdk@2.18.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authorization = req.headers.get("Authorization") || "";
    if (!authorization.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !supabaseAnonKey) return json({ error: "Supabase configuration is missing" }, 500);

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authorization } },
    });

    const { data, error: authError } = await supabase.auth.getUser();
    if (authError || !data.user) return json({ error: "Unauthorized" }, 401);

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }

    const roomName = typeof body.roomName === "string" ? body.roomName.trim() : "";
    if (!roomName || roomName.length > 120) return json({ error: "Invalid roomName" }, 400);

    const livekitUrl = Deno.env.get("LIVEKIT_URL");
    const livekitApiKey = Deno.env.get("LIVEKIT_API_KEY");
    const livekitApiSecret = Deno.env.get("LIVEKIT_API_SECRET");

    if (!livekitUrl || !livekitApiKey || !livekitApiSecret) {
      return json({ error: "LiveKit is not configured on the server" }, 500);
    }

    const suppliedName = typeof body.participantName === "string" ? body.participantName.trim() : "";
    const metadataName = typeof data.user.user_metadata?.username === "string"
      ? data.user.user_metadata.username.trim()
      : "";
    const participantName = (suppliedName || metadataName || data.user.id).slice(0, 80);

    const accessToken = new AccessToken(livekitApiKey, livekitApiSecret, {
      identity: data.user.id,
      name: participantName,
      ttl: "15m",
    });

    accessToken.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    const participantToken = await accessToken.toJwt();

    return json({
      server_url: livekitUrl,
      participant_token: participantToken,
    });
  } catch (error) {
    console.error("rivo-livekit-token error", error);
    return json({
      error: error instanceof Error ? error.message : "Internal server error",
    }, 500);
  }
});
