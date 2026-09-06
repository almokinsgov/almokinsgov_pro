const SERVICES = Object.freeze({
  gazetteer: {
    id: 'linz-gazetteer',
    label: 'LINZ Place Names',
    shortLabel: 'Place names',
    endpoint: 'https://services.arcgis.com/xdsHIIxuCWByZiCB/ArcGIS/rest/services/LINZ_NZ_Place_Names/FeatureServer/0/query',
    layerUrl: 'https://data.linz.govt.nz/layer/51681-nz-place-names-nzgb/',
    geometryKind: 'point',
    minZoom: 9
  },
  localities: {
    id: 'linz-localities',
    label: 'LINZ Suburbs and Localities',
    shortLabel: 'Suburbs and localities',
    endpoint: 'https://services.arcgis.com/xdsHIIxuCWByZiCB/ArcGIS/rest/services/LINZ_NZ_Suburbs_and_Localities/FeatureServer/0/query',
    layerUrl: 'https://data.linz.govt.nz/layer/113764-nz-suburbs-and-localities/',
    geometryKind: 'polygon',
    minZoom: 7
  },
  riverLines: {
    id: 'linz-river-lines-pilot',
    label: 'LINZ River Name Lines (pilot)',
    shortLabel: 'River name lines',
    endpoint: 'https://services.arcgis.com/xdsHIIxuCWByZiCB/ArcGIS/rest/services/LINZ_NZ_River_Name_Lines_Pilot/FeatureServer/0/query',
    layerUrl: 'https://data.linz.govt.nz/layer/103632-nz-river-name-lines-pilot/',
    geometryKind: 'line',
    minZoom: 9
  },
  riverPolygons: {
    id: 'linz-river-polygons-pilot',
    label: 'LINZ River Name Polygons (pilot)',
    shortLabel: 'River name areas',
    endpoint: 'https://services.arcgis.com/xdsHIIxuCWByZiCB/ArcGIS/rest/services/LINZ_NZ_River_Name_Polygons_Pilot/FeatureServer/0/query',
    layerUrl: 'https://data.linz.govt.nz/layer/103631-nz-river-name-polygons-pilot/',
    geometryKind: 'polygon',
    minZoom: 9
  }
});

export function getLocationSources() {
  return SERVICES;
}

export async function searchLocationLookups(term, options = {}) {
  const query = String(term || '').trim();
  if (query.length < 2) return [];
  const limit = clamp(Number(options.limit) || 18, 1, 50);
  const farNorthOnly = options.farNorthOnly !== false;
  const sources = new Set(Array.isArray(options.sources) && options.sources.length ? options.sources : ['localities', 'gazetteer', 'rivers']);
  const jobs = [];

  if (sources.has('localities')) jobs.push(searchLocalities(query, limit, farNorthOnly));
  if (sources.has('gazetteer')) jobs.push(searchGazetteer(query, limit, farNorthOnly));
  if (sources.has('rivers')) jobs.push(searchRivers(query, limit));

  const settled = await Promise.allSettled(jobs);
  const coordinate = parseCoordinate(query);
  const results = coordinate ? [coordinate] : [];
  const errors = [];
  for (const item of settled) {
    if (item.status === 'fulfilled') results.push(...item.value);
    else errors.push(item.reason?.message || String(item.reason || 'Lookup failed.'));
  }
  if (!results.length && errors.length === settled.length) throw new Error(errors[0]);
  return rankAndDedupe(results, query).slice(0, limit);
}

export async function searchLocalities(term, limit = 18, farNorthOnly = true) {
  const q = arcLiteral(term);
  const textWhere = `(name LIKE '%${q}%' OR additional_name LIKE '%${q}%' OR major_name LIKE '%${q}%' OR name_ascii LIKE '%${q}%')`;
  const where = farNorthOnly ? `${textWhere} AND territorial_authority LIKE '%Far North%'` : textWhere;
  const data = await arcGisGeoJson(SERVICES.localities.endpoint, {
    where,
    outFields: 'id,name,additional_name,type,major_name,territorial_authority,population_estimate',
    resultRecordCount: limit,
    orderByFields: 'name'
  });
  return (data.features || []).map(mapLocalityFeature);
}

export async function searchGazetteer(term, limit = 18, farNorthOnly = true) {
  const q = arcLiteral(term);
  const textWhere = `name LIKE '%${q}%'`;
  const where = farNorthOnly ? `${textWhere} AND territorial_authority LIKE '%Far North%'` : textWhere;
  const data = await arcGisGeoJson(SERVICES.gazetteer.endpoint, {
    where,
    outFields: 'name_id,name,status,feat_type,crd_latitude,crd_longitude,maori_name,territorial_authority,info_description',
    resultRecordCount: limit,
    orderByFields: 'name'
  });
  return (data.features || []).map(mapGazetteerFeature);
}

export async function searchRivers(term, limit = 18) {
  const perSource = Math.max(5, Math.ceil(limit / 2));
  const q = arcLiteral(term);
  const where = `name LIKE '%${q}%'`;
  const [lines, polygons] = await Promise.allSettled([
    arcGisGeoJson(SERVICES.riverLines.endpoint, {
      where,
      outFields: 'river_section_id,feat_type,name,name_ascii',
      resultRecordCount: perSource,
      orderByFields: 'name'
    }),
    arcGisGeoJson(SERVICES.riverPolygons.endpoint, {
      where,
      outFields: '*',
      resultRecordCount: perSource,
      orderByFields: 'name'
    })
  ]);
  if (lines.status === 'rejected' && polygons.status === 'rejected') throw lines.reason;
  const features = [];
  if (lines.status === 'fulfilled') features.push(...mapRiverFeatures(lines.value.features || [], SERVICES.riverLines, 'line'));
  if (polygons.status === 'fulfilled') features.push(...mapRiverFeatures(polygons.value.features || [], SERVICES.riverPolygons, 'polygon'));
  return features;
}

/**
 * Find named LINZ context that spatially intersects a rāhui Polygon or MultiPolygon.
 * The result is deliberately derived at read time rather than written into the rāhui record.
 */
export async function findAffectedLocations(geometry, options = {}) {
  const polygonQueries = geometryToArcGisPolygonQueries(geometry);
  if (!polygonQueries.length) return emptyAffectedResult();
  const limit = clamp(Number(options.limit) || 250, 10, 2000);
  const farNorthOnly = options.farNorthOnly !== false;

  const jobs = {
    areas: queryFeaturesForPolygons(SERVICES.localities, polygonQueries, {
      where: farNorthOnly ? `territorial_authority LIKE '%Far North%'` : '1=1',
      outFields: 'id,name,additional_name,type,major_name,territorial_authority,population_estimate',
      returnGeometry: false,
      resultRecordCount: limit
    }),
    places: queryFeaturesForPolygons(SERVICES.gazetteer, polygonQueries, {
      where: farNorthOnly ? `territorial_authority LIKE '%Far North%'` : '1=1',
      outFields: 'name_id,name,status,feat_type,territorial_authority',
      returnGeometry: false,
      resultRecordCount: limit
    }),
    riverLines: queryFeaturesForPolygons(SERVICES.riverLines, polygonQueries, {
      where: `name IS NOT NULL AND name <> ''`,
      outFields: 'river_section_id,feat_type,name,name_ascii',
      returnGeometry: false,
      resultRecordCount: limit
    }),
    riverPolygons: queryFeaturesForPolygons(SERVICES.riverPolygons, polygonQueries, {
      where: `name IS NOT NULL AND name <> ''`,
      outFields: '*',
      returnGeometry: false,
      resultRecordCount: limit
    })
  };

  const entries = Object.entries(jobs);
  const settled = await Promise.allSettled(entries.map(([, promise]) => promise));
  const raw = {};
  const errors = [];
  let truncated = false;
  settled.forEach((result, index) => {
    const key = entries[index][0];
    if (result.status === 'fulfilled') {
      raw[key] = result.value.features;
      truncated = truncated || result.value.truncated;
    } else {
      raw[key] = [];
      errors.push(result.reason?.message || `${key} lookup failed.`);
    }
  });

  const areas = dedupeBy(raw.areas.map(mapAffectedArea), item => item.id || `${item.name}:${item.type}`)
    .sort((a, b) => a.name.localeCompare(b.name));
  const places = dedupeBy(raw.places.map(mapAffectedPlace), item => item.id || `${item.name}:${item.type}`)
    .sort((a, b) => a.name.localeCompare(b.name));
  const waterways = dedupeBy([
    ...raw.riverLines.map(feature => mapAffectedWaterway(feature, 'line')),
    ...raw.riverPolygons.map(feature => mapAffectedWaterway(feature, 'area'))
  ], item => fold(item.name))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    areas,
    places,
    waterways,
    counts: { areas: areas.length, places: places.length, waterways: waterways.length },
    truncated,
    errors,
    checkedAt: new Date().toISOString()
  };
}

/** Query one reference layer against the current Leaflet map extent. */
export async function queryReferenceLayer(sourceKey, bounds, options = {}) {
  const source = SERVICES[sourceKey];
  if (!source) throw new Error(`Unknown reference layer: ${sourceKey}`);
  const envelope = boundsToArcGisEnvelope(bounds);
  if (!envelope) return { type: 'FeatureCollection', features: [], source, truncated: false };
  const limit = clamp(Number(options.limit) || 500, 20, 2000);
  const farNorthOnly = options.farNorthOnly !== false;
  let where = '1=1';
  let outFields = '*';
  if (sourceKey === 'localities') {
    where = farNorthOnly ? `territorial_authority LIKE '%Far North%'` : '1=1';
    outFields = 'id,name,additional_name,type,major_name,territorial_authority,population_estimate';
  } else if (sourceKey === 'gazetteer') {
    where = farNorthOnly ? `territorial_authority LIKE '%Far North%'` : '1=1';
    outFields = 'name_id,name,status,feat_type,territorial_authority';
  } else {
    where = `name IS NOT NULL AND name <> ''`;
    outFields = sourceKey === 'riverLines' ? 'river_section_id,feat_type,name,name_ascii' : '*';
  }
  const payload = await arcGisGeoJson(source.endpoint, {
    where,
    outFields,
    geometry: envelope,
    geometryType: 'esriGeometryEnvelope',
    inSR: 4326,
    spatialRel: 'esriSpatialRelIntersects',
    returnGeometry: true,
    resultRecordCount: limit
  });
  return {
    type: 'FeatureCollection',
    features: payload.features || [],
    source,
    truncated: Boolean(payload.exceededTransferLimit)
  };
}

export function parseCoordinate(value) {
  const match = String(value || '').trim().match(/^(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!match) return null;
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  const name = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
  return {
    kind: 'coordinate',
    source: 'coordinate',
    sourceLabel: 'Coordinate',
    sourceId: name,
    name,
    featureType: 'Latitude and longitude',
    status: '',
    detail: 'Coordinate reference',
    sourceUrl: '',
    geometry: { type: 'Point', coordinates: [longitude, latitude] },
    properties: { latitude, longitude },
    authoritativeName: false,
    geometryNote: 'Direct WGS84 latitude and longitude reference.'
  };
}

export async function arcGisGeoJson(endpoint, parameters = {}, timeoutMs = 12000) {
  const url = buildArcGisQueryUrl(endpoint, parameters);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/geo+json,application/json' } });
    const text = await response.text();
    let payload;
    try { payload = JSON.parse(text); } catch { throw new Error(`Location source returned invalid JSON (${response.status}).`); }
    if (!response.ok || payload.error) throw new Error(payload.error?.message || `Location lookup failed (${response.status}).`);
    return payload;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('Location lookup timed out.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function buildArcGisQueryUrl(endpoint, parameters = {}) {
  const params = new URLSearchParams({
    where: parameters.where || '1=1',
    outFields: parameters.outFields || '*',
    returnGeometry: parameters.returnGeometry === false ? 'false' : 'true',
    outSR: String(parameters.outSR || 4326),
    f: parameters.f || 'geojson',
    resultRecordCount: String(clamp(Number(parameters.resultRecordCount) || 18, 1, 2000))
  });
  if (parameters.orderByFields) params.set('orderByFields', parameters.orderByFields);
  if (parameters.geometry !== undefined && parameters.geometry !== null && parameters.geometry !== '') params.set('geometry', typeof parameters.geometry === 'string' ? parameters.geometry : JSON.stringify(parameters.geometry));
  if (parameters.geometryType) params.set('geometryType', parameters.geometryType);
  if (parameters.inSR) params.set('inSR', String(parameters.inSR));
  if (parameters.spatialRel) params.set('spatialRel', parameters.spatialRel);
  if (parameters.resultOffset !== undefined) params.set('resultOffset', String(Math.max(0, Number(parameters.resultOffset) || 0)));
  return `${endpoint}?${params.toString()}`;
}

export function geometryToArcGisPolygonQueries(geometry) {
  if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type)) return [];
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  return polygons
    .filter(polygon => Array.isArray(polygon) && polygon.length)
    .map(rings => ({
      rings: rings.map((ring, index) => orientArcGisRing(ring, index === 0)),
      spatialReference: { wkid: 4326 }
    }));
}

export function boundsToArcGisEnvelope(bounds) {
  if (!bounds) return '';
  const west = Number(typeof bounds.getWest === 'function' ? bounds.getWest() : bounds.west);
  const south = Number(typeof bounds.getSouth === 'function' ? bounds.getSouth() : bounds.south);
  const east = Number(typeof bounds.getEast === 'function' ? bounds.getEast() : bounds.east);
  const north = Number(typeof bounds.getNorth === 'function' ? bounds.getNorth() : bounds.north);
  if (![west, south, east, north].every(Number.isFinite)) return '';
  return `${west},${south},${east},${north}`;
}

export function toLocationReference(result) {
  return {
    source: String(result?.source || ''),
    sourceId: String(result?.sourceId || ''),
    name: String(result?.name || ''),
    featureType: String(result?.featureType || ''),
    status: String(result?.status || ''),
    sourceUrl: String(result?.sourceUrl || '')
  };
}

function mapLocalityFeature(feature) {
  const p = feature.properties || {};
  return {
    kind: 'locality',
    source: SERVICES.localities.id,
    sourceLabel: SERVICES.localities.label,
    sourceId: String(p.id ?? p.OBJECTID ?? ''),
    name: p.name || p.major_name || 'Unnamed locality',
    featureType: p.type || 'Suburb or locality',
    status: '',
    detail: [p.major_name && p.major_name !== p.name ? `Major area: ${p.major_name}` : '', p.territorial_authority || ''].filter(Boolean).join(' · '),
    sourceUrl: SERVICES.localities.layerUrl,
    geometry: feature.geometry || null,
    properties: p,
    authoritativeName: false,
    geometryNote: 'Administrative suburb or locality boundary for addressing and location purposes.'
  };
}

function mapGazetteerFeature(feature) {
  const p = feature.properties || {};
  const nameId = String(p.name_id ?? p.OBJECTID ?? '');
  return {
    kind: 'gazetteer',
    source: SERVICES.gazetteer.id,
    sourceLabel: SERVICES.gazetteer.label,
    sourceId: nameId,
    name: p.name || 'Unnamed place',
    featureType: p.feat_type || 'Place',
    status: p.status || '',
    detail: [p.status || '', p.feat_type || '', p.territorial_authority || ''].filter(Boolean).join(' · '),
    sourceUrl: nameId ? `https://gazetteer.linz.govt.nz/place/${encodeURIComponent(nameId)}` : SERVICES.gazetteer.layerUrl,
    geometry: feature.geometry || pointFromProperties(p),
    properties: p,
    authoritativeName: true,
    geometryNote: 'Gazetteer reference point. It may not represent the full extent of the named feature.'
  };
}

function mapAffectedArea(feature) {
  const p = feature.properties || {};
  return {
    id: String(p.id ?? p.OBJECTID ?? ''),
    name: p.name || p.major_name || 'Unnamed area',
    type: p.type || 'Locality',
    majorName: p.major_name || '',
    additionalName: p.additional_name || '',
    territorialAuthority: p.territorial_authority || '',
    source: SERVICES.localities.id,
    sourceUrl: SERVICES.localities.layerUrl
  };
}

function mapAffectedPlace(feature) {
  const p = feature.properties || {};
  const id = String(p.name_id ?? p.OBJECTID ?? '');
  return {
    id,
    name: p.name || 'Unnamed place',
    type: p.feat_type || 'Place',
    status: p.status || '',
    territorialAuthority: p.territorial_authority || '',
    source: SERVICES.gazetteer.id,
    sourceUrl: id ? `https://gazetteer.linz.govt.nz/place/${encodeURIComponent(id)}` : SERVICES.gazetteer.layerUrl
  };
}

function mapAffectedWaterway(feature, geometryKind) {
  const p = feature.properties || {};
  return {
    id: String(p.river_section_id ?? p.OBJECTID ?? p.GlobalID ?? ''),
    name: p.name || p.name_ascii || 'Unnamed waterway',
    type: p.feat_type || 'River',
    geometryKind,
    source: geometryKind === 'line' ? SERVICES.riverLines.id : SERVICES.riverPolygons.id,
    sourceUrl: geometryKind === 'line' ? SERVICES.riverLines.layerUrl : SERVICES.riverPolygons.layerUrl
  };
}

async function queryFeaturesForPolygons(service, polygonQueries, parameters) {
  const responses = await Promise.all(polygonQueries.map(geometry => arcGisGeoJson(service.endpoint, {
    ...parameters,
    geometry,
    geometryType: 'esriGeometryPolygon',
    inSR: 4326,
    spatialRel: 'esriSpatialRelIntersects'
  })));
  return {
    features: responses.flatMap(payload => payload.features || []),
    truncated: responses.some(payload => Boolean(payload.exceededTransferLimit))
  };
}

function emptyAffectedResult() {
  return { areas: [], places: [], waterways: [], counts: { areas: 0, places: 0, waterways: 0 }, truncated: false, errors: [], checkedAt: '' };
}

function mapRiverFeatures(features, service, geometryKind) {
  return features.map(feature => {
    const p = feature.properties || {};
    const id = String(p.river_section_id ?? p.OBJECTID ?? p.GlobalID ?? '');
    return {
      kind: 'river',
      source: service.id,
      sourceLabel: service.label,
      sourceId: id,
      name: p.name || p.name_ascii || 'Unnamed river',
      featureType: p.feat_type || 'River',
      status: 'Pilot extent',
      detail: `${p.feat_type || 'River'} · ${geometryKind === 'polygon' ? 'area extent' : 'line extent'} · pilot geometry`,
      sourceUrl: service.layerUrl,
      geometry: feature.geometry || null,
      properties: p,
      authoritativeName: false,
      geometryNote: 'Pilot river extent derived from 2018 Topo50 cartography. Use the Gazetteer result for official naming.'
    };
  });
}


function orientArcGisRing(input, outer) {
  const ring = Array.isArray(input) ? input.map(point => [Number(point?.[0]), Number(point?.[1])]).filter(point => point.every(Number.isFinite)) : [];
  if (ring.length < 3) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([...first]);
  const area = signedRingArea(ring);
  const isClockwise = area < 0;
  const shouldBeClockwise = Boolean(outer);
  if (isClockwise !== shouldBeClockwise) ring.reverse();
  return ring;
}

function signedRingArea(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    sum += (x1 * y2) - (x2 * y1);
  }
  return sum / 2;
}

function pointFromProperties(properties) {
  const latitude = Number(properties?.crd_latitude);
  const longitude = Number(properties?.crd_longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { type: 'Point', coordinates: [longitude, latitude] };
}

function rankAndDedupe(items, query) {
  const needle = fold(query);
  const seen = new Set();
  return items.filter(item => {
    const key = `${item.source}:${item.sourceId || item.name}:${item.geometry?.type || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => score(b, needle) - score(a, needle) || a.name.localeCompare(b.name));
}

function dedupeBy(items, keyFn) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

function score(item, needle) {
  const value = fold(item.name);
  let points = 0;
  if (value === needle) points += 100;
  else if (value.startsWith(needle)) points += 60;
  else if (value.includes(needle)) points += 35;
  if (item.kind === 'locality') points += 8;
  if (item.kind === 'gazetteer' && /official/i.test(item.status)) points += 12;
  if (item.kind === 'river') points += 4;
  return points;
}

function fold(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function arcLiteral(value) {
  return String(value || '').replace(/'/g, "''").replace(/[%_]/g, character => character === '%' ? '[%]' : '[_]');
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
