const EARTH_RADIUS_METRES = 6371008.8;

const asPoint = (point) => [Number(point?.[0]), Number(point?.[1])];

export const distanceMetres = (first, second) => {
  const [firstLat, firstLng] = asPoint(first);
  const [secondLat, secondLng] = asPoint(second);
  const toRadians = Math.PI / 180;
  const lat1 = firstLat * toRadians;
  const lat2 = secondLat * toRadians;
  const deltaLat = (secondLat - firstLat) * toRadians;
  const deltaLng = (secondLng - firstLng) * toRadians;
  const haversine =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return (
    2 *
    EARTH_RADIUS_METRES *
    Math.atan2(Math.sqrt(haversine), Math.sqrt(Math.max(0, 1 - haversine)))
  );
};

const smoothMagneticWeight = (distance, influence) => {
  if (distance >= influence) return 0;
  const ratio = Math.max(0, distance / influence);
  return 0.5 + 0.5 * Math.cos(Math.PI * ratio);
};

export const insertRouteAnchor = (
  sourceCoordinates,
  segmentIndex,
  anchorPoint = null,
  vertexToleranceMetres = 1
) => {
  const coordinates = sourceCoordinates.map(asPoint);
  if (coordinates.length < 2) {
    return {
      coordinates,
      anchorIndex: 0,
      inserted: false
    };
  }
  const safeSegmentIndex = Math.max(
    0,
    Math.min(coordinates.length - 2, Number(segmentIndex) || 0)
  );
  const start = coordinates[safeSegmentIndex];
  const end = coordinates[safeSegmentIndex + 1];
  const anchor = anchorPoint
    ? asPoint(anchorPoint)
    : [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];

  if (distanceMetres(anchor, start) <= vertexToleranceMetres) {
    return {
      coordinates,
      anchorIndex: safeSegmentIndex,
      inserted: false
    };
  }
  if (distanceMetres(anchor, end) <= vertexToleranceMetres) {
    return {
      coordinates,
      anchorIndex: safeSegmentIndex + 1,
      inserted: false
    };
  }

  coordinates.splice(safeSegmentIndex + 1, 0, anchor);
  return {
    coordinates,
    anchorIndex: safeSegmentIndex + 1,
    inserted: true
  };
};

export const projectPointOntoRoute = (sourceCoordinates, targetPoint) => {
  const coordinates = sourceCoordinates.map(asPoint);
  if (coordinates.length < 2) {
    return {
      ...insertRouteAnchor(coordinates, 0, targetPoint),
      coordinate: asPoint(targetPoint),
      segmentIndex: 0,
      distanceMetres: 0
    };
  }

  const target = asPoint(targetPoint);
  const metresPerLatitudeDegree = 110574;
  const metresPerLongitudeDegree =
    111320 * Math.cos((target[0] * Math.PI) / 180);
  const targetX = target[1] * metresPerLongitudeDegree;
  const targetY = target[0] * metresPerLatitudeDegree;
  let best = null;

  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const start = coordinates[index];
    const end = coordinates[index + 1];
    const startX = start[1] * metresPerLongitudeDegree;
    const startY = start[0] * metresPerLatitudeDegree;
    const endX = end[1] * metresPerLongitudeDegree;
    const endY = end[0] * metresPerLatitudeDegree;
    const deltaX = endX - startX;
    const deltaY = endY - startY;
    const denominator = deltaX ** 2 + deltaY ** 2;
    const ratio =
      denominator === 0
        ? 0
        : Math.max(
            0,
            Math.min(
              1,
              ((targetX - startX) * deltaX + (targetY - startY) * deltaY) /
                denominator
            )
          );
    const projectedX = startX + deltaX * ratio;
    const projectedY = startY + deltaY * ratio;
    const distanceSquared =
      (targetX - projectedX) ** 2 + (targetY - projectedY) ** 2;
    if (!best || distanceSquared < best.distanceSquared) {
      best = {
        coordinate: [
          start[0] + (end[0] - start[0]) * ratio,
          start[1] + (end[1] - start[1]) * ratio
        ],
        distanceSquared,
        segmentIndex: index
      };
    }
  }

  return {
    ...insertRouteAnchor(
      coordinates,
      best.segmentIndex,
      best.coordinate
    ),
    coordinate: best.coordinate,
    segmentIndex: best.segmentIndex,
    distanceMetres: Math.sqrt(best.distanceSquared)
  };
};

export const deformRouteCoordinates = (
  sourceCoordinates,
  anchorIndex,
  targetPoint,
  {
    minimumInfluenceMetres = 350,
    maximumInfluenceMetres = 6000,
    dragInfluenceMultiplier = 3
  } = {}
) => {
  const original = sourceCoordinates.map(asPoint);
  const safeAnchorIndex = Math.max(
    0,
    Math.min(original.length - 1, Number(anchorIndex) || 0)
  );
  const target = asPoint(targetPoint);
  const anchor = original[safeAnchorIndex];
  const dragDistanceMetres = distanceMetres(anchor, target);
  const influenceMetres = Math.min(
    maximumInfluenceMetres,
    Math.max(
      minimumInfluenceMetres,
      dragDistanceMetres * dragInfluenceMultiplier
    )
  );
  const routeDistances = new Array(original.length).fill(Number.POSITIVE_INFINITY);
  routeDistances[safeAnchorIndex] = 0;

  let travelled = 0;
  for (let index = safeAnchorIndex - 1; index >= 0; index -= 1) {
    travelled += distanceMetres(original[index], original[index + 1]);
    routeDistances[index] = travelled;
    if (travelled >= influenceMetres) break;
  }
  travelled = 0;
  for (let index = safeAnchorIndex + 1; index < original.length; index += 1) {
    travelled += distanceMetres(original[index - 1], original[index]);
    routeDistances[index] = travelled;
    if (travelled >= influenceMetres) break;
  }

  const latDelta = target[0] - anchor[0];
  const lngDelta = target[1] - anchor[1];
  const weights = routeDistances.map((distance) =>
    smoothMagneticWeight(distance, influenceMetres)
  );
  const coordinates = original.map(([lat, lng], index) => [
    lat + latDelta * weights[index],
    lng + lngDelta * weights[index]
  ]);
  const affectedIndexes = weights
    .map((weight, index) => (weight > 0 ? index : -1))
    .filter((index) => index >= 0);

  return {
    coordinates,
    weights,
    affectedIndexes,
    influenceMetres,
    dragDistanceMetres
  };
};

export const selectMagneticControlIndexes = (
  weights,
  anchorIndex,
  maximumControls = 42
) => {
  const affected = weights
    .map((weight, index) => (weight > 0 ? index : -1))
    .filter((index) => index >= 0);
  if (!affected.length) return [anchorIndex];

  const first = affected[0];
  const last = affected.at(-1);
  const span = Math.max(1, last - first);
  const stride = Math.max(1, Math.ceil(span / Math.max(2, maximumControls - 1)));
  const indexes = new Set([first, anchorIndex, last]);
  for (let index = first; index <= last; index += stride) indexes.add(index);
  indexes.add(last);
  return [...indexes].sort((a, b) => a - b);
};

export const applyMagneticControlSnaps = (
  deformedCoordinates,
  controlIndexes,
  snappedControlPoints
) => {
  const coordinates = deformedCoordinates.map(asPoint);
  const controls = controlIndexes
    .map((index, controlIndex) => {
      const coordinate = coordinates[index];
      const snapped = asPoint(snappedControlPoints[controlIndex] || coordinate);
      return {
        index,
        latCorrection: snapped[0] - coordinate[0],
        lngCorrection: snapped[1] - coordinate[1]
      };
    })
    .sort((first, second) => first.index - second.index);

  if (!controls.length) return coordinates;
  let leftControlIndex = 0;
  return coordinates.map(([lat, lng], index) => {
    while (
      leftControlIndex < controls.length - 2 &&
      index > controls[leftControlIndex + 1].index
    ) {
      leftControlIndex += 1;
    }
    const left = controls[leftControlIndex];
    const right = controls[Math.min(leftControlIndex + 1, controls.length - 1)];
    if (index < controls[0].index || index > controls.at(-1).index) {
      return [lat, lng];
    }
    const span = right.index - left.index;
    const ratio = span > 0 ? (index - left.index) / span : 0;
    return [
      lat + left.latCorrection + (right.latCorrection - left.latCorrection) * ratio,
      lng + left.lngCorrection + (right.lngCorrection - left.lngCorrection) * ratio
    ];
  });
};
