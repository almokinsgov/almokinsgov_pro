(() => {
  'use strict';

  const VERSION = '0.1.9';
  const cfg = window.OFFICE_SAFETY_CONFIG || {};
  const Debug = window.OfficeSafetyDebug || { debug() {}, info() {}, warn() {}, error() {} };
  let googleInitAttempts = 0;
  const SESSION_TOKEN_KEY = 'officeSafetySessionToken';
  const state = {
    token: '', user: null, isAdmin: false, offices: [], presence: null,
    selectedStatus: 'green', snapshot: null, adminSnapshot: null,
    worker: null, heartbeat: null, mode: 'office', lastMessageIds: new Set(), messageBaselineReady: false, lastPersonStates: new Map(),
    uiLock: null, pollInFlight: false, heartbeatInFlight: false, swRegistration: null, installPrompt: null,
    pipWindow: null, importantBadgeCount: 0, bridgeReady: false, sessionRestoreAttempted: false,
    settings: loadSettings()
  };

  const $ = id => document.getElementById(id);
  const $$ = selector => [...document.querySelectorAll(selector)];

  function loadSettings() {
    try {
      return { notifications: false, sound: false, pollMs: Number(cfg.defaultPollMs || 10000), defaultOffice: '', ...JSON.parse(localStorage.getItem('officeSafetySettings') || '{}') };
    } catch { return { notifications: false, sound: false, pollMs: 10000, defaultOffice: '' }; }
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
    '#pipBtn', '#installBtn', '.status-choice', '.traffic-btn', '.message-presets button'
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
      const backendCompatible = !info.version || info.version === VERSION;
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
        const data = await api('checkIn', { officeId, status: state.selectedStatus, note: $('checkInNote').value.trim() });
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
    pollNow();
  }

  async function updateStatus(statusOverride = '') {
    const nextStatus = statusOverride || state.selectedStatus;
    const note = $('statusNote').value.trim();
    try {
      const completed = await runExclusive('Updating Status', async () => {
        state.selectedStatus = nextStatus;
        applyStatusSelection(nextStatus);
        const data = await api('setStatus', { status: nextStatus, note });
        state.presence = data.presence;
        $('myLastUpdate').textContent = `Updated ${ago(data.presence.updatedAt)}`;
        toast(`Status set to ${nextStatus}.`);
        renderPip();
        return true;
      }, { detail: `Sending your ${nextStatus} status to the office.` });
      if (completed) pollNow();
    } catch (error) { toast(error.message, 'error'); }
  }

  async function checkOut({ changeOffice = false } = {}) {
    try {
      await runExclusive(changeOffice ? 'Changing Office' : 'Checking Out', async () => {
        await api('checkOut');
        state.presence = null;
        state.lastMessageIds.clear();
        state.messageBaselineReady = false;
        state.lastPersonStates.clear();
        stopRealtime();
        closePip();
        $('checkInNote').value = '';
        applyStatusSelection('green', 'setup');
        populateOffices();
        setView('setupView');
        updatePipAvailability();
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
    try {
      const completed = await runExclusive(admin ? 'Sending Announcement' : 'Sending Message', async () => {
        await api('sendMessage', { officeId, text, severity });
        input.value = '';
        toast('Message sent.');
        return true;
      }, { detail: admin ? 'Sending the announcement and waiting for confirmation.' : 'Sending your message to this office and waiting for confirmation.' });
      if (completed) pollNow();
    } catch (error) { toast(error.message, 'error'); }
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
    renderPip();
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
      actions: [{ action: 'open', title: 'Open Office Safety' }, { action: 'dismiss', title: 'Dismiss' }]
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
    if (state.mode === 'admin' && state.adminSnapshot && state.presence?.officeId) {
      const officeId = state.presence.officeId;
      const people = (state.adminSnapshot.people || []).filter(person => person.officeId === officeId);
      const messages = (state.adminSnapshot.messages || []).filter(message => message.officeId === officeId || message.officeId === '*');
      return { people, messages, officeStatus: deriveOfficeStatus(people) };
    }
    return state.snapshot;
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
    const office = officeById(state.presence?.officeId)?.name || state.presence?.officeId || 'Not checked in';
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
      const empty = doc.createElement('div'); empty.className = 'meta'; empty.textContent = 'No messages yet.'; messagesEl.appendChild(empty);
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
    applyStatusSelection('green', 'setup');
    populateOffices();
    setView('setupView');
    updatePipAvailability();
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
    pollNow();
  }

  function openSettings() {
    $('notificationsSetting').checked = state.settings.notifications;
    $('soundSetting').checked = state.settings.sound;
    $('pollSetting').value = String(state.settings.pollMs || 10000);
    $('defaultOfficeSetting').value = state.settings.defaultOffice || '';
    updateNotificationSettingsUi();
    $('settingsDialog').showModal();
  }

  async function savePreferences(event) {
    event.preventDefault();
    try {
      await runExclusive('Saving Settings', async () => {
        state.settings.notifications = $('notificationsSetting').checked;
        state.settings.sound = $('soundSetting').checked;
        state.settings.pollMs = Number($('pollSetting').value);
        state.settings.defaultOffice = $('defaultOfficeSetting').value;
        if (state.settings.notifications) {
          const granted = await requestNotifications();
          if (!granted) state.settings.notifications = false;
        }
        saveSettings();
        startWorker();
        updateNotificationSettingsUi();
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
        try { await api('checkOut'); } catch {}
      }
      stopRealtime();
      closePip();
      clearSessionToken();
      state.token = ''; state.user = null; state.presence = null; state.snapshot = null; state.adminSnapshot = null;
      state.lastMessageIds.clear(); state.messageBaselineReady = false; state.lastPersonStates.clear();
      if (window.google?.accounts?.id) google.accounts.id.disableAutoSelect();
      $('signOutBtn').classList.add('hidden'); $('settingsBtn').classList.add('hidden'); $('pipBtn').classList.add('hidden');
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
    $('signOutBtn').addEventListener('click', () => signOut());
    $('pipBtn').addEventListener('click', openPip);
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
        pollNow();
      }
    });
    window.addEventListener('online', () => { setConnection(true, 'Back online'); pollNow(); });
    window.addEventListener('offline', () => setConnection(false, 'Offline'));
    navigator.serviceWorker?.addEventListener('message', event => {
      if (event.data?.type === 'notification-clicked') {
        window.focus();
        clearAppBadge();
        pollNow();
      }
    });
  }

  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') {
      Debug.warn('service-worker', 'Service Worker not registered in this context', { supported: 'serviceWorker' in navigator, protocol: location.protocol });
      updateNotificationSettingsUi();
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
  bindEvents(); registerServiceWorker(); initBackendBridge(); initGoogle();
  console.info(`Office Safety Traffic Light v${VERSION}`);
})();
