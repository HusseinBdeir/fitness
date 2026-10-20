/* Fitness PWA service worker, v14.0 (2026-10-20).
   App shell: network first (no-cache for navigations), cache fallback on offline or non-OK response.
   Google Fonts: cache first (the typography survives offline).
   Web Push: RFC 8291 aes128gcm push listener + notificationclick focus/open + local SW notification fallback. */
const CACHE = "ubp-pwa-v14.0";
const SHELL = [
  "./",
  "./index.html",
  "./manifest.json?v=14.0",
  "./icon.svg?v=14.0",
  "./icon-192.png?v=14.0",
  "./icon-512.png?v=14.0",
  "./icon-512-maskable.png?v=14.0",
  "./icon-180.png?v=14.0"
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

function matchCachedShell(req) {
  return caches.match(req, { ignoreSearch: true }).then(hit => {
    if (hit) return hit;
    if (req.mode === "navigate") return caches.match("./index.html", { ignoreSearch: true }).then(h => h || caches.match("./", { ignoreSearch: true }));
    return null;
  });
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.pathname.endsWith(".shortcut")) return;
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
  const fetchOpts = req.mode === "navigate" ? { cache: "no-cache" } : undefined;
  e.respondWith(
    fetch(req, fetchOpts)
      .then(res => {
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(req, clone)).catch(() => {});
          return res;
        }
        return matchCachedShell(req).then(hit => hit || res);
      })
      .catch(() => matchCachedShell(req).then(hit => hit || Response.error()))
  );
});

function buildNotifOptions(d) {
  return {
    body: d.body || "Tap to open Upper Body Programme.",
    icon: "./icon-192.png",
    badge: "./icon-192.png",
    tag: d.tag || "ubp-notif",
    renotify: true,
    vibrate: [180, 80, 180, 80, 260],
    data: { url: d.url || "./", tab: d.tab || "today" }
  };
}

self.addEventListener("push", e => {
  let d = {};
  if (e.data) {
    try { d = e.data.json(); }
    catch (err) { try { d = { title: "Upper Body Programme", body: e.data.text() }; } catch (x) {} }
  }
  const title = d.title || "Upper Body Programme";
  const opts = buildNotifOptions(d);
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      list.forEach(c => { try { c.postMessage({ type: "ubp-push", payload: d }); } catch (x) {} });
      return self.registration.showNotification(title, opts);
    })
  );
});

self.addEventListener("message", e => {
  const m = e.data;
  if (!m || m.type !== "show-notification") return;
  const d = m.payload || {};
  e.waitUntil(self.registration.showNotification(d.title || "Upper Body Programme", buildNotifOptions(d)));
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const data = (e.notification && e.notification.data) || {};
  const targetUrl = data.url || "./";
  const targetTab = data.tab || "today";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if ("focus" in c) {
          try { c.postMessage({ type: "ubp-nav", tab: targetTab }); } catch (x) {}
          return c.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
