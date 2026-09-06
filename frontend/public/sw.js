/* Vault offline shell.
 *
 * The data already lives in this browser; the only thing standing between
 * the installed PWA and full offline is the app shell itself. Strategy:
 *  - navigations: network-first, falling back to the last good copy of "/"
 *    (never serves a stale app when online — only rescues the offline case)
 *  - same-origin static assets (/_next/static is content-hashed, plus icons,
 *    fonts CSS passthrough, and the OCR engine): cache-first
 * Bump VERSION to invalidate everything after a breaking deploy.
 */
const VERSION = "vault-shell-v2";   // v2: light theme-color manifest must replace the cached dark one
const STATIC = /^\/(_next\/static\/|icons\/|ocr\/|icon\.svg$|apple-icon\.png$|manifest\.webmanifest$)/;

self.addEventListener("install", (e) => {
  /* precache the shell immediately — otherwise a first-visit user who goes
   * offline before a second navigation has no fallback */
  e.waitUntil(
    caches.open(VERSION).then((c) => c.addAll(["/"])).catch(() => {})
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Clerk, fonts, Ollama: untouched

  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put("/", copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match("/"))
    );
    return;
  }

  if (STATIC.test(url.pathname)) {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
            }
            return res;
          })
      )
    );
  }
});
