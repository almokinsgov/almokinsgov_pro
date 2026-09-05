const STATUS_VALUES = new Set(['auto', 'active', 'upcoming', 'lifted', 'ended']);


export function createRahuiId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `rahui-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createBlankRahui(overrides = {}) {
  const now = new Date().toISOString();
  return normalizeRahui({
    id: '',
    title: '',
    summary: '',
    description: '',
    locationText: '',
    type: 'Other',
    reason: '',
    basis: 'Customary rāhui',
    legalBasis: '',
    authority: '',
    iwiHapu: '',
    marae: '',
    contactName: '',
    contactDetails: '',
    notifiedDate: '',
    startDate: '',
    endDate: '',
    reviewDate: '',
    liftedDate: '',
    statusOverride: 'auto',
    restrictions: '',
    exceptions: '',
    affectedActivities: [],
    sourceLinks: [],
    locationReferences: [],
    geometry: null,
    published: false,
    archived: false,
    internalNotes: '',
    createdAt: now,
    updatedAt: now,
    createdBy: '',
    updatedBy: '',
    version: 1,
    ...overrides
  });
}

export function normalizeRahui(input = {}) {
  const item = { ...input };
  item.id = String(item.id || '');
  item.title = String(item.title || '').trim();
  item.summary = String(item.summary || '').trim();
  item.description = String(item.description || '').trim();
  item.locationText = String(item.locationText || '').trim();
  item.type = String(item.type || 'Other').trim();
  item.reason = String(item.reason || '').trim();
  item.basis = String(item.basis || 'Customary rāhui').trim();
  item.legalBasis = String(item.legalBasis || '').trim();
  item.authority = String(item.authority || '').trim();
  item.iwiHapu = String(item.iwiHapu || '').trim();
  item.marae = String(item.marae || '').trim();
  item.contactName = String(item.contactName || '').trim();
  item.contactDetails = String(item.contactDetails || '').trim();
  item.notifiedDate = cleanDate(item.notifiedDate);
  item.startDate = cleanDate(item.startDate);
  item.endDate = cleanDate(item.endDate);
  item.reviewDate = cleanDate(item.reviewDate);
  item.liftedDate = cleanDate(item.liftedDate);
  item.statusOverride = STATUS_VALUES.has(item.statusOverride) ? item.statusOverride : 'auto';
  item.restrictions = String(item.restrictions || '').trim();
  item.exceptions = String(item.exceptions || '').trim();
  item.affectedActivities = normalizeStringArray(item.affectedActivities);
  item.sourceLinks = normalizeLinks(item.sourceLinks);
  item.locationReferences = normalizeLocationReferences(item.locationReferences);
  item.geometry = normalizeGeometry(item.geometry);
  item.published = toBoolean(item.published);
  item.archived = toBoolean(item.archived);
  item.internalNotes = String(item.internalNotes || '').trim();
  item.createdAt = String(item.createdAt || new Date().toISOString());
  item.updatedAt = String(item.updatedAt || item.createdAt);
  item.createdBy = String(item.createdBy || '').trim();
  item.updatedBy = String(item.updatedBy || '').trim();
  item.version = Math.max(1, Number(item.version) || 1);
  return item;
}

export function validateRahui(item) {
  const errors = [];
  if (!item.title) errors.push('A title is required.');
  if (!item.geometry) errors.push('At least one polygon is required.');
  if (item.startDate && item.endDate && item.endDate < item.startDate) errors.push('End date cannot be before start date.');
  if (item.liftedDate && item.startDate && item.liftedDate < item.startDate) errors.push('Lifted date cannot be before start date.');
  if (item.published && !item.summary && !item.description) errors.push('Published records need a public summary or description.');
  return errors;
}

export function getComputedStatus(item, now = new Date()) {
  if (item.archived) return 'archived';
  if (item.statusOverride && item.statusOverride !== 'auto') return item.statusOverride;
  const today = localDateKey(now);
  if (item.liftedDate && item.liftedDate <= today) return 'lifted';
  if (item.startDate && item.startDate > today) return 'upcoming';
  if (item.endDate && item.endDate < today) return 'expired';
  return 'active';
}

export function isPubliclyVisible(item, now = new Date(), includeRecentDays = 30) {
  if (!item.published || item.archived) return false;
  const status = getComputedStatus(item, now);
  if (status === 'active' || status === 'upcoming') return true;
  const terminalDate = item.liftedDate || item.endDate;
  if (!terminalDate || includeRecentDays <= 0) return false;
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - includeRecentDays);
  return terminalDate >= localDateKey(cutoff);
}

export function geometryFromFeatureCollection(featureCollection) {
  if (!featureCollection || featureCollection.type !== 'FeatureCollection') return null;
  const polygons = [];
  for (const feature of featureCollection.features || []) {
    const geometry = feature?.geometry;
    if (!geometry) continue;
    if (geometry.type === 'Polygon') polygons.push(geometry.coordinates);
    if (geometry.type === 'MultiPolygon') polygons.push(...geometry.coordinates);
  }
  if (!polygons.length) return null;
  return polygons.length === 1
    ? { type: 'Polygon', coordinates: polygons[0] }
    : { type: 'MultiPolygon', coordinates: polygons };
}

export function geometryToFeatureCollection(geometry) {
  if (!geometry) return { type: 'FeatureCollection', features: [] };
  if (geometry.type === 'Polygon') {
    return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry }] };
  }
  if (geometry.type === 'MultiPolygon') {
    return {
      type: 'FeatureCollection',
      features: geometry.coordinates.map(coordinates => ({
        type: 'Feature',
        properties: {},
        geometry: { type: 'Polygon', coordinates }
      }))
    };
  }
  return { type: 'FeatureCollection', features: [] };
}

export function toGeoJsonFeature(item) {
  return {
    type: 'Feature',
    id: item.id,
    properties: {
      id: item.id,
      title: item.title,
      summary: item.summary,
      type: item.type,
      basis: item.basis,
      authority: item.authority,
      startDate: item.startDate,
      endDate: item.endDate,
      status: getComputedStatus(item)
    },
    geometry: item.geometry
  };
}

export function publicRecord(item) {
  const normalized = normalizeRahui(item);
  const {
    internalNotes, createdBy, updatedBy, writeToken, ...safe
  } = normalized;
  return safe;
}

export function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeGeometry(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.type === 'Feature') value = value.geometry;
  if (!['Polygon', 'MultiPolygon'].includes(value.type) || !Array.isArray(value.coordinates)) return null;
  return JSON.parse(JSON.stringify({ type: value.type, coordinates: value.coordinates }));
}

function normalizeLinks(value) {
  if (typeof value === 'string') {
    return value.split(/\r?\n/).map(url => ({ label: '', url: url.trim() })).filter(link => link.url);
  }
  if (!Array.isArray(value)) return [];
  return value.map(link => {
    if (typeof link === 'string') return { label: '', url: link.trim() };
    return { label: String(link?.label || '').trim(), url: String(link?.url || '').trim() };
  }).filter(link => link.url);
}

function normalizeLocationReferences(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const result = [];
  for (const ref of value) {
    if (!ref || typeof ref !== 'object') continue;
    const source = String(ref.source || '').trim();
    const sourceId = String(ref.sourceId || '').trim();
    const name = String(ref.name || '').trim();
    if (!source || !name) continue;
    const key = `${source}:${sourceId || name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      source,
      sourceId,
      name,
      featureType: String(ref.featureType || '').trim(),
      status: String(ref.status || '').trim(),
      sourceUrl: String(ref.sourceUrl || '').trim()
    });
  }
  return result;
}

function normalizeStringArray(value) {
  if (Array.isArray(value)) return [...new Set(value.map(v => String(v).trim()).filter(Boolean))];
  if (typeof value === 'string') return [...new Set(value.split(/[,\n]/).map(v => v.trim()).filter(Boolean))];
  return [];
}

export function cleanDate(value) {
  if (value == null || value === '') return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) return localDateKey(value);
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) {
    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) return localDateKey(parsed);
  }
  return '';
}

function toBoolean(value) {
  if (typeof value === 'boolean') return value;
  return ['true', '1', 'yes', 'y'].includes(String(value || '').toLowerCase());
}
