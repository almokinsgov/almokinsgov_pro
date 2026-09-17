(() => {
  'use strict';

  const READY_TYPE = 'office-safety-bridge-ready';
  const REQUEST_TYPE = 'office-safety-api-request';
  const RESPONSE_TYPE = 'office-safety-api-response';
  const ERROR_TYPE = 'office-safety-bridge-error';
  const DEBUG_TYPE = 'office-safety-bridge-debug';
  const pending = new Map();
  const Debug = window.OfficeSafetyDebug || {
    debug() {}, info() {}, warn() {}, error() {}
  };

  let iframe = null;
  let bridgeWindow = null;
  let bridgeOrigin = '';
  let bridgeNonce = '';
  let readyPromise = null;
  let sequence = 0;
  let iframeLoaded = false;
  let lastApiUrl = '';
  let lastBridgeUrl = '';
  let startedAt = 0;
  let readyAt = 0;
  let lastHandshake = null;
  let lastError = '';

  function createNonce() {
    if (globalThis.crypto?.getRandomValues) {
      const bytes = new Uint8Array(18);
      crypto.getRandomValues(bytes);
      return [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
    }
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  function nonceLabel(value) {
    const text = String(value || '');
    return text ? `${text.slice(0, 8)}…${text.slice(-4)}` : '';
  }

  function safeUrl(value) {
    try {
      const url = new URL(value, location.href);
      return { href: url.href, origin: url.origin, pathname: url.pathname };
    } catch {
      return { href: String(value || ''), origin: '', pathname: '' };
    }
  }

  function bridgeUrl(apiUrl) {
    const url = new URL(apiUrl, location.href);
    url.searchParams.set('bridge', '1');
    url.searchParams.set('parentOrigin', location.origin);
    url.searchParams.set('bridgeNonce', bridgeNonce);
    return url.toString();
  }

  function diagnostics() {
    return {
      started: Boolean(startedAt),
      ready: Boolean(bridgeWindow && bridgeOrigin),
      iframePresent: Boolean(iframe?.isConnected),
      iframeLoaded,
      pageOrigin: location.origin,
      apiUrl: lastApiUrl,
      bridgeUrl: lastBridgeUrl ? lastBridgeUrl.replace(/bridgeNonce=[^&]+/, 'bridgeNonce=[redacted]') : '',
      bridgeOrigin,
      nonce: nonceLabel(bridgeNonce),
      startedAt: startedAt ? new Date(startedAt).toISOString() : '',
      readyAt: readyAt ? new Date(readyAt).toISOString() : '',
      elapsedMs: startedAt ? (readyAt || Date.now()) - startedAt : 0,
      pendingRequests: pending.size,
      lastHandshake,
      lastError
    };
  }

  function start(apiUrl, timeoutMs = 15000) {
    if (readyPromise) {
      Debug.debug('bridge', 'start() reused existing promise', diagnostics());
      return readyPromise;
    }
    if (!apiUrl || apiUrl.includes('PASTE_')) {
      const error = new Error('Set apiUrl in config.js first.');
      Debug.error('bridge', 'start() rejected before iframe creation', { error: error.message, apiUrl });
      return Promise.reject(error);
    }

    lastApiUrl = apiUrl;
    bridgeNonce = createNonce();
    iframeLoaded = false;
    startedAt = Date.now();
    readyAt = 0;
    lastError = '';
    lastHandshake = null;
    lastBridgeUrl = bridgeUrl(apiUrl);

    Debug.info('bridge', 'Starting Apps Script bridge', {
      frontendOrigin: location.origin,
      frontendHref: location.href,
      api: safeUrl(apiUrl),
      bridge: { ...safeUrl(lastBridgeUrl), href: lastBridgeUrl.replace(/bridgeNonce=[^&]+/, 'bridgeNonce=[redacted]') },
      nonce: nonceLabel(bridgeNonce),
      timeoutMs
    });

    readyPromise = new Promise((resolve, reject) => {
      iframe = document.createElement('iframe');
      iframe.id = 'officeSafetyApiBridge';
      iframe.title = 'Office Safety backend connection';
      iframe.hidden = true;
      iframe.setAttribute('aria-hidden', 'true');

      const timer = setTimeout(() => {
        window.removeEventListener('message', onHandshake);
        const detail = iframeLoaded
          ? 'The Apps Script page loaded but did not initialise the bridge. Confirm the /exec deployment is the latest version and is deployed as Execute as me with access available without an additional Google sign-in page.'
          : 'The Apps Script backend did not load. Check the /exec URL and deployment access.';
        lastError = `${detail} Required front-end origin: ${location.origin}.`;
        Debug.error('bridge', 'Bridge startup timed out', {
          ...diagnostics(),
          timeoutMs,
          iframeSrc: iframe?.src?.replace(/bridgeNonce=[^&]+/, 'bridgeNonce=[redacted]') || '',
          iframeContentWindowPresent: Boolean(iframe?.contentWindow)
        });
        reject(new Error(lastError));
      }, Math.max(5000, Number(timeoutMs) || 15000));

      function onHandshake(event) {
        const message = event.data || {};
        const bridgeMessage = [READY_TYPE, ERROR_TYPE, DEBUG_TYPE].includes(message.type);
        if (!bridgeMessage) return;

        const nonceMatch = message.bridgeNonce === bridgeNonce;
        const sourceMatchesOuterIframe = Boolean(iframe?.contentWindow && event.source === iframe.contentWindow);
        const eventSummary = {
          type: message.type,
          eventOrigin: event.origin,
          sourcePresent: Boolean(event.source),
          sourceMatchesOuterIframe,
          noncePresent: Boolean(message.bridgeNonce),
          nonceMatch,
          expectedNonce: nonceLabel(bridgeNonce),
          receivedNonce: nonceLabel(message.bridgeNonce),
          messageVersion: message.version || '',
          messageCode: message.code || '',
          stage: message.stage || '',
          details: message.details || null
        };
        lastHandshake = eventSummary;

        if (message.type === DEBUG_TYPE) {
          if (nonceMatch) Debug.info('bridge-frame', `Bridge frame: ${message.stage || 'debug'}`, eventSummary);
          else Debug.warn('bridge-frame', 'Ignored bridge debug message because nonce did not match', eventSummary);
          return;
        }

        Debug.info('bridge', 'Handshake message received', eventSummary);
        if (!nonceMatch) {
          Debug.warn('bridge', 'Ignored handshake because nonce did not match', eventSummary);
          return;
        }
        if (!event.source || !event.origin) {
          Debug.warn('bridge', 'Ignored handshake because source or origin was missing', eventSummary);
          return;
        }
        if (message.type === ERROR_TYPE) {
          clearTimeout(timer);
          window.removeEventListener('message', onHandshake);
          lastError = message.error || `Apps Script rejected front-end origin ${location.origin}.`;
          Debug.error('bridge', 'Apps Script bridge rejected startup', { ...eventSummary, error: lastError });
          reject(new Error(lastError));
          return;
        }

        clearTimeout(timer);
        bridgeWindow = event.source;
        bridgeOrigin = event.origin;
        readyAt = Date.now();
        window.removeEventListener('message', onHandshake);
        Debug.info('bridge', 'Apps Script bridge ready', {
          ...eventSummary,
          learnedBridgeOrigin: bridgeOrigin,
          elapsedMs: readyAt - startedAt
        });
        resolve({ origin: bridgeOrigin, version: message.version || '' });
      }

      window.addEventListener('message', onHandshake);
      iframe.addEventListener('load', () => {
        iframeLoaded = true;
        Debug.info('bridge', 'Hidden Apps Script iframe load event fired', {
          elapsedMs: Date.now() - startedAt,
          src: iframe.src.replace(/bridgeNonce=[^&]+/, 'bridgeNonce=[redacted]'),
          contentWindowPresent: Boolean(iframe.contentWindow)
        });
      }, { once: true });

      iframe.src = lastBridgeUrl;
      document.body.appendChild(iframe);
      Debug.debug('bridge', 'Hidden Apps Script iframe appended', {
        iframeId: iframe.id,
        hidden: iframe.hidden,
        src: iframe.src.replace(/bridgeNonce=[^&]+/, 'bridgeNonce=[redacted]')
      });
    }).catch(error => {
      lastError = error?.message || String(error);
      readyPromise = null;
      Debug.error('bridge', 'Bridge start failed', { error, diagnostics: diagnostics() });
      throw error;
    });

    return readyPromise;
  }

  window.addEventListener('message', event => {
    const message = event.data || {};
    if (message.type === DEBUG_TYPE && message.bridgeNonce === bridgeNonce) {
      Debug.info('bridge-frame', `Bridge frame: ${message.stage || 'debug'}`, {
        eventOrigin: event.origin,
        sourceMatchesLearnedBridge: Boolean(bridgeWindow && event.source === bridgeWindow),
        version: message.version || '',
        details: message.details || null
      });
      return;
    }

    if (!bridgeWindow || event.source !== bridgeWindow) return;
    if (bridgeOrigin && event.origin !== bridgeOrigin) {
      Debug.warn('bridge', 'Ignored bridge message from unexpected origin', { expected: bridgeOrigin, received: event.origin, type: message.type });
      return;
    }
    if (message.type !== RESPONSE_TYPE || message.bridgeNonce !== bridgeNonce || !message.requestId) return;

    const requestId = String(message.requestId);
    const entry = pending.get(requestId);
    if (!entry) {
      Debug.warn('bridge', 'Received response for unknown or expired request', { requestId, type: message.type });
      return;
    }
    pending.delete(requestId);
    clearTimeout(entry.timer);
    const elapsedMs = Date.now() - entry.startedAt;
    const result = message.result || { ok: false, error: 'Empty backend response.' };
    Debug.info('bridge', 'Backend response received', {
      requestId,
      action: entry.action,
      elapsedMs,
      ok: Boolean(result?.ok),
      error: result?.ok ? '' : String(result?.error || '')
    });
    entry.resolve(result);
  });

  async function request({ apiUrl, action, token, data = {}, timeoutMs = 20000 }) {
    await start(apiUrl, timeoutMs);
    const requestId = `${Date.now().toString(36)}-${(++sequence).toString(36)}`;
    const startedAt = Date.now();

    Debug.info('bridge', 'Sending backend request', {
      requestId,
      action,
      tokenPresent: Boolean(token),
      tokenLength: token ? String(token).length : 0,
      dataKeys: data && typeof data === 'object' ? Object.keys(data) : [],
      targetOrigin: bridgeOrigin,
      timeoutMs
    });

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        const error = new Error(`Backend request timed out while running ${action}.`);
        Debug.error('bridge', 'Backend request timed out', { requestId, action, elapsedMs: Date.now() - startedAt, diagnostics: diagnostics() });
        reject(error);
      }, Math.max(5000, Number(timeoutMs) || 20000));

      pending.set(requestId, { resolve, reject, timer, action, startedAt });
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
    Debug.warn('bridge', 'Resetting backend bridge', diagnostics());
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
    iframeLoaded = false;
    startedAt = 0;
    readyAt = 0;
    lastHandshake = null;
    lastError = '';
  }

  window.OfficeSafetyApi = { start, request, reset, diagnostics };
  Debug.info('bridge', 'Bridge client loaded', { version: '0.2.0', frontendOrigin: location.origin });
})();
