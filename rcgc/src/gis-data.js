const cache = new Map();

const assetUrl = (filename) => new URL(`./gis/${filename}`, document.baseURI).href;

const loadJson = async (filename) => {
  if (!cache.has(filename)) {
    cache.set(
      filename,
      fetch(assetUrl(filename)).then((response) => {
        if (!response.ok) {
          throw new Error(`Could not load ${filename}: HTTP ${response.status}`);
        }
        return response.json();
      })
    );
  }
  return cache.get(filename);
};

export const loadFarNorthPlaces = async () => {
  const geojson = await loadJson("far-north-placenames.json");
  const seen = new Set();
  return geojson.features
    .filter((feature) => {
      const [lng, lat] = feature.geometry?.coordinates || [];
      const name = feature.properties?.name?.trim();
      const replaced = String(feature.properties?.status || "").includes("Replaced");
      return (
        feature.geometry?.type === "Point" &&
        name &&
        Number.isFinite(Number(lat)) &&
        Number.isFinite(Number(lng)) &&
        !replaced
      );
    })
    .map((feature, index) => {
      const [lng, lat] = feature.geometry.coordinates;
      return {
        id: `far-north:${feature.properties.name}:${index}`,
        name: feature.properties.name.trim(),
        type: feature.properties.feat_type || "Locality",
        lat: Number(lat),
        lng: Number(lng),
        zoom: feature.properties.feat_type === "Town" ? 14 : 15,
        source: "Far North GIS"
      };
    })
    .filter((location) => {
      const key = `${location.name.toLowerCase()}:${location.lat.toFixed(5)}:${location.lng.toFixed(5)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name, "en-NZ"));
};

export const loadFarNorthRoads = () => loadJson("far-north-roads.json");

export const loadFarNorthBoundary = () => loadJson("far-north-boundary.json");

export const loadFarNorthAddresses = () =>
  loadJson("far-north-addresses.json");

export const loadFarNorthAreas = () => loadJson("far-north-areas-v2.json");

export const loadFarNorthSearchManifest = () =>
  loadJson("far-north-search-manifest-v2.json");

const pointInRing = ([lng, lat], ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / ((yj - yi) || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
};

export const isFarNorthPoint = async (lat, lng) => {
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return false;
  const boundary = await loadFarNorthBoundary();
  const geometry = boundary.features?.[0]?.geometry;
  if (!geometry) return false;
  if (geometry.type === "Polygon") {
    return pointInRing([Number(lng), Number(lat)], geometry.coordinates[0]);
  }
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.some((polygon) =>
      pointInRing([Number(lng), Number(lat)], polygon[0])
    );
  }
  return false;
};

const geometryLines = (geometry) => {
  if (!geometry) return [];
  if (geometry.type === "LineString") return [geometry.coordinates];
  if (geometry.type === "MultiLineString") return geometry.coordinates;
  return [];
};

const distanceSquaredToSegment = (point, start, end) => {
  const latitudeScale = Math.cos((point[1] * Math.PI) / 180);
  const px = point[0] * latitudeScale;
  const py = point[1];
  const sx = start[0] * latitudeScale;
  const sy = start[1];
  const ex = end[0] * latitudeScale;
  const ey = end[1];
  const dx = ex - sx;
  const dy = ey - sy;
  if (dx === 0 && dy === 0) return (px - sx) ** 2 + (py - sy) ** 2;
  const t = Math.max(0, Math.min(1, ((px - sx) * dx + (py - sy) * dy) / (dx ** 2 + dy ** 2)));
  return (px - (sx + t * dx)) ** 2 + (py - (sy + t * dy)) ** 2;
};

const closestPointOnSegment = (point, start, end) => {
  const latitudeScale = Math.cos((point[1] * Math.PI) / 180);
  const px = point[0] * latitudeScale;
  const py = point[1];
  const sx = start[0] * latitudeScale;
  const sy = start[1];
  const ex = end[0] * latitudeScale;
  const ey = end[1];
  const dx = ex - sx;
  const dy = ey - sy;
  const denominator = dx ** 2 + dy ** 2;
  const t =
    denominator === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((px - sx) * dx + (py - sy) * dy) / denominator)
        );
  const projectedX = sx + t * dx;
  const projectedY = sy + t * dy;
  return {
    lng: projectedX / (latitudeScale || 1),
    lat: projectedY,
    distanceSquared: (px - projectedX) ** 2 + (py - projectedY) ** 2
  };
};

export const findNearestRoadPoint = async (lat, lng, { roadName = "" } = {}) => {
  const roads = await loadFarNorthRoads();
  const point = [Number(lng), Number(lat)];
  let nearest = null;
  let nearestScore = Number.POSITIVE_INFINITY;
  const normalizedRoadName = String(roadName).trim().toLocaleLowerCase("en-NZ");

  for (const feature of roads.features) {
    const name = feature.properties?.full_road_name?.trim();
    if (!name || name === "Accessway") continue;
    if (
      normalizedRoadName &&
      name.toLocaleLowerCase("en-NZ") !== normalizedRoadName
    ) {
      continue;
    }
    const highway = feature.properties?.road_name_type === "State Highway";
    for (const line of geometryLines(feature.geometry)) {
      for (let index = 1; index < line.length; index += 1) {
        const projected = closestPointOnSegment(
          point,
          line[index - 1],
          line[index]
        );
        const score = projected.distanceSquared * (highway ? 0.72 : 1);
        if (score < nearestScore) {
          nearestScore = score;
          nearest = {
            name,
            routeNumber: highway ? name.match(/\d+/)?.[0] || "" : "",
            lat: Number(projected.lat.toFixed(7)),
            lng: Number(projected.lng.toFixed(7)),
            distanceDegrees: Math.sqrt(projected.distanceSquared)
          };
        }
      }
    }
  }

  return nearest;
};

export const findNearestRoad = async (lat, lng) =>
  findNearestRoadPoint(lat, lng);

export const featureIntersectsBounds = (feature, bounds, padding = 0.05) => {
  const west = bounds.getWest() - padding;
  const east = bounds.getEast() + padding;
  const south = bounds.getSouth() - padding;
  const north = bounds.getNorth() + padding;
  return geometryLines(feature.geometry).some((line) =>
    line.some(([lng, lat]) => lng >= west && lng <= east && lat >= south && lat <= north)
  );
};
