// Notes Service Worker: App-Hülle offline verfügbar (Daten liegen in IndexedDB)
const CACHE = 'notes-v2';
const LIBS = [
  'https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.11/katex.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.10.0/highlight.min.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => Promise.all([c.add(new Request('/', { credentials: 'same-origin' })).catch(() => {}), ...LIBS.map((u) => c.add(new Request(u, { mode: 'cors' })).catch(() => {}))]))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin && url.pathname.startsWith('/api/')) return; // API nie cachen
  if (req.mode === 'navigate') {
    // Netzwerk zuerst (Access-Login muss durchgehen), offline die gespeicherte App
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put('/', copy));
          }
          return res;
        })
        .catch(() => caches.match('/'))
    );
    return;
  }
  if (LIBS.includes(req.url) || (url.origin === location.origin && url.pathname.startsWith('/icons/'))) {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          })
      )
    );
  }
});
