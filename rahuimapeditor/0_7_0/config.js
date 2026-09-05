export const APP_VERSION = '0.7.0';
export const SETTINGS_KEY = 'rahui-map-settings-v0.1';

export const DEFAULT_SETTINGS = Object.freeze({
  storageMode: 'local',
  gasWebAppUrl: 'https://script.google.com/macros/s/AKfycbzqfA0qlfKvoAT1sH4_eVucJCvIsacnrKRijSLmPiwz7G0XlTJyBYi1Lm9qt-KuSCa-oA/exec',
  writeToken: '',
  editorName: '',
  tileUrl: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  tileAttribution: '&copy; OpenStreetMap contributors',
  mapCenterLat: -35.25,
  mapCenterLng: 173.55,
  mapZoom: 8,
  publicRecentDays: 30,
  showDebug: false,
  locationLookupEnabled: true,
  locationLookupFarNorthOnly: true,
  locationLookupLimit: 18,
  polygonLabelField: 'title',
  polygonLabelMode: 'hover',
  editorReferenceLayers: []
});

export function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return { ...DEFAULT_SETTINGS, ...saved };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings) {
  const clean = { ...DEFAULT_SETTINGS, ...settings };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(clean));
  return clean;
}

export function exportSettings(settings) {
  return {
    schema: 'rahui-map-settings',
    version: APP_VERSION,
    exportedAt: new Date().toISOString(),
    settings: { ...settings, writeToken: '' }
  };
}
