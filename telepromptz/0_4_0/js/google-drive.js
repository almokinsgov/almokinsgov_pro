(() => {
  'use strict';

  const GOOGLE_CLIENT_ID = '445205554964-8mvgjbdnkc5e956ri2r4i4oe5hd78bhs.apps.googleusercontent.com';
  const DRIVE_APPDATA_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
  const AUTH_SCOPES = ['openid', 'email', 'profile', DRIVE_APPDATA_SCOPE].join(' ');
  const WORKSPACE_FILE_NAME = 'teleprompter-workspace.json';
  const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';
  const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';
  const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

  class GoogleDriveSync {
    constructor() {
      this.clientId = GOOGLE_CLIENT_ID;
      this.accessToken = '';
      this.tokenExpiresAt = 0;
      this.profile = null;
      this.workspaceFile = null;
      this.tokenClient = null;
      this.pendingAuth = null;
      this.onStatus = () => {};
    }

    configure(options = {}) {
      if (typeof options.onStatus === 'function') this.onStatus = options.onStatus;
    }

    isSecureOrigin() {
      return location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    }

    isSignedIn() {
      return Boolean(this.accessToken && Date.now() < this.tokenExpiresAt - 15_000);
    }

    async signIn() {
      if (!this.isSecureOrigin()) {
        throw new Error('Google sign-in requires HTTPS or localhost.');
      }
      await this.waitForGoogleIdentity();
      this.emit('authorising', 'Opening Google sign-in…');
      const token = await this.requestAccessToken();
      this.accessToken = token.access_token;
      this.tokenExpiresAt = Date.now() + (Math.max(60, Number(token.expires_in) || 3600) * 1000);
      this.profile = await this.fetchUserInfo();
      this.emit('signed-in', `Signed in as ${this.profile.name || this.profile.email || 'Google user'}`);
      return this.profile;
    }

    async signOut() {
      const token = this.accessToken;
      this.accessToken = '';
      this.tokenExpiresAt = 0;
      this.profile = null;
      this.workspaceFile = null;
      if (token && window.google?.accounts?.oauth2?.revoke) {
        await new Promise((resolve) => {
          try { window.google.accounts.oauth2.revoke(token, resolve); } catch (_) { resolve(); }
        });
      }
      this.emit('signed-out', 'Google Drive disconnected');
    }

    async syncWorkspace(localWorkspace, options = {}) {
      this.requireAuth();
      this.emit('syncing', 'Checking Google Drive…');
      const remoteFile = await this.findWorkspaceFile();
      if (!remoteFile) {
        this.workspaceFile = await this.createWorkspaceFile(localWorkspace);
        this.emit('synced', 'Saved to Google Drive');
        return { direction: 'upload', workspace: null, file: this.workspaceFile, reason: 'created' };
      }

      this.workspaceFile = remoteFile;
      const remoteWorkspace = await this.downloadWorkspaceFile(remoteFile.id);
      const localModified = workspaceTimestamp(localWorkspace);
      const remoteModified = workspaceTimestamp(remoteWorkspace);

      if (remoteModified > localModified + 750) {
        let choice = 'remote';
        if (typeof options.onRemoteNewer === 'function') {
          choice = await options.onRemoteNewer(remoteWorkspace, remoteFile);
        }
        if (choice === 'local') {
          this.workspaceFile = await this.updateWorkspaceFile(remoteFile.id, localWorkspace);
          this.emit('synced', 'Local workspace saved to Google Drive');
          return { direction: 'upload', workspace: null, file: this.workspaceFile, reason: 'local-chosen' };
        }
        this.emit('synced', 'Loaded newer workspace from Google Drive');
        return { direction: 'download', workspace: remoteWorkspace, file: remoteFile, reason: 'remote-newer' };
      }

      if (localModified > remoteModified + 750) {
        this.workspaceFile = await this.updateWorkspaceFile(remoteFile.id, localWorkspace);
        this.emit('synced', 'Saved changes to Google Drive');
        return { direction: 'upload', workspace: null, file: this.workspaceFile, reason: 'local-newer' };
      }

      this.emit('synced', 'Google Drive is up to date');
      return { direction: 'none', workspace: null, file: remoteFile, reason: 'same-version' };
    }

    async pushWorkspace(workspace) {
      this.requireAuth();
      this.emit('syncing', 'Saving to Google Drive…');
      const remoteFile = this.workspaceFile || await this.findWorkspaceFile();
      if (remoteFile) this.workspaceFile = await this.updateWorkspaceFile(remoteFile.id, workspace);
      else this.workspaceFile = await this.createWorkspaceFile(workspace);
      this.emit('synced', 'Saved to Google Drive');
      return this.workspaceFile;
    }

    async waitForGoogleIdentity(timeoutMs = 10_000) {
      if (window.google?.accounts?.oauth2?.initTokenClient) return;
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        await delay(80);
        if (window.google?.accounts?.oauth2?.initTokenClient) return;
      }
      throw new Error('Google Identity Services did not load. Check your connection and try again.');
    }

    requestAccessToken() {
      if (this.pendingAuth) return this.pendingAuth;
      this.pendingAuth = new Promise((resolve, reject) => {
        this.tokenClient = window.google.accounts.oauth2.initTokenClient({
          client_id: this.clientId,
          scope: AUTH_SCOPES,
          include_granted_scopes: true,
          prompt: 'select_account',
          callback: (response) => {
            this.pendingAuth = null;
            if (!response || response.error || !response.access_token) {
              reject(new Error(response?.error_description || response?.error || 'Google sign-in did not return an access token.'));
              return;
            }
            resolve(response);
          },
          error_callback: (error) => {
            this.pendingAuth = null;
            reject(new Error(error?.message || error?.type || 'Google sign-in was cancelled.'));
          }
        });
        try {
          this.tokenClient.requestAccessToken();
        } catch (error) {
          this.pendingAuth = null;
          reject(error);
        }
      });
      return this.pendingAuth;
    }

    async fetchUserInfo() {
      return this.requestJson(USERINFO_URL, { method: 'GET' });
    }

    async findWorkspaceFile() {
      const query = `name = '${WORKSPACE_FILE_NAME.replace(/'/g, "\\'")}'`;
      const params = new URLSearchParams({
        spaces: 'appDataFolder',
        q: query,
        fields: 'files(id,name,modifiedTime,createdTime,size,appProperties)',
        orderBy: 'modifiedTime desc',
        pageSize: '10'
      });
      const data = await this.requestJson(`${DRIVE_FILES_URL}?${params.toString()}`, { method: 'GET' });
      return Array.isArray(data.files) && data.files.length ? data.files[0] : null;
    }

    async downloadWorkspaceFile(fileId) {
      const response = await this.authorisedFetch(`${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}?alt=media`, { method: 'GET' });
      const text = await response.text();
      try { return JSON.parse(text); } catch (_) { throw new Error('The Google Drive workspace file is not valid JSON.'); }
    }

    async createWorkspaceFile(workspace) {
      const boundary = `teleprompter_${Date.now()}_${Math.random().toString(16).slice(2)}`;
      const metadata = {
        name: WORKSPACE_FILE_NAME,
        mimeType: 'application/json',
        parents: ['appDataFolder'],
        appProperties: {
          teleprompterWorkspace: '1',
          schemaVersion: String(workspace?.schemaVersion || 1)
        }
      };
      const body = [
        `--${boundary}`,
        'Content-Type: application/json; charset=UTF-8',
        '',
        JSON.stringify(metadata),
        `--${boundary}`,
        'Content-Type: application/json; charset=UTF-8',
        '',
        JSON.stringify(workspace),
        `--${boundary}--`,
        ''
      ].join('\r\n');
      return this.requestJson(`${DRIVE_UPLOAD_URL}?uploadType=multipart&fields=id,name,modifiedTime,createdTime,size,appProperties`, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body
      });
    }

    async updateWorkspaceFile(fileId, workspace) {
      return this.requestJson(`${DRIVE_UPLOAD_URL}/${encodeURIComponent(fileId)}?uploadType=media&fields=id,name,modifiedTime,createdTime,size,appProperties`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        body: JSON.stringify(workspace)
      });
    }

    async requestJson(url, options = {}) {
      const response = await this.authorisedFetch(url, options);
      if (response.status === 204) return {};
      const text = await response.text();
      if (!text) return {};
      try { return JSON.parse(text); } catch (_) { return { raw: text }; }
    }

    async authorisedFetch(url, options = {}) {
      this.requireAuth();
      const headers = new Headers(options.headers || {});
      headers.set('Authorization', `Bearer ${this.accessToken}`);
      const response = await fetch(url, { ...options, headers });
      if (response.ok) return response;

      let detail = '';
      try {
        const data = await response.clone().json();
        detail = data?.error?.message || data?.error_description || '';
      } catch (_) {}
      if (response.status === 401) {
        this.accessToken = '';
        this.tokenExpiresAt = 0;
        this.emit('expired', 'Google session expired. Reconnect to continue syncing.');
      }
      throw new Error(detail || `Google request failed (${response.status}).`);
    }

    requireAuth() {
      if (!this.isSignedIn()) throw new Error('Google Drive is not connected.');
    }

    emit(state, message, extra = {}) {
      try { this.onStatus({ state, message, profile: this.profile, ...extra }); } catch (_) {}
    }
  }

  function workspaceTimestamp(workspace) {
    const value = workspace?.modifiedAt || workspace?.updatedAt || '';
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp)) return timestamp;
    const scripts = Array.isArray(workspace?.scripts) ? workspace.scripts : [];
    return scripts.reduce((latest, script) => Math.max(latest, Date.parse(script.updatedAt || '') || 0), 0);
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  window.TeleprompterGoogleDrive = {
    CLIENT_ID: GOOGLE_CLIENT_ID,
    DRIVE_SCOPE: DRIVE_APPDATA_SCOPE,
    sync: new GoogleDriveSync()
  };
})();
