const CACHE = 'ddd-v2';
const ASSETS = ['.', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  // never cache API / coordination calls
  if (['/report', '/stats', '/reports', '/health', '/cmd'].some(p => u.pathname.includes(p))) return;
  const isDoc = e.request.mode === 'navigate' || u.pathname.endsWith('/') || u.pathname.endsWith('index.html');
  if (isDoc) {
    // network-first for the app page: always get the freshest version, fall back to cache offline
    e.respondWith(
      fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(ca => ca.put(e.request, c)); return r; })
        .catch(() => caches.match(e.request))
    );
  } else {
    // cache-first for static icons/manifest
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
  }
});
