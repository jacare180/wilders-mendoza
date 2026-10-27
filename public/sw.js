// Offline: the app shell and fonts come from the cache when there is no signal.
// The trip data itself is kept by the page (localStorage), and changes made offline wait in a queue there.
const V = "wilders-v1";
const SHELL = ["/", "/manifest.webmanifest", "/icon-192.png", "/apple-touch-icon.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // the page: network first (always the newest version with signal), cached copy without it
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).then((r) => { const copy = r.clone(); caches.open(V).then((c) => c.put("/", copy)); return r; })
        .catch(() => caches.match("/"))
    );
    return;
  }
  // fonts and photos never change: cache first
  if (url.host === "fonts.googleapis.com" || url.host === "fonts.gstatic.com" || url.pathname.startsWith("/api/photo/") || url.pathname.startsWith("/hoteis/")) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((r) => { const copy = r.clone(); caches.open(V).then((c) => c.put(req, copy)); return r; }))
    );
    return;
  }
  // icons and the manifest
  if (url.origin === location.origin && !url.pathname.startsWith("/api/")) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
  }
});
