(() => {
  'use strict';

  const VERSION = '0.2.2';
  const cfg = window.OFFICE_SAFETY_CONFIG || {};
  const Debug = window.OfficeSafetyDebug || { debug() {}, info() {}, warn() {}, error() {} };
  let googleInitAttempts = 0;
  const SESSION_TOKEN_KEY = 'officeSafetySessionToken';
  const QUICK_ACTION_PARAM = 'officeSafetyAction';
  const Background = window.OfficeSafetyBackground || null;
  const state = {
    token: '', user: null, isAdmin: false, offices: [], presence: null,
    selectedStatus: 'green', snapshot: null, adminSnapshot: null,
    worker: null, heartbeat: null, mode: 'office', lastMessageIds: new Set(), messageBaselineReady: false, lastPersonStates: new Map(),
    uiLock: null, pollInFlight: false, heartbeatInFlight: false, swRegistration: null, installPrompt: null,
    pipWindow: null, importantBadgeCount: 0, bridgeReady: false, sessionRestoreAttempted: false,
    outboxFlushInFlight: false, queuedCount: 0, backgroundStatus: null,
    pendingExternalAction: null, liveMonitoringPaused: false, mediaSessionActive: false, mediaMonitorOfficeId: '',
    mediaCarrier: null, mediaStreamActive: false, mediaLastKeepAliveAt: 0,
    settings: loadSettings()
  };

  const $ = id => document.getElementById(id);
  const $$ = selector => [...document.querySelectorAll(selector)];

  function loadSettings() {
    try {
      return {
        notifications: false,
        sound: false,
        pollMs: Number(cfg.defaultPollMs || 10000),
        defaultOffice: '',
        backgroundSync: true,
        periodicSync: true,
        periodicSyncMinutes: 15,
        quickControls: false,
        mediaControls: false,
        mediaStreamPreferred: false,
        ...JSON.parse(localStorage.getItem('officeSafetySettings') || '{}')
      };
    } catch {
      return {
        notifications: false, sound: false, pollMs: 10000, defaultOffice: '',
        backgroundSync: true, periodicSync: true, periodicSyncMinutes: 15,
        quickControls: false, mediaControls: false, mediaStreamPreferred: false
      };
    }
  }

  function saveSettings() {
    localStorage.setItem('officeSafetySettings', JSON.stringify(state.settings));
  }

  function escapeHtml(value = '') {
    return String(value).replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));
  }

  function formatTime(value) {
    if (!value) return '';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-NZ', { dateStyle: 'medium', timeStyle: 'short' });
  }

  function ago(value) {
    const ms = Date.now() - new Date(value).getTime();
    if (!Number.isFinite(ms)) return '';
    const min = Math.max(0, Math.round(ms / 60000));
    if (min < 1) return 'just now';
    if (min < 60) return `${min}m ago`;
    const hr = Math.round(min / 60);
    return hr < 24 ? `${hr}h ago` : `${Math.round(hr / 24)}d ago`;
  }

  function toast(message, type = '') {
    const el = document.createElement('div');
    el.className = `toast ${type}`.trim();
    el.textContent = message;
    $('toastRegion').appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  const interactionSelectors = [
    '#checkInBtn', '#updateStatusBtn', '#checkOutBtn', '#changeOfficeBtn', '#sendMessageBtn',
    '#refreshBtn', '#adminRefreshBtn', '#adminSendMessageBtn', '#loadMoreMessagesBtn',
    '#loadMoreActivityBtn', '#signOutBtn', '#settingsBtn', '#saveSettingsBtn', '#testNotificationBtn',
    '#pipBtn', '#installBtn', '#quickControlsBtn', '#showQuickControlsBtn', '#retryQueuedBtn',
    '#mediaControlsBtn', '#startMediaStreamBtn', '#stopMediaStreamBtn', '#mediaLowerAlertBtn', '#mediaRaiseAlertBtn', '#mediaPauseResumeBtn', '#mediaPipBtn', '#openMediaControlsFromSettingsBtn',
    '.status-choice', '.traffic-btn', '.message-presets button'
  ].join(',');

  function setInteractionLocked(locked) {
    document.querySelectorAll(interactionSelectors).forEach(el => {
      if (locked) {
        if (!el.hasAttribute('data-office-safety-was-disabled')) {
          el.setAttribute('data-office-safety-was-disabled', el.disabled ? 'true' : 'false');
        }
        el.disabled = true;
      } else if (el.hasAttribute('data-office-safety-was-disabled')) {
        el.disabled = el.getAttribute('data-office-safety-was-disabled') === 'true';
        el.removeAttribute('data-office-safety-was-disabled');
      }
    });
  }

  function showLoading(label, detail = 'Please wait for the current request to finish.') {
    $('loadingTitle').textContent = label || 'Working...';
    $('loadingDetail').textContent = detail;
    $('loadingOverlay').classList.remove('hidden');
    document.body.classList.add('is-busy');
    document.body.setAttribute('aria-busy', 'true');
    setInteractionLocked(true);
    renderPip();
  }

  function hideLoading() {
    $('loadingOverlay').classList.add('hidden');
    document.body.classList.remove('is-busy');
    document.body.removeAttribute('aria-busy');
    setInteractionLocked(false);
    renderPip();
  }

  async function runExclusive(label, work, options = {}) {
    if (state.uiLock) {
      Debug.warn('ui-lock', 'Blocked duplicate action while another request is pending', {
        requested: label,
        active: state.uiLock.label,
        elapsedMs: Date.now() - state.uiLock.startedAt
      });
      toast(`Please wait for ${state.uiLock.label.toLowerCase()} to finish.`, 'warn');
      return null;
    }
    const detail = options.detail || 'Please wait for the safety service to respond.';
    state.uiLock = { label, startedAt: Date.now() };
    Debug.info('ui-lock', 'Interaction lock acquired', { label });
    if (options.overlay !== false) showLoading(label, detail);
    else setInteractionLocked(true);
    try {
      return await work();
    } finally {
      Debug.info('ui-lock', 'Interaction lock released', { label, elapsedMs: Date.now() - state.uiLock.startedAt });
      state.uiLock = null;
      if (options.overlay !== false) hideLoading();
      else setInteractionLocked(false);
    }
  }

  async function api(action, data = {}) {
    if (!cfg.apiUrl || cfg.apiUrl.includes('PASTE_')) throw new Error('Set apiUrl in config.js first.');
    if (!window.OfficeSafetyApi) throw new Error('Backend bridge library did not load.');
    const startedAt = Date.now();
    Debug.info('app-api', 'API call started', { action, dataKeys: data && typeof data === 'object' ? Object.keys(data) : [], signedIn: Boolean(state.token) });
    try {
      const result = await window.OfficeSafetyApi.request({
        apiUrl: cfg.apiUrl,
        action,
        token: state.token,
        data,
        timeoutMs: Number(cfg.apiTimeoutMs || 20000)
      });
      if (!result?.ok) throw new Error(result?.error || 'Request failed.');
      Debug.info('app-api', 'API call completed', { action, elapsedMs: Date.now() - startedAt, ok: true });
      return result.data;
    } catch (error) {
      Debug.error('app-api', 'API call failed', { action, elapsedMs: Date.now() - startedAt, error });
      throw error;
    }
  }


  function makeClientRequestId(prefix = 'req') {
    if (globalThis.crypto?.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  function isRetryableBackgroundError(error) {
    if (!navigator.onLine) return true;
    const message = String(error?.message || error || '').toLowerCase();
    return /timed out|timeout|network|offline|connection|failed to fetch|temporarily unavailable|bridge was reset|backend.*load/.test(message);
  }

  async function updateQueuedCount() {
    if (!Background) return 0;
    try {
      const expired = await Background.clearExpired();
      if (expired.length) {
        Debug.warn('background-sync', 'Expired queued actions were removed', {
          count: expired.length,
          actions: expired.map(item => item.action)
        });
      }
      state.queuedCount = await Background.count();
      const queueState = $('queueState');
      if (queueState) {
        queueState.textContent = state.queuedCount ? `${state.queuedCount} queued` : '';
        queueState.classList.toggle('hidden', !state.queuedCount);
      }
      const queuedCount = $('backgroundQueuedCount');
      if (queuedCount) queuedCount.textContent = String(state.queuedCount);
      const retryButton = $('retryQueuedBtn');
      if (retryButton) retryButton.disabled = !state.queuedCount || !state.token || state.outboxFlushInFlight;
      return state.queuedCount;
    } catch (error) {
      Debug.warn('background-sync', 'Could not read background queue count', { error });
      return 0;
    }
  }

  async function queueBackgroundAction(action, data, { maxAgeMs = 300000, label = action } = {}) {
    if (!Background || !state.settings.backgroundSync) throw new Error('Background retry sync is not enabled.');
    const queued = await Background.queue({
      action,
      data: { ...data, clientRequestId: data?.clientRequestId || makeClientRequestId(action) },
      ownerEmail: state.user?.email || '',
      maxAgeMs,
      label
    });
    await updateQueuedCount();
    const registration = await getServiceWorkerRegistration();
    const syncResult = await Background.registerOneOff(registration);
    Debug.info('background-sync', 'Action queued for background retry', {
      action,
      clientRequestId: queued.clientRequestId,
      expiresAt: new Date(queued.expiresAt).toISOString(),
      syncSupported: syncResult.supported,
      syncRegistered: syncResult.registered,
      syncReason: syncResult.reason || ''
    });
    return queued;
  }

  async function flushOutbox({ reason = 'foreground' } = {}) {
    if (!Background || state.outboxFlushInFlight || !state.token || state.uiLock) return { sent: 0, remaining: state.queuedCount || 0 };
    state.outboxFlushInFlight = true;
    Debug.info('background-sync', 'Outbox flush started', { reason, online: navigator.onLine });
    let sent = 0;
    let failed = 0;
    let expired = 0;
    try {
      const expiredItems = await Background.clearExpired();
      expired = expiredItems.length;
      const items = await Background.list();
      const owner = String(state.user?.email || '').toLowerCase();
      for (const item of items) {
        if (item.ownerEmail && item.ownerEmail !== owner) continue;
        if (Number(item.expiresAt || 0) <= Date.now()) {
          await Background.remove(item.id);
          expired++;
          continue;
        }
        if (!navigator.onLine) break;
        item.attempts = Number(item.attempts || 0) + 1;
        item.lastAttemptAt = Date.now();
        try {
          await api(item.action, { ...(item.data || {}), clientRequestId: item.clientRequestId || item.id });
          await Background.remove(item.id);
          sent++;
          Debug.info('background-sync', 'Queued action delivered', {
            reason,
            action: item.action,
            clientRequestId: item.clientRequestId || item.id,
            attempts: item.attempts
          });
        } catch (error) {
          item.lastError = String(error?.message || error);
          await Background.update(item);
          failed++;
          Debug.warn('background-sync', 'Queued action delivery failed', {
            reason,
            action: item.action,
            clientRequestId: item.clientRequestId || item.id,
            attempts: item.attempts,
            retryable: isRetryableBackgroundError(error),
            error
          });
          if (isRetryableBackgroundError(error)) break;
          await Background.remove(item.id);
        }
      }
    } finally {
      state.outboxFlushInFlight = false;
      await updateQueuedCount();
    }
    if (sent) {
      toast(`${sent} queued ${sent === 1 ? 'action' : 'actions'} synced.`);
      pollNow();
    }
    if (expired) toast(`${expired} queued ${expired === 1 ? 'action expired' : 'actions expired'} before they could be confirmed.`, 'warn');
    return { sent, failed, expired, remaining: state.queuedCount || 0 };
  }

  async function configureBackgroundFeatures() {
    if (!Background) return;
    const registration = await getServiceWorkerRegistration();
    const capabilities = Background.capabilities(registration);
    let periodic = { supported: capabilities.periodicSync, registered: false, reason: '' };
    if (registration) {
      periodic = await Background.configurePeriodic(
        registration,
        Boolean(state.settings.periodicSync),
        Number(state.settings.periodicSyncMinutes || 15) * 60000
      );
      if (state.settings.backgroundSync && state.queuedCount) await Background.registerOneOff(registration);
    }
    state.backgroundStatus = { capabilities, periodic };
    updateBackgroundSettingsUi();
    Debug.info('background-sync', 'Background feature configuration updated', state.backgroundStatus);
  }

  function capabilityText(value, supportedText = 'Available', unavailableText = 'Unavailable') {
    return value ? supportedText : unavailableText;
  }

  function updateBackgroundSettingsUi() {
    const registration = state.swRegistration;
    const capabilities = Background?.capabilities(registration) || {
      indexedDb: false, backgroundSync: false, periodicSync: false, backgroundFetch: false,
      notificationActions: false, notificationMaxActions: null, mediaSession: false, documentPip: false, secureContext: window.isSecureContext
    };
    const periodicState = state.backgroundStatus?.periodic;
    const periodicLabel = periodicState?.registered
      ? `Registered${periodicState.permission && periodicState.permission !== 'granted' ? ` • permission ${periodicState.permission}` : ''}`
      : (capabilities.periodicSync ? (periodicState?.reason || `Available${periodicState?.permission ? ` • permission ${periodicState.permission}` : ''}`) : 'Unavailable');
    const actionCount = Number(capabilities.notificationMaxActions);
    const actionLabel = capabilities.notificationActions && Number.isFinite(actionCount) && actionCount > 0
      ? `Available, up to ${actionCount} ${actionCount === 1 ? 'action' : 'actions'}`
      : (capabilities.notificationActions ? 'API present, device reports no action buttons' : 'Unavailable');
    const values = {
      backgroundSyncCapability: capabilityText(capabilities.backgroundSync),
      periodicSyncCapability: periodicLabel,
      backgroundFetchCapability: capabilities.backgroundFetch ? 'Available, intentionally unused' : 'Unavailable, not required',
      notificationActionsCapability: actionLabel,
      mediaSessionCapability: capabilityText(capabilities.mediaSession),
      secureContextCapability: capabilities.secureContext ? 'Secure context' : 'Requires HTTPS or localhost'
    };
    Object.entries(values).forEach(([id, text]) => { const el = $(id); if (el) el.textContent = text; });
    const periodicToggle = $('periodicSyncSetting');
    if (periodicToggle) periodicToggle.disabled = !capabilities.periodicSync;
    const interval = $('periodicSyncMinutesSetting');
    if (interval) interval.disabled = !capabilities.periodicSync || !state.settings.periodicSync;
    const backgroundToggle = $('backgroundSyncSetting');
    if (backgroundToggle) backgroundToggle.disabled = !Background;
    const mediaToggle = $('mediaControlsSetting');
    if (mediaToggle) mediaToggle.disabled = !capabilities.mediaSession;
    const quickToggle = $('quickControlsSetting');
    if (quickToggle) quickToggle.disabled = !(capabilities.notificationActions && Number(actionCount) > 0);
    const quickButton = $('showQuickControlsBtn');
    if (quickButton) quickButton.disabled = !(capabilities.notificationActions && Number(actionCount) > 0);
    updateQueuedCount();
  }

  function scheduleBackgroundFlush(reason = 'app') {
    if (!state.settings.backgroundSync) return;
    queueMicrotask(() => flushOutbox({ reason }).catch(error => Debug.warn('background-sync', 'Scheduled outbox flush failed', { error })));
  }

  async function initBackendBridge() {
    Debug.info('startup', 'Initialising backend bridge', {
      frontendVersion: VERSION,
      origin: location.origin,
      href: location.href,
      apiUrl: cfg.apiUrl || '',
      bridgeLibraryPresent: Boolean(window.OfficeSafetyApi)
    });
    $('diagOrigin').textContent = location.origin;
    $('diagGoogle').textContent = `Google requires the exact browser origin ${location.origin} in Authorized JavaScript origins. Google Cloud changes can take time to propagate.`;
    if (cfg.apiUrl && !cfg.apiUrl.includes('PASTE_')) {
      $('backendTestLink').href = cfg.apiUrl;
    } else {
      $('backendTestLink').removeAttribute('href');
    }
    if (!cfg.apiUrl || cfg.apiUrl.includes('PASTE_') || !window.OfficeSafetyApi) {
      $('diagBridge').textContent = 'Backend URL or bridge library is not configured.';
      return;
    }
    const originHelp = `Front-end origin: ${location.origin}. Add ${location.origin} to Google Cloud Authorized JavaScript origins. Apps Script ALLOWED_FRONTEND_ORIGINS must contain ${location.origin}. Staff access is controlled by exact Google account allowlisting in the Staff sheet or ALLOWED_EMAILS.`;
    $('loginHelp').textContent = originHelp;
    $('diagBridge').textContent = 'Connecting...';
    try {
      const info = await window.OfficeSafetyApi.start(cfg.apiUrl, Number(cfg.apiTimeoutMs || 15000));
      $('diagBridge').textContent = `Connected${info.version ? ` to backend v${info.version}` : ''}.`;
      $('loginHelp').textContent = `${originHelp} Backend bridge connected.`;
      const backendCompatible = !info.version || ['0.2.0','0.2.1','0.2.2'].includes(info.version);
      state.bridgeReady = true;
      Debug.info('startup', 'Backend bridge connected', { frontendVersion: VERSION, backendVersion: info.version || '', bridgeOrigin: info.origin || '', versionMatch: !info.version || info.version === VERSION, backendCompatible });
      if (!backendCompatible) Debug.warn('startup', 'Front-end and backend versions may not be compatible', { frontendVersion: VERSION, backendVersion: info.version });
      await restoreSessionFromStorage();
    } catch (error) {
      $('diagBridge').textContent = error.message;
      $('loginHelp').textContent = `Backend: ${error.message}`;
      Debug.error('startup', 'Backend bridge setup failed', { error, bridgeDiagnostics: window.OfficeSafetyApi?.diagnostics?.() || null });
      console.error('Backend bridge setup failed', error);
    }
  }

  function setView(view) {
    ['loginView','setupView','officeView'].forEach(id => $(id).classList.add('hidden'));
    $(view).classList.remove('hidden');
  }

  function setConnection(online, text) {
    $('offlineBanner').classList.toggle('hidden', online);
    $('syncState').textContent = text || (online ? 'Connected' : 'Connection interrupted');
  }

  function populateOffices() {
    const active = state.offices.filter(o => o.active !== false);
    const options = active.map(o => `<option value="${escapeHtml(o.id)}">${escapeHtml(o.name)}</option>`).join('');
    $('officeSelect').innerHTML = options || '<option value="">No offices configured</option>';
    $('adminOfficeFilter').innerHTML = '<option value="">All offices</option>' + options;
    $('adminMessageOffice').innerHTML = '<option value="*">All offices</option>' + options;
    $('defaultOfficeSetting').innerHTML = '<option value="">None</option>' + options;
    const preferred = state.presence?.officeId || state.settings.defaultOffice;
    if (preferred && active.some(o => o.id === preferred)) $('officeSelect').value = preferred;
    $('defaultOfficeSetting').value = state.settings.defaultOffice || '';
  }

  function applyStatusSelection(status, scope = 'traffic') {
    state.selectedStatus = status;
    const selector = scope === 'setup' ? '.status-choice' : '.traffic-btn';
    $$(selector).forEach(btn => btn.classList.toggle('selected', btn.dataset.status === status));
  }

  function officeById(id) { return state.offices.find(o => o.id === id); }

  function decodeCredentialDiagnostics(credential) {
    try {
      const parts = String(credential || '').split('.');
      if (parts.length !== 3) return { decoded: false, reason: 'not-a-jwt' };
      const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - parts[1].length % 4) % 4);
      const payload = JSON.parse(atob(padded));
      const emailDomain = String(payload.email || '').toLowerCase().split('@')[1] || '';
      return {
        decoded: true,
        issuer: String(payload.iss || ''),
        audienceMatchesConfig: String(payload.aud || '') === cfg.googleClientId,
        hostedDomain: String(payload.hd || '').toLowerCase(),
        emailDomain,
        emailVerified: String(payload.email_verified) === 'true' || payload.email_verified === true,
        expiresAt: payload.exp ? new Date(Number(payload.exp) * 1000).toISOString() : '',
        expired: payload.exp ? Number(payload.exp) * 1000 <= Date.now() : null
      };
    } catch (error) {
      return { decoded: false, reason: error.message || String(error) };
    }
  }

  function saveSessionToken(token) {
    try {
      if (token) sessionStorage.setItem(SESSION_TOKEN_KEY, String(token));
      else sessionStorage.removeItem(SESSION_TOKEN_KEY);
    } catch (error) {
      Debug.warn('session', 'Could not update refresh session storage', { error });
    }
  }

  function loadSessionToken() {
    try { return String(sessionStorage.getItem(SESSION_TOKEN_KEY) || ''); }
    catch { return ''; }
  }

  function clearSessionToken() { saveSessionToken(''); }

  function credentialCanBeRestored(token) {
    const info = decodeCredentialDiagnostics(token);
    if (!info.decoded || info.expired) return false;
    if (!info.audienceMatchesConfig) return false;
    const expiry = info.expiresAt ? new Date(info.expiresAt).getTime() : 0;
    return !expiry || expiry - Date.now() > 60000;
  }

  function applyBootstrapData(data, source = 'google') {
    state.user = data.user;
    state.isAdmin = Boolean(data.isAdmin);
    state.offices = data.offices || [];
    state.presence = data.presence || null;
    $('signOutBtn').classList.remove('hidden');
    $('settingsBtn').classList.remove('hidden');
    $('adminTab').classList.toggle('hidden', !state.isAdmin);
    populateOffices();
    if (state.presence?.officeId) enterOffice(state.presence);
    else {
      $('welcomeName').textContent = `Kia ora ${state.user.name || state.user.email}`;
      setView('setupView');
    }
    setConnection(true, `Signed in as ${state.user.email}`);
    updateQuickControlsAvailability();
    updateMediaControlsAvailability();
    updateMediaSession();
    updateQueuedCount();
    configureBackgroundFeatures().catch(error => Debug.warn('background-sync', 'Background features could not be configured after sign-in', { error }));
    scheduleBackgroundFlush(source);
    consumePendingExternalAction();
    Debug.info('session', 'Bootstrap data applied', { source, isAdmin: state.isAdmin, officeCount: state.offices.length, hasPresence: Boolean(state.presence) });
  }

  async function restoreSessionFromStorage() {
    if (state.sessionRestoreAttempted || state.token || !state.bridgeReady) return false;
    state.sessionRestoreAttempted = true;
    const token = loadSessionToken();
    if (!token) {
      Debug.info('session', 'No refresh session token was available');
      return false;
    }
    if (!credentialCanBeRestored(token)) {
      clearSessionToken();
      Debug.info('session', 'Stored refresh session token was expired or invalid for this OAuth client');
      return false;
    }
    state.token = token;
    try {
      const data = await runExclusive('Restoring Session', () => api('bootstrap'), {
        detail: 'Restoring your signed-in office session after the page refresh.'
      });
      if (!data) return false;
      applyBootstrapData(data, 'page-refresh');
      Debug.info('session', 'Signed-in session restored after page refresh', { hasPresence: Boolean(state.presence) });
      return true;
    } catch (error) {
      clearSessionToken();
      state.token = '';
      Debug.warn('session', 'Stored session could not be restored', { error });
      return false;
    }
  }

  async function handleCredential(response) {
    if (state.uiLock) {
      Debug.warn('google', 'Ignored an additional Google credential while another action is pending', { activeAction: state.uiLock.label });
      return;
    }
    state.token = response.credential;
    const credentialDiagnostics = decodeCredentialDiagnostics(response?.credential);
    Debug.info('google', 'Google credential callback fired', {
      credentialPresent: Boolean(response?.credential),
      credentialLength: response?.credential ? String(response.credential).length : 0,
      identityClaims: credentialDiagnostics
    });
    try {
      const data = await runExclusive('Signing In', () => api('bootstrap'), {
        detail: 'Confirming your Google account and loading office access.'
      });
      if (!data) return;
      saveSessionToken(state.token);
      applyBootstrapData(data, 'google-sign-in');
      Debug.info('google', 'Google sign-in bootstrap succeeded', { emailDomain: String(state.user.email || '').split('@')[1] || '', isAdmin: state.isAdmin, officeCount: state.offices.length, hasPresence: Boolean(state.presence) });
    } catch (error) {
      let identityDiagnostic = null;
      try {
        identityDiagnostic = await api('identityDiagnostics');
        Debug.warn('google-auth', 'Backend Google account access diagnostic', identityDiagnostic);
        if (identityDiagnostic && !identityDiagnostic.permitted) {
          const account = identityDiagnostic.maskedEmail || '(unknown account)';
          const basis = identityDiagnostic.matchBasis || 'none';
          $('diagGoogle').textContent = `Google credential accepted for ${account}, but this account is not authorised for Office Safety. Access match: ${basis}.`;
        }
      } catch (diagnosticError) {
        Debug.warn('google-auth', 'Identity diagnostic request also failed', { error: diagnosticError });
      }
      clearSessionToken();
      state.token = '';
      toast(error.message, 'error');
      setConnection(false, 'Sign in failed');
      Debug.error('google', 'Credential accepted by GIS but backend bootstrap failed', { error, identityDiagnostic, credentialClaims: credentialDiagnostics });
    }
  }

  function initGoogle() {
    googleInitAttempts++;
    const gsiScript = document.getElementById('gsiClientScript');
    if (!cfg.googleClientId || cfg.googleClientId.includes('PASTE_')) {
      $('loginHelp').textContent = 'Set googleClientId and apiUrl in config.js before signing in.';
      Debug.error('google', 'Google Identity initialisation stopped because client ID is missing', { clientIdConfigured: Boolean(cfg.googleClientId) });
      return;
    }
    if (!window.google?.accounts?.id) {
      if (googleInitAttempts === 1 || googleInitAttempts % 10 === 0) {
        Debug.debug('google', 'Waiting for Google Identity Services library', {
          attempt: googleInitAttempts,
          scriptPresent: Boolean(gsiScript),
          scriptSrc: gsiScript?.src || '',
          googleObjectPresent: Boolean(window.google),
          accountsPresent: Boolean(window.google?.accounts)
        });
      }
      return setTimeout(initGoogle, 200);
    }

    const gsiContext = {
      frontendVersion: VERSION,
      pageOrigin: location.origin,
      pageHref: location.href,
      clientId: cfg.googleClientId,
      clientIdSuffix: cfg.googleClientId.slice(-36),
      gsiScriptSrc: gsiScript?.src || '',
      hostedDomainHint: cfg.allowedDomainHint || '',
      referrerPolicy: document.querySelector('meta[name="referrer"]')?.content || '',
      topLevel: window.top === window.self,
      attempts: googleInitAttempts
    };
    Debug.info('google', 'Initialising Google Identity Services', gsiContext);
    $('diagGoogle').textContent = `Client configured. Exact page origin: ${location.origin}. Client ID suffix: ${cfg.googleClientId.slice(-20)}.`;

    try {
      const googleOptions = {
        client_id: cfg.googleClientId,
        callback: handleCredential,
        auto_select: false,
        cancel_on_tap_outside: true
      };
      if (cfg.allowedDomainHint) googleOptions.hd = cfg.allowedDomainHint;
      google.accounts.id.initialize(googleOptions);
      Debug.info('google', 'google.accounts.id.initialize completed', gsiContext);

      google.accounts.id.renderButton($('googleSignIn'), { theme: 'outline', size: 'large', text: 'signin_with', shape: 'pill', width: 310 });
      queueMicrotask(() => {
        const renderedIframe = document.querySelector('#googleSignIn iframe');
        let iframeInfo = null;
        if (renderedIframe) {
          const src = renderedIframe.getAttribute('src') || '';
          try {
            const url = new URL(src, location.href);
            iframeInfo = {
              present: true,
              origin: url.origin,
              pathname: url.pathname,
              clientIdInIframe: url.searchParams.get('client_id') || '',
              clientIdMatchesConfig: (url.searchParams.get('client_id') || '') === cfg.googleClientId
            };
          } catch {
            iframeInfo = { present: true, srcParseFailed: true };
          }
        } else {
          iframeInfo = { present: false };
        }
        Debug.info('google', 'Google sign-in button render result', iframeInfo);
      });
    } catch (error) {
      $('diagGoogle').textContent = `Google Identity initialisation failed: ${error.message}`;
      Debug.error('google', 'Google Identity initialisation threw an exception', { error, context: gsiContext });
    }
  }

  async function checkIn() {
    const officeId = $('officeSelect').value;
    if (!officeId) return toast('Choose an office first.', 'warn');
    try {
      const completed = await runExclusive('Checking In', async () => {
        const data = await api('checkIn', {
          officeId,
          status: state.selectedStatus,
          note: $('checkInNote').value.trim(),
          clientRequestId: makeClientRequestId('checkin')
        });
        state.presence = data.presence;
        enterOffice(state.presence);
        toast(`Checked into ${officeById(officeId)?.name || 'office'}.`);
        return true;
      }, { detail: 'Saving your office, traffic light and presence.' });
      if (completed) pollNow();
    } catch (error) { toast(error.message, 'error'); }
  }

  function enterOffice(presence) {
    state.presence = presence;
    state.lastMessageIds.clear();
    state.messageBaselineReady = false;
    state.lastPersonStates.clear();
    state.mode = 'office';
    setView('officeView');
    switchMode('office');
    $('officeName').textContent = officeById(presence.officeId)?.name || presence.officeId;
    $('statusNote').value = presence.note || '';
    applyStatusSelection(presence.status || 'green');
    $('myLastUpdate').textContent = presence.updatedAt ? `Updated ${ago(presence.updatedAt)}` : '';
    startWorker();
    startHeartbeat();
    updatePipAvailability();
    updateQuickControlsAvailability();
    updateMediaControlsAvailability();
    updateMediaSession();
    scheduleBackgroundFlush('enter-office');
    consumePendingExternalAction();
    pollNow();
  }

  async function updateStatus(statusOverride = '') {
    const nextStatus = statusOverride || state.selectedStatus;
    const note = $('statusNote').value.trim();
    const clientRequestId = makeClientRequestId('status');
    try {
      const completed = await runExclusive('Updating Status', async () => {
        state.selectedStatus = nextStatus;
        applyStatusSelection(nextStatus);
        const data = await api('setStatus', { status: nextStatus, note, clientRequestId });
        state.presence = data.presence;
        $('myLastUpdate').textContent = `Updated ${ago(data.presence.updatedAt)}`;
        toast(`Status set to ${nextStatus}.`);
        renderPip();
        updateMediaSession();
        return true;
      }, { detail: `Sending your ${nextStatus} status to the office.` });
      if (completed) pollNow();
    } catch (error) {
      if (state.settings.backgroundSync && isRetryableBackgroundError(error) && state.presence) {
        try {
          const maxAgeMs = nextStatus === 'red' ? 60000 : nextStatus === 'amber' ? 120000 : 300000;
          await queueBackgroundAction('setStatus', { status: nextStatus, note, clientRequestId }, {
            maxAgeMs,
            label: `${nextStatus} status`
          });
          $('myLastUpdate').textContent = `${nextStatus.toUpperCase()} queued, not yet confirmed`;
          const warning = nextStatus === 'red'
            ? 'RED status is queued but has not reached the office yet. Use your emergency procedures if there is immediate danger.'
            : `${nextStatus.toUpperCase()} status queued. It will retry when the connection is available.`;
          toast(warning, nextStatus === 'red' ? 'error' : 'warn');
          return;
        } catch (queueError) {
          Debug.error('background-sync', 'Could not queue failed status update', { error: queueError, originalError: error });
        }
      }
      toast(error.message, 'error');
    }
  }

  async function checkOut({ changeOffice = false } = {}) {
    try {
      await runExclusive(changeOffice ? 'Changing Office' : 'Checking Out', async () => {
        await api('checkOut', { clientRequestId: makeClientRequestId('checkout') });
        state.presence = null;
        state.mediaMonitorOfficeId = '';
        state.lastMessageIds.clear();
        state.messageBaselineReady = false;
        state.lastPersonStates.clear();
        stopRealtime();
        closePip();
        stopSilentMediaStream({ clearSession: true, remember: true });
        $('checkInNote').value = '';
        applyStatusSelection('green', 'setup');
        populateOffices();
        setView('setupView');
        updatePipAvailability();
        updateMediaControlsAvailability();
        if (!changeOffice) toast('Checked out.');
      }, { detail: changeOffice ? 'Closing your current office presence before choosing another office.' : 'Removing you from the live office roster.' });
    } catch (error) { toast(error.message, 'error'); }
  }

  async function sendMessage(admin = false) {
    const input = admin ? $('adminMessageInput') : $('messageInput');
    const text = input.value.trim();
    if (!text) return;
    const officeId = admin ? $('adminMessageOffice').value : state.presence?.officeId;
    const severity = admin ? $('adminMessageSeverity').value : undefined;
    const clientRequestId = makeClientRequestId(admin ? 'announcement' : 'message');
    try {
      const completed = await runExclusive(admin ? 'Sending Announcement' : 'Sending Message', async () => {
        await api('sendMessage', { officeId, text, severity, clientRequestId });
        input.value = '';
        toast('Message sent.');
        return true;
      }, { detail: admin ? 'Sending the announcement and waiting for confirmation.' : 'Sending your message to this office and waiting for confirmation.' });
      if (completed) pollNow();
    } catch (error) {
      if (!admin && state.settings.backgroundSync && isRetryableBackgroundError(error) && state.presence) {
        try {
          await queueBackgroundAction('sendMessage', { officeId, text, severity, clientRequestId }, {
            maxAgeMs: 300000,
            label: 'office message'
          });
          input.value = '';
          toast('Message queued. It will retry in the background when the connection is available.', 'warn');
          return;
        } catch (queueError) {
          Debug.error('background-sync', 'Could not queue failed office message', { error: queueError, originalError: error });
        }
      }
      toast(error.message, 'error');
    }
  }

  function deriveOfficeStatus(people = []) {
    if (!people.length) return 'empty';
    if (people.some(p => p.status === 'red')) return 'red';
    if (people.some(p => p.status === 'amber')) return 'amber';
    return 'green';
  }

  function renderOffice(snapshot) {
    if (!snapshot) return;
    state.snapshot = snapshot;
    const people = snapshot.people || [];
    notifyStatusChanges(people);
    const status = snapshot.officeStatus || deriveOfficeStatus(people);
    $('officeSummary').textContent = `${people.length} ${people.length === 1 ? 'person' : 'people'} checked in • refreshed ${new Date().toLocaleTimeString('en-NZ', { hour:'2-digit', minute:'2-digit' })}`;
    $('officeSignal').className = `office-signal ${status}`;
    $('officeSignal').innerHTML = `<span></span><strong>${status.toUpperCase()}</strong>`;
    $('peopleCount').textContent = people.length;
    $('peopleList').classList.toggle('empty-state', !people.length);
    $('peopleList').innerHTML = people.length ? people.map(personRowHtml).join('') : 'No one is currently checked in.';

    const messages = snapshot.messages || [];
    notifyNewMessages(messages);
    $('messageFeed').classList.toggle('empty-state', !messages.length);
    $('messageFeed').innerHTML = messages.length ? messages.map(message => `
      <div class="message-row ${message.severity && message.severity !== 'green' ? `important ${message.severity}` : ''}">
        <div class="message-meta">${escapeHtml(message.authorName || message.authorEmail)} • ${formatTime(message.createdAt)}${message.officeId === '*' ? ' • All offices' : ''}</div>
        <p>${escapeHtml(message.text)}</p>
      </div>`).join('') : 'No recent messages.';
    renderOtherOffices(snapshot.directory || []);
    if (!state.mediaMonitorOfficeId || !(snapshot.directory || []).some(office => office.officeId === state.mediaMonitorOfficeId)) {
      state.mediaMonitorOfficeId = state.presence?.officeId || snapshot.officeId || '';
    }
    renderPip();
    updateMediaSession();
  }

  function personRowHtml(person) {
    return `<div class="person-row ${escapeHtml(person.status || 'green')}">
      <span class="person-status"></span>
      <div class="person-main"><strong>${escapeHtml(person.name || person.email)}</strong><small>${escapeHtml(person.email)} • ${ago(person.updatedAt)}</small>${person.note ? `<div class="person-note">${escapeHtml(person.note)}</div>` : ''}</div>
      <span class="status-tag">${escapeHtml(person.status || 'green')}</span>
    </div>`;
  }

  function renderOtherOffices(directory = []) {
    const currentOfficeId = state.presence?.officeId || '';
    const offices = directory.filter(office => office.officeId !== currentOfficeId);
    const target = $('otherOfficesList');
    if (!target) return;
    $('otherOfficesCount').textContent = String(offices.reduce((total, office) => total + (office.people || []).length, 0));
    target.classList.toggle('empty-state', !offices.length);
    target.innerHTML = offices.length ? offices.map(office => {
      const people = office.people || [];
      const status = office.officeStatus || deriveOfficeStatus(people);
      return `<article class="other-office-card ${escapeHtml(status)}">
        <div class="other-office-header">
          <div><p class="eyebrow">Live Roster</p><h4>${escapeHtml(office.officeName || office.officeId)}</h4><p class="small muted">${people.length} ${people.length === 1 ? 'person' : 'people'} checked in</p></div>
          <div class="mini-office-signal ${escapeHtml(status)}"><span></span><strong>${escapeHtml(status.toUpperCase())}</strong></div>
        </div>
        <div class="people-list other-office-people ${people.length ? '' : 'empty-state'}">${people.length ? people.map(personRowHtml).join('') : 'No one is currently checked in.'}</div>
      </article>`;
    }).join('') : 'No other active offices are configured.';
  }

  function notifyStatusChanges(people) {
    const seen = new Set();
    for (const person of people) {
      const key = `${String(person.officeId || '')}|${String(person.email || person.name || '')}`;
      seen.add(key);
      const previous = state.lastPersonStates.get(key);
      state.lastPersonStates.set(key, person.status || 'green');
      if (!previous || previous === person.status || person.email === state.user?.email) continue;
      if (person.status !== 'amber' && person.status !== 'red') continue;
      const severity = person.status;
      if (state.settings.sound) beep(severity === 'red' ? 660 : 520);
      state.importantBadgeCount += 1;
      updateAppBadge();
      showSystemNotification({
        id: `status-${key}-${person.updatedAt || Date.now()}`,
        officeId: person.officeId || '',
        severity,
        kind: 'status',
        authorName: person.name || person.email,
        authorEmail: person.email || '',
        text: `${person.name || person.email || 'A staff member'} changed their traffic light to ${severity.toUpperCase()}${person.note ? `: ${person.note}` : '.'}`
      }).catch(error => Debug.warn('notifications', 'Status notification failed', { error }));
    }
    for (const key of [...state.lastPersonStates.keys()]) {
      if (!seen.has(key)) state.lastPersonStates.delete(key);
    }
  }

  function notifyNewMessages(messages) {
    if (!state.messageBaselineReady) {
      messages.forEach(message => state.lastMessageIds.add(message.id));
      state.messageBaselineReady = true;
      return;
    }
    for (const message of messages) {
      if (state.lastMessageIds.has(message.id)) continue;
      state.lastMessageIds.add(message.id);
      if (message.authorEmail === state.user?.email) continue;
      const important = message.severity === 'red' || message.severity === 'amber';
      if (important && state.settings.sound) beep(message.severity === 'red' ? 660 : 520);
      if (important) {
        state.importantBadgeCount += 1;
        updateAppBadge();
        showSystemNotification(message).catch(error => Debug.warn('notifications', 'System notification failed', { error }));
      }
    }
    if (state.lastMessageIds.size > 300) state.lastMessageIds = new Set([...state.lastMessageIds].slice(-200));
  }

  function beep(freq) {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq; gain.gain.value = .045; osc.connect(gain); gain.connect(ctx.destination);
      osc.start(); setTimeout(() => { osc.stop(); ctx.close(); }, 160);
    } catch {}
  }

  async function getServiceWorkerRegistration() {
    if (state.swRegistration) return state.swRegistration;
    if (!('serviceWorker' in navigator)) return null;
    try {
      state.swRegistration = await navigator.serviceWorker.ready;
      return state.swRegistration;
    } catch (error) {
      Debug.warn('service-worker', 'Could not obtain ready Service Worker registration', { error });
      return null;
    }
  }

  async function showSystemNotification(message, { force = false } = {}) {
    if (!('Notification' in window)) return false;
    if (!force && !state.settings.notifications) return false;
    if (Notification.permission !== 'granted') return false;
    const registration = await getServiceWorkerRegistration();
    const severity = String(message.severity || 'green').toLowerCase();
    const title = force ? 'Office Safety notification test' : (message.kind === 'status' ? `${severity.toUpperCase()} staff status` : `${severity.toUpperCase()} office message`);
    const body = force ? 'System notifications are working for Office Safety.' : (message.kind === 'status' ? String(message.text || '') : `${message.authorName || message.authorEmail || 'Office Safety'}: ${message.text || ''}`);
    const options = {
      body,
      icon: './icon-192.png',
      badge: './badge-96.png',
      tag: force ? 'office-safety-test' : `office-message-${message.id || Date.now()}`,
      renotify: !force,
      requireInteraction: severity === 'red' && !force,
      data: { url: './', officeId: message.officeId || state.presence?.officeId || '', messageId: message.id || '', severity },
      actions: notificationActions([
        { action: 'open', title: 'Open' },
        { action: 'controls', title: 'Quick Controls' },
        { action: 'dismiss', title: 'Dismiss' }
      ])
    };
    if (registration?.showNotification) {
      await registration.showNotification(title, options);
      Debug.info('notifications', 'Service Worker notification shown', { severity, messageId: message.id || '', force });
      return true;
    }
    const notification = new Notification(title, options);
    notification.onclick = () => { window.focus(); notification.close(); };
    return true;
  }

  async function requestNotifications({ test = false } = {}) {
    if (!('Notification' in window)) {
      toast('System notifications are not supported in this browser.', 'warn');
      return false;
    }
    let permission = Notification.permission;
    if (permission === 'default') permission = await Notification.requestPermission();
    const granted = permission === 'granted';
    if (!test) {
      state.settings.notifications = granted;
      saveSettings();
    }
    updateNotificationSettingsUi();
    if (!granted) {
      toast(permission === 'denied' ? 'Notifications are blocked in browser settings.' : 'Notification permission was not granted.', 'warn');
      return false;
    }
    if (test) await showSystemNotification({ severity: 'green' }, { force: true });
    return true;
  }

  async function testNotifications() {
    try {
      await runExclusive('Testing Notifications', () => requestNotifications({ test: true }), {
        detail: 'Requesting notification permission and sending a test alert.'
      });
    } catch (error) {
      toast(error.message || 'Could not send the test notification.', 'error');
    }
  }

  function updateNotificationSettingsUi() {
    const supported = 'Notification' in window;
    const permission = supported ? Notification.permission : 'unsupported';
    if (permission === 'denied' && state.settings.notifications) {
      state.settings.notifications = false;
      saveSettings();
      if ($('notificationsSetting')) $('notificationsSetting').checked = false;
    }
    const status = $('notificationPermissionState');
    if (status) status.textContent = `Permission: ${permission}`;
    const testButton = $('testNotificationBtn');
    if (testButton) testButton.disabled = !supported;
  }


  function notificationActions(actions) {
    if (typeof Notification === 'undefined' || !('maxActions' in Notification)) return [];
    const max = Number(Notification.maxActions);
    if (!Number.isFinite(max) || max <= 0) return [];
    return actions.slice(0, max);
  }

  async function showQuickControlsNotification() {
    if (!state.presence) {
      toast('Check into an office before showing notification controls.', 'warn');
      return false;
    }
    const granted = Notification.permission === 'granted' || await requestNotifications();
    if (!granted) return false;
    const registration = await getServiceWorkerRegistration();
    if (!registration?.showNotification) {
      toast('Persistent notification controls are not available in this browser.', 'warn');
      return false;
    }
    const max = Number(Notification.maxActions);
    if (!('maxActions' in Notification) || !Number.isFinite(max) || max <= 0) {
      toast('This browser does not expose notification action buttons.', 'warn');
      return false;
    }
    const office = officeById(state.presence.officeId)?.name || state.presence.officeId;
    const current = String(state.presence.status || state.selectedStatus || 'green').toUpperCase();
    const allActions = [
      { action: 'status-green', title: 'Green' },
      { action: 'status-amber', title: 'Amber' },
      { action: 'status-red', title: 'Red' }
    ];
    const actions = max >= 3 ? allActions : max === 2 ? allActions.slice(1) : allActions.slice(2);
    await registration.showNotification('Office Safety Quick Controls', {
      body: `${office} • Your current status is ${current}. Tap the notification to open Office Safety.`,
      icon: './icon-192.png',
      badge: './badge-96.png',
      tag: 'office-safety-quick-controls',
      renotify: false,
      requireInteraction: true,
      silent: true,
      data: {
        url: './',
        kind: 'quick-controls',
        officeId: state.presence.officeId,
        severity: state.presence.status || 'green'
      },
      actions
    });
    Debug.info('notifications', 'Quick control notification shown', {
      officeId: state.presence.officeId,
      status: state.presence.status || 'green',
      actions: actions.map(item => item.action),
      maxActions: Number.isFinite(max) ? max : null
    });
    return true;
  }

  function updateQuickControlsAvailability() {
    const button = $('quickControlsBtn');
    if (!button) return;
    button.classList.toggle('hidden', !state.presence || !state.settings.quickControls);
    button.disabled = !('Notification' in window);
  }

  function captureExternalActionFromUrl() {
    try {
      const url = new URL(location.href);
      const action = url.searchParams.get(QUICK_ACTION_PARAM);
      if (!action) return;
      state.pendingExternalAction = { action, data: {} };
      url.searchParams.delete(QUICK_ACTION_PARAM);
      history.replaceState(history.state, '', url.href);
      Debug.info('external-action', 'Captured quick action from launch URL', { action });
    } catch (error) {
      Debug.warn('external-action', 'Could not parse launch quick action', { error });
    }
  }

  async function handleExternalAction(action, data = {}) {
    action = String(action || '');
    Debug.info('external-action', 'Handling external action', { action, signedIn: Boolean(state.token), hasPresence: Boolean(state.presence) });
    if (!state.token || state.uiLock) {
      state.pendingExternalAction = { action, data };
      return;
    }
    if (action === 'open' || !action) return;
    if (action === 'refresh') {
      await manualRefresh();
      return;
    }
    if (action === 'sync-now') {
      await runExclusive('Syncing Queued Actions', async () => {
        await flushOutbox({ reason: 'notification-action' });
        if (state.token && !state.liveMonitoringPaused) await performPoll();
      }, { detail: 'Reconnecting and sending queued Office Safety actions.' });
      return;
    }
    if (action === 'controls') {
      await showQuickControlsNotification();
      return;
    }
    if (action === 'pip') {
      await openPip();
      return;
    }
    if (action === 'media-controls') {
      openMediaControls();
      return;
    }
    if (action.startsWith('status-')) {
      const status = action.slice(7);
      if (!['green','amber','red'].includes(status)) return;
      if (!state.presence) {
        toast('Check into an office before changing your traffic light.', 'warn');
        return;
      }
      if (status === 'red' && !window.confirm('Set your Office Safety status to RED?')) return;
      await updateStatus(status);
    }
  }

  function consumePendingExternalAction() {
    if (!state.pendingExternalAction || !state.token || state.uiLock) return;
    const pending = state.pendingExternalAction;
    state.pendingExternalAction = null;
    setTimeout(() => {
      handleExternalAction(pending.action, pending.data).catch(error => {
        Debug.warn('external-action', 'Quick action failed', { action: pending.action, error });
        toast(error.message || 'Quick action could not be completed.', 'warn');
      });
    }, 0);
  }

  function mediaOfficeDirectory() {
    const directory = Array.isArray(state.snapshot?.directory) ? state.snapshot.directory : [];
    if (directory.length) return directory;
    if (!state.presence) return [];
    const people = state.snapshot?.people || [];
    return [{
      officeId: state.presence.officeId,
      officeName: officeById(state.presence.officeId)?.name || state.presence.officeId,
      officeStatus: state.snapshot?.officeStatus || deriveOfficeStatus(people),
      people
    }];
  }

  function activeMediaOfficeId() {
    const directory = mediaOfficeDirectory();
    const requested = state.mediaMonitorOfficeId || state.presence?.officeId || '';
    if (requested && directory.some(office => office.officeId === requested)) return requested;
    return state.presence?.officeId || directory[0]?.officeId || '';
  }

  const ALERT_LEVELS = ['green', 'amber', 'red'];

  async function shiftMediaAlertLevel(direction = 1, source = 'media-session') {
    if (!state.presence) {
      Debug.warn('media-session', 'Ignored alert-level media action because the user is not checked in', { direction, source });
      return false;
    }
    const current = String(state.presence.status || state.selectedStatus || 'green').toLowerCase();
    const currentIndex = Math.max(0, ALERT_LEVELS.indexOf(current));
    const targetIndex = Math.max(0, Math.min(ALERT_LEVELS.length - 1, currentIndex + (direction < 0 ? -1 : 1)));
    const target = ALERT_LEVELS[targetIndex];
    if (target === current) {
      const boundary = direction < 0 ? 'lowest' : 'highest';
      toast(`Already at the ${boundary} alert level: ${current}.`, 'warn');
      Debug.info('media-session', 'Alert-level media action reached status boundary', { current, direction, source });
      updateMediaSession();
      updateMediaControlUi();
      return false;
    }
    Debug.info('media-session', 'Media control changing personal alert level', { from: current, to: target, direction, source });
    await updateStatus(target);
    updateMediaControlUi();
    updateMediaSession();
    return String(state.presence?.status || '').toLowerCase() === target;
  }

  const MEDIA_ACTIONS = ['play','pause','stop','enterpictureinpicture','previoustrack','nexttrack','previousslide','nextslide'];

  function ensureMediaCarrier() {
    if (state.mediaCarrier && document.contains(state.mediaCarrier)) return state.mediaCarrier;
    const audio = document.createElement('audio');
    audio.id = 'officeSafetyMediaCarrier';
    audio.className = 'media-carrier';
    audio.src = './silent-monitor.wav';
    audio.loop = true;
    audio.preload = 'auto';
    audio.playsInline = true;
    audio.setAttribute('playsinline', '');
    audio.setAttribute('aria-hidden', 'true');
    audio.tabIndex = -1;
    const syncState = () => {
      state.mediaStreamActive = !audio.paused && !audio.ended;
      updateMediaControlUi();
      updateMediaSession();
    };
    audio.addEventListener('play', syncState);
    audio.addEventListener('playing', () => { syncState(); mediaKeepAliveTick('playing'); });
    audio.addEventListener('timeupdate', () => mediaKeepAliveTick('timeupdate'));
    audio.addEventListener('pause', syncState);
    audio.addEventListener('ended', syncState);
    audio.addEventListener('error', () => {
      state.mediaStreamActive = false;
      Debug.warn('media-session', 'Silent media carrier failed', { mediaErrorCode: audio.error?.code || null });
      updateMediaControlUi();
    });
    document.body.appendChild(audio);
    state.mediaCarrier = audio;
    return audio;
  }

  function mediaCarrierIsPlaying() {
    return Boolean(state.mediaCarrier && !state.mediaCarrier.paused && !state.mediaCarrier.ended);
  }

  function mediaKeepAliveTick(source = 'media-timeupdate') {
    if (!state.presence || !mediaCarrierIsPlaying() || state.liveMonitoringPaused) return;
    startWorker();
    if (!state.heartbeat) startHeartbeat();
    const now = Date.now();
    const refreshEvery = Math.max(5000, Number(state.settings.pollMs || cfg.defaultPollMs || 10000));
    if (now - Number(state.mediaLastKeepAliveAt || 0) < refreshEvery) return;
    state.mediaLastKeepAliveAt = now;
    pollNow();
    Debug.debug('media-session', 'Silent carrier keep-alive refresh tick', { source, refreshEvery });
  }

  function setLiveMonitoringPaused(paused, { notify = true } = {}) {
    state.liveMonitoringPaused = Boolean(paused);
    if (state.liveMonitoringPaused) {
      state.worker?.postMessage({ type:'stop' });
      if (notify) toast('Live roster refresh paused. Your presence heartbeat is still active.', 'warn');
    } else {
      startWorker();
      pollNow();
      if (notify) toast('Live roster refresh resumed.');
    }
    updateMediaSession();
    updateMediaControlUi();
  }

  async function startSilentMediaStream({ source = 'ui', resumeMonitoring = true } = {}) {
    if (!state.presence) throw new Error('Check into an office before starting media controls.');
    if (!('mediaSession' in navigator)) throw new Error('Media Session is not supported by this browser.');
    state.settings.mediaControls = true;
    state.settings.mediaStreamPreferred = true;
    saveSettings();
    const audio = ensureMediaCarrier();
    try {
      await audio.play();
    } catch (error) {
      Debug.warn('media-session', 'Browser refused to start the silent media carrier', { source, error });
      throw new Error('The browser did not allow the media stream to start. Tap Start Media Stream directly from the page and try again.');
    }
    state.mediaStreamActive = true;
    if (resumeMonitoring) {
      state.liveMonitoringPaused = false;
      startWorker();
      startHeartbeat();
      state.mediaLastKeepAliveAt = 0;
      mediaKeepAliveTick('start');
    }
    updateMediaSession();
    updateMediaControlUi();
    updateMediaControlsAvailability();
    Debug.info('media-session', 'Silent media carrier started', { source, monitorOfficeId: activeMediaOfficeId() });
    return true;
  }

  function pauseSilentMediaStream({ pauseMonitoring = true, notify = false } = {}) {
    const audio = state.mediaCarrier;
    if (audio && !audio.paused) audio.pause();
    state.mediaStreamActive = false;
    if (pauseMonitoring) setLiveMonitoringPaused(true, { notify });
    else {
      updateMediaSession();
      updateMediaControlUi();
    }
  }

  function stopSilentMediaStream({ clearSession = true, remember = false, notify = false } = {}) {
    const audio = state.mediaCarrier;
    if (audio) {
      try { audio.pause(); } catch {}
      try { audio.currentTime = 0; } catch {}
    }
    state.mediaStreamActive = false;
    state.mediaLastKeepAliveAt = 0;
    if (!remember) {
      state.settings.mediaStreamPreferred = false;
      saveSettings();
    }
    if (clearSession) clearMediaSession();
    else updateMediaSession();
    updateMediaControlUi();
    updateMediaControlsAvailability();
    if (notify) toast('Silent media stream stopped.');
  }

  function updateMediaControlsAvailability() {
    const button = $('mediaControlsBtn');
    if (!button) return;
    const supported = 'mediaSession' in navigator;
    button.classList.toggle('hidden', !state.presence || !supported);
    button.disabled = !supported;
    button.classList.toggle('active', mediaCarrierIsPlaying());
    button.title = !supported
      ? 'Media Session is not supported by this browser'
      : mediaCarrierIsPlaying()
        ? 'Media controls are active using a silent media stream'
        : 'Open Media Session controls';
  }

  function updateMediaControlUi() {
    const supported = 'mediaSession' in navigator;
    const active = mediaCarrierIsPlaying();
    const snapshot = state.presence ? currentPipSnapshot() : null;
    const office = snapshot?.officeName || officeById(snapshot?.officeId || state.presence?.officeId)?.name || snapshot?.officeId || state.presence?.officeId || 'Not checked in';
    const values = {
      mediaControlSupportState: supported ? 'Available' : 'Unavailable',
      mediaStreamState: active ? 'Running silently' : 'Stopped',
      mediaMonitoredOffice: office,
      mediaMonitoringState: state.liveMonitoringPaused ? 'Live refresh paused' : 'Live refresh running'
    };
    Object.entries(values).forEach(([id, value]) => { const el = $(id); if (el) el.textContent = value; });
    const start = $('startMediaStreamBtn');
    const stop = $('stopMediaStreamBtn');
    const lower = $('mediaLowerAlertBtn');
    const raise = $('mediaRaiseAlertBtn');
    const pauseResume = $('mediaPauseResumeBtn');
    const pip = $('mediaPipBtn');
    if (start) { start.disabled = !supported || !state.presence || active; start.textContent = active ? 'Media Stream Running' : 'Start Silent Media Stream'; }
    if (stop) stop.disabled = !active;
    if (lower) lower.disabled = !state.presence || state.uiLock || String(state.presence.status || state.selectedStatus || 'green').toLowerCase() === 'green';
    if (raise) raise.disabled = !state.presence || state.uiLock || String(state.presence.status || state.selectedStatus || 'green').toLowerCase() === 'red';
    if (pauseResume) {
      pauseResume.disabled = !state.presence;
      pauseResume.textContent = state.liveMonitoringPaused ? 'Resume Live Refresh' : 'Pause Live Refresh';
    }
    if (pip) pip.disabled = !state.presence || !('documentPictureInPicture' in window) || !window.isSecureContext;
  }

  function openMediaControls() {
    if (!state.presence) return toast('Check into an office before opening media controls.', 'warn');
    updateMediaControlUi();
    $('mediaControlsDialog')?.showModal();
  }

  function clearMediaSession() {
    if (!('mediaSession' in navigator)) return;
    for (const action of MEDIA_ACTIONS) {
      try { navigator.mediaSession.setActionHandler(action, null); } catch {}
    }
    try { navigator.mediaSession.metadata = null; } catch {}
    try { navigator.mediaSession.playbackState = 'none'; } catch {}
    state.mediaSessionActive = false;
  }

  function updateMediaSession() {
    if (!state.settings.mediaControls || !state.presence || !('mediaSession' in navigator)) {
      clearMediaSession();
      updateMediaControlUi();
      return;
    }
    const snapshot = currentPipSnapshot();
    const office = snapshot?.officeName || officeById(snapshot?.officeId || state.presence.officeId)?.name || snapshot?.officeId || state.presence.officeId || 'Office';
    const status = String(snapshot?.officeStatus || deriveOfficeStatus(snapshot?.people || [])).toUpperCase();
    const myStatus = String(state.presence.status || state.selectedStatus || 'green').toUpperCase();
    const peopleCount = snapshot?.people?.length || 0;
    if ('MediaMetadata' in window) {
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: `${office} • ${status}`,
          artist: `Play keeps live refresh active • My status ${myStatus}`,
          album: `Previous lowers alert • Next raises alert • ${peopleCount} ${peopleCount === 1 ? 'person' : 'people'} checked in`,
          artwork: [
            { src: './icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: './icon-512.png', sizes: '512x512', type: 'image/png' }
          ]
        });
      } catch (error) {
        Debug.debug('media-session', 'Media metadata could not be updated', { error });
      }
    }

    const setHandler = (action, handler) => {
      try { navigator.mediaSession.setActionHandler(action, handler); }
      catch (error) { Debug.debug('media-session', 'Media action is not supported', { action, error }); }
    };
    setHandler('play', () => {
      startSilentMediaStream({ source: 'media-session-play', resumeMonitoring: true })
        .catch(error => Debug.warn('media-session', 'Play media action could not start silent carrier', { error }));
    });
    setHandler('pause', () => pauseSilentMediaStream({ pauseMonitoring: true, notify: true }));
    setHandler('stop', () => {
      setLiveMonitoringPaused(true, { notify: false });
      stopSilentMediaStream({ clearSession: true, remember: false, notify: false });
    });
    setHandler('enterpictureinpicture', () => {
      openPip().catch(error => Debug.warn('media-session', 'PiP media action could not open', { error }));
    });
    setHandler('previoustrack', () => shiftMediaAlertLevel(-1, 'media-session-previous').catch(error => Debug.warn('media-session', 'Previous media action could not lower alert level', { error })));
    setHandler('nexttrack', () => shiftMediaAlertLevel(1, 'media-session-next').catch(error => Debug.warn('media-session', 'Next media action could not raise alert level', { error })));
    setHandler('previousslide', () => shiftMediaAlertLevel(-1, 'media-session-previous-slide').catch(error => Debug.warn('media-session', 'Previous slide media action could not lower alert level', { error })));
    setHandler('nextslide', () => shiftMediaAlertLevel(1, 'media-session-next-slide').catch(error => Debug.warn('media-session', 'Next slide media action could not raise alert level', { error })));
    try { navigator.mediaSession.playbackState = mediaCarrierIsPlaying() && !state.liveMonitoringPaused ? 'playing' : 'paused'; } catch {}
    state.mediaSessionActive = true;
    updateMediaControlUi();
    updateMediaControlsAvailability();
    Debug.debug('media-session', 'Media Session metadata and monitoring controls updated', {
      office,
      status,
      peopleCount,
      myStatus,
      monitorOfficeId: activeMediaOfficeId(),
      previousAction: 'lower-alert-level',
      nextAction: 'raise-alert-level',
      paused: state.liveMonitoringPaused,
      silentMediaStreamActive: mediaCarrierIsPlaying()
    });
  }

  async function updateAppBadge() {
    try {
      if ('setAppBadge' in navigator) {
        if (state.importantBadgeCount > 0) await navigator.setAppBadge(state.importantBadgeCount);
        else if ('clearAppBadge' in navigator) await navigator.clearAppBadge();
      }
    } catch (error) {
      Debug.debug('pwa', 'App badge update was not available', { error });
    }
  }

  function clearAppBadge() {
    state.importantBadgeCount = 0;
    updateAppBadge();
  }

  function updatePipAvailability() {
    const button = $('pipBtn');
    if (!button) return;
    const supported = 'documentPictureInPicture' in window && window.isSecureContext;
    button.classList.toggle('hidden', !state.presence);
    button.disabled = !supported;
    button.title = supported ? 'Open a compact always-on-top office view' : 'Document Picture-in-Picture is not supported by this browser';
  }

  function currentPipSnapshot() {
    const monitoredOfficeId = activeMediaOfficeId();
    const ownOfficeId = state.presence?.officeId || '';
    if (monitoredOfficeId && monitoredOfficeId !== ownOfficeId) {
      const office = mediaOfficeDirectory().find(item => item.officeId === monitoredOfficeId);
      if (office) return {
        officeId: office.officeId,
        officeName: office.officeName || office.officeId,
        people: office.people || [],
        messages: [],
        officeStatus: office.officeStatus || deriveOfficeStatus(office.people || []),
        readOnlyMonitor: true
      };
    }
    if (state.mode === 'admin' && state.adminSnapshot && ownOfficeId) {
      const people = (state.adminSnapshot.people || []).filter(person => person.officeId === ownOfficeId);
      const messages = (state.adminSnapshot.messages || []).filter(message => message.officeId === ownOfficeId || message.officeId === '*');
      return {
        officeId: ownOfficeId,
        officeName: officeById(ownOfficeId)?.name || ownOfficeId,
        people,
        messages,
        officeStatus: deriveOfficeStatus(people)
      };
    }
    return state.snapshot ? {
      ...state.snapshot,
      officeName: officeById(state.snapshot.officeId || ownOfficeId)?.name || state.snapshot.officeId || ownOfficeId
    } : state.snapshot;
  }

  function pipStatus(snapshot = currentPipSnapshot()) {
    return snapshot?.officeStatus || deriveOfficeStatus(snapshot?.people || []);
  }

  function buildPipDocument(pipWindow) {
    const doc = pipWindow.document;
    doc.title = 'Office Safety';
    doc.head.innerHTML = `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
      :root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#17212b;background:#eef2f6;color-scheme:light}
      *{box-sizing:border-box} body{margin:0;padding:12px;background:#eef2f6} button{font:inherit} .pip{display:grid;gap:10px}.card{background:#fff;border:1px solid #d9e0e7;border-radius:14px;padding:12px;box-shadow:0 8px 25px rgba(0,0,0,.08)}
      .top{display:flex;justify-content:space-between;gap:10px;align-items:start}.eyebrow{font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:#647180;font-weight:800}.name{font-size:19px;font-weight:850;margin-top:2px}.signal{display:flex;align-items:center;gap:7px;border-radius:999px;padding:7px 10px;font-size:12px;font-weight:900;text-transform:uppercase;background:var(--soft);color:var(--status)}.signal i{width:12px;height:12px;border-radius:50%;background:var(--status)}
      .green{--status:#128447;--soft:#e4f5eb}.amber{--status:#a45d00;--soft:#fff0d2}.red{--status:#b42318;--soft:#fde7e5}.empty{--status:#667085;--soft:#eef1f4}.meta{color:#667085;font-size:12px}.statuses{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.statuses button{border:1px solid #d9e0e7;border-radius:10px;padding:9px 4px;background:#f7f9fb;font-size:11px;font-weight:800}.statuses button.selected{border-color:var(--status);background:var(--soft);color:var(--status)}
      .messages{display:grid;gap:6px;max-height:180px;overflow:auto}.msg{font-size:12px;padding:8px;border-radius:9px;background:#f6f8fa}.msg strong{display:block;margin-bottom:2px}.busy{display:none;align-items:center;gap:8px;background:#172333;color:#fff;border-radius:10px;padding:9px 10px;font-size:12px;font-weight:700}.busy.show{display:flex}.spin{width:14px;height:14px;border-radius:50%;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
      .footer{display:flex;justify-content:space-between;gap:8px}.footer button{border:1px solid #d9e0e7;background:#fff;border-radius:9px;padding:7px 9px;font-size:11px;font-weight:750}
    </style>`;
    doc.body.innerHTML = `<main class="pip">
      <div id="pipBusy" class="busy"><span class="spin"></span><span id="pipBusyText">Working...</span></div>
      <section class="card"><div class="top"><div><div class="eyebrow">Office Safety</div><div id="pipOffice" class="name">Office</div></div><div id="pipSignal" class="signal empty"><i></i><span>EMPTY</span></div></div><div id="pipSummary" class="meta">Waiting for office state...</div></section>
      <section class="card"><div class="eyebrow">My Traffic Light</div><div class="statuses"><button data-pip-status="green" class="green">Green</button><button data-pip-status="amber" class="amber">Amber</button><button data-pip-status="red" class="red">Red</button></div></section>
      <section class="card"><div class="eyebrow">Latest Messages</div><div id="pipMessages" class="messages"><div class="meta">No messages yet.</div></div></section>
      <div class="footer"><button id="pipFocus">Open Main App</button><button id="pipClose">Close PiP</button></div>
    </main>`;
    doc.querySelectorAll('[data-pip-status]').forEach(button => button.addEventListener('click', () => updateStatus(button.dataset.pipStatus)));
    doc.getElementById('pipFocus').addEventListener('click', () => { window.focus(); });
    doc.getElementById('pipClose').addEventListener('click', () => pipWindow.close());
  }

  function renderPip() {
    const win = state.pipWindow;
    if (!win || win.closed) return;
    const doc = win.document;
    const snapshot = currentPipSnapshot();
    const office = snapshot?.officeName || officeById(snapshot?.officeId || state.presence?.officeId)?.name || snapshot?.officeId || state.presence?.officeId || 'Not checked in';
    const status = pipStatus(snapshot);
    const people = snapshot?.people || [];
    const messages = (snapshot?.messages || []).slice(0, 3);
    const officeEl = doc.getElementById('pipOffice');
    const signal = doc.getElementById('pipSignal');
    const summary = doc.getElementById('pipSummary');
    const messagesEl = doc.getElementById('pipMessages');
    const busy = doc.getElementById('pipBusy');
    if (!officeEl || !signal || !summary || !messagesEl || !busy) return;
    officeEl.textContent = office;
    signal.className = `signal ${status}`;
    signal.querySelector('span').textContent = status.toUpperCase();
    summary.textContent = `${people.length} ${people.length === 1 ? 'person' : 'people'} checked in`;
    doc.querySelectorAll('[data-pip-status]').forEach(button => button.classList.toggle('selected', button.dataset.pipStatus === (state.presence?.status || state.selectedStatus)));
    messagesEl.innerHTML = '';
    if (!messages.length) {
      const empty = doc.createElement('div'); empty.className = 'meta'; empty.textContent = snapshot?.readOnlyMonitor ? 'Other-office messages are not shared in staff monitor mode.' : 'No messages yet.'; messagesEl.appendChild(empty);
    } else {
      messages.forEach(message => {
        const row = doc.createElement('div'); row.className = `msg ${message.severity || 'green'}`;
        const strong = doc.createElement('strong'); strong.textContent = message.authorName || message.authorEmail || 'Office Safety';
        const text = doc.createElement('div'); text.textContent = message.text || '';
        row.append(strong, text); messagesEl.appendChild(row);
      });
    }
    busy.classList.toggle('show', Boolean(state.uiLock));
    const busyText = doc.getElementById('pipBusyText');
    if (busyText) busyText.textContent = state.uiLock?.label || 'Working...';
    doc.querySelectorAll('[data-pip-status]').forEach(button => { button.disabled = Boolean(state.uiLock); });
  }

  async function openPip() {
    if (!state.presence) return toast('Check into an office before opening PiP mode.', 'warn');
    if (!('documentPictureInPicture' in window) || !window.isSecureContext) {
      toast('Document Picture-in-Picture is not supported in this browser or context.', 'warn');
      return;
    }
    try {
      if (state.pipWindow && !state.pipWindow.closed) {
        state.pipWindow.focus();
        return;
      }
      const pipWindow = await window.documentPictureInPicture.requestWindow({ width: 390, height: 520, preferInitialWindowPlacement: true });
      state.pipWindow = pipWindow;
      buildPipDocument(pipWindow);
      renderPip();
      pipWindow.addEventListener('pagehide', () => { state.pipWindow = null; });
      Debug.info('pip', 'Document Picture-in-Picture opened', { width: pipWindow.innerWidth, height: pipWindow.innerHeight });
    } catch (error) {
      Debug.warn('pip', 'Document Picture-in-Picture could not be opened', { error });
      toast(error.message || 'Could not open Picture-in-Picture.', 'warn');
    }
  }

  function closePip() {
    try { if (state.pipWindow && !state.pipWindow.closed) state.pipWindow.close(); } catch {}
    state.pipWindow = null;
  }

  function renderAdmin(snapshot) {
    state.adminSnapshot = snapshot;
    const people = snapshot.people || [];
    notifyStatusChanges(people);
    $('adminPeopleTotal').textContent = people.length;
    $('adminGreenTotal').textContent = people.filter(p => p.status === 'green').length;
    $('adminAmberTotal').textContent = people.filter(p => p.status === 'amber').length;
    $('adminRedTotal').textContent = people.filter(p => p.status === 'red').length;
    notifyNewMessages(snapshot.messages || []);
    renderAdminFiltered();
    renderAdminMessages(snapshot.messages || []);
    renderActivity(snapshot.activity || []);
    renderPip();
    updateMediaSession();
  }

  function renderAdminFiltered() {
    const snapshot = state.adminSnapshot;
    if (!snapshot) return;
    const officeFilter = $('adminOfficeFilter').value;
    const statusFilter = $('adminStatusFilter').value;
    const search = $('adminSearch').value.trim().toLowerCase();
    const officeMap = new Map(state.offices.map(o => [o.id, o]));
    const allPeople = snapshot.people || [];
    const filteredPeople = allPeople.filter(p => {
      if (officeFilter && p.officeId !== officeFilter) return false;
      if (statusFilter && p.status !== statusFilter) return false;
      if (search && !`${p.name} ${p.email} ${p.note || ''}`.toLowerCase().includes(search)) return false;
      return true;
    });
    const grouped = new Map();
    filteredPeople.forEach(p => { if (!grouped.has(p.officeId)) grouped.set(p.officeId, []); grouped.get(p.officeId).push(p); });
    const ids = officeFilter ? [officeFilter] : state.offices.filter(o => o.active !== false).map(o => o.id);
    const filteringPeople = Boolean(statusFilter || search);
    $('adminOffices').innerHTML = ids.length ? ids.map(id => {
      const officePeople = grouped.get(id) || [];
      const actualOfficePeople = allPeople.filter(p => p.officeId === id);
      const status = deriveOfficeStatus(actualOfficePeople);
      const countText = filteringPeople ? `${officePeople.length} matching • ${actualOfficePeople.length} checked in` : `${actualOfficePeople.length} checked in`;
      const emptyText = filteringPeople
        ? `No people match this filter. ${actualOfficePeople.length} ${actualOfficePeople.length === 1 ? 'person is' : 'people are'} currently checked in.`
        : 'No one is currently checked in.';
      return `<article class="card admin-office-card">
        <div class="admin-office-header"><div><p class="eyebrow">Office</p><h3>${escapeHtml(officeMap.get(id)?.name || id)}</h3><small class="muted">${escapeHtml(countText)}</small></div><span class="status-tag ${status}">${status}</span></div>
        <div class="admin-person-grid">${officePeople.map(p => `<div class="person-row ${p.status}"><span class="person-status"></span><div class="person-main"><strong>${escapeHtml(p.name || p.email)}</strong><small>${escapeHtml(p.email)} • ${ago(p.updatedAt)}</small>${p.note ? `<div class="person-note">${escapeHtml(p.note)}</div>` : ''}</div><span class="status-tag">${escapeHtml(p.status)}</span></div>`).join('') || `<div class="empty-state">${escapeHtml(emptyText)}</div>`}</div>
      </article>`;
    }).join('') : '<article class="card admin-office-card empty-state">No offices are configured.</article>';
  }

  function renderAdminMessages(messages) {
    const officeFilter = $('adminOfficeFilter').value;
    const search = $('adminSearch').value.trim().toLowerCase();
    const officeNames = new Map(state.offices.map(o => [o.id, o.name]));
    const filtered = messages.filter(message => {
      if (officeFilter && message.officeId !== officeFilter && message.officeId !== '*') return false;
      if (search && !`${message.authorName} ${message.authorEmail} ${message.text}`.toLowerCase().includes(search)) return false;
      return true;
    });
    $('adminMessageHistory').classList.toggle('empty-state', !filtered.length);
    $('adminMessageHistory').innerHTML = filtered.length ? filtered.map(message => `
      <div class="message-row ${message.severity && message.severity !== 'green' ? `important ${message.severity}` : ''}">
        <div class="message-meta">${escapeHtml(message.authorName || message.authorEmail)} • ${escapeHtml(message.officeId === '*' ? 'All offices' : (officeNames.get(message.officeId) || message.officeId))} • ${formatTime(message.createdAt)}</div>
        <p>${escapeHtml(message.text)}</p>
      </div>`).join('') : 'No recent messages match the current filters.';
  }

  function renderActivity(activity) {
    $('activityFeed').classList.toggle('empty-state', !activity.length);
    $('activityFeed').innerHTML = activity.length ? activity.map(item => `<div class="activity-row"><div class="activity-meta">${formatTime(item.createdAt)} • ${escapeHtml(item.actorName || item.actorEmail)} • ${escapeHtml(item.officeName || item.officeId || 'System')}</div><p><strong>${escapeHtml(item.action)}</strong>${item.summary ? ` • ${escapeHtml(item.summary)}` : ''}</p></div>`).join('') : 'No recent activity.';
  }

  function handlePresenceExpired() {
    if (!state.presence) return;
    state.presence = null;
    state.lastMessageIds.clear();
    state.messageBaselineReady = false;
    state.lastPersonStates.clear();
    stopRealtime();
    closePip();
    clearMediaSession();
    applyStatusSelection('green', 'setup');
    populateOffices();
    setView('setupView');
    updatePipAvailability();
    updateQuickControlsAvailability();
    toast('Your office check-in expired. Please check in again.', 'warn');
  }

  async function performPoll({ manual = false } = {}) {
    if (!state.token) {
      state.worker?.postMessage({ type:'pollComplete', retryDelay: state.settings.pollMs });
      return;
    }
    if (state.pollInFlight || (state.uiLock && !manual)) {
      Debug.debug('poll', 'Poll deferred because another request is active', { pollInFlight: state.pollInFlight, uiLock: state.uiLock?.label || '', manual });
      state.worker?.postMessage({ type:'pollComplete', retryDelay: Math.max(1500, state.settings.pollMs) });
      return;
    }
    state.pollInFlight = true;
    if (manual) $('syncState').textContent = 'Refreshing...';
    try {
      const action = state.mode === 'admin' && state.isAdmin ? 'adminSnapshot' : 'officeSnapshot';
      const data = await api(action, action === 'officeSnapshot' ? { officeId: state.presence?.officeId || '' } : {});
      if (state.mode === 'admin' && state.isAdmin) renderAdmin(data); else renderOffice(data);
      setConnection(true, `Updated ${new Date().toLocaleTimeString('en-NZ', {hour:'2-digit', minute:'2-digit'})}`);
      state.worker?.postMessage({ type:'pollComplete' });
    } catch (error) {
      const message = String(error?.message || error);
      if (/check into an office|only view the office you are checked into/i.test(message)) {
        state.worker?.postMessage({ type:'stop' });
        handlePresenceExpired();
        return;
      }
      if (/sign[- ]?in|token|Google account/i.test(message)) {
        state.worker?.postMessage({ type:'stop' });
        toast('Your Google sign-in has expired. Please sign in again.', 'warn');
        signOut({ skipServer: true });
        return;
      }
      setConnection(false, 'Reconnecting...');
      console.warn('Office Safety poll failed', error);
      state.worker?.postMessage({ type:'pollComplete', retryDelay: Math.min(Math.max(state.settings.pollMs * 2, 10000), 60000) });
      if (manual) throw error;
    } finally {
      state.pollInFlight = false;
    }
  }

  async function manualRefresh() {
    try {
      await runExclusive('Refreshing Office Data', () => performPoll({ manual: true }), {
        detail: 'Getting the latest roster, traffic lights and messages.'
      });
    } catch (error) {
      toast(error.message || 'Refresh failed.', 'error');
    }
  }

  function startWorker() {
    if (!window.Worker) return;
    if (state.liveMonitoringPaused) {
      state.worker?.postMessage({ type:'stop' });
      return;
    }
    if (!state.worker) {
      state.worker = new Worker('worker.js');
      state.worker.onmessage = event => {
        const msg = event.data || {};
        if (msg.type === 'pollRequest') performPoll();
      };
    }
    state.worker.postMessage({ type:'configure', value:{ pollMs: state.settings.pollMs } });
  }

  function pollNow() {
    if (state.uiLock || state.pollInFlight) return;
    if (state.worker) state.worker.postMessage({ type:'pollNow' });
    else performPoll();
  }

  function startHeartbeat() {
    clearInterval(state.heartbeat);
    const interval = Math.max(30000, Number(cfg.presenceHeartbeatMs || 60000));
    state.heartbeat = setInterval(async () => {
      if (!state.presence || state.uiLock || state.pollInFlight || state.heartbeatInFlight) return;
      state.heartbeatInFlight = true;
      try {
        const data = await api('heartbeat');
        if (data?.presence) state.presence = data.presence;
        else handlePresenceExpired();
      } catch {}
      finally { state.heartbeatInFlight = false; }
    }, interval);
  }

  function stopRealtime() {
    clearInterval(state.heartbeat); state.heartbeat = null;
    state.worker?.postMessage({ type:'stop' });
  }

  function switchMode(mode) {
    if (mode === 'admin' && !state.isAdmin) return;
    const modeChanged = state.mode !== mode;
    state.mode = mode;
    if (modeChanged) {
      state.lastMessageIds.clear();
      state.messageBaselineReady = false;
      state.lastPersonStates.clear();
    }
    $$('.mode-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.view === mode));
    $('officePanel').classList.toggle('hidden', mode !== 'office');
    $('adminPanel').classList.toggle('hidden', mode !== 'admin');
    startWorker();
    updateMediaSession();
    pollNow();
  }

  function openSettings() {
    $('notificationsSetting').checked = state.settings.notifications;
    $('soundSetting').checked = state.settings.sound;
    $('backgroundSyncSetting').checked = state.settings.backgroundSync !== false;
    $('periodicSyncSetting').checked = state.settings.periodicSync !== false;
    $('periodicSyncMinutesSetting').value = String(state.settings.periodicSyncMinutes || 15);
    $('quickControlsSetting').checked = Boolean(state.settings.quickControls);
    $('mediaControlsSetting').checked = Boolean(state.settings.mediaControls);
    $('pollSetting').value = String(state.settings.pollMs || 10000);
    $('defaultOfficeSetting').value = state.settings.defaultOffice || '';
    updateNotificationSettingsUi();
    updateBackgroundSettingsUi();
    updateMediaControlUi();
    $('settingsDialog').showModal();
  }

  async function savePreferences(event) {
    event.preventDefault();
    try {
      await runExclusive('Saving Settings', async () => {
        state.settings.notifications = $('notificationsSetting').checked;
        state.settings.sound = $('soundSetting').checked;
        state.settings.backgroundSync = $('backgroundSyncSetting').checked;
        state.settings.periodicSync = $('periodicSyncSetting').checked;
        state.settings.periodicSyncMinutes = Number($('periodicSyncMinutesSetting').value || 15);
        state.settings.quickControls = $('quickControlsSetting').checked;
        state.settings.mediaControls = $('mediaControlsSetting').checked;
        if (!state.settings.mediaControls && mediaCarrierIsPlaying()) stopSilentMediaStream({ clearSession: true, remember: false });
        state.settings.pollMs = Number($('pollSetting').value);
        state.settings.defaultOffice = $('defaultOfficeSetting').value;
        if (state.settings.notifications || state.settings.quickControls) {
          const granted = await requestNotifications();
          if (!granted) {
            state.settings.notifications = false;
            state.settings.quickControls = false;
          }
        }
        saveSettings();
        startWorker();
        updateNotificationSettingsUi();
        await updateQueuedCount();
        await configureBackgroundFeatures();
        updateMediaSession();
        updateQuickControlsAvailability();
        $('settingsDialog').close();
        toast('Settings saved.');
      }, { detail: 'Applying notification, sound and refresh preferences.' });
    } catch (error) {
      toast(error.message || 'Could not save settings.', 'error');
    }
  }

  async function signOut({ skipServer = false } = {}) {
    const perform = async () => {
      if (!skipServer && state.presence && state.token) {
        try { await api('checkOut', { clientRequestId: makeClientRequestId('signout-checkout') }); } catch {}
      }
      stopRealtime();
      closePip();
      stopSilentMediaStream({ clearSession: true, remember: true });
      clearMediaSession();
      clearSessionToken();
      state.token = ''; state.user = null; state.presence = null; state.snapshot = null; state.adminSnapshot = null; state.mediaMonitorOfficeId = '';
      state.lastMessageIds.clear(); state.messageBaselineReady = false; state.lastPersonStates.clear();
      if (window.google?.accounts?.id) google.accounts.id.disableAutoSelect();
      $('signOutBtn').classList.add('hidden'); $('settingsBtn').classList.add('hidden'); $('pipBtn').classList.add('hidden'); $('quickControlsBtn')?.classList.add('hidden'); $('mediaControlsBtn')?.classList.add('hidden');
      setConnection(false, 'Signed out'); setView('loginView');
      clearAppBadge();
    };
    if (skipServer || state.uiLock) return perform();
    try {
      await runExclusive('Signing Out', perform, { detail: 'Checking out and closing your current Office Safety session.' });
    } catch (error) {
      toast(error.message || 'Sign out failed.', 'error');
    }
  }


  async function installPwa() {
    const promptEvent = state.installPrompt;
    if (!promptEvent) {
      toast("The browser is not currently offering an install prompt. You can still use your browser's Install App command.", 'warn');
      return;
    }
    try {
      promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      Debug.info('pwa', 'PWA install prompt completed', { outcome: choice?.outcome || '' });
      if (choice?.outcome === 'accepted') toast('Office Safety is being installed.');
    } catch (error) {
      Debug.warn('pwa', 'PWA install prompt failed', { error });
    } finally {
      state.installPrompt = null;
      $('installBtn').classList.add('hidden');
    }
  }

  function bindEvents() {
    $$('.status-choice').forEach(btn => btn.addEventListener('click', () => applyStatusSelection(btn.dataset.status, 'setup')));
    $$('.traffic-btn').forEach(btn => btn.addEventListener('click', () => applyStatusSelection(btn.dataset.status)));
    $('checkInBtn').addEventListener('click', checkIn);
    $('updateStatusBtn').addEventListener('click', () => updateStatus());
    $('checkOutBtn').addEventListener('click', () => checkOut());
    $('changeOfficeBtn').addEventListener('click', () => checkOut({ changeOffice:true }));
    $('sendMessageBtn').addEventListener('click', () => sendMessage(false));
    $('messageInput').addEventListener('keydown', e => { if (e.key === 'Enter') sendMessage(false); });
    $$('.message-presets button').forEach(btn => btn.addEventListener('click', () => { $('messageInput').value = btn.dataset.message; $('messageInput').focus(); }));
    $('refreshBtn').addEventListener('click', manualRefresh);
    $('adminRefreshBtn').addEventListener('click', manualRefresh);
    $('adminSendMessageBtn').addEventListener('click', () => sendMessage(true));
    $('adminMessageInput').addEventListener('keydown', e => { if (e.key === 'Enter') sendMessage(true); });
    ['adminOfficeFilter','adminStatusFilter'].forEach(id => $(id).addEventListener('change', () => { renderAdminFiltered(); renderAdminMessages(state.adminSnapshot?.messages || []); }));
    $('adminSearch').addEventListener('input', () => { renderAdminFiltered(); renderAdminMessages(state.adminSnapshot?.messages || []); });
    $$('.mode-tab').forEach(tab => tab.addEventListener('click', () => switchMode(tab.dataset.view)));
    $('settingsBtn').addEventListener('click', openSettings);
    $('saveSettingsBtn').addEventListener('click', savePreferences);
    $('testNotificationBtn').addEventListener('click', testNotifications);
    $('quickControlsBtn').addEventListener('click', () => showQuickControlsNotification().catch(error => toast(error.message || 'Could not show quick controls.', 'error')));
    $('showQuickControlsBtn').addEventListener('click', () => showQuickControlsNotification().catch(error => toast(error.message || 'Could not show quick controls.', 'error')));
    $('retryQueuedBtn').addEventListener('click', () => {
      runExclusive('Retrying Queued Actions', () => flushOutbox({ reason: 'manual-retry' }), {
        detail: 'Retrying actions that were saved while the connection was unavailable.'
      }).catch(error => toast(error.message || 'Could not retry queued actions.', 'error'));
    });
    $('periodicSyncSetting').addEventListener('change', () => {
      $('periodicSyncMinutesSetting').disabled = !$('periodicSyncSetting').checked || !state.backgroundStatus?.capabilities?.periodicSync;
    });
    $('signOutBtn').addEventListener('click', () => signOut());
    $('pipBtn').addEventListener('click', openPip);
    $('mediaControlsBtn').addEventListener('click', openMediaControls);
    $('openMediaControlsFromSettingsBtn').addEventListener('click', () => {
      $('settingsDialog').close();
      openMediaControls();
    });
    $('startMediaStreamBtn').addEventListener('click', () => {
      startSilentMediaStream({ source: 'media-controls-dialog', resumeMonitoring: true })
        .then(() => toast('Silent media stream started. System media controls should now be available where your browser exposes them.'))
        .catch(error => toast(error.message || 'Could not start media controls.', 'error'));
    });
    $('stopMediaStreamBtn').addEventListener('click', () => stopSilentMediaStream({ clearSession: true, remember: false, notify: true }));
    $('mediaLowerAlertBtn').addEventListener('click', () => shiftMediaAlertLevel(-1, 'media-controls-dialog').catch(error => toast(error.message || 'Could not lower alert level.', 'error')));
    $('mediaRaiseAlertBtn').addEventListener('click', () => shiftMediaAlertLevel(1, 'media-controls-dialog').catch(error => toast(error.message || 'Could not raise alert level.', 'error')));
    $('mediaPauseResumeBtn').addEventListener('click', () => setLiveMonitoringPaused(!state.liveMonitoringPaused));
    $('mediaPipBtn').addEventListener('click', () => openPip().catch(error => toast(error.message || 'Could not open PiP.', 'error')));
    $('installBtn').addEventListener('click', installPwa);
    $('loadMoreMessagesBtn').addEventListener('click', async () => {
      try {
        await runExclusive('Loading More Messages', async () => {
          renderAdminMessages((await api('adminMessages', { limit: 300 })).messages || []);
        }, { detail: 'Loading additional office message history.' });
      } catch (e) { toast(e.message, 'error'); }
    });
    $('loadMoreActivityBtn').addEventListener('click', async () => {
      try {
        await runExclusive('Loading More Activity', async () => {
          renderActivity((await api('adminActivity', { limit: 150 })).activity || []);
        }, { detail: 'Loading additional audit activity.' });
      } catch (e) { toast(e.message, 'error'); }
    });
    window.addEventListener('beforeinstallprompt', event => {
      event.preventDefault();
      state.installPrompt = event;
      if (!window.matchMedia('(display-mode: standalone)').matches) $('installBtn').classList.remove('hidden');
      Debug.info('pwa', 'Browser install prompt is available');
    });
    window.addEventListener('appinstalled', () => {
      state.installPrompt = null;
      $('installBtn').classList.add('hidden');
      toast('Office Safety installed.');
      Debug.info('pwa', 'PWA installed');
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        clearAppBadge();
        scheduleBackgroundFlush('visibility');
        pollNow();
      }
    });
    window.addEventListener('online', () => {
      setConnection(true, 'Back online');
      scheduleBackgroundFlush('online');
      pollNow();
    });
    window.addEventListener('offline', () => setConnection(false, 'Offline'));
    navigator.serviceWorker?.addEventListener('message', event => {
      const message = event.data || {};
      if (message.type === 'notification-clicked') {
        window.focus();
        clearAppBadge();
        if (message.action) handleExternalAction(message.action, message.data || {}).catch(error => Debug.warn('external-action', 'Notification action failed', { error }));
        else pollNow();
        return;
      }
      if (message.type === 'background-task') {
        const port = event.ports?.[0];
        const task = message.task;
        (async () => {
          try {
            if (task === 'flush-outbox') {
              const result = await flushOutbox({ reason: 'background-sync' });
              port?.postMessage({ ok:true, task, result });
              return;
            }
            if (task === 'periodic-refresh') {
              const outbox = await flushOutbox({ reason: 'periodic-sync' });
              if (state.token && !state.liveMonitoringPaused && !state.uiLock && !state.pollInFlight) await performPoll();
              port?.postMessage({ ok:true, task, outbox, refreshed: Boolean(state.token && !state.liveMonitoringPaused) });
              return;
            }
            port?.postMessage({ ok:false, task, error:'Unknown background task' });
          } catch (error) {
            Debug.warn('background-sync', 'Background task from Service Worker failed', { task, error });
            port?.postMessage({ ok:false, task, error:String(error?.message || error) });
          }
        })();
      }
    });
  }

  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') {
      Debug.warn('service-worker', 'Service Worker not registered in this context', { supported: 'serviceWorker' in navigator, protocol: location.protocol });
      updateNotificationSettingsUi();
      updateBackgroundSettingsUi();
      return;
    }
    try {
      const registration = await navigator.serviceWorker.register('service-worker.js', { updateViaCache: 'none' });
      state.swRegistration = registration;
      Debug.info('service-worker', 'Service Worker registered', {
        scope: registration.scope,
        active: registration.active?.scriptURL || '',
        waiting: registration.waiting?.scriptURL || '',
        installing: registration.installing?.scriptURL || '',
        controller: navigator.serviceWorker.controller?.scriptURL || ''
      });
      registration.addEventListener('updatefound', () => {
        Debug.info('service-worker', 'Service Worker update found', { installing: registration.installing?.scriptURL || '' });
        const installing = registration.installing;
        installing?.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            toast('A new Office Safety version is ready. Reload to update.');
          }
        });
      });
      updateNotificationSettingsUi();
      await updateQueuedCount();
      await configureBackgroundFeatures();
    } catch (error) {
      Debug.error('service-worker', 'Service Worker registration failed', { error });
      console.warn('Service worker registration failed', error);
      updateNotificationSettingsUi();
    }
  }

  Debug.info('startup', `Office Safety Traffic Light v${VERSION} boot`, {
    origin: location.origin,
    href: location.href,
    online: navigator.onLine,
    apiUrl: cfg.apiUrl || '',
    googleClientId: cfg.googleClientId || '',
    debug: cfg.debug !== false,
    userAgent: navigator.userAgent
  });
  captureExternalActionFromUrl();
  bindEvents();
  updateQueuedCount();
  registerServiceWorker();
  initBackendBridge();
  initGoogle();
  console.info(`Office Safety Traffic Light v${VERSION}`);
})();
