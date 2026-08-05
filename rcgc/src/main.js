import html2canvas from "html2canvas";
import { renderAppShell } from "./app-template.js";
import {
  CLOUD_CONFIG_KEY,
  LEGACY_STORAGE_KEYS,
  STORAGE_KEY,
  USER_PREFERENCES_KEY,
  USER_SETTINGS_KEY,
  createInitialProject,
  featureStyles,
  formats,
  nzLocations,
  seedRecords,
  templates
} from "./data.js";
import { ExportMapController } from "./export-map-controller.js";
import { loadExploreCatalog, searchExplore } from "./explore-search.js";
import {
  findNearestRoad,
  findNearestRoadPoint,
  loadFarNorthPlaces
} from "./gis-data.js";
import { MapController } from "./map-controller.js";
import {
  DEFAULT_CLOUD_CONFIG,
  DEFAULT_USER_PREFERENCES,
  DEFAULT_USER_SETTINGS,
  GoogleDriveSync,
  mergeWorkspaceBundles,
  normalizeCloudConfig,
  normalizeUserPreferences,
  normalizeUserSettings,
  validateGoogleClientId
} from "./google-drive-sync.js";
import {
  ensureReferenceLayers,
  routeRoadNamesForProject
} from "./reference-layers.js";
import { RouteService } from "./route-service.js";
import {
  clone,
  downloadBlob,
  escapeHtml,
  formatDate,
  formatRange,
  slugify
} from "./utils.js";

const app = document.querySelector("#app");

let mapController;
let exportMapController;
let routeService;
let currentStep = 0;
let currentView = "editor";
let recordFilter = "All";
let recordQuery = "";
let manualPreviewScale = null;
let saveTimer;
let referenceFilterTimer;
let locationLoadSequence = 0;
let locationCatalog = [...nzLocations];
let exploreType = "all";
let exploreResults = [];
let selectedExploreResult = null;
let exploreSearchSequence = 0;
let detectedRouteResult = null;
let routeRoadCatalog = [];
let cloudSyncTimer;
let cloudSyncInFlight = false;
let pendingCloudBundle = null;
let lastCloudStatus = null;
let suppressCloudQueue = false;
let runtimeCloudConfigLoaded = false;

const readLocalJson = (key, fallback) => {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value ?? fallback;
  } catch (error) {
    console.warn(`Could not read local setting ${key}`, error);
    return fallback;
  }
};

let cloudConfig = normalizeCloudConfig(
  readLocalJson(CLOUD_CONFIG_KEY, DEFAULT_CLOUD_CONFIG)
);
let userPreferences = normalizeUserPreferences(
  readLocalJson(USER_PREFERENCES_KEY, DEFAULT_USER_PREFERENCES)
);
let userSettings = normalizeUserSettings(
  readLocalJson(USER_SETTINGS_KEY, DEFAULT_USER_SETTINGS)
);

const cloudSync = new GoogleDriveSync(cloudConfig, {
  onStatus: (event) => handleCloudStatus(event)
});

const ensureRouting = (project) => {
  project.routing ||= {};
  project.routing.start ||= null;
  project.routing.end ||= null;
  if (typeof project.routing.avoidClosures !== "boolean") {
    project.routing.avoidClosures = true;
  }
  if (typeof project.routing.preferHighways !== "boolean") {
    project.routing.preferHighways = true;
  }
  if (typeof project.routing.includeAlternatives !== "boolean") {
    project.routing.includeAlternatives = false;
  }
  if (typeof project.routing.includeNetworkRoutesInGeoJson !== "boolean") {
    project.routing.includeNetworkRoutesInGeoJson = true;
  }
  if (!Array.isArray(project.routing.diagnosticsLog)) {
    project.routing.diagnosticsLog = [];
  }
  if (!("lastDetection" in project.routing)) {
    project.routing.lastDetection = null;
  }
  ["start", "end"].forEach((kind) => {
    if (
      project.routing[kind] &&
      typeof project.routing[kind].labelCustom !== "boolean"
    ) {
      project.routing[kind].labelCustom = false;
    }
  });
  return project.routing;
};

const ensureProjectOptions = (project) => {
  ensureRouting(project);
  project.features ||= [];
  project.features.forEach((feature) => {
    if (!["auto", "custom"].includes(feature.labelMode)) {
      feature.labelMode =
        feature.type === "closure" ||
        feature.generatedBy === "route-detector-v2" ||
        String(feature.id || "").includes("-demo")
          ? "auto"
          : "custom";
    }
    if (
      !Array.isArray(feature.labelPosition) ||
      feature.labelPosition.length < 2 ||
      !feature.labelPosition.every((value) => Number.isFinite(Number(value)))
    ) {
      feature.labelPosition = null;
    }
    if (!Array.isArray(feature.routeStops)) feature.routeStops = [];
    if (!Array.isArray(feature.avoidRoadNames)) feature.avoidRoadNames = [];
  });
  project.editing ||= {};
  if (typeof project.editing.stickToRoad !== "boolean") {
    project.editing.stickToRoad = true;
  }
  project.publicationMap ||= {
    manual: false,
    lat: null,
    lng: null,
    zoom: null
  };
  project.graphicLabels ||= {};
  [
    "showFeatureLabels",
    "showDistances",
    "showMapCaption",
    "showLegend",
    "showNorthArrow",
    "showLabelBorders",
    "showLegendBorder"
  ].forEach((key) => {
    if (typeof project.graphicLabels[key] !== "boolean") {
      project.graphicLabels[key] = true;
    }
  });
  project.graphicKeyItems ||= {};
  Object.entries(featureStyles).forEach(([type, style]) => {
    project.graphicKeyItems[type] ||= {};
    if (!String(project.graphicKeyItems[type].label || "").trim()) {
      project.graphicKeyItems[type].label = style.label;
    }
    if (!/^#[0-9a-f]{6}$/i.test(project.graphicKeyItems[type].color || "")) {
      project.graphicKeyItems[type].color = style.color;
    }
    if (typeof project.graphicKeyItems[type].visible !== "boolean") {
      project.graphicKeyItems[type].visible = true;
    }
  });
  project.featureDrafts ||= {};
  ["closure", "detour", "access"].forEach((type) => {
    project.featureDrafts[type] ||= { start: null, end: null };
  });
  if (!("areaGeometry" in project)) project.areaGeometry = null;
  ensureReferenceLayers(project);
  return project;
};

const createProjectWithUserDefaults = () => {
  const project = createInitialProject();
  project.format = userPreferences.defaultFormat;
  const defaults = userSettings.projectDefaults;
  if (defaults) {
    if (defaults.referenceLayers) {
      project.referenceLayers = clone(defaults.referenceLayers);
    }
    if (defaults.graphicLabels) {
      project.graphicLabels = clone(defaults.graphicLabels);
    }
    if (defaults.graphicKeyItems) {
      project.graphicKeyItems = clone(defaults.graphicKeyItems);
    }
    if (defaults.editing) project.editing = clone(defaults.editing);
  }
  return ensureProjectOptions(project);
};

const loadState = () => {
  for (const key of [STORAGE_KEY, ...LEGACY_STORAGE_KEYS]) {
    try {
      const stored = JSON.parse(localStorage.getItem(key));
      if (stored?.currentProject && Array.isArray(stored.records)) {
        ensureProjectOptions(stored.currentProject);
        stored.records.forEach(ensureProjectOptions);
        stored.history = Array.isArray(stored.history) ? stored.history : [];
        stored.ui = {
          lastView: stored.ui?.lastView === "records" ? "records" : "editor",
          lastStep: Math.max(0, Math.min(3, Number(stored.ui?.lastStep) || 0))
        };
        if (key !== STORAGE_KEY) stored.migratedFrom = key;
        return stored;
      }
    } catch (error) {
      console.warn(`Could not restore local draft from ${key}`, error);
    }
  }
  const records = seedRecords();
  return {
    currentProject: createProjectWithUserDefaults(),
    records,
    history: [],
    ui: { lastView: userPreferences.startView, lastStep: 0 },
    lastSavedAt: new Date().toISOString()
  };
};

let state = loadState();
ensureProjectOptions(state.currentProject);
state.history = Array.isArray(state.history) ? state.history : [];
state.ui ||= { lastView: userPreferences.startView, lastStep: 0 };
if (state.migratedFrom) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

const saveLocalCloudConfig = () => {
  cloudConfig = normalizeCloudConfig(cloudSync.configure(cloudConfig));
  localStorage.setItem(CLOUD_CONFIG_KEY, JSON.stringify(cloudConfig));
};

const saveLocalUserPreferences = () => {
  userPreferences = normalizeUserPreferences(userPreferences);
  localStorage.setItem(USER_PREFERENCES_KEY, JSON.stringify(userPreferences));
};

const saveLocalUserSettings = () => {
  userSettings = normalizeUserSettings(userSettings);
  localStorage.setItem(USER_SETTINGS_KEY, JSON.stringify(userSettings));
};

const recordHistory = (type, message, details = {}) => {
  state.history ||= [];
  state.history.unshift({
    id: `history-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    at: new Date().toISOString(),
    type,
    message,
    details: clone(details)
  });
  state.history = state.history.slice(0, userSettings.historyLimit);
  renderCloudHistory();
};

const persist = (message = "Draft saved locally", { queueCloud = true } = {}) => {
  state.currentProject.updatedAt = new Date().toISOString();
  state.lastSavedAt = state.currentProject.updatedAt;
  state.ui = { lastView: currentView, lastStep: currentStep };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  const saveState = document.querySelector("#saveState");
  const dot = document.querySelector(".autosave-dot");
  if (saveState) saveState.textContent = message;
  dot?.classList.remove("saving");
  if (
    queueCloud &&
    !suppressCloudQueue &&
    cloudConfig.autoSync &&
    cloudSync.isConnected()
  ) {
    queueCloudSync();
  }
};

const queuePersist = () => {
  clearTimeout(saveTimer);
  document.querySelector(".autosave-dot")?.classList.add("saving");
  const saveState = document.querySelector("#saveState");
  if (saveState) saveState.textContent = "Saving draft...";
  saveTimer = setTimeout(() => persist(), 450);
};

const saveUiPosition = () => {
  state.ui = { lastView: currentView, lastStep: currentStep };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
};

const showToast = (title, message, symbol = "✓") => {
  const region = document.querySelector("#toastRegion");
  if (!region) return;
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.innerHTML = `<i>${symbol}</i><div><strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span></div>`;
  region.appendChild(toast);
  setTimeout(() => toast.remove(), 3400);
};


const formatHistoryTime = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return new Intl.DateTimeFormat("en-NZ", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
};

const setCloudAvatar = (element, profile) => {
  if (!element) return;
  element.replaceChildren();
  if (profile?.picture) {
    const image = document.createElement("img");
    image.src = profile.picture;
    image.alt = "";
    image.referrerPolicy = "no-referrer";
    element.appendChild(image);
    return;
  }
  element.textContent = String(
    userPreferences.displayName || profile?.name || profile?.email || "G"
  )
    .trim()
    .charAt(0)
    .toUpperCase() || "G";
};

const renderCloudHistory = () => {
  const list = document.querySelector("#cloudHistoryList");
  if (!list) return;
  const entries = Array.isArray(state.history) ? state.history.slice(0, 12) : [];
  if (!entries.length) {
    list.innerHTML =
      '<li class="cloud-history-empty">No major actions have been recorded yet.</li>';
    return;
  }
  list.innerHTML = entries
    .map(
      (entry) => `
        <li>
          <time datetime="${escapeHtml(entry.at || "")}">${escapeHtml(
            formatHistoryTime(entry.at)
          )}</time>
          <span>${escapeHtml(entry.message || entry.type || "Activity")}</span>
        </li>`
    )
    .join("");
};

const currentCloudProfile = () => cloudSync.profile || cloudConfig.lastAccount;

const updateCloudUi = () => {
  const connected = cloudSync.isConnected();
  const profile = currentCloudProfile();
  const busyPhases = new Set(["connecting", "preparing", "loading", "syncing"]);
  const isBusy = cloudSyncInFlight || busyPhases.has(lastCloudStatus?.phase);
  const hasError = lastCloudStatus?.phase === "error";
  const accountLabel = document.querySelector("#cloudAccountLabel");
  if (accountLabel) {
    accountLabel.textContent = connected
      ? userPreferences.displayName || profile?.name || profile?.email || "Google Drive"
      : profile?.email
        ? "Reconnect Google"
        : "Sign in with Google";
  }
  setCloudAvatar(document.querySelector("#cloudAccountAvatar"), profile);
  setCloudAvatar(document.querySelector("#cloudProfileAvatar"), profile);

  const profileName = document.querySelector("#cloudProfileName");
  const profileEmail = document.querySelector("#cloudProfileEmail");
  if (profileName) {
    profileName.textContent = connected || profile
      ? userPreferences.displayName || profile?.name || "Google account"
      : "No Google account connected";
  }
  if (profileEmail) {
    profileEmail.textContent = profile?.email ||
      "Configure a Google OAuth web client ID to begin.";
  }

  const pill = document.querySelector("#cloudStatusPill");
  if (pill) {
    pill.className = "cloud-status-pill";
    if (hasError) {
      pill.textContent = "Needs attention";
      pill.classList.add("error");
    } else if (isBusy) {
      pill.textContent = "Working";
      pill.classList.add("busy");
    } else if (connected) {
      pill.textContent = "Connected";
      pill.classList.add("connected");
    } else {
      pill.textContent = profile ? "Reconnect required" : "Not connected";
    }
  }

  const cloudSaveState = document.querySelector("#cloudSaveState");
  if (cloudSaveState) {
    if (cloudSyncInFlight || lastCloudStatus?.phase === "syncing") {
      cloudSaveState.textContent = "Drive syncing";
    } else if (cloudSyncTimer) {
      cloudSaveState.textContent = "Drive changes pending";
    } else if (connected && cloudConfig.lastSyncAt) {
      cloudSaveState.textContent = `Drive synced ${formatHistoryTime(
        cloudConfig.lastSyncAt
      )}`;
    } else if (connected) {
      cloudSaveState.textContent = "Drive connected";
    } else if (profile) {
      cloudSaveState.textContent = "Drive needs reconnect";
    } else {
      cloudSaveState.textContent = "Drive not connected";
    }
  }

  const folderState = document.querySelector("#cloudFolderState");
  const folderLink = document.querySelector("#cloudFolderLink");
  const folderUrl = cloudSync.getFolderUrl();
  if (folderState) {
    folderState.textContent = cloudSync.rootFolder?.name ||
      (connected ? "Preparing folder" : "Not created");
    folderState.hidden = Boolean(folderUrl);
  }
  if (folderLink) {
    folderLink.hidden = !folderUrl;
    if (folderUrl) {
      folderLink.href = folderUrl;
      folderLink.textContent = `Open ${cloudSync.rootFolder?.name || cloudConfig.folderName}`;
    }
  }

  const setInputValue = (selector, value) => {
    const input = document.querySelector(selector);
    if (input && document.activeElement !== input) input.value = value ?? "";
  };
  setInputValue("#googleClientIdInput", cloudConfig.clientId);
  setInputValue("#googleDriveFolderInput", cloudConfig.folderName);
  setInputValue("#cloudDisplayNameInput", userPreferences.displayName);
  setInputValue("#cloudStartViewSelect", userPreferences.startView);
  setInputValue("#cloudDefaultFormatSelect", userPreferences.defaultFormat);
  const origin = document.querySelector("#cloudOriginValue");
  if (origin) origin.textContent = window.location.origin;

  const autoSync = document.querySelector("#cloudAutoSyncToggle");
  if (autoSync) autoSync.checked = cloudConfig.autoSync;
  const restore = document.querySelector("#cloudRestoreToggle");
  if (restore) restore.checked = cloudConfig.restoreOnConnect;
  const rememberStep = document.querySelector("#cloudRememberStepToggle");
  if (rememberStep) rememberStep.checked = userPreferences.rememberLastStep;

  ["#cloudSyncNowBtn", "#cloudLoadBtn", "#cloudMergeBtn"].forEach(
    (selector) => {
      const button = document.querySelector(selector);
      if (button) button.disabled = !connected || isBusy;
    }
  );
  const disconnect = document.querySelector("#googleDisconnectBtn");
  if (disconnect) disconnect.disabled = !connected;
  const signIn = document.querySelector("#googleSignInBtn");
  if (signIn) {
    signIn.disabled = isBusy;
    signIn.textContent = connected ? "Reconnect Google" : "Sign in with Google";
  }

  const conflict = document.querySelector("#cloudConflictPanel");
  if (conflict) conflict.hidden = !pendingCloudBundle;
  const summary = document.querySelector("#cloudSyncSummary");
  if (summary) {
    summary.textContent = pendingCloudBundle
      ? "A newer Drive workspace is waiting for your choice."
      : cloudConfig.lastSyncAt
        ? `Last successful sync: ${formatHistoryTime(cloudConfig.lastSyncAt)}.`
        : connected
          ? "Connected and ready for the first sync."
          : "Connect Google Drive to create the persistent workspace.";
  }

  const dialogStatus = document.querySelector("#cloudDialogStatus");
  if (dialogStatus) {
    dialogStatus.textContent = lastCloudStatus?.message ||
      (connected ? "Google Drive is ready." : "Local mode is ready.");
  }
  renderCloudHistory();
};

const handleCloudStatus = (event) => {
  lastCloudStatus = event;
  updateCloudUi();
};

const openCloudDialog = () => {
  updateCloudUi();
  const dialog = document.querySelector("#cloudDialog");
  if (dialog && !dialog.open) dialog.showModal();
};

const closeCloudDialog = () => {
  const dialog = document.querySelector("#cloudDialog");
  if (dialog?.open) dialog.close();
};

const readCloudControls = ({ persistLocal = true } = {}) => {
  const clientId = document.querySelector("#googleClientIdInput")?.value || "";
  const folderName =
    document.querySelector("#googleDriveFolderInput")?.value ||
    DEFAULT_CLOUD_CONFIG.folderName;
  cloudConfig = normalizeCloudConfig({
    ...cloudConfig,
    clientId,
    folderName,
    autoSync: document.querySelector("#cloudAutoSyncToggle")?.checked !== false,
    restoreOnConnect:
      document.querySelector("#cloudRestoreToggle")?.checked === true
  });
  userPreferences = normalizeUserPreferences({
    ...userPreferences,
    displayName:
      document.querySelector("#cloudDisplayNameInput")?.value || "",
    startView:
      document.querySelector("#cloudStartViewSelect")?.value || "editor",
    rememberLastStep:
      document.querySelector("#cloudRememberStepToggle")?.checked !== false,
    defaultFormat:
      document.querySelector("#cloudDefaultFormatSelect")?.value || "portrait"
  });
  cloudSync.configure(cloudConfig);
  if (persistLocal) {
    saveLocalCloudConfig();
    saveLocalUserPreferences();
  }
  updateCloudUi();
};

const saveCloudSetup = () => {
  const clientId = document.querySelector("#googleClientIdInput")?.value?.trim() || "";
  if (clientId && !validateGoogleClientId(clientId)) {
    showToast(
      "Google setup not saved",
      "The client ID must be a Google OAuth web client ID ending in apps.googleusercontent.com.",
      "!"
    );
    return false;
  }
  readCloudControls();
  recordHistory("preferences", "Updated Google Drive and profile settings");
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  showToast("Cloud setup saved", "The Google configuration is stored in this browser.");
  if (cloudSync.isConnected() && cloudConfig.autoSync) queueCloudSync();
  return true;
};

const captureCurrentProjectDefaults = () => {
  userSettings.projectDefaults = {
    referenceLayers: clone(state.currentProject.referenceLayers),
    graphicLabels: clone(state.currentProject.graphicLabels),
    graphicKeyItems: clone(state.currentProject.graphicKeyItems),
    editing: clone(state.currentProject.editing)
  };
  saveLocalUserSettings();
  recordHistory(
    "preferences",
    "Saved current map and graphic settings as new-closure defaults"
  );
  persist("User defaults saved");
  showToast(
    "Defaults saved",
    "New closures will use the current map layers, labels, key and route editing setting."
  );
};

const buildCloudBundle = () => ({
  profile: currentCloudProfile(),
  preferences: clone(userPreferences),
  settings: clone(userSettings),
  history: clone(state.history || []),
  state: {
    currentProject: clone(ensureProjectOptions(state.currentProject)),
    records: state.records.map((record) => clone(ensureProjectOptions(record))),
    ui: clone(state.ui || { lastView: currentView, lastStep: currentStep }),
    lastSavedAt: state.lastSavedAt
  }
});

const queueCloudSync = () => {
  if (!cloudSync.isConnected() || !cloudConfig.autoSync || cloudSyncInFlight) {
    return;
  }
  clearTimeout(cloudSyncTimer);
  cloudSyncTimer = window.setTimeout(() => {
    cloudSyncTimer = null;
    syncCloudWorkspace({ manual: false }).catch((error) => {
      console.warn("Automatic Google Drive sync failed", error);
    });
  }, 6000);
  updateCloudUi();
};

const syncCloudWorkspace = async ({ manual = true, allowBusy = false } = {}) => {
  if (cloudSyncInFlight && !allowBusy) return;
  if (!cloudSync.isConnected()) {
    throw new Error("Sign in with Google before syncing.");
  }
  clearTimeout(cloudSyncTimer);
  cloudSyncTimer = null;
  const previousBusyState = cloudSyncInFlight;
  cloudSyncInFlight = true;
  lastCloudStatus = {
    phase: "syncing",
    message: "Saving the local workspace to Google Drive"
  };
  updateCloudUi();
  try {
    const result = await cloudSync.syncBundle(buildCloudBundle());
    cloudConfig.lastSyncAt = result.syncedAt;
    cloudConfig.lastAccount = currentCloudProfile();
    saveLocalCloudConfig();
    pendingCloudBundle = null;
    if (manual) {
      recordHistory(
        "cloud",
        `Uploaded ${state.records.length} saved closure records to Google Drive`
      );
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      showToast(
        "Google Drive updated",
        `${result.fileCount} profile and workspace files were synchronised.`
      );
    }
    lastCloudStatus = {
      phase: "synced",
      message: `Google Drive synced at ${formatHistoryTime(result.syncedAt)}`
    };
    return result;
  } catch (error) {
    lastCloudStatus = {
      phase: "error",
      message: error.message || "Google Drive sync failed"
    };
    showToast(
      "Google Drive sync failed",
      error.message || "Reconnect Google and try again.",
      "!"
    );
    throw error;
  } finally {
    cloudSyncInFlight = previousBusyState;
    updateCloudUi();
  }
};

const mergeHistoryEntries = (left = [], right = []) => {
  const merged = new Map();
  [...left, ...right].forEach((entry) => {
    if (!entry) return;
    const key = entry.id || `${entry.at || ""}|${entry.message || entry.type || ""}`;
    const current = merged.get(key);
    if (!current || String(entry.at || "") > String(current.at || "")) {
      merged.set(key, clone(entry));
    }
  });
  return [...merged.values()]
    .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")))
    .slice(0, userSettings.historyLimit);
};

const applyCloudBundle = (bundle, { merge = false } = {}) => {
  if (!bundle?.workspace) {
    throw new Error("No Road Closure Studio workspace was found in Google Drive.");
  }
  suppressCloudQueue = true;
  try {
    if (bundle.preferences) {
      userPreferences = normalizeUserPreferences(bundle.preferences);
      saveLocalUserPreferences();
    }
    if (bundle.settings) {
      userSettings = normalizeUserSettings(bundle.settings);
      saveLocalUserSettings();
    }
    if (bundle.config) {
      cloudConfig = normalizeCloudConfig({
        ...cloudConfig,
        folderName: bundle.config.folderName || cloudConfig.folderName,
        autoSync: bundle.config.autoSync !== false,
        restoreOnConnect: bundle.config.restoreOnConnect === true,
        clientId: cloudConfig.clientId,
        lastAccount: currentCloudProfile()
      });
      saveLocalCloudConfig();
    }
    const workspace = merge
      ? mergeWorkspaceBundles(
          {
            currentProject: state.currentProject,
            records: state.records,
            lastSavedAt: state.lastSavedAt
          },
          bundle.workspace
        )
      : bundle.workspace;
    state.currentProject = ensureProjectOptions(clone(workspace.currentProject));
    state.records = (workspace.records || []).map((record) =>
      ensureProjectOptions(clone(record))
    );
    state.lastSavedAt = workspace.lastSavedAt || new Date().toISOString();
    state.ui = {
      lastView: workspace.ui?.lastView === "records" ? "records" : "editor",
      lastStep: Math.max(0, Math.min(3, Number(workspace.ui?.lastStep) || 0))
    };
    state.history = mergeHistoryEntries(state.history, bundle.history);
    pendingCloudBundle = null;
    recordHistory(
      "cloud",
      merge
        ? "Merged local and Google Drive workspaces"
        : "Loaded the Google Drive workspace into this browser"
    );
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } finally {
    suppressCloudQueue = false;
  }
  mount({
    view: userPreferences.startView,
    step: userPreferences.rememberLastStep ? state.ui?.lastStep || 0 : 0
  });
  showToast(
    merge ? "Workspaces merged" : "Drive workspace loaded",
    `${state.records.length} saved closure records are available in this browser.`
  );
};

const isLocalWorkspaceBlank = () =>
  state.records.length === 0 &&
  !state.currentProject.headline &&
  !state.currentProject.road &&
  (state.currentProject.features || []).length === 0;

const loadCloudWorkspace = async ({ force = false } = {}) => {
  if (!cloudSync.isConnected()) {
    throw new Error("Sign in with Google before loading Drive data.");
  }
  cloudSyncInFlight = true;
  updateCloudUi();
  try {
    const bundle = pendingCloudBundle || (await cloudSync.loadBundle());
    if (!bundle.workspace) {
      if (force) {
        throw new Error("No saved Google Drive workspace exists yet.");
      }
      return bundle;
    }
    applyCloudBundle(bundle, { merge: false });
    return bundle;
  } finally {
    cloudSyncInFlight = false;
    updateCloudUi();
  }
};

const mergeCloudWorkspace = async () => {
  if (!cloudSync.isConnected()) {
    throw new Error("Sign in with Google before merging.");
  }
  cloudSyncInFlight = true;
  updateCloudUi();
  try {
    const bundle = pendingCloudBundle || (await cloudSync.loadBundle());
    applyCloudBundle(bundle, { merge: true });
    await syncCloudWorkspace({ manual: false, allowBusy: true });
  } finally {
    cloudSyncInFlight = false;
    updateCloudUi();
  }
};

const connectGoogleDrive = async () => {
  const clientId = document.querySelector("#googleClientIdInput")?.value?.trim() || "";
  if (!validateGoogleClientId(clientId)) {
    showToast(
      "Google client ID required",
      "Add a valid OAuth web client ID and save the setup first.",
      "!"
    );
    openCloudDialog();
    return;
  }
  readCloudControls();
  try {
    cloudSyncInFlight = true;
    updateCloudUi();
    const connected = await cloudSync.connect({ prompt: "select_account" });
    cloudConfig.lastAccount = connected.profile;
    saveLocalCloudConfig();
    recordHistory(
      "cloud",
      `Connected Google Drive for ${connected.profile.email || connected.profile.name}`
    );
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    const bundle = await cloudSync.loadBundle();
    const cloudTime = Date.parse(bundle.workspace?.lastSavedAt || 0) || 0;
    const localTime = Date.parse(state.lastSavedAt || 0) || 0;
    if (!bundle.workspace) {
      pendingCloudBundle = null;
      await syncCloudWorkspace({ manual: false, allowBusy: true });
      showToast(
        "Google Drive connected",
        `Created ${cloudConfig.folderName} and saved the first workspace.`
      );
    } else if (
      isLocalWorkspaceBlank() ||
      (cloudConfig.restoreOnConnect && cloudTime > localTime + 1000)
    ) {
      applyCloudBundle(bundle, { merge: false });
    } else if (cloudTime > localTime + 1000) {
      pendingCloudBundle = bundle;
      lastCloudStatus = {
        phase: "connected",
        message: "A newer Google Drive workspace is available"
      };
      showToast(
        "Newer Drive workspace found",
        "Open Google Drive Sync to load, merge or keep the local copy.",
        "!"
      );
    } else if (localTime > cloudTime + 1000 && cloudConfig.autoSync) {
      await syncCloudWorkspace({ manual: false, allowBusy: true });
    }
  } catch (error) {
    console.error(error);
    lastCloudStatus = {
      phase: "error",
      message: error.message || "Google sign-in failed"
    };
    showToast(
      "Google sign-in failed",
      error.message || "Check the OAuth origin and try again.",
      "!"
    );
  } finally {
    cloudSyncInFlight = false;
    updateCloudUi();
  }
};

const disconnectGoogleDrive = () => {
  cloudSync.disconnect({ revoke: false });
  pendingCloudBundle = null;
  clearTimeout(cloudSyncTimer);
  cloudSyncTimer = null;
  recordHistory("cloud", "Disconnected the Google Drive session");
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  updateCloudUi();
  showToast(
    "Google disconnected",
    "Local drafts remain available. Sign in again to resume Drive sync."
  );
};

const loadRuntimeCloudConfig = async () => {
  if (runtimeCloudConfigLoaded) return;
  runtimeCloudConfigLoaded = true;
  try {
    const response = await fetch("./google-drive-config.json", {
      cache: "no-store"
    });
    if (!response.ok) return;
    const runtime = await response.json();
    if (!cloudConfig.clientId && validateGoogleClientId(runtime?.clientId)) {
      cloudConfig.clientId = String(runtime.clientId).trim();
    }
    if (runtime?.folderName && cloudConfig.folderName === DEFAULT_CLOUD_CONFIG.folderName) {
      cloudConfig.folderName = String(runtime.folderName).trim();
    }
    cloudSync.configure(cloudConfig);
    saveLocalCloudConfig();
    updateCloudUi();
  } catch (error) {
    console.warn("Optional Google Drive runtime configuration was not loaded", error);
  }
};

const attachCloudEvents = () => {
  document
    .querySelector("#cloudAccountBtn")
    ?.addEventListener("click", openCloudDialog);
  document
    .querySelector("#saveCloudSetupBtn")
    ?.addEventListener("click", saveCloudSetup);
  document
    .querySelector("#googleSignInBtn")
    ?.addEventListener("click", () => void connectGoogleDrive());
  document
    .querySelector("#cloudSyncNowBtn")
    ?.addEventListener("click", () => {
      void syncCloudWorkspace({ manual: true }).catch(() => {});
    });
  document
    .querySelector("#cloudLoadBtn")
    ?.addEventListener("click", () => {
      void loadCloudWorkspace({ force: true }).catch((error) => {
        showToast("Drive workspace not loaded", error.message, "!");
      });
    });
  document
    .querySelector("#cloudMergeBtn")
    ?.addEventListener("click", () => {
      void mergeCloudWorkspace().catch((error) => {
        showToast("Drive merge failed", error.message, "!");
      });
    });
  document
    .querySelector("#saveCurrentDefaultsBtn")
    ?.addEventListener("click", captureCurrentProjectDefaults);
  document
    .querySelector("#googleDisconnectBtn")
    ?.addEventListener("click", disconnectGoogleDrive);
  document.querySelectorAll("[data-close-cloud-dialog]").forEach((button) => {
    button.addEventListener("click", closeCloudDialog);
  });
  [
    "#cloudAutoSyncToggle",
    "#cloudRestoreToggle",
    "#cloudRememberStepToggle",
    "#cloudStartViewSelect",
    "#cloudDefaultFormatSelect",
    "#cloudDisplayNameInput"
  ].forEach((selector) => {
    document.querySelector(selector)?.addEventListener("change", () => {
      readCloudControls();
      if (cloudConfig.autoSync && cloudSync.isConnected()) queueCloudSync();
    });
  });
};

const mount = ({ view = "editor", step = 0 } = {}) => {
  mapController?.destroy();
  exportMapController?.destroy();
  routeService?.destroy();
  currentView = view;
  currentStep = step;
  manualPreviewScale = null;
  exploreResults = [];
  selectedExploreResult = null;
  detectedRouteResult =
    ensureRouting(state.currentProject).lastDetection?.result || null;
  app.innerHTML = renderAppShell(state.currentProject);
  attachEvents();
  attachCloudEvents();
  updateCloudUi();
  renderPublicationLabelEditor();
  renderMappedFeatureEditor();
  updateDetourRoadReferenceControl();
  initialiseMap();
  initialiseExportMap();
  initialiseRouteService();
  if (detectedRouteResult) renderRouteResults(detectedRouteResult);
  renderRouteDiagnostics();
  loadFarNorthLocationOptions();
  loadExploreDataStatus();
  updatePreview();
  renderRecords();
  showView(view);
  showStep(step);
};

const initialiseMap = () => {
  const mapElement = document.querySelector("#editorMap");
  if (!mapElement) return;
  mapController = new MapController(mapElement, state.currentProject, {
    onToolChange: updateMapToolStatus,
    onDraftChange: updateDraftActions,
    onFeatureCommitted: () => {
      updateFeatureUi();
      queuePersist();
      showToast("Map item added", "The export composition has been updated.");
    },
    onFeaturesChange: () => {
      updateFeatureUi();
      queuePersist();
    },
    onFeatureEdited: () => {
      updateFeatureUi();
      queuePersist();
    },
    onReferenceLayersRendered: updateReferenceLayerStatus,
    onSelectionChange: updateFeatureEditBar,
    onRouteEndpointChange: moveRouteEndpoint,
    onRouteStretch: rerouteDraggedFeature,
    snapPoint: async (point, feature) => {
      if (
        state.currentProject.editing?.stickToRoad === false ||
        ["note", "works"].includes(feature.type)
      ) {
        return point;
      }
      const nearest = await findNearestRoadPoint(point[0], point[1]);
      return nearest && nearest.distanceDegrees < 0.03
        ? [nearest.lat, nearest.lng]
        : point;
    },
    onViewChange: (view) => {
      Object.assign(state.currentProject, view);
      queuePersist();
    }
  });
};

const initialiseExportMap = () => {
  const mapElement = document.querySelector("#graphicLeafletMap");
  if (!mapElement) return;
  exportMapController = new ExportMapController(
    mapElement,
    state.currentProject,
    {
      onViewChange: (view) => {
        state.currentProject.publicationMap = { ...view };
        updateGraphicMapMode();
        queuePersist();
      },
      onFeatureLabelMove: (feature, position) => {
        feature.labelPosition = position;
        updatePublicationLabelPositionStatus(feature);
        queuePersist();
      },
      onReferenceLabelMove: ({ key, label, position }) => {
        state.currentProject.referenceLabelPositions[key] = position;
        const status = document.querySelector(
          "[data-reference-label-move-status]"
        );
        if (status) status.textContent = `${label} moved · saved for this graphic.`;
        const reset = document.querySelector(
          "#resetReferenceLabelPositionsBtn"
        );
        if (reset) reset.disabled = false;
        queuePersist();
      },
      onReferenceLayersRendered: updateReferenceLayerStatus
    }
  );
};

const initialiseRouteService = () => {
  routeService = new RouteService({
    onProgress: (message) => setRouteStatus(message, "busy")
  });
};

const routePoint = (point, label = "") => ({
  lat: Number(point[0]),
  lng: Number(point[1]),
  label
});

const routeFeatureThroughStops = async (
  feature,
  stops,
  { avoidRoadNames = [] } = {}
) => {
  if (!routeService || feature.coordinates?.length < 2 || !stops.length) {
    return null;
  }
  const points = [
    routePoint(feature.coordinates[0], "Route start"),
    ...stops.map((stop) => ({
      lat: Number(stop.lat),
      lng: Number(stop.lng),
      label: stop.road || stop.label || "Route stop"
    })),
    routePoint(feature.coordinates.at(-1), "Route end")
  ];
  const combinedCoordinates = [];
  const combinedRoadNames = [];
  const usedEdgeIds = [];
  const legs = [];
  let distanceKm = 0;
  const closureFeatures = state.currentProject.features
    .filter((item) => item.type === "closure")
    .map((item) => ({
      id: item.id,
      type: item.type,
      label: item.label,
      coordinates: clone(item.coordinates)
    }));

  for (let index = 1; index < points.length; index += 1) {
    const result = await routeService.findRoutes({
      start: points[index - 1],
      end: points[index],
      closureFeatures,
      avoidClosures: ensureRouting(state.currentProject).avoidClosures,
      preferHighways: ensureRouting(state.currentProject).preferHighways,
      alternatives: false,
      maxSnapMetres: 1200,
      avoidRoadNames,
      penalizeEdgeIds: usedEdgeIds
    });
    const leg = result?.routes?.[0];
    if (!leg?.coordinates?.length) {
      throw new Error(
        `No connected road route was found for stop ${index} (${points[index].label}).`
      );
    }
    leg.coordinates.forEach((coordinate) => {
      const previous = combinedCoordinates.at(-1);
      if (
        !previous ||
        previous[0] !== coordinate[0] ||
        previous[1] !== coordinate[1]
      ) {
        combinedCoordinates.push(coordinate);
      }
    });
    leg.roadNames?.forEach((roadName) => {
      if (combinedRoadNames.at(-1) !== roadName) {
        combinedRoadNames.push(roadName);
      }
    });
    usedEdgeIds.push(...(leg.edgeIds || []));
    distanceKm += Number(leg.distanceKm || 0);
    legs.push({
      start: clone(points[index - 1]),
      end: clone(points[index]),
      distanceKm: Number(leg.distanceKm || 0),
      roadNames: clone(leg.roadNames || []),
      coordinateCount: leg.coordinates.length,
      edgeCount: leg.edgeIds?.length || 0,
      diagnostics: clone(result.diagnostics || {})
    });
  }

  return {
    coordinates: combinedCoordinates,
    roadNames: combinedRoadNames,
    distanceKm,
    routeStops: stops.map((stop) => ({ ...stop })),
    avoidRoadNames: [...avoidRoadNames],
    legs
  };
};

const rerouteDraggedFeature = async ({
  feature,
  sourcePoint,
  targetPoint
}) => {
  if (
    state.currentProject.editing?.stickToRoad === false ||
    !["detour", "access"].includes(feature.type)
  ) {
    return null;
  }
  const [sourceRoad, targetRoad] = await Promise.all([
    findNearestRoadPoint(sourcePoint[0], sourcePoint[1]),
    findNearestRoadPoint(targetPoint[0], targetPoint[1])
  ]);
  if (
    !sourceRoad ||
    !targetRoad ||
    targetRoad.distanceDegrees >= 0.03 ||
    sourceRoad.name === targetRoad.name
  ) {
    return null;
  }

  const stop = {
    road: targetRoad.name,
    lat: targetRoad.lat,
    lng: targetRoad.lng
  };
  const existingStops = Array.isArray(feature.routeStops)
    ? feature.routeStops
    : [];
  const stops = [
    ...existingStops.filter(
      (item) =>
        item.road !== stop.road ||
        Math.hypot(item.lat - stop.lat, item.lng - stop.lng) > 0.0001
    ),
    stop
  ];
  const avoidRoadNames = [
    ...(Array.isArray(feature.avoidRoadNames)
      ? feature.avoidRoadNames
      : [])
  ];
  if (
    !sourceRoad.routeNumber &&
    !avoidRoadNames.some(
      (name) =>
        name.toLocaleLowerCase("en-NZ") ===
        sourceRoad.name.toLocaleLowerCase("en-NZ")
    )
  ) {
    avoidRoadNames.push(sourceRoad.name);
  }

  try {
    showToast(
      "Following the road network",
      `Routing via ${targetRoad.name}${avoidRoadNames.length ? `, away from ${sourceRoad.name}` : ""}.`,
      "↝"
    );
    const replacement = await routeFeatureThroughStops(feature, stops, {
      avoidRoadNames
    });
    if (!replacement) return null;
    feature.avoidRoadNames = replacement.avoidRoadNames;
    recordFeatureReroute({
      feature,
      replacement,
      operation: "drag-to-road"
    });
    showToast(
      "Route recalculated",
      `${replacement.distanceKm.toFixed(1)} km via ${targetRoad.name}.`
    );
    return replacement;
  } catch (error) {
    console.warn("Network reroute was not available; using local stretch.", error);
    showToast(
      "Used local stretch",
      `${error instanceof Error ? error.message : String(error)} The nearby section was stretched instead.`,
      "!"
    );
    return null;
  }
};

const attachEvents = () => {
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => showView(button.dataset.view));
  });

  document.querySelector("#recordsNewBtn")?.addEventListener("click", createNewProject);
  document.querySelector("#newProjectBtn")?.addEventListener("click", createNewProject);
  document.querySelector("#saveProjectBtn")?.addEventListener("click", saveCurrentRecord);

  document.querySelectorAll(".step-link").forEach((button) => {
    button.addEventListener("click", () => showStep(Number(button.dataset.step)));
  });
  document.querySelector("#backBtn")?.addEventListener("click", () => showStep(currentStep - 1));
  document.querySelector("#nextBtn")?.addEventListener("click", () => {
    if (currentStep === 3) {
      exportPng();
      return;
    }
    showStep(currentStep + 1);
  });

  document.querySelectorAll("[data-template]").forEach((button) => {
    button.addEventListener("click", () => applyTemplate(button.dataset.template));
  });

  document.querySelectorAll("[data-field]").forEach((field) => {
    const update = () => {
      const key = field.dataset.field;
      state.currentProject[key] =
        field.type === "number" ? Number(field.value) : field.value;
      if (key === "road") {
        refreshDemoLabels(state.currentProject.area, state.currentProject.road);
        mapController?.renderFeatures();
        renderPublicationLabelEditor();
        renderMappedFeatureEditor();
      }
      document.querySelectorAll(`[data-field="${key}"]`).forEach((sibling) => {
        if (sibling !== field && sibling.value !== field.value) sibling.value = field.value;
      });
      const count = document.querySelector(`[data-count-for="${key}"]`);
      if (count) count.textContent = field.value.length;
      updatePreview();
      queuePersist();
    };
    field.addEventListener("input", update);
    field.addEventListener("change", update);
  });

  document.querySelector("#goLocationBtn")?.addEventListener("click", goToPreset);
  document.querySelector("#locationPreset")?.addEventListener("change", goToPreset);
  document
    .querySelector("#runExploreSearchBtn")
    ?.addEventListener("click", runExploreSearch);
  document
    .querySelector("#exploreSearchInput")
    ?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        runExploreSearch();
      }
    });
  document.querySelectorAll("[data-explore-type]").forEach((button) => {
    button.addEventListener("click", () => {
      exploreType = button.dataset.exploreType;
      document.querySelectorAll("[data-explore-type]").forEach((item) => {
        item.classList.toggle("active", item === button);
      });
      if (document.querySelector("#exploreSearchInput")?.value.trim()) {
        runExploreSearch();
      }
    });
  });
  document
    .querySelector("#exploreResults")
    ?.addEventListener("click", handleExploreResultClick);

  document.querySelectorAll("[data-map-tool]").forEach((button) => {
    button.addEventListener("click", () => {
      document
        .querySelectorAll("[data-map-tool]")
        .forEach((item) => item.classList.toggle("active", item === button));
      mapController.setTool(button.dataset.mapTool);
    });
  });
  document.querySelector("#undoPointBtn")?.addEventListener("click", () => mapController.undoPoint());
  document.querySelector("#finishDrawingBtn")?.addEventListener("click", () => mapController.finishDrawing());
  document.querySelector("#finishEditingBtn")?.addEventListener("click", () => {
    mapController?.clearSelection();
    mapController?.setTool("pan");
    document.querySelectorAll("[data-map-tool]").forEach((item) => {
      item.classList.toggle("active", item.dataset.mapTool === "pan");
    });
  });
  document.querySelector("#stickToRoadInput")?.addEventListener("change", (event) => {
    ensureProjectOptions(state.currentProject).editing.stickToRoad =
      event.target.checked;
    queuePersist();
    showToast(
      event.target.checked ? "Road snapping on" : "Road snapping off",
      event.target.checked
        ? "Moved route sections will pull smoothly and magnetically follow the nearest bundled roads."
        : "Route points can now be positioned freely."
    );
  });
  document.querySelector("#clearMapBtn")?.addEventListener("click", () => {
    if (!state.currentProject.features.length) return;
    if (window.confirm("Remove every mapped overlay from this draft?")) {
      mapController.clearFeatures();
      showToast("Map cleared", "All mapped overlays were removed.", "−");
    }
  });
  document.querySelector("#importGeoJsonBtn")?.addEventListener("click", () => {
    document.querySelector("#geojsonInput")?.click();
  });
  document.querySelector("#geojsonInput")?.addEventListener("change", importGeoJson);
  document.querySelector("#exportGeoJsonBtn")?.addEventListener("click", exportGeoJson);
  document.querySelector("#publishGeoJsonBtn")?.addEventListener("click", exportGeoJson);

  document.querySelectorAll("[data-route-map-centre]").forEach((button) => {
    button.addEventListener("click", () =>
      setRouteEndpointFromMap(button.dataset.routeMapCentre)
    );
  });
  document
    .querySelector("#avoidClosuresInput")
    ?.addEventListener("change", (event) => {
      ensureRouting(state.currentProject).avoidClosures = event.target.checked;
      queuePersist();
    });
  document
    .querySelector("#preferHighwaysInput")
    ?.addEventListener("change", (event) => {
      ensureRouting(state.currentProject).preferHighways = event.target.checked;
      queuePersist();
    });
  document
    .querySelector("#includeAlternativesInput")
    ?.addEventListener("change", (event) => {
      ensureRouting(state.currentProject).includeAlternatives =
        event.target.checked;
      queuePersist();
    });
  document
    .querySelector("#includeNetworkRoutesInput")
    ?.addEventListener("change", (event) => {
      ensureRouting(state.currentProject).includeNetworkRoutesInGeoJson =
        event.target.checked;
      queuePersist();
    });
  document
    .querySelector("#detectRouteBtn")
    ?.addEventListener("click", detectRoute);
  document
    .querySelector("#downloadRouteDiagnosticsBtn")
    ?.addEventListener("click", downloadRouteDiagnostics);
  document.querySelector("#swapRouteBtn")?.addEventListener("click", swapRoute);
  document.querySelector("#clearRouteBtn")?.addEventListener("click", clearRoute);
  document
    .querySelector("#routeResults")
    ?.addEventListener("click", handleRouteResultClick);
  document.querySelectorAll("[data-route-endpoint-label]").forEach((input) => {
    input.addEventListener("input", handleRouteEndpointLabelInput);
  });
  document
    .querySelector("#mappedFeatureList")
    ?.addEventListener("input", handleMappedFeatureInput);
  document
    .querySelector("#mappedFeatureList")
    ?.addEventListener("click", handleMappedFeatureAction);

  document.querySelectorAll("[data-format]").forEach((button) => {
    button.addEventListener("click", () => setFormat(button.dataset.format));
  });
  document.querySelectorAll("[data-status]").forEach((button) => {
    button.addEventListener("click", () => {
      state.currentProject.status = button.dataset.status;
      document
        .querySelectorAll("[data-status]")
        .forEach((item) => item.classList.toggle("active", item === button));
      updatePreview();
      queuePersist();
    });
  });
  document.querySelector("#zoomInBtn")?.addEventListener("click", () => changePreviewZoom(0.1));
  document.querySelector("#zoomOutBtn")?.addEventListener("click", () => changePreviewZoom(-0.1));
  document
    .querySelector("#graphicMapZoomInBtn")
    ?.addEventListener("click", () => exportMapController?.zoomIn());
  document
    .querySelector("#graphicMapZoomOutBtn")
    ?.addEventListener("click", () => exportMapController?.zoomOut());
  document
    .querySelector("#graphicMapResetBtn")
    ?.addEventListener("click", () => exportMapController?.resetView());
  document.querySelectorAll("[data-graphic-label]").forEach((input) => {
    input.addEventListener("change", () => {
      ensureProjectOptions(state.currentProject).graphicLabels[
        input.dataset.graphicLabel
      ] = input.checked;
      updatePreview();
      queuePersist();
    });
  });
  document.querySelectorAll("[data-key-item-visible]").forEach((input) => {
    input.addEventListener("change", () => {
      ensureProjectOptions(state.currentProject).graphicKeyItems[
        input.dataset.keyItemVisible
      ].visible = input.checked;
      renderGraphicMap();
      queuePersist();
    });
  });
  document.querySelectorAll("[data-key-item-label]").forEach((input) => {
    input.addEventListener("input", () => {
      ensureProjectOptions(state.currentProject).graphicKeyItems[
        input.dataset.keyItemLabel
      ].label = input.value;
      renderGraphicMap();
      queuePersist();
    });
  });
  document.querySelectorAll("[data-key-item-colour]").forEach((input) => {
    input.addEventListener("input", () => {
      ensureProjectOptions(state.currentProject).graphicKeyItems[
        input.dataset.keyItemColour
      ].color = input.value;
      renderGraphicMap();
      queuePersist();
    });
  });
  document
    .querySelector("#publicationLabelList")
    ?.addEventListener("input", handlePublicationLabelInput);
  document
    .querySelector("#publicationLabelList")
    ?.addEventListener("click", handlePublicationLabelAction);
  document.querySelectorAll("[data-reference-layer-toggle]").forEach((input) => {
    input.addEventListener("change", () => {
      const key = input.dataset.referenceLayerToggle;
      const settings = ensureReferenceLayers(state.currentProject);
      settings[key].visible = input.checked;
      document
        .querySelectorAll(`[data-reference-layer-toggle="${key}"]`)
        .forEach((sibling) => {
          sibling.checked = input.checked;
        });
      refreshReferenceLayers();
      queuePersist();
    });
  });
  document.querySelectorAll("[data-reference-layer-zoom]").forEach((select) => {
    select.addEventListener("change", () => {
      const key = select.dataset.referenceLayerZoom;
      const settings = ensureReferenceLayers(state.currentProject);
      settings[key].minZoom = Math.max(
        6,
        Math.min(19, Number(select.value) || settings[key].minZoom)
      );
      document
        .querySelectorAll(`[data-reference-layer-zoom="${key}"]`)
        .forEach((sibling) => {
          sibling.value = String(settings[key].minZoom);
        });
      refreshReferenceLayers();
      queuePersist();
    });
  });
  document
    .querySelectorAll("[data-reference-detour-roads-only]")
    .forEach((input) => {
      input.addEventListener("change", () => {
        const settings = ensureReferenceLayers(state.currentProject);
        settings.roadNames.detourRoadsOnly = input.checked;
        if (input.checked) settings.roadNames.visible = true;
        document
          .querySelectorAll('[data-reference-layer-toggle="roadNames"]')
          .forEach((toggle) => {
            toggle.checked = settings.roadNames.visible;
          });
        refreshReferenceLayers();
        queuePersist();
      });
    });
  document.querySelectorAll("[data-reference-surface]").forEach((section) => {
    section.addEventListener("input", (event) => {
      const input = event.target.closest("[data-reference-layer-filter]");
      if (!input) return;
      const key = input.dataset.referenceLayerFilter;
      const settings = ensureReferenceLayers(state.currentProject);
      settings[key].filterText = input.value;
      document
        .querySelectorAll(`[data-reference-layer-filter="${key}"]`)
        .forEach((sibling) => {
          if (sibling !== input) sibling.value = input.value;
        });
      clearTimeout(referenceFilterTimer);
      referenceFilterTimer = setTimeout(refreshReferenceLayers, 180);
      queuePersist();
    });
    section.addEventListener("change", (event) => {
      const choice = event.target.closest("[data-reference-choice]");
      if (!choice) return;
      const key = choice.dataset.referenceChoice;
      const id = choice.value;
      const settings = ensureReferenceLayers(state.currentProject);
      const selected = new Set(settings[key].selectedIds || []);
      if (choice.checked) selected.add(id);
      else selected.delete(id);
      settings[key].selectedIds = [...selected];
      refreshReferenceLayers();
      queuePersist();
    });
    section.addEventListener("click", (event) => {
      const clear = event.target.closest("[data-clear-reference-selection]");
      if (!clear) return;
      const key = clear.dataset.clearReferenceSelection;
      ensureReferenceLayers(state.currentProject)[key].selectedIds = [];
      refreshReferenceLayers();
      queuePersist();
    });
  });
  document
    .querySelector("#resetReferenceLabelPositionsBtn")
    ?.addEventListener("click", () => {
      state.currentProject.referenceLabelPositions = {};
      exportMapController?.resetReferenceLabelPositions();
      const status = document.querySelector(
        "[data-reference-label-move-status]"
      );
      if (status) status.textContent = "Reference labels returned to their GIS positions.";
      const reset = document.querySelector("#resetReferenceLabelPositionsBtn");
      if (reset) reset.disabled = true;
      queuePersist();
    });
  document.querySelector("#exportPngBtn")?.addEventListener("click", exportPng);
  document.querySelector("#exportClosuresBtn")?.addEventListener("click", exportClosures);
  document.querySelector("#importClosuresBtn")?.addEventListener("click", () => {
    document.querySelector("#closuresInput")?.click();
  });
  document.querySelector("#closuresInput")?.addEventListener("change", importClosures);

  document.querySelector("#recordSearch")?.addEventListener("input", (event) => {
    recordQuery = event.target.value.trim().toLowerCase();
    renderRecords();
  });
  document.querySelectorAll("[data-record-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      recordFilter = button.dataset.recordFilter;
      document
        .querySelectorAll("[data-record-filter]")
        .forEach((item) => item.classList.toggle("active", item === button));
      renderRecords();
    });
  });

  document.querySelector("#helpBtn")?.addEventListener("click", () => {
    document.querySelector("#helpDialog")?.showModal();
  });
  document.querySelector("[data-close-dialog]")?.addEventListener("click", () => {
    document.querySelector("#helpDialog")?.close();
  });

};

const handleResize = () => {
  if (currentStep === 3) fitGraphic();
  mapController?.map.invalidateSize();
};

const showView = (view) => {
  currentView = view;
  document
    .querySelectorAll(".view-panel")
    .forEach((panel) => panel.classList.toggle("active", panel.id === `${view}View`));
  document
    .querySelectorAll(".rail-item[data-view]")
    .forEach((item) => item.classList.toggle("active", item.dataset.view === view));
  if (view === "editor") setTimeout(() => mapController?.map.invalidateSize(), 30);
  if (view === "records") renderRecords();
  saveUiPosition();
};

const showStep = (step) => {
  currentStep = Math.max(0, Math.min(3, step));
  document
    .querySelector(".step-content")
    ?.classList.toggle("publish-active", currentStep === 3);
  document.querySelectorAll("[data-step-panel]").forEach((panel) => {
    panel.classList.toggle("active", Number(panel.dataset.stepPanel) === currentStep);
  });
  document.querySelectorAll(".step-link").forEach((button) => {
    const buttonStep = Number(button.dataset.step);
    button.classList.toggle("active", buttonStep === currentStep);
    button.classList.toggle("completed", buttonStep < currentStep);
  });

  const labels = ["Map the location", "Add timing", "Review graphic", "Export PNG"];
  const back = document.querySelector("#backBtn");
  const next = document.querySelector("#nextBtn");
  if (back) back.disabled = currentStep === 0;
  if (next) {
    next.innerHTML =
      currentStep === 3
        ? `<span aria-hidden="true">↓</span> Export PNG`
        : `${labels[currentStep]} <span aria-hidden="true">→</span>`;
  }
  const counter = document.querySelector("#stepCounter");
  if (counter) counter.textContent = `Step ${currentStep + 1} of 4`;

  document.querySelector(".step-content")?.scrollTo({ top: 0, behavior: "smooth" });
  if (currentStep === 1) {
    setTimeout(() => {
      mapController?.map.invalidateSize();
      mapController?.renderReferenceLayers();
    }, 40);
  }
  if (currentStep === 3) {
    updatePreview();
    setTimeout(() => {
      fitGraphic();
      exportMapController?.render(state.currentProject);
    }, 40);
  }
  saveUiPosition();
};

const applyTemplate = (key) => {
  const template = templates[key];
  if (!template) return;
  state.currentProject.template = key;
  Object.entries(template).forEach(([field, value]) => {
    if (field !== "label") state.currentProject[field] = value;
  });
  document.querySelectorAll("[data-template]").forEach((button) => {
    const selected = button.dataset.template === key;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-checked", selected ? "true" : "false");
  });
  hydrateFieldValues();
  updatePreview();
  queuePersist();
  showToast(`${template.label} template applied`, "You can refine every field below.");
};

const hydrateFieldValues = () => {
  document.querySelectorAll("[data-field]").forEach((field) => {
    const value = state.currentProject[field.dataset.field] ?? "";
    field.value = value;
    const count = document.querySelector(`[data-count-for="${field.dataset.field}"]`);
    if (count) count.textContent = String(value).length;
  });
};

const loadFarNorthLocationOptions = async () => {
  const sequence = ++locationLoadSequence;
  const group = document.querySelector("#farNorthLocationOptions");
  const status = document.querySelector("#locationDataStatus");
  const select = document.querySelector("#locationPreset");
  if (!group || !select) return;

  try {
    const places = await loadFarNorthPlaces();
    if (sequence !== locationLoadSequence || !document.body.contains(group)) return;
    locationCatalog = [...nzLocations, ...places];
    group.replaceChildren();
    places.forEach((location) => {
      const option = document.createElement("option");
      option.value = location.id;
      option.textContent = `${location.name} · ${location.type}`;
      group.appendChild(option);
    });
    const selected = places.find(
      (location) =>
        location.name === state.currentProject.area &&
        Math.abs(location.lat - Number(state.currentProject.lat)) < 0.01 &&
        Math.abs(location.lng - Number(state.currentProject.lng)) < 0.01
    );
    if (selected) select.value = selected.id;
    if (status) {
      status.textContent = `${places.length} Far North towns, localities and places loaded from project GIS data`;
    }
  } catch (error) {
    console.error(error);
    if (status) status.textContent = "Far North placenames could not be loaded";
    group.replaceChildren();
    const option = document.createElement("option");
    option.disabled = true;
    option.textContent = "Far North GIS unavailable";
    group.appendChild(option);
  }
};

const loadExploreDataStatus = async () => {
  const status = document.querySelector("#exploreDataStatus");
  try {
    const catalog = await loadExploreCatalog();
    routeRoadCatalog = catalog.roads;
    const roadNames = document.querySelector("#farNorthRoadNames");
    if (roadNames) {
      roadNames.replaceChildren(
        ...catalog.roads.map((road) => {
          const option = document.createElement("option");
          option.value = road.title;
          return option;
        })
      );
    }
    if (!status || !document.body.contains(status)) return;
    status.textContent = `${catalog.counts.roads.toLocaleString("en-NZ")} roads · ${catalog.counts.addresses.toLocaleString("en-NZ")} addresses · ${catalog.counts.areas.toLocaleString("en-NZ")} areas`;
  } catch (error) {
    console.error(error);
    if (status) status.textContent = "Far North search indexes could not be loaded";
  }
};

const renderExploreResults = (
  results,
  { message = "", tone = "muted" } = {}
) => {
  const container = document.querySelector("#exploreResults");
  if (!container) return;
  if (!results.length) {
    container.innerHTML = `
      <div class="explore-empty ${tone}">
        <span aria-hidden="true">${tone === "busy" ? "…" : "⌕"}</span>
        <p>${escapeHtml(message || "No matching Far North locations were found.")}</p>
      </div>`;
    return;
  }
  container.innerHTML = results
    .map(
      (result, index) => `
        <article class="explore-result ${selectedExploreResult?.id === result.id ? "selected" : ""}" data-explore-index="${index}">
          <button class="explore-result-focus" data-explore-action="focus" type="button">
            <span class="explore-result-icon ${result.type}" aria-hidden="true">${result.type === "road" ? "↝" : result.type === "address" ? "⌂" : "◇"}</span>
            <span>
              <small>${escapeHtml(result.typeLabel)}</small>
              <strong>${escapeHtml(result.title)}</strong>
              <em>${escapeHtml(result.subtitle || "Far North GIS")}</em>
            </span>
          </button>
          <div class="explore-result-actions">
            <button data-explore-action="use" type="button">Use location</button>
            <button data-explore-action="start" type="button" aria-label="Use ${escapeHtml(result.title)} as route start">Set A</button>
            <button data-explore-action="end" type="button" aria-label="Use ${escapeHtml(result.title)} as route destination">Set B</button>
            <select class="explore-feature-action" aria-label="Choose how to use ${escapeHtml(result.title)} on the map">
              ${result.type === "road" ? `
                <option value="closure-road">Whole road as closure</option>
                <option value="detour-road">Whole road as detour</option>
                <option value="access-road">Whole road as access</option>` : ""}
              <option value="closure-start">Closure start</option>
              <option value="closure-end">Closure end</option>
              <option value="detour-start">Detour start</option>
              <option value="detour-end">Detour end</option>
              <option value="access-start">Access start</option>
              <option value="access-end">Access end</option>
              <option value="works">Works location</option>
              <option value="note">Map note</option>
            </select>
            <button data-explore-action="feature" type="button">Add to map</button>
          </div>
        </article>`
    )
    .join("");
};

const runExploreSearch = async () => {
  const input = document.querySelector("#exploreSearchInput");
  const query = input?.value.trim() || "";
  const sequence = ++exploreSearchSequence;
  if (!query) {
    exploreResults = [];
    renderExploreResults([], {
      message: "Type a road, address or area before searching."
    });
    input?.focus();
    return;
  }
  renderExploreResults([], {
    message: "Searching the bundled Far North GIS indexes…",
    tone: "busy"
  });
  try {
    const results = await searchExplore(query, {
      type: exploreType,
      limit: 30
    });
    if (sequence !== exploreSearchSequence) return;
    exploreResults = results;
    renderExploreResults(results, {
      message: `No ${exploreType === "all" ? "" : `${exploreType} `}matches for “${query}”.`
    });
  } catch (error) {
    console.error(error);
    if (sequence !== exploreSearchSequence) return;
    exploreResults = [];
    renderExploreResults([], {
      message: "The local GIS search could not be completed."
    });
  }
};

const focusExploreResult = (result) => {
  if (!result) return;
  selectedExploreResult = result;
  renderExploreResults(exploreResults);
  mapController?.focusReferenceFeature(result);
};

const applyExploreLocation = async (result) => {
  if (!result) return;
  translateDemoFeatures(result);
  const project = state.currentProject;
  project.lat = Number(result.lat);
  project.lng = Number(result.lng);
  project.zoom = Number(result.zoom) || (result.type === "address" ? 18 : 15);
  project.publicationMap = {
    manual: false,
    lat: null,
    lng: null,
    zoom: null
  };
  if (result.type === "area") {
    project.area = result.area || result.title;
    project.locationDetail = `${result.title}, Far North District`;
    project.areaGeometry = result.geometry || null;
  } else if (result.type === "address") {
    project.areaGeometry = null;
    project.area = result.area || result.town || "Far North District";
    project.road = result.road || project.road;
    project.locationDetail = result.title;
  } else {
    project.areaGeometry = null;
    project.area =
      project.area && project.area !== "Paraparaumu"
        ? project.area
        : "Far North District";
    project.road = result.road || result.title;
    project.locationDetail = `${result.title}, Far North District`;
  }
  if (result.routeNumber) {
    project.routeNumber = result.routeNumber;
  } else if (/^SH\s*\d+/i.test(project.road)) {
    project.routeNumber = project.road.match(/\d+[A-Z]?/i)?.[0] || "SH";
  } else if (!project.routeNumber || project.routeNumber === "1") {
    project.routeNumber = "RD";
  }
  refreshDemoLabels(project.area, project.road);
  hydrateFieldValues();
  mapController?.renderFeatures();
  mapController?.focusReferenceFeature(result);
  updatePreview();
  queuePersist();

  const status = document.querySelector("#locationDataStatus");
  if (status) {
    status.textContent = `${result.typeLabel} selected from Far North GIS: ${result.title}`;
  }
  showToast("GIS location selected", `${result.title} is now the mapped location.`);
};

const setRouteEndpoint = (kind, result) => {
  if (!["start", "end"].includes(kind) || !result) return;
  const routing = ensureRouting(state.currentProject);
  routing[kind] = {
    id: result.id || `${kind}:${Date.now()}`,
    label: result.title || result.label || "Map point",
    type: result.type || "map",
    lat: Number(result.lat),
    lng: Number(result.lng),
    networkMatched: result.networkMatched !== false,
    labelCustom: false
  };
  updateRouteUi();
  mapController?.renderRouteEndpoints(routing);
  setRouteStatus(
    routing[kind].networkMatched
      ? `${kind === "start" ? "Start" : "Destination"} set to ${routing[kind].label}.`
      : `${routing[kind].label} is searchable, but its road ID is absent from trimmed roads v3; routing will snap to the nearest available segment.`,
    routing[kind].networkMatched ? "ok" : "error"
  );
  queuePersist();
};

const moveRouteEndpoint = async (kind, point) => {
  const routing = ensureRouting(state.currentProject);
  if (!routing[kind]) return;
  const preserveLabel = routing[kind].labelCustom === true;
  routing[kind] = {
    ...routing[kind],
    id: `moved:${kind}:${Date.now()}`,
    lat: Number(point.lat),
    lng: Number(point.lng),
    label: preserveLabel
      ? routing[kind].label
      : `Moved ${kind === "start" ? "A" : "B"} pin`,
    labelCustom: preserveLabel
  };
  try {
    const nearest = await findNearestRoad(point.lat, point.lng);
    if (!preserveLabel && nearest && nearest.distanceDegrees < 0.03) {
      routing[kind].label = `${nearest.name} · moved ${kind === "start" ? "A" : "B"}`;
    }
  } catch (error) {
    console.error(error);
  }
  detectedRouteResult = null;
  updateRouteUi();
  mapController?.renderRouteEndpoints(routing);
  setRouteStatus(
    `${kind === "start" ? "Start A" : "Destination B"} moved. Detect the route again to use the new position.`,
    "ok"
  );
  queuePersist();
};

const geometryLinesToFeatures = (result, type) => {
  const geometry = result.geometry;
  const lines =
    geometry?.type === "LineString"
      ? [geometry.coordinates]
      : geometry?.type === "MultiLineString"
        ? geometry.coordinates
        : [];
  return lines
    .filter((line) => line.length >= 2)
    .map((line, index) => ({
      id: `feature-explore-${Date.now()}-${index}`,
      type,
      label: `${result.title} · ${featureStyles[type].label}`,
      labelMode: type === "closure" ? "auto" : "custom",
      labelPosition: null,
      sourceResultId: result.id,
      coordinates: line.map(([lng, lat]) => [
        Number(Number(lat).toFixed(7)),
        Number(Number(lng).toFixed(7))
      ])
    }));
};

const applyExploreFeatureAction = async (result, action) => {
  if (!result || !action) return;
  const project = ensureProjectOptions(state.currentProject);
  focusExploreResult(result);

  if (action.endsWith("-road")) {
    const type = action.replace("-road", "");
    const features = geometryLinesToFeatures(result, type);
    if (!features.length) {
      showToast("Road geometry unavailable", "Choose start and end instead.", "!");
      return;
    }
    project.features.push(...features);
    mapController?.renderFeatures();
    mapController?.fitFeatures();
    updateFeatureUi();
    queuePersist();
    showToast(
      "Road added to map",
      `${result.title} was added as ${featureStyles[type].label.toLowerCase()}.`
    );
    return;
  }

  if (action === "works" || action === "note") {
    project.features.push({
      id: `feature-explore-${Date.now()}`,
      type: action,
      label:
        action === "works"
          ? `Works location · ${result.title}`
          : `${result.typeLabel} note · ${result.title}`,
      labelMode: "custom",
      labelPosition: null,
      sourceResultId: result.id,
      coordinates: [[Number(result.lat), Number(result.lng)]]
    });
    if (result.type === "area") {
      project.areaGeometry = result.geometry || null;
    }
    mapController?.renderFeatures();
    updateFeatureUi();
    queuePersist();
    showToast(
      action === "works" ? "Works location added" : "Map note added",
      `${result.title} is now part of the graphic.`
    );
    return;
  }

  const match = action.match(/^(closure|detour|access)-(start|end)$/);
  if (!match) return;
  const [, type, endpoint] = match;
  let point = [Number(result.lat), Number(result.lng)];
  if (project.editing.stickToRoad) {
    const nearest = await findNearestRoadPoint(point[0], point[1], {
      roadName: result.type === "road" ? result.road : ""
    });
    if (nearest) point = [nearest.lat, nearest.lng];
  }
  project.featureDrafts[type][endpoint] = {
    id: result.id,
    label: result.title,
    coordinates: point
  };
  const draft = project.featureDrafts[type];
  if (!draft.start || !draft.end) {
    queuePersist();
    showToast(
      `${featureStyles[type].label} ${endpoint} set`,
      `Choose the ${endpoint === "start" ? "end" : "start"} point from any road, address or area result.`
    );
    return;
  }

  project.features.push({
    id: `feature-explore-${Date.now()}`,
    type,
    label: `${featureStyles[type].label} · ${draft.start.label} to ${draft.end.label}`,
    labelMode: type === "closure" ? "auto" : "custom",
    labelPosition: null,
    coordinates: [draft.start.coordinates, draft.end.coordinates],
    sourceResultIds: [draft.start.id, draft.end.id]
  });
  project.featureDrafts[type] = { start: null, end: null };
  mapController?.renderFeatures();
  mapController?.fitFeatures();
  updateFeatureUi();
  queuePersist();
  showToast(
    `${featureStyles[type].label} added`,
    "Use Edit routes to move it, add points or reshape it."
  );
};

const handleExploreResultClick = (event) => {
  const row = event.target.closest("[data-explore-index]");
  if (!row) return;
  const result = exploreResults[Number(row.dataset.exploreIndex)];
  if (!result) return;
  const action = event.target.closest("[data-explore-action]")?.dataset
    .exploreAction;
  if (action === "use") {
    applyExploreLocation(result);
  } else if (action === "start" || action === "end") {
    focusExploreResult(result);
    setRouteEndpoint(action, result);
  } else if (action === "feature") {
    const selection = row.querySelector(".explore-feature-action")?.value;
    applyExploreFeatureAction(result, selection);
  } else {
    focusExploreResult(result);
  }
};

const translateDemoFeatures = (location) => {
  const features = state.currentProject.features;
  const demoOnly =
    features.length > 0 && features.every((feature) => feature.id.includes("-demo"));
  if (!demoOnly) return;
  const latDelta = Number(location.lat) - Number(state.currentProject.lat);
  const lngDelta = Number(location.lng) - Number(state.currentProject.lng);
  features.forEach((feature) => {
    feature.coordinates = feature.coordinates.map(([lat, lng]) => [
      Number((lat + latDelta).toFixed(6)),
      Number((lng + lngDelta).toFixed(6))
    ]);
    if (Array.isArray(feature.labelPosition)) {
      feature.labelPosition = [
        Number((feature.labelPosition[0] + latDelta).toFixed(6)),
        Number((feature.labelPosition[1] + lngDelta).toFixed(6))
      ];
    }
  });
};

const refreshDemoLabels = (locationName, roadName) => {
  const roadLabel = String(roadName || "").trim();
  state.currentProject.features.forEach((feature) => {
    if (feature.labelMode === "custom") return;
    if (feature.type === "closure") {
      feature.label = roadLabel ? `${roadLabel} closure` : "Road closure";
    }
    if (!String(feature.id || "").includes("-demo")) return;
    if (feature.type === "detour") feature.label = "Signed detour";
    if (feature.type === "note") {
      feature.label = locationName
        ? `Travel information · ${locationName}`
        : "Travel information";
    }
  });
  renderPublicationLabelEditor();
};

const goToPreset = async () => {
  const selectedValue = document.querySelector("#locationPreset")?.value;
  const location = locationCatalog.find(
    (item) => item.id === selectedValue || item.name === selectedValue
  );
  if (!location) return;
  translateDemoFeatures(location);
  state.currentProject.area = location.name;
  if (location.road) {
    state.currentProject.road = location.road;
    state.currentProject.routeNumber =
      location.road.replace(/\D/g, "") || location.road;
  }
  state.currentProject.lat = location.lat;
  state.currentProject.lng = location.lng;
  state.currentProject.zoom = location.zoom;
  state.currentProject.areaGeometry = null;
  state.currentProject.publicationMap = {
    manual: false,
    lat: null,
    lng: null,
    zoom: null
  };
  refreshDemoLabels(location.name, state.currentProject.road);
  hydrateFieldValues();
  mapController.renderFeatures();
  mapController.centreOn(location);
  updatePreview();
  queuePersist();

  if (location.source === "Far North GIS") {
    const status = document.querySelector("#locationDataStatus");
    if (status) status.textContent = `Locating the nearest mapped road to ${location.name}…`;
    try {
      const nearest = await findNearestRoad(location.lat, location.lng);
      const stillSelected =
        state.currentProject.area === location.name &&
        Math.abs(Number(state.currentProject.lat) - location.lat) < 0.000001;
      if (nearest && stillSelected && nearest.distanceDegrees < 0.08) {
        state.currentProject.road = nearest.name;
        state.currentProject.routeNumber = nearest.routeNumber || "RD";
        state.currentProject.locationDetail = `${nearest.name}, ${location.name}`;
        refreshDemoLabels(location.name, nearest.name);
        mapController.renderFeatures();
        hydrateFieldValues();
        updatePreview();
        queuePersist();
        if (status) {
          status.textContent = `${location.name} positioned from GIS · nearest mapped road: ${nearest.name}`;
        }
      }
    } catch (error) {
      console.error(error);
      if (status) status.textContent = `${location.name} positioned from Far North GIS`;
    }
  }
};

const updateRouteUi = () => {
  const routing = ensureRouting(state.currentProject);
  const start = document.querySelector("#routeStartSummary");
  const end = document.querySelector("#routeEndSummary");
  if (start) start.textContent = routing.start?.label || "Not set";
  if (end) end.textContent = routing.end?.label || "Not set";
  const avoid = document.querySelector("#avoidClosuresInput");
  const prefer = document.querySelector("#preferHighwaysInput");
  const alternatives = document.querySelector("#includeAlternativesInput");
  if (avoid) avoid.checked = routing.avoidClosures;
  if (prefer) prefer.checked = routing.preferHighways;
  if (alternatives) alternatives.checked = routing.includeAlternatives;
  ["start", "end"].forEach((kind) => {
    const input = document.querySelector(
      `[data-route-endpoint-label="${kind}"]`
    );
    if (!input) return;
    input.disabled = !routing[kind];
    input.value = routing[kind]?.label || "";
  });
};

const handleRouteEndpointLabelInput = (event) => {
  const kind = event.target.dataset.routeEndpointLabel;
  const routing = ensureRouting(state.currentProject);
  if (!["start", "end"].includes(kind) || !routing[kind]) return;
  routing[kind].label = event.target.value;
  routing[kind].labelCustom = true;
  const summary = document.querySelector(
    kind === "start" ? "#routeStartSummary" : "#routeEndSummary"
  );
  if (summary) summary.textContent = event.target.value || "Unnamed pin";
  mapController?.renderRouteEndpoints(routing);
  queuePersist();
};

const setRouteStatus = (message, tone = "muted") => {
  const status = document.querySelector("#routeStatus");
  if (!status) return;
  status.textContent = message;
  status.dataset.tone = tone;
};

const createRouteDiagnosticRequest = (routing) => ({
  start: clone(routing.start),
  end: clone(routing.end),
  avoidClosures: routing.avoidClosures,
  preferHighways: routing.preferHighways,
  alternatives: routing.includeAlternatives,
  closureFeatures: state.currentProject.features
    .filter((feature) => feature.type === "closure")
    .map((feature) => ({
      id: feature.id,
      type: feature.type,
      label: feature.label,
      coordinates: clone(feature.coordinates)
    }))
});

const summariseRouteDetection = ({
  detectedAt,
  request,
  result,
  error = ""
}) => ({
  detectedAt,
  status: result?.status || "error",
  error: error || undefined,
  start: request.start
    ? {
        label: request.start.label,
        lat: request.start.lat,
        lng: request.start.lng
      }
    : null,
  end: request.end
    ? {
        label: request.end.label,
        lat: request.end.lat,
        lng: request.end.lng
      }
    : null,
  settings: {
    avoidClosures: request.avoidClosures,
    preferHighways: request.preferHighways,
    alternatives: request.alternatives
  },
  closures: request.closureFeatures.map((feature) => ({
    id: feature.id,
    label: feature.label,
    pointCount: feature.coordinates.length
  })),
  startSnap: result?.startSnap || null,
  endSnap: result?.endSnap || null,
  affectedRoads: result?.affectedRoads || [],
  diagnostics: result?.diagnostics || null,
  routes: (result?.routes || []).map((route, index) => ({
    option: index + 1,
    distanceKm: route.distanceKm,
    roadNames: route.roadNames,
    quality: route.quality || null,
    coordinateCount: route.coordinates?.length || 0,
    edgeCount: route.edgeIds?.length || 0
  }))
});

const renderRouteDiagnostics = () => {
  const routing = ensureRouting(state.currentProject);
  const log = routing.diagnosticsLog;
  const count = document.querySelector("#routeDiagnosticsCount");
  const output = document.querySelector("#routeDiagnosticsLog");
  if (count) {
    count.textContent = log.length
      ? `${log.length} ${log.length === 1 ? "run" : "runs"} logged`
      : "No runs logged";
  }
  if (output) {
    output.textContent = log.length
      ? JSON.stringify(log, null, 2)
      : "No route detection has been run for this draft.";
  }
};

const recordRouteDetection = ({ request, result = null, error = "" }) => {
  const routing = ensureRouting(state.currentProject);
  const detectedAt = new Date().toISOString();
  routing.lastDetection = {
    detectedAt,
    request: clone(request),
    result: result ? clone(result) : null,
    error: error || null
  };
  routing.diagnosticsLog = [
    summariseRouteDetection({ detectedAt, request, result, error }),
    ...routing.diagnosticsLog
  ].slice(0, 25);
  detectedRouteResult = result;
  renderRouteDiagnostics();
  queuePersist();
};

const recordFeatureReroute = ({ feature, replacement, operation }) => {
  const routing = ensureRouting(state.currentProject);
  routing.diagnosticsLog = [
    {
      detectedAt: new Date().toISOString(),
      status: "ok",
      operation,
      feature: {
        id: feature.id,
        type: feature.type,
        label: feature.label
      },
      settings: {
        avoidClosures: routing.avoidClosures,
        preferHighways: routing.preferHighways,
        routeStops: clone(replacement.routeStops || []),
        avoidRoadNames: clone(replacement.avoidRoadNames || [])
      },
      routes: [
        {
          option: 1,
          distanceKm: replacement.distanceKm,
          roadNames: clone(replacement.roadNames || []),
          coordinateCount: replacement.coordinates?.length || 0
        }
      ],
      legs: clone(replacement.legs || [])
    },
    ...routing.diagnosticsLog
  ].slice(0, 25);
  renderRouteDiagnostics();
};

const createRouteDiagnosticsBundle = () => {
  const routing = ensureRouting(state.currentProject);
  return {
    schema: "road-closure-studio-route-diagnostics-v1",
    exportedAt: new Date().toISOString(),
    project: {
      id: state.currentProject.id,
      headline: state.currentProject.headline,
      reference: state.currentProject.reference,
      road: state.currentProject.road,
      area: state.currentProject.area
    },
    currentRouting: {
      start: routing.start,
      end: routing.end,
      avoidClosures: routing.avoidClosures,
      preferHighways: routing.preferHighways,
      includeAlternatives: routing.includeAlternatives
    },
    lastDetection: routing.lastDetection,
    log: routing.diagnosticsLog
  };
};

const downloadRouteDiagnostics = () => {
  const bundle = createRouteDiagnosticsBundle();
  const blob = new Blob([JSON.stringify(bundle, null, 2)], {
    type: "application/json"
  });
  downloadBlob(
    blob,
    `${slugify(state.currentProject.headline)}-route-diagnostics.json`
  );
  showToast(
    "Diagnostic log exported",
    "The route request, snaps, closure ranges and network result were downloaded."
  );
};

const setRouteEndpointFromMap = async (kind) => {
  const centre = mapController?.getCentre();
  if (!centre) return;
  const endpoint = {
    id: `map:${centre.lat}:${centre.lng}`,
    title: `Map centre (${centre.lat.toFixed(5)}, ${centre.lng.toFixed(5)})`,
    type: "map",
    lat: centre.lat,
    lng: centre.lng
  };
  setRouteEndpoint(kind, endpoint);
  try {
    const nearest = await findNearestRoad(centre.lat, centre.lng);
    const current = ensureRouting(state.currentProject)[kind];
    if (
      nearest &&
      current?.id === endpoint.id &&
      current.labelCustom !== true &&
      nearest.distanceDegrees < 0.02
    ) {
      current.label = `${nearest.name} · map centre`;
      updateRouteUi();
      mapController?.renderRouteEndpoints(state.currentProject.routing);
      queuePersist();
    }
  } catch (error) {
    console.error(error);
  }
};

const swapRoute = () => {
  const routing = ensureRouting(state.currentProject);
  [routing.start, routing.end] = [routing.end, routing.start];
  detectedRouteResult = null;
  const results = document.querySelector("#routeResults");
  if (results) results.replaceChildren();
  updateRouteUi();
  mapController?.renderRouteEndpoints(routing);
  setRouteStatus("Route endpoints swapped.", "ok");
  queuePersist();
};

const clearRoute = () => {
  const routing = ensureRouting(state.currentProject);
  routing.start = null;
  routing.end = null;
  detectedRouteResult = null;
  const results = document.querySelector("#routeResults");
  if (results) results.replaceChildren();
  updateRouteUi();
  mapController?.renderRouteEndpoints(routing);
  setRouteStatus(
    "Choose a search result for A and B, or use the current map centre.",
    "muted"
  );
  queuePersist();
};

const renderRouteResults = (result) => {
  const container = document.querySelector("#routeResults");
  if (!container) return;
  if (result.status !== "ok" || !result.routes?.length) {
    container.innerHTML = "";
    if (result.status === "outside-network") {
      setRouteStatus(
        "One or both endpoints are too far from the Far North road network.",
        "error"
      );
    } else if (result.status === "no-route") {
      const affected = result.affectedRoads?.length
        ? ` Blocked roads detected: ${result.affectedRoads.slice(0, 4).join(", ")}.`
        : "";
      setRouteStatus(
        `No connected route was found with the current closure settings.${affected}`,
        "error"
      );
    } else {
      setRouteStatus("Set both valid route endpoints before detecting.", "error");
    }
    return;
  }

  const diagnostics = result.diagnostics || {};
  const affected = result.affectedRoads?.length
    ? ` · closures touch ${result.affectedRoads.slice(0, 3).join(", ")}`
    : "";
  const primaryQuality = result.routes[0]?.quality;
  if (primaryQuality?.level === "extreme") {
    setRouteStatus(
      `Only a very long connected path was found: ${Number(result.routes[0].distanceKm).toFixed(1)} km versus ${Number(primaryQuality.openNetworkDistanceKm).toFixed(1)} km with the road open (${Number(primaryQuality.detourRatio).toFixed(1)}×). Check the closure and endpoints before adding it.`,
      "warning"
    );
  } else if (primaryQuality?.level === "long") {
    setRouteStatus(
      `A long detour was found: ${Number(result.routes[0].distanceKm).toFixed(1)} km, adding ${Number(primaryQuality.extraDistanceKm).toFixed(1)} km. Confirm it before publishing${affected}.`,
      "warning"
    );
  } else {
    setRouteStatus(
      `${result.routes.length === 1 ? "Route" : `${result.routes.length} route options`} found on ${Number(diagnostics.graphEdges || 0).toLocaleString("en-NZ")} graph edges${affected}.`,
      "ok"
    );
  }
  container.innerHTML = result.routes
    .map(
      (route, index) => {
        const quality = route.quality || {};
        const qualityWarning =
          quality.level === "extreme"
            ? `Very long network loop · ${Number(quality.detourRatio).toFixed(1)}× open-road path · +${Number(quality.extraDistanceKm).toFixed(1)} km`
            : quality.level === "long"
              ? `Long detour · +${Number(quality.extraDistanceKm).toFixed(1)} km`
              : "";
        return `
        <article class="route-option ${quality.level && quality.level !== "normal" ? "route-option-warning" : ""}">
          <span class="route-option-number">${index + 1}</span>
          <div>
            <small>${index === 0 ? "Primary network route" : "Alternative network route"}</small>
            <strong>${Number(route.distanceKm).toFixed(1)} km</strong>
            <p>${escapeHtml(route.roadNames.slice(0, 5).join(" → ") || "Mapped Far North roads")}</p>
            ${qualityWarning ? `<em>${escapeHtml(qualityWarning)}</em>` : ""}
          </div>
          <button class="button ${quality.level === "extreme" ? "button-soft" : index === 0 ? "button-primary" : "button-soft"}" data-add-route-index="${index}" type="button">${quality.level === "extreme" ? "Add long route" : "Add as detour"}</button>
        </article>`;
      }
    )
    .join("");
};

const detectRoute = async () => {
  const routing = ensureRouting(state.currentProject);
  if (!routing.start || !routing.end) {
    setRouteStatus("Set both A and B before detecting a route.", "error");
    return;
  }
  const button = document.querySelector("#detectRouteBtn");
  const previousText = button?.textContent;
  if (button) {
    button.disabled = true;
    button.textContent = "Detecting…";
  }
  detectedRouteResult = null;
  const container = document.querySelector("#routeResults");
  if (container) container.replaceChildren();
  setRouteStatus("Preparing the Far North road graph…", "busy");
  const request = createRouteDiagnosticRequest(routing);
  try {
    const result = await routeService.findRoutes(request);
    recordRouteDetection({ request, result });
    renderRouteResults(result);
  } catch (error) {
    console.error(error);
    recordRouteDetection({
      request,
      error: error instanceof Error ? error.message : String(error)
    });
    setRouteStatus(
      `Route detection failed: ${error instanceof Error ? error.message : String(error)}`,
      "error"
    );
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = previousText || "Detect route";
    }
  }
};

const orderedUniqueRoadNames = (roadNames = []) => {
  const seen = new Set();
  return roadNames
    .map((name) => String(name || "").trim())
    .filter((name) => {
      const key = name.toLocaleLowerCase("en-NZ");
      if (!name || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const formatRoadNameList = (roadNames) =>
  new Intl.ListFormat("en-NZ", {
    style: "long",
    type: "conjunction"
  }).format(orderedUniqueRoadNames(roadNames));

const addDetectedRoute = (index) => {
  const route = detectedRouteResult?.routes?.[index];
  if (!route?.coordinates?.length) return;
  const project = state.currentProject;
  project.features = project.features.filter(
    (feature) => feature.generatedBy !== "route-detector-v2"
  );
  project.features.push({
    id: `feature-route-${Date.now()}`,
    type: "detour",
    label: index === 0 ? "Calculated detour" : "Alternative detour",
    labelMode: "auto",
    labelPosition: null,
    coordinates: route.coordinates,
    generatedBy: "route-detector-v2",
    roadNames: route.roadNames
  });
  if (route.roadNames?.length) {
    project.detour = `Follow the calculated ${Number(route.distanceKm).toFixed(1)} km route via ${formatRoadNameList(route.roadNames)}. Confirm against current traffic controls before publishing.`;
  }
  hydrateFieldValues();
  mapController?.renderFeatures();
  mapController?.fitFeatures();
  updateFeatureUi();
  queuePersist();
  showToast(
    "Calculated detour added",
    "The GIS route now appears on the editor and export graphic."
  );
};

const handleRouteResultClick = (event) => {
  const button = event.target.closest("[data-add-route-index]");
  if (!button) return;
  addDetectedRoute(Number(button.dataset.addRouteIndex));
};

const updateMapToolStatus = (tool) => {
  const status = document.querySelector("#mapStatus");
  if (!status) return;
  if (tool === "edit") {
    status.innerHTML = `<span class="status-crosshair">✥</span><span><strong>Edit routes</strong><small>With Stick to road on, drag onto another road to recalculate through it. Drag on the same road for a local stretch.</small></span>`;
    return;
  }
  if (tool === "pan") {
    status.innerHTML = `<span class="status-crosshair">⌖</span><span><strong>Pan mode</strong><small>Select a draw tool to add an overlay.</small></span>`;
    return;
  }
  const style = featureStyles[tool];
  const pointTool = tool === "note" || tool === "works";
  status.innerHTML = `<span class="status-crosshair">＋</span><span><strong>${escapeHtml(style.label)}</strong><small>${pointTool ? "Click once to place the point." : "Click along the route, then finish."}</small></span>`;
};

const updateFeatureEditBar = (feature) => {
  const bar = document.querySelector("#featureEditBar");
  if (!bar) return;
  bar.hidden = !feature;
  const label = document.querySelector("#selectedFeatureLabel");
  if (label && feature) {
    label.textContent = `${feature.label} · ${feature.coordinates.length} points`;
  }
  const help = document.querySelector("#selectedFeatureHelp");
  if (help && feature) {
    help.textContent =
      feature.coordinates.length === 1
        ? "Drag the map marker to move it. Edit its wording in Mapped item details."
        : state.currentProject.editing?.stickToRoad === false
          ? "Drag any part of the line to stretch a local section, or use the blue beads and + points for precise edits."
          : "Drag onto another road to recalculate through it. Drag along the same road for a local stretch.";
  }
};

const updateDraftActions = (pointCount) => {
  const undo = document.querySelector("#undoPointBtn");
  const finish = document.querySelector("#finishDrawingBtn");
  if (undo) undo.disabled = pointCount === 0;
  if (finish) finish.disabled = pointCount < 2;
};

const updatePublicationLabelPositionStatus = (feature) => {
  const status = document.querySelector(
    `[data-feature-label-position="${CSS.escape(feature.id)}"]`
  );
  if (status) {
    status.textContent = Array.isArray(feature.labelPosition)
      ? "Custom map position"
      : "Automatic map position";
  }
  const reset = document.querySelector(
    `[data-reset-feature-label-position="${CSS.escape(feature.id)}"]`
  );
  if (reset) reset.disabled = !Array.isArray(feature.labelPosition);
};

const renderPublicationLabelEditor = () => {
  const list = document.querySelector("#publicationLabelList");
  if (!list) return;
  const features = ensureProjectOptions(state.currentProject).features;
  if (!features.length) {
    list.innerHTML =
      '<p class="publication-label-empty">Map a closure, route or note to add editable labels.</p>';
    return;
  }
  list.innerHTML = features
    .map((feature) => {
      const style = featureStyles[feature.type] || featureStyles.note;
      return `
        <div class="publication-label-row" data-feature-label-row="${escapeHtml(feature.id)}" data-feature-type="${escapeHtml(feature.type)}">
          <label>
            <span><i style="--label-colour:${style.color}"></i>${escapeHtml(style.label)}</span>
            <input type="text" value="${escapeHtml(feature.label || "")}" data-feature-label-input="${escapeHtml(feature.id)}" aria-label="${escapeHtml(style.label)} label text" />
          </label>
          <div>
            <small data-feature-label-position="${escapeHtml(feature.id)}">${Array.isArray(feature.labelPosition) ? "Custom map position" : "Automatic map position"}</small>
            <span class="publication-label-nudges" aria-label="Move label">
              <button data-nudge-feature-label="${escapeHtml(feature.id)}" data-nudge-x="-18" data-nudge-y="0" type="button" aria-label="Move ${escapeHtml(style.label)} label left">←</button>
              <button data-nudge-feature-label="${escapeHtml(feature.id)}" data-nudge-x="0" data-nudge-y="-18" type="button" aria-label="Move ${escapeHtml(style.label)} label up">↑</button>
              <button data-nudge-feature-label="${escapeHtml(feature.id)}" data-nudge-x="0" data-nudge-y="18" type="button" aria-label="Move ${escapeHtml(style.label)} label down">↓</button>
              <button data-nudge-feature-label="${escapeHtml(feature.id)}" data-nudge-x="18" data-nudge-y="0" type="button" aria-label="Move ${escapeHtml(style.label)} label right">→</button>
            </span>
            <button class="publication-label-reset" data-reset-feature-label-position="${escapeHtml(feature.id)}" type="button" ${Array.isArray(feature.labelPosition) ? "" : "disabled"}>Reset position</button>
          </div>
        </div>`;
    })
    .join("");
};

const handlePublicationLabelInput = (event) => {
  const input = event.target.closest("[data-feature-label-input]");
  if (!input) return;
  const feature = state.currentProject.features.find(
    (item) => item.id === input.dataset.featureLabelInput
  );
  if (!feature) return;
  feature.label = input.value;
  feature.labelMode = "custom";
  mapController?.renderFeatures();
  exportMapController?.renderFeatures();
  queuePersist();
};

const handlePublicationLabelAction = (event) => {
  const nudge = event.target.closest("[data-nudge-feature-label]");
  if (nudge) {
    exportMapController?.nudgeFeatureLabel(
      nudge.dataset.nudgeFeatureLabel,
      Number(nudge.dataset.nudgeX),
      Number(nudge.dataset.nudgeY)
    );
    return;
  }
  const button = event.target.closest("[data-reset-feature-label-position]");
  if (!button) return;
  const feature = state.currentProject.features.find(
    (item) => item.id === button.dataset.resetFeatureLabelPosition
  );
  if (!feature) return;
  feature.labelPosition = null;
  exportMapController?.renderFeatures();
  renderPublicationLabelEditor();
  queuePersist();
};

const renderMappedFeatureEditor = () => {
  const list = document.querySelector("#mappedFeatureList");
  if (!list) return;
  const features = ensureProjectOptions(state.currentProject).features;
  if (!features.length) {
    list.innerHTML =
      '<p class="mapped-feature-empty">No mapped items yet. Draw one or add it from Explore.</p>';
    return;
  }
  list.innerHTML = features
    .map((feature) => {
      const style = featureStyles[feature.type] || featureStyles.note;
      const pointItem = feature.coordinates?.length === 1;
      const editableRoute =
        !pointItem && ["detour", "access"].includes(feature.type);
      const routeStops = Array.isArray(feature.routeStops)
        ? feature.routeStops
        : [];
      const avoidRoadNames = Array.isArray(feature.avoidRoadNames)
        ? feature.avoidRoadNames
        : [];
      return `
        <div class="mapped-feature-row" data-mapped-feature-id="${escapeHtml(feature.id)}" data-mapped-feature-type="${escapeHtml(feature.type)}">
          <span class="mapped-feature-kind"><i style="--mapped-colour:${style.color}"></i>${escapeHtml(style.label)}</span>
          <label>
            <span>Label / information</span>
            <input type="text" value="${escapeHtml(feature.label || "")}" data-mapped-feature-label-input="${escapeHtml(feature.id)}" aria-label="${escapeHtml(style.label)} label or information" />
          </label>
          <small>${Number(feature.coordinates?.length || 0).toLocaleString("en-NZ")} ${pointItem ? "map point" : "route points"}</small>
          <div class="mapped-feature-actions">
            <button class="button button-soft" data-edit-mapped-feature="${escapeHtml(feature.id)}" type="button">${pointItem ? "Locate & move" : "Edit shape"}</button>
            <button class="button button-danger-text" data-delete-mapped-feature="${escapeHtml(feature.id)}" type="button">Remove</button>
          </div>
          ${
            editableRoute
              ? `
            <div class="route-stop-editor">
              <div class="route-stop-heading">
                <strong>Route via roads</strong>
                <span>Pan near the part of a road you want, choose its name, then add it as an ordered stop.</span>
              </div>
              <div class="route-stop-add">
                <input type="text" list="farNorthRoadNames" placeholder="Start typing a Far North road…" data-route-stop-input="${escapeHtml(feature.id)}" aria-label="Road to add as a route stop" />
                <button class="button button-soft" data-add-route-stop="${escapeHtml(feature.id)}" type="button">Add near map centre</button>
              </div>
              <div class="route-stop-add route-avoid-add">
                <input type="text" list="farNorthRoadNames" placeholder="Optional road to avoid…" data-route-avoid-input="${escapeHtml(feature.id)}" aria-label="Road to avoid while recalculating" />
                <button class="button button-soft" data-add-avoided-road="${escapeHtml(feature.id)}" type="button">Avoid road</button>
              </div>
              <div class="route-stop-list">
                ${
                  routeStops.length
                    ? routeStops
                        .map(
                          (stop, index) => `
                    <span class="route-stop-chip">
                      <b>${index + 1}</b>${escapeHtml(stop.road || "Road stop")}
                      <button data-remove-route-stop="${escapeHtml(feature.id)}" data-route-stop-index="${index}" type="button" aria-label="Remove ${escapeHtml(stop.road || "route stop")}">×</button>
                    </span>`
                        )
                        .join("")
                    : '<small>No road stops added.</small>'
                }
                ${avoidRoadNames
                  .map(
                    (road) => `
                  <span class="route-stop-chip avoided">
                    Avoid ${escapeHtml(road)}
                    <button data-remove-avoided-road="${escapeHtml(feature.id)}" data-avoided-road="${escapeHtml(road)}" type="button" aria-label="Stop avoiding ${escapeHtml(road)}">×</button>
                  </span>`
                  )
                  .join("")}
              </div>
              <div class="route-stop-actions">
                <button class="button button-primary" data-recalculate-route="${escapeHtml(feature.id)}" type="button" ${routeStops.length ? "" : "disabled"}>Recalculate through stops</button>
                <small data-route-stop-status="${escapeHtml(feature.id)}">${routeStops.length ? `${routeStops.length} ordered ${routeStops.length === 1 ? "stop" : "stops"}` : "Drag a route onto another road to add a stop automatically."}</small>
              </div>
            </div>`
              : ""
          }
        </div>`;
    })
    .join("");
};

const handleMappedFeatureInput = (event) => {
  const input = event.target.closest("[data-mapped-feature-label-input]");
  if (!input) return;
  const feature = state.currentProject.features.find(
    (item) => item.id === input.dataset.mappedFeatureLabelInput
  );
  if (!feature) return;
  feature.label = input.value;
  feature.labelMode = "custom";
  mapController?.renderFeatures();
  exportMapController?.renderFeatures();
  renderPublicationLabelEditor();
  queuePersist();
};

const startMappedFeatureEditing = (id) => {
  const feature = state.currentProject.features.find((item) => item.id === id);
  if (!feature || !mapController) return;
  document.querySelectorAll("[data-map-tool]").forEach((item) => {
    item.classList.toggle("active", item.dataset.mapTool === "edit");
  });
  mapController.setTool("edit");
  mapController.focusFeature(id, { select: true });
  document.querySelector("#editorMap")?.scrollIntoView({
    behavior: "smooth",
    block: "center"
  });
  showToast(
    feature.coordinates.length === 1 ? "Point ready to move" : "Route selected",
    feature.coordinates.length === 1
      ? "Drag its map marker to reposition it."
      : "Use the blue handles to reshape or move this route."
  );
};

const recalculateFeatureThroughStops = async (feature) => {
  if (!feature?.routeStops?.length) {
    showToast("Add a road stop", "Choose at least one road before recalculating.", "!");
    return;
  }
  const status = document.querySelector(
    `[data-route-stop-status="${CSS.escape(feature.id)}"]`
  );
  const button = document.querySelector(
    `[data-recalculate-route="${CSS.escape(feature.id)}"]`
  );
  if (status) status.textContent = "Calculating a connected road route…";
  if (button) button.disabled = true;
  try {
    const replacement = await routeFeatureThroughStops(
      feature,
      feature.routeStops,
      {
        avoidRoadNames: feature.avoidRoadNames || []
      }
    );
    if (!replacement) throw new Error("The route has no usable endpoints.");
    feature.coordinates = replacement.coordinates;
    feature.roadNames = replacement.roadNames;
    feature.distanceKm = replacement.distanceKm;
    feature.generatedBy = "route-detector-v2";
    recordFeatureReroute({
      feature,
      replacement,
      operation: "ordered-road-stops"
    });
    mapController?.renderFeatures();
    exportMapController?.renderFeatures();
    updateFeatureUi();
    queuePersist();
    showToast(
      "Route recalculated",
      `${replacement.distanceKm.toFixed(1)} km through ${feature.routeStops.map((stop) => stop.road).join(" → ")}.`
    );
  } catch (error) {
    console.error("Could not recalculate route through stops", error);
    if (status) {
      status.textContent =
        error instanceof Error ? error.message : String(error);
    }
    showToast(
      "Route not changed",
      error instanceof Error ? error.message : String(error),
      "!"
    );
  } finally {
    if (button?.isConnected) button.disabled = false;
  }
};

const findRouteRoadCandidate = async (query) => {
  if (!routeRoadCatalog.length) {
    routeRoadCatalog = (await loadExploreCatalog()).roads;
  }
  const normalized = query.toLocaleLowerCase("en-NZ");
  let road = routeRoadCatalog.find(
    (candidate) =>
      candidate.title.toLocaleLowerCase("en-NZ") === normalized
  );
  if (!road) {
    [road] = await searchExplore(query, { type: "road", limit: 1 });
  }
  return road || null;
};

const addRouteStop = async (feature, input) => {
  const query = input?.value.trim();
  if (!query) {
    showToast("Choose a road", "Start typing and select a Far North road.", "!");
    return;
  }
  const road = await findRouteRoadCandidate(query);
  if (!road) {
    showToast("Road not found", `"${query}" is not in the bundled Far North roads.`, "!");
    return;
  }
  const centre = mapController?.getCentre() || {
    lat: road.lat,
    lng: road.lng
  };
  const snapped = await findNearestRoadPoint(centre.lat, centre.lng, {
    roadName: road.title
  });
  if (!snapped) {
    showToast("Road stop unavailable", `${road.title} has no routable geometry.`, "!");
    return;
  }
  feature.routeStops ||= [];
  feature.routeStops.push({
    road: road.title,
    lat: snapped.lat,
    lng: snapped.lng
  });
  renderMappedFeatureEditor();
  queuePersist();
  await recalculateFeatureThroughStops(feature);
};

const addAvoidedRoad = async (feature, input) => {
  const query = input?.value.trim();
  if (!query) {
    showToast("Choose a road", "Start typing and select a road to avoid.", "!");
    return;
  }
  const road = await findRouteRoadCandidate(query);
  if (!road) {
    showToast("Road not found", `"${query}" is not in the bundled Far North roads.`, "!");
    return;
  }
  feature.avoidRoadNames ||= [];
  if (!feature.avoidRoadNames.includes(road.title)) {
    feature.avoidRoadNames.push(road.title);
  }
  renderMappedFeatureEditor();
  queuePersist();
  if (feature.routeStops?.length) {
    await recalculateFeatureThroughStops(feature);
  }
};

const handleMappedFeatureAction = async (event) => {
  const edit = event.target.closest("[data-edit-mapped-feature]");
  if (edit) {
    startMappedFeatureEditing(edit.dataset.editMappedFeature);
    return;
  }
  const addStop = event.target.closest("[data-add-route-stop]");
  if (addStop) {
    const feature = state.currentProject.features.find(
      (item) => item.id === addStop.dataset.addRouteStop
    );
    const input = document.querySelector(
      `[data-route-stop-input="${CSS.escape(addStop.dataset.addRouteStop)}"]`
    );
    if (feature) await addRouteStop(feature, input);
    return;
  }
  const addAvoided = event.target.closest("[data-add-avoided-road]");
  if (addAvoided) {
    const feature = state.currentProject.features.find(
      (item) => item.id === addAvoided.dataset.addAvoidedRoad
    );
    const input = document.querySelector(
      `[data-route-avoid-input="${CSS.escape(addAvoided.dataset.addAvoidedRoad)}"]`
    );
    if (feature) await addAvoidedRoad(feature, input);
    return;
  }
  const removeStop = event.target.closest("[data-remove-route-stop]");
  if (removeStop) {
    const feature = state.currentProject.features.find(
      (item) => item.id === removeStop.dataset.removeRouteStop
    );
    feature?.routeStops?.splice(Number(removeStop.dataset.routeStopIndex), 1);
    renderMappedFeatureEditor();
    queuePersist();
    return;
  }
  const removeAvoided = event.target.closest("[data-remove-avoided-road]");
  if (removeAvoided) {
    const feature = state.currentProject.features.find(
      (item) => item.id === removeAvoided.dataset.removeAvoidedRoad
    );
    if (feature) {
      feature.avoidRoadNames = (feature.avoidRoadNames || []).filter(
        (road) => road !== removeAvoided.dataset.avoidedRoad
      );
      renderMappedFeatureEditor();
      queuePersist();
    }
    return;
  }
  const recalculate = event.target.closest("[data-recalculate-route]");
  if (recalculate) {
    const feature = state.currentProject.features.find(
      (item) => item.id === recalculate.dataset.recalculateRoute
    );
    if (feature) await recalculateFeatureThroughStops(feature);
    return;
  }
  const remove = event.target.closest("[data-delete-mapped-feature]");
  if (!remove) return;
  mapController?.removeFeature(remove.dataset.deleteMappedFeature);
};

const updateFeatureUi = () => {
  const count = state.currentProject.features.length;
  const label = document.querySelector("#featureCount");
  if (label) label.textContent = `${count} mapped ${count === 1 ? "item" : "items"}`;
  renderPublicationLabelEditor();
  renderMappedFeatureEditor();
  updateDetourRoadReferenceControl();
  updatePreview();
};

const updateDetourRoadReferenceControl = () => {
  const routeRoadNames = routeRoadNamesForProject(state.currentProject);
  document
    .querySelectorAll("[data-reference-detour-roads-only]")
    .forEach((input) => {
      input.disabled = routeRoadNames.length === 0;
    });
  document
    .querySelectorAll("[data-reference-detour-roads-status]")
    .forEach((status) => {
      status.textContent = routeRoadNames.length
        ? `Show labels only for ${routeRoadNames.length} ${routeRoadNames.length === 1 ? "road" : "roads"} used by mapped routes.`
        : "Add a calculated or imported detour/access route with road-name data first.";
    });
};

const setFormat = (format) => {
  if (!formats[format]) return;
  state.currentProject.format = format;
  manualPreviewScale = null;
  document.querySelectorAll("[data-format]").forEach((button) => {
    button.classList.toggle("selected", button.dataset.format === format);
  });
  updatePreview();
  queuePersist();
  setTimeout(fitGraphic, 20);
};

const updatePreview = () => {
  const project = state.currentProject;
  const setText = (selector, value) => {
    const element = document.querySelector(selector);
    if (element) element.textContent = value || "";
  };
  setText("#graphicRouteNumber", project.routeNumber || project.road.replace(/\D/g, ""));
  setText("#graphicHeadline", project.headline);
  setText("#graphicSubheadline", project.subheadline);
  setText("#graphicStatus", project.severity);
  setText("#graphicArea", project.area);
  setText("#graphicRoad", project.road);
  setText("#graphicEventType", project.eventType);
  setText("#graphicLocationDetail", project.locationDetail);
  setText("#graphicRecurrence", project.scheduleNote || project.recurrence);
  setText("#graphicDateRange", formatRange(project));
  setText("#graphicDetour", project.detour || project.details);
  setText("#graphicReference", project.reference);

  const format = formats[project.format] || formats.portrait;
  const labels = ensureProjectOptions(project).graphicLabels;
  const stage = document.querySelector("#graphicStage");
  if (stage) {
    stage.style.width = `${format.width}px`;
    stage.style.height = `${format.height}px`;
    stage.className = `graphic-stage format-${project.format}`;
    stage.classList.toggle(
      "graphic-label-borders",
      labels.showLabelBorders
    );
    stage.classList.toggle(
      "graphic-legend-border",
      labels.showLegendBorder
    );
  }
  document
    .querySelector(".graphic-map-caption")
    ?.classList.toggle("graphic-option-hidden", !labels.showMapCaption);
  document
    .querySelector("#graphicKey")
    ?.classList.toggle("graphic-option-hidden", !labels.showLegend);
  document
    .querySelector(".graphic-north")
    ?.classList.toggle("graphic-option-hidden", !labels.showNorthArrow);
  setText("#previewDimensions", `${format.width} × ${format.height} px`);
  renderGraphicMap();
  updateChecklist();
  if (currentStep === 3) requestAnimationFrame(fitGraphic);
};

const renderGraphicMap = () => {
  const key = document.querySelector("#graphicKey");
  if (!key) return;
  const features = state.currentProject.features;
  const types = [...new Set(features.map((feature) => feature.type))];
  const keyItems = ensureProjectOptions(state.currentProject).graphicKeyItems;
  key.innerHTML = (types.length ? types : ["closure", "detour"])
    .filter((type) => keyItems[type]?.visible !== false)
    .map((type) => {
      const style = featureStyles[type] || featureStyles.note;
      const item = keyItems[type] || style;
      return `<div class="graphic-key-item" data-graphic-key-type="${type}"><span class="graphic-key-line ${type}" style="--feature-colour:${item.color || style.color}"></span><span>${escapeHtml(item.label || style.label)}</span></div>`;
    })
    .join("");
  key.classList.toggle("graphic-key-empty", !key.innerHTML);

  exportMapController?.render(state.currentProject);
};

const updateGraphicMapMode = () => {
  const mode = document.querySelector("#graphicMapMode");
  if (!mode) return;
  mode.textContent = state.currentProject.publicationMap?.manual
    ? "Custom position · saved for PNG"
    : "Auto fit to mapped features";
};

const updateReferenceLayerStatus = ({
  surface,
  zoom = 0,
  counts = {},
  choices = {},
  error = false
} = {}) => {
  if (!surface) return;
  const status = document.querySelector(
    `[data-reference-surface="${surface}"] [data-reference-layer-status]`
  );
  if (!status) return;
  if (error) {
    status.textContent = "Reference layers could not be rendered.";
    return;
  }
  const settings = ensureReferenceLayers(state.currentProject);
  Object.entries(choices).forEach(([key, items]) => {
    const list = document.querySelector(
      `[data-reference-surface="${surface}"] [data-reference-layer-choices="${key}"]`
    );
    if (!list) return;
    const layer = settings[key];
    const selected = new Set((layer.selectedIds || []).map(String));
    const query = String(layer.filterText || "")
      .toLocaleLowerCase("en-NZ")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    const shown = (items || [])
      .filter(
        (item) =>
          selected.has(String(item.id)) ||
          !query ||
          String(item.label)
            .toLocaleLowerCase("en-NZ")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .includes(query)
      )
      .sort(
        (left, right) =>
          Number(selected.has(String(right.id))) -
          Number(selected.has(String(left.id)))
      )
      .slice(0, 24);
    list.innerHTML = shown.length
      ? shown
          .map(
            (item) => `<label><input type="checkbox" data-reference-choice="${key}" value="${escapeHtml(item.id)}" ${selected.has(String(item.id)) ? "checked" : ""} /><span>${escapeHtml(item.label)}</span></label>`
          )
          .join("")
      : "<small>No matching items in this map view.</small>";
    const count = document.querySelector(
      `[data-reference-surface="${surface}"] [data-reference-selected-count="${key}"]`
    );
    if (count) count.textContent = selected.size ? `${selected.size} selected` : "";
    const clear = document.querySelector(
      `[data-reference-surface="${surface}"] [data-clear-reference-selection="${key}"]`
    );
    if (clear) clear.disabled = selected.size === 0;
  });
  const labels = {
    roads: "roads",
    roadNames: "road names",
    addresses: "addresses",
    areas: "areas"
  };
  const parts = Object.keys(labels).map((key) => {
    const layer = settings[key];
    if (!layer.visible) return `${labels[key]} off`;
    if (layer.minZoom && Number(zoom) < Number(layer.minZoom)) {
      return `${labels[key]} at z${layer.minZoom}+`;
    }
    return `${Number(counts[key] || 0).toLocaleString("en-NZ")} ${labels[key]}`;
  });
  status.textContent = `Zoom ${Number(zoom).toFixed(1)} · ${parts.join(" · ")}`;
};

const refreshReferenceLayers = () => {
  document.querySelectorAll("[data-reference-layer-status]").forEach((status) => {
    status.textContent = "Updating reference layers…";
  });
  mapController?.renderReferenceLayers(true);
  exportMapController?.render(state.currentProject);
};

const updateChecklist = () => {
  const project = state.currentProject;
  const checks = {
    headline: Boolean(project.headline?.trim()),
    location: Boolean(project.area?.trim() && project.features.length),
    schedule: Boolean(project.startDate && project.endDate),
    detour: Boolean((project.detour || project.details)?.trim())
  };
  Object.entries(checks).forEach(([name, passed]) => {
    const item = document.querySelector(`[data-check="${name}"]`);
    item?.classList.toggle("missing", !passed);
    const icon = item?.querySelector("i");
    if (icon) icon.textContent = passed ? "✓" : "!";
  });
};

const fitGraphic = () => {
  const viewport = document.querySelector("#graphicViewport");
  const stage = document.querySelector("#graphicStage");
  if (!viewport || !stage || viewport.clientWidth === 0) return;
  const format = formats[state.currentProject.format] || formats.portrait;
  const availableWidth = viewport.clientWidth - 52;
  const availableHeight = Math.max(480, viewport.clientHeight - 52);
  const fit = Math.min(availableWidth / format.width, availableHeight / format.height, 1);
  const scale = manualPreviewScale ?? fit;
  stage.style.transform = `scale(${scale})`;
  stage.style.marginLeft = `${Math.max(0, (availableWidth - format.width * scale) / 2)}px`;
  stage.style.marginRight = `${-format.width * (1 - scale)}px`;
  stage.style.marginBottom = `${-format.height * (1 - scale)}px`;
  const label = document.querySelector("#zoomLabel");
  if (label) label.textContent = manualPreviewScale ? `${Math.round(scale * 100)}%` : "Fit";
};

const changePreviewZoom = (delta) => {
  const stage = document.querySelector("#graphicStage");
  if (!stage) return;
  const currentTransform = stage.style.transform.match(/scale\(([\d.]+)\)/);
  const current = currentTransform ? Number(currentTransform[1]) : 0.5;
  manualPreviewScale = Math.max(0.15, Math.min(1, current + delta));
  fitGraphic();
};

const saveCurrentRecord = () => {
  const project = clone(state.currentProject);
  project.updatedAt = new Date().toISOString();
  const index = state.records.findIndex((record) => record.id === project.id);
  if (index >= 0) state.records[index] = project;
  else state.records.unshift(project);
  state.currentProject = clone(project);
  recordHistory("record", `Saved closure ${project.reference || project.road || project.id}`);
  persist("Record saved");
  renderRecords();
  showToast("Closure record saved", `${project.reference || project.road} is now in the register.`);
};

const createNewProject = () => {
  state.currentProject = createProjectWithUserDefaults();
  recordHistory("record", "Started a blank closure draft");
  persist("New draft created");
  mount({ view: "editor", step: 0 });
  showToast(
    "Blank closure started",
    "No message, location, schedule or map geometry has been prefilled."
  );
};

const renderRecords = () => {
  const list = document.querySelector("#recordsList");
  if (!list) return;
  const records = state.records.filter((record) => {
    const matchesStatus = recordFilter === "All" || record.status === recordFilter;
    const haystack = [
      record.headline,
      record.subheadline,
      record.road,
      record.area,
      record.reference
    ]
      .join(" ")
      .toLowerCase();
    return matchesStatus && haystack.includes(recordQuery);
  });

  list.innerHTML = records
    .map(
      (record) => `
        <article class="record-row" data-record-id="${record.id}">
          <div class="record-shield">${escapeHtml(record.routeNumber || record.road.replace(/\D/g, ""))}</div>
          <div class="record-main">
            <strong>${escapeHtml(record.headline)}</strong>
            <span>${escapeHtml(record.subheadline)} · ${escapeHtml(record.reference || "No reference")}</span>
          </div>
          <div class="record-cell">
            <strong>${escapeHtml(record.road)}</strong>
            <span>${escapeHtml(record.area)}</span>
          </div>
          <div class="record-cell">
            <strong>${escapeHtml(formatDate(record.startDate))}</strong>
            <span>${escapeHtml(record.scheduleNote || record.recurrence)}</span>
          </div>
          <span class="record-status ${record.status}">${escapeHtml(record.status)}</span>
          <div class="record-actions">
            <button type="button" data-record-action="edit" title="Edit record" aria-label="Edit ${escapeHtml(record.headline)}">✎</button>
            <button type="button" data-record-action="duplicate" title="Duplicate record" aria-label="Duplicate ${escapeHtml(record.headline)}">⧉</button>
            <button type="button" data-record-action="delete" title="Delete record" aria-label="Delete ${escapeHtml(record.headline)}">×</button>
          </div>
        </article>`
    )
    .join("");

  list.querySelectorAll("[data-record-action]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.closest("[data-record-id]").dataset.recordId;
      handleRecordAction(button.dataset.recordAction, id);
    });
  });

  const empty = document.querySelector("#recordsEmpty");
  if (empty) empty.hidden = records.length > 0;
  updateRecordStats();
};

const updateRecordStats = () => {
  const counts = state.records.reduce(
    (result, record) => {
      result[record.status] = (result[record.status] || 0) + 1;
      return result;
    },
    { Active: 0, Scheduled: 0, Draft: 0 }
  );
  const set = (selector, value) => {
    const element = document.querySelector(selector);
    if (element) element.textContent = value;
  };
  set("#statActive", counts.Active || 0);
  set("#statScheduled", counts.Scheduled || 0);
  set("#statDraft", counts.Draft || 0);
  set("#statTotal", state.records.length);
  set("#recordCount", state.records.length);
};

const handleRecordAction = (action, id) => {
  const record = state.records.find((item) => item.id === id);
  if (!record) return;
  if (action === "edit") {
    state.currentProject = clone(record);
    recordHistory("record", `Opened closure ${record.reference || record.road || record.id}`);
    persist("Record opened");
    mount({ view: "editor", step: 0 });
    return;
  }
  if (action === "duplicate") {
    const copy = clone(record);
    copy.id = `closure-${Date.now()}`;
    copy.status = "Draft";
    copy.reference = `${record.reference || "RC"}-COPY`;
    copy.headline = `${record.headline} copy`;
    copy.createdAt = new Date().toISOString();
    copy.updatedAt = copy.createdAt;
    state.records.unshift(copy);
    state.currentProject = clone(copy);
    recordHistory("record", `Duplicated closure ${record.reference || record.road || record.id}`);
    persist("Record duplicated");
    renderRecords();
    showToast("Closure duplicated", "A new draft copy was added to the register.");
    return;
  }
  if (action === "delete" && window.confirm(`Delete “${record.headline}”?`)) {
    state.records = state.records.filter((item) => item.id !== id);
    if (state.currentProject.id === id) state.currentProject = createProjectWithUserDefaults();
    recordHistory("record", `Deleted closure ${record.reference || record.road || record.id}`);
    persist("Record deleted");
    renderRecords();
    showToast("Closure deleted", "The local record was removed.", "−");
  }
};

const exportClosures = () => {
  const bundle = {
    schema: "road-closure-studio-closures-v1",
    exportedAt: new Date().toISOString(),
    currentProject: clone(ensureProjectOptions(state.currentProject)),
    records: state.records.map((record) =>
      clone(ensureProjectOptions(record))
    )
  };
  recordHistory("export", `Exported ${bundle.records.length} closure records`);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  downloadBlob(
    new Blob([JSON.stringify(bundle, null, 2)], {
      type: "application/json"
    }),
    `road-closures-${new Date().toISOString().slice(0, 10)}.json`
  );
  showToast(
    "Closures exported",
    `${bundle.records.length} saved records and the current draft were downloaded.`
  );
};

const importClosures = async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    if (file.size > 25 * 1024 * 1024) {
      throw new Error("Closure bundle is larger than 25 MB.");
    }
    const bundle = JSON.parse(await file.text());
    if (
      bundle?.schema !== "road-closure-studio-closures-v1" &&
      !Array.isArray(bundle)
    ) {
      throw new Error("Unsupported closure bundle schema.");
    }
    const candidates = Array.isArray(bundle) ? bundle : [...(bundle.records || [])];
    if (!Array.isArray(bundle) && bundle.currentProject) {
      candidates.push(bundle.currentProject);
    }
    if (!candidates.length || candidates.length > 2000) {
      throw new Error("Closure bundle has no usable records or is too large.");
    }
    const imported = candidates
      .filter(
        (record) =>
          record &&
          typeof record === "object" &&
          String(record.id || "").trim() &&
          Array.isArray(record.features)
      )
      .map((record) => ensureProjectOptions(clone(record)));
    if (!imported.length) throw new Error("No valid closure records were found.");
    const merged = new Map(state.records.map((record) => [record.id, record]));
    imported.forEach((record) => merged.set(record.id, record));
    state.records = [...merged.values()].sort((left, right) =>
      String(right.updatedAt || "").localeCompare(String(left.updatedAt || ""))
    );
    recordHistory("import", `Imported or updated ${imported.length} closure records`);
    persist("Closure records imported");
    renderRecords();
    showToast(
      "Closures imported",
      `${imported.length} records were added or updated in the register.`
    );
  } catch (error) {
    console.error(error);
    showToast(
      "Closure import failed",
      error.message || "Choose a valid Road Closure Studio JSON export.",
      "!"
    );
  } finally {
    event.target.value = "";
  }
};

const importGeoJson = async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const geojson = JSON.parse(await file.text());
    const count = mapController.importGeoJson(geojson);
    updateFeatureUi();
    queuePersist();
    showToast("GeoJSON imported", `${count} mapped ${count === 1 ? "item" : "items"} added.`);
  } catch (error) {
    console.error(error);
    showToast("Import failed", "Choose a valid GeoJSON FeatureCollection.", "!");
  } finally {
    event.target.value = "";
  }
};

const exportGeoJson = () => {
  const geojson = mapController.toGeoJson();
  const routing = ensureRouting(state.currentProject);
  const diagnosticBundle = createRouteDiagnosticsBundle();
  geojson.routeDiagnostics = diagnosticBundle;
  if (routing.includeNetworkRoutesInGeoJson !== false) {
    const detection = routing.lastDetection;
    (detection?.result?.routes || []).forEach((route, index) => {
      if (!route.coordinates?.length) return;
      geojson.features.push({
        type: "Feature",
        properties: {
          id: `network-route-diagnostic-${index + 1}`,
          type: "network-route-diagnostic",
          label:
            index === 0
              ? "Primary detected network route"
              : `Detected network route option ${index + 1}`,
          diagnosticOnly: true,
          detectedAt: detection.detectedAt,
          option: index + 1,
          distanceKm: route.distanceKm,
          roadNames: route.roadNames,
          edgeIds: route.edgeIds
        },
        geometry: {
          type: "LineString",
          coordinates: route.coordinates.map(([lat, lng]) => [lng, lat])
        }
      });
    });
  }
  const blob = new Blob([JSON.stringify(geojson, null, 2)], {
    type: "application/geo+json"
  });
  downloadBlob(blob, `${slugify(state.currentProject.headline)}.geojson`);
  showToast(
    "GeoJSON exported",
    routing.lastDetection
      ? "Mapped features, the route diagnostic log and the selected network route output were downloaded."
      : "Mapped features and an empty route diagnostic log were downloaded."
  );
};

const preparePngLabelLayer = (stage) => {
  const stageRect = stage.getBoundingClientRect();
  const layer = document.createElement("div");
  layer.className = "png-export-label-layer";
  const hiddenSources = [];
  stage
    .querySelectorAll(
      ".graphic-feature-label, .publication-reference-label, .graphic-key, .graphic-map-caption"
    )
    .forEach((source) => {
      const rect = source.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const cloneLabel = source.cloneNode(true);
      cloneLabel.classList.add("png-flat-label");
      cloneLabel.style.setProperty("position", "absolute", "important");
      cloneLabel.style.setProperty(
        "left",
        `${rect.left - stageRect.left}px`,
        "important"
      );
      cloneLabel.style.setProperty(
        "top",
        `${rect.top - stageRect.top}px`,
        "important"
      );
      cloneLabel.style.setProperty("width", `${rect.width}px`, "important");
      cloneLabel.style.setProperty("height", `${rect.height}px`, "important");
      cloneLabel.style.setProperty("margin", "0", "important");
      cloneLabel.style.setProperty("transform", "none", "important");
      cloneLabel.style.setProperty("right", "auto", "important");
      cloneLabel.style.setProperty("bottom", "auto", "important");
      cloneLabel.style.setProperty("opacity", "1", "important");
      cloneLabel.style.setProperty("background-image", "none", "important");
      cloneLabel.style.setProperty("box-shadow", "none", "important");
      if (source.classList.contains("graphic-key")) {
        cloneLabel.style.setProperty("background", "#ffffff", "important");
      }
      layer.appendChild(cloneLabel);
      const wrapper = source.closest(".leaflet-marker-icon") || source;
      hiddenSources.push({
        element: wrapper,
        visibility: wrapper.style.visibility
      });
      wrapper.style.visibility = "hidden";
    });
  stage.appendChild(layer);
  stage.classList.add("png-exporting");
  return {
    layer,
    offset: {
      x: stageRect.left,
      y: stageRect.top
    },
    restore: () => {
      layer.remove();
      stage.classList.remove("png-exporting");
      hiddenSources.forEach(({ element, visibility }) => {
        element.style.visibility = visibility;
      });
    }
  };
};

const exportPng = async () => {
  const stage = document.querySelector("#graphicStage");
  const button = document.querySelector("#exportPngBtn");
  if (!stage || !button) return;
  const format = formats[state.currentProject.format] || formats.portrait;
  const previousTransform = stage.style.transform;
  const previousMargin = stage.style.marginLeft;
  const previousMarginRight = stage.style.marginRight;
  const previousMarginBottom = stage.style.marginBottom;
  const previousText = button.innerHTML;
  button.disabled = true;
  button.textContent = "Rendering PNG…";
  stage.style.transform = "none";
  stage.style.marginLeft = "0";
  stage.style.marginRight = "0";
  stage.style.marginBottom = "0";
  let pngLabels = {
    layer: null,
    offset: { x: 0, y: 0 },
    restore: () => {}
  };

  try {
    await exportMapController?.prepareForExport();
    pngLabels = preparePngLabelLayer(stage);
    pngLabels.layer.style.visibility = "hidden";
    const canvas = await html2canvas(stage, {
      backgroundColor: "#ffffff",
      scale: 1,
      width: format.width,
      height: format.height,
      useCORS: true,
      logging: false
    });
    pngLabels.layer.style.visibility = "visible";
    const labelCanvas = await html2canvas(pngLabels.layer, {
      backgroundColor: null,
      scale: 1,
      width: format.width,
      height: format.height,
      logging: false
    });
    canvas
      .getContext("2d")
      .drawImage(
        labelCanvas,
        Math.round(pngLabels.offset.x),
        Math.round(pngLabels.offset.y)
      );
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png", 1));
    if (!blob) throw new Error("PNG encoding failed");
    downloadBlob(
      blob,
      `${slugify(state.currentProject.headline)}-${format.width}x${format.height}.png`
    );
    recordHistory("export", `Exported ${format.width} x ${format.height} PNG`);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    showToast("PNG ready", `${format.width} × ${format.height} graphic downloaded.`);
  } catch (error) {
    console.error(error);
    showToast("PNG export failed", "Please try again after the preview has loaded.", "!");
  } finally {
    pngLabels.restore();
    stage.style.transform = previousTransform;
    stage.style.marginLeft = previousMargin;
    stage.style.marginRight = previousMarginRight;
    stage.style.marginBottom = previousMarginBottom;
    exportMapController?.map.invalidateSize({ animate: false, pan: false });
    button.disabled = false;
    button.innerHTML = previousText;
  }
};

window.addEventListener("resize", handleResize, { passive: true });
mount({
  view: userPreferences.startView,
  step: userPreferences.rememberLastStep ? state.ui?.lastStep || 0 : 0
});
void loadRuntimeCloudConfig();
