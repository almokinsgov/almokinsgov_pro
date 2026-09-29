(function () {
  'use strict';

  const DEFAULT_PAGE_SIZE = 1000;
  const DEFAULT_MAX_FEATURES = 5000;

  function cleanUrl(raw) {
    const url = new URL(raw.trim());
    url.hash = '';
    url.search = '';
    url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/query$/i, '');
    return url.toString().replace(/\/$/, '');
  }

  function parseFeatureServerUrl(raw) {
    const url = cleanUrl(raw);
    const match = url.match(/^(.*\/FeatureServer)(?:\/(\d+))?$/i);
    if (!match) throw new Error('Use an ArcGIS FeatureServer service or layer URL.');
    return { serviceUrl: match[1], layerId: match[2] == null ? null : Number(match[2]), cleanedUrl: url };
  }

  function buildRequestUrl(url, params, token, proxy) {
    const request = new URL(url);
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') request.searchParams.set(key, String(value));
    });
    if (token) request.searchParams.set('token', token);
    const finalUrl = request.toString();
    return proxy ? `${proxy}${encodeURIComponent(finalUrl)}` : finalUrl;
  }

  async function fetchJson(url, params, options) {
    const { token = '', proxy = '', signal } = options || {};
    const response = await fetch(buildRequestUrl(url, { ...params, f: 'json' }, token, proxy), { signal, credentials: 'omit' });
    if (!response.ok) throw new Error(`HTTP ${response.status} from ArcGIS service.`);
    const data = await response.json();
    if (data.error) throw new Error(data.error.message || 'ArcGIS service returned an error.');
    return data;
  }

  async function fetchGeoJson(url, params, options) {
    const { token = '', proxy = '', signal } = options || {};
    const response = await fetch(buildRequestUrl(url, { ...params, f: 'geojson' }, token, proxy), { signal, credentials: 'omit' });
    if (!response.ok) throw new Error(`HTTP ${response.status} from ArcGIS service.`);
    const data = await response.json();
    if (data.error) throw new Error(data.error.message || 'ArcGIS service returned an error.');
    if (data.type !== 'FeatureCollection') throw new Error('Service did not return GeoJSON.');
    return data;
  }

  function esriGeometryToGeoJson(geometry) {
    if (!geometry) return null;
    if (typeof geometry.x === 'number' && typeof geometry.y === 'number') return { type: 'Point', coordinates: [geometry.x, geometry.y] };
    if (Array.isArray(geometry.points)) return { type: 'MultiPoint', coordinates: geometry.points };
    if (Array.isArray(geometry.paths)) {
      return geometry.paths.length === 1
        ? { type: 'LineString', coordinates: geometry.paths[0] }
        : { type: 'MultiLineString', coordinates: geometry.paths };
    }
    if (Array.isArray(geometry.rings)) return { type: 'Polygon', coordinates: geometry.rings };
    return null;
  }

  function esriSetToGeoJson(data) {
    return {
      type: 'FeatureCollection',
      features: (data.features || []).map(item => ({
        type: 'Feature',
        geometry: esriGeometryToGeoJson(item.geometry),
        properties: item.attributes || {}
      })).filter(item => item.geometry)
    };
  }

  function makeBoundsGeometry(bounds) {
    return `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`;
  }

  class FeatureServerClient {
    constructor(options) {
      this.token = options?.token || '';
      this.proxy = options?.proxy || '';
    }

    async inspect(rawUrl, signal) {
      const parsed = parseFeatureServerUrl(rawUrl);
      if (parsed.layerId == null) {
        const service = await fetchJson(parsed.serviceUrl, {}, { token: this.token, proxy: this.proxy, signal });
        const layers = (service.layers || []).map(layer => ({ id: layer.id, name: layer.name, type: layer.type || 'Feature Layer' }));
        return { kind: 'service', serviceUrl: parsed.serviceUrl, service, layers };
      }
      const metadata = await fetchJson(parsed.cleanedUrl, {}, { token: this.token, proxy: this.proxy, signal });
      return { kind: 'layer', serviceUrl: parsed.serviceUrl, layerUrl: parsed.cleanedUrl, layerId: parsed.layerId, metadata };
    }

    async layerMetadata(layerUrl, signal) {
      return fetchJson(cleanUrl(layerUrl), {}, { token: this.token, proxy: this.proxy, signal });
    }

    async layerExtent(layerUrl, signal) {
      const queryUrl = `${cleanUrl(layerUrl)}/query`;
      const data = await fetchJson(queryUrl, {
        where: '1=1',
        returnExtentOnly: true,
        returnGeometry: false,
        outSR: 4326
      }, { token: this.token, proxy: this.proxy, signal });
      if (!data.extent) return null;
      return { west: data.extent.xmin, south: data.extent.ymin, east: data.extent.xmax, north: data.extent.ymax };
    }

    async queryBounds(layer, bounds, options) {
      const maxFeatures = options?.maxFeatures || DEFAULT_MAX_FEATURES;
      const signal = options?.signal;
      const pageSize = Math.max(1, Math.min(layer.metadata?.maxRecordCount || DEFAULT_PAGE_SIZE, DEFAULT_PAGE_SIZE));
      const base = {
        where: layer.where || '1=1',
        geometry: makeBoundsGeometry(bounds),
        geometryType: 'esriGeometryEnvelope',
        inSR: 4326,
        spatialRel: 'esriSpatialRelIntersects',
        outSR: 4326,
        outFields: layer.outFields || '*',
        returnGeometry: true,
        orderByFields: layer.metadata?.objectIdField ? `${layer.metadata.objectIdField} ASC` : undefined
      };
      const all = [];
      let offset = 0;
      let exceeded = true;
      let useEsriJson = false;

      while (exceeded && all.length < maxFeatures) {
        const count = Math.min(pageSize, maxFeatures - all.length);
        const params = { ...base, resultOffset: offset, resultRecordCount: count };
        let page;
        if (!useEsriJson) {
          try {
            page = await fetchGeoJson(`${cleanUrl(layer.url)}/query`, params, { token: layer.token || this.token, proxy: layer.proxy || this.proxy, signal });
          } catch (error) {
            useEsriJson = true;
          }
        }
        if (useEsriJson) {
          const esri = await fetchJson(`${cleanUrl(layer.url)}/query`, params, { token: layer.token || this.token, proxy: layer.proxy || this.proxy, signal });
          page = esriSetToGeoJson(esri);
          page.exceededTransferLimit = Boolean(esri.exceededTransferLimit);
        }
        all.push(...(page.features || []));
        exceeded = Boolean(page.exceededTransferLimit) || (page.features || []).length === count;
        if ((page.features || []).length === 0) break;
        offset += (page.features || []).length;
        if (!layer.metadata?.advancedQueryCapabilities?.supportsPagination && offset >= pageSize) break;
      }

      return {
        type: 'FeatureCollection',
        features: all.slice(0, maxFeatures),
        truncated: all.length >= maxFeatures
      };
    }
  }

  window.FeatureServer = {
    FeatureServerClient,
    parseFeatureServerUrl
  };
}());
