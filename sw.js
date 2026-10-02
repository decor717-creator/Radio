const CACHE = 'my-radio-shell-v12';
const SHELL = [
  './', './index.html', './styles.css?v=5', './app.js?v=12', './metadata.js?v=1',
  './manifest.webmanifest', './icon-192.png', './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('my-radio-shell-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (!SHELL.some(file => new URL(file, self.location.href).pathname === url.pathname)) return;

  // App files: prefer a fresh response so installed PWAs receive fixes immediately.
  // If offline, fall back to the cached shell.
  event.respondWith(
    fetch(req)
      .then(response => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(req, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        if (req.mode === 'navigate') return caches.match('./index.html');
        throw new Error('Offline and resource not cached');
      })
  );
});
