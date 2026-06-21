;(function (window, document) {
"use strict";

const PLUGIN_ID = "rwas-map-view";
const VERSION = "0.1.1";
const DEFAULTS = {
  enabled: true,
  defaultMode: "map",
  transformPopup: true,
  slotName: "popup-before-alerts",
  mapHeight: 390,
  fitToAlerts: true,
  fitPadding: 24,
  showAlertList: true,
  showScale: true,
  showCentroidMarkers: true,
  wrapAntimeridian: true,
  scrollWheelZoom: true,
  loadLeaflet: true,
  leafletCssUrl: "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
  leafletJsUrl: "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
  tileLayerUrl: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
  tileLayerAttribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  defaultCenter: [-40.9006, 174.8860],
  defaultZoom: 5,
  maxZoom: 18
};

let leafletPromise = null;

function mergeOptions(base, next) {
  const out = Object.assign({}, base || {});
  Object.keys(next || {}).forEach(function (key) {
    if (next[key] !== undefined) out[key] = next[key];
  });
  return out;
}

function getOptions(api) {
  return mergeOptions(DEFAULTS, api && api.getOptions ? api.getOptions() : {});
}

function escapeHtml(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function injectStyle(id, cssText) {
  if (document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = cssText;
  document.head.appendChild(style);
}

function loadStylesheet(url, id) {
  if (!url || document.getElementById(id)) return Promise.resolve();
  return new Promise(function (resolve) {
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = url;
    link.onload = function () { resolve(); };
    link.onerror = function () { resolve(); };
    document.head.appendChild(link);
  });
}

function loadScript(url, id, globalCheck) {
  if (globalCheck && globalCheck()) return Promise.resolve();
  if (!url) return Promise.reject(new Error("Leaflet script URL is not configured."));
  if (leafletPromise) return leafletPromise;
  leafletPromise = new Promise(function (resolve, reject) {
    const existing = document.getElementById(id);
    if (existing) {
      existing.addEventListener("load", function () { resolve(); }, { once: true });
      existing.addEventListener("error", function () { reject(new Error("Leaflet failed to load.")); }, { once: true });
      return;
    }
    const script = document.createElement("script");
    script.id = id;
    script.src = url;
    script.async = true;
    script.onload = function () { resolve(); };
    script.onerror = function () { reject(new Error("Leaflet failed to load.")); };
    document.head.appendChild(script);
  });
  return leafletPromise;
}

function ensureLeaflet(options) {
  if (window.L && window.L.map) return Promise.resolve(window.L);
  if (!options.loadLeaflet) return Promise.reject(new Error("Leaflet is not loaded."));
  return loadStylesheet(options.leafletCssUrl, "rwas-leaflet-css")
    .then(function () {
      return loadScript(options.leafletJsUrl, "rwas-leaflet-js", function () {
        return window.L && window.L.map;
      });
    })
    .then(function () {
      if (!window.L || !window.L.map) throw new Error("Leaflet is not available after loading.");
      return window.L;
    });
}

function statusColor(feature) {
  const props = feature && feature.properties ? feature.properties : {};
  const colour = String(props.colourCode || props.severity || "").toLowerCase();
  if (colour.indexOf("red") >= 0 || colour.indexOf("extreme") >= 0 || colour.indexOf("severe") >= 0) return "#d32f2f";
  if (colour.indexOf("orange") >= 0) return "#ff8918";
  if (colour.indexOf("yellow") >= 0 || colour.indexOf("minor") >= 0) return "#fbc02d";
  if (colour.indexOf("green") >= 0) return "#388e3c";
  return "#dc3545";
}

function featureTitle(feature) {
  const props = feature && feature.properties ? feature.properties : {};
  return props.title || props.event || props.id || "RWAS alert";
}

function featurePopupHtml(feature) {
  const props = feature && feature.properties ? feature.properties : {};
  const rows = [
    ["Source", props.sourceLabel || props.source || ""],
    ["Status", props.status || ""],
    ["Severity", props.severity || props.colourCode || ""]
  ].filter(function (row) { return row[1]; });
  return "<strong>" + escapeHtml(featureTitle(feature)) + "</strong>" +
    rows.map(function (row) {
      return "<br><span>" + escapeHtml(row[0]) + ": " + escapeHtml(row[1]) + "</span>";
    }).join("");
}

function alertId(alert, index) {
  return alert && (alert.id || alert.title || alert.link || ("alert-" + index));
}

function alertRows(alerts) {
  return (alerts || []).map(function (alert, index) {
    return '<button type="button" class="rwas-map-alert-row" data-rwas-map-alert="' + escapeHtml(alertId(alert, index)) + '">' +
      '<span class="rwas-map-alert-title">' + escapeHtml(alert.title || "RWAS alert") + "</span>" +
      '<span class="rwas-map-alert-meta">' + escapeHtml([alert.sourceLabel || alert.source || "", alert.status || ""].filter(Boolean).join(" - ")) + "</span>" +
      "</button>";
  }).join("");
}

function ensureSlotRoot(slot) {
  if (!slot) return null;
  let root = slot.querySelector('[data-rwas-extension="' + PLUGIN_ID + '"]');
  if (!root) {
    root = document.createElement("div");
    root.setAttribute("data-rwas-extension", PLUGIN_ID);
    slot.appendChild(root);
  }
  return root;
}

function removeMap(map) {
  if (map && typeof map.remove === "function") {
    map.remove();
  }
}

function geometryFeatureCollection(features) {
  return {
    type: "FeatureCollection",
    features: Array.isArray(features) ? features.filter(function (feature) {
      return feature && feature.geometry;
    }) : []
  };
}

function collectLongitudes(coordinates, values) {
  if (!Array.isArray(coordinates)) return;
  if (typeof coordinates[0] === "number" && typeof coordinates[1] === "number") {
    if (Number.isFinite(coordinates[0])) values.push(coordinates[0]);
    return;
  }
  coordinates.forEach(function (entry) {
    collectLongitudes(entry, values);
  });
}

function shiftNegativeLongitudes(coordinates) {
  if (!Array.isArray(coordinates)) return coordinates;
  if (typeof coordinates[0] === "number" && typeof coordinates[1] === "number") {
    const shifted = coordinates.slice();
    if (shifted[0] < 0) shifted[0] += 360;
    return shifted;
  }
  return coordinates.map(shiftNegativeLongitudes);
}

function normalizeFeatureCollectionForMap(featureCollection, enabled) {
  const source = geometryFeatureCollection(featureCollection && featureCollection.features);
  const clone = JSON.parse(JSON.stringify(source));
  const longitudes = [];
  clone.features.forEach(function (feature) {
    collectLongitudes(feature && feature.geometry && feature.geometry.coordinates, longitudes);
  });
  if (enabled === false || longitudes.length < 2) {
    return { featureCollection: clone, adjusted: false };
  }
  let rawMin = Infinity;
  let rawMax = -Infinity;
  let shiftedMin = Infinity;
  let shiftedMax = -Infinity;
  longitudes.forEach(function (longitude) {
    const shiftedLongitude = longitude < 0 ? longitude + 360 : longitude;
    rawMin = Math.min(rawMin, longitude);
    rawMax = Math.max(rawMax, longitude);
    shiftedMin = Math.min(shiftedMin, shiftedLongitude);
    shiftedMax = Math.max(shiftedMax, shiftedLongitude);
  });
  const rawSpan = rawMax - rawMin;
  const shiftedSpan = shiftedMax - shiftedMin;
  if (shiftedSpan >= rawSpan) {
    return {
      featureCollection: clone,
      adjusted: false,
      rawSpan: rawSpan,
      displaySpan: rawSpan
    };
  }
  clone.features.forEach(function (feature) {
    if (feature && feature.geometry) {
      feature.geometry.coordinates = shiftNegativeLongitudes(feature.geometry.coordinates);
    }
  });
  return {
    featureCollection: clone,
    adjusted: true,
    rawSpan: rawSpan,
    displaySpan: shiftedSpan
  };
}

function bindAlertList(plugin, root) {
  root.querySelectorAll("[data-rwas-map-alert]").forEach(function (button) {
    button.addEventListener("click", function () {
      const id = button.getAttribute("data-rwas-map-alert");
      const target = plugin.featureLayersByAlert[id];
      if (!target || !plugin.map) return;
      if (target.getBounds) {
        plugin.map.fitBounds(target.getBounds(), { padding: [24, 24] });
      } else if (target.getLatLng) {
        plugin.map.setView(target.getLatLng(), Math.max(plugin.map.getZoom(), 12));
      }
      if (target.openPopup) target.openPopup();
    });
  });
}

function applyPopupMode(panel, isMapMode, options) {
  if (!panel) return;
  panel.classList.toggle("rwas-map-view-active", !!(isMapMode && options.transformPopup));
  panel.style.setProperty("--rwas-map-height", String(options.mapHeight || DEFAULTS.mapHeight) + "px");
}

function renderShell(plugin, context, api) {
  const options = plugin.options;
  const slot = context.slots[options.slotName] || context.slots["popup-before-alerts"];
  const root = ensureSlotRoot(slot);
  if (!root) return null;
  const alerts = context.alerts || [];
  const features = geometryFeatureCollection(context.features && context.features.features);
  const isMapMode = plugin.mode !== "list";
  root.innerHTML =
    '<section class="rwas-map-extension" data-rwas-map-mode="' + (isMapMode ? "map" : "list") + '">' +
      '<div class="rwas-map-toolbar">' +
        '<div class="rwas-map-titleblock">' +
          '<strong>Map view</strong>' +
          '<span>' + escapeHtml(features.features.length) + " mapped feature(s), " + escapeHtml(alerts.length) + " alert(s)</span>" +
        "</div>" +
        '<div class="rwas-map-actions">' +
          '<button type="button" data-rwas-map-mode="map" aria-pressed="' + (isMapMode ? "true" : "false") + '">Map</button>' +
          '<button type="button" data-rwas-map-mode="list" aria-pressed="' + (!isMapMode ? "true" : "false") + '">List</button>' +
          '<button type="button" data-rwas-map-fit>Fit</button>' +
        "</div>" +
      "</div>" +
      '<div class="rwas-map-canvas" data-rwas-map-canvas></div>' +
      '<div class="rwas-map-status" data-rwas-map-status>Loading map</div>' +
      (isMapMode && options.showAlertList ? '<div class="rwas-map-alert-list">' + alertRows(alerts) + "</div>" : "") +
    "</section>";
  root.querySelectorAll("button[data-rwas-map-mode]").forEach(function (button) {
    button.addEventListener("click", function () {
      plugin.mode = button.getAttribute("data-rwas-map-mode") === "list" ? "list" : "map";
      plugin.render(context, api);
    });
  });
  const fitButton = root.querySelector("[data-rwas-map-fit]");
  if (fitButton) {
    fitButton.addEventListener("click", function () {
      plugin.fitMapToAlerts();
    });
  }
  bindAlertList(plugin, root);
  return root;
}

function setMapStatus(root, text, state) {
  const status = root && root.querySelector("[data-rwas-map-status]");
  if (!status) return;
  status.textContent = text || "";
  status.setAttribute("data-state", state || "");
}

const mapPlugin = {
  id: PLUGIN_ID,
  name: "RWAS Map View",
  version: VERSION,
  description: "Transforms the RWAS popup into a Leaflet map view with alert polygons and standard map controls.",
  category: "map",
  capabilities: ["map", "leaflet", "geojson", "popup-transform", "agent-metadata"],
  agentMetadata: {
    purpose: "Displays RWAS CAP polygon features on a Leaflet map inside the popup.",
    reads: ["alerts", "features", "runtime", "pluginConfig.rwas-map-view"],
    writes: ["popup-before-alerts", "popup presentation state"],
    mapLibrary: "Leaflet"
  },
  options: DEFAULTS,
  mode: null,
  map: null,
  featureLayer: null,
  markerLayer: null,
  featureLayersByAlert: {},
  renderToken: 0,

  init: function (api) {
    this.options = getOptions(api);
    this.mode = this.options.defaultMode === "list" ? "list" : "map";
    injectStyle("rwas-map-view-plugin-styles", `
.rwas-popup-panel.rwas-map-view-active {
  width: min(960px, calc(100vw - 32px));
  max-height: min(86vh, 820px);
}
.rwas-popup-panel.rwas-map-view-active .rwas-popup-body > .alert-card {
  display: none;
}
.rwas-map-extension {
  border: 1px solid #cdd5e0;
  border-radius: 8px;
  background: #ffffff;
  overflow: hidden;
}
.rwas-map-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px;
  border-bottom: 1px solid #d7dce5;
  background: #f8fafc;
}
.rwas-map-titleblock {
  display: grid;
  gap: 2px;
  min-width: 0;
}
.rwas-map-titleblock strong {
  font-size: 13px;
}
.rwas-map-titleblock span {
  color: #5d6678;
  font-size: 12px;
}
.rwas-map-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
}
.rwas-map-actions button,
.rwas-map-alert-row {
  min-height: 30px;
  border: 1px solid #aeb6c4;
  border-radius: 6px;
  background: #ffffff;
  color: #172033;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  font-weight: 700;
}
.rwas-map-actions button {
  padding: 4px 8px;
}
.rwas-map-actions button[aria-pressed="true"] {
  border-color: #7f1d1d;
  background: #b91c1c;
  color: #ffffff;
}
.rwas-map-canvas {
  display: block;
  min-height: var(--rwas-map-height, 390px);
  background: #e8eef5;
}
.rwas-map-extension[data-rwas-map-mode="list"] .rwas-map-canvas {
  display: none;
}
.rwas-map-status {
  padding: 7px 10px;
  color: #5d6678;
  font-size: 12px;
  border-top: 1px solid #d7dce5;
}
.rwas-map-status[data-state="error"] {
  color: #b91c1c;
}
.rwas-map-alert-list {
  display: grid;
  gap: 6px;
  padding: 8px;
  max-height: 170px;
  overflow: auto;
  border-top: 1px solid #d7dce5;
}
.rwas-map-extension[data-rwas-map-mode="map"] .rwas-map-alert-list {
  max-height: 120px;
}
.rwas-map-alert-row {
  display: grid;
  gap: 2px;
  width: 100%;
  padding: 7px 8px;
  text-align: left;
}
.rwas-map-alert-row:hover,
.rwas-map-alert-row:focus-visible {
  border-color: #b91c1c;
  outline: none;
}
.rwas-map-alert-title {
  color: #172033;
  font-size: 12px;
}
.rwas-map-alert-meta {
  color: #5d6678;
  font-size: 11px;
  font-weight: 400;
}
.rwas-map-extension .leaflet-container {
  font: inherit;
}
@media (max-width: 600px) {
  .rwas-map-toolbar {
    align-items: stretch;
    flex-direction: column;
  }
  .rwas-map-actions {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}
`);
    if (api && api.setMetadata) {
      api.setMetadata({
        enabled: this.options.enabled,
        defaultMode: this.options.defaultMode,
        leafletCssUrl: this.options.leafletCssUrl,
        leafletJsUrl: this.options.leafletJsUrl
      });
    }
  },

  render: function (context, api) {
    this.options = getOptions(api);
    if (!this.options.enabled) {
      applyPopupMode(context.panel, false, this.options);
      return;
    }
    const root = renderShell(this, context, api);
    if (!root) return;
    applyPopupMode(context.panel, this.mode !== "list", this.options);
    if (this.map) {
      removeMap(this.map);
      this.map = null;
      this.featureLayer = null;
      this.markerLayer = null;
      this.featureLayersByAlert = {};
    }
    if (this.mode === "list") {
      setMapStatus(root, "List view is active.", "ready");
      return;
    }
    this.renderToken += 1;
    const token = this.renderToken;
    const features = geometryFeatureCollection(context.features && context.features.features);
    const displayFeatures = normalizeFeatureCollectionForMap(features, this.options.wrapAntimeridian);
    const alerts = context.alerts || [];
    ensureLeaflet(this.options)
      .then(function (L) {
        if (token !== mapPlugin.renderToken) return;
        mapPlugin.buildMap(L, root, displayFeatures.featureCollection, alerts, api, displayFeatures);
      })
      .catch(function (error) {
        if (api && api.setMetadata) {
          api.setMetadata({ leafletStatus: "error", leafletError: error.message });
        }
        setMapStatus(root, "Leaflet map could not load. Alert list remains available.", "error");
      });
  },

  buildMap: function (L, root, featureCollection, alerts, api, displayInfo) {
    const container = root.querySelector("[data-rwas-map-canvas]");
    if (!container) return;
    const options = this.options;
    this.featureLayersByAlert = {};
    this.map = L.map(container, {
      scrollWheelZoom: !!options.scrollWheelZoom
    });
    const baseLayer = L.tileLayer(options.tileLayerUrl, {
      attribution: options.tileLayerAttribution,
      maxZoom: options.maxZoom
    }).addTo(this.map);
    const overlays = {};
    const baseLayers = { "OpenStreetMap": baseLayer };
    this.featureLayer = L.geoJSON(featureCollection, {
      style: function (feature) {
        const color = statusColor(feature);
        return {
          color: color,
          fillColor: color,
          fillOpacity: 0.22,
          opacity: 0.92,
          weight: 3
        };
      },
      onEachFeature: function (feature, layer) {
        const id = feature && feature.properties && feature.properties.id;
        if (id) mapPlugin.featureLayersByAlert[id] = layer;
        layer.bindPopup(featurePopupHtml(feature));
      }
    }).addTo(this.map);
    overlays["Alert polygons"] = this.featureLayer;
    if (options.showCentroidMarkers) {
      this.markerLayer = L.layerGroup();
      this.featureLayer.eachLayer(function (layer) {
        if (!layer.getBounds) return;
        const center = layer.getBounds().getCenter();
        const popup = layer.getPopup ? layer.getPopup() : null;
        const marker = L.marker(center);
        if (popup) marker.bindPopup(popup.getContent());
        marker.addTo(mapPlugin.markerLayer);
      });
      this.markerLayer.addTo(this.map);
      overlays["Alert centres"] = this.markerLayer;
    }
    L.control.layers(baseLayers, overlays, { collapsed: true }).addTo(this.map);
    if (options.showScale) {
      L.control.scale({ imperial: false }).addTo(this.map);
    }
    if (featureCollection.features.length && options.fitToAlerts && this.featureLayer.getBounds().isValid()) {
      this.map.fitBounds(this.featureLayer.getBounds(), {
        padding: [options.fitPadding, options.fitPadding]
      });
    } else {
      this.map.setView(options.defaultCenter, options.defaultZoom);
    }
    setMapStatus(root, featureCollection.features.length ? "Map ready." : "Map ready. No alert polygons are available.", "ready");
    bindAlertList(this, root);
    setTimeout(function () {
      if (mapPlugin.map) mapPlugin.map.invalidateSize();
    }, 80);
    if (api && api.setMetadata) {
      api.setMetadata({
        leafletStatus: "ready",
        featureCount: featureCollection.features.length,
        alertCount: alerts.length,
        antimeridianAdjusted: !!(displayInfo && displayInfo.adjusted),
        displayLongitudeSpan: displayInfo && displayInfo.displaySpan
      });
    }
  },

  fitMapToAlerts: function () {
    if (!this.map || !this.featureLayer || !this.featureLayer.getBounds) return;
    const bounds = this.featureLayer.getBounds();
    if (bounds && bounds.isValid()) {
      this.map.fitBounds(bounds, { padding: [this.options.fitPadding, this.options.fitPadding] });
    }
  },

  destroy: function () {
    removeMap(this.map);
    this.map = null;
  }
};

window.RWAS_MAP_VIEW_UTILS = {
  normalizeFeatureCollection: normalizeFeatureCollectionForMap
};
window.RWAS_PLUGINS = window.RWAS_PLUGINS || [];
window.RWAS_PLUGINS.push(mapPlugin);
})(window, document);
