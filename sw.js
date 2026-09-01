const CACHE = "rivo-shell-v27";
const ASSETS = [
  "./", "./index.html", "./css/style.css", "./js/core.js", "./js/app.js", "./js/supabase-config.js",
  "./pages/login.html", "./pages/signup.html", "./pages/profile.html", "./pages/explore.html", "./pages/friends.html", "./pages/messages.html", "./pages/posts.html", "./pages/communities.html", "./pages/community.html", "./pages/editor.html", "./pages/settings.html", "./pages/admin.html",
  "./manifest.webmanifest", "./assets/icon-192.png", "./assets/icon-512.png"
];

self.addEventListener("install", event => event.waitUntil(
  caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())
));

self.addEventListener("activate", event => event.waitUntil(
  caches.keys().then(keys =>
    Promise.all(keys.filter(k => k.startsWith("rivo-shell-") && k !== CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim())
));

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;
  const isCodeOrPage = /\.(?:js|html)$/i.test(url.pathname);
  event.respondWith(
    (isCodeOrPage ? fetch(event.request, { cache: "no-store" }) : caches.match(event.request))
      .then(res => {
        if (res) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(event.request, copy)).catch(() => {});
          return res;
        }
        return fetch(event.request);
      })
      .catch(() => caches.match(event.request).then(cached => cached || caches.match("./index.html")))
  );
});
