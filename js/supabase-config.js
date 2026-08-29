/* Rivo / Supabase public browser configuration.
   Replace values with the Project URL and anon/public key from
   Supabase -> Project Settings -> API. NEVER put a service_role key here.
*/
window.RIVO_SUPABASE = {
  url: "https://stfjcrcualeggmiygqur.supabase.co",
  anonKey: "sb_publishable_qk-z6tDGDPwG-sFck7xAlQ_84XGMhrv"
};

/*
  Rivo Human Check
  A local, layered anti-automation gate. It intentionally uses no third-party
  CAPTCHA provider. It is paired with Supabase Auth, honeypots, interaction
  timing and client-side challenge work. For strongest production protection,
  add server-side rate limits / edge verification later.
*/
window.RIVO_SECURITY = {
  requireHumanCheck: true,
  minInteractionMs: 1500,
  challengeBits: 17,
  signupCaptchaEndpoint: "https://stfjcrcualeggmiygqur.supabase.co/functions/v1/rivo-signup-captcha"
};

/*
  Rivo Calls networking.
  The app will request short-lived TURN credentials from this HTTPS endpoint.
  Keep all TURN API keys on the server/Edge Function; never put them here.
*/
window.RIVO_CALL_CONFIG = {
  tokenUrl: "https://stfjcrcualeggmiygqur.supabase.co/functions/v1/rivo-livekit-token"
};
