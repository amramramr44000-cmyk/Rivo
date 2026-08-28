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
  challengeBits: 17
};
