import {
  loadFarNorthAddresses,
  loadFarNorthAreas,
  loadFarNorthRoads
} from "./gis-data.js";

let catalogPromise;

export const normalizeSearchText = (value) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("en-NZ")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");

const geometryBounds = (geometry) => {
  let west = Number.POSITIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;

  const visit = (coordinates) => {
    if (
      Array.isArray(coordinates) &&
      coordinates.length >= 2 &&
      Number.isFinite(Number(coordinates[0])) &&
      Number.isFinite(Number(coordinates[1]))
    ) {
      const [lng, lat] = coordinates.map(Number);
      west = Math.min(west, lng);
      south = Math.min(south, lat);
      east = Math.max(east, lng);
      north = Math.max(north, lat);
      return;
    }
    if (Array.isArray(coordinates)) coordinates.forEach(visit);
  };

  visit(geometry?.coordinates);
  if (![west, south, east, north].every(Number.isFinite)) return null;
  return [
    [south, west],
    [north, east]
  ];
};

const centreOfBounds = (bounds) => ({
  lat: (bounds[0][0] + bounds[1][0]) / 2,
  lng: (bounds[0][1] + bounds[1][1]) / 2
});

const addSearchText = (item, values) => ({
  ...item,
  searchTitle: normalizeSearchText(item.title),
  searchText: normalizeSearchText(values.filter(Boolean).join(" "))
});

const buildRoadCatalog = (roads) => {
  const seen = new Set();
  return roads.features
    .map((feature, index) => {
      const properties = feature.properties || {};
      const title = String(
        properties.full_road_name || properties.road_name_label || ""
      ).trim();
      const roadId = String(properties.road_id ?? "");
      const key = roadId || `${normalizeSearchText(title)}:${index}`;
      if (!title || seen.has(key)) return null;
      const bounds = geometryBounds(feature.geometry);
      if (!bounds) return null;
      seen.add(key);
      const centre = centreOfBounds(bounds);
      const stateHighway = properties.road_name_type === "State Highway";
      return addSearchText(
        {
          id: `road:${key}`,
          sourceId: roadId,
          type: "road",
          typeLabel: "Road",
          title,
          subtitle: stateHighway
            ? "State Highway · Far North road network"
            : `${properties.road_name_type || "Road"} · Far North road network`,
          road: title,
          routeNumber: stateHighway ? title.match(/\d+[A-Z]?/i)?.[0] || "" : "",
          lat: centre.lat,
          lng: centre.lng,
          zoom: 15,
          bounds,
          geometry: feature.geometry
        },
        [
          title,
          properties.road_name_label,
          properties.road_name_body,
          properties.full_road_name_ascii,
          properties.road_name_type,
          roadId
        ]
      );
    })
    .filter(Boolean);
};

const buildAddressCatalog = (addressIndex, roadIds) =>
  (addressIndex.items || []).map((values) => {
    const [id, address, road, roadId, locality, town, lng, lat] = values;
    const area = locality || town || "Far North District";
    const networkMatched = roadIds.has(String(roadId));
    return addSearchText(
      {
        id: `address:${id}`,
        sourceId: String(id),
        type: "address",
        typeLabel: "Address",
        title: address,
        subtitle: [
          area,
          road,
          networkMatched ? "" : "Road not present in trimmed network"
        ]
          .filter(Boolean)
          .join(" · "),
        road,
        roadId: String(roadId),
        area,
        locality,
        town,
        networkMatched,
        lat: Number(lat),
        lng: Number(lng),
        zoom: 18
      },
      [address, road, locality, town, id]
    );
  });

const buildAreaCatalog = (areaIndex) =>
  (areaIndex.items || []).map((area) =>
    addSearchText(
      {
        id: `area:${area.id}`,
        sourceId: String(area.id),
        type: "area",
        typeLabel: area.type || "Area",
        title: area.name,
        subtitle: [area.alternate, area.major, "Far North District"]
          .filter(Boolean)
          .join(" · "),
        area: area.name,
        lat: Number(area.lat),
        lng: Number(area.lng),
        zoom: 13,
        bounds: area.bounds,
        geometry: area.geometry
      },
      [area.name, area.alternate, area.major, area.type]
    )
  );

export const loadExploreCatalog = async () => {
  if (!catalogPromise) {
    catalogPromise = Promise.all([
      loadFarNorthRoads(),
      loadFarNorthAddresses(),
      loadFarNorthAreas()
    ]).then(([roads, addresses, areas]) => {
      const roadCatalog = buildRoadCatalog(roads);
      const roadIds = new Set(roadCatalog.map((road) => road.sourceId));
      const catalog = {
        roads: roadCatalog,
        addresses: buildAddressCatalog(addresses, roadIds),
        areas: buildAreaCatalog(areas)
      };
      catalog.all = [
        ...catalog.roads,
        ...catalog.addresses,
        ...catalog.areas
      ];
      catalog.counts = {
        roads: catalog.roads.length,
        addresses: catalog.addresses.length,
        areas: catalog.areas.length,
        all: catalog.all.length
      };
      return catalog;
    });
  }
  return catalogPromise;
};

const scoreCandidate = (candidate, query) => {
  const title = candidate.searchTitle;
  const combined = candidate.searchText;
  if (title === query) return 400;
  if (combined === query) return 360;
  if (title.startsWith(query)) return 340 - Math.min(20, title.length - query.length);
  if (combined.startsWith(query)) return 280;
  const titlePosition = title.indexOf(query);
  if (titlePosition >= 0) return 300 - Math.min(80, titlePosition);
  const combinedPosition = combined.indexOf(query);
  if (combinedPosition >= 0) return 220 - Math.min(100, combinedPosition);

  const tokens = query.split(" ").filter(Boolean);
  if (tokens.length > 1 && tokens.every((token) => combined.includes(token))) {
    return 160 - Math.min(60, combined.length / 20);
  }
  return Number.NEGATIVE_INFINITY;
};

const categoryKey = {
  all: "all",
  road: "roads",
  address: "addresses",
  area: "areas"
};

export const searchExplore = async (
  input,
  { type = "all", limit = 30 } = {}
) => {
  const query = normalizeSearchText(input);
  if (!query) return [];
  const catalog = await loadExploreCatalog();
  const candidates = catalog[categoryKey[type] || "all"];
  return candidates
    .map((candidate) => ({
      candidate,
      score: scoreCandidate(candidate, query)
    }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.candidate.title.localeCompare(right.candidate.title, "en-NZ")
    )
    .slice(0, limit)
    .map(({ candidate, score }) => ({ ...candidate, score }));
};
