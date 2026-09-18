(() => {
  'use strict';

  const VERSION = '0.2.2';
  const DB_NAME = 'office-safety-background-v1';
  const DB_VERSION = 2;
  const OUTBOX = 'outbox';
  const META = 'meta';

  function openDb() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('IndexedDB is not supported.'));
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(OUTBOX)) {
          const store = db.createObjectStore(OUTBOX, { keyPath: 'id' });
          store.createIndex('createdAt', 'createdAt', { unique: false });
          store.createIndex('ownerEmail', 'ownerEmail', { unique: false });
        }
        if (!db.objectStoreNames.contains(META)) {
          db.createObjectStore(META, { keyPath: 'key' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Could not open the Office Safety background queue.'));
    });
  }

  async function transact(storeName, mode, handler) {
    const db = await openDb();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        let value;
        try { value = handler(store, tx); }
        catch (error) { reject(error); return; }
        tx.oncomplete = () => resolve(value);
        tx.onerror = () => reject(tx.error || new Error('Background storage transaction failed.'));
        tx.onabort = () => reject(tx.error || new Error('Background storage transaction was aborted.'));
      });
    } finally {
      db.close();
    }
  }

  function requestValue(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Background storage request failed.'));
    });
  }

  function makeId() {
    if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
    const bytes = new Uint8Array(16);
    globalThis.crypto?.getRandomValues?.(bytes);
    return bytes.length ? [...bytes].map(v => v.toString(16).padStart(2, '0')).join('') : `${Date.now()}-${Math.random()}`;
  }

  async function queue({ action, data = {}, ownerEmail = '', maxAgeMs = 300000, label = '' }) {
    const now = Date.now();
    const clientRequestId = String(data.clientRequestId || makeId());
    const item = {
      id: clientRequestId,
      clientRequestId,
      action: String(action || ''),
      data: { ...data, clientRequestId },
      ownerEmail: String(ownerEmail || '').trim().toLowerCase(),
      label: String(label || action || 'queued action'),
      createdAt: now,
      expiresAt: now + Math.max(10000, Number(maxAgeMs) || 300000),
      attempts: 0,
      lastAttemptAt: 0,
      lastError: ''
    };
    if (!item.action) throw new Error('Cannot queue an action without a name.');
    await transact(OUTBOX, 'readwrite', store => store.put(item));
    await setMeta('lastQueueWriteAt', now);
    return item;
  }

  async function list() {
    const db = await openDb();
    try {
      const tx = db.transaction(OUTBOX, 'readonly');
      const result = await requestValue(tx.objectStore(OUTBOX).getAll());
      return (result || []).sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
    } finally {
      db.close();
    }
  }

  async function remove(id) {
    await transact(OUTBOX, 'readwrite', store => store.delete(String(id)));
  }

  async function update(item) {
    await transact(OUTBOX, 'readwrite', store => store.put(item));
  }

  async function clearExpired(now = Date.now()) {
    const items = await list();
    const expired = items.filter(item => Number(item.expiresAt || 0) <= now);
    for (const item of expired) await remove(item.id);
    if (expired.length) await setMeta('lastExpiredAt', now);
    return expired;
  }

  async function count() {
    const db = await openDb();
    try {
      const tx = db.transaction(OUTBOX, 'readonly');
      return await requestValue(tx.objectStore(OUTBOX).count());
    } finally {
      db.close();
    }
  }

  async function setMeta(key, value) {
    await transact(META, 'readwrite', store => store.put({ key: String(key), value, updatedAt: Date.now() }));
  }

  async function getMeta(key, fallback = null) {
    const db = await openDb();
    try {
      const tx = db.transaction(META, 'readonly');
      const row = await requestValue(tx.objectStore(META).get(String(key)));
      return row ? row.value : fallback;
    } finally {
      db.close();
    }
  }

  async function getPeriodicPermission() {
    if (!navigator.permissions?.query) return { state: 'unknown', supported: false };
    try {
      const status = await navigator.permissions.query({ name: 'periodic-background-sync' });
      return { state: status.state || 'unknown', supported: true };
    } catch (error) {
      return { state: 'unavailable', supported: false, reason: error?.message || String(error) };
    }
  }

  async function registerOneOff(registration) {
    if (!registration?.sync) return { supported: false, registered: false, reason: 'Background Sync unavailable' };
    try {
      await registration.sync.register('office-safety-outbox');
      await setMeta('oneOffSyncRegisteredAt', Date.now());
      return { supported: true, registered: true };
    } catch (error) {
      return { supported: true, registered: false, reason: error?.message || String(error) };
    }
  }

  async function configurePeriodic(registration, enabled, minIntervalMs) {
    if (!registration?.periodicSync) return { supported: false, registered: false, permission: 'unavailable', reason: 'Periodic Background Sync unavailable' };
    const tag = 'office-safety-periodic-refresh';
    const permission = await getPeriodicPermission();
    try {
      const tags = await registration.periodicSync.getTags();
      const has = tags.includes(tag);
      if (!enabled) {
        if (has) await registration.periodicSync.unregister(tag);
        await setMeta('periodicSyncEnabled', false);
        return { supported: true, registered: false, permission: permission.state, reason: 'Disabled in settings' };
      }
      if (permission.state === 'denied') {
        if (has) await registration.periodicSync.unregister(tag);
        return { supported: true, registered: false, permission: permission.state, reason: 'Browser permission denied' };
      }
      if (!has) {
        await registration.periodicSync.register(tag, {
          minInterval: Math.max(15 * 60000, Number(minIntervalMs) || 15 * 60000)
        });
      }
      const current = await registration.periodicSync.getTags();
      const registered = current.includes(tag);
      await setMeta('periodicSyncEnabled', registered);
      await setMeta('periodicSyncRequestedMinIntervalMs', Math.max(15 * 60000, Number(minIntervalMs) || 15 * 60000));
      return { supported: true, registered, permission: permission.state };
    } catch (error) {
      return { supported: true, registered: false, permission: permission.state, reason: error?.message || String(error) };
    }
  }

  function capabilities(registration) {
    return {
      indexedDb: 'indexedDB' in window,
      backgroundSync: Boolean(registration?.sync),
      periodicSync: Boolean(registration?.periodicSync),
      backgroundFetch: Boolean(registration?.backgroundFetch),
      notificationActions: typeof Notification !== 'undefined' && ('maxActions' in Notification),
      notificationMaxActions: typeof Notification !== 'undefined' && Number.isFinite(Number(Notification.maxActions)) ? Number(Notification.maxActions) : null,
      mediaSession: 'mediaSession' in navigator,
      documentPip: 'documentPictureInPicture' in window,
      secureContext: window.isSecureContext
    };
  }

  window.OfficeSafetyBackground = {
    version: VERSION,
    queue,
    list,
    remove,
    update,
    clearExpired,
    count,
    setMeta,
    getMeta,
    getPeriodicPermission,
    registerOneOff,
    configurePeriodic,
    capabilities
  };
})();
