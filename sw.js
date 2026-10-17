// Offline support.
// - Page navigations: network first, cached copy when offline.
// - Other files: served from cache immediately and refreshed in the background
//   (stale-while-revalidate), so updates arrive on the next open without
//   needing a manual cache bump.
// - Only successful responses are ever cached.
//
// Bump CACHE when the list of files changes.

const CACHE = 'drlotto-v19';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/app.js',
  './js/config.js',
  './js/dom.js',
  './js/picker.js',
  './js/status.js',
  './js/storage.js',
  './js/luckyPick.js',
  './js/resultsParser.js',
  './js/ticketParser.js',
  './js/validation.js',
  './icons/favicon.png',
  './icons/logo-180.png',
  './icons/logo-192.png',
  './icons/logo-512.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const cacheIfOk = (req, resp) => {
  if (resp && resp.ok && resp.type === 'basic') {
    const copy = resp.clone();
    caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
  }
  return resp;
};

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  // Leave video to the browser: iOS Safari streams it with range requests,
  // which a cached full response would break.
  if (/\.(mp4|mov|webm)$/i.test(new URL(req.url).pathname)) return;

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then(resp => cacheIfOk(req, resp))
        .catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(cached => {
      const network = fetch(req).then(resp => cacheIfOk(req, resp)).catch(() => cached);
      if (cached) event.waitUntil(network.catch(() => {}));
      return cached || network;
    })
  );
});
