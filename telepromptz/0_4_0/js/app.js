(() => {
  'use strict';

  const APP_VERSION = '0.4.0';
  const STORAGE_KEY = 'teleprompter.workspace.v1';
  const WORDS_PER_MINUTE = 130;
  const storageManager = window.TeleprompterStorage.manager;
  storageManager.use(new window.TeleprompterStorage.LocalStorageProvider(STORAGE_KEY));

  const DEFAULT_STATE = {
    schemaVersion: 2,
    appVersion: APP_VERSION,
    profile: {
      displayName: '',
      provider: 'local',
      email: '',
      picture: '',
      googleSub: ''
    },
    preferences: {
      defaultSpeed: 35,
      defaultFontSize: 54,
      defaultLineHeight: 1.45,
      defaultParagraphSpacing: 0.45,
      defaultTextWidth: 82,
      countdown: 3,
      autoHideControls: true,
      focusGuide: true,
      keepAwake: false,
      alignment: 'left',
      mirrorHorizontal: false,
      mirrorVertical: false,
      cameraEnabled: false,
      cameraFacing: 'user',
      cameraOpacity: 65,
      cameraDim: 25,
      cameraMirror: true,
      faceControlsEnabled: false,
      faceThreshold: 55,
      faceHoldMs: 350,
      faceCooldownMs: 1500,
      faceInferenceFps: 5,
      faceRules: {
        smile: 'play',
        mouthOpen: 'off',
        blink: 'off',
        browRaise: 'off'
      },
      recordIncludeAudio: true,
      ttsEnabled: false,
      ttsPaceWpm: 130,
      ttsVolume: 35,
      ttsVoiceURI: '',
      ttsSyncScroll: true,
      voiceControlsEnabled: false,
      voiceRequirePrefix: true,
      voicePrefix: 'prompter',
      voiceStartOnSpeech: false,
      voicePauseAfterSilenceMs: 0,
      voiceLanguage: 'en-NZ'
    },
    scripts: [],
    activeScriptId: null,
    modifiedAt: null,
    updatedAt: null
  };

  const state = loadState();
  let saveTimer = null;
  let playerFrame = null;
  let lastFrameTime = null;
  let playerScrollPosition = 0;
  let playerScrollMax = 0;
  let isPlaying = false;
  let playerSpeed = state.preferences.defaultSpeed;
  let playerFontSize = state.preferences.defaultFontSize;
  let playerLineHeight = Number(state.preferences.defaultLineHeight) || 1.45;
  let playerParagraphSpacing = Number.isFinite(Number(state.preferences.defaultParagraphSpacing)) ? Number(state.preferences.defaultParagraphSpacing) : 0.45;
  let playerTextWidth = state.preferences.defaultTextWidth;
  let playerAlignment = state.preferences.alignment;
  let mirrorHorizontal = state.preferences.mirrorHorizontal;
  let mirrorVertical = state.preferences.mirrorVertical;
  let focusGuideEnabled = state.preferences.focusGuide;
  let controlsLocked = false;
  let chromeTimer = null;
  let wakeLock = null;
  let playerStartCountdown = null;
  let cameraStream = null;
  let cameraEnabled = false;
  let cameraFacing = state.preferences.cameraFacing || 'user';
  let cameraOpacity = Number(state.preferences.cameraOpacity) || 65;
  let cameraDim = Number(state.preferences.cameraDim) || 25;
  let cameraMirror = Boolean(state.preferences.cameraMirror);
  let faceControlsEnabled = false;
  let faceStatusResetTimer = null;
  let ttsEnabled = Boolean(state.preferences.ttsEnabled);
  let ttsPaceWpm = Number(state.preferences.ttsPaceWpm) || 130;
  let ttsVolume = Number.isFinite(Number(state.preferences.ttsVolume)) ? Number(state.preferences.ttsVolume) : 35;
  let ttsVoiceURI = state.preferences.ttsVoiceURI || '';
  let ttsUtterance = null;
  let ttsCurrentSegmentIndex = -1;
  let ttsQueuedSegmentIndexes = [];
  let ttsSpokenSegmentIndexes = new Set();
  let voiceControlsEnabled = false;
  let voiceStatusResetTimer = null;
  let mediaRecorder = null;
  let recordingStream = null;
  let recordingAudioStream = null;
  let recordingChunks = [];
  let recordingStartedAt = 0;
  let recordingTimer = null;
  let recordingStopResolve = null;
  let recordingStopTimer = null;
  let recordingFinalised = false;
  let isRecording = false;
  let driveSyncTimer = null;
  let driveSyncInFlight = false;
  let driveConflictPending = false;
  let applyingRemoteWorkspace = false;

  const el = {};

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    cacheElements();
    ensureInitialScript();
    populateFaceActionSelects();
    populateTtsVoices();
    bindEvents();
    applyStateToUI();
    renderScriptList();
    loadActiveScriptIntoEditor();
    initGoogleDriveIntegration();
    registerOptionalServiceWorker();
  }

  function cacheElements() {
    const ids = [
      'appShell', 'openScriptListButton', 'scriptsPanel', 'closeScriptListButton', 'newScriptButton', 'mobileImportExportButton', 'mobileGoogleDriveButton', 'mobileSettingsButton',
      'duplicateScriptButton', 'scriptSearchInput', 'scriptList', 'scriptTitleInput', 'scriptBodyInput',
      'resetScriptPlayerSettingsButton', 'deleteScriptButton', 'editorPlayButton', 'openPlayerButton', 'googleDriveButton', 'openSettingsButton', 'settingsDialog',
      'settingsForm', 'saveSettingsButton', 'profileNameInput', 'storageProviderName', 'storageProviderStatus', 'defaultSpeedInput', 'defaultSpeedOutput',
      'defaultFontSizeInput', 'defaultFontSizeOutput', 'defaultLineHeightInput', 'defaultLineHeightOutput', 'defaultParagraphSpacingInput', 'defaultParagraphSpacingOutput',
      'defaultTextWidthInput', 'defaultTextWidthOutput', 'countdownSelect', 'autoHideControlsInput',
      'defaultFocusGuideInput', 'defaultWakeLockInput', 'defaultCameraEnabledInput', 'defaultCameraOpacityInput',
      'defaultCameraOpacityOutput', 'defaultCameraDimInput', 'defaultCameraDimOutput', 'defaultCameraMirrorInput',
      'defaultFaceControlsInput', 'smileActionSelect', 'mouthOpenActionSelect', 'blinkActionSelect', 'browRaiseActionSelect',
      'faceThresholdInput', 'faceThresholdOutput', 'faceHoldSelect', 'faceCooldownSelect', 'faceRateSelect',
      'recordIncludeAudioInput', 'defaultTtsEnabledInput', 'ttsPaceInput', 'ttsPaceOutput', 'ttsVolumeInput', 'ttsVolumeOutput', 'ttsSyncScrollInput', 'ttsVoiceSelect',
      'defaultVoiceControlsInput', 'voiceRequirePrefixInput', 'voicePrefixInput', 'voiceStartOnSpeechInput', 'voicePauseSilenceSelect', 'voiceLanguageSelect',
      'googleDriveDialog', 'closeGoogleDriveButton', 'doneGoogleDriveButton', 'googleSignedOutPanel', 'googleSignedInPanel', 'googleOriginNote', 'googleSignInButton', 'googleSyncNowButton', 'googleSignOutButton', 'googleProfileImage', 'googleProfileName', 'googleProfileEmail', 'googleSyncStatus', 'googleClientIdDisplay',
      'openImportExportButton', 'importExportDialog', 'closeImportExportButton', 'doneImportExportButton', 'chooseImportButton', 'importFileInput',
      'exportScriptTextButton', 'exportScriptJsonButton', 'exportWorkspaceButton', 'playerScreen',
      'playerStage', 'promptViewport', 'promptContent', 'focusGuide', 'playerTopbar', 'playerControls',
      'playerScriptName', 'closePlayerButton', 'fullscreenButton', 'wakeLockButton', 'recordButton', 'recordingStatus', 'recordingTime', 'cameraTopButton', 'restartButton',
      'playPauseButton', 'jumpBackButton', 'jumpForwardButton', 'speedRange', 'speedValue', 'fontSizeRange',
      'fontSizeValue', 'lineHeightRange', 'lineHeightValue', 'paragraphSpacingRange', 'paragraphSpacingValue', 'textWidthRange', 'textWidthValue', 'cameraOpacityField', 'cameraOpacityRange', 'cameraOpacityValue',
      'cameraDimField', 'cameraDimRange', 'cameraDimValue', 'ttsPaceField', 'ttsPaceRange', 'ttsPaceValue',
      'alignButton', 'mirrorHorizontalButton', 'mirrorVerticalButton', 'focusGuideButton', 'cameraButton',
      'switchCameraButton', 'mirrorCameraButton', 'faceControlsButton', 'faceControlStatus', 'ttsButton', 'voiceControlsButton', 'voiceControlStatus', 'cameraLayer', 'cameraVideo',
      'cameraDim', 'controlsLockButton', 'chromeRevealZone', 'countdownOverlay',
      'countdownValue', 'wordCount', 'durationEstimate', 'updatedAt', 'saveState', 'toastRegion',
      'scriptItemTemplate'
    ];
    ids.forEach((id) => { el[id] = document.getElementById(id); });
  }

  function populateFaceActionSelects() {
    const actions = [
      ['off', 'Disabled'],
      ['play', 'Start scrolling'],
      ['pause', 'Pause scrolling'],
      ['toggle', 'Toggle play / pause'],
      ['restart', 'Restart script'],
      ['faster', 'Increase speed'],
      ['slower', 'Decrease speed']
    ];
    [el.smileActionSelect, el.mouthOpenActionSelect, el.blinkActionSelect, el.browRaiseActionSelect].forEach((select) => {
      select.innerHTML = '';
      actions.forEach(([value, label]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        select.appendChild(option);
      });
    });
  }

  function bindEvents() {
    el.openScriptListButton.addEventListener('click', () => el.scriptsPanel.classList.add('open'));
    el.closeScriptListButton.addEventListener('click', () => el.scriptsPanel.classList.remove('open'));
    el.newScriptButton.addEventListener('click', createNewScript);
    el.duplicateScriptButton.addEventListener('click', duplicateActiveScript);
    el.resetScriptPlayerSettingsButton.addEventListener('click', resetActiveScriptPlayerSettings);
    el.deleteScriptButton.addEventListener('click', deleteActiveScript);
    el.scriptSearchInput.addEventListener('input', renderScriptList);
    el.scriptTitleInput.addEventListener('input', handleEditorInput);
    el.scriptBodyInput.addEventListener('input', handleEditorInput);
    el.editorPlayButton.addEventListener('click', openPlayer);
    el.openPlayerButton.addEventListener('click', openPlayer);

    el.googleDriveButton.addEventListener('click', openGoogleDriveDialog);
    el.mobileGoogleDriveButton.addEventListener('click', () => { el.scriptsPanel.classList.remove('open'); openGoogleDriveDialog(); });
    el.closeGoogleDriveButton.addEventListener('click', () => el.googleDriveDialog.close());
    el.doneGoogleDriveButton.addEventListener('click', () => el.googleDriveDialog.close());
    el.googleSignInButton.addEventListener('click', signInWithGoogle);
    el.googleSyncNowButton.addEventListener('click', () => syncGoogleDriveNow({ manual: true }));
    el.googleSignOutButton.addEventListener('click', disconnectGoogleDrive);

    el.openSettingsButton.addEventListener('click', openSettings);
    el.mobileSettingsButton.addEventListener('click', () => { el.scriptsPanel.classList.remove('open'); openSettings(); });
    el.settingsForm.addEventListener('submit', handleSettingsSubmit);
    [
      [el.defaultSpeedInput, el.defaultSpeedOutput],
      [el.defaultFontSizeInput, el.defaultFontSizeOutput],
      [el.defaultLineHeightInput, el.defaultLineHeightOutput],
      [el.defaultParagraphSpacingInput, el.defaultParagraphSpacingOutput],
      [el.defaultTextWidthInput, el.defaultTextWidthOutput],
      [el.defaultCameraOpacityInput, el.defaultCameraOpacityOutput],
      [el.defaultCameraDimInput, el.defaultCameraDimOutput],
      [el.faceThresholdInput, el.faceThresholdOutput],
      [el.ttsPaceInput, el.ttsPaceOutput],
      [el.ttsVolumeInput, el.ttsVolumeOutput]
    ].forEach(([input, output]) => input.addEventListener('input', () => { output.value = input.value; }));

    el.openImportExportButton.addEventListener('click', () => el.importExportDialog.showModal());
    el.mobileImportExportButton.addEventListener('click', () => { el.scriptsPanel.classList.remove('open'); el.importExportDialog.showModal(); });
    el.closeImportExportButton.addEventListener('click', () => el.importExportDialog.close());
    el.doneImportExportButton.addEventListener('click', () => el.importExportDialog.close());
    el.chooseImportButton.addEventListener('click', () => el.importFileInput.click());
    el.importFileInput.addEventListener('change', handleImportFiles);
    el.exportScriptTextButton.addEventListener('click', exportActiveScriptText);
    el.exportScriptJsonButton.addEventListener('click', exportActiveScriptJson);
    el.exportWorkspaceButton.addEventListener('click', exportWorkspace);

    el.closePlayerButton.addEventListener('click', closePlayer);
    el.fullscreenButton.addEventListener('click', toggleFullscreen);
    el.wakeLockButton.addEventListener('click', toggleWakeLock);
    el.recordButton.addEventListener('click', toggleRecording);
    el.cameraTopButton.addEventListener('click', toggleCamera);
    el.cameraButton.addEventListener('click', toggleCamera);
    el.switchCameraButton.addEventListener('click', switchCamera);
    el.mirrorCameraButton.addEventListener('click', toggleCameraMirror);
    el.faceControlsButton.addEventListener('click', toggleFaceControls);
    el.ttsButton.addEventListener('click', toggleTtsGuide);
    el.voiceControlsButton.addEventListener('click', toggleVoiceControls);
    el.ttsPaceRange.addEventListener('input', updateTtsPaceFromPlayer);
    el.cameraOpacityRange.addEventListener('input', updateCameraOpacity);
    el.cameraDimRange.addEventListener('input', updateCameraDim);
    el.restartButton.addEventListener('click', restartPlayer);
    el.playPauseButton.addEventListener('click', togglePlay);
    el.jumpBackButton.addEventListener('click', () => jumpSeconds(-10));
    el.jumpForwardButton.addEventListener('click', () => jumpSeconds(10));
    el.speedRange.addEventListener('input', updatePlayerSpeed);
    el.fontSizeRange.addEventListener('input', updatePlayerFontSize);
    el.lineHeightRange.addEventListener('input', updatePlayerLineHeight);
    el.paragraphSpacingRange.addEventListener('input', updatePlayerParagraphSpacing);
    el.textWidthRange.addEventListener('input', updatePlayerTextWidth);
    el.alignButton.addEventListener('click', cycleAlignment);
    el.mirrorHorizontalButton.addEventListener('click', toggleMirrorHorizontal);
    el.mirrorVerticalButton.addEventListener('click', toggleMirrorVertical);
    el.focusGuideButton.addEventListener('click', toggleFocusGuide);
    el.controlsLockButton.addEventListener('click', toggleControlsLock);
    el.chromeRevealZone.addEventListener('click', revealOrToggleChrome);
    el.playerStage.addEventListener('pointermove', revealChromeTemporarily, { passive: true });
    el.promptViewport.addEventListener('scroll', syncPlayerScrollPosition, { passive: true });
    window.addEventListener('resize', refreshPlayerMetrics, { passive: true });
    if (window.visualViewport) window.visualViewport.addEventListener('resize', refreshPlayerMetrics, { passive: true });
    document.addEventListener('keydown', handleKeyboard);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    if ('speechSynthesis' in window) {
      window.speechSynthesis.addEventListener('voiceschanged', populateTtsVoices);
    }
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function uid() {
    if (crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return `script-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function loadState() {
    try {
      const parsed = storageManager.loadWorkspace();
      if (!parsed) return clone(DEFAULT_STATE);
      return normaliseWorkspace(parsed);
    } catch (error) {
      console.warn('Could not load workspace', error);
      return clone(DEFAULT_STATE);
    }
  }

  function normaliseWorkspace(input) {
    const base = clone(DEFAULT_STATE);
    const source = input && typeof input === 'object' ? input : {};
    const sourcePreferences = source.preferences || {};
    const preferences = {
      ...base.preferences,
      ...sourcePreferences,
      faceRules: { ...base.preferences.faceRules, ...(sourcePreferences.faceRules || {}) }
    };
    return {
      ...base,
      ...source,
      schemaVersion: Math.max(2, Number(source.schemaVersion) || 1),
      profile: { ...base.profile, ...(source.profile || {}) },
      preferences,
      scripts: Array.isArray(source.scripts) ? source.scripts.map((script) => normaliseScript(script, preferences)) : [],
      appVersion: APP_VERSION,
      modifiedAt: source.modifiedAt || source.updatedAt || null
    };
  }

  function playerSettingsFromPreferences(preferences = state?.preferences || DEFAULT_STATE.preferences) {
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

  function normalisePlayerSettings(settings, preferences = state?.preferences || DEFAULT_STATE.preferences) {
    const base = playerSettingsFromPreferences(preferences);
    const source = settings && typeof settings === 'object' ? settings : {};
    return {
      ...base,
      ...source,
      speed: clampNumber(source.speed, 5, 140, base.speed),
      fontSize: clampNumber(source.fontSize, 24, 120, base.fontSize),
      lineHeight: clampNumber(source.lineHeight, 1.05, 2, base.lineHeight),
      paragraphSpacing: clampNumber(source.paragraphSpacing, 0, 1.5, base.paragraphSpacing),
      textWidth: clampNumber(source.textWidth, 45, 100, base.textWidth),
      alignment: ['left', 'center', 'right'].includes(source.alignment) ? source.alignment : base.alignment,
      cameraFacing: ['user', 'environment'].includes(source.cameraFacing) ? source.cameraFacing : base.cameraFacing,
      cameraOpacity: clampNumber(source.cameraOpacity, 10, 100, base.cameraOpacity),
      cameraDim: clampNumber(source.cameraDim, 0, 85, base.cameraDim),
      ttsPaceWpm: clampNumber(source.ttsPaceWpm, 80, 220, base.ttsPaceWpm)
    };
  }

  function normaliseScript(script, preferences = state?.preferences || DEFAULT_STATE.preferences) {
    const now = new Date().toISOString();
    return {
      id: script.id || uid(),
      title: typeof script.title === 'string' ? script.title : 'Untitled script',
      body: typeof script.body === 'string' ? script.body : '',
      createdAt: script.createdAt || now,
      updatedAt: script.updatedAt || script.createdAt || now,
      playerSettingsUpdatedAt: script.playerSettingsUpdatedAt || null,
      playerSettings: normalisePlayerSettings(script.playerSettings, preferences)
    };
  }

  function clampNumber(value, min, max, fallback) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
  }

  function ensureInitialScript() {
    if (!state.scripts.length) {
      const script = makeScript('Welcome to Teleprompter', 'Write or paste your script here.\n\nOpen the player when you are ready. Use Space to play or pause and the arrow keys to adjust speed.');
      state.scripts.push(script);
      state.activeScriptId = script.id;
      markWorkspaceChanged(script.updatedAt);
      persistNow();
    }
    if (!state.scripts.some((script) => script.id === state.activeScriptId)) {
      state.activeScriptId = state.scripts[0].id;
    }
  }

  function makeScript(title = 'Untitled script', body = '', playerSettings = null) {
    const now = new Date().toISOString();
    return {
      id: uid(),
      title,
      body,
      createdAt: now,
      updatedAt: now,
      playerSettingsUpdatedAt: now,
      playerSettings: normalisePlayerSettings(playerSettings || playerSettingsFromPreferences(state.preferences), state.preferences)
    };
  }

  function getActiveScript() {
    return state.scripts.find((script) => script.id === state.activeScriptId) || null;
  }

  function applyStateToUI() {
    const p = state.preferences;
    el.profileNameInput.value = state.profile.displayName || '';
    el.defaultSpeedInput.value = p.defaultSpeed;
    el.defaultSpeedOutput.value = p.defaultSpeed;
    el.defaultFontSizeInput.value = p.defaultFontSize;
    el.defaultFontSizeOutput.value = p.defaultFontSize;
    el.defaultLineHeightInput.value = p.defaultLineHeight;
    el.defaultLineHeightOutput.value = p.defaultLineHeight;
    const paragraphSpacing = Number.isFinite(Number(p.defaultParagraphSpacing)) ? Number(p.defaultParagraphSpacing) : 0.45;
    el.defaultParagraphSpacingInput.value = paragraphSpacing;
    el.defaultParagraphSpacingOutput.value = paragraphSpacing;
    el.defaultTextWidthInput.value = p.defaultTextWidth;
    el.defaultTextWidthOutput.value = p.defaultTextWidth;
    el.countdownSelect.value = String(p.countdown);
    el.autoHideControlsInput.checked = Boolean(p.autoHideControls);
    el.defaultFocusGuideInput.checked = Boolean(p.focusGuide);
    el.defaultWakeLockInput.checked = Boolean(p.keepAwake);
    el.defaultCameraEnabledInput.checked = Boolean(p.cameraEnabled);
    el.defaultCameraOpacityInput.value = Number(p.cameraOpacity) || 65;
    el.defaultCameraOpacityOutput.value = Number(p.cameraOpacity) || 65;
    el.defaultCameraDimInput.value = Number(p.cameraDim) || 25;
    el.defaultCameraDimOutput.value = Number(p.cameraDim) || 25;
    el.defaultCameraMirrorInput.checked = Boolean(p.cameraMirror);
    el.defaultFaceControlsInput.checked = Boolean(p.faceControlsEnabled);
    el.smileActionSelect.value = p.faceRules.smile || 'play';
    el.mouthOpenActionSelect.value = p.faceRules.mouthOpen || 'off';
    el.blinkActionSelect.value = p.faceRules.blink || 'off';
    el.browRaiseActionSelect.value = p.faceRules.browRaise || 'off';
    el.faceThresholdInput.value = Number(p.faceThreshold) || 55;
    el.faceThresholdOutput.value = Number(p.faceThreshold) || 55;
    el.faceHoldSelect.value = String(p.faceHoldMs || 350);
    el.faceCooldownSelect.value = String(p.faceCooldownMs || 1500);
    el.faceRateSelect.value = String(p.faceInferenceFps || 5);
    el.recordIncludeAudioInput.checked = p.recordIncludeAudio !== false;
    el.defaultTtsEnabledInput.checked = Boolean(p.ttsEnabled);
    el.ttsPaceInput.value = Number(p.ttsPaceWpm) || 130;
    el.ttsPaceOutput.value = Number(p.ttsPaceWpm) || 130;
    const savedTtsVolume = Number.isFinite(Number(p.ttsVolume)) ? Number(p.ttsVolume) : 35;
    el.ttsVolumeInput.value = savedTtsVolume;
    el.ttsVolumeOutput.value = savedTtsVolume;
    el.ttsSyncScrollInput.checked = p.ttsSyncScroll !== false;
    el.defaultVoiceControlsInput.checked = Boolean(p.voiceControlsEnabled);
    el.voiceRequirePrefixInput.checked = p.voiceRequirePrefix !== false;
    el.voicePrefixInput.value = p.voicePrefix || 'prompter';
    el.voiceStartOnSpeechInput.checked = Boolean(p.voiceStartOnSpeech);
    el.voicePauseSilenceSelect.value = String(Number(p.voicePauseAfterSilenceMs) || 0);
    el.voiceLanguageSelect.value = p.voiceLanguage || 'en-NZ';
    populateTtsVoices(p.ttsVoiceURI || '');
  }

  function renderScriptList() {
    const query = el.scriptSearchInput.value.trim().toLowerCase();
    el.scriptList.innerHTML = '';
    const scripts = [...state.scripts]
      .filter((script) => !query || `${script.title}\n${script.body}`.toLowerCase().includes(query))
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

    scripts.forEach((script) => {
      const fragment = el.scriptItemTemplate.content.cloneNode(true);
      const item = fragment.querySelector('.script-item');
      item.dataset.scriptId = script.id;
      item.classList.toggle('active', script.id === state.activeScriptId);
      fragment.querySelector('.script-item-title').textContent = script.title.trim() || 'Untitled script';
      fragment.querySelector('.script-item-meta').textContent = `${countWords(script.body)} words · ${formatRelativeDate(script.updatedAt)}`;
      item.addEventListener('click', () => selectScript(script.id));
      el.scriptList.appendChild(fragment);
    });

    if (!scripts.length) {
      const empty = document.createElement('div');
      empty.className = 'hint';
      empty.textContent = 'No scripts match your search.';
      el.scriptList.appendChild(empty);
    }
  }

  function selectScript(id) {
    if (id === state.activeScriptId) {
      el.scriptsPanel.classList.remove('open');
      return;
    }
    flushEditorToState();
    state.activeScriptId = id;
    markWorkspaceChanged();
    persistNow();
    loadActiveScriptIntoEditor();
    renderScriptList();
    el.scriptsPanel.classList.remove('open');
  }

  function loadActiveScriptIntoEditor() {
    const script = getActiveScript();
    if (!script) return;
    el.scriptTitleInput.value = script.title;
    el.scriptBodyInput.value = script.body;
    updateScriptStats(script);
  }

  function handleEditorInput() {
    const script = getActiveScript();
    if (!script) return;
    script.title = el.scriptTitleInput.value;
    script.body = el.scriptBodyInput.value;
    script.updatedAt = new Date().toISOString();
    markWorkspaceChanged(script.updatedAt);
    updateScriptStats(script);
    renderScriptList();
    scheduleSave();
  }

  function flushEditorToState() {
    const script = getActiveScript();
    if (!script) return;
    script.title = el.scriptTitleInput.value;
    script.body = el.scriptBodyInput.value;
  }

  function updateScriptStats(script) {
    const words = countWords(script.body);
    const minutes = words ? Math.max(1, Math.ceil(words / WORDS_PER_MINUTE)) : 0;
    el.wordCount.textContent = `${words} ${words === 1 ? 'word' : 'words'}`;
    el.durationEstimate.textContent = `${minutes} min`;
    el.updatedAt.textContent = script.updatedAt ? `Edited ${formatRelativeDate(script.updatedAt)}` : 'Not edited';
  }

  function createNewScript() {
    flushEditorToState();
    const script = makeScript();
    state.scripts.push(script);
    state.activeScriptId = script.id;
    markWorkspaceChanged(script.updatedAt);
    persistNow();
    loadActiveScriptIntoEditor();
    renderScriptList();
    el.scriptSearchInput.value = '';
    el.scriptsPanel.classList.remove('open');
    el.scriptTitleInput.focus();
    el.scriptTitleInput.select();
    toast('New script created');
  }

  function duplicateActiveScript() {
    flushEditorToState();
    const source = getActiveScript();
    if (!source) return;
    const script = makeScript(`${source.title || 'Untitled script'} copy`, source.body, source.playerSettings);
    state.scripts.push(script);
    state.activeScriptId = script.id;
    markWorkspaceChanged(script.updatedAt);
    persistNow();
    loadActiveScriptIntoEditor();
    renderScriptList();
    el.scriptsPanel.classList.remove('open');
    toast('Script duplicated');
  }

  function resetActiveScriptPlayerSettings() {
    const script = getActiveScript();
    if (!script) return;
    script.playerSettings = playerSettingsFromPreferences(state.preferences);
    const now = new Date().toISOString();
    script.playerSettingsUpdatedAt = now;
    markWorkspaceChanged(now);
    persistNow();
    toast('Player settings reset to current defaults');
  }

  function deleteActiveScript() {
    const active = getActiveScript();
    if (!active) return;
    const title = active.title.trim() || 'Untitled script';
    if (!window.confirm(`Delete “${title}”?`)) return;
    state.scripts = state.scripts.filter((script) => script.id !== active.id);
    if (!state.scripts.length) state.scripts.push(makeScript());
    state.activeScriptId = [...state.scripts].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))[0].id;
    markWorkspaceChanged();
    persistNow();
    loadActiveScriptIntoEditor();
    renderScriptList();
    toast('Script deleted');
  }

  function markWorkspaceChanged(timestamp = new Date().toISOString()) {
    state.modifiedAt = timestamp;
    state.updatedAt = timestamp;
  }

  function scheduleSave() {
    if (el.saveState) el.saveState.textContent = 'Saving…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persistNow, 300);
  }

  function persistNow(options = {}) {
    clearTimeout(saveTimer);
    state.appVersion = APP_VERSION;
    try {
      storageManager.saveWorkspace(state);
      if (el.saveState) el.saveState.textContent = driveIsSignedIn() ? 'Saved locally · Drive pending' : 'Saved locally';
      if (options.cloud !== false && !applyingRemoteWorkspace) scheduleDriveSync();
    } catch (error) {
      console.error(error);
      if (el.saveState) el.saveState.textContent = 'Save failed';
      toast('Could not save to local storage');
    }
  }

  function openSettings() {
    applyStateToUI();
    el.settingsDialog.showModal();
  }

  function handleSettingsSubmit(event) {
    if (event.submitter && event.submitter.value === 'cancel') return;
    event.preventDefault();
    state.profile.displayName = el.profileNameInput.value.trim();
    state.preferences.defaultSpeed = Number(el.defaultSpeedInput.value);
    state.preferences.defaultFontSize = Number(el.defaultFontSizeInput.value);
    state.preferences.defaultLineHeight = Number(el.defaultLineHeightInput.value);
    state.preferences.defaultParagraphSpacing = Number(el.defaultParagraphSpacingInput.value);
    state.preferences.defaultTextWidth = Number(el.defaultTextWidthInput.value);
    state.preferences.countdown = Number(el.countdownSelect.value);
    state.preferences.autoHideControls = el.autoHideControlsInput.checked;
    state.preferences.focusGuide = el.defaultFocusGuideInput.checked;
    state.preferences.keepAwake = el.defaultWakeLockInput.checked;
    state.preferences.cameraEnabled = el.defaultCameraEnabledInput.checked;
    state.preferences.cameraOpacity = Number(el.defaultCameraOpacityInput.value);
    state.preferences.cameraDim = Number(el.defaultCameraDimInput.value);
    state.preferences.cameraMirror = el.defaultCameraMirrorInput.checked;
    state.preferences.faceControlsEnabled = el.defaultFaceControlsInput.checked;
    state.preferences.faceThreshold = Number(el.faceThresholdInput.value);
    state.preferences.faceHoldMs = Number(el.faceHoldSelect.value);
    state.preferences.faceCooldownMs = Number(el.faceCooldownSelect.value);
    state.preferences.faceInferenceFps = Number(el.faceRateSelect.value);
    state.preferences.faceRules = {
      smile: el.smileActionSelect.value,
      mouthOpen: el.mouthOpenActionSelect.value,
      blink: el.blinkActionSelect.value,
      browRaise: el.browRaiseActionSelect.value
    };
    state.preferences.recordIncludeAudio = el.recordIncludeAudioInput.checked;
    state.preferences.ttsEnabled = el.defaultTtsEnabledInput.checked;
    state.preferences.ttsPaceWpm = Number(el.ttsPaceInput.value);
    state.preferences.ttsVolume = Number(el.ttsVolumeInput.value);
    state.preferences.ttsVoiceURI = el.ttsVoiceSelect.value || '';
    state.preferences.ttsSyncScroll = el.ttsSyncScrollInput.checked;
    state.preferences.voiceControlsEnabled = el.defaultVoiceControlsInput.checked;
    state.preferences.voiceRequirePrefix = el.voiceRequirePrefixInput.checked;
    state.preferences.voicePrefix = el.voicePrefixInput.value.trim() || 'prompter';
    state.preferences.voiceStartOnSpeech = el.voiceStartOnSpeechInput.checked;
    state.preferences.voicePauseAfterSilenceMs = Number(el.voicePauseSilenceSelect.value) || 0;
    state.preferences.voiceLanguage = el.voiceLanguageSelect.value || 'en-NZ';
    markWorkspaceChanged();
    persistNow();
    el.settingsDialog.close();
    toast('Settings saved');
  }

  function openPlayer() {
    flushEditorToState();
    persistNow();
    const script = getActiveScript();
    if (!script) return;
    const playerSettings = normalisePlayerSettings(script.playerSettings, state.preferences);
    script.playerSettings = playerSettings;

    stopPlayer();
    renderPromptText(script.body);
    el.playerScriptName.textContent = script.title.trim() || 'Untitled script';
    playerSpeed = playerSettings.speed;
    playerFontSize = playerSettings.fontSize;
    playerLineHeight = playerSettings.lineHeight;
    playerParagraphSpacing = playerSettings.paragraphSpacing;
    playerTextWidth = playerSettings.textWidth;
    playerAlignment = playerSettings.alignment;
    mirrorHorizontal = Boolean(playerSettings.mirrorHorizontal);
    mirrorVertical = Boolean(playerSettings.mirrorVertical);
    focusGuideEnabled = Boolean(playerSettings.focusGuide);
    controlsLocked = false;
    cameraFacing = playerSettings.cameraFacing || 'user';
    cameraOpacity = Number(playerSettings.cameraOpacity) || 65;
    cameraDim = Number.isFinite(Number(playerSettings.cameraDim)) ? Number(playerSettings.cameraDim) : 25;
    cameraMirror = playerSettings.cameraMirror !== false;
    cameraEnabled = false;
    faceControlsEnabled = false;
    ttsEnabled = Boolean(playerSettings.ttsEnabled);
    ttsPaceWpm = Number(playerSettings.ttsPaceWpm) || 130;
    ttsVolume = Number.isFinite(Number(state.preferences.ttsVolume)) ? Number(state.preferences.ttsVolume) : 35;
    ttsVoiceURI = state.preferences.ttsVoiceURI || '';
    voiceControlsEnabled = false;

    el.speedRange.value = playerSpeed;
    el.fontSizeRange.value = playerFontSize;
    el.lineHeightRange.value = playerLineHeight;
    el.paragraphSpacingRange.value = playerParagraphSpacing;
    el.textWidthRange.value = playerTextWidth;
    el.cameraOpacityRange.value = cameraOpacity;
    el.cameraDimRange.value = cameraDim;
    el.ttsPaceRange.value = ttsPaceWpm;
    applyPlayerVisualSettings();
    applyCameraVisualSettings();
    applyTtsVisualSettings();
    applyVoiceVisualSettings();
    updateRecordingUi();
    el.playerScreen.hidden = false;
    document.body.classList.add('player-open');
    el.playerStage.classList.remove('chrome-hidden', 'controls-locked');
    void el.promptViewport.clientHeight;
    refreshPlayerMetrics();
    setPlayerScrollPosition(0);
    if (ttsEnabled && state.preferences.ttsSyncScroll !== false) applyTtsPaceToScrollSpeed();
    el.controlsLockButton.setAttribute('aria-pressed', 'false');
    revealChromeTemporarily();

    if (state.preferences.keepAwake) requestWakeLock();
    if (playerSettings.cameraEnabled || playerSettings.faceControlsEnabled) {
      startCamera({ enableFaceAfterStart: Boolean(playerSettings.faceControlsEnabled) });
    }
    if (playerSettings.voiceControlsEnabled) enableVoiceControls();
  }

  async function closePlayer() {
    saveActivePlayerSettings({ immediate: true });
    stopPlayer();
    cancelCountdown();
    cancelTtsGuide();
    disableVoiceControls();
    disableFaceControls();
    if (isRecording) await stopRecording();
    stopCamera();
    releaseWakeLock();
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    el.playerScreen.hidden = true;
    document.body.classList.remove('player-open');
  }

  function renderPromptText(text) {
    el.promptContent.innerHTML = '';
    let segmentIndex = 0;
    const chunks = String(text || '').split(/\n\s*\n/);
    if (!chunks.length || chunks.every((chunk) => !chunk.trim())) chunks.splice(0, chunks.length, 'Your script is empty.');
    chunks.forEach((chunk) => {
      const p = document.createElement('p');
      const lines = chunk.split('\n');
      lines.forEach((line, lineIndex) => {
        if (lineIndex) p.appendChild(document.createElement('br'));
        const segments = splitSpeechSegments(line);
        if (!segments.length) {
          p.appendChild(document.createTextNode(line));
          return;
        }
        segments.forEach((segment, index) => {
          const span = document.createElement('span');
          span.className = 'tts-segment';
          span.dataset.ttsSegmentIndex = String(segmentIndex++);
          span.textContent = segment;
          p.appendChild(span);
          if (index < segments.length - 1) p.appendChild(document.createTextNode(' '));
        });
      });
      el.promptContent.appendChild(p);
    });
    resetTtsViewportTracking();
  }

  function splitSpeechSegments(line) {
    const source = String(line || '').trim();
    if (!source) return [];
    const matches = source.match(/[^.!?]+[.!?]+(?:[\"'”’\)\]]+)?|[^.!?]+$/g);
    return (matches || [source]).map((part) => part.trim()).filter(Boolean);
  }

  function togglePlay() {
    if (playerStartCountdown) {
      cancelCountdown();
      revealChromeTemporarily(true);
      return;
    }
    if (isPlaying) {
      stopPlayer();
      revealChromeTemporarily(true);
      return;
    }
    if (isAtEnd()) setPlayerScrollPosition(0);
    const countdown = state.preferences.countdown;
    if (countdown > 0 && playerScrollPosition < 5) {
      runCountdown(countdown).then(() => startPlayer()).catch(() => {});
    } else {
      startPlayer();
    }
  }

  function startPlayer() {
    if (isPlaying || el.playerScreen.hidden) return;
    cancelCountdown();
    refreshPlayerMetrics();
    playerScrollPosition = clampPlayerScroll(el.promptViewport.scrollTop);
    if (playerScrollMax <= 0) {
      revealChromeTemporarily(true);
      return;
    }
    isPlaying = true;
    lastFrameTime = performance.now();
    startOrResumeTtsGuide();
    processViewportTts();
    updatePlayButton();
    if (state.preferences.autoHideControls && !controlsLocked) hideChromeSoon(650);
    playerFrame = requestAnimationFrame(playerTick);
  }

  function stopPlayer() {
    isPlaying = false;
    lastFrameTime = null;
    if (playerFrame) cancelAnimationFrame(playerFrame);
    playerFrame = null;
    // Read the rendered value on pause so manual navigation resumes from exactly
    // where the browser left the viewport.
    playerScrollPosition = clampPlayerScroll(el.promptViewport.scrollTop);
    pauseTtsGuide();
    updatePlayButton();
  }

  function playerTick(timestamp) {
    if (!isPlaying) return;

    // Keep a high precision position independent of scrollTop. Some mobile browsers
    // quantise scrollTop writes, so adding a fraction directly to the DOM can lose
    // movement from frame to frame and make slow speeds stutter or stop completely.
    const elapsedMs = Number.isFinite(lastFrameTime) ? timestamp - lastFrameTime : 0;
    const deltaSeconds = Math.max(0, Math.min(100, elapsedMs)) / 1000;
    lastFrameTime = timestamp;
    refreshPlayerMetrics();

    const nextPosition = playerScrollPosition + (playerSpeed * deltaSeconds);
    setPlayerScrollPosition(nextPosition);
    processViewportTts();

    if (isAtEnd()) {
      stopPlayer();
      revealChromeTemporarily(true);
      return;
    }
    playerFrame = requestAnimationFrame(playerTick);
  }

  function getPlayerMaxScroll() {
    return Math.max(0, el.promptViewport.scrollHeight - el.promptViewport.clientHeight);
  }

  function clampPlayerScroll(position) {
    const value = Number.isFinite(Number(position)) ? Number(position) : 0;
    return Math.max(0, Math.min(playerScrollMax, value));
  }

  function saveActivePlayerSettings(options = {}) {
    const script = getActiveScript();
    if (!script || el.playerScreen.hidden) return false;
    const nextSettings = normalisePlayerSettings({
      ...script.playerSettings,
      speed: playerSpeed,
      fontSize: playerFontSize,
      lineHeight: playerLineHeight,
      paragraphSpacing: playerParagraphSpacing,
      textWidth: playerTextWidth,
      alignment: playerAlignment,
      mirrorHorizontal,
      mirrorVertical,
      focusGuide: focusGuideEnabled,
      cameraEnabled,
      cameraFacing,
      cameraOpacity,
      cameraDim,
      cameraMirror,
      faceControlsEnabled,
      ttsEnabled,
      ttsPaceWpm,
      voiceControlsEnabled
    }, state.preferences);
    const before = JSON.stringify(script.playerSettings || {});
    const after = JSON.stringify(nextSettings);
    if (before === after) return false;
    const now = new Date().toISOString();
    script.playerSettings = nextSettings;
    script.playerSettingsUpdatedAt = now;
    markWorkspaceChanged(now);
    if (options.immediate) persistNow();
    else scheduleSave();
    return true;
  }

  function refreshPlayerMetrics() {
    if (!el.promptViewport || !el.playerScreen || el.playerScreen.hidden) return;
    playerScrollMax = getPlayerMaxScroll();
    playerScrollPosition = clampPlayerScroll(playerScrollPosition);
  }

  function setPlayerScrollPosition(position) {
    refreshPlayerMetrics();
    playerScrollPosition = clampPlayerScroll(position);
    el.promptViewport.scrollTo({ top: playerScrollPosition, left: 0, behavior: 'auto' });
    return playerScrollPosition;
  }

  function isAtEnd() {
    refreshPlayerMetrics();
    const position = isPlaying ? playerScrollPosition : clampPlayerScroll(el.promptViewport.scrollTop);
    return playerScrollMax <= 0 || position >= playerScrollMax - 0.5;
  }

  function syncPlayerScrollPosition() {
    if (isPlaying || el.playerScreen.hidden) return;
    refreshPlayerMetrics();
    playerScrollPosition = clampPlayerScroll(el.promptViewport.scrollTop);
    if (ttsEnabled) syncTtsTrackingToCurrentScroll({ cancelCurrent: true });
  }

  function restartPlayer() {
    stopPlayer();
    cancelCountdown();
    cancelTtsGuide();
    setPlayerScrollPosition(0);
    revealChromeTemporarily(true);
  }

  function jumpSeconds(seconds) {
    const distance = playerSpeed * seconds;
    const origin = isPlaying ? playerScrollPosition : el.promptViewport.scrollTop;
    setPlayerScrollPosition(origin + distance);
    if (isPlaying && isAtEnd()) stopPlayer();
    if (ttsEnabled) syncTtsTrackingToCurrentScroll({ cancelCurrent: true });
    revealChromeTemporarily(true);
  }

  function updatePlayButton() {
    if (!el.playPauseButton) return;
    el.playPauseButton.textContent = isPlaying ? 'Pause' : 'Play';
  }

  function updatePlayerSpeed() {
    playerSpeed = Number(el.speedRange.value);
    el.speedValue.textContent = String(playerSpeed);
    saveActivePlayerSettings();
  }

  function updatePlayerFontSize() {
    playerFontSize = Number(el.fontSizeRange.value);
    el.fontSizeValue.textContent = String(playerFontSize);
    el.promptContent.style.setProperty('--prompt-size', `${playerFontSize}px`);
    refreshLayoutDependentPlayerSettings();
    saveActivePlayerSettings();
  }

  function updatePlayerLineHeight() {
    playerLineHeight = Number(el.lineHeightRange.value) || 1.45;
    el.lineHeightValue.textContent = playerLineHeight.toFixed(2).replace(/0$/, '');
    el.promptContent.style.setProperty('--prompt-line-height', String(playerLineHeight));
    refreshLayoutDependentPlayerSettings();
    saveActivePlayerSettings();
  }

  function updatePlayerParagraphSpacing() {
    playerParagraphSpacing = Number(el.paragraphSpacingRange.value);
    if (!Number.isFinite(playerParagraphSpacing)) playerParagraphSpacing = 0.45;
    el.paragraphSpacingValue.textContent = playerParagraphSpacing.toFixed(2).replace(/0$/, '');
    el.promptContent.style.setProperty('--prompt-paragraph-spacing', `${playerParagraphSpacing}em`);
    refreshLayoutDependentPlayerSettings();
    saveActivePlayerSettings();
  }

  function refreshLayoutDependentPlayerSettings() {
    requestAnimationFrame(() => {
      refreshPlayerMetrics();
      syncTtsTrackingToCurrentScroll({ cancelCurrent: true });
      if (ttsEnabled && state.preferences.ttsSyncScroll !== false) applyTtsPaceToScrollSpeed();
    });
  }

  function updatePlayerTextWidth() {
    playerTextWidth = Number(el.textWidthRange.value);
    el.textWidthValue.textContent = String(playerTextWidth);
    el.promptContent.style.setProperty('--prompt-width', `${playerTextWidth}%`);
    refreshLayoutDependentPlayerSettings();
    saveActivePlayerSettings();
  }

  function cycleAlignment() {
    const options = ['left', 'center', 'right'];
    const index = options.indexOf(playerAlignment);
    playerAlignment = options[(index + 1) % options.length];
    applyPlayerVisualSettings();
    saveActivePlayerSettings();
  }

  function toggleMirrorHorizontal() {
    mirrorHorizontal = !mirrorHorizontal;
    applyPlayerVisualSettings();
    saveActivePlayerSettings();
  }

  function toggleMirrorVertical() {
    mirrorVertical = !mirrorVertical;
    applyPlayerVisualSettings();
    saveActivePlayerSettings();
  }

  function toggleFocusGuide() {
    focusGuideEnabled = !focusGuideEnabled;
    applyPlayerVisualSettings();
    saveActivePlayerSettings();
  }

  function toggleControlsLock() {
    controlsLocked = !controlsLocked;
    el.controlsLockButton.setAttribute('aria-pressed', String(controlsLocked));
    el.playerStage.classList.toggle('controls-locked', controlsLocked);
    if (!controlsLocked) revealChromeTemporarily(true);
  }

  function applyPlayerVisualSettings() {
    el.speedValue.textContent = String(playerSpeed);
    el.fontSizeValue.textContent = String(playerFontSize);
    el.lineHeightValue.textContent = playerLineHeight.toFixed(2).replace(/0$/, '');
    el.paragraphSpacingValue.textContent = playerParagraphSpacing.toFixed(2).replace(/0$/, '');
    el.textWidthValue.textContent = String(playerTextWidth);
    el.promptContent.style.setProperty('--prompt-size', `${playerFontSize}px`);
    el.promptContent.style.setProperty('--prompt-line-height', String(playerLineHeight));
    el.promptContent.style.setProperty('--prompt-paragraph-spacing', `${playerParagraphSpacing}em`);
    el.promptContent.style.setProperty('--prompt-width', `${playerTextWidth}%`);
    el.promptContent.classList.toggle('align-center', playerAlignment === 'center');
    el.promptContent.classList.toggle('align-right', playerAlignment === 'right');
    el.promptContent.classList.toggle('mirror-h', mirrorHorizontal);
    el.promptContent.classList.toggle('mirror-v', mirrorVertical);
    el.alignButton.textContent = `Align: ${capitalise(playerAlignment)}`;
    el.mirrorHorizontalButton.setAttribute('aria-pressed', String(mirrorHorizontal));
    el.mirrorVerticalButton.setAttribute('aria-pressed', String(mirrorVertical));
    el.focusGuide.hidden = !focusGuideEnabled;
    el.focusGuideButton.setAttribute('aria-pressed', String(focusGuideEnabled));
  }

  async function toggleCamera() {
    if (isRecording && cameraEnabled) {
      toast('Stop recording before turning the camera off');
      return;
    }
    if (cameraEnabled) {
      disableFaceControls();
      stopCamera();
      saveActivePlayerSettings();
      toast('Camera background off');
      return;
    }
    const started = await startCamera();
    if (started) saveActivePlayerSettings();
  }

  async function startCamera({ enableFaceAfterStart = false } = {}) {
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
      cameraEnabled = false;
      applyCameraVisualSettings();
      toast('Camera access is not available here. Use the PWA over HTTPS or localhost.');
      return false;
    }

    stopCameraTracks();
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: cameraFacing },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      });
      if (el.playerScreen.hidden) {
        stopCameraTracks();
        return false;
      }
      el.cameraVideo.srcObject = cameraStream;
      await el.cameraVideo.play();
      cameraEnabled = true;
      el.cameraLayer.hidden = false;
      applyCameraVisualSettings();
      toast(cameraFacing === 'environment' ? 'Rear camera background on' : 'Camera background on');
      if (enableFaceAfterStart) await enableFaceControls();
      return true;
    } catch (error) {
      console.warn('Camera could not start', error);
      cameraEnabled = false;
      el.cameraLayer.hidden = true;
      applyCameraVisualSettings();
      toast(cameraErrorMessage(error));
      return false;
    }
  }

  function stopCamera() {
    stopCameraTracks();
    cameraEnabled = false;
    el.cameraLayer.hidden = true;
    applyCameraVisualSettings();
  }

  function stopCameraTracks() {
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop());
    }
    cameraStream = null;
    if (el.cameraVideo) {
      el.cameraVideo.pause();
      el.cameraVideo.srcObject = null;
    }
  }

  async function switchCamera() {
    if (!cameraEnabled) return;
    if (isRecording) {
      toast('Stop recording before switching cameras');
      return;
    }
    const reenableFaceControls = faceControlsEnabled;
    const originalFacing = cameraFacing;
    disableFaceControls();
    cameraFacing = cameraFacing === 'user' ? 'environment' : 'user';
    const started = await startCamera({ enableFaceAfterStart: reenableFaceControls });
    if (!started) {
      cameraFacing = originalFacing;
      await startCamera({ enableFaceAfterStart: reenableFaceControls });
    }
    applyCameraVisualSettings();
    saveActivePlayerSettings();
  }

  function toggleCameraMirror() {
    cameraMirror = !cameraMirror;
    applyCameraVisualSettings();
    saveActivePlayerSettings();
  }

  function updateCameraOpacity() {
    cameraOpacity = Number(el.cameraOpacityRange.value);
    applyCameraVisualSettings();
    saveActivePlayerSettings();
  }

  function updateCameraDim() {
    cameraDim = Number(el.cameraDimRange.value);
    applyCameraVisualSettings();
    saveActivePlayerSettings();
  }

  function applyCameraVisualSettings() {
    if (!el.cameraLayer) return;
    el.cameraLayer.hidden = !cameraEnabled;
    el.playerStage.classList.toggle('camera-active', cameraEnabled);
    el.cameraVideo.style.opacity = String(Math.max(0.1, Math.min(1, cameraOpacity / 100)));
    el.cameraDim.style.opacity = String(Math.max(0, Math.min(0.85, cameraDim / 100)));
    el.cameraLayer.classList.toggle('camera-mirrored', cameraFacing === 'user' && cameraMirror);
    el.cameraOpacityRange.value = String(cameraOpacity);
    el.cameraOpacityValue.textContent = String(cameraOpacity);
    el.cameraDimRange.value = String(cameraDim);
    el.cameraDimValue.textContent = String(cameraDim);
    el.cameraOpacityField.hidden = !cameraEnabled;
    el.cameraDimField.hidden = !cameraEnabled;
    el.switchCameraButton.hidden = !cameraEnabled;
    el.mirrorCameraButton.hidden = !cameraEnabled;
    el.faceControlsButton.hidden = !cameraEnabled;
    el.cameraButton.setAttribute('aria-pressed', String(cameraEnabled));
    el.cameraTopButton.setAttribute('aria-pressed', String(cameraEnabled));
    el.mirrorCameraButton.setAttribute('aria-pressed', String(cameraMirror));
    el.cameraTopButton.title = cameraEnabled ? 'Turn camera background off' : 'Turn camera background on';
  }

  async function toggleFaceControls() {
    if (faceControlsEnabled) {
      disableFaceControls();
      saveActivePlayerSettings();
      return;
    }
    const enabled = await enableFaceControls();
    if (enabled) saveActivePlayerSettings();
  }

  async function enableFaceControls() {
    if (!cameraEnabled) {
      const started = await startCamera();
      if (!started) return false;
    }
    const engine = window.TeleprompterFaceControl && window.TeleprompterFaceControl.engine;
    if (!engine) {
      toast('Face control engine is unavailable');
      return false;
    }

    faceControlsEnabled = true;
    el.faceControlsButton.setAttribute('aria-pressed', 'true');
    el.faceControlStatus.hidden = false;
    handleFaceStatus({ state: 'loading', message: 'Loading face controls…' });

    try {
      await engine.enable(el.cameraVideo, {
        threshold: (Number(state.preferences.faceThreshold) || 55) / 100,
        holdMs: Number(state.preferences.faceHoldMs) || 350,
        cooldownMs: Number(state.preferences.faceCooldownMs) || 1500,
        inferenceFps: Number(state.preferences.faceInferenceFps) || 5,
        rules: state.preferences.faceRules,
        onTrigger: handleFaceTrigger,
        onStatus: handleFaceStatus
      });
      return true;
    } catch (error) {
      console.warn('Face controls could not start', error);
      faceControlsEnabled = false;
      el.faceControlsButton.setAttribute('aria-pressed', 'false');
      return false;
    }
  }

  function disableFaceControls() {
    const engine = window.TeleprompterFaceControl && window.TeleprompterFaceControl.engine;
    if (engine) engine.disable();
    faceControlsEnabled = false;
    clearTimeout(faceStatusResetTimer);
    faceStatusResetTimer = null;
    if (el.faceControlsButton) el.faceControlsButton.setAttribute('aria-pressed', 'false');
    if (el.faceControlStatus) {
      el.faceControlStatus.hidden = true;
      el.faceControlStatus.dataset.state = 'off';
      el.faceControlStatus.textContent = 'Face controls off';
    }
  }

  function handleFaceTrigger(event) {
    if (!faceControlsEnabled) return;
    const actionLabels = {
      play: 'Start scrolling',
      pause: 'Pause scrolling',
      toggle: 'Toggle scrolling',
      restart: 'Restart script',
      faster: 'Increase speed',
      slower: 'Decrease speed'
    };
    clearTimeout(faceStatusResetTimer);
    faceStatusResetTimer = setTimeout(() => { faceStatusResetTimer = null; }, 750);
    el.faceControlStatus.hidden = false;
    el.faceControlStatus.dataset.state = 'triggered';
    el.faceControlStatus.textContent = `${event.label}: ${actionLabels[event.action] || event.action}`;
    performControlAction(event.action);
  }

  function handleFaceStatus(status) {
    if (!faceControlsEnabled || !el.faceControlStatus) return;
    if (faceStatusResetTimer && status.state !== 'error') return;
    el.faceControlStatus.hidden = false;
    el.faceControlStatus.dataset.state = status.state || 'ready';
    el.faceControlStatus.textContent = status.message || 'Face controls ready';
  }

  function setPlayerSpeed(value) {
    playerSpeed = Math.max(5, Math.min(140, Number(value) || 35));
    el.speedRange.value = String(playerSpeed);
    updatePlayerSpeed();
  }

  function populateTtsVoices(preferredVoiceURI) {
    if (!el.ttsVoiceSelect || !('speechSynthesis' in window)) return;
    const selected = preferredVoiceURI !== undefined ? preferredVoiceURI : (el.ttsVoiceSelect.value || ttsVoiceURI || '');
    const voices = window.speechSynthesis.getVoices();
    el.ttsVoiceSelect.innerHTML = '<option value="">System default</option>';
    voices
      .slice()
      .sort((a, b) => `${a.lang} ${a.name}`.localeCompare(`${b.lang} ${b.name}`))
      .forEach((voice) => {
        const option = document.createElement('option');
        option.value = voice.voiceURI;
        option.textContent = `${voice.name} (${voice.lang})${voice.localService ? '' : ' · online'}`;
        el.ttsVoiceSelect.appendChild(option);
      });
    if ([...el.ttsVoiceSelect.options].some((option) => option.value === selected)) el.ttsVoiceSelect.value = selected;
  }

  function toggleTtsGuide() {
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
      toast('Text to speech is not supported in this browser');
      return;
    }
    ttsEnabled = !ttsEnabled;
    if (ttsEnabled && state.preferences.ttsSyncScroll !== false) applyTtsPaceToScrollSpeed();
    if (!ttsEnabled) cancelTtsGuide();
    else {
      syncTtsTrackingToCurrentScroll({ cancelCurrent: true });
      if (isPlaying) processViewportTts();
    }
    applyTtsVisualSettings();
    saveActivePlayerSettings();
  }

  function applyTtsVisualSettings() {
    if (!el.ttsButton) return;
    el.ttsButton.setAttribute('aria-pressed', String(ttsEnabled));
    el.ttsButton.textContent = ttsEnabled ? 'TTS Guide On' : 'TTS Guide';
    el.ttsPaceField.hidden = !ttsEnabled;
    el.ttsPaceRange.value = String(ttsPaceWpm);
    el.ttsPaceValue.textContent = String(ttsPaceWpm);
  }

  function updateTtsPaceFromPlayer() {
    ttsPaceWpm = Number(el.ttsPaceRange.value) || 130;
    el.ttsPaceValue.textContent = String(ttsPaceWpm);
    if (ttsEnabled && state.preferences.ttsSyncScroll !== false) applyTtsPaceToScrollSpeed();
    saveActivePlayerSettings();
    if (ttsEnabled && ttsUtterance) {
      const currentIndex = ttsCurrentSegmentIndex;
      cancelTtsSpeechOnly();
      if (currentIndex >= 0) {
        ttsSpokenSegmentIndexes.delete(currentIndex);
        queueTtsSegment(currentIndex, true);
      }
      if (isPlaying) speakNextQueuedTtsSegment();
    }
  }

  function applyTtsPaceToScrollSpeed() {
    if (!ttsEnabled || state.preferences.ttsSyncScroll === false || !el.promptViewport || el.playerScreen.hidden) return;
    refreshPlayerMetrics();
    const script = getActiveScript();
    const words = script ? countWords(script.body) : 0;
    if (!words || playerScrollMax <= 0) return;
    const durationSeconds = Math.max(1, (words / Math.max(80, ttsPaceWpm)) * 60);
    const estimatedSpeed = Math.max(5, Math.min(140, playerScrollMax / durationSeconds));
    setPlayerSpeed(Math.round(estimatedSpeed));
  }

  function startOrResumeTtsGuide() {
    if (!ttsEnabled || !('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') return;
    if (window.speechSynthesis.paused && ttsUtterance) {
      window.speechSynthesis.resume();
      return;
    }
    processViewportTts();
  }

  function processViewportTts() {
    if (!ttsEnabled || !isPlaying || !el.promptViewport || el.playerScreen.hidden) return;
    const segments = getTtsSegments();
    if (!segments.length) return;
    const triggerPosition = getTtsTriggerPosition();

    segments.forEach((segment, index) => {
      if (ttsSpokenSegmentIndexes.has(index) || ttsQueuedSegmentIndexes.includes(index) || index === ttsCurrentSegmentIndex) return;
      const segmentTop = getSegmentTop(segment);
      if (segmentTop <= triggerPosition) queueTtsSegment(index);
    });
    speakNextQueuedTtsSegment();
  }

  function getTtsSegments() {
    return [...el.promptContent.querySelectorAll('[data-tts-segment-index]')];
  }

  function getTtsTriggerPosition() {
    const viewportTop = isPlaying ? playerScrollPosition : clampPlayerScroll(el.promptViewport.scrollTop);
    const readingZoneRatio = window.matchMedia('(max-width: 760px)').matches ? 0.35 : 0.39;
    return viewportTop + (el.promptViewport.clientHeight * readingZoneRatio);
  }

  function getSegmentTop(segment) {
    const segmentRect = segment.getBoundingClientRect();
    const viewportRect = el.promptViewport.getBoundingClientRect();
    const viewportTop = isPlaying ? playerScrollPosition : clampPlayerScroll(el.promptViewport.scrollTop);
    return viewportTop + (segmentRect.top - viewportRect.top);
  }

  function queueTtsSegment(index, front = false) {
    if (index < 0 || ttsSpokenSegmentIndexes.has(index) || ttsQueuedSegmentIndexes.includes(index) || index === ttsCurrentSegmentIndex) return;
    if (front) ttsQueuedSegmentIndexes.unshift(index);
    else ttsQueuedSegmentIndexes.push(index);
  }

  function speakNextQueuedTtsSegment() {
    if (!ttsEnabled || !isPlaying || ttsUtterance || !ttsQueuedSegmentIndexes.length) return;
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') return;
    const segments = getTtsSegments();
    const index = ttsQueuedSegmentIndexes.shift();
    const segment = segments[index];
    if (!segment) {
      speakNextQueuedTtsSegment();
      return;
    }
    const text = segment.textContent.trim();
    if (!text) {
      ttsSpokenSegmentIndexes.add(index);
      speakNextQueuedTtsSegment();
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = state.preferences.voiceLanguage || 'en-NZ';
    utterance.rate = Math.max(0.5, Math.min(2, ttsPaceWpm / 130));
    utterance.volume = Math.max(0, Math.min(1, ttsVolume / 100));
    const voices = window.speechSynthesis.getVoices();
    const selectedVoice = voices.find((voice) => voice.voiceURI === ttsVoiceURI);
    if (selectedVoice) utterance.voice = selectedVoice;
    ttsCurrentSegmentIndex = index;
    ttsSpokenSegmentIndexes.add(index);

    const finish = () => {
      if (ttsUtterance !== utterance) return;
      ttsUtterance = null;
      ttsCurrentSegmentIndex = -1;
      if (isPlaying) {
        processViewportTts();
        speakNextQueuedTtsSegment();
      }
    };
    utterance.addEventListener('end', finish);
    utterance.addEventListener('error', finish);
    ttsUtterance = utterance;
    window.speechSynthesis.speak(utterance);
  }

  function pauseTtsGuide() {
    if (!ttsEnabled || !('speechSynthesis' in window)) return;
    if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) window.speechSynthesis.pause();
  }

  function cancelTtsSpeechOnly() {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    ttsUtterance = null;
    ttsCurrentSegmentIndex = -1;
  }

  function cancelTtsGuide() {
    cancelTtsSpeechOnly();
    ttsQueuedSegmentIndexes = [];
    ttsSpokenSegmentIndexes = new Set();
  }

  function resetTtsViewportTracking() {
    cancelTtsSpeechOnly();
    ttsQueuedSegmentIndexes = [];
    ttsSpokenSegmentIndexes = new Set();
  }

  function syncTtsTrackingToCurrentScroll(options = {}) {
    if (!el.promptViewport || el.playerScreen.hidden) return;
    if (options.cancelCurrent) cancelTtsSpeechOnly();
    ttsQueuedSegmentIndexes = [];
    const segments = getTtsSegments();
    const triggerPosition = getTtsTriggerPosition();
    let currentIndex = segments.findIndex((segment) => getSegmentTop(segment) >= triggerPosition);
    if (currentIndex < 0) currentIndex = segments.length;
    ttsSpokenSegmentIndexes = new Set();
    for (let index = 0; index < currentIndex; index += 1) ttsSpokenSegmentIndexes.add(index);
  }

  async function toggleVoiceControls() {
    if (voiceControlsEnabled) {
      disableVoiceControls();
      saveActivePlayerSettings();
      return;
    }
    const enabled = await enableVoiceControls();
    if (enabled) saveActivePlayerSettings();
  }

  async function enableVoiceControls() {
    const engine = window.TeleprompterSpeech && window.TeleprompterSpeech.voiceCommands;
    if (!engine || !engine.isSupported()) {
      voiceControlsEnabled = false;
      applyVoiceVisualSettings();
      toast('Speech recognition is not supported in this browser');
      return false;
    }
    voiceControlsEnabled = true;
    applyVoiceVisualSettings();
    handleVoiceStatus({ state: 'starting', message: 'Starting voice controls…' });
    try {
      engine.enable({
        language: state.preferences.voiceLanguage || 'en-NZ',
        prefix: state.preferences.voicePrefix || 'prompter',
        requirePrefix: state.preferences.voiceRequirePrefix !== false,
        startOnSpeech: Boolean(state.preferences.voiceStartOnSpeech),
        pauseAfterSilenceMs: Number(state.preferences.voicePauseAfterSilenceMs) || 0,
        ignoreResults: () => Boolean(
          state.preferences.voiceRequirePrefix === false &&
          ttsEnabled &&
          'speechSynthesis' in window &&
          window.speechSynthesis.speaking &&
          !window.speechSynthesis.paused
        ),
        onAction: handleVoiceAction,
        onStatus: handleVoiceStatus
      });
      return true;
    } catch (error) {
      console.warn('Voice controls could not start', error);
      voiceControlsEnabled = false;
      applyVoiceVisualSettings();
      toast(error.message || 'Voice controls could not start');
      return false;
    }
  }

  function disableVoiceControls() {
    const engine = window.TeleprompterSpeech && window.TeleprompterSpeech.voiceCommands;
    if (engine) engine.disable();
    voiceControlsEnabled = false;
    clearTimeout(voiceStatusResetTimer);
    voiceStatusResetTimer = null;
    if (el.voiceControlStatus) {
      el.voiceControlStatus.hidden = true;
      el.voiceControlStatus.dataset.state = 'off';
      el.voiceControlStatus.textContent = 'Voice controls off';
    }
    applyVoiceVisualSettings();
  }

  function applyVoiceVisualSettings() {
    if (!el.voiceControlsButton) return;
    el.voiceControlsButton.setAttribute('aria-pressed', String(voiceControlsEnabled));
    el.voiceControlsButton.textContent = voiceControlsEnabled ? 'Voice Controls On' : 'Voice Controls';
  }

  function handleVoiceAction(event) {
    if (!voiceControlsEnabled) return;
    performControlAction(event.action);
  }

  function handleVoiceStatus(status) {
    if (!voiceControlsEnabled || !el.voiceControlStatus) return;
    clearTimeout(voiceStatusResetTimer);
    el.voiceControlStatus.hidden = false;
    el.voiceControlStatus.dataset.state = status.state || 'listening';
    el.voiceControlStatus.textContent = status.message || 'Voice controls listening';
    if (status.state === 'triggered') {
      voiceStatusResetTimer = setTimeout(() => {
        voiceStatusResetTimer = null;
        if (voiceControlsEnabled) {
          const prefix = state.preferences.voicePrefix || 'prompter';
          el.voiceControlStatus.dataset.state = 'listening';
          el.voiceControlStatus.textContent = state.preferences.voiceRequirePrefix !== false ? `Listening · “${prefix} pause”` : 'Listening for commands';
        }
      }, 1600);
    }
  }

  function performControlAction(action) {
    if (action === 'play') {
      if (!isPlaying) {
        if (isAtEnd()) setPlayerScrollPosition(0);
        startPlayer();
      }
    } else if (action === 'pause') {
      if (isPlaying) stopPlayer();
    } else if (action === 'toggle') {
      if (isPlaying) stopPlayer();
      else {
        if (isAtEnd()) setPlayerScrollPosition(0);
        startPlayer();
      }
    } else if (action === 'restart') {
      restartPlayer();
    } else if (action === 'faster') {
      setPlayerSpeed(playerSpeed + 5);
    } else if (action === 'slower') {
      setPlayerSpeed(playerSpeed - 5);
    } else if (action === 'record-start') {
      if (!isRecording) startRecording();
    } else if (action === 'record-stop') {
      if (isRecording) stopRecording();
    }
  }

  async function toggleRecording() {
    if (isRecording) {
      await stopRecording();
      return;
    }
    await startRecording();
  }

  async function startRecording() {
    if (isRecording) return true;
    if (typeof MediaRecorder === 'undefined') {
      toast('Camera recording is not supported in this browser');
      return false;
    }
    if (!cameraEnabled) {
      const started = await startCamera();
      if (!started) return false;
    }
    const videoTracks = cameraStream ? cameraStream.getVideoTracks() : [];
    if (!videoTracks.length) {
      toast('No camera video is available to record');
      return false;
    }

    let audioTracks = [];
    if (state.preferences.recordIncludeAudio !== false && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      try {
        recordingAudioStream = await navigator.mediaDevices.getUserMedia({
          video: false,
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        });
        audioTracks = recordingAudioStream.getAudioTracks();
      } catch (error) {
        console.warn('Microphone could not be added to recording', error);
        toast('Microphone unavailable. Recording video only.');
      }
    }

    const clonedVideoTracks = videoTracks.map((track) => track.clone());
    recordingStream = new MediaStream([...clonedVideoTracks, ...audioTracks]);
    const mimeType = chooseRecordingMimeType();
    const options = mimeType ? { mimeType } : undefined;

    try {
      mediaRecorder = options ? new MediaRecorder(recordingStream, options) : new MediaRecorder(recordingStream);
    } catch (error) {
      cleanupRecordingStreams();
      console.warn('MediaRecorder could not be created', error);
      toast('Camera recording could not start');
      return false;
    }

    recordingChunks = [];
    recordingFinalised = false;
    mediaRecorder.addEventListener('dataavailable', (event) => {
      if (event.data && event.data.size > 0) recordingChunks.push(event.data);
    });
    mediaRecorder.addEventListener('error', (event) => {
      console.warn('Recording error', event.error || event);
      toast('Recording stopped because of a browser error');
    });
    mediaRecorder.addEventListener('stop', finaliseRecording, { once: true });

    try {
      mediaRecorder.start(1000);
      isRecording = true;
      recordingStartedAt = Date.now();
      recordingTimer = setInterval(updateRecordingUi, 500);
      updateRecordingUi();
      revealChromeTemporarily(true);
      toast('Recording camera feed');
      return true;
    } catch (error) {
      cleanupRecordingStreams();
      mediaRecorder = null;
      console.warn('Recording could not start', error);
      toast('Camera recording could not start');
      return false;
    }
  }

  function stopRecording() {
    if (!isRecording || !mediaRecorder) return Promise.resolve();
    return new Promise((resolve) => {
      recordingStopResolve = resolve;
      clearTimeout(recordingStopTimer);
      recordingStopTimer = setTimeout(() => finaliseRecording(), 2500);
      clearInterval(recordingTimer);
      recordingTimer = null;
      if (mediaRecorder.state !== 'inactive') mediaRecorder.stop();
      else finaliseRecording();
    });
  }

  function finaliseRecording() {
    if (recordingFinalised) return;
    recordingFinalised = true;
    clearTimeout(recordingStopTimer);
    recordingStopTimer = null;
    clearInterval(recordingTimer);
    recordingTimer = null;
    const recorderMime = mediaRecorder && mediaRecorder.mimeType ? mediaRecorder.mimeType : (recordingChunks[0] && recordingChunks[0].type) || 'video/webm';
    const blob = recordingChunks.length ? new Blob(recordingChunks, { type: recorderMime }) : null;
    isRecording = false;
    updateRecordingUi();
    cleanupRecordingStreams();
    mediaRecorder = null;
    recordingChunks = [];

    if (blob && blob.size > 0) {
      const script = getActiveScript();
      const title = safeFilename(script && script.title ? script.title : 'teleprompter-recording');
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const extension = recorderMime.includes('mp4') ? 'mp4' : 'webm';
      downloadMediaBlob(`${title}-${stamp}.${extension}`, blob);
    } else {
      toast('No recording data was produced');
    }
    if (recordingStopResolve) {
      const resolve = recordingStopResolve;
      recordingStopResolve = null;
      resolve();
    }
  }

  function cleanupRecordingStreams() {
    if (recordingStream) {
      recordingStream.getVideoTracks().forEach((track) => track.stop());
    }
    recordingStream = null;
    if (recordingAudioStream) recordingAudioStream.getTracks().forEach((track) => track.stop());
    recordingAudioStream = null;
  }

  function chooseRecordingMimeType() {
    if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return '';
    const candidates = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/mp4;codecs=h264,aac',
      'video/mp4',
      'video/webm'
    ];
    return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
  }

  function updateRecordingUi() {
    if (!el.recordButton || !el.recordingStatus) return;
    el.recordButton.setAttribute('aria-pressed', String(isRecording));
    el.recordButton.title = isRecording ? 'Stop and save camera recording' : 'Record camera feed';
    el.recordButton.setAttribute('aria-label', isRecording ? 'Stop and save camera recording' : 'Start camera recording');
    el.recordingStatus.hidden = !isRecording;
    if (isRecording) {
      const elapsed = Math.max(0, Date.now() - recordingStartedAt);
      el.recordingTime.textContent = formatRecordingTime(elapsed);
    } else {
      el.recordingTime.textContent = '00:00';
    }
  }

  function formatRecordingTime(milliseconds) {
    const totalSeconds = Math.floor(milliseconds / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function downloadMediaBlob(filename, blob) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast(`Saved ${filename}`);
  }

  function cameraErrorMessage(error) {
    if (!error) return 'Camera could not be started';
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') return 'Camera permission was not granted';
    if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') return 'No camera was found';
    if (error.name === 'NotReadableError' || error.name === 'TrackStartError') return 'The camera is already in use by another app';
    return 'Camera could not be started';
  }

  function revealOrToggleChrome() {
    if (controlsLocked) {
      controlsLocked = false;
      el.controlsLockButton.setAttribute('aria-pressed', 'false');
      el.playerStage.classList.remove('controls-locked');
      revealChromeTemporarily(true);
      return;
    }
    const hidden = el.playerStage.classList.contains('chrome-hidden');
    if (hidden) revealChromeTemporarily(true);
    else if (state.preferences.autoHideControls) el.playerStage.classList.add('chrome-hidden');
  }

  function revealChromeTemporarily(force = false) {
    if (controlsLocked && !force) return;
    clearTimeout(chromeTimer);
    el.playerStage.classList.remove('chrome-hidden');
    if (isPlaying && state.preferences.autoHideControls && !controlsLocked) hideChromeSoon(1500);
  }

  function hideChromeSoon(delay) {
    clearTimeout(chromeTimer);
    chromeTimer = setTimeout(() => {
      if (isPlaying && !controlsLocked) el.playerStage.classList.add('chrome-hidden');
    }, delay);
  }

  function runCountdown(seconds) {
    cancelCountdown();
    return new Promise((resolve, reject) => {
      let remaining = seconds;
      el.countdownOverlay.hidden = false;
      el.countdownValue.textContent = String(remaining);
      playerStartCountdown = { reject, timer: null };
      const tick = () => {
        remaining -= 1;
        if (remaining <= 0) {
          el.countdownOverlay.hidden = true;
          playerStartCountdown = null;
          resolve();
          return;
        }
        el.countdownValue.textContent = String(remaining);
        playerStartCountdown.timer = setTimeout(tick, 1000);
      };
      playerStartCountdown.timer = setTimeout(tick, 1000);
    });
  }

  function cancelCountdown() {
    if (!playerStartCountdown) return;
    clearTimeout(playerStartCountdown.timer);
    const reject = playerStartCountdown.reject;
    playerStartCountdown = null;
    el.countdownOverlay.hidden = true;
    reject(new Error('Countdown cancelled'));
  }

  async function toggleFullscreen() {
    try {
      if (!document.fullscreenElement) await el.playerStage.requestFullscreen();
      else await document.exitFullscreen();
    } catch (error) {
      toast('Fullscreen is not available in this browser');
    }
  }

  async function toggleWakeLock() {
    if (wakeLock) {
      await releaseWakeLock();
      return;
    }
    await requestWakeLock(true);
  }

  async function requestWakeLock(showMessage = false) {
    if (!('wakeLock' in navigator)) {
      if (showMessage) toast('Screen wake lock is not supported here');
      return;
    }
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      el.wakeLockButton.setAttribute('aria-pressed', 'true');
      wakeLock.addEventListener('release', () => {
        wakeLock = null;
        el.wakeLockButton.setAttribute('aria-pressed', 'false');
      });
      if (showMessage) toast('Screen will stay awake');
    } catch (error) {
      if (showMessage) toast('Could not keep the screen awake');
    }
  }

  async function releaseWakeLock() {
    if (!wakeLock) return;
    try { await wakeLock.release(); } catch (_) {}
    wakeLock = null;
    el.wakeLockButton.setAttribute('aria-pressed', 'false');
  }

  function handleVisibilityChange() {
    if (document.visibilityState === 'visible') {
      if (isPlaying) lastFrameTime = performance.now();
      refreshPlayerMetrics();
      if (state.preferences.keepAwake && !el.playerScreen.hidden && !wakeLock) requestWakeLock();
    }
  }

  function handleKeyboard(event) {
    if (el.playerScreen.hidden) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        flushEditorToState();
        persistNow();
        toast('Saved');
      }
      return;
    }

    const key = event.key;
    if (key === 'Escape') {
      closePlayer();
      return;
    }
    if (key === ' ') {
      event.preventDefault();
      togglePlay();
      return;
    }
    if (key === 'ArrowUp') {
      event.preventDefault();
      playerSpeed = Math.min(140, playerSpeed + 5);
      el.speedRange.value = playerSpeed;
      updatePlayerSpeed();
      return;
    }
    if (key === 'ArrowDown') {
      event.preventDefault();
      playerSpeed = Math.max(5, playerSpeed - 5);
      el.speedRange.value = playerSpeed;
      updatePlayerSpeed();
      return;
    }
    if (key === 'ArrowLeft') {
      event.preventDefault();
      jumpSeconds(-10);
      return;
    }
    if (key === 'ArrowRight') {
      event.preventDefault();
      jumpSeconds(10);
    }
  }

  async function handleImportFiles(event) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    let importedScripts = 0;
    let workspaceImported = false;

    for (const file of files) {
      try {
        const text = await file.text();
        const name = file.name.toLowerCase();
        if (name.endsWith('.json')) {
          const data = JSON.parse(text);
          if (data && Array.isArray(data.scripts) && data.preferences) {
            const replacement = normaliseWorkspace(data);
            state.schemaVersion = replacement.schemaVersion;
            state.profile = replacement.profile;
            state.preferences = replacement.preferences;
            state.scripts = replacement.scripts;
            state.activeScriptId = replacement.activeScriptId || replacement.scripts[0]?.id || null;
            state.modifiedAt = replacement.modifiedAt || replacement.updatedAt || null;
            state.updatedAt = replacement.updatedAt || replacement.modifiedAt || null;
            workspaceImported = true;
          } else if (data && typeof data.body === 'string') {
            const script = normaliseScript({ ...data, id: uid(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
            state.scripts.push(script);
            state.activeScriptId = script.id;
            importedScripts += 1;
          } else {
            throw new Error('Unsupported JSON format');
          }
        } else {
          const title = file.name.replace(/\.(txt|md|markdown)$/i, '') || 'Imported script';
          const script = makeScript(title, text);
          state.scripts.push(script);
          state.activeScriptId = script.id;
          importedScripts += 1;
        }
      } catch (error) {
        console.error('Import failed', file.name, error);
        toast(`Could not import ${file.name}`);
      }
    }

    ensureInitialScript();
    markWorkspaceChanged();
    persistNow();
    applyStateToUI();
    renderScriptList();
    loadActiveScriptIntoEditor();
    event.target.value = '';

    if (workspaceImported) toast('Workspace imported');
    else if (importedScripts) toast(`${importedScripts} ${importedScripts === 1 ? 'script' : 'scripts'} imported`);
  }

  function exportActiveScriptText() {
    flushEditorToState();
    const script = getActiveScript();
    if (!script) return;
    downloadBlob(`${safeFilename(script.title || 'script')}.txt`, script.body, 'text/plain;charset=utf-8');
  }

  function exportActiveScriptJson() {
    flushEditorToState();
    const script = getActiveScript();
    if (!script) return;
    downloadBlob(`${safeFilename(script.title || 'script')}.json`, JSON.stringify(script, null, 2), 'application/json');
  }

  function exportWorkspace() {
    flushEditorToState();
    persistNow();
    const stamp = new Date().toISOString().slice(0, 10);
    downloadBlob(`teleprompter-workspace-${stamp}.json`, JSON.stringify(state, null, 2), 'application/json');
  }

  function downloadBlob(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(`Exported ${filename}`);
  }

  function countWords(text) {
    const cleaned = String(text || '').trim();
    return cleaned ? cleaned.split(/\s+/).length : 0;
  }

  function formatRelativeDate(value) {
    if (!value) return 'never';
    const date = new Date(value);
    const diff = Date.now() - date.getTime();
    if (!Number.isFinite(diff)) return 'recently';
    const abs = Math.abs(diff);
    if (abs < 60_000) return 'just now';
    if (abs < 3_600_000) return `${Math.floor(abs / 60_000)}m ago`;
    if (abs < 86_400_000) return `${Math.floor(abs / 3_600_000)}h ago`;
    if (abs < 604_800_000) return `${Math.floor(abs / 86_400_000)}d ago`;
    return date.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: date.getFullYear() !== new Date().getFullYear() ? 'numeric' : undefined });
  }

  function safeFilename(value) {
    return String(value || 'script')
      .trim()
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
      .replace(/\s+/g, ' ')
      .slice(0, 80) || 'script';
  }

  function capitalise(value) {
    return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
  }

  function toast(message) {
    const item = document.createElement('div');
    item.className = 'toast';
    item.textContent = message;
    el.toastRegion.appendChild(item);
    setTimeout(() => item.remove(), 2600);
  }

  function getDriveSync() {
    return window.TeleprompterGoogleDrive && window.TeleprompterGoogleDrive.sync;
  }

  function driveIsSignedIn() {
    const sync = getDriveSync();
    return Boolean(sync && sync.isSignedIn());
  }

  function initGoogleDriveIntegration() {
    const sync = getDriveSync();
    if (!sync) {
      if (el.googleDriveButton) el.googleDriveButton.disabled = true;
      if (el.mobileGoogleDriveButton) el.mobileGoogleDriveButton.disabled = true;
      return;
    }
    sync.configure({ onStatus: handleGoogleDriveStatus });
    if (el.googleClientIdDisplay) el.googleClientIdDisplay.textContent = window.TeleprompterGoogleDrive.CLIENT_ID || '';
    updateGoogleDriveUi();
  }

  function openGoogleDriveDialog() {
    updateGoogleDriveUi();
    el.googleDriveDialog.showModal();
  }

  function updateGoogleDriveUi() {
    const sync = getDriveSync();
    const signedIn = Boolean(sync && sync.isSignedIn());
    const profile = sync?.profile || (state.profile.provider === 'google' ? state.profile : null);
    if (el.googleSignedOutPanel) el.googleSignedOutPanel.hidden = signedIn;
    if (el.googleSignedInPanel) el.googleSignedInPanel.hidden = !signedIn;
    if (el.googleOriginNote) {
      if (location.protocol === 'file:') {
        el.googleOriginNote.textContent = 'Open this PWA through HTTPS or localhost to use Google sign-in. file:// pages cannot use the configured web OAuth origin.';
      } else {
        el.googleOriginNote.textContent = `Current origin: ${location.origin}`;
      }
    }
    const previouslyConnected = state.profile.provider === 'google';
    const driveButtonLabel = signedIn ? 'Drive Connected' : (previouslyConnected ? 'Reconnect Drive' : 'Google Drive');
    if (el.googleDriveButton) el.googleDriveButton.textContent = driveButtonLabel;
    if (el.mobileGoogleDriveButton) el.mobileGoogleDriveButton.textContent = driveButtonLabel;
    if (el.storageProviderName) el.storageProviderName.textContent = signedIn ? 'Local browser + Google Drive' : 'Local browser storage';
    if (el.storageProviderStatus) el.storageProviderStatus.textContent = signedIn ? 'Drive connected' : (previouslyConnected ? 'Reconnect Drive' : 'Google Drive available');
    if (profile) {
      if (el.googleProfileName) el.googleProfileName.textContent = profile.name || profile.displayName || 'Google Account';
      if (el.googleProfileEmail) el.googleProfileEmail.textContent = profile.email || '';
      if (el.googleProfileImage) {
        if (profile.picture) {
          el.googleProfileImage.src = profile.picture;
          el.googleProfileImage.hidden = false;
          el.googleProfileImage.alt = `${profile.name || 'Google'} profile photo`;
        } else {
          el.googleProfileImage.hidden = true;
          el.googleProfileImage.removeAttribute('src');
        }
      }
    }
  }

  function handleGoogleDriveStatus(status) {
    if (el.googleSyncStatus) {
      el.googleSyncStatus.dataset.state = status.state || 'idle';
      el.googleSyncStatus.textContent = status.message || 'Google Drive';
    }
    if (status.state === 'synced' && el.saveState) el.saveState.textContent = 'Saved locally · Drive synced';
    if (status.state === 'expired' && el.saveState) el.saveState.textContent = 'Saved locally · Reconnect Drive';
    updateGoogleDriveUi();
  }

  async function signInWithGoogle() {
    const sync = getDriveSync();
    if (!sync) return;
    el.googleSignInButton.disabled = true;
    try {
      flushEditorToState();
      persistNow({ cloud: false });
      await sync.signIn();
      updateGoogleDriveUi();
      await syncGoogleDriveNow({ manual: true, signingIn: true });
      applyGoogleProfileToWorkspace(sync.profile);
      markWorkspaceChanged();
      persistNow();
      toast(`Connected ${sync.profile?.email || 'Google Drive'}`);
    } catch (error) {
      console.warn('Google sign-in failed', error);
      handleGoogleDriveStatus({ state: 'error', message: error.message || 'Google sign-in failed' });
      toast(error.message || 'Google sign-in failed');
    } finally {
      el.googleSignInButton.disabled = false;
      updateGoogleDriveUi();
    }
  }

  function applyGoogleProfileToWorkspace(profile) {
    if (!profile) return;
    state.profile.provider = 'google';
    state.profile.googleSub = profile.sub || '';
    state.profile.email = profile.email || '';
    state.profile.picture = profile.picture || '';
    if (!state.profile.displayName && profile.name) state.profile.displayName = profile.name;
    applyStateToUI();
  }

  async function disconnectGoogleDrive() {
    const sync = getDriveSync();
    driveConflictPending = false;
    if (!sync) return;
    try { await sync.signOut(); } catch (error) { console.warn('Google disconnect failed', error); }
    state.profile.provider = 'local';
    state.profile.email = '';
    state.profile.picture = '';
    state.profile.googleSub = '';
    markWorkspaceChanged();
    persistNow({ cloud: false });
    updateGoogleDriveUi();
    toast('Google Drive disconnected');
  }

  function scheduleDriveSync(delayMs = 1200) {
    if (!driveIsSignedIn() || applyingRemoteWorkspace || driveConflictPending) return;
    clearTimeout(driveSyncTimer);
    driveSyncTimer = setTimeout(() => {
      driveSyncTimer = null;
      syncGoogleDriveNow({ manual: false });
    }, delayMs);
  }

  async function syncGoogleDriveNow(options = {}) {
    const sync = getDriveSync();
    if (!sync || !sync.isSignedIn() || driveSyncInFlight) return null;
    driveSyncInFlight = true;
    if (options.manual) driveConflictPending = false;
    if (el.googleSyncNowButton) el.googleSyncNowButton.disabled = true;
    try {
      flushEditorToState();
      persistNow({ cloud: false });
      const result = await sync.syncWorkspace(clone(state), {
        onRemoteNewer: async () => {
          if (!options.manual) return 'remote';
          const useRemote = window.confirm('Google Drive has a newer teleprompter workspace. Load the Drive version?\n\nChoose Cancel to keep this device version and replace the Drive copy.');
          return useRemote ? 'remote' : 'local';
        }
      });
      if (result?.direction === 'download' && result.workspace) {
        if (!options.manual) {
          driveConflictPending = true;
          handleGoogleDriveStatus({ state: 'conflict', message: 'Newer Drive version available · Sync Now to review' });
          return result;
        }
        applyRemoteWorkspace(result.workspace);
        toast('Loaded newer workspace from Google Drive');
      } else if (options.manual && !options.signingIn) {
        toast('Google Drive synced');
      }
      driveConflictPending = false;
      return result;
    } catch (error) {
      console.warn('Google Drive sync failed', error);
      handleGoogleDriveStatus({ state: 'error', message: error.message || 'Google Drive sync failed' });
      if (options.manual) toast(error.message || 'Google Drive sync failed');
      return null;
    } finally {
      driveSyncInFlight = false;
      if (el.googleSyncNowButton) el.googleSyncNowButton.disabled = false;
      updateGoogleDriveUi();
    }
  }

  function applyRemoteWorkspace(remoteWorkspace) {
    const replacement = normaliseWorkspace(remoteWorkspace);
    applyingRemoteWorkspace = true;
    try {
      state.schemaVersion = replacement.schemaVersion;
      state.appVersion = APP_VERSION;
      state.profile = replacement.profile;
      state.preferences = replacement.preferences;
      state.scripts = replacement.scripts;
      state.activeScriptId = replacement.activeScriptId || replacement.scripts[0]?.id || null;
      state.modifiedAt = replacement.modifiedAt || replacement.updatedAt || null;
      state.updatedAt = replacement.updatedAt || replacement.modifiedAt || null;
      ensureInitialScript();
      persistNow({ cloud: false });
      applyStateToUI();
      renderScriptList();
      loadActiveScriptIntoEditor();
    } finally {
      applyingRemoteWorkspace = false;
    }
  }

  function registerOptionalServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (!/^https?:$/.test(location.protocol)) return;
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  }

})();
