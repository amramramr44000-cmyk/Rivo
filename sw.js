const CACHE = "rivo-shell-v5";
const ASSETS = [
  "./", "./index.html", "./css/style.css", "./js/core.js", "./js/app.js", "./js/supabase-config.js",
  "./pages/login.html", "./pages/signup.html", "./pages/profile.html", "./pages/explore.html", "./pages/friends.html", "./pages/messages.html", "./pages/editor.html", "./pages/settings.html", "./pages/admin.html",
  "./manifest.webmanifest", "./assets/icon-192.png", "./assets/icon-512.png"
];
self.addEventListener("install", event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener("activate", event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k=>k.startsWith("rivo-shell-")&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;
  event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request).then(res => { const copy=res.clone(); caches.open(CACHE).then(c=>c.put(event.request,copy)).catch(()=>{}); return res; }).catch(()=>caches.match("./index.html"))));
});
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const target = event.notification.data?.url || "./pages/messages.html";
  event.waitUntil(clients.matchAll({type:"window",includeUncontrolled:true}).then(list => { for (const c of list) { if ("focus" in c) { c.navigate?.(target); return c.focus(); } } return clients.openWindow(target); }));
});
