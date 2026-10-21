/* Fitness PWA service worker, v14.4 (2026-10-21).
   App shell: network first (no-cache for navigations), cache fallback on offline or non-OK response.
   Google Fonts: cache first (the typography survives offline).
   Web Push: RFC 8291 aes128gcm push listener + Home Screen Badging API (navigator.setAppBadge) + notificationclick focus/open + local SW notification fallback. */
const CACHE = "ubp-pwa-v14.4";
const NOTIF_CACHE = "ubp-notif-cache-v1";
const UNREAD_NOTIFS_URL = "./__ubp_unread_notifs.json";
const SHELL = [
  "./",
  "./index.html",
  "./manifest.json?v=14.4",
  "./icon.svg?v=14.4",
  "./icon-192.png?v=14.4",
  "./icon-512.png?v=14.4",
  "./icon-512-maskable.png?v=14.4",
  "./icon-180.png?v=14.4"
];
const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];

function applySwAppBadge(count) {
  const n = Math.max(0, Number(count) || 0);
  try {
    if (self.navigator && typeof self.navigator.setAppBadge === "function" && typeof self.navigator.clearAppBadge === "function") {
      return n > 0 ? self.navigator.setAppBadge(n).catch(() => {}) : self.navigator.clearAppBadge().catch(() => {});
    }
  } catch (e) {}
  return Promise.resolve();
}

async function readUnreadNotifsFromCache() {
  try {
    const c = await caches.open(NOTIF_CACHE);
    const res = await c.match(UNREAD_NOTIFS_URL);
    if (!res) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch (e) {
    return [];
  }
}

async function writeUnreadNotifsToCache(items) {
  try {
    const clean = (Array.isArray(items) ? items : []).slice(0, 60);
    const c = await caches.open(NOTIF_CACHE);
    await c.put(UNREAD_NOTIFS_URL, new Response(JSON.stringify(clean), {
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
    }));
    const unread = clean.filter(x => x && !x.checked).length;
    await applySwAppBadge(unread);
    return clean;
  } catch (e) {
    return [];
  }
}

async function upsertSwUnreadNotif(item) {
  const list = await readUnreadNotifsFromCache();
  const id = String((item && (item.id || item.tag)) || ("ubp-" + Date.now()));
  const idx = list.findIndex(x => x && (x.id === id || (item.tag && x.tag === item.tag)));
  const entry = Object.assign({ id, ts: Date.now(), checked: false }, item || {}, { id, checked: false });
  if (idx >= 0) list[idx] = entry;
  else list.unshift(entry);
  return writeUnreadNotifsToCache(list);
}

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
      .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== NOTIF_CACHE).map(k => caches.delete(k))))
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
  if (url.pathname.endsWith(".shortcut") || url.pathname.endsWith("__ubp_unread_notifs.json")) return;
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
  const notifId = String(d.id || d.tag || ("ubp-notif-" + Date.now()));
  return {
    body: d.body || "Tap to open Upper Body Programme.",
    icon: "./icon-192.png",
    badge: "./icon-192.png",
    tag: d.tag || notifId,
    renotify: true,
    vibrate: [180, 80, 180, 80, 260],
    data: { url: d.url || "./", tab: d.tab || "today", notifId }
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
  const notifEntry = {
    id: opts.data.notifId,
    tag: opts.tag,
    title,
    body: opts.body,
    tab: opts.data.tab,
    url: opts.data.url,
    ts: Date.now(),
    checked: false
  };
  e.waitUntil(
    Promise.all([
      upsertSwUnreadNotif(notifEntry),
      self.registration.showNotification(title, opts),
      self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
        list.forEach(c => { try { c.postMessage({ type: "ubp-push", payload: Object.assign({}, d, notifEntry) }); } catch (x) {} });
      }).catch(() => {})
    ])
  );
});

self.addEventListener("message", e => {
  const m = e.data;
  if (!m) return;
  if (m.type === "sync-unread-notifs") {
    e.waitUntil(writeUnreadNotifsToCache(m.items || []));
    return;
  }
  if (m.type === "set-app-badge") {
    e.waitUntil(applySwAppBadge(m.count || 0));
    return;
  }
  if (m.type !== "show-notification") return;
  const d = m.payload || {};
  const title = d.title || "Upper Body Programme";
  const opts = buildNotifOptions(d);
  e.waitUntil(
    Promise.all([
      upsertSwUnreadNotif({ id: opts.data.notifId, tag: opts.tag, title, body: opts.body, tab: opts.data.tab, ts: Date.now(), checked: false }),
      self.registration.showNotification(title, opts)
    ])
  );
});

self.addEventListener("notificationclick", e => {
  e.notification.close();
  const data = (e.notification && e.notification.data) || {};
  const targetUrl = data.url || "./";
  const targetTab = data.tab || "today";
  const notifId = data.notifId || (e.notification && e.notification.tag) || "";
  e.waitUntil(
    (async () => {
      if (notifId) {
        const list = await readUnreadNotifsFromCache();
        list.forEach(x => { if (x && (x.id === notifId || x.tag === notifId)) x.checked = true; });
        await writeUnreadNotifsToCache(list);
      }
      const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of list) {
        if ("focus" in c) {
          try { c.postMessage({ type: "ubp-nav", tab: targetTab, notifCheckedId: notifId }); } catch (x) {}
          return c.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })()
  );
});
