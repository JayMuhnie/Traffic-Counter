// Network-first with an offline fallback.
// Safari refuses to show a response that went through a redirect when a service worker serves it
// (Cloudflare Pages redirects /index.html -> /), so any redirected response is rebuilt as a plain one.
const CACHE = 'tmc-v18';
const ASSETS = ['./', 'app.js', 'analysis.js', 'manifest.webmanifest', 'icon-180.png', 'icon-512.png'];

function plain(res) {
  if (!res.redirected) return Promise.resolve(res);
  return res.blob().then(function (b) {
    return new Response(b, { status: res.status, statusText: res.statusText, headers: res.headers });
  });
}

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.all(ASSETS.map(function (u) {
      return fetch(new Request(u, { cache: 'reload' })).then(plain).then(function (r) { if (r.ok) return c.put(u, r); });
    }));
  }));
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  var nav = req.mode === 'navigate';
  e.respondWith(
    fetch(nav ? req.url : req, nav ? { cache: 'reload' } : undefined)
      .then(plain)
      .then(function (res) {
        if (res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(nav ? './' : req, copy); });
        }
        return res;
      })
      .catch(function () {
        return caches.match(nav ? './' : req, { ignoreSearch: true }).then(function (m) { return m || caches.match('./'); });
      })
  );
});
