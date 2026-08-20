(() => {
  'use strict';

  const SYNC_STATE_KEY = 'teleprompter.driveSync.v2';
  const RECOVERY_KEY = 'teleprompter.driveRecovery.v1';
  const DEVICE_ID_KEY = 'teleprompter.deviceId.v1';
  const STARTER_TITLE = 'Welcome to Teleprompter';
  const STARTER_BODY = 'Write or paste your script here.\n\nOpen the player when you are ready. Use Space to play or pause and the arrow keys to adjust speed.';

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function randomId(prefix = 'id') {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function getDeviceId() {
    try {
      const existing = localStorage.getItem(DEVICE_ID_KEY);
      if (existing) return existing;
      const id = randomId('device');
      localStorage.setItem(DEVICE_ID_KEY, id);
      return id;
    } catch (_) {
      return randomId('device');
    }
  }

  function loadSyncState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(SYNC_STATE_KEY) || 'null');
      if (parsed && typeof parsed === 'object') {
        return {
          version: 2,
          deviceId: parsed.deviceId || getDeviceId(),
          accounts: parsed.accounts && typeof parsed.accounts === 'object' ? parsed.accounts : {}
        };
      }
    } catch (_) {}
    return { version: 2, deviceId: getDeviceId(), accounts: {} };
  }

  function saveSyncState(syncState) {
    try { localStorage.setItem(SYNC_STATE_KEY, JSON.stringify(syncState)); } catch (_) {}
  }

  function accountKey(profile) {
    return String(profile?.sub || profile?.googleSub || profile?.email || '').trim();
  }

  function getAccountRecord(profile) {
    const key = accountKey(profile);
    if (!key) return null;
    const syncState = loadSyncState();
    return clone(syncState.accounts[key] || null);
  }

  function setAccountRecord(profile, record) {
    const key = accountKey(profile);
    if (!key) return;
    const syncState = loadSyncState();
    syncState.accounts[key] = clone(record);
    saveSyncState(syncState);
  }

  function clearAccountRecord(profile) {
    const key = accountKey(profile);
    if (!key) return;
    const syncState = loadSyncState();
    delete syncState.accounts[key];
    saveSyncState(syncState);
  }

  function getAccountSummary(profile) {
    const record = getAccountRecord(profile);
    if (!record) return null;
    return {
      workspaceId: record.workspaceId || '',
      fileId: record.fileId || '',
      remoteRevision: Number(record.remoteRevision) || 0,
      lastSyncedAt: record.lastSyncedAt || null
    };
  }

  function comparableWorkspace(workspace) {
    const source = workspace && typeof workspace === 'object' ? workspace : {};
    return {
      profile: clone(source.profile || {}),
      preferences: clone(source.preferences || {}),
      scripts: Array.isArray(source.scripts) ? source.scripts.map(comparableScript) : [],
      activeScriptId: source.activeScriptId || null
    };
  }

  function comparableScript(script) {
    const source = script && typeof script === 'object' ? script : {};
    return {
      id: source.id || '',
      title: source.title || '',
      body: source.body || '',
      playerSettings: clone(source.playerSettings || {})
    };
  }

  function stableStringify(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }

  function fingerprintWorkspace(workspace) {
    const text = stableStringify(comparableWorkspace(workspace));
    let h1 = 0xdeadbeef ^ text.length;
    let h2 = 0x41c6ce57 ^ text.length;
    for (let i = 0; i < text.length; i += 1) {
      const ch = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return `${(h2 >>> 0).toString(16).padStart(8, '0')}${(h1 >>> 0).toString(16).padStart(8, '0')}:${text.length}`;
  }

  function sameWorkspaceContent(a, b) {
    if (!a || !b) return false;
    return fingerprintWorkspace(a) === fingerprintWorkspace(b);
  }

  function sameScript(a, b) {
    return stableStringify(comparableScript(a)) === stableStringify(comparableScript(b));
  }

  function isStarterScript(script) {
    if (!script) return false;
    return String(script.title || '') === STARTER_TITLE && String(script.body || '') === STARTER_BODY;
  }

  function playerSettingsFromPreferences(preferences = {}) {
    return {
      speed: Number(preferences.defaultSpeed) || 35,
      fontSize: Number(preferences.defaultFontSize) || 54,
      lineHeight: Number(preferences.defaultLineHeight) || 1.45,
      paragraphSpacing: Number.isFinite(Number(preferences.defaultParagraphSpacing)) ? Number(preferences.defaultParagraphSpacing) : 0.45,
      textWidth: Number(preferences.defaultTextWidth) || 82,
      alignment: preferences.alignment || 'left',
      mirrorHorizontal: Boolean(preferences.mirrorHorizontal),
      mirrorVertical: Boolean(preferences.mirrorVertical),
      focusGuide: preferences.focusGuide !== false,
      cameraEnabled: Boolean(preferences.cameraEnabled),
      cameraFacing: preferences.cameraFacing || 'user',
      cameraOpacity: Number(preferences.cameraOpacity) || 65,
      cameraDim: Number.isFinite(Number(preferences.cameraDim)) ? Number(preferences.cameraDim) : 25,
      cameraMirror: preferences.cameraMirror !== false,
      faceControlsEnabled: Boolean(preferences.faceControlsEnabled),
      ttsEnabled: Boolean(preferences.ttsEnabled),
      ttsPaceWpm: Number(preferences.ttsPaceWpm) || 130,
      voiceControlsEnabled: Boolean(preferences.voiceControlsEnabled)
    };
  }

  function isPristineStarterWorkspace(workspace, defaultPreferences) {
    const source = workspace && typeof workspace === 'object' ? workspace : {};
    if (!Array.isArray(source.scripts) || source.scripts.length !== 1) return false;
    const script = source.scripts[0];
    if (!isStarterScript(script)) return false;

    const profile = source.profile || {};
    if (String(profile.displayName || '').trim() || String(profile.email || '').trim()) return false;
    if (profile.provider && profile.provider !== 'local') return false;

    if (defaultPreferences) {
      const actual = stableStringify(source.preferences || {});
      const expected = stableStringify(defaultPreferences || {});
      if (actual !== expected) return false;
      const expectedPlayerSettings = stableStringify(playerSettingsFromPreferences(defaultPreferences));
      const actualPlayerSettings = stableStringify(script.playerSettings || {});
      if (actualPlayerSettings !== expectedPlayerSettings) return false;
    }
    return true;
  }

  function isMeaningfulWorkspace(workspace, defaultPreferences) {
    return !isPristineStarterWorkspace(workspace, defaultPreferences);
  }

  function makeBaselineRecord(profile, workspace, file) {
    return {
      accountSub: profile?.sub || '',
      accountEmail: profile?.email || '',
      workspaceId: workspace?.workspaceId || '',
      fileId: file?.id || '',
      remoteRevision: Number(workspace?.cloud?.revision) || 0,
      baseFingerprint: fingerprintWorkspace(workspace),
      baseWorkspace: clone(workspace),
      lastSyncedAt: new Date().toISOString()
    };
  }

  function establishBaseline(profile, workspace, file) {
    const record = makeBaselineRecord(profile, workspace, file);
    setAccountRecord(profile, record);
    return record;
  }

  function saveRecoverySnapshot(workspace, details = {}) {
    if (!workspace) return null;
    const entry = {
      id: randomId('recovery'),
      savedAt: new Date().toISOString(),
      reason: details.reason || 'sync-safety',
      source: details.source || 'local',
      accountSub: details.profile?.sub || '',
      accountEmail: details.profile?.email || '',
      workspace: clone(workspace)
    };
    try {
      const existing = JSON.parse(localStorage.getItem(RECOVERY_KEY) || '[]');
      const list = Array.isArray(existing) ? existing : [];
      list.unshift(entry);
      localStorage.setItem(RECOVERY_KEY, JSON.stringify(list.slice(0, 5)));
    } catch (_) {}
    return entry;
  }

  function getLatestRecovery(profile = null) {
    try {
      const list = JSON.parse(localStorage.getItem(RECOVERY_KEY) || '[]');
      if (!Array.isArray(list)) return null;
      const key = accountKey(profile);
      const match = key ? list.find((entry) => entry.accountSub === key || entry.accountEmail === key) : list[0];
      return clone(match || null);
    } catch (_) {
      return null;
    }
  }

  function mergePrimitiveOrObject(base, local, remote, conflictCounter) {
    const sameLocalRemote = stableStringify(local) === stableStringify(remote);
    if (sameLocalRemote) return clone(local);
    const localMatchesBase = stableStringify(local) === stableStringify(base);
    if (localMatchesBase) return clone(remote);
    const remoteMatchesBase = stableStringify(remote) === stableStringify(base);
    if (remoteMatchesBase) return clone(local);

    const allPlainObjects = [base, local, remote].every((value) => value && typeof value === 'object' && !Array.isArray(value));
    if (allPlainObjects) {
      const result = {};
      const keys = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)]);
      keys.forEach((key) => {
        result[key] = mergePrimitiveOrObject(base[key], local[key], remote[key], conflictCounter);
      });
      return result;
    }

    conflictCounter.count += 1;
    return clone(remote);
  }

  function makeConflictCopy(script, label) {
    const copy = clone(script);
    copy.id = randomId('script');
    copy.title = `${copy.title || 'Untitled script'} (${label})`;
    const now = new Date().toISOString();
    copy.createdAt = copy.createdAt || now;
    copy.updatedAt = now;
    copy.playerSettingsUpdatedAt = copy.playerSettingsUpdatedAt || now;
    return copy;
  }

  function threeWayMerge(baseWorkspace, localWorkspace, remoteWorkspace) {
    const base = clone(baseWorkspace || {});
    const local = clone(localWorkspace || {});
    const remote = clone(remoteWorkspace || {});
    const conflictCounter = { count: 0 };
    const result = clone(remote);

    result.profile = mergePrimitiveOrObject(base.profile || {}, local.profile || {}, remote.profile || {}, conflictCounter);
    result.preferences = mergePrimitiveOrObject(base.preferences || {}, local.preferences || {}, remote.preferences || {}, conflictCounter);

    const baseMap = new Map((base.scripts || []).map((script) => [script.id, script]));
    const localMap = new Map((local.scripts || []).map((script) => [script.id, script]));
    const remoteMap = new Map((remote.scripts || []).map((script) => [script.id, script]));
    const ids = new Set([...baseMap.keys(), ...localMap.keys(), ...remoteMap.keys()]);
    const scripts = [];

    ids.forEach((id) => {
      const b = baseMap.get(id);
      const l = localMap.get(id);
      const r = remoteMap.get(id);

      if (!b) {
        if (l && r) {
          if (sameScript(l, r)) scripts.push(clone(r));
          else {
            scripts.push(clone(r));
            scripts.push(makeConflictCopy(l, 'this device conflict'));
            conflictCounter.count += 1;
          }
        } else if (l) scripts.push(clone(l));
        else if (r) scripts.push(clone(r));
        return;
      }

      if (!l && !r) return;
      if (!l) {
        if (sameScript(r, b)) return;
        scripts.push(clone(r));
        conflictCounter.count += 1;
        return;
      }
      if (!r) {
        if (sameScript(l, b)) return;
        scripts.push(clone(l));
        conflictCounter.count += 1;
        return;
      }

      const localChanged = !sameScript(l, b);
      const remoteChanged = !sameScript(r, b);
      if (!localChanged && !remoteChanged) scripts.push(clone(r));
      else if (localChanged && !remoteChanged) scripts.push(clone(l));
      else if (!localChanged && remoteChanged) scripts.push(clone(r));
      else if (sameScript(l, r)) scripts.push(clone(r));
      else {
        scripts.push(clone(r));
        scripts.push(makeConflictCopy(l, 'this device conflict'));
        conflictCounter.count += 1;
      }
    });

    result.scripts = scripts;
    const localActiveChanged = (local.activeScriptId || null) !== (base.activeScriptId || null);
    const remoteActiveChanged = (remote.activeScriptId || null) !== (base.activeScriptId || null);
    if (localActiveChanged && !remoteActiveChanged) result.activeScriptId = local.activeScriptId;
    else result.activeScriptId = remote.activeScriptId || local.activeScriptId || scripts[0]?.id || null;
    if (!scripts.some((script) => script.id === result.activeScriptId)) result.activeScriptId = scripts[0]?.id || null;

    return { workspace: result, conflicts: conflictCounter.count };
  }

  function mergeUnrelatedWorkspaces(remoteWorkspace, localWorkspace) {
    const remote = clone(remoteWorkspace || {});
    const local = clone(localWorkspace || {});
    const result = clone(remote);
    const scripts = Array.isArray(remote.scripts) ? remote.scripts.map(clone) : [];
    const byId = new Map(scripts.map((script) => [script.id, script]));
    let added = 0;
    let conflicts = 0;

    const remoteHasMeaningful = scripts.some((script) => !isStarterScript(script));
    (local.scripts || []).forEach((script) => {
      if (remoteHasMeaningful && isStarterScript(script)) return;
      const existing = byId.get(script.id);
      if (!existing) {
        const copy = clone(script);
        scripts.push(copy);
        byId.set(copy.id, copy);
        added += 1;
        return;
      }
      if (sameScript(existing, script)) return;
      const copy = makeConflictCopy(script, 'imported from this device');
      scripts.push(copy);
      byId.set(copy.id, copy);
      added += 1;
      conflicts += 1;
    });

    result.scripts = scripts;
    if (!scripts.some((script) => script.id === result.activeScriptId)) result.activeScriptId = scripts[0]?.id || null;
    return { workspace: result, added, conflicts };
  }

  window.TeleprompterSyncSafety = {
    STARTER_TITLE,
    STARTER_BODY,
    getDeviceId,
    getAccountRecord,
    getAccountSummary,
    setAccountRecord,
    clearAccountRecord,
    establishBaseline,
    fingerprintWorkspace,
    sameWorkspaceContent,
    isPristineStarterWorkspace,
    isMeaningfulWorkspace,
    saveRecoverySnapshot,
    getLatestRecovery,
    threeWayMerge,
    mergeUnrelatedWorkspaces,
    clone
  };
})();
