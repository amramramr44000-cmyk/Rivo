/* Rivo / Supabase public browser configuration.
   Replace both values with the Project URL and the anon/public key
   from Supabase -> Project Settings -> API.
   NEVER put a service_role/secret key in this file.
*/
window.RIVO_SUPABASE = {
  url: "https://stfjcrcualeggmiygqur.supabase.co",
  anonKey: "sb_publishable_qk-z6tDGDPwG-sFck7xAlQ_84XGMhrv"
};

/*
  Security / anti-bot configuration.
  Create a Cloudflare Turnstile site key for the exact production hostname,
  paste it here, and enable CAPTCHA protection in Supabase Auth.
  NEVER put the Turnstile secret key in this file.
*/
window.RIVO_SECURITY = {
  provider: "turnstile",
  siteKey: "",
  requireCaptcha: true
};
