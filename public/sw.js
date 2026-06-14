const CACHE = 'ddd-v1';
const ASSETS = ['.', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  // never cache API calls
  if (['/report', '/stats', '/reports', '/health'].some(p => u.pathname.endsWith(p))) return;
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
