(() => {
  'use strict';

  const READY_TYPE = 'office-safety-bridge-ready';
  const REQUEST_TYPE = 'office-safety-api-request';
  const RESPONSE_TYPE = 'office-safety-api-response';
  const ERROR_TYPE = 'office-safety-bridge-error';
  const pending = new Map();
  let iframe = null;
  let bridgeWindow = null;
  let bridgeOrigin = '';
  let bridgeNonce = '';
  let readyPromise = null;
  let sequence = 0;

  function createNonce() {
    if (globalThis.crypto?.getRandomValues) {
      const bytes = new Uint8Array(18);
      crypto.getRandomValues(bytes);
      return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  function bridgeUrl(apiUrl) {
    const url = new URL(apiUrl, location.href);
    url.searchParams.set('bridge', '1');
    url.searchParams.set('parentOrigin', location.origin);
    url.searchParams.set('bridgeNonce', bridgeNonce);
    return url.toString();
  }

  function start(apiUrl, timeoutMs = 15000) {
    if (readyPromise) return readyPromise;
    if (!apiUrl || apiUrl.includes('PASTE_')) return Promise.reject(new Error('Set apiUrl in config.js first.'));

    bridgeNonce = createNonce();
    readyPromise = new Promise((resolve, reject) => {
      iframe = document.createElement('iframe');
      iframe.id = 'officeSafetyApiBridge';
      iframe.title = 'Office Safety backend connection';
      iframe.hidden = true;
      iframe.setAttribute('aria-hidden', 'true');

      let iframeLoaded = false;
      const timer = setTimeout(() => {
        window.removeEventListener('message', onHandshake);
        const detail = iframeLoaded
          ? `The Apps Script page loaded but did not initialise the bridge. Confirm the /exec deployment is the latest version and is deployed as Execute as me with access available without an additional Google sign-in page.`
          : `The Apps Script backend did not load. Check the /exec URL and deployment access.`;
        reject(new Error(`${detail} Required front-end origin: ${location.origin}.`));
      }, Math.max(5000, Number(timeoutMs) || 15000));

      function onHandshake(event) {
        if (event.source !== iframe.contentWindow) return;
        const message = event.data || {};
        if (message.bridgeNonce !== bridgeNonce) return;
        if (message.type === ERROR_TYPE) {
          clearTimeout(timer);
          window.removeEventListener('message', onHandshake);
          reject(new Error(message.error || `Apps Script rejected front-end origin ${location.origin}.`));
          return;
        }
        if (message.type !== READY_TYPE) return;
        clearTimeout(timer);
        bridgeWindow = event.source;
        bridgeOrigin = event.origin;
        window.removeEventListener('message', onHandshake);
        resolve({ origin: bridgeOrigin, version: message.version || '' });
      }

      window.addEventListener('message', onHandshake);
      iframe.addEventListener('load', () => { iframeLoaded = true; }, { once: true });
      iframe.src = bridgeUrl(apiUrl);
      document.body.appendChild(iframe);
    }).catch(error => {
      readyPromise = null;
      throw error;
    });

    return readyPromise;
  }

  window.addEventListener('message', event => {
    if (!bridgeWindow || event.source !== bridgeWindow) return;
    if (bridgeOrigin && event.origin !== bridgeOrigin) return;
    const message = event.data || {};
    if (message.type !== RESPONSE_TYPE || message.bridgeNonce !== bridgeNonce || !message.requestId) return;
    const entry = pending.get(String(message.requestId));
    if (!entry) return;
    pending.delete(String(message.requestId));
    clearTimeout(entry.timer);
    entry.resolve(message.result || { ok: false, error: 'Empty backend response.' });
  });

  async function request({ apiUrl, action, token, data = {}, timeoutMs = 20000 }) {
    await start(apiUrl, timeoutMs);
    const requestId = `${Date.now().toString(36)}-${(++sequence).toString(36)}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error(`Backend request timed out while running ${action}.`));
      }, Math.max(5000, Number(timeoutMs) || 20000));
      pending.set(requestId, { resolve, reject, timer });
      bridgeWindow.postMessage({
        type: REQUEST_TYPE,
        bridgeNonce,
        requestId,
        action,
        token,
        data
      }, bridgeOrigin);
    });
  }

  function reset() {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error('Backend bridge was reset.'));
    }
    pending.clear();
    iframe?.remove();
    iframe = null;
    bridgeWindow = null;
    bridgeOrigin = '';
    bridgeNonce = '';
    readyPromise = null;
  }

  window.OfficeSafetyApi = { start, request, reset };
})();
