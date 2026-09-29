/* Workbench AR parsing worker v0.1.0 */
self.onmessage = async (event) => {
  const { id, type, payload } = event.data || {};
  try {
    if (type !== 'parseGeoJSON') throw new Error(`Unknown worker operation: ${type}`);
    const text = typeof payload === 'string' ? payload : new TextDecoder().decode(payload);
    const data = JSON.parse(text);
    if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features)) throw new Error('Expected GeoJSON FeatureCollection');
    const points = [];
    for (const feature of data.features) {
      const g = feature?.geometry;
      if (g?.type !== 'Point' || !Array.isArray(g.coordinates)) continue;
      points.push({
        id: String(feature.id ?? feature.properties?.OBJECTID ?? feature.properties?.objectid ?? points.length),
        lon: Number(g.coordinates[0]),
        lat: Number(g.coordinates[1]),
        z: Number.isFinite(Number(g.coordinates[2])) ? Number(g.coordinates[2]) : null,
        properties: feature.properties || {}
      });
    }
    self.postMessage({ id, ok: true, result: { points, count: points.length } });
  } catch (error) {
    self.postMessage({ id, ok: false, error: String(error?.message || error) });
  }
};
