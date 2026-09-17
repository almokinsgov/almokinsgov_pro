(() => {
  'use strict';

  const VERSION = '0.1.3';
  const cfg = window.OFFICE_SAFETY_CONFIG || {};
  const state = {
    token: '', user: null, isAdmin: false, offices: [], presence: null,
    selectedStatus: 'green', snapshot: null, adminSnapshot: null,
    worker: null, heartbeat: null, mode: 'office', lastMessageIds: new Set(), messageBaselineReady: false,
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

  async function api(action, data = {}) {
    if (!cfg.apiUrl || cfg.apiUrl.includes('PASTE_')) throw new Error('Set apiUrl in config.js first.');
    if (!window.OfficeSafetyApi) throw new Error('Backend bridge library did not load.');
    const result = await window.OfficeSafetyApi.request({
      apiUrl: cfg.apiUrl,
      action,
      token: state.token,
      data,
      timeoutMs: Number(cfg.apiTimeoutMs || 20000)
    });
    if (!result?.ok) throw new Error(result?.error || 'Request failed.');
    return result.data;
  }

  async function initBackendBridge() {
    $('diagOrigin').textContent = location.origin;
    $('diagGoogle').textContent = `Requires ${location.origin} in Google Cloud Authorized JavaScript origins.`;
    if (cfg.apiUrl && !cfg.apiUrl.includes('PASTE_')) {
      $('backendTestLink').href = cfg.apiUrl;
    } else {
      $('backendTestLink').removeAttribute('href');
    }
    if (!cfg.apiUrl || cfg.apiUrl.includes('PASTE_') || !window.OfficeSafetyApi) {
      $('diagBridge').textContent = 'Backend URL or bridge library is not configured.';
      return;
    }
    const originHelp = `Front-end origin: ${location.origin}. Google Cloud Authorized JavaScript origins and Apps Script ALLOWED_FRONTEND_ORIGINS must both contain this exact origin.`;
    $('loginHelp').textContent = originHelp;
    $('diagBridge').textContent = 'Connecting...';
    try {
      const info = await window.OfficeSafetyApi.start(cfg.apiUrl, Number(cfg.apiTimeoutMs || 15000));
      $('diagBridge').textContent = `Connected${info.version ? ` to backend v${info.version}` : ''}.`;
      $('loginHelp').textContent = `${originHelp} Backend bridge connected.`;
    } catch (error) {
      $('diagBridge').textContent = error.message;
      $('loginHelp').textContent = `Backend: ${error.message}`;
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

  async function handleCredential(response) {
    state.token = response.credential;
    try {
      const data = await api('bootstrap');
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
    } catch (error) {
      state.token = '';
      toast(error.message, 'error');
      setConnection(false, 'Sign in failed');
    }
  }

  function initGoogle() {
    if (!cfg.googleClientId || cfg.googleClientId.includes('PASTE_')) {
      $('loginHelp').textContent = 'Set googleClientId and apiUrl in config.js before signing in.';
      return;
    }
    if (!window.google?.accounts?.id) return setTimeout(initGoogle, 200);
    $('diagGoogle').textContent = `Client configured. ${location.origin} must be listed under this client's Authorized JavaScript origins.`;
    google.accounts.id.initialize({
      client_id: cfg.googleClientId,
      callback: handleCredential,
      auto_select: false,
      cancel_on_tap_outside: true
    });
    google.accounts.id.renderButton($('googleSignIn'), { theme: 'outline', size: 'large', text: 'signin_with', shape: 'pill', width: 310 });
  }

  async function checkIn() {
    const officeId = $('officeSelect').value;
    if (!officeId) return toast('Choose an office first.', 'warn');
    const button = $('checkInBtn');
    button.disabled = true;
    try {
      const data = await api('checkIn', { officeId, status: state.selectedStatus, note: $('checkInNote').value.trim() });
      state.presence = data.presence;
      enterOffice(state.presence);
      toast(`Checked into ${officeById(officeId)?.name || 'office'}.`);
    } catch (error) { toast(error.message, 'error'); }
    finally { button.disabled = false; }
  }

  function enterOffice(presence) {
    state.presence = presence;
    state.lastMessageIds.clear();
    state.messageBaselineReady = false;
    state.mode = 'office';
    setView('officeView');
    switchMode('office');
    $('officeName').textContent = officeById(presence.officeId)?.name || presence.officeId;
    $('statusNote').value = presence.note || '';
    applyStatusSelection(presence.status || 'green');
    $('myLastUpdate').textContent = presence.updatedAt ? `Updated ${ago(presence.updatedAt)}` : '';
    startWorker();
    startHeartbeat();
    pollNow();
  }

  async function updateStatus() {
    const note = $('statusNote').value.trim();
    try {
      const data = await api('setStatus', { status: state.selectedStatus, note });
      state.presence = data.presence;
      $('myLastUpdate').textContent = `Updated ${ago(data.presence.updatedAt)}`;
      toast(`Status set to ${state.selectedStatus}.`);
      pollNow();
    } catch (error) { toast(error.message, 'error'); }
  }

  async function checkOut({ changeOffice = false } = {}) {
    try {
      await api('checkOut');
      state.presence = null;
      state.lastMessageIds.clear();
      state.messageBaselineReady = false;
      stopRealtime();
      $('checkInNote').value = '';
      applyStatusSelection('green', 'setup');
      populateOffices();
      setView('setupView');
      if (!changeOffice) toast('Checked out.');
    } catch (error) { toast(error.message, 'error'); }
  }

  async function sendMessage(admin = false) {
    const input = admin ? $('adminMessageInput') : $('messageInput');
    const text = input.value.trim();
    if (!text) return;
    const officeId = admin ? $('adminMessageOffice').value : state.presence?.officeId;
    const severity = admin ? $('adminMessageSeverity').value : undefined;
    try {
      await api('sendMessage', { officeId, text, severity });
      input.value = '';
      toast('Message sent.');
      pollNow();
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
    const status = snapshot.officeStatus || deriveOfficeStatus(people);
    $('officeSummary').textContent = `${people.length} ${people.length === 1 ? 'person' : 'people'} checked in • refreshed ${new Date().toLocaleTimeString('en-NZ', { hour:'2-digit', minute:'2-digit' })}`;
    $('officeSignal').className = `office-signal ${status}`;
    $('officeSignal').innerHTML = `<span></span><strong>${status.toUpperCase()}</strong>`;
    $('peopleCount').textContent = people.length;
    $('peopleList').classList.toggle('empty-state', !people.length);
    $('peopleList').innerHTML = people.length ? people.map(person => `
      <div class="person-row ${person.status}">
        <span class="person-status"></span>
        <div class="person-main"><strong>${escapeHtml(person.name || person.email)}</strong><small>${escapeHtml(person.email)} • ${ago(person.updatedAt)}</small>${person.note ? `<div class="person-note">${escapeHtml(person.note)}</div>` : ''}</div>
        <span class="status-tag">${escapeHtml(person.status)}</span>
      </div>`).join('') : 'No one is currently checked in.';

    const messages = snapshot.messages || [];
    notifyNewMessages(messages);
    $('messageFeed').classList.toggle('empty-state', !messages.length);
    $('messageFeed').innerHTML = messages.length ? messages.map(message => `
      <div class="message-row ${message.severity && message.severity !== 'green' ? `important ${message.severity}` : ''}">
        <div class="message-meta">${escapeHtml(message.authorName || message.authorEmail)} • ${formatTime(message.createdAt)}${message.officeId === '*' ? ' • All offices' : ''}</div>
        <p>${escapeHtml(message.text)}</p>
      </div>`).join('') : 'No recent messages.';
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
      if (important && state.settings.notifications && 'Notification' in window && Notification.permission === 'granted') {
        new Notification(`${message.severity.toUpperCase()} office message`, { body: `${message.authorName || message.authorEmail}: ${message.text}` });
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

  function renderAdmin(snapshot) {
    state.adminSnapshot = snapshot;
    const people = snapshot.people || [];
    $('adminPeopleTotal').textContent = people.length;
    $('adminGreenTotal').textContent = people.filter(p => p.status === 'green').length;
    $('adminAmberTotal').textContent = people.filter(p => p.status === 'amber').length;
    $('adminRedTotal').textContent = people.filter(p => p.status === 'red').length;
    renderAdminFiltered();
    renderAdminMessages(snapshot.messages || []);
    renderActivity(snapshot.activity || []);
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
    stopRealtime();
    applyStatusSelection('green', 'setup');
    populateOffices();
    setView('setupView');
    toast('Your office check-in expired. Please check in again.', 'warn');
  }

  async function performPoll() {
    if (!state.token) {
      state.worker?.postMessage({ type:'pollComplete', retryDelay: state.settings.pollMs });
      return;
    }
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
        signOut();
        return;
      }
      setConnection(false, 'Reconnecting...');
      console.warn('Office Safety poll failed', error);
      state.worker?.postMessage({ type:'pollComplete', retryDelay: Math.min(Math.max(state.settings.pollMs * 2, 10000), 60000) });
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
    if (state.worker) state.worker.postMessage({ type:'pollNow' });
    else performPoll();
  }

  function startHeartbeat() {
    clearInterval(state.heartbeat);
    const interval = Math.max(30000, Number(cfg.presenceHeartbeatMs || 60000));
    state.heartbeat = setInterval(async () => {
      if (!state.presence) return;
      try {
        const data = await api('heartbeat');
        if (data?.presence) state.presence = data.presence;
        else handlePresenceExpired();
      } catch {}
    }, interval);
  }

  function stopRealtime() {
    clearInterval(state.heartbeat); state.heartbeat = null;
    state.worker?.postMessage({ type:'stop' });
  }

  function switchMode(mode) {
    if (mode === 'admin' && !state.isAdmin) return;
    state.mode = mode;
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
    $('settingsDialog').showModal();
  }

  async function savePreferences(event) {
    event.preventDefault();
    state.settings.notifications = $('notificationsSetting').checked;
    state.settings.sound = $('soundSetting').checked;
    state.settings.pollMs = Number($('pollSetting').value);
    state.settings.defaultOffice = $('defaultOfficeSetting').value;
    if (state.settings.notifications && 'Notification' in window && Notification.permission === 'default') {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') state.settings.notifications = false;
    }
    saveSettings(); startWorker(); $('settingsDialog').close(); toast('Settings saved.');
  }

  async function signOut() {
    if (state.presence && state.token) {
      try { await api('checkOut'); } catch {}
    }
    stopRealtime();
    state.token = ''; state.user = null; state.presence = null; state.snapshot = null; state.adminSnapshot = null;
    state.lastMessageIds.clear(); state.messageBaselineReady = false;
    google.accounts.id.disableAutoSelect();
    $('signOutBtn').classList.add('hidden'); $('settingsBtn').classList.add('hidden');
    setConnection(false, 'Signed out'); setView('loginView');
  }

  function bindEvents() {
    $$('.status-choice').forEach(btn => btn.addEventListener('click', () => applyStatusSelection(btn.dataset.status, 'setup')));
    $$('.traffic-btn').forEach(btn => btn.addEventListener('click', () => applyStatusSelection(btn.dataset.status)));
    $('checkInBtn').addEventListener('click', checkIn);
    $('updateStatusBtn').addEventListener('click', updateStatus);
    $('checkOutBtn').addEventListener('click', () => checkOut());
    $('changeOfficeBtn').addEventListener('click', () => checkOut({ changeOffice:true }));
    $('sendMessageBtn').addEventListener('click', () => sendMessage(false));
    $('messageInput').addEventListener('keydown', e => { if (e.key === 'Enter') sendMessage(false); });
    $$('.message-presets button').forEach(btn => btn.addEventListener('click', () => { $('messageInput').value = btn.dataset.message; $('messageInput').focus(); }));
    $('refreshBtn').addEventListener('click', pollNow);
    $('adminRefreshBtn').addEventListener('click', pollNow);
    $('adminSendMessageBtn').addEventListener('click', () => sendMessage(true));
    $('adminMessageInput').addEventListener('keydown', e => { if (e.key === 'Enter') sendMessage(true); });
    ['adminOfficeFilter','adminStatusFilter'].forEach(id => $(id).addEventListener('change', () => { renderAdminFiltered(); renderAdminMessages(state.adminSnapshot?.messages || []); }));
    $('adminSearch').addEventListener('input', () => { renderAdminFiltered(); renderAdminMessages(state.adminSnapshot?.messages || []); });
    $$('.mode-tab').forEach(tab => tab.addEventListener('click', () => switchMode(tab.dataset.view)));
    $('settingsBtn').addEventListener('click', openSettings);
    $('saveSettingsBtn').addEventListener('click', savePreferences);
    $('signOutBtn').addEventListener('click', signOut);
    $('loadMoreMessagesBtn').addEventListener('click', async () => {
      try { renderAdminMessages((await api('adminMessages', { limit: 300 })).messages || []); } catch (e) { toast(e.message, 'error'); }
    });
    $('loadMoreActivityBtn').addEventListener('click', async () => {
      try { renderActivity((await api('adminActivity', { limit: 150 })).activity || []); } catch (e) { toast(e.message, 'error'); }
    });
    window.addEventListener('online', () => { setConnection(true, 'Back online'); pollNow(); });
    window.addEventListener('offline', () => setConnection(false, 'Offline'));
  }

  async function registerServiceWorker() {
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      try { await navigator.serviceWorker.register('service-worker.js'); } catch (error) { console.warn('Service worker registration failed', error); }
    }
  }

  bindEvents(); registerServiceWorker(); initBackendBridge(); initGoogle();
  console.info(`Office Safety Traffic Light v${VERSION}`);
})();
