(() => {
  'use strict';

  const GOOGLE_CLIENT_ID = '445205554964-8mvgjbdnkc5e956ri2r4i4oe5hd78bhs.apps.googleusercontent.com';
  const DRIVE_APPDATA_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
  const AUTH_SCOPES = ['openid', 'email', 'profile', DRIVE_APPDATA_SCOPE].join(' ');
  const WORKSPACE_FILE_NAME = 'teleprompter-workspace.json';
  const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';
  const DRIVE_UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';
  const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
  const STARTER_TITLE = 'Welcome to Teleprompter';
  const STARTER_BODY = 'Write or paste your script here.\n\nOpen the player when you are ready. Use Space to play or pause and the arrow keys to adjust speed.';

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

    async fetchWorkspace() {
      this.requireAuth();
      this.emit('syncing', 'Checking Google Drive…');
      const files = await this.findWorkspaceFiles();
      if (!files.length) {
        this.workspaceFile = null;
        return { file: null, workspace: null, duplicates: 0 };
      }

      let selected = null;
      let selectedWorkspace = null;
      let selectedRank = null;
      let firstError = null;
      for (const file of files) {
        try {
          const workspace = await this.downloadWorkspaceFile(file.id);
          const rank = workspaceSelectionRank(workspace, file);
          if (!selected || compareWorkspaceRanks(rank, selectedRank) > 0) {
            selected = file;
            selectedWorkspace = workspace;
            selectedRank = rank;
          }
        } catch (error) {
          firstError ||= error;
        }
      }
      if (!selected) throw firstError || new Error('No valid Google Drive workspace could be loaded.');
      this.workspaceFile = selected;
      return { file: selected, workspace: selectedWorkspace, duplicates: Math.max(0, files.length - 1) };
    }

    async saveWorkspace(workspace, fileId = '', options = {}) {
      this.requireAuth();
      this.emit('syncing', 'Saving to Google Drive…');
      let targetId = fileId || this.workspaceFile?.id || '';
      if (!targetId && !options.createOnly) {
        const existing = await this.findWorkspaceFile();
        targetId = existing?.id || '';
      }
      if (targetId) this.workspaceFile = await this.updateWorkspaceFile(targetId, workspace);
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

    async findWorkspaceFiles() {
      const query = `name = '${WORKSPACE_FILE_NAME.replace(/'/g, "\\'")}'`;
      const params = new URLSearchParams({
        spaces: 'appDataFolder',
        q: query,
        fields: 'files(id,name,modifiedTime,createdTime,size,appProperties)',
        orderBy: 'modifiedTime desc',
        pageSize: '10'
      });
      const data = await this.requestJson(`${DRIVE_FILES_URL}?${params.toString()}`, { method: 'GET' });
      return Array.isArray(data.files) ? data.files : [];
    }

    async findWorkspaceFile() {
      const files = await this.findWorkspaceFiles();
      return files[0] || null;
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

  function workspaceSelectionRank(workspace, file) {
    const scripts = Array.isArray(workspace?.scripts) ? workspace.scripts : [];
    const exactStarter = scripts.length === 1
      && String(scripts[0]?.title || '') === STARTER_TITLE
      && String(scripts[0]?.body || '') === STARTER_BODY;
    const contentSize = scripts.reduce((total, script) => total + String(script?.title || '').length + String(script?.body || '').length, 0);
    return {
      meaningful: exactStarter ? 0 : (scripts.length || contentSize ? 1 : 0),
      revision: Number(workspace?.cloud?.revision) || 0,
      scriptCount: scripts.length,
      contentSize,
      modified: Date.parse(file?.modifiedTime || '') || 0
    };
  }

  function compareWorkspaceRanks(a, b) {
    if (!b) return 1;
    for (const key of ['meaningful', 'revision', 'scriptCount', 'contentSize', 'modified']) {
      if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1;
    }
    return 0;
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
