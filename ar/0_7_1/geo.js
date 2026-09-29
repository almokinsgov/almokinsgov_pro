(function () {
  'use strict';

  const R = 6371008.8;

  function toRad(deg) { return deg * Math.PI / 180; }
  function toDeg(rad) { return rad * 180 / Math.PI; }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function normaliseHeading(value) { return ((value % 360) + 360) % 360; }
  function signedAngle(value) { return ((value + 540) % 360) - 180; }

  function distanceMetres(a, b) {
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const dLat = lat2 - lat1;
    const dLon = toRad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function bearingDegrees(a, b) {
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const dLon = toRad(b.lng - a.lng);
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    return normaliseHeading(toDeg(Math.atan2(y, x)));
  }

  function bboxAround(lat, lng, radiusMetres) {
    const latDelta = toDeg(radiusMetres / R);
    const lonDelta = toDeg(radiusMetres / (R * Math.max(.01, Math.cos(toRad(lat)))));
    return {
      west: lng - lonDelta,
      south: lat - latDelta,
      east: lng + lonDelta,
      north: lat + latDelta
    };
  }

  function destinationPoint(origin, bearingDeg, distanceMetresValue) {
    const angular = Math.max(0, Number(distanceMetresValue) || 0) / R;
    const bearing = toRad(normaliseHeading(Number(bearingDeg) || 0));
    const lat1 = toRad(origin.lat);
    const lon1 = toRad(origin.lng);
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(bearing));
    const lon2 = lon1 + Math.atan2(Math.sin(bearing) * Math.sin(angular) * Math.cos(lat1), Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2));
    return { lat: toDeg(lat2), lng: ((toDeg(lon2) + 540) % 360) - 180 };
  }

  function coordinateMean(coords) {
    if (!coords.length) return null;
    let sx = 0;
    let sy = 0;
    let sz = 0;
    let zCount = 0;
    let n = 0;
    const visit = value => {
      if (!Array.isArray(value)) return;
      if (typeof value[0] === 'number' && typeof value[1] === 'number') {
        sx += value[0];
        sy += value[1];
        if (Number.isFinite(value[2])) { sz += value[2]; zCount += 1; }
        n += 1;
      } else {
        value.forEach(visit);
      }
    };
    visit(coords);
    if (!n) return null;
    const point = { lng: sx / n, lat: sy / n };
    if (zCount) point.alt = sz / zCount;
    return point;
  }

  function polygonCentroid(ring) {
    if (!Array.isArray(ring) || ring.length < 3) return coordinateMean(ring || []);
    let area2 = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < ring.length - 1; i += 1) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[i + 1];
      const cross = x1 * y2 - x2 * y1;
      area2 += cross;
      cx += (x1 + x2) * cross;
      cy += (y1 + y2) * cross;
    }
    if (Math.abs(area2) < 1e-12) return coordinateMean(ring);
    return { lng: cx / (3 * area2), lat: cy / (3 * area2) };
  }

  function representativePoint(geometry) {
    if (!geometry) return null;
    if (geometry.type === 'Point') {
      const point = { lng: geometry.coordinates[0], lat: geometry.coordinates[1] };
      if (Number.isFinite(geometry.coordinates[2])) point.alt = geometry.coordinates[2];
      return point;
    }
    if (geometry.type === 'MultiPoint') return coordinateMean(geometry.coordinates);
    if (geometry.type === 'LineString') return coordinateMean(geometry.coordinates);
    if (geometry.type === 'MultiLineString') return coordinateMean(geometry.coordinates);
    if (geometry.type === 'Polygon') return polygonCentroid(geometry.coordinates[0] || []);
    if (geometry.type === 'MultiPolygon') {
      const polygons = geometry.coordinates || [];
      if (!polygons.length) return null;
      const best = polygons.reduce((a, b) => ((a[0] || []).length >= (b[0] || []).length ? a : b));
      return polygonCentroid(best[0] || []);
    }
    return null;
  }


  function elevationAngleDegrees(a, b) {
    if (!a || !b || !Number.isFinite(a.altitude) || !Number.isFinite(b.alt)) return 0;
    const horizontal = Math.max(0.01, distanceMetres(a, b));
    return toDeg(Math.atan2(b.alt - a.altitude, horizontal));
  }

  function formatDistance(metres) {
    if (!Number.isFinite(metres)) return '';
    if (metres < 1000) return `${Math.round(metres)} m`;
    if (metres < 10000) return `${(metres / 1000).toFixed(1)} km`;
    return `${Math.round(metres / 1000)} km`;
  }

  function cardinal(degrees) {
    const labels = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return labels[Math.round(normaliseHeading(degrees) / 45) % 8];
  }

  window.GeoTools = {
    bearingDegrees,
    bboxAround,
    cardinal,
    clamp,
    distanceMetres,
    destinationPoint,
    elevationAngleDegrees,
    formatDistance,
    normaliseHeading,
    representativePoint,
    signedAngle
  };
}());
