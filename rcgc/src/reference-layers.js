import {
  loadFarNorthAddresses,
  loadFarNorthAreas,
  loadFarNorthRoads
} from "./gis-data.js";

export const referenceLayerDefaults = {
  roads: { visible: true, filterText: "", selectedIds: [] },
  roadNames: {
    visible: false,
    minZoom: 14,
    filterText: "",
    selectedIds: [],
    detourRoadsOnly: false
  },
  addresses: { visible: false, minZoom: 17, filterText: "", selectedIds: [] },
  areas: { visible: false, minZoom: 11, filterText: "", selectedIds: [] }
};

const clampZoom = (value, fallback) =>
  Math.max(6, Math.min(19, Number(value) || fallback));

export const ensureReferenceLayers = (project) => {
  project.referenceLayers ||= {};
  if (
    !project.referenceLabelPositions ||
    Array.isArray(project.referenceLabelPositions) ||
    typeof project.referenceLabelPositions !== "object"
  ) {
    project.referenceLabelPositions = {};
  }
  Object.entries(project.referenceLabelPositions).forEach(([key, position]) => {
    if (
      !Array.isArray(position) ||
      position.length < 2 ||
      !position.every((value) => Number.isFinite(Number(value)))
    ) {
      delete project.referenceLabelPositions[key];
    }
  });
  Object.entries(referenceLayerDefaults).forEach(([key, defaults]) => {
    project.referenceLayers[key] ||= {};
    if (typeof project.referenceLayers[key].visible !== "boolean") {
      project.referenceLayers[key].visible = defaults.visible;
    }
    if ("minZoom" in defaults) {
      project.referenceLayers[key].minZoom = clampZoom(
        project.referenceLayers[key].minZoom,
        defaults.minZoom
      );
    }
    project.referenceLayers[key].filterText = String(
      project.referenceLayers[key].filterText || ""
    ).slice(0, 120);
    if (!Array.isArray(project.referenceLayers[key].selectedIds)) {
      project.referenceLayers[key].selectedIds = [];
    }
    project.referenceLayers[key].selectedIds = [
      ...new Set(
        project.referenceLayers[key].selectedIds
          .map((value) => String(value))
          .filter(Boolean)
      )
    ].slice(0, 250);
    if ("detourRoadsOnly" in defaults) {
      project.referenceLayers[key].detourRoadsOnly =
        project.referenceLayers[key].detourRoadsOnly === true;
    }
  });
  return project.referenceLayers;
};

export const referenceLayerIsActive = (settings, key, zoom) => {
  const layer = settings?.[key] || referenceLayerDefaults[key];
  if (!layer?.visible) return false;
  return !("minZoom" in layer) || Number(zoom) >= Number(layer.minZoom);
};

export const mapBoundsLiteral = (bounds, padding = 0) => ({
  west: bounds.getWest() - padding,
  south: bounds.getSouth() - padding,
  east: bounds.getEast() + padding,
  north: bounds.getNorth() + padding
});

const pointInBounds = ([lng, lat], bounds) =>
  Number(lng) >= bounds.west &&
  Number(lng) <= bounds.east &&
  Number(lat) >= bounds.south &&
  Number(lat) <= bounds.north;

const visitCoordinates = (coordinates, visitor) => {
  if (
    Array.isArray(coordinates) &&
    coordinates.length >= 2 &&
    Number.isFinite(Number(coordinates[0])) &&
    Number.isFinite(Number(coordinates[1]))
  ) {
    visitor([Number(coordinates[0]), Number(coordinates[1])]);
    return;
  }
  if (Array.isArray(coordinates)) {
    coordinates.forEach((value) => visitCoordinates(value, visitor));
  }
};

const geometryIntersectsBounds = (geometry, bounds) => {
  let west = Number.POSITIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;
  visitCoordinates(geometry?.coordinates, (point) => {
    west = Math.min(west, point[0]);
    south = Math.min(south, point[1]);
    east = Math.max(east, point[0]);
    north = Math.max(north, point[1]);
  });
  if (![west, south, east, north].every(Number.isFinite)) return false;
  return !(
    east < bounds.west ||
    west > bounds.east ||
    north < bounds.south ||
    south > bounds.north
  );
};

const itemBoundsIntersect = (itemBounds, bounds) => {
  if (!Array.isArray(itemBounds) || itemBounds.length < 2) return false;
  const [[south, west], [north, east]] = itemBounds;
  return !(
    Number(east) < bounds.west ||
    Number(west) > bounds.east ||
    Number(north) < bounds.south ||
    Number(south) > bounds.north
  );
};

const geometryLines = (geometry) => {
  if (!geometry) return [];
  if (geometry.type === "LineString") return [geometry.coordinates];
  if (geometry.type === "MultiLineString") return geometry.coordinates;
  if (geometry.type === "Polygon") return geometry.coordinates;
  if (geometry.type === "MultiPolygon") {
    return geometry.coordinates.flatMap((polygon) => polygon);
  }
  return [];
};

const representativePoint = (geometry) => {
  const lines = geometryLines(geometry).filter((line) => line.length);
  if (!lines.length) return null;
  const longest = lines.reduce(
    (selected, line) => (line.length > selected.length ? line : selected),
    lines[0]
  );
  const [lng, lat] = longest[Math.floor(longest.length / 2)];
  return [Number(lat), Number(lng)];
};

const roadNameCandidates = (features, limit = 80) => {
  const seen = new Set();
  return [...features]
    .sort((left, right) => {
      const leftHighway =
        left.properties?.road_name_type === "State Highway" ? 1 : 0;
      const rightHighway =
        right.properties?.road_name_type === "State Highway" ? 1 : 0;
      return rightHighway - leftHighway;
    })
    .map((feature) => {
      const name = String(
        feature.properties?.full_road_name ||
          feature.properties?.road_name_label ||
          ""
      ).trim();
      if (!name || seen.has(name.toLocaleLowerCase("en-NZ"))) return null;
      const point = representativePoint(feature.geometry);
      if (!point) return null;
      seen.add(name.toLocaleLowerCase("en-NZ"));
      return {
        id: String(feature.properties?.road_id || name),
        name,
        point,
        stateHighway:
          feature.properties?.road_name_type === "State Highway"
      };
    })
    .filter(Boolean)
    .slice(0, limit);
};

const normalizedText = (value) =>
  String(value || "")
    .toLocaleLowerCase("en-NZ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

export const routeRoadNamesForProject = (project) => {
  const seen = new Set();
  const names = [];
  (project?.features || [])
    .filter((feature) => ["detour", "access"].includes(feature.type))
    .forEach((feature) => {
      const candidates = [
        ...(Array.isArray(feature.roadNames) ? feature.roadNames : []),
        ...(Array.isArray(feature.routeStops)
          ? feature.routeStops.map((stop) => stop?.road)
          : [])
      ];
      candidates.forEach((name) => {
        const value = String(name || "").trim();
        const key = normalizedText(value);
        if (!value || seen.has(key)) return;
        seen.add(key);
        names.push(value);
      });
    });
  return names;
};

const applyChoiceFilter = (items, layer, getId, getLabel) => {
  const selected = new Set((layer?.selectedIds || []).map(String));
  const query = normalizedText(layer?.filterText);
  return items.filter((item) => {
    const id = String(getId(item));
    if (selected.size) return selected.has(id);
    return !query || normalizedText(getLabel(item)).includes(query);
  });
};

const uniqueChoices = (items, getId, getLabel) => {
  const seen = new Set();
  return items
    .map((item) => ({
      id: String(getId(item)),
      label: String(getLabel(item) || "").trim()
    }))
    .filter((item) => {
      if (!item.id || !item.label || seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .sort((left, right) => left.label.localeCompare(right.label, "en-NZ"));
};

export const loadReferenceViewport = async ({
  bounds,
  zoom,
  settings,
  routeRoadNames = [],
  roadLimit = 1961,
  addressLimit = 300,
  areaLimit = 83
}) => {
  const showRoads = referenceLayerIsActive(settings, "roads", zoom);
  const showRoadNames = referenceLayerIsActive(
    settings,
    "roadNames",
    zoom
  );
  const showAddresses = referenceLayerIsActive(
    settings,
    "addresses",
    zoom
  );
  const showAreas = referenceLayerIsActive(settings, "areas", zoom);
  const [roads, addresses, areas] = await Promise.all([
    showRoads || showRoadNames ? loadFarNorthRoads() : null,
    showAddresses ? loadFarNorthAddresses() : null,
    showAreas ? loadFarNorthAreas() : null
  ]);

  const visibleRoadCandidates = (roads?.features || [])
    .filter((feature) => geometryIntersectsBounds(feature.geometry, bounds))
    .slice(0, roadLimit);
  const roadId = (feature) =>
    feature.properties?.road_id ||
    feature.properties?.full_road_name ||
    feature.properties?.road_name_label;
  const roadLabel = (feature) =>
    feature.properties?.full_road_name ||
    feature.properties?.road_name_label ||
    "Unnamed road";
  const visibleAddressCandidates = (addresses?.items || [])
    .filter((item) => pointInBounds([item[6], item[7]], bounds))
    .slice(0, addressLimit)
    .map((item) => ({
      id: String(item[0]),
      address: String(item[1]),
      road: String(item[2]),
      lng: Number(item[6]),
      lat: Number(item[7])
    }));
  const visibleAreaCandidates = (areas?.items || [])
    .filter((item) => itemBoundsIntersect(item.bounds, bounds))
    .slice(0, areaLimit);
  const visibleRoads = applyChoiceFilter(
    visibleRoadCandidates,
    settings?.roads,
    roadId,
    roadLabel
  );
  const routeRoadNameSet = new Set(
    routeRoadNames.map(normalizedText).filter(Boolean)
  );
  const detourRoadsOnly =
    settings?.roadNames?.detourRoadsOnly === true;
  const roadNameCandidatesInScope = detourRoadsOnly
    ? visibleRoadCandidates.filter((feature) =>
        routeRoadNameSet.has(normalizedText(roadLabel(feature)))
      )
    : visibleRoadCandidates;
  const roadNameRoads = applyChoiceFilter(
    roadNameCandidatesInScope,
    settings?.roadNames,
    roadId,
    roadLabel
  );
  const visibleAddresses = applyChoiceFilter(
    visibleAddressCandidates,
    settings?.addresses,
    (item) => item.id,
    (item) => `${item.address} ${item.road}`
  );
  const visibleAreas = applyChoiceFilter(
    visibleAreaCandidates,
    settings?.areas,
    (item) => item.id,
    (item) => item.name
  );

  return {
    active: {
      roads: showRoads,
      roadNames: showRoadNames,
      addresses: showAddresses,
      areas: showAreas
    },
    roads: showRoads ? visibleRoads : [],
    roadNames: showRoadNames ? roadNameCandidates(roadNameRoads) : [],
    addresses: visibleAddresses,
    areas: visibleAreas,
    choices: {
      roads: uniqueChoices(visibleRoadCandidates, roadId, roadLabel),
      roadNames: uniqueChoices(roadNameCandidatesInScope, roadId, roadLabel),
      addresses: uniqueChoices(
        visibleAddressCandidates,
        (item) => item.id,
        (item) => item.address
      ),
      areas: uniqueChoices(
        visibleAreaCandidates,
        (item) => item.id,
        (item) => item.name
      )
    }
  };
};
