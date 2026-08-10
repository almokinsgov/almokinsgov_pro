(() => {
  'use strict';

  class LocalStorageProvider {
    constructor(storageKey) {
      this.id = 'local';
      this.label = 'Local browser storage';
      this.storageKey = storageKey;
    }

    loadWorkspace() {
      const raw = localStorage.getItem(this.storageKey);
      return raw ? JSON.parse(raw) : null;
    }

    saveWorkspace(workspace) {
      localStorage.setItem(this.storageKey, JSON.stringify(workspace));
    }

    clearWorkspace() {
      localStorage.removeItem(this.storageKey);
    }
  }

  class StorageProviderManager {
    constructor() {
      this.provider = null;
    }

    use(provider) {
      if (!provider || typeof provider.loadWorkspace !== 'function' || typeof provider.saveWorkspace !== 'function') {
        throw new TypeError('Storage provider must implement loadWorkspace() and saveWorkspace().');
      }
      this.provider = provider;
      return provider;
    }

    loadWorkspace() {
      if (!this.provider) throw new Error('No storage provider configured.');
      return this.provider.loadWorkspace();
    }

    saveWorkspace(workspace) {
      if (!this.provider) throw new Error('No storage provider configured.');
      return this.provider.saveWorkspace(workspace);
    }
  }

  window.TeleprompterStorage = {
    LocalStorageProvider,
    manager: new StorageProviderManager()
  };
})();
