import { createClient } from "npm:@supabase/supabase-js@2";
import { AccessToken, RoomServiceClient, trackSourceToString } from "npm:livekit-server-sdk@2.18.0";

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

function livekitHttpUrl(value: string) {
  const v = value.trim();
  if (v.startsWith("wss://")) return `https://${v.slice(6)}`;
  if (v.startsWith("ws://")) return `http://${v.slice(5)}`;
  return v.replace(/^https?:\/\//, (m) => m);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authorization = req.headers.get("Authorization") || "";
    const bearerToken = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
    if (!bearerToken) return json({ error: "A valid Rivo login session is required." }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const livekitUrl = Deno.env.get("LIVEKIT_URL");
    const livekitApiKey = Deno.env.get("LIVEKIT_API_KEY");
    const livekitApiSecret = Deno.env.get("LIVEKIT_API_SECRET");
    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) return json({ error: "Supabase configuration is missing" }, 500);
    if (!livekitUrl || !livekitApiKey || !livekitApiSecret) return json({ error: "LiveKit is not configured on the server" }, 500);

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);

    // Validate the exact bearer token supplied by the client. Do not rely on
    // browser/session storage inside this stateless Edge Function.
    const { data, error: authError } = await supabase.auth.getUser(bearerToken);
    if (authError || !data.user) {
      console.warn("rivo-livekit-token rejected user token", authError?.status || null, authError?.code || null);
      return json({ error: "Your Rivo login session is invalid or expired. Please sign in again." }, 401);
    }

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }

    // Backend-only participant moderation. The browser never receives LiveKit
    // API credentials; all roomAdmin operations stay here.
    const action = typeof body.action === "string" ? body.action.trim().toLowerCase() : "";
    if (action && ["kick_member", "mute_member", "unmute_member"].includes(action)) {
      const communityId = Number(body.communityId);
      const username = typeof body.username === "string" ? body.username.trim() : "";
      if (!Number.isFinite(communityId) || communityId <= 0 || !username) return json({ error: "Invalid moderation request" }, 400);

      const rpcAction = action === "kick_member" ? "kick" : action === "mute_member" ? "mute" : "unmute";
      const { data: prepared, error: prepError } = await supabase.rpc("rivo_prepare_community_voice_moderation", {
        p_id: communityId,
        p_username: username,
        p_action: rpcAction,
      });
      if (prepError) return json({ error: prepError.message || "Moderation permission denied" }, 403);

      const roomName = typeof prepared?.room_name === "string" ? prepared.room_name : "";
      const targetIdentity = typeof prepared?.target_user_id === "string" ? prepared.target_user_id : "";
      if (roomName && targetIdentity) {
        const rooms = new RoomServiceClient(livekitHttpUrl(livekitUrl), livekitApiKey, livekitApiSecret);
        if (rpcAction === "kick") {
          try {
            await rooms.removeParticipant(roomName, targetIdentity, { revokeTokenTs: BigInt(Math.floor(Date.now() / 1000) - 5) });
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            if (!/not found|does not exist|participant/i.test(msg)) throw error;
          }
        } else {
          try {
            const shouldMute = rpcAction === "mute";
            await rooms.updateParticipant(roomName, targetIdentity, {
              permission: { canPublish: !shouldMute, canSubscribe: true, canPublishData: true },
            });
            const participant = await rooms.getParticipant(roomName, targetIdentity);
            const audioTracks = (participant.tracks || []).filter((t: any) => {
              try { return trackSourceToString(t.source) === "microphone" || trackSourceToString(t.source) === "screen_share_audio"; }
              catch { return String(t.source || "").toLowerCase().includes("microphone") || String(t.type || "").toLowerCase().includes("audio"); }
            });
            for (const track of audioTracks) {
              if (track.sid) { try { await rooms.mutePublishedTrack(roomName, targetIdentity, track.sid, shouldMute); } catch {} }
            }
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            if (!/not found|does not exist|participant/i.test(msg)) throw error;
          }
        }
      }

      return json({ ok: true, action: rpcAction, room_name: roomName || null });
    }

    const presenceAction = typeof body.action === "string" ? body.action.trim().toLowerCase() : "";
    if (presenceAction === "sync_presence") {
      const roomNameForPresence = typeof body.roomName === "string" ? body.roomName.trim() : "";
      const communityId = Number(body.communityId);
      if (!roomNameForPresence || roomNameForPresence.length > 120 || !Number.isFinite(communityId) || communityId <= 0) {
        return json({ error: "Invalid presence request" }, 400);
      }
      const { data: allowed } = await supabase.rpc("rivo_can_join_community_voice", { p_room_name: roomNameForPresence });
      if (allowed !== true) return json({ error: "You are not a member of this community voice room." }, 403);
      const expectedPrefix = `rivo-community-${communityId}-`;
      if (!roomNameForPresence.startsWith(expectedPrefix)) return json({ error: "Community voice room mismatch" }, 400);
      const rooms = new RoomServiceClient(livekitHttpUrl(livekitUrl), livekitApiKey, livekitApiSecret);
      let count = 0;
      let roomExists = true;
      try {
        const participants = await rooms.listParticipants(roomNameForPresence);
        count = participants.length;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (/not found|does not exist/i.test(msg)) { count = 0; roomExists = false; } else throw error;
      }
      if (count === 0) {
        // Give the starter a tiny connection window so a newly-created room is
        // not closed between the DB insert and the first LiveKit join.
        const { data: sessionRow } = await supabaseAdmin
          .from("rivo_community_voice_sessions")
          .select("created_at")
          .eq("room_name", roomNameForPresence)
          .eq("status", "active")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const createdMs = sessionRow?.created_at ? Date.parse(sessionRow.created_at) : 0;
        const oldEnough = !createdMs || (Date.now() - createdMs) >= 2000;
        if (!oldEnough) return json({ ok: true, participants: 0, ended: false, pending: true });

        const { data: ended, error: endError } = await supabaseAdmin.rpc("rivo_cleanup_empty_community_voice", { p_room_name: roomNameForPresence });
        if (endError) return json({ error: endError.message || "Could not close empty voice room" }, 500);
        if (roomExists && ended === true) {
          try { await rooms.deleteRoom(roomNameForPresence); }
          catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            if (!/not found|does not exist/i.test(msg)) throw error;
          }
        }
        return json({ ok: true, participants: 0, ended: ended === true });
      }
      return json({ ok: true, participants: count, ended: false });
    }

    const roomName = typeof body.roomName === "string" ? body.roomName.trim() : "";
    if (!roomName || roomName.length > 120) return json({ error: "Invalid roomName" }, 400);

    // Direct-call room names are not authorization. Require a live DB session
    // linking the authenticated user to the call before minting any token.
    // Community rooms use their own membership and moderation RPCs below.
    if (!roomName.startsWith("rivo-community-")) {
      if (!/^rivo-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(roomName)) {
        return json({ error: "Invalid direct-call room" }, 400);
      }
      const { data: callSession, error: callSessionError } = await supabaseAdmin
        .from("rivo_call_sessions")
        .select("room_name, caller_id, callee_id, status, expires_at")
        .eq("room_name", roomName)
        .maybeSingle();
      if (callSessionError) {
        console.error("Direct call session lookup failed", callSessionError.message);
        return json({ error: "Call authorization is not ready. Apply the Rivo v4 call security migration and retry." }, 503);
      }
      const isParticipant = !!callSession &&
        (callSession.caller_id === data.user.id || callSession.callee_id === data.user.id);
      const isLive = !!callSession &&
        String(callSession.status) === "active" &&
        Date.parse(String(callSession.expires_at || "")) > Date.now();
      if (!isParticipant || !isLive || callSession.room_name !== roomName) {
        return json({ error: "You are not authorized to join this direct call." }, 403);
      }
    }

    let isCommunityRoom = false;
    let forcedMute = false;
    if (roomName.startsWith("rivo-community-")) {
      isCommunityRoom = true;
      const { data: state, error: stateError } = await supabase.rpc("rivo_get_community_voice_member_state", { p_room_name: roomName });
      if (stateError || state?.allowed !== true) return json({ error: "You are not allowed to join this community voice room." }, 403);
      forcedMute = state?.muted === true;
    }

    const participantName = (() => {
      const suppliedName = typeof body.participantName === "string" ? body.participantName.trim() : "";
      const metadataName = typeof data.user.user_metadata?.username === "string" ? data.user.user_metadata.username.trim() : "";
      return (suppliedName || metadataName || data.user.id).slice(0, 80);
    })();

    // Every newly created community voice room is hard-capped at five participants.
    // The room is created before the participant token is minted, so LiveKit itself
    // enforces the limit rather than trusting a browser-side counter.
    if (isCommunityRoom) {
      const rooms = new RoomServiceClient(livekitHttpUrl(livekitUrl), livekitApiKey, livekitApiSecret);
      try {
        const existing = await rooms.listRooms([roomName]);
        if (!existing.length) {
          await rooms.createRoom({ name: roomName, emptyTimeout: 10, departureTimeout: 5, maxParticipants: 5 });
        }
        const participants = await rooms.listParticipants(roomName);
        if (participants.length >= 5 && !participants.some((p) => p.identity === data.user.id)) {
          return json({ error: "This voice room is full (5 people maximum)." }, 409);
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (!/already exists|already-exists|conflict/i.test(msg)) throw error;
      }
    }

    const accessToken = new AccessToken(livekitApiKey, livekitApiSecret, {
      identity: data.user.id,
      name: participantName,
      ttl: "15m",
    });

    accessToken.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: !forcedMute,
      canSubscribe: true,
      canPublishData: true,
    });

    const participantToken = await accessToken.toJwt();
    return json({ server_url: livekitUrl, participant_token: participantToken, voice_muted: forcedMute, max_participants: isCommunityRoom ? 5 : null });
  } catch (error) {
    console.error("rivo-livekit-token error", error);
    return json({ error: error instanceof Error ? error.message : "Internal server error" }, 500);
  }
});
