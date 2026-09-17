const VERSION = '0.1.9';
const CACHE = `office-safety-v${VERSION}`;
const SHELL = [
  './', './index.html', './styles.css', './app.js', './api-bridge.js', './debug.js',
  './config.js', './manifest.webmanifest', './worker.js', './icon-192.png', './icon-512.png',
  './icon-maskable-512.png', './badge-96.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  const isNavigation = request.mode === 'navigate' || url.pathname.endsWith('/index.html') || url.pathname.endsWith('/');
  const liveShellFiles = ['/app.js', '/styles.css', '/api-bridge.js', '/debug.js', '/worker.js'];
  const networkFirst = url.pathname.endsWith('/config.js') || liveShellFiles.some(name => url.pathname.endsWith(name)) || isNavigation;

  if (networkFirst) {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE);
          await cache.put(request, response.clone());
        }
        return response;
      } catch {
        return (await caches.match(request)) || (isNavigation ? await caches.match('./index.html') : null) || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok) {
        const cache = await caches.open(CACHE);
        await cache.put(request, response.clone());
      }
      return response;
    } catch {
      return Response.error();
    }
  })());
});

self.addEventListener('notificationclick', event => {
  const notification = event.notification;
  const data = notification?.data || {};
  notification?.close();
  if (event.action === 'dismiss') return;

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if ('focus' in client) {
        await client.focus();
        client.postMessage({ type: 'notification-clicked', data });
        return;
      }
    }
    const target = new URL(data.url || './', self.registration.scope).href;
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});

self.addEventListener('notificationclose', event => {
  const data = event.notification?.data || {};
  console.debug('[OfficeSafety][service-worker] Notification closed', { messageId: data.messageId || '', severity: data.severity || '' });
});

// Ready for a future Web Push transport. The current Apps Script build does not yet
// register push subscriptions, but any future push payload can use this handler.
self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data?.json() || {}; }
  catch { payload = { body: event.data?.text() || 'Office Safety update' }; }

  const severity = String(payload.severity || 'green').toLowerCase();
  event.waitUntil(self.registration.showNotification(payload.title || 'Office Safety', {
    body: payload.body || payload.text || 'There is a new Office Safety update.',
    icon: './icon-192.png',
    badge: './badge-96.png',
    tag: payload.tag || `office-safety-push-${Date.now()}`,
    renotify: true,
    requireInteraction: severity === 'red',
    data: { url: './', ...payload.data, severity },
    actions: [{ action: 'open', title: 'Open Office Safety' }, { action: 'dismiss', title: 'Dismiss' }]
  }));
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
