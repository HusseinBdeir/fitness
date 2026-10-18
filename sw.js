/* Fitness PWA service worker, v10.2 (2026-10-18).
   App shell: network first, cache fallback (a deploy shows on the next open; the gym basement still opens the app).
   Google Fonts: cache first (the typography survives offline). The cloud sync is POST and never touches this worker. */
const CACHE = "ubp-pwa-v10.2";
const SHELL = [
  "./",
  "./index.html",
  "./manifest.json?v=10.2",
  "./icon.svg?v=10.2",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-512-maskable.png",
  "./icon-180.png?v=10.2"
];
const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.all(SHELL.map(u => c.add(new Request(u, { cache: "reload" })).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (FONT_HOSTS.includes(url.hostname)) {
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        if (res && (res.ok || res.type === "opaque")) { const clone = res.clone(); caches.open(CACHE).then(c => c.put(req, clone)).catch(() => {}); }
        return res;
      }))
    );
    return;
  }
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then(res => {
        if (res && res.ok) { const clone = res.clone(); caches.open(CACHE).then(c => c.put(req, clone)).catch(() => {}); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then(hit => {
        if (hit) return hit;
        if (req.mode === "navigate") return caches.match("./index.html", { ignoreSearch: true }).then(h => h || caches.match("./", { ignoreSearch: true }));
        return Response.error();
      }))
  );
});
