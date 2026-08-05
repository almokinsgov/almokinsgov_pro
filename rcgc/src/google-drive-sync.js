const GOOGLE_IDENTITY_SCRIPT = "https://accounts.google.com/gsi/client";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";
const USERINFO_API = "https://openidconnect.googleapis.com/v1/userinfo";
const FOLDER_MIME = "application/vnd.google-apps.folder";

export const GOOGLE_DRIVE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/drive.file"
];

export const DEFAULT_CLOUD_CONFIG = {
  clientId: "",
  folderName: "Road Closure Studio",
  autoSync: true,
  restoreOnConnect: false,
  lastAccount: null,
  lastSyncAt: null
};

export const DEFAULT_USER_PREFERENCES = {
  displayName: "",
  startView: "editor",
  rememberLastStep: true,
  defaultFormat: "portrait"
};

export const DEFAULT_USER_SETTINGS = {
  projectDefaults: null,
  historyLimit: 250
};

const jsonClone = (value) => JSON.parse(JSON.stringify(value));

const escapeDriveQueryValue = (value) =>
  String(value || "").replaceAll("\\", "\\\\").replaceAll("'", "\\'");

const parseJsonResponse = async (response) => {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
};

const toErrorMessage = (payload, fallback) =>
  payload?.error?.message ||
  payload?.error_description ||
  payload?.message ||
  fallback;

export const validateGoogleClientId = (value) =>
  /^\d+-[a-z0-9_-]+\.apps\.googleusercontent\.com$/i.test(
    String(value || "").trim()
  );

export const normalizeCloudConfig = (value = {}) => ({
  ...DEFAULT_CLOUD_CONFIG,
  ...value,
  clientId: String(value.clientId || "").trim(),
  folderName: String(value.folderName || DEFAULT_CLOUD_CONFIG.folderName).trim() ||
    DEFAULT_CLOUD_CONFIG.folderName,
  autoSync: value.autoSync !== false,
  restoreOnConnect: value.restoreOnConnect === true,
  lastAccount:
    value.lastAccount && typeof value.lastAccount === "object"
      ? {
          sub: String(value.lastAccount.sub || ""),
          name: String(value.lastAccount.name || ""),
          email: String(value.lastAccount.email || ""),
          picture: String(value.lastAccount.picture || "")
        }
      : null,
  lastSyncAt: value.lastSyncAt || null
});

export const normalizeUserPreferences = (value = {}) => ({
  ...DEFAULT_USER_PREFERENCES,
  ...value,
  displayName: String(value.displayName || "").trim(),
  startView: value.startView === "records" ? "records" : "editor",
  rememberLastStep: value.rememberLastStep !== false,
  defaultFormat: ["portrait", "square", "story", "landscape"].includes(
    value.defaultFormat
  )
    ? value.defaultFormat
    : "portrait"
});

export const normalizeUserSettings = (value = {}) => ({
  ...DEFAULT_USER_SETTINGS,
  ...value,
  projectDefaults:
    value.projectDefaults && typeof value.projectDefaults === "object"
      ? jsonClone(value.projectDefaults)
      : null,
  historyLimit: Math.max(50, Math.min(500, Number(value.historyLimit) || 250))
});

const recordTimestamp = (record) =>
  Date.parse(record?.updatedAt || record?.createdAt || 0) || 0;

export const mergeWorkspaceBundles = (localBundle, cloudBundle) => {
  const localRecords = Array.isArray(localBundle?.records) ? localBundle.records : [];
  const cloudRecords = Array.isArray(cloudBundle?.records) ? cloudBundle.records : [];
  const records = new Map();

  [...localRecords, ...cloudRecords].forEach((record) => {
    if (!record?.id) return;
    const current = records.get(record.id);
    if (!current || recordTimestamp(record) >= recordTimestamp(current)) {
      records.set(record.id, jsonClone(record));
    }
  });

  const localCurrent = localBundle?.currentProject;
  const cloudCurrent = cloudBundle?.currentProject;
  const currentSource =
    recordTimestamp(cloudCurrent) > recordTimestamp(localCurrent)
      ? cloudCurrent
      : localCurrent || cloudCurrent || null;
  const currentProject = currentSource ? jsonClone(currentSource) : null;
  const localSavedAt = Date.parse(localBundle?.lastSavedAt || 0) || 0;
  const cloudSavedAt = Date.parse(cloudBundle?.lastSavedAt || 0) || 0;
  const uiSource = cloudSavedAt > localSavedAt ? cloudBundle?.ui : localBundle?.ui;

  const latestTimestamp = Math.max(
    localSavedAt,
    cloudSavedAt,
    recordTimestamp(currentProject)
  );

  return {
    schema: "road-closure-studio-workspace-v2",
    appVersion: "5.0.1",
    currentProject,
    records: [...records.values()].sort(
      (left, right) => recordTimestamp(right) - recordTimestamp(left)
    ),
    ui: {
      lastView: uiSource?.lastView === "records" ? "records" : "editor",
      lastStep: Math.max(0, Math.min(3, Number(uiSource?.lastStep) || 0))
    },
    lastSavedAt: latestTimestamp
      ? new Date(latestTimestamp).toISOString()
      : new Date().toISOString()
  };
};

let identityScriptPromise;

export const loadGoogleIdentityServices = () => {
  if (window.google?.accounts?.oauth2) return Promise.resolve(window.google);
  if (identityScriptPromise) return identityScriptPromise;

  identityScriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(
      `script[src="${GOOGLE_IDENTITY_SCRIPT}"]`
    );
    const script = existing || document.createElement("script");
    let settled = false;
    const timeout = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("Google Identity Services did not load."));
    }, 15000);

    const complete = () => {
      if (settled) return;
      if (!window.google?.accounts?.oauth2) {
        settled = true;
        window.clearTimeout(timeout);
        reject(new Error("Google Identity Services is unavailable."));
        return;
      }
      settled = true;
      window.clearTimeout(timeout);
      resolve(window.google);
    };

    const fail = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      reject(
        new Error(
          "Google sign-in could not load. Check the internet connection and content security settings."
        )
      );
    };

    script.addEventListener("load", complete, { once: true });
    script.addEventListener("error", fail, { once: true });
    if (!existing) {
      script.src = GOOGLE_IDENTITY_SCRIPT;
      script.async = true;
      script.defer = true;
      script.id = "googleIdentityServices";
      document.head.appendChild(script);
    } else if (window.google?.accounts?.oauth2) {
      complete();
    }
  });

  return identityScriptPromise;
};

export class GoogleDriveSync {
  constructor(config = {}, { onStatus } = {}) {
    this.config = normalizeCloudConfig(config);
    this.onStatus = typeof onStatus === "function" ? onStatus : () => {};
    this.tokenResponse = null;
    this.expiresAt = 0;
    this.profile = this.config.lastAccount;
    this.rootFolder = null;
    this.savesFolder = null;
    this.rootFiles = new Map();
    this.saveFiles = new Map();
  }

  configure(config) {
    this.config = normalizeCloudConfig({ ...this.config, ...config });
    return this.config;
  }

  isConnected() {
    return Boolean(
      this.tokenResponse?.access_token && Date.now() < this.expiresAt
    );
  }

  getFolderUrl() {
    return this.rootFolder?.webViewLink ||
      (this.rootFolder?.id
        ? `https://drive.google.com/drive/folders/${this.rootFolder.id}`
        : "");
  }

  emit(phase, message, detail = {}) {
    this.onStatus({ phase, message, detail, at: new Date().toISOString() });
  }

  async connect({ prompt = "select_account" } = {}) {
    if (!validateGoogleClientId(this.config.clientId)) {
      throw new Error("Enter a valid Google OAuth web client ID first.");
    }

    this.emit("connecting", "Opening Google sign-in");
    const google = await loadGoogleIdentityServices();

    const tokenResponse = await new Promise((resolve, reject) => {
      const tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: this.config.clientId,
        scope: GOOGLE_DRIVE_SCOPES.join(" "),
        include_granted_scopes: true,
        callback: (response) => {
          if (response?.error || !response?.access_token) {
            reject(
              new Error(
                toErrorMessage(response, "Google did not return an access token.")
              )
            );
            return;
          }
          resolve(response);
        },
        error_callback: (error) => {
          reject(
            new Error(
              error?.type === "popup_closed"
                ? "Google sign-in was closed before it finished."
                : "Google sign-in could not open or complete."
            )
          );
        }
      });
      tokenClient.requestAccessToken({ prompt });
    });

    this.tokenResponse = tokenResponse;
    this.expiresAt =
      Date.now() + Math.max(60, Number(tokenResponse.expires_in) || 3600) * 1000 - 60000;
    this.profile = await this.fetchUserProfile();
    this.config.lastAccount = this.profile;
    await this.ensureDriveStructure();
    this.emit("connected", "Google Drive connected", {
      account: this.profile,
      folderId: this.rootFolder?.id
    });
    return {
      profile: this.profile,
      folder: this.rootFolder,
      expiresAt: this.expiresAt
    };
  }

  disconnect({ revoke = false } = {}) {
    const accessToken = this.tokenResponse?.access_token;
    if (revoke && accessToken && window.google?.accounts?.oauth2?.revoke) {
      window.google.accounts.oauth2.revoke(accessToken, () => {});
    }
    this.tokenResponse = null;
    this.expiresAt = 0;
    this.rootFolder = null;
    this.savesFolder = null;
    this.rootFiles.clear();
    this.saveFiles.clear();
    this.emit("disconnected", "Google Drive disconnected");
  }

  assertConnected() {
    if (!this.isConnected()) {
      this.tokenResponse = null;
      this.expiresAt = 0;
      throw new Error(
        "The Google session has expired. Use Sign in with Google to reconnect."
      );
    }
  }

  async request(url, options = {}) {
    this.assertConnected();
    const headers = new Headers(options.headers || {});
    headers.set("Authorization", `Bearer ${this.tokenResponse.access_token}`);
    const response = await fetch(url, { ...options, headers });
    const payload = await parseJsonResponse(response);
    if (!response.ok) {
      if (response.status === 401) {
        this.tokenResponse = null;
        this.expiresAt = 0;
      }
      throw new Error(
        toErrorMessage(
          payload,
          `Google Drive request failed with HTTP ${response.status}.`
        )
      );
    }
    return payload;
  }

  async fetchUserProfile() {
    const profile = await this.request(USERINFO_API);
    return {
      sub: String(profile?.sub || ""),
      name: String(profile?.name || profile?.email || "Google user"),
      email: String(profile?.email || ""),
      picture: String(profile?.picture || "")
    };
  }

  async listFiles(query) {
    const params = new URLSearchParams({
      q: query,
      spaces: "drive",
      pageSize: "100",
      fields:
        "files(id,name,mimeType,modifiedTime,size,parents,appProperties,webViewLink)"
    });
    const payload = await this.request(`${DRIVE_API}/files?${params}`);
    return Array.isArray(payload?.files) ? payload.files : [];
  }

  async findFolder(role, parentId = null) {
    const clauses = [
      `mimeType='${FOLDER_MIME}'`,
      "trashed=false",
      `appProperties has { key='roadClosureStudioRole' and value='${escapeDriveQueryValue(role)}' }`
    ];
    if (parentId) clauses.push(`'${escapeDriveQueryValue(parentId)}' in parents`);
    const files = await this.listFiles(clauses.join(" and "));
    return files[0] || null;
  }

  async createFolder(name, role, parentId = null) {
    const metadata = {
      name,
      mimeType: FOLDER_MIME,
      appProperties: {
        roadClosureStudio: "true",
        roadClosureStudioRole: role,
        schemaVersion: "5"
      }
    };
    if (parentId) metadata.parents = [parentId];
    return this.request(
      `${DRIVE_API}/files?fields=id,name,mimeType,modifiedTime,parents,appProperties,webViewLink`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(metadata)
      }
    );
  }

  async ensureDriveStructure() {
    this.assertConnected();
    this.emit("preparing", "Preparing the Road Closure Studio Drive folder");
    this.rootFolder =
      (await this.findFolder("root")) ||
      (await this.createFolder(this.config.folderName, "root"));
    this.savesFolder =
      (await this.findFolder("saves", this.rootFolder.id)) ||
      (await this.createFolder("Saves", "saves", this.rootFolder.id));
    await this.refreshFileIndexes();
    return { root: this.rootFolder, saves: this.savesFolder };
  }

  async refreshFileIndexes() {
    if (!this.rootFolder?.id || !this.savesFolder?.id) return;
    const [rootFiles, saveFiles] = await Promise.all([
      this.listFiles(`'${escapeDriveQueryValue(this.rootFolder.id)}' in parents and trashed=false`),
      this.listFiles(`'${escapeDriveQueryValue(this.savesFolder.id)}' in parents and trashed=false`)
    ]);
    this.rootFiles = new Map(
      rootFiles
        .filter((file) => file.mimeType !== FOLDER_MIME)
        .map((file) => [file.appProperties?.roadClosureStudioRole || file.name, file])
    );
    this.saveFiles = new Map(
      saveFiles
        .filter((file) => file.mimeType !== FOLDER_MIME)
        .map((file) => [file.appProperties?.roadClosureStudioRole || file.name, file])
    );
  }

  async downloadJson(file) {
    if (!file?.id) return null;
    return this.request(`${DRIVE_API}/files/${encodeURIComponent(file.id)}?alt=media`);
  }

  async loadBundle() {
    await this.ensureDriveStructure();
    this.emit("loading", "Loading the Google Drive workspace");
    const roles = [
      ["profile", this.rootFiles],
      ["preferences", this.rootFiles],
      ["config", this.rootFiles],
      ["settings", this.rootFiles],
      ["history", this.rootFiles],
      ["workspace", this.saveFiles],
      ["records", this.saveFiles]
    ];
    const entries = await Promise.all(
      roles.map(async ([role, index]) => [role, await this.downloadJson(index.get(role))])
    );
    const loaded = Object.fromEntries(entries);
    this.emit("loaded", "Google Drive workspace loaded");
    return {
      profile: loaded.profile,
      preferences: loaded.preferences,
      config: loaded.config,
      settings: loaded.settings,
      history: Array.isArray(loaded.history?.entries)
        ? loaded.history.entries
        : [],
      workspace: loaded.workspace
        ? {
            ...loaded.workspace,
            records: Array.isArray(loaded.records?.records)
              ? loaded.records.records
              : loaded.workspace.records || []
          }
        : null,
      files: {
        root: [...this.rootFiles.values()],
        saves: [...this.saveFiles.values()]
      }
    };
  }

  async createJsonFile({ name, role, data, parentId }) {
    const boundary = `road-closure-studio-${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}`;
    const metadata = {
      name,
      mimeType: "application/json",
      parents: [parentId],
      appProperties: {
        roadClosureStudio: "true",
        roadClosureStudioRole: role,
        schemaVersion: "5"
      }
    };
    const json = JSON.stringify(data, null, 2);
    const body = [
      `--${boundary}`,
      "Content-Type: application/json; charset=UTF-8",
      "",
      JSON.stringify(metadata),
      `--${boundary}`,
      "Content-Type: application/json; charset=UTF-8",
      "",
      json,
      `--${boundary}--`,
      ""
    ].join("\r\n");
    return this.request(
      `${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,name,mimeType,modifiedTime,size,parents,appProperties,webViewLink`,
      {
        method: "POST",
        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
        body
      }
    );
  }

  async updateJsonFile(file, data) {
    return this.request(
      `${DRIVE_UPLOAD_API}/files/${encodeURIComponent(
        file.id
      )}?uploadType=media&fields=id,name,mimeType,modifiedTime,size,parents,appProperties,webViewLink`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json; charset=UTF-8" },
        body: JSON.stringify(data, null, 2)
      }
    );
  }

  async upsertJson({ name, role, data, location = "root" }) {
    const parentId =
      location === "saves" ? this.savesFolder?.id : this.rootFolder?.id;
    const index = location === "saves" ? this.saveFiles : this.rootFiles;
    if (!parentId) throw new Error("The Google Drive folder is not ready.");
    const existing = index.get(role);
    const file = existing
      ? await this.updateJsonFile(existing, data)
      : await this.createJsonFile({ name, role, data, parentId });
    index.set(role, file);
    return file;
  }

  async syncBundle(bundle) {
    await this.ensureDriveStructure();
    const syncedAt = new Date().toISOString();
    this.emit("syncing", "Saving profile, preferences, settings and closures to Drive");
    const workspace = {
      schema: "road-closure-studio-workspace-v2",
      appVersion: "5.0.1",
      currentProject: jsonClone(bundle.state.currentProject),
      ui: jsonClone(bundle.state.ui || { lastView: "editor", lastStep: 0 }),
      lastSavedAt: bundle.state.lastSavedAt || syncedAt,
      syncedAt
    };
    const records = {
      schema: "road-closure-studio-records-v2",
      appVersion: "5.0.1",
      records: jsonClone(bundle.state.records || []),
      syncedAt
    };
    const writes = [
      this.upsertJson({
        name: "profile.json",
        role: "profile",
        data: {
          schema: "road-closure-studio-profile-v1",
          account: jsonClone(bundle.profile || this.profile),
          displayName: bundle.preferences?.displayName || "",
          syncedAt
        }
      }),
      this.upsertJson({
        name: "preferences.json",
        role: "preferences",
        data: {
          schema: "road-closure-studio-preferences-v1",
          ...jsonClone(bundle.preferences),
          syncedAt
        }
      }),
      this.upsertJson({
        name: "config.json",
        role: "config",
        data: {
          schema: "road-closure-studio-config-v1",
          appVersion: "5.0.1",
          folderName: this.config.folderName,
          origin: window.location.origin,
          autoSync: this.config.autoSync,
          restoreOnConnect: this.config.restoreOnConnect,
          syncedAt
        }
      }),
      this.upsertJson({
        name: "settings.json",
        role: "settings",
        data: {
          schema: "road-closure-studio-settings-v1",
          ...jsonClone(bundle.settings),
          syncedAt
        }
      }),
      this.upsertJson({
        name: "history.json",
        role: "history",
        data: {
          schema: "road-closure-studio-history-v1",
          entries: jsonClone(bundle.history || []),
          syncedAt
        }
      }),
      this.upsertJson({
        name: "workspace.json",
        role: "workspace",
        data: workspace,
        location: "saves"
      }),
      this.upsertJson({
        name: "records.json",
        role: "records",
        data: records,
        location: "saves"
      })
    ];
    await Promise.all(writes);
    this.config.lastSyncAt = syncedAt;
    this.emit("synced", "Google Drive is up to date", {
      syncedAt,
      fileCount: writes.length
    });
    return { syncedAt, fileCount: writes.length };
  }
}
