import { getComputedStatus } from './model.js';

export const RAHUI_TYPE_STYLES = Object.freeze({
  'Coastal or marine': { color: '#147d92', label: 'Coastal or marine' },
  'Freshwater': { color: '#2879b8', label: 'Freshwater' },
  'Land or access': { color: '#a5672a', label: 'Land or access' },
  'Food gathering': { color: '#3f8750', label: 'Food gathering' },
  'Site or wāhi': { color: '#7c5aa6', label: 'Site or wāhi' },
  'Other': { color: '#68756f', label: 'Other' }
});

export const RAHUI_STATUS_STYLES = Object.freeze({
  active: { label: 'Active', dashArray: '', opacity: 1 },
  upcoming: { label: 'Upcoming', dashArray: '8 5', opacity: 1 },
  expired: { label: 'Ended', dashArray: '', opacity: 0.55 },
  ended: { label: 'Ended', dashArray: '', opacity: 0.55 },
  lifted: { label: 'Lifted', dashArray: '4 6', opacity: 0.45 },
  archived: { label: 'Archived', dashArray: '2 7', opacity: 0.35 }
});

export function createBaseMap(elementId, settings, options = {}) {
  if (!window.L) throw new Error('Leaflet did not load. Check the Leaflet script reference.');
  const map = L.map(elementId, {
    zoomControl: options.zoomControl !== false,
    preferCanvas: true
  }).setView([Number(settings.mapCenterLat), Number(settings.mapCenterLng)], Number(settings.mapZoom));

  L.tileLayer(settings.tileUrl, {
    attribution: settings.tileAttribution,
    maxZoom: 20
  }).addTo(map);
  return map;
}

export function styleForRahui(item) {
  const status = getComputedStatus(item);
  const typeStyle = RAHUI_TYPE_STYLES[item?.type] || RAHUI_TYPE_STYLES.Other;
  const statusStyle = RAHUI_STATUS_STYLES[status] || RAHUI_STATUS_STYLES.active;
  const ended = ['expired', 'ended', 'lifted', 'archived'].includes(status);
  return {
    color: ended ? '#68736e' : darkenHex(typeStyle.color, 0.22),
    fillColor: ended ? '#929b96' : typeStyle.color,
    fillOpacity: ended ? 0.12 : (status === 'upcoming' ? 0.22 : 0.3),
    opacity: statusStyle.opacity,
    weight: status === 'archived' ? 1.5 : 3,
    dashArray: statusStyle.dashArray || undefined
  };
}

export function addRahuiLegend(map, options = {}) {
  if (!map || !window.L) return null;
  const control = L.control({ position: options.position || 'bottomright' });
  control.onAdd = () => {
    const container = L.DomUtil.create('div', 'rahui-map-legend');
    const typeRows = Object.values(RAHUI_TYPE_STYLES).map(item => `<li><span class="legend-type-swatch" style="--legend-colour:${escapeHtml(item.color)}"></span><span>${escapeHtml(item.label)}</span></li>`).join('');
    const statusRows = [
      ['active', 'Active'],
      ['upcoming', 'Upcoming'],
      ['expired', 'Ended'],
      ['lifted', 'Lifted']
    ].map(([key, label]) => `<li><span class="legend-status-line ${key}"></span><span>${escapeHtml(label)}</span></li>`).join('');
    container.innerHTML = `<details ${options.collapsed ? '' : 'open'}><summary>Map legend</summary><div class="rahui-map-legend-body"><strong>Rāhui type</strong><ul>${typeRows}</ul><strong>Status</strong><ul>${statusRows}</ul></div></details>`;
    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.disableScrollPropagation(container);
    return container;
  };
  control.addTo(map);
  return control;
}

export function polygonLabelValue(item, field = 'title') {
  if (!item || field === 'none') return '';
  if (field === 'status') {
    const status = getComputedStatus(item);
    return ({ active: 'Active', upcoming: 'Upcoming', expired: 'Ended', ended: 'Ended', lifted: 'Lifted', archived: 'Archived' })[status] || status;
  }
  const allowed = new Set(['title','locationText','authority','iwiHapu','type','basis','summary']);
  if (!allowed.has(field)) field = 'title';
  return String(item[field] || '').trim();
}

export function bindPolygonLabel(layer, item, settings = {}) {
  const mode = settings.polygonLabelMode || 'hover';
  const value = polygonLabelValue(item, settings.polygonLabelField || 'title');
  if (!value || mode === 'off') return layer;
  layer.bindTooltip(escapeHtml(value), {
    permanent: mode === 'always',
    sticky: mode !== 'always',
    direction: mode === 'always' ? 'center' : 'auto',
    className: mode === 'always' ? 'rahui-polygon-label permanent' : 'rahui-polygon-label'
  });
  return layer;
}

export function fitGeometry(map, geometry, options = {}) {
  if (!geometry) return false;
  const layer = L.geoJSON({ type: 'Feature', properties: {}, geometry });
  const bounds = layer.getBounds();
  if (!bounds.isValid()) return false;
  map.fitBounds(bounds, { padding: [24, 24], maxZoom: options.maxZoom || 15 });
  return true;
}

export function formatDate(value) {
  if (!value) return '';
  const parts = value.split('-').map(Number);
  if (parts.length !== 3) return value;
  return new Intl.DateTimeFormat('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(parts[0], parts[1] - 1, parts[2]));
}

export function dateSummary(item) {
  if (item.startDate && item.endDate) return `${formatDate(item.startDate)} to ${formatDate(item.endDate)}`;
  if (item.startDate) return `From ${formatDate(item.startDate)} until further notice`;
  if (item.endDate) return `Until ${formatDate(item.endDate)}`;
  return 'Dates not specified';
}

export function safeHref(value) {
  try {
    const url = new URL(String(value || ''));
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function darkenHex(hex, amount) {
  const value = String(hex || '').replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(value)) return hex;
  const factor = Math.max(0, Math.min(1, 1 - amount));
  const parts = [0, 2, 4].map(index => Math.round(parseInt(value.slice(index, index + 2), 16) * factor).toString(16).padStart(2, '0'));
  return `#${parts.join('')}`;
}
