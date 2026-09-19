(() => {
  'use strict';

  const VERSION = '0.2.8';
  const SDK_URL = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';
  const NAMESPACE = 'urn:x-cast:com.almokinsgov.office-safety';
  const state = {
    sdkPromise: null,
    ready: false,
    appId: '',
    context: null,
    listenersBound: false,
    lastPayload: null,
    lastFingerprint: '',
    lastSentAt: 0,
    castState: 'NO_DEVICES_AVAILABLE',
    sessionState: 'NO_SESSION',
    deviceName: '',
    onStateChange: null,
    debug: null
  };

  function log(level, message, details = {}) {
    const fn = state.debug?.[level] || state.debug?.debug;
    if (typeof fn === 'function') fn.call(state.debug, 'cast', message, details);
    else if (level === 'warn') console.warn('[OfficeSafety][cast]', message, details);
    else console.debug('[OfficeSafety][cast]', message, details);
  }

  function snapshot() {
    return {
      version: VERSION,
      namespace: NAMESPACE,
      supported: Boolean(window.chrome?.cast || window.cast?.framework || 'PresentationRequest' in window),
      ready: state.ready,
      configured: Boolean(state.appId),
      appId: state.appId,
      castState: state.castState,
      sessionState: state.sessionState,
      connected: Boolean(currentSession()),
      deviceName: state.deviceName,
      lastSentAt: state.lastSentAt
    };
  }

  function emit() {
    try { state.onStateChange?.(snapshot()); } catch (error) { console.warn(error); }
  }

  function currentSession() {
    try { return state.context?.getCurrentSession?.() || null; }
    catch { return null; }
  }

  function loadSdk() {
    if (window.cast?.framework && window.chrome?.cast) return Promise.resolve(true);
    if (state.sdkPromise) return state.sdkPromise;

    state.sdkPromise = new Promise((resolve, reject) => {
      let settled = false;
      const finish = (ok, error) => {
        if (settled) return;
        settled = true;
        if (ok) resolve(true);
        else reject(error || new Error('Google Cast Web Sender SDK is unavailable.'));
      };

      const previous = window.__onGCastApiAvailable;
      window.__onGCastApiAvailable = function(isAvailable) {
        try { if (typeof previous === 'function') previous(isAvailable); } catch {}
        if (isAvailable) finish(true);
        else finish(false, new Error('Google Cast API is not available in this browser or context.'));
      };

      const existing = [...document.scripts].find(script => String(script.src || '').includes('cast_sender.js'));
      if (existing) {
        const timer = setInterval(() => {
          if (window.cast?.framework && window.chrome?.cast) {
            clearInterval(timer);
            finish(true);
          }
        }, 100);
        setTimeout(() => { clearInterval(timer); finish(false, new Error('Google Cast SDK did not become ready.')); }, 10000);
        return;
      }

      const script = document.createElement('script');
      script.src = SDK_URL;
      script.async = true;
      script.onerror = () => finish(false, new Error('Could not load the Google Cast Web Sender SDK.'));
      document.head.appendChild(script);
      setTimeout(() => finish(false, new Error('Timed out loading the Google Cast Web Sender SDK.')), 12000);
    });
    return state.sdkPromise;
  }

  function bindContextListeners() {
    if (!state.context || state.listenersBound || !window.cast?.framework) return;
    state.listenersBound = true;
    const C = window.cast.framework;

    state.context.addEventListener(C.CastContextEventType.CAST_STATE_CHANGED, event => {
      state.castState = event.castState || state.context.getCastState?.() || state.castState;
      log('debug', 'Cast availability changed', { castState: state.castState });
      emit();
    });

    state.context.addEventListener(C.CastContextEventType.SESSION_STATE_CHANGED, event => {
      state.sessionState = event.sessionState || state.context.getSessionState?.() || state.sessionState;
      const session = event.session || currentSession();
      try { state.deviceName = session?.getCastDevice?.()?.friendlyName || ''; } catch { state.deviceName = ''; }
      log('info', 'Cast session state changed', { sessionState: state.sessionState, deviceName: state.deviceName });
      emit();
      if (session && state.lastPayload) {
        setTimeout(() => sync(state.lastPayload, { force: true, reason: 'session-state-change' }).catch(error => log('warn', 'Could not send state after Cast session change', { error })), 250);
      }
    });
  }

  async function configure({ appId, onStateChange, debug } = {}) {
    state.onStateChange = onStateChange || state.onStateChange;
    state.debug = debug || state.debug;
    const normalized = String(appId || '').trim();
    if (!normalized) {
      state.appId = '';
      state.ready = false;
      emit();
      return snapshot();
    }

    await loadSdk();
    if (!window.cast?.framework || !window.chrome?.cast) throw new Error('Google Cast SDK loaded but the Cast framework is unavailable.');
    const context = window.cast.framework.CastContext.getInstance();
    if (!state.context || state.appId !== normalized) {
      state.context = context;
      state.appId = normalized;
      state.listenersBound = false;
      context.setOptions({
        receiverApplicationId: normalized,
        autoJoinPolicy: window.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED
      });
      bindContextListeners();
    }
    state.castState = context.getCastState?.() || state.castState;
    state.sessionState = context.getSessionState?.() || state.sessionState;
    const session = currentSession();
    try { state.deviceName = session?.getCastDevice?.()?.friendlyName || ''; } catch { state.deviceName = ''; }
    state.ready = true;
    log('info', 'Native Cast sender configured', { appId: normalized, castState: state.castState, sessionState: state.sessionState });
    emit();
    return snapshot();
  }

  async function requestSession(options = {}) {
    await configure(options);
    if (!state.context || !state.appId) throw new Error('Native Cast requires a registered Custom Web Receiver app ID.');
    await state.context.requestSession();
    const session = currentSession();
    if (!session) throw new Error('No Cast session was created.');
    try { state.deviceName = session.getCastDevice?.()?.friendlyName || ''; } catch {}
    emit();
    if (state.lastPayload) await sync(state.lastPayload, { force: true, reason: 'request-session' });
    return snapshot();
  }

  async function sync(payload, { force = false, reason = 'state-sync' } = {}) {
    state.lastPayload = payload || null;
    const session = currentSession();
    if (!session || !payload) return false;
    const fingerprintPayload = { ...payload, sentAt: '' };
    const fingerprint = JSON.stringify(fingerprintPayload);
    if (!force && fingerprint === state.lastFingerprint) return true;
    await session.sendMessage(NAMESPACE, payload);
    state.lastFingerprint = fingerprint;
    state.lastSentAt = Date.now();
    log('debug', 'Office state sent to Cast receiver', { reason, officeId: payload?.office?.id || '', officeStatus: payload?.office?.status || '', sentAt: payload?.sentAt || '' });
    emit();
    return true;
  }

  function disconnect(stopReceiver = true) {
    if (!state.context) return false;
    try {
      state.context.endCurrentSession(Boolean(stopReceiver));
      state.deviceName = '';
      state.lastFingerprint = '';
      emit();
      return true;
    } catch (error) {
      log('warn', 'Could not end Cast session', { error });
      return false;
    }
  }

  window.OfficeSafetyCast = {
    VERSION,
    NAMESPACE,
    configure,
    requestSession,
    sync,
    disconnect,
    status: snapshot,
    currentSession
  };
})();
