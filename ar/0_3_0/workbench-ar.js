/* Workbench AR Spatial Subsystem v0.2.0
 * Dependency-free browser module for ArcGIS FeatureServer and GeoJSON AR anchoring.
 * Exposes window.WorkbenchAR.
 */
(function (global) {
  'use strict';

  const VERSION = '0.2.0';
  const EARTH_RADIUS_M = 6371008.8;
  const DEG2RAD = Math.PI / 180;
  const RAD2DEG = 180 / Math.PI;

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const wrap360 = (v) => ((v % 360) + 360) % 360;
  const wrap180 = (v) => {
    const x = wrap360(v);
    return x > 180 ? x - 360 : x;
  };
  const toRad = (d) => d * DEG2RAD;
  const toDeg = (r) => r * RAD2DEG;

  function firstFiniteNumber(values) {
    for (const value of values || []) {
      if (value === null || value === undefined || value === '') continue;
      const number = Number(value);
      if (Number.isFinite(number)) return number;
    }
    return null;
  }

  function haversineM(aLat, aLon, bLat, bLon) {
    const p1 = toRad(aLat);
    const p2 = toRad(bLat);
    const dp = toRad(bLat - aLat);
    const dl = toRad(bLon - aLon);
    const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
    return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function bearingDeg(aLat, aLon, bLat, bLon) {
    const p1 = toRad(aLat);
    const p2 = toRad(bLat);
    const dl = toRad(bLon - aLon);
    const y = Math.sin(dl) * Math.cos(p2);
    const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    return wrap360(toDeg(Math.atan2(y, x)));
  }

  function destinationPoint(lat, lon, distanceM, bearing) {
    const ad = distanceM / EARTH_RADIUS_M;
    const br = toRad(bearing);
    const p1 = toRad(lat);
    const l1 = toRad(lon);
    const p2 = Math.asin(Math.sin(p1) * Math.cos(ad) + Math.cos(p1) * Math.sin(ad) * Math.cos(br));
    const l2 = l1 + Math.atan2(Math.sin(br) * Math.sin(ad) * Math.cos(p1), Math.cos(ad) - Math.sin(p1) * Math.sin(p2));
    return { lat: toDeg(p2), lon: wrap180(toDeg(l2)) };
  }

  function envelopeAround(lat, lon, radiusM) {
    const n = destinationPoint(lat, lon, radiusM, 0);
    const e = destinationPoint(lat, lon, radiusM, 90);
    const s = destinationPoint(lat, lon, radiusM, 180);
    const w = destinationPoint(lat, lon, radiusM, 270);
    return { xmin: w.lon, ymin: s.lat, xmax: e.lon, ymax: n.lat };
  }

  function circularLerpDegrees(current, target, alpha) {
    if (!Number.isFinite(current)) return wrap360(target);
    return wrap360(current + wrap180(target - current) * clamp(alpha, 0, 1));
  }

  function cameraDirectionFromEuler(alphaDeg, betaDeg, gammaDeg) {
    const a = toRad(alphaDeg), b = toRad(betaDeg), g = toRad(gammaDeg);
    const sa = Math.sin(a), ca = Math.cos(a);
    const sb = Math.sin(b), cb = Math.cos(b);
    const sg = Math.sin(g), cg = Math.cos(g);
    // W3C device orientation rotation Z(alpha) X(beta) Y(gamma), applied to rear-camera forward vector [0,0,-1].
    const east = -ca * sg - sa * cg * sb;
    const north = -sa * sg + ca * cg * sb;
    const up = -cg * cb;
    return {
      east, north, up,
      headingDeg: wrap360(toDeg(Math.atan2(east, north))),
      pitchDeg: toDeg(Math.asin(clamp(up, -1, 1)))
    };
  }

  function centroidOfGeometry(geometry) {
    if (!geometry) return null;
    const type = geometry.type;
    const c = geometry.coordinates;
    if (type === 'Point' && Array.isArray(c)) return { lon: c[0], lat: c[1], z: c[2] };
    if (type === 'MultiPoint' && c?.length) return averageCoordinates(c);
    if (type === 'LineString' && c?.length) return lineMidpoint(c);
    if (type === 'MultiLineString' && c?.length) return lineMidpoint(c.flat());
    if (type === 'Polygon' && c?.length) return polygonCentroid(c[0]);
    if (type === 'MultiPolygon' && c?.length) {
      const ring = c.reduce((best, poly) => (poly?.[0]?.length || 0) > (best?.length || 0) ? poly[0] : best, null);
      return ring ? polygonCentroid(ring) : null;
    }
    return null;
  }

  function averageCoordinates(coords) {
    let sx = 0, sy = 0, sz = 0, zc = 0, n = 0;
    for (const p of coords) {
      if (!Array.isArray(p) || p.length < 2) continue;
      sx += Number(p[0]); sy += Number(p[1]); n++;
      if (Number.isFinite(Number(p[2]))) { sz += Number(p[2]); zc++; }
    }
    return n ? { lon: sx / n, lat: sy / n, z: zc ? sz / zc : undefined } : null;
  }

  function lineMidpoint(coords) {
    if (!coords?.length) return null;
    if (coords.length === 1) return averageCoordinates(coords);
    let total = 0;
    const segments = [];
    for (let i = 1; i < coords.length; i++) {
      const a = coords[i - 1], b = coords[i];
      if (!a || !b) continue;
      const d = haversineM(a[1], a[0], b[1], b[0]);
      total += d;
      segments.push({ a, b, d });
    }
    if (!segments.length) return averageCoordinates(coords);
    let remain = total / 2;
    for (const seg of segments) {
      if (remain <= seg.d) {
        const t = seg.d ? remain / seg.d : 0;
        return {
          lon: seg.a[0] + (seg.b[0] - seg.a[0]) * t,
          lat: seg.a[1] + (seg.b[1] - seg.a[1]) * t,
          z: Number.isFinite(seg.a[2]) && Number.isFinite(seg.b[2]) ? seg.a[2] + (seg.b[2] - seg.a[2]) * t : undefined
        };
      }
      remain -= seg.d;
    }
    return averageCoordinates([coords[coords.length - 1]]);
  }

  function polygonCentroid(ring) {
    if (!ring?.length) return null;
    let area2 = 0, cx6a = 0, cy6a = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const x0 = Number(ring[j][0]), y0 = Number(ring[j][1]);
      const x1 = Number(ring[i][0]), y1 = Number(ring[i][1]);
      const cross = x0 * y1 - x1 * y0;
      area2 += cross;
      cx6a += (x0 + x1) * cross;
      cy6a += (y0 + y1) * cross;
    }
    if (Math.abs(area2) < 1e-12) return averageCoordinates(ring);
    return { lon: cx6a / (3 * area2), lat: cy6a / (3 * area2) };
  }

  function canonicalFeature(feature, options = {}) {
    const anchor = centroidOfGeometry(feature?.geometry);
    if (!anchor || !Number.isFinite(anchor.lat) || !Number.isFinite(anchor.lon)) return null;
    const p = feature.properties || {};
    const idField = options.idField;
    const labelField = options.labelField;
    const id = feature.id ?? (idField ? p[idField] : undefined) ?? p.OBJECTID ?? p.objectid ?? cryptoSafeId();
    const label = labelField ? p[labelField] : (p.title ?? p.name ?? p.applicationnumber ?? p.ApplicationNumber ?? String(id));
    const propElev = options.elevationField ? Number(p[options.elevationField]) : NaN;
    return {
      id: String(id),
      sourceId: options.sourceId || 'source',
      label: String(label ?? id),
      lat: Number(anchor.lat),
      lon: Number(anchor.lon),
      z: Number.isFinite(anchor.z) ? Number(anchor.z) : undefined,
      propertyElevationM: Number.isFinite(propElev) ? propElev : undefined,
      geometryType: feature?.geometry?.type || 'Unknown',
      properties: p,
      originalFeature: options.keepOriginal ? feature : undefined
    };
  }

  function cryptoSafeId() {
    if (global.crypto?.randomUUID) return global.crypto.randomUUID();
    return `ar-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  class GridSpatialIndex {
    constructor(cellSizeM = 250) {
      this.cellSizeM = cellSizeM;
      this.items = [];
      this.cells = new Map();
    }
    clear() { this.items = []; this.cells.clear(); }
    _meters(lat, lon) {
      const safeLat = clamp(lat, -85.05112878, 85.05112878);
      const x = EARTH_RADIUS_M * toRad(lon);
      const y = EARTH_RADIUS_M * Math.log(Math.tan(Math.PI / 4 + toRad(safeLat) / 2));
      return { x, y };
    }
    _cellFromMeters(x, y) { return `${Math.floor(y / this.cellSizeM)}:${Math.floor(x / this.cellSizeM)}`; }
    _cell(lat, lon) { const p = this._meters(lat, lon); return this._cellFromMeters(p.x, p.y); }
    add(item) {
      if (!Number.isFinite(item?.lat) || !Number.isFinite(item?.lon)) return;
      this.items.push(item);
      const key = this._cell(item.lat, item.lon);
      if (!this.cells.has(key)) this.cells.set(key, []);
      this.cells.get(key).push(item);
    }
    addMany(items) { for (const item of items || []) this.add(item); }
    query(lat, lon, radiusM, maxItems = 500) {
      if (!this.items.length) return [];
      const centre = this._meters(lat, lon);
      const candidates = [];
      const seen = new Set();
      const a = Math.floor((centre.y - radiusM) / this.cellSizeM);
      const b = Math.floor((centre.y + radiusM) / this.cellSizeM);
      const c = Math.floor((centre.x - radiusM) / this.cellSizeM);
      const d = Math.floor((centre.x + radiusM) / this.cellSizeM);
      for (let y = a; y <= b; y++) {
        for (let x = c; x <= d; x++) {
          for (const item of this.cells.get(`${y}:${x}`) || []) {
            const uid = `${item.sourceId}:${item.id}`;
            if (seen.has(uid)) continue;
            seen.add(uid);
            const distanceM = haversineM(lat, lon, item.lat, item.lon);
            if (distanceM <= radiusM) candidates.push({ item, distanceM });
          }
        }
      }
      candidates.sort((x, y) => x.distanceM - y.distanceM);
      return candidates.slice(0, maxItems);
    }
  }

  class GeoJSONSource {
    constructor(options = {}) {
      this.id = options.id || 'geojson';
      this.name = options.name || this.id;
      this.idField = options.idField;
      this.labelField = options.labelField;
      this.elevationField = options.elevationField;
      this.keepOriginal = !!options.keepOriginal;
      this.index = new GridSpatialIndex(options.cellSizeM || 250);
      this.loaded = false;
      this.featureCount = 0;
    }
    async load(input) {
      let data = input;
      if (input instanceof File || input instanceof Blob) data = JSON.parse(await input.text());
      else if (typeof input === 'string') {
        const response = await fetch(input);
        if (!response.ok) throw new Error(`GeoJSON request failed: ${response.status}`);
        data = await response.json();
      }
      if (!data || data.type !== 'FeatureCollection' || !Array.isArray(data.features)) throw new Error('Expected a GeoJSON FeatureCollection.');
      this.index.clear();
      for (const feature of data.features) {
        const item = canonicalFeature(feature, {
          sourceId: this.id,
          idField: this.idField,
          labelField: this.labelField,
          elevationField: this.elevationField,
          keepOriginal: this.keepOriginal
        });
        if (item) this.index.add(item);
      }
      this.featureCount = this.index.items.length;
      this.loaded = true;
      return { sourceId: this.id, featureCount: this.featureCount };
    }
    async loadFileInWorker(file, workerUrl = 'workbench-ar-worker.js') {
      if (!(file instanceof Blob)) return this.load(file);
      const worker = new Worker(workerUrl);
      const requestId = cryptoSafeId();
      try {
        const result = await new Promise(async (resolve, reject) => {
          worker.onmessage = (event) => {
            if (event.data?.id !== requestId) return;
            if (event.data.ok) resolve(event.data.result);
            else reject(new Error(event.data.error || 'GeoJSON worker failed'));
          };
          worker.onerror = (event) => reject(new Error(event.message || 'GeoJSON worker failed'));
          const buffer = await file.arrayBuffer();
          worker.postMessage({ id: requestId, type: 'parseGeoJSON', payload: buffer }, [buffer]);
        });
        this.index.clear();
        for (const p of result.points || []) {
          const props = p.properties || {};
          const propElev = this.elevationField ? Number(props[this.elevationField]) : NaN;
          this.index.add({
            id: String((this.idField ? props[this.idField] : undefined) ?? p.id),
            sourceId: this.id,
            label: String((this.labelField ? props[this.labelField] : undefined) ?? props.title ?? props.name ?? props.applicationnumber ?? p.id),
            lat: Number(p.lat),
            lon: Number(p.lon),
            z: Number.isFinite(p.z) ? p.z : undefined,
            propertyElevationM: Number.isFinite(propElev) ? propElev : undefined,
            geometryType: 'Point',
            properties: props
          });
        }
        this.featureCount = this.index.items.length;
        this.loaded = true;
        return { sourceId: this.id, featureCount: this.featureCount, worker: true };
      } finally { worker.terminate(); }
    }
    queryNearby(lat, lon, radiusM, maxItems) {
      return Promise.resolve(this.index.query(lat, lon, radiusM, maxItems));
    }
  }

  function normaliseFeatureServerUrl(url) {
    return String(url || '').replace(/^http:/i, 'https:').replace(/\/$/, '').replace(/\?.*$/, '');
  }

  async function fetchJson(url, params = {}, signal) {
    const u = new URL(url);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) u.searchParams.set(key, typeof value === 'string' ? value : JSON.stringify(value));
    });
    const res = await fetch(u.toString(), { signal });
    if (!res.ok) throw new Error(`Request failed ${res.status}: ${u}`);
    const json = await res.json();
    if (json?.error) throw new Error(json.error.message || 'ArcGIS service error');
    return json;
  }

  class ArcGISFeatureServerSource {
    constructor(options = {}) {
      this.id = options.id || 'arcgis';
      this.name = options.name || this.id;
      this.url = normaliseFeatureServerUrl(options.url);
      this.layerIds = options.layerIds || null;
      this.where = options.where || '1=1';
      this.outFields = options.outFields || '*';
      this.idField = options.idField;
      this.labelField = options.labelField;
      this.elevationField = options.elevationField;
      this.includeGeometryTypes = options.includeGeometryTypes || ['esriGeometryPoint', 'esriGeometryPolyline', 'esriGeometryPolygon'];
      this.keepOriginal = !!options.keepOriginal;
      this.metadata = null;
      this.layers = [];
    }
    async discover(signal) {
      const root = await fetchJson(this.url, { f: 'pjson' }, signal);
      const isLayer = /\/FeatureServer\/\d+$/i.test(this.url);
      if (isLayer) {
        this.metadata = root;
        this.layers = [{ id: Number(this.url.match(/(\d+)$/)[1]), ...root, url: this.url }];
      } else {
        this.metadata = root;
        const defs = [...(root.layers || [])].filter(l => !this.layerIds || this.layerIds.includes(l.id));
        this.layers = [];
        for (const def of defs) {
          const meta = await fetchJson(`${this.url}/${def.id}`, { f: 'pjson' }, signal);
          if (this.includeGeometryTypes.includes(meta.geometryType)) this.layers.push({ ...def, ...meta, url: `${this.url}/${def.id}` });
        }
      }
      return {
        sourceId: this.id,
        name: this.name,
        layers: this.layers.map(l => ({ id: l.id, name: l.name, geometryType: l.geometryType, maxRecordCount: l.maxRecordCount, fields: l.fields || [] }))
      };
    }
    async queryNearby(lat, lon, radiusM, maxItems = 500, signal) {
      if (!this.layers.length) await this.discover(signal);
      const envelope = envelopeAround(lat, lon, radiusM);
      const perLayerLimit = Math.max(25, Math.ceil(maxItems / Math.max(1, this.layers.length)) * 2);
      const out = [];
      for (const layer of this.layers) {
        const items = await this._queryLayer(layer, envelope, perLayerLimit, signal);
        for (const item of items) {
          const distanceM = haversineM(lat, lon, item.lat, item.lon);
          if (distanceM <= radiusM) out.push({ item, distanceM });
        }
      }
      out.sort((a, b) => a.distanceM - b.distanceM);
      return out.slice(0, maxItems);
    }
    async _queryLayer(layer, envelope, limit, signal) {
      const params = {
        f: 'geojson',
        where: this.where,
        outFields: this.outFields,
        returnGeometry: 'true',
        outSR: 4326,
        inSR: 4326,
        geometryType: 'esriGeometryEnvelope',
        spatialRel: 'esriSpatialRelIntersects',
        geometry: `${envelope.xmin},${envelope.ymin},${envelope.xmax},${envelope.ymax}`,
        resultRecordCount: Math.min(limit, layer.maxRecordCount || 1000)
      };
      const json = await fetchJson(`${layer.url}/query`, params, signal);
      const features = json.features || [];
      return features.map(feature => canonicalFeature(feature, {
        sourceId: this.id,
        idField: this.idField || layer.objectIdField,
        labelField: this.labelField,
        elevationField: this.elevationField,
        keepOriginal: this.keepOriginal
      })).filter(Boolean);
    }
  }

  class ArcGISImageServerElevationProvider {
    constructor(options = {}) {
      this.id = options.id || 'arcgis-elevation';
      this.url = normaliseFeatureServerUrl(options.url || 'https://elevation3d.arcgis.com/arcgis/rest/services/WorldElevation3D/Terrain3D/ImageServer');
      this.batchSize = clamp(Number(options.batchSize) || 100, 1, 500);
      this.precision = clamp(Number(options.precision) || 5, 3, 7);
      this.cache = new Map();
      this.renderingRule = options.renderingRule;
      this.interpolation = options.interpolation || 'RSP_BilinearInterpolation';
      this.stats = { requests: 0, cacheHits: 0, sampled: 0, missing: 0, failures: 0, lastError: null, lastSampleAt: null };
    }
    _key(lat, lon) { return `${Number(lat).toFixed(this.precision)},${Number(lon).toFixed(this.precision)}`; }
    clearCache() { this.cache.clear(); }
    diagnostics() {
      return { id: this.id, url: this.url, cacheSize: this.cache.size, batchSize: this.batchSize, precision: this.precision, ...this.stats };
    }
    async sampleMany(points, signal) {
      const results = new Array(points.length).fill(null);
      const missing = [];
      points.forEach((p, i) => {
        const key = this._key(p.lat, p.lon);
        if (this.cache.has(key)) { results[i] = this.cache.get(key); this.stats.cacheHits += 1; }
        else missing.push({ ...p, i, key });
      });
      for (let start = 0; start < missing.length; start += this.batchSize) {
        const batch = missing.slice(start, start + this.batchSize);
        const geometry = { points: batch.map(p => [p.lon, p.lat]), spatialReference: { wkid: 4326 } };
        this.stats.requests += 1;
        let json;
        try {
          json = await fetchJson(`${this.url}/getSamples`, {
            f: 'json', geometryType: 'esriGeometryMultipoint', geometry, returnFirstValueOnly: 'true',
            interpolation: this.interpolation, renderingRule: this.renderingRule
          }, signal);
        } catch (error) {
          this.stats.failures += 1; this.stats.lastError = error?.message || String(error); throw error;
        }
        const samples = json.samples || [];
        const aligned = new Array(batch.length).fill(null);
        const remaining = new Set(batch.map((_, idx) => idx));
        const unmatchedSamples = [];
        samples.forEach(sample => {
          const x = Number(sample?.location?.x);
          const y = Number(sample?.location?.y);
          if (!Number.isFinite(x) || !Number.isFinite(y) || !remaining.size) { unmatchedSamples.push(sample); return; }
          let bestIndex = null;
          let bestD2 = Infinity;
          for (const idx of remaining) {
            const dx = batch[idx].lon - x;
            const dy = batch[idx].lat - y;
            const d2 = dx * dx + dy * dy;
            if (d2 < bestD2) { bestD2 = d2; bestIndex = idx; }
          }
          if (bestIndex != null) { aligned[bestIndex] = sample; remaining.delete(bestIndex); }
          else unmatchedSamples.push(sample);
        });
        for (const idx of remaining) aligned[idx] = unmatchedSamples.shift() || null;
        batch.forEach((p, idx) => {
          const raw = aligned[idx]?.value;
          const first = typeof raw === 'string' ? Number(raw.split(',')[0]) : Number(raw);
          const value = Number.isFinite(first) ? first : null;
          this.cache.set(p.key, value); results[p.i] = value;
          if (value == null) this.stats.missing += 1; else this.stats.sampled += 1;
        });
        this.stats.lastSampleAt = new Date().toISOString(); this.stats.lastError = null;
      }
      return results;
    }
    async sample(lat, lon, signal) { return (await this.sampleMany([{ lat, lon }], signal))[0]; }
  }

  class TerrainElevationModel {
    constructor(options = {}) {
      this.provider = options.provider || new ArcGISImageServerElevationProvider(options.providerOptions || {});
      this.options = {
        enabled: options.enabled ?? true, eyeHeightM: Number.isFinite(Number(options.eyeHeightM)) ? Number(options.eyeHeightM) : 1.65,
        targetHeightM: Number.isFinite(Number(options.targetHeightM)) ? Number(options.targetHeightM) : 1.5, sourceElevationMode: options.sourceElevationMode || 'ignore',
        sourceElevationField: options.sourceElevationField || '', gpsAltitudeMaxAccuracyM: Number(options.gpsAltitudeMaxAccuracyM) || 20
      };
      this.last = { status: 'idle', observerGroundElevationM: null, observerAltitudeM: null, observerAltitudeSource: 'none', sampledItems: 0, missingItems: 0, lastUpdatedAt: null, lastError: null };
    }
    configure(options = {}) {
      if ('enabled' in options) this.options.enabled = Boolean(options.enabled);
      if (Number.isFinite(Number(options.eyeHeightM))) this.options.eyeHeightM = Number(options.eyeHeightM);
      if (Number.isFinite(Number(options.targetHeightM))) this.options.targetHeightM = Number(options.targetHeightM);
      if (options.sourceElevationMode) this.options.sourceElevationMode = options.sourceElevationMode;
      if ('sourceElevationField' in options) this.options.sourceElevationField = String(options.sourceElevationField || '').trim();
      if (Number.isFinite(Number(options.gpsAltitudeMaxAccuracyM))) this.options.gpsAltitudeMaxAccuracyM = Number(options.gpsAltitudeMaxAccuracyM);
      return this;
    }
    setProvider(provider) { this.provider = provider || new NoopElevationProvider(); return this; }
    _sourceElevation(item) {
      const pointZ = item?.point?.alt ?? item?.z;
      const field = this.options.sourceElevationField;
      const fieldZ = field ? (item?.feature?.properties?.[field] ?? item?.properties?.[field]) : undefined;
      return firstFiniteNumber([fieldZ, pointZ]);
    }
    _observerAltitude(position, observerGroundM) {
      if (Number.isFinite(observerGroundM)) return { altitudeM: observerGroundM + this.options.eyeHeightM, source: 'terrain+eye-height' };
      const gpsAlt = Number(position?.altitude ?? position?.altitudeM);
      const gpsAcc = Number(position?.altitudeAccuracy ?? position?.altitudeAccuracyM);
      if (Number.isFinite(gpsAlt) && Number.isFinite(gpsAcc) && gpsAcc <= this.options.gpsAltitudeMaxAccuracyM) return { altitudeM: gpsAlt, source: 'gps-altitude' };
      return { altitudeM: this.options.eyeHeightM, source: 'flat-fallback' };
    }
    async enrich(position, entries, options = {}) {
      const list = entries || []; const signal = options.signal;
      if (!position || !Number.isFinite(Number(position.lat)) || !Number.isFinite(Number(position.lng ?? position.lon))) return list;
      if (!this.options.enabled) {
        list.forEach(item => { item.groundElevationM = null; item.observerGroundElevationM = null; item.observerAltitudeM = null; item.targetAltitudeM = null; item.elevationAngle = 0; item.elevationSource = 'disabled'; });
        this.last = { ...this.last, status: 'disabled', sampledItems: 0, missingItems: list.length, lastUpdatedAt: new Date().toISOString(), lastError: null };
        return list;
      }
      const lon = Number(position.lng ?? position.lon);
      const points = [{ lat: Number(position.lat), lon }, ...list.map(item => ({ lat: Number(item.point?.lat ?? item.lat), lon: Number(item.point?.lng ?? item.point?.lon ?? item.lon) }))];
      let samples = points.map(() => null); this.last.status = 'sampling'; this.last.lastError = null;
      try { samples = await this.provider.sampleMany(points, signal); }
      catch (error) { if (error?.name === 'AbortError') throw error; this.last.lastError = error?.message || String(error); this.last.status = 'fallback'; }
      const observerGroundM = firstFiniteNumber([samples[0]]);
      const observer = this._observerAltitude(position, observerGroundM);
      let sampledItems = 0, missingItems = 0;
      list.forEach((item, index) => {
        const ground = firstFiniteNumber([samples[index + 1]]);
        const sourceElevation = this._sourceElevation(item);
        let targetAltitudeM, targetSource;
        if (this.options.sourceElevationMode === 'absolute' && Number.isFinite(sourceElevation)) { targetAltitudeM = sourceElevation; targetSource = 'source-absolute'; }
        else if (this.options.sourceElevationMode === 'height' && Number.isFinite(sourceElevation) && Number.isFinite(ground)) { targetAltitudeM = ground + sourceElevation; targetSource = 'source-height-above-ground'; }
        else if (Number.isFinite(ground)) { targetAltitudeM = ground + this.options.targetHeightM; targetSource = 'terrain+target-height'; }
        else { targetAltitudeM = observer.altitudeM - this.options.eyeHeightM + this.options.targetHeightM; targetSource = observer.source === 'gps-altitude' ? 'gps-flat-plane' : 'flat-fallback'; }
        const itemLat = Number(item.point?.lat ?? item.lat), itemLon = Number(item.point?.lng ?? item.point?.lon ?? item.lon);
        const distanceM = Math.max(0.01, Number(item.distance) || haversineM(Number(position.lat), lon, itemLat, itemLon));
        const dz = targetAltitudeM - observer.altitudeM;
        item.groundElevationM = ground; item.observerGroundElevationM = observerGroundM; item.observerAltitudeM = observer.altitudeM;
        item.targetAltitudeM = targetAltitudeM; item.verticalDeltaM = dz; item.sourceElevationM = Number.isFinite(sourceElevation) ? sourceElevation : null;
        item.elevationAngle = toDeg(Math.atan2(dz, distanceM)); item.elevationSource = targetSource;
        if (Number.isFinite(ground)) sampledItems += 1; else missingItems += 1;
      });
      this.last = { status: this.last.lastError ? 'fallback' : 'ready', observerGroundElevationM: observerGroundM, observerAltitudeM: observer.altitudeM, observerAltitudeSource: observer.source, sampledItems, missingItems, lastUpdatedAt: new Date().toISOString(), lastError: this.last.lastError };
      return list;
    }
    diagnostics() {
      return { options: { ...this.options }, last: { ...this.last }, provider: typeof this.provider?.diagnostics === 'function' ? this.provider.diagnostics() : { id: this.provider?.id || this.provider?.constructor?.name || 'unknown' } };
    }
  }

  class NoopElevationProvider {
    constructor() { this.id = 'none'; }
    async sampleMany(points) { return points.map(() => null); }
    async sample() { return null; }
  }

  class PoseTracker extends EventTarget {
    constructor(options = {}) {
      super();
      this.options = {
        headingSmoothing: options.headingSmoothing ?? 0.22,
        pitchSmoothing: options.pitchSmoothing ?? 0.22,
        locationMinDistanceM: options.locationMinDistanceM ?? 1.5,
        highAccuracy: options.highAccuracy ?? true,
        maximumAge: options.maximumAge ?? 500,
        timeout: options.timeout ?? 15000
      };
      this.position = null;
      this.pose = { headingDeg: null, pitchDeg: 0, rollDeg: 0, raw: null, absolute: false };
      this._watchId = null;
      this._orientationHandler = (e) => this._onOrientation(e);
    }
    async requestPermissions() {
      const results = { geolocation: 'unsupported', orientation: 'unsupported' };
      if ('geolocation' in navigator) results.geolocation = 'available';
      if (typeof DeviceOrientationEvent !== 'undefined') {
        if (typeof DeviceOrientationEvent.requestPermission === 'function') {
          try { results.orientation = await DeviceOrientationEvent.requestPermission(); }
          catch { results.orientation = 'denied'; }
        } else results.orientation = 'available';
      }
      return results;
    }
    start() {
      if ('geolocation' in navigator && this._watchId == null) {
        this._watchId = navigator.geolocation.watchPosition(
          pos => this._onPosition(pos),
          err => this.dispatchEvent(new CustomEvent('error', { detail: { type: 'geolocation', error: err } })),
          { enableHighAccuracy: this.options.highAccuracy, maximumAge: this.options.maximumAge, timeout: this.options.timeout }
        );
      }
      global.addEventListener('deviceorientationabsolute', this._orientationHandler, true);
      global.addEventListener('deviceorientation', this._orientationHandler, true);
      return this;
    }
    stop() {
      if (this._watchId != null) navigator.geolocation.clearWatch(this._watchId);
      this._watchId = null;
      global.removeEventListener('deviceorientationabsolute', this._orientationHandler, true);
      global.removeEventListener('deviceorientation', this._orientationHandler, true);
    }
    _onPosition(pos) {
      const next = {
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        altitudeM: pos.coords.altitude,
        accuracyM: pos.coords.accuracy,
        altitudeAccuracyM: pos.coords.altitudeAccuracy,
        speedMps: pos.coords.speed,
        courseDeg: pos.coords.heading,
        timestamp: pos.timestamp
      };
      const movedM = this.position ? haversineM(this.position.lat, this.position.lon, next.lat, next.lon) : Infinity;
      this.position = next;
      this.dispatchEvent(new CustomEvent('position', { detail: { position: next, movedM } }));
    }
    _onOrientation(event) {
      if (!Number.isFinite(event.alpha) || !Number.isFinite(event.beta) || !Number.isFinite(event.gamma)) return;
      const direction = cameraDirectionFromEuler(event.alpha, event.beta, event.gamma);
      const heading = Number.isFinite(event.webkitCompassHeading) ? event.webkitCompassHeading : direction.headingDeg;
      const pitch = direction.pitchDeg;
      this.pose.headingDeg = circularLerpDegrees(this.pose.headingDeg, heading, this.options.headingSmoothing);
      this.pose.pitchDeg = this.pose.pitchDeg + (pitch - this.pose.pitchDeg) * this.options.pitchSmoothing;
      this.pose.rollDeg = event.gamma;
      this.pose.raw = { alpha: event.alpha, beta: event.beta, gamma: event.gamma, webkitCompassHeading: event.webkitCompassHeading };
      this.pose.absolute = !!event.absolute || Number.isFinite(event.webkitCompassHeading);
      this.dispatchEvent(new CustomEvent('pose', { detail: { ...this.pose } }));
    }
  }

  class ARSpatialEngine extends EventTarget {
    constructor(options = {}) {
      super();
      this.options = {
        radiusM: options.radiusM ?? 1000,
        maxItems: options.maxItems ?? 250,
        locationRefreshDistanceM: options.locationRefreshDistanceM ?? 5,
        locationRefreshMaxAgeMs: options.locationRefreshMaxAgeMs ?? 10000,
        eyeHeightM: options.eyeHeightM ?? 1.65,
        targetHeightM: options.targetHeightM ?? 1.5,
        horizontalFovDeg: options.horizontalFovDeg ?? 60,
        verticalFovDeg: options.verticalFovDeg ?? 45,
        useSourceElevation: options.useSourceElevation ?? false
      };
      this.sources = new Map();
      this.elevation = options.elevationProvider || new NoopElevationProvider();
      this.poseTracker = options.poseTracker || new PoseTracker(options.pose || {});
      this.position = null;
      this.pose = this.poseTracker.pose;
      this.nearby = [];
      this._lastRefreshAt = 0;
      this._lastRefreshPosition = null;
      this._refreshAbort = null;
      this._boundPosition = (e) => this._handlePosition(e.detail.position, e.detail.movedM);
      this._boundPose = (e) => { this.pose = e.detail; this.dispatchEvent(new CustomEvent('pose', { detail: e.detail })); };
      this._boundError = (e) => this.dispatchEvent(new CustomEvent('error', { detail: e.detail }));
      this.poseTracker.addEventListener('position', this._boundPosition);
      this.poseTracker.addEventListener('pose', this._boundPose);
      this.poseTracker.addEventListener('error', this._boundError);
    }
    addSource(source) { this.sources.set(source.id, source); return source; }
    removeSource(id) { this.sources.delete(id); }
    setElevationProvider(provider) { this.elevation = provider || new NoopElevationProvider(); }
    async requestPermissions() { return this.poseTracker.requestPermissions(); }
    start() { this.poseTracker.start(); return this; }
    stop() { this.poseTracker.stop(); if (this._refreshAbort) this._refreshAbort.abort(); }
    setManualPosition(lat, lon, extras = {}) {
      this.position = { lat: Number(lat), lon: Number(lon), accuracyM: extras.accuracyM ?? 0, altitudeM: extras.altitudeM ?? null, altitudeAccuracyM: extras.altitudeAccuracyM ?? null, timestamp: Date.now() };
      return this.refreshNearby(true);
    }
    setManualPose(headingDeg, pitchDeg = 0, rollDeg = 0) {
      this.pose = { headingDeg: wrap360(Number(headingDeg)), pitchDeg: Number(pitchDeg), rollDeg: Number(rollDeg), absolute: true, raw: null };
    }
    async _handlePosition(position, movedM) {
      this.position = position;
      const age = Date.now() - this._lastRefreshAt;
      if (!this._lastRefreshPosition || movedM >= this.options.locationRefreshDistanceM || age >= this.options.locationRefreshMaxAgeMs) {
        try { await this.refreshNearby(); } catch (error) { this.dispatchEvent(new CustomEvent('error', { detail: { type: 'refresh', error } })); }
      }
    }
    async refreshNearby(force = false) {
      if (!this.position) return [];
      const now = Date.now();
      if (!force && this._lastRefreshPosition) {
        const moved = haversineM(this._lastRefreshPosition.lat, this._lastRefreshPosition.lon, this.position.lat, this.position.lon);
        if (moved < this.options.locationRefreshDistanceM && now - this._lastRefreshAt < this.options.locationRefreshMaxAgeMs) return this.nearby;
      }
      if (this._refreshAbort) this._refreshAbort.abort();
      this._refreshAbort = new AbortController();
      const signal = this._refreshAbort.signal;
      const queries = [...this.sources.values()].map(async source => {
        try { return await source.queryNearby(this.position.lat, this.position.lon, this.options.radiusM, this.options.maxItems, signal); }
        catch (error) {
          if (error?.name !== 'AbortError') this.dispatchEvent(new CustomEvent('sourceerror', { detail: { sourceId: source.id, error } }));
          return [];
        }
      });
      const grouped = await Promise.all(queries);
      if (signal.aborted) return this.nearby;
      const merged = grouped.flat().sort((a, b) => a.distanceM - b.distanceM).slice(0, this.options.maxItems);
      await this._enrichElevation(merged, signal);
      if (signal.aborted) return this.nearby;
      this.nearby = merged;
      this._lastRefreshAt = Date.now();
      this._lastRefreshPosition = { lat: this.position.lat, lon: this.position.lon };
      this.dispatchEvent(new CustomEvent('nearby', { detail: { items: this.nearby, position: this.position } }));
      return this.nearby;
    }
    async _enrichElevation(entries, signal) {
      const points = [{ lat: this.position.lat, lon: this.position.lon }, ...entries.map(e => ({ lat: e.item.lat, lon: e.item.lon }))];
      let sampled;
      try { sampled = await this.elevation.sampleMany(points, signal); }
      catch (error) {
        this.dispatchEvent(new CustomEvent('elevationerror', { detail: { error } }));
        sampled = points.map(() => null);
      }
      const observerGroundM = sampled[0];
      entries.forEach((entry, i) => {
        entry.groundElevationM = sampled[i + 1];
        entry.observerGroundElevationM = observerGroundM;
      });
    }
    frame(viewport = {}) {
      if (!this.position || !Number.isFinite(this.pose?.headingDeg)) return [];
      const width = viewport.width || global.innerWidth || 1;
      const height = viewport.height || global.innerHeight || 1;
      const hFov = viewport.horizontalFovDeg || this.options.horizontalFovDeg;
      const vFov = viewport.verticalFovDeg || this.options.verticalFovDeg;
      const observerGround = firstFinite(this.nearby.map(e => e.observerGroundElevationM));
      const observerAltitude = this._observerAltitude(observerGround);
      const pitch = Number(this.pose.pitchDeg) || 0;
      return this.nearby.map(entry => {
        const item = entry.item;
        const bearing = bearingDeg(this.position.lat, this.position.lon, item.lat, item.lon);
        const relativeBearing = wrap180(bearing - this.pose.headingDeg);
        const targetGround = Number.isFinite(entry.groundElevationM) ? entry.groundElevationM : observerGround;
        const sourceZ = Number.isFinite(item.propertyElevationM) ? item.propertyElevationM : item.z;
        const targetAltitude = this.options.useSourceElevation && Number.isFinite(sourceZ)
          ? sourceZ
          : (Number.isFinite(targetGround) ? targetGround : 0) + this.options.targetHeightM;
        const obsAlt = Number.isFinite(observerAltitude) ? observerAltitude : this.options.eyeHeightM;
        const dz = targetAltitude - obsAlt;
        const elevationAngle = toDeg(Math.atan2(dz, Math.max(0.01, entry.distanceM)));
        const relativeElevation = elevationAngle - pitch;
        const x = width * (0.5 + relativeBearing / hFov);
        const y = height * (0.5 - relativeElevation / vFov);
        const visible = Math.abs(relativeBearing) <= hFov / 2 && Math.abs(relativeElevation) <= vFov / 2;
        return {
          id: item.id,
          sourceId: item.sourceId,
          label: item.label,
          lat: item.lat,
          lon: item.lon,
          geometryType: item.geometryType,
          properties: item.properties,
          distanceM: entry.distanceM,
          bearingDeg: bearing,
          relativeBearingDeg: relativeBearing,
          groundElevationM: targetGround,
          targetAltitudeM: targetAltitude,
          observerAltitudeM: obsAlt,
          elevationAngleDeg: elevationAngle,
          relativeElevationDeg: relativeElevation,
          x,
          y,
          visible,
          scale: clamp(1.5 / Math.sqrt(Math.max(1, entry.distanceM / 15)), 0.55, 1.5),
          opacity: clamp(1 - entry.distanceM / Math.max(this.options.radiusM * 1.25, 1), 0.25, 1)
        };
      });
    }
    _observerAltitude(observerGroundM) {
      if (Number.isFinite(observerGroundM)) return observerGroundM + this.options.eyeHeightM;
      if (Number.isFinite(this.position?.altitudeM) && Number.isFinite(this.position?.altitudeAccuracyM) && this.position.altitudeAccuracyM <= 10) return this.position.altitudeM;
      return this.options.eyeHeightM;
    }
    diagnostics() {
      return {
        version: VERSION,
        secureContext: global.isSecureContext,
        position: this.position,
        pose: this.pose,
        sourceCount: this.sources.size,
        sources: [...this.sources.values()].map(s => ({ id: s.id, name: s.name, type: s.constructor.name, layers: s.layers?.map(l => ({ id: l.id, name: l.name, geometryType: l.geometryType })) })),
        nearbyCount: this.nearby.length,
        radiusM: this.options.radiusM,
        elevationProvider: this.elevation?.id || this.elevation?.constructor?.name,
        lastRefreshAt: this._lastRefreshAt ? new Date(this._lastRefreshAt).toISOString() : null
      };
    }
  }

  function firstFinite(values) {
    for (const v of values) if (Number.isFinite(v)) return v;
    return null;
  }

  global.WorkbenchAR = {
    VERSION,
    ARSpatialEngine,
    PoseTracker,
    GeoJSONSource,
    ArcGISFeatureServerSource,
    ArcGISImageServerElevationProvider,
    TerrainElevationModel,
    NoopElevationProvider,
    GridSpatialIndex,
    utils: { haversineM, bearingDeg, destinationPoint, envelopeAround, wrap180, wrap360, centroidOfGeometry, cameraDirectionFromEuler }
  };
})(window);
