const CACHE_NAME = 'teleprompter-player-v0.4.1-single-dir';
const RUNTIME_CACHE = 'teleprompter-runtime-v0.4.1-single-dir';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './storage.js',
  './google-drive.js',
  './sync-safety.js',
  './face-controls.js',
  './speech-controls.js',
  './app.js',
  './manifest.webmanifest',
  './icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  const keep = new Set([CACHE_NAME, RUNTIME_CACHE]);
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => !keep.has(key)).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const requestUrl = new URL(event.request.url);
  if (!/^https?:$/.test(requestUrl.protocol)) return;

  const sameOrigin = requestUrl.origin === self.location.origin;
  const mediaPipeRuntime = requestUrl.hostname === 'cdn.jsdelivr.net' && requestUrl.pathname.includes('/@mediapipe/tasks-vision@');
  const mediaPipeModel = requestUrl.hostname === 'storage.googleapis.com' && requestUrl.pathname.includes('/mediapipe-models/face_landmarker/');

  if (!sameOrigin && !mediaPipeRuntime && !mediaPipeModel) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (!response || (!response.ok && response.type !== 'opaque')) return response;
        const copy = response.clone();
        caches.open(sameOrigin ? CACHE_NAME : RUNTIME_CACHE)
          .then((cache) => cache.put(event.request, copy))
          .catch(() => {});
        return response;
      });
    })
  );
});
