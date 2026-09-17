const VERSION = '0.2.0';
const CACHE = `office-safety-v${VERSION}`;
const SHELL = [
  './', './index.html', './styles.css', './app.js', './api-bridge.js', './debug.js', './background.js',
  './config.js', './manifest.webmanifest', './worker.js', './icon-192.png', './icon-512.png',
  './icon-maskable-512.png', './badge-96.png'
];

const BG_DB_NAME = 'office-safety-background-v1';
const BG_DB_VERSION = 2;
const BG_OUTBOX = 'outbox';
const BG_META = 'meta';
const QUICK_ACTION_PARAM = 'officeSafetyAction';

function openBackgroundDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(BG_DB_NAME, BG_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(BG_OUTBOX)) {
        const store = db.createObjectStore(BG_OUTBOX, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt', { unique: false });
        store.createIndex('ownerEmail', 'ownerEmail', { unique: false });
      }
      if (!db.objectStoreNames.contains(BG_META)) db.createObjectStore(BG_META, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open background storage.'));
  });
}

async function backgroundCount() {
  const db = await openBackgroundDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(BG_OUTBOX, 'readonly');
      const request = tx.objectStore(BG_OUTBOX).count();
      request.onsuccess = () => resolve(Number(request.result || 0));
      request.onerror = () => reject(request.error || new Error('Could not count queued actions.'));
    });
  } finally {
    db.close();
  }
}

async function setBackgroundMeta(key, value) {
  const db = await openBackgroundDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(BG_META, 'readwrite');
      tx.objectStore(BG_META).put({ key: String(key), value, updatedAt: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Could not update background metadata.'));
    });
  } finally {
    db.close();
  }
}

async function getBackgroundMeta(key, fallback = null) {
  const db = await openBackgroundDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(BG_META, 'readonly');
      const request = tx.objectStore(BG_META).get(String(key));
      request.onsuccess = () => resolve(request.result ? request.result.value : fallback);
      request.onerror = () => reject(request.error || new Error('Could not read background metadata.'));
    });
  } finally {
    db.close();
  }
}

async function bestWindowClient() {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  return windows.find(client => client.visibilityState === 'visible' && client.focused)
    || windows.find(client => client.visibilityState === 'visible')
    || windows[0]
    || null;
}

async function requestClientTask(task, detail = {}, timeoutMs = 15000) {
  const client = await bestWindowClient();
  if (!client) return { ok: false, noClient: true, task };
  return new Promise(resolve => {
    const channel = new MessageChannel();
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, timeout: true, task });
    }, timeoutMs);
    channel.port1.onmessage = event => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(event.data || { ok: true, task });
    };
    try {
      client.postMessage({ type: 'background-task', task, detail, serviceWorkerVersion: VERSION }, [channel.port2]);
    } catch (error) {
      clearTimeout(timer);
      settled = true;
      resolve({ ok: false, task, error: String(error?.message || error) });
    }
  });
}

function notificationActions(actions) {
  const max = Number(self.Notification?.maxActions);
  if (Number.isFinite(max) && max >= 0) return actions.slice(0, max);
  return actions.slice(0, 2);
}

async function remindPendingQueue(count, reason) {
  if (!count || !self.registration?.showNotification) return;
  const now = Date.now();
  const lastReminder = Number(await getBackgroundMeta('lastPendingQueueReminderAt', 0)) || 0;
  if (now - lastReminder < 30 * 60 * 1000) return;
  await setBackgroundMeta('lastPendingQueueReminderAt', now);
  await self.registration.showNotification('Office Safety updates waiting', {
    body: `${count} queued ${count === 1 ? 'action is' : 'actions are'} waiting to be sent. Open Office Safety to reconnect and sync.`,
    icon: './icon-192.png',
    badge: './badge-96.png',
    tag: 'office-safety-pending-sync',
    renotify: false,
    data: { url: './', kind: 'background-sync', reason, queuedCount: count },
    actions: notificationActions([
      { action: 'sync-now', title: 'Open & Sync' },
      { action: 'dismiss', title: 'Dismiss' }
    ])
  });
}

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
      .then(() => setBackgroundMeta('serviceWorkerActivatedAt', Date.now()).catch(() => {}))
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  const isNavigation = request.mode === 'navigate' || url.pathname.endsWith('/index.html') || url.pathname.endsWith('/');
  const liveShellFiles = ['/app.js', '/styles.css', '/api-bridge.js', '/debug.js', '/background.js', '/worker.js'];
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

self.addEventListener('sync', event => {
  if (event.tag !== 'office-safety-outbox') return;
  event.waitUntil((async () => {
    await setBackgroundMeta('lastOneOffSyncWakeAt', Date.now()).catch(() => {});
    const result = await requestClientTask('flush-outbox', { reason: 'background-sync' });
    if (result?.ok) {
      const remaining = Number(result?.result?.remaining || 0);
      if (remaining > 0 && self.registration.sync) {
        await self.registration.sync.register('office-safety-outbox').catch(() => {});
        await setBackgroundMeta('lastOneOffSyncDeferredAt', Date.now()).catch(() => {});
      } else {
        await setBackgroundMeta('lastOneOffSyncSuccessAt', Date.now()).catch(() => {});
      }
      return;
    }
    if (result?.noClient) {
      const count = await backgroundCount().catch(() => 0);
      await remindPendingQueue(count, 'background-sync');
    }
  })());
});

self.addEventListener('periodicsync', event => {
  if (event.tag !== 'office-safety-periodic-refresh') return;
  event.waitUntil((async () => {
    await setBackgroundMeta('lastPeriodicSyncWakeAt', Date.now()).catch(() => {});
    const result = await requestClientTask('periodic-refresh', { reason: 'periodic-background-sync' });
    if (result?.ok) {
      const remaining = Number(result?.outbox?.remaining || 0);
      if (remaining > 0 && self.registration.sync) {
        await self.registration.sync.register('office-safety-outbox').catch(() => {});
      }
      await setBackgroundMeta('lastPeriodicSyncSuccessAt', Date.now()).catch(() => {});
      return;
    }
    if (result?.noClient) {
      // The Apps Script API transport depends on an HtmlService bridge inside a page.
      // A closed-app Service Worker therefore preserves pending writes and waits for the
      // next foreground session rather than storing Google credentials in worker storage.
      const count = await backgroundCount().catch(() => 0);
      if (count) await remindPendingQueue(count, 'periodic-background-sync');
    }
  })());
});

self.addEventListener('notificationclick', event => {
  const notification = event.notification;
  const data = notification?.data || {};
  const action = String(event.action || 'open');
  notification?.close();
  if (action === 'dismiss') return;

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if ('focus' in client) {
        await client.focus();
        client.postMessage({ type: 'notification-clicked', action, data });
        return;
      }
    }
    const target = new URL(data.url || './', self.registration.scope);
    if (action && action !== 'open') target.searchParams.set(QUICK_ACTION_PARAM, action);
    if (self.clients.openWindow) await self.clients.openWindow(target.href);
  })());
});

self.addEventListener('notificationclose', event => {
  const data = event.notification?.data || {};
  console.debug('[OfficeSafety][service-worker] Notification closed', { messageId: data.messageId || '', severity: data.severity || '' });
});

// Web Push can provide true closed-app live alerts once the backend has a push sender.
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
    actions: notificationActions([
      { action: 'open', title: 'Open Office Safety' },
      { action: 'controls', title: 'Quick Controls' },
      { action: 'dismiss', title: 'Dismiss' }
    ])
  }));
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'GET_BACKGROUND_DIAGNOSTICS') {
    event.waitUntil((async () => {
      const count = await backgroundCount().catch(() => 0);
      const diagnostics = {
        version: VERSION,
        queuedCount: count,
        lastOneOffSyncWakeAt: await getBackgroundMeta('lastOneOffSyncWakeAt', 0).catch(() => 0),
        lastOneOffSyncSuccessAt: await getBackgroundMeta('lastOneOffSyncSuccessAt', 0).catch(() => 0),
        lastPeriodicSyncWakeAt: await getBackgroundMeta('lastPeriodicSyncWakeAt', 0).catch(() => 0),
        lastPeriodicSyncSuccessAt: await getBackgroundMeta('lastPeriodicSyncSuccessAt', 0).catch(() => 0)
      };
      event.ports?.[0]?.postMessage(diagnostics);
    })());
  }
});
