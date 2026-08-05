export const STORAGE_KEY = "road-closure-studio-v5";
export const LEGACY_STORAGE_KEYS = ["road-closure-studio-v4"];
export const CLOUD_CONFIG_KEY = "road-closure-studio-v5-google-drive";
export const USER_PREFERENCES_KEY = "road-closure-studio-v5-preferences";
export const USER_SETTINGS_KEY = "road-closure-studio-v5-settings";

export const formats = {
  portrait: { label: "Portrait post", width: 1080, height: 1350 },
  square: { label: "Square post", width: 1080, height: 1080 },
  story: { label: "Story", width: 1080, height: 1920 },
  landscape: { label: "Landscape", width: 1200, height: 675 }
};

export const featureStyles = {
  closure: { label: "Road closed", color: "#cc352d", weight: 11, dash: "" },
  detour: { label: "Detour route", color: "#58bc43", weight: 10, dash: "" },
  access: { label: "Resident access", color: "#0ba7c2", weight: 9, dash: "16 12" },
  works: { label: "Works location", color: "#ef7622", weight: 10, dash: "" },
  note: { label: "Map note", color: "#063f5c", weight: 5, dash: "" }
};

export const nzLocations = [
  { name: "Paraparaumu", road: "SH1", lat: -40.9168, lng: 175.0182, zoom: 13 },
  { name: "Transmission Gully", road: "SH59", lat: -41.061, lng: 174.958, zoom: 11 },
  { name: "Tūrangi", road: "SH1", lat: -38.9904, lng: 175.8086, zoom: 11 },
  { name: "Taupō", road: "SH1", lat: -38.6857, lng: 176.0702, zoom: 12 },
  { name: "Rotorua", road: "SH30A", lat: -38.1368, lng: 176.2497, zoom: 13 },
  { name: "New Plymouth", road: "SH3", lat: -39.0556, lng: 174.0752, zoom: 12 },
  { name: "Blenheim", road: "SH1", lat: -41.5134, lng: 173.9612, zoom: 12 },
  { name: "Whangārei", road: "SH1", lat: -35.7251, lng: 174.3237, zoom: 12 }
];

export const templates = {
  full: {
    label: "Full closure",
    eventType: "Full road closure",
    severity: "Closed",
    headline: "Kāpiti Expressway nightworks",
    subheadline: "Southbound ramp closures",
    direction: "Southbound",
    audience: "All traffic",
    details:
      "Plan ahead and follow the signed detour. Emergency access will be maintained.",
    detour: "Use Kāpiti Road and the old state highway. Allow extra travel time."
  },
  lane: {
    label: "Lane closure",
    eventType: "Lane closure",
    severity: "Major delays",
    headline: "Burgess Park lane closure",
    subheadline: "Stop/go traffic management",
    direction: "Both directions",
    audience: "All traffic",
    details:
      "A single lane will remain open under stop/go traffic management.",
    detour: "No detour required. Expect short delays and follow site controls."
  },
  detour: {
    label: "Detour",
    eventType: "Detour in place",
    severity: "Closed",
    headline: "Tūrangi to Waiouru",
    subheadline: "Overnight closure detour",
    direction: "Both directions",
    audience: "All traffic",
    details:
      "The road will close overnight. Reopenings may be weather dependent.",
    detour: "Use the signed detour and allow significant extra travel time."
  },
  works: {
    label: "Works location",
    eventType: "Roadworks",
    severity: "Minor delays",
    headline: "Bridge investigation works",
    subheadline: "Short traffic interruptions",
    direction: "Both directions",
    audience: "All traffic",
    details:
      "Short holds may be required while crews complete investigation work.",
    detour: "No detour required. Please follow instructions from traffic crews."
  }
};

export const createInitialProject = () => ({
  id: `closure-${Date.now()}`,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  status: "Draft",
  format: "portrait",
  template: "",
  headline: "",
  subheadline: "",
  eventType: "",
  severity: "",
  road: "",
  routeNumber: "",
  direction: "",
  audience: "",
  area: "",
  locationDetail: "",
  lat: -35.2,
  lng: 173.4,
  zoom: 9,
  startDate: "",
  startTime: "",
  endDate: "",
  endTime: "",
  recurrence: "",
  scheduleNote: "",
  details: "",
  detour: "",
  contact: "",
  reference: "",
  routing: {
    start: null,
    end: null,
    avoidClosures: true,
    preferHighways: true,
    includeAlternatives: false,
    includeNetworkRoutesInGeoJson: true,
    lastDetection: null,
    diagnosticsLog: []
  },
  editing: {
    stickToRoad: true
  },
  publicationMap: {
    manual: false,
    lat: null,
    lng: null,
    zoom: null
  },
  graphicLabels: {
    showFeatureLabels: true,
    showDistances: true,
    showMapCaption: true,
    showLegend: true,
    showNorthArrow: true,
    showLabelBorders: true,
    showLegendBorder: true
  },
  graphicKeyItems: Object.fromEntries(
    Object.entries(featureStyles).map(([key, style]) => [
      key,
      { label: style.label, color: style.color, visible: true }
    ])
  ),
  referenceLayers: {
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
  },
  referenceLabelPositions: {},
  areaGeometry: null,
  featureDrafts: {
    closure: { start: null, end: null },
    detour: { start: null, end: null },
    access: { start: null, end: null }
  },
  features: []
});

export const seedRecords = () => [];
