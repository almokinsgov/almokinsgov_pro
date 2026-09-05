import { createBlankRahui, normalizeRahui, publicRecord } from './model.js';

const LOCAL_DATA_KEY = 'rahui-map-data-v0.1';
const LOCAL_PUBLIC_CONFIG_KEY = 'rahui-map-public-config-v0.1';

const PUBLIC_CONFIG_DEFAULTS = Object.freeze({
  polygonLabelField: 'title',
  polygonLabelMode: 'hover'
});

export function createStorage(settings, { editor = false } = {}) {
  if (settings.storageMode === 'gas' && settings.gasWebAppUrl) {
    return new GasStorage(settings, editor);
  }
  return new LocalStorageAdapter(editor);
}

export class LocalStorageAdapter {
  constructor(editor = false) {
    this.editor = editor;
  }

  async list() {
    const items = readLocalItems();
    return this.editor ? items : items.filter(item => item.published && !item.archived).map(publicRecord);
  }

  async save(item) {
    if (!this.editor) throw new Error('Public storage is read only.');
    const items = readLocalItems();
    const now = new Date().toISOString();
    const normalized = normalizeRahui(item);
    if (!normalized.id) normalized.id = crypto.randomUUID ? crypto.randomUUID() : fallbackId();
    const index = items.findIndex(existing => existing.id === normalized.id);
    if (index >= 0) {
      const expectedVersion = Number(normalized.version || 0);
      const actualVersion = Number(items[index].version || 1);
      if (expectedVersion && expectedVersion !== actualVersion) throw syncConflictError(actualVersion);
      normalized.createdAt = items[index].createdAt;
      normalized.createdBy = items[index].createdBy;
      normalized.version = (items[index].version || 1) + 1;
      normalized.updatedAt = now;
      items[index] = normalized;
    } else {
      normalized.createdAt = now;
      normalized.updatedAt = now;
      normalized.version = 1;
      items.push(normalized);
    }
    writeLocalItems(items);
    return normalized;
  }

  async archive(id) {
    if (!this.editor) throw new Error('Public storage is read only.');
    const items = readLocalItems();
    const index = items.findIndex(item => item.id === id);
    if (index < 0) throw new Error('Rāhui not found.');
    items[index].archived = true;
    items[index].published = false;
    items[index].updatedAt = new Date().toISOString();
    items[index].version = (items[index].version || 1) + 1;
    writeLocalItems(items);
    return items[index];
  }

  async replaceAll(items) {
    if (!this.editor) throw new Error('Public storage is read only.');
    writeLocalItems(items.map(normalizeRahui));
    return this.list();
  }

  async health() {
    return { ok: true, provider: 'local', count: readLocalItems().length };
  }

  async getPublicConfig() {
    return readLocalPublicConfig();
  }

  async savePublicConfig(config) {
    if (!this.editor) throw new Error('Public storage is read only.');
    const normalized = normalizePublicConfig(config);
    localStorage.setItem(LOCAL_PUBLIC_CONFIG_KEY, JSON.stringify(normalized));
    return normalized;
  }
}

export class GasStorage {
  constructor(settings, editor = false) {
    this.url = settings.gasWebAppUrl.replace(/\/+$/, '');
    this.token = settings.writeToken || '';
    this.editorName = settings.editorName || '';
    this.editor = editor;
  }

  async list() {
    if (this.editor) {
      return this.post({ action: 'list', token: this.token, editorName: this.editorName });
    }
    return jsonpRequest(this.url, { action: 'list', published: '1' });
  }

  async save(item) {
    if (!this.editor) throw new Error('Public storage is read only.');
    return this.post({ action: 'save', token: this.token, editorName: this.editorName, item });
  }

  async archive(id) {
    if (!this.editor) throw new Error('Public storage is read only.');
    return this.post({ action: 'archive', token: this.token, editorName: this.editorName, id });
  }

  async replaceAll(items) {
    if (!this.editor) throw new Error('Public storage is read only.');
    return this.post({ action: 'replaceAll', token: this.token, editorName: this.editorName, items });
  }

  async health() {
    if (this.editor) return this.post({ action: 'health', token: this.token, editorName: this.editorName });
    return jsonpRequest(this.url, { action: 'health' });
  }

  async getPublicConfig() {
    return normalizePublicConfig(await jsonpRequest(this.url, { action: 'config' }));
  }

  async savePublicConfig(config) {
    if (!this.editor) throw new Error('Public storage is read only.');
    return normalizePublicConfig(await this.post({ action: 'saveConfig', token: this.token, editorName: this.editorName, config }));
  }

  async post(payload) {
    const response = await fetch(this.url, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });
    return unwrapResponse(response);
  }
}

export async function seedLocalStorageIfEmpty(sampleUrl = '../data/rahui.sample.json') {
  if (localStorage.getItem(LOCAL_DATA_KEY)) return;
  try {
    const response = await fetch(sampleUrl);
    if (!response.ok) return;
    const data = await response.json();
    const items = Array.isArray(data) ? data : data.items;
    if (Array.isArray(items)) writeLocalItems(items.map(normalizeRahui));
  } catch {
    // Empty local storage is valid. The editor can create its first record.
  }
}

export function readLocalItems() {
  try {
    const parsed = JSON.parse(localStorage.getItem(LOCAL_DATA_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.map(normalizeRahui) : [];
  } catch {
    return [];
  }
}

export function writeLocalItems(items) {
  localStorage.setItem(LOCAL_DATA_KEY, JSON.stringify(items));
}

function jsonpRequest(url, params = {}) {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') return reject(new Error('JSONP requires a browser document.'));
    const callback = `rahuiJsonp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const query = new URLSearchParams({ ...params, prefix: callback });
    const script = document.createElement('script');
    const timeout = setTimeout(() => cleanup(new Error('Backend read timed out.')), 15000);
    window[callback] = payload => {
      if (payload?.ok === false) return cleanup(new Error(payload.error || 'Backend read failed.'));
      cleanup(null, payload?.data ?? payload);
    };
    script.onerror = () => cleanup(new Error('Backend read failed.'));
    script.src = `${url}?${query.toString()}`;
    document.head.append(script);

    function cleanup(error, data) {
      clearTimeout(timeout);
      script.remove();
      try { delete window[callback]; } catch { window[callback] = undefined; }
      if (error) reject(error); else resolve(data);
    }
  });
}

async function unwrapResponse(response) {
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { throw new Error(`Backend returned invalid JSON (${response.status}).`); }
  if (!response.ok || payload.ok === false) throw new Error(payload.error || `Backend request failed (${response.status}).`);
  return payload.data ?? payload;
}


export function normalizePublicConfig(input = {}) {
  const fieldOptions = new Set(['none','title','locationText','authority','iwiHapu','type','basis','summary','status']);
  const modeOptions = new Set(['off','hover','always']);
  return {
    polygonLabelField: fieldOptions.has(input.polygonLabelField) ? input.polygonLabelField : PUBLIC_CONFIG_DEFAULTS.polygonLabelField,
    polygonLabelMode: modeOptions.has(input.polygonLabelMode) ? input.polygonLabelMode : PUBLIC_CONFIG_DEFAULTS.polygonLabelMode
  };
}

export function readLocalPublicConfig() {
  try {
    return normalizePublicConfig(JSON.parse(localStorage.getItem(LOCAL_PUBLIC_CONFIG_KEY) || '{}'));
  } catch {
    return { ...PUBLIC_CONFIG_DEFAULTS };
  }
}

function syncConflictError(actualVersion) {
  const error = new Error(`This rāhui has changed since it was opened. The current stored version is v${actualVersion}. Reload the record before saving so another editor's changes are not overwritten.`);
  error.code = 'VERSION_CONFLICT';
  return error;
}

function fallbackId() {
  return `rahui-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
