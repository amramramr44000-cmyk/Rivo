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

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

function randomInt(max: number) {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] % max;
}

function makeCode() {
  const length = 4 + randomInt(3); // 4–6 chars
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[randomInt(alphabet.length)];
  return out;
}

async function sha256(value: string) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hashIp(ip: string) { return sha256(`rivo-captcha-ip:${ip}`); }

function captchaSvg(code: string) {
  const w = 180, h = 68;
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`);
  parts.push(`<defs><filter id="soft"><feTurbulence type="fractalNoise" baseFrequency="0.88" numOctaves="2" seed="${randomInt(9999)}"/><feDisplacementMap in="SourceGraphic" scale="3"/></filter><filter id="tiny"><feGaussianBlur stdDeviation="0.28"/></filter></defs>`);
  parts.push(`<rect width="180" height="68" rx="12" fill="#121722"/>`);
  // layered anti-OCR clutter, while retaining human readability
  for (let i = 0; i < 18; i++) {
    const x = randomInt(w), y = 8 + randomInt(h - 16);
    const r = 0.5 + randomInt(15) / 10;
    const opacity = (0.12 + randomInt(22) / 100).toFixed(2);
    parts.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="#ffffff" opacity="${opacity}"/>`);
  }
  for (let i = 0; i < 7; i++) {
    const y = 7 + randomInt(h - 14);
    const y2 = 7 + randomInt(h - 14);
    parts.push(`<path d="M${randomInt(8)},${y} Q${40+randomInt(100)},${randomInt(h)} ${w-randomInt(8)},${y2}" stroke="#7e8aa8" stroke-opacity=".${1+randomInt(4)}" stroke-width="${1+randomInt(2)}" fill="none"/>`);
  }
  const gap = 27;
  const start = (w - ((code.length - 1) * gap + 25)) / 2;
  [...code].forEach((ch, i) => {
    const x = start + i * gap;
    const y = 44 + randomInt(6);
    const rot = -13 + randomInt(27);
    const skew = -8 + randomInt(17);
    parts.push(`<g transform="translate(${x} ${y}) rotate(${rot}) skewX(${skew})"><text x="0" y="0" font-family="Arial,sans-serif" font-size="29" font-weight="800" fill="#f3f6ff" filter="url(#tiny)">${ch}</text></g>`);
  });
  parts.push(`<rect x="1" y="1" width="178" height="66" rx="11" fill="none" stroke="#ffffff" stroke-opacity=".08"/>`);
  parts.push(`</svg>`);
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(parts.join(""))}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL");
    const service = Deno.env.get("SERVICE_ROLE_KEY");
    if (!url || !service) return json({ error: "Server configuration is missing" }, 500);
    const admin = createClient(url, service);
    const ip = (req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown").split(",")[0].trim().slice(0, 120);
    const ipHash = await hashIp(ip);

    const { count, error: countError } = await admin
      .from("rivo_captcha_challenges")
      .select("id", { count: "exact", head: true })
      .eq("ip_hash", ipHash)
      .gte("created_at", new Date(Date.now() - 10 * 60 * 1000).toISOString());
    if (countError) return json({ error: "Security service is unavailable" }, 503);
    if ((count || 0) >= 12) return json({ error: "Too many verification attempts. Please try again later." }, 429);

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { body = {}; }
    const action = String(body.action || "create").toLowerCase();

    if (action === "verify") {
      const challengeId = String(body.challengeId || "").trim();
      const captchaCode = String(body.captchaCode || "");
      if (!challengeId || !/^[0-9a-f-]{36}$/i.test(challengeId) || !/^[A-Za-z0-9]{4,6}$/.test(captchaCode)) {
        return json({ error: "Enter the verification code." }, 400);
      }
      const { data: cap, error: capError } = await admin
        .from("rivo_captcha_challenges")
        .select("id,code_hash,expires_at,used_at,verified_at,verification_token_hash,attempts")
        .eq("id", challengeId).maybeSingle();
      if (capError || !cap) return json({ error: "Verification expired. Request a new code." }, 400);
      if (cap.used_at || new Date(cap.expires_at).getTime() < Date.now()) return json({ error: "Verification expired. Request a new code." }, 400);
      if (cap.verified_at && cap.verification_token_hash) return json({ error: "This verification was already completed. Request a new code." }, 400);
      if (Number(cap.attempts || 0) >= 5) return json({ error: "Too many attempts. Request a new code." }, 429);
      const expected = await sha256(`rivo-captcha:${challengeId}:${captchaCode}`);
      if (expected !== cap.code_hash) {
        await admin.from("rivo_captcha_challenges").update({ attempts: Number(cap.attempts || 0) + 1 }).eq("id", challengeId).is("used_at", null);
        return json({ error: "The verification code is incorrect." }, 400);
      }
      const verificationToken = crypto.randomUUID() + crypto.randomUUID();
      const tokenHash = await sha256(`rivo-captcha-token:${challengeId}:${verificationToken}`);
      const { data: updated, error: updateError } = await admin
        .from("rivo_captcha_challenges")
        .update({ verified_at: new Date().toISOString(), verification_token_hash: tokenHash, attempts: Number(cap.attempts || 0) + 1 })
        .eq("id", challengeId).is("used_at", null).is("verified_at", null)
        .select("id").maybeSingle();
      if (updateError || !updated) return json({ error: "Verification is no longer valid. Request a new code." }, 400);
      return json({ ok: true, challengeId, verificationToken });
    }

    const code = makeCode();
    const challengeId = crypto.randomUUID();
    const codeHash = await sha256(`rivo-captcha:${challengeId}:${code}`);
    const expiresAt = new Date(Date.now() + 2 * 60 * 1000).toISOString();

    const { error: insertError } = await admin.from("rivo_captcha_challenges").insert({
      id: challengeId, code_hash: codeHash, expires_at: expiresAt, ip_hash: ipHash
    });
    if (insertError) return json({ error: "Could not create verification challenge" }, 500);

    return json({ challengeId, image: captchaSvg(code), expiresAt });
  } catch (error) {
    console.error("rivo-signup-captcha error", error);
    return json({ error: "Security service failed" }, 500);
  }
});
