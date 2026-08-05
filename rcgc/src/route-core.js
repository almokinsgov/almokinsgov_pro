const EARTH_RADIUS_KM = 6371.0088;

const geometryLines = (geometry) => {
  if (!geometry) return [];
  if (geometry.type === "LineString") return [geometry.coordinates];
  if (geometry.type === "MultiLineString") return geometry.coordinates;
  return [];
};

const coordinateKey = ([lng, lat]) =>
  `${Number(lng).toFixed(6)},${Number(lat).toFixed(6)}`;

const haversineKm = (first, second) => {
  const radians = Math.PI / 180;
  const lat1 = first[1] * radians;
  const lat2 = second[1] * radians;
  const deltaLat = (second[1] - first[1]) * radians;
  const deltaLng = (second[0] - first[0]) * radians;
  const value =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(value)));
};

const projectLocal = ([lng, lat], latitude) => {
  const radians = (latitude * Math.PI) / 180;
  return [lng * 111320 * Math.cos(radians), lat * 110540];
};

const nearestPointOnSegment = (point, start, end) => {
  const referenceLatitude = (point[1] + start[1] + end[1]) / 3;
  const projectedPoint = projectLocal(point, referenceLatitude);
  const projectedStart = projectLocal(start, referenceLatitude);
  const projectedEnd = projectLocal(end, referenceLatitude);
  const dx = projectedEnd[0] - projectedStart[0];
  const dy = projectedEnd[1] - projectedStart[1];
  const denominator = dx * dx + dy * dy;
  const rawT =
    denominator === 0
      ? 0
      : ((projectedPoint[0] - projectedStart[0]) * dx +
          (projectedPoint[1] - projectedStart[1]) * dy) /
        denominator;
  const t = Math.max(0, Math.min(1, rawT));
  const coordinate = [
    start[0] + (end[0] - start[0]) * t,
    start[1] + (end[1] - start[1]) * t
  ];
  const projectedNearest = [
    projectedStart[0] + dx * t,
    projectedStart[1] + dy * t
  ];
  const distanceMetres = Math.hypot(
    projectedPoint[0] - projectedNearest[0],
    projectedPoint[1] - projectedNearest[1]
  );
  return { coordinate, distanceMetres, t };
};

const orientation = (a, b, c) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

const segmentsIntersect = (a, b, c, d) => {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  return (
    ((o1 >= 0 && o2 <= 0) || (o1 <= 0 && o2 >= 0)) &&
    ((o3 >= 0 && o4 <= 0) || (o3 <= 0 && o4 >= 0))
  );
};

const segmentDistanceMetres = (firstStart, firstEnd, secondStart, secondEnd) => {
  const latitude =
    (firstStart[1] + firstEnd[1] + secondStart[1] + secondEnd[1]) / 4;
  const a = projectLocal(firstStart, latitude);
  const b = projectLocal(firstEnd, latitude);
  const c = projectLocal(secondStart, latitude);
  const d = projectLocal(secondEnd, latitude);
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(
    nearestPointOnSegment(firstStart, secondStart, secondEnd).distanceMetres,
    nearestPointOnSegment(firstEnd, secondStart, secondEnd).distanceMetres,
    nearestPointOnSegment(secondStart, firstStart, firstEnd).distanceMetres,
    nearestPointOnSegment(secondEnd, firstStart, firstEnd).distanceMetres
  );
};

class MinHeap {
  constructor() {
    this.items = [];
  }

  push(item) {
    this.items.push(item);
    let index = this.items.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.items[parent].cost <= item.cost) break;
      this.items[index] = this.items[parent];
      index = parent;
    }
    this.items[index] = item;
  }

  pop() {
    if (!this.items.length) return null;
    const root = this.items[0];
    const tail = this.items.pop();
    if (!this.items.length) return root;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= this.items.length) break;
      const child =
        right < this.items.length &&
        this.items[right].cost < this.items[left].cost
          ? right
          : left;
      if (this.items[child].cost >= tail.cost) break;
      this.items[index] = this.items[child];
      index = child;
    }
    this.items[index] = tail;
    return root;
  }

  get size() {
    return this.items.length;
  }
}

const normalisePoint = (point) => {
  if (Array.isArray(point)) {
    const [lat, lng] = point.map(Number);
    return Number.isFinite(lat) && Number.isFinite(lng) ? [lng, lat] : null;
  }
  const lat = Number(point?.lat);
  const lng = Number(point?.lng);
  return Number.isFinite(lat) && Number.isFinite(lng) ? [lng, lat] : null;
};

const featureSegments = (features = []) => {
  const segments = [];
  const points = [];
  features
    .filter((feature) => feature?.type === "closure")
    .forEach((feature) => {
      const coordinates = (feature.coordinates || [])
        .map(normalisePoint)
        .filter(Boolean);
      if (coordinates.length === 1) points.push(coordinates[0]);
      for (let index = 1; index < coordinates.length; index += 1) {
        segments.push([coordinates[index - 1], coordinates[index]]);
      }
    });
  return { points, segments };
};

const describeRouteQuality = (distanceKm, openNetworkDistanceKm) => {
  const baseline = Math.max(0.05, Number(openNetworkDistanceKm) || 0.05);
  const ratio = distanceKm / baseline;
  const extraDistanceKm = Math.max(0, distanceKm - baseline);
  const level =
    ratio >= 8 && extraDistanceKm >= 10
      ? "extreme"
      : ratio >= 3 && extraDistanceKm >= 3
        ? "long"
        : "normal";
  return {
    level,
    openNetworkDistanceKm: baseline,
    detourRatio: ratio,
    extraDistanceKm
  };
};

export class RoadNetwork {
  constructor(geojson) {
    const startedAt = performance.now();
    this.nodes = new Map();
    this.edges = [];
    this.skippedEdges = 0;

    (geojson?.features || []).forEach((feature, featureIndex) => {
      const properties = feature.properties || {};
      const roadName = String(
        properties.full_road_name ||
          properties.road_name_label ||
          properties.road_name ||
          "Unnamed road"
      ).trim();
      const roadId = String(properties.road_id ?? featureIndex);
      const roadType = String(properties.road_name_type || "Road");

      geometryLines(feature.geometry).forEach((line, partIndex) => {
        for (let index = 1; index < line.length; index += 1) {
          const from = line[index - 1].slice(0, 2).map(Number);
          const to = line[index].slice(0, 2).map(Number);
          if (
            ![...from, ...to].every(Number.isFinite) ||
            coordinateKey(from) === coordinateKey(to)
          ) {
            this.skippedEdges += 1;
            continue;
          }
          const lengthKm = haversineKm(from, to);
          if (!Number.isFinite(lengthKm) || lengthKm <= 0.000001) {
            this.skippedEdges += 1;
            continue;
          }
          const fromKey = coordinateKey(from);
          const toKey = coordinateKey(to);
          const edgeIndex = this.edges.length;
          const edge = {
            id: `${roadId}:${partIndex}:${index - 1}`,
            from,
            to,
            fromKey,
            toKey,
            lengthKm,
            roadId,
            roadName,
            roadType
          };
          this.edges.push(edge);
          this.addNodeEdge(fromKey, from, edgeIndex);
          this.addNodeEdge(toKey, to, edgeIndex);
        }
      });
    });

    this.buildMilliseconds = performance.now() - startedAt;
  }

  addNodeEdge(key, coordinate, edgeIndex) {
    if (!this.nodes.has(key)) {
      this.nodes.set(key, { coordinate, edges: [] });
    }
    this.nodes.get(key).edges.push(edgeIndex);
  }

  nearestEdge(point) {
    let nearest = null;
    this.edges.forEach((edge, edgeIndex) => {
      const projection = nearestPointOnSegment(point, edge.from, edge.to);
      if (!nearest || projection.distanceMetres < nearest.distanceMetres) {
        nearest = { ...projection, edge, edgeIndex };
      }
    });
    return nearest;
  }

  blockedEdges(closureFeatures, toleranceMetres = 28) {
    const blocked = new Set();
    const ranges = new Map();
    const { points, segments } = featureSegments(closureFeatures);
    blocked.ranges = ranges;
    blocked.toleranceMetres = toleranceMetres;
    if (!points.length && !segments.length) return blocked;

    this.edges.forEach((edge, edgeIndex) => {
      const latitude = (edge.from[1] + edge.to[1]) / 2;
      const latitudePadding = toleranceMetres / 110540;
      const longitudePadding =
        toleranceMetres /
        Math.max(1, 111320 * Math.cos((latitude * Math.PI) / 180));
      const west = Math.min(edge.from[0], edge.to[0]) - longitudePadding;
      const east = Math.max(edge.from[0], edge.to[0]) + longitudePadding;
      const south = Math.min(edge.from[1], edge.to[1]) - latitudePadding;
      const north = Math.max(edge.from[1], edge.to[1]) + latitudePadding;

      const edgeRanges = [];
      const rangePadding = Math.min(
        1,
        toleranceMetres / Math.max(0.001, edge.lengthKm * 1000)
      );
      points.forEach((point) => {
        if (
          point[0] < west ||
          point[0] > east ||
          point[1] < south ||
          point[1] > north
        ) {
          return;
        }
        const projection = nearestPointOnSegment(point, edge.from, edge.to);
        if (projection.distanceMetres <= toleranceMetres) {
          edgeRanges.push([
            Math.max(0, projection.t - rangePadding),
            Math.min(1, projection.t + rangePadding)
          ]);
        }
      });
      segments.forEach(([start, end]) => {
          if (
            Math.max(start[0], end[0]) < west ||
            Math.min(start[0], end[0]) > east ||
            Math.max(start[1], end[1]) < south ||
            Math.min(start[1], end[1]) > north
          ) {
            return;
          }
          if (
            segmentDistanceMetres(edge.from, edge.to, start, end) >
            toleranceMetres
          ) {
            return;
          }
          const startProjection = nearestPointOnSegment(
            start,
            edge.from,
            edge.to
          );
          const endProjection = nearestPointOnSegment(
            end,
            edge.from,
            edge.to
          );
          edgeRanges.push([
            Math.max(
              0,
              Math.min(startProjection.t, endProjection.t) - rangePadding
            ),
            Math.min(
              1,
              Math.max(startProjection.t, endProjection.t) + rangePadding
            )
          ]);
        });
      if (!edgeRanges.length) return;
      edgeRanges.sort((left, right) => left[0] - right[0]);
      const merged = [];
      edgeRanges.forEach((range) => {
        const previous = merged.at(-1);
        if (previous && range[0] <= previous[1]) {
          previous[1] = Math.max(previous[1], range[1]);
        } else {
          merged.push([...range]);
        }
      });
      blocked.add(edgeIndex);
      ranges.set(edgeIndex, merged);
    });
    return blocked;
  }

  edgeIntervalIsOpen(edgeIndex, firstT, secondT, blocked) {
    if (!blocked.has(edgeIndex)) return true;
    const edgeRanges = blocked.ranges?.get(edgeIndex);
    if (!edgeRanges?.length) return false;
    const minimum = Math.min(firstT, secondT);
    const maximum = Math.max(firstT, secondT);
    if (maximum - minimum <= 1e-10) {
      return !edgeRanges.some(
        ([start, end]) => start <= minimum && end >= maximum
      );
    }
    return !edgeRanges.some(
      ([start, end]) =>
        end > minimum + 1e-10 && start < maximum - 1e-10
    );
  }

  snapConnections(snap, blocked) {
    return {
      from: this.edgeIntervalIsOpen(snap.edgeIndex, snap.t, 0, blocked),
      to: this.edgeIntervalIsOpen(snap.edgeIndex, snap.t, 1, blocked)
    };
  }

  routeOnce({
    startSnap,
    endSnap,
    blocked,
    preferHighways,
    penalties = new Set(),
    viaRoadNames = []
  }) {
    const startKey = "@route-start";
    const endKey = "@route-end";
    const extraAdjacency = new Map();
    const addExtra = (from, to, edge, lengthKm) => {
      if (!extraAdjacency.has(from)) extraAdjacency.set(from, []);
      extraAdjacency.get(from).push({
        to,
        edgeIndex: edge.edgeIndex,
        edgeId: edge.edge.id,
        lengthKm,
        roadName: edge.edge.roadName,
        roadType: edge.edge.roadType
      });
    };
    const connectSnap = (key, snap) => {
      const fromLength = snap.edge.lengthKm * snap.t;
      const toLength = snap.edge.lengthKm * (1 - snap.t);
      const connections = this.snapConnections(snap, blocked);
      if (connections.from) {
        addExtra(key, snap.edge.fromKey, snap, fromLength);
        addExtra(snap.edge.fromKey, key, snap, fromLength);
      }
      if (connections.to) {
        addExtra(key, snap.edge.toKey, snap, toLength);
        addExtra(snap.edge.toKey, key, snap, toLength);
      }
    };

    connectSnap(startKey, startSnap);
    connectSnap(endKey, endSnap);
    if (
      startSnap.edgeIndex === endSnap.edgeIndex &&
      this.edgeIntervalIsOpen(
        startSnap.edgeIndex,
        startSnap.t,
        endSnap.t,
        blocked
      )
    ) {
      const directLength =
        startSnap.edge.lengthKm * Math.abs(startSnap.t - endSnap.t);
      addExtra(startKey, endKey, startSnap, directLength);
      addExtra(endKey, startKey, startSnap, directLength);
    }

    const normaliseRoadName = (value) =>
      String(value || "").trim().toLocaleLowerCase("en-NZ");
    const requiredRoads = viaRoadNames
      .map(normaliseRoadName)
      .filter(Boolean);
    const stateKey = (nodeKey, progress) => `${progress}\u0000${nodeKey}`;
    const initialStateKey = stateKey(startKey, 0);
    const goalStateKey = stateKey(endKey, requiredRoads.length);
    const stateNodes = new Map([[initialStateKey, startKey]]);
    const distances = new Map([[initialStateKey, 0]]);
    const travelled = new Map([[initialStateKey, 0]]);
    const previous = new Map();
    const heap = new MinHeap();
    heap.push({
      key: initialStateKey,
      nodeKey: startKey,
      progress: 0,
      cost: 0
    });
    let visitedNodes = 0;

    const baseNeighbours = (key) => {
      const node = this.nodes.get(key);
      if (!node) return [];
      return node.edges
        .filter((edgeIndex) => !blocked.has(edgeIndex))
        .map((edgeIndex) => {
          const edge = this.edges[edgeIndex];
          return {
            to: edge.fromKey === key ? edge.toKey : edge.fromKey,
            edgeIndex,
            edgeId: edge.id,
            lengthKm: edge.lengthKm,
            roadName: edge.roadName,
            roadType: edge.roadType
          };
        });
    };

    while (heap.size) {
      const current = heap.pop();
      if (current.cost !== distances.get(current.key)) continue;
      visitedNodes += 1;
      if (
        current.nodeKey === endKey &&
        current.progress === requiredRoads.length
      ) {
        break;
      }
      const neighbours = [
        ...baseNeighbours(current.nodeKey),
        ...(extraAdjacency.get(current.nodeKey) || [])
      ];
      neighbours.forEach((neighbour) => {
        let nextProgress = current.progress;
        const neighbourRoad = normaliseRoadName(neighbour.roadName);
        while (
          nextProgress < requiredRoads.length &&
          neighbourRoad === requiredRoads[nextProgress]
        ) {
          nextProgress += 1;
        }
        const nextStateKey = stateKey(neighbour.to, nextProgress);
        const highwayFactor =
          preferHighways && neighbour.roadType === "State Highway" ? 0.9 : 1;
        const alternativeFactor = penalties.has(neighbour.edgeIndex) ? 2.6 : 1;
        const edgeCost =
          neighbour.lengthKm * highwayFactor * alternativeFactor;
        const nextCost = current.cost + edgeCost;
        if (
          nextCost >=
          (distances.get(nextStateKey) ?? Number.POSITIVE_INFINITY)
        ) {
          return;
        }
        distances.set(nextStateKey, nextCost);
        travelled.set(
          nextStateKey,
          (travelled.get(current.key) || 0) + neighbour.lengthKm
        );
        stateNodes.set(nextStateKey, neighbour.to);
        previous.set(nextStateKey, {
          key: current.key,
          edgeIndex: neighbour.edgeIndex,
          edgeId: neighbour.edgeId,
          roadName: neighbour.roadName
        });
        heap.push({
          key: nextStateKey,
          nodeKey: neighbour.to,
          progress: nextProgress,
          cost: nextCost
        });
      });
    }

    if (!previous.has(goalStateKey)) return null;
    const stateKeys = [goalStateKey];
    const steps = [];
    let cursor = goalStateKey;
    while (cursor !== initialStateKey) {
      const step = previous.get(cursor);
      if (!step) return null;
      steps.push(step);
      cursor = step.key;
      stateKeys.push(cursor);
    }
    stateKeys.reverse();
    steps.reverse();
    const keys = stateKeys.map((key) => stateNodes.get(key));

    const coordinateForKey = (key) => {
      if (key === startKey) return startSnap.coordinate;
      if (key === endKey) return endSnap.coordinate;
      return this.nodes.get(key)?.coordinate;
    };
    const coordinates = keys
      .map(coordinateForKey)
      .filter(Boolean)
      .filter(
        (coordinate, index, values) =>
          index === 0 || coordinateKey(coordinate) !== coordinateKey(values[index - 1])
      )
      .map(([lng, lat]) => [lat, lng]);
    const roadNames = [];
    steps.forEach((step) => {
      if (step.roadName && roadNames.at(-1) !== step.roadName) {
        roadNames.push(step.roadName);
      }
    });

    return {
      distanceKm: travelled.get(goalStateKey),
      cost: distances.get(goalStateKey),
      coordinates,
      roadNames,
      edgeIds: steps.map((step) => step.edgeId),
      edgeIndexes: steps.map((step) => step.edgeIndex),
      visitedNodes
    };
  }

  findRoutes({
    start,
    end,
    closureFeatures = [],
    avoidClosures = true,
    preferHighways = true,
    maxSnapMetres = 500,
    alternatives = true,
    avoidRoadNames = [],
    viaRoadNames = [],
    penalizeEdgeIds = []
  }) {
    const startedAt = performance.now();
    const startPoint = normalisePoint(start);
    const endPoint = normalisePoint(end);
    if (!startPoint || !endPoint) {
      return { status: "invalid-endpoints", routes: [] };
    }
    const startSnap = this.nearestEdge(startPoint);
    const endSnap = this.nearestEdge(endPoint);
    if (
      !startSnap ||
      !endSnap ||
      startSnap.distanceMetres > maxSnapMetres ||
      endSnap.distanceMetres > maxSnapMetres
    ) {
      return {
        status: "outside-network",
        routes: [],
        startSnap: startSnap
          ? {
              distanceMetres: startSnap.distanceMetres,
              roadName: startSnap.edge.roadName
            }
          : null,
        endSnap: endSnap
          ? {
              distanceMetres: endSnap.distanceMetres,
              roadName: endSnap.edge.roadName
            }
          : null
      };
    }

    const blocked = avoidClosures
      ? this.blockedEdges(closureFeatures)
      : new Set();
    blocked.ranges ||= new Map();
    const avoidedRoads = new Set(
      avoidRoadNames
        .map((name) =>
          String(name || "").trim().toLocaleLowerCase("en-NZ")
        )
        .filter(Boolean)
    );
    if (avoidedRoads.size) {
      this.edges.forEach((edge, edgeIndex) => {
        if (
          avoidedRoads.has(
            String(edge.roadName || "")
              .trim()
              .toLocaleLowerCase("en-NZ")
          )
        ) {
          blocked.add(edgeIndex);
        }
      });
    }
    const penalizedEdgeIds = new Set(
      penalizeEdgeIds.map((edgeId) => String(edgeId || "")).filter(Boolean)
    );
    const penalties = new Set();
    if (penalizedEdgeIds.size) {
      this.edges.forEach((edge, edgeIndex) => {
        if (penalizedEdgeIds.has(String(edge.id))) penalties.add(edgeIndex);
      });
    }
    const snapSummary = (snap) => ({
      coordinate: [snap.coordinate[1], snap.coordinate[0]],
      edgeId: snap.edge.id,
      edgeIndex: snap.edgeIndex,
      edgeLengthMetres: snap.edge.lengthKm * 1000,
      edgePosition: snap.t,
      roadId: snap.edge.roadId,
      roadName: snap.edge.roadName,
      distanceMetres: snap.distanceMetres,
      edgeBlocked: blocked.has(snap.edgeIndex),
      connections: this.snapConnections(snap, blocked)
    });
    const blockedRangeCount = [...blocked.ranges.values()].reduce(
      (total, edgeRanges) => total + edgeRanges.length,
      0
    );
    const primary = this.routeOnce({
      startSnap,
      endSnap,
      blocked,
      preferHighways,
      penalties,
      viaRoadNames
    });
    if (!primary) {
      return {
        status: "no-route",
        routes: [],
        startSnap: snapSummary(startSnap),
        endSnap: snapSummary(endSnap),
        affectedRoads: [
          ...new Set(
            [...blocked].map((edgeIndex) => this.edges[edgeIndex]?.roadName)
          )
        ].filter(Boolean),
        diagnostics: {
          graphNodes: this.nodes.size,
          graphEdges: this.edges.length,
          blockedEdges: blocked.size,
          blockedRanges: blockedRangeCount,
          avoidedRoadNames: [...avoidRoadNames],
          viaRoadNames: [...viaRoadNames],
          penalizedEdgeCount: penalties.size,
          closureToleranceMetres: blocked.toleranceMetres || 0,
          elapsedMs: performance.now() - startedAt
        }
      };
    }

    const openNetworkBlocked = this.blockedEdges([]);
    if (avoidedRoads.size) {
      this.edges.forEach((edge, edgeIndex) => {
        if (
          avoidedRoads.has(
            String(edge.roadName || "")
              .trim()
              .toLocaleLowerCase("en-NZ")
          )
        ) {
          openNetworkBlocked.add(edgeIndex);
        }
      });
    }
    const openNetworkRoute =
      avoidClosures && blocked.size
        ? this.routeOnce({
            startSnap,
            endSnap,
            blocked: openNetworkBlocked,
            preferHighways: false,
            penalties,
            viaRoadNames
          })
        : primary;
    const openNetworkDistanceKm =
      openNetworkRoute?.distanceKm || haversineKm(startPoint, endPoint);
    const routes = [primary];
    if (alternatives && primary.edgeIndexes.length > 2) {
      const alternative = this.routeOnce({
        startSnap,
        endSnap,
        blocked,
        preferHighways,
        penalties: new Set([...penalties, ...primary.edgeIndexes]),
        viaRoadNames
      });
      const sameRoute =
        alternative &&
        alternative.edgeIds.length === primary.edgeIds.length &&
        alternative.edgeIds.every(
          (edgeId, index) => edgeId === primary.edgeIds[index]
        );
      if (
        alternative &&
        !sameRoute &&
        alternative.distanceKm <= primary.distanceKm * 2.25
      ) {
        routes.push(alternative);
      }
    }

    return {
      status: "ok",
      startSnap: snapSummary(startSnap),
      endSnap: snapSummary(endSnap),
      routes: routes.map(({ edgeIndexes, ...route }) => ({
        ...route,
        quality: describeRouteQuality(route.distanceKm, openNetworkDistanceKm)
      })),
      affectedRoads: [
        ...new Set(
          [...blocked].map((edgeIndex) => this.edges[edgeIndex]?.roadName)
        )
      ].filter(Boolean),
      diagnostics: {
        graphNodes: this.nodes.size,
        graphEdges: this.edges.length,
        skippedEdges: this.skippedEdges,
        blockedEdges: blocked.size,
        blockedRanges: blockedRangeCount,
        avoidedRoadNames: [...avoidRoadNames],
        viaRoadNames: [...viaRoadNames],
        penalizedEdgeCount: penalties.size,
        closureToleranceMetres: blocked.toleranceMetres || 0,
        openNetworkDistanceKm,
        elapsedMs: performance.now() - startedAt,
        buildMs: this.buildMilliseconds
      }
    };
  }
}
