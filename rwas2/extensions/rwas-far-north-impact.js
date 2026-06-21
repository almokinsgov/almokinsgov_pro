;(function (window, document) {
"use strict";

const STYLE_ID = "rwas-far-north-impact-styles";

function mergeOptions(defaults, next) {
  return Object.assign({}, defaults || {}, next || {});
}

function escapeHtml(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.rwas-popup-panel .rwas-impact-details {
  margin-top: 10px;
  border-top: 1px solid rgba(23, 32, 51, 0.18);
  padding-top: 8px;
}
.rwas-popup-panel .rwas-impact-details summary {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 30px;
  cursor: pointer;
  color: #172033;
  font-size: 12px;
  font-weight: 800;
}
.rwas-popup-panel .rwas-impact-details summary::-webkit-details-marker {
  display: none;
}
.rwas-popup-panel .rwas-impact-details summary::before {
  width: 0;
  height: 0;
  flex: 0 0 auto;
  border-top: 5px solid transparent;
  border-bottom: 5px solid transparent;
  border-left: 7px solid #991b1b;
  content: "";
  transition: transform 120ms ease;
}
.rwas-popup-panel .rwas-impact-details[open] summary::before {
  transform: rotate(90deg);
}
.rwas-popup-panel .rwas-impact-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  min-height: 20px;
  margin-left: auto;
  padding: 1px 6px;
  border: 1px solid #c8ced8;
  border-radius: 999px;
  background: #ffffff;
  color: #4b5563;
  font-size: 11px;
}
.rwas-popup-panel .rwas-impact-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 5px 12px;
  max-height: 220px;
  overflow: auto;
  margin: 7px 0 0;
  padding: 8px 8px 8px 26px;
  border: 1px solid #d7dce5;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.72);
  color: #374151;
  font-size: 12px;
}
.rwas-popup-panel .rwas-impact-empty {
  margin: 7px 0 0;
  color: #5d6678;
  font-size: 12px;
}
@media (max-width: 520px) {
  .rwas-popup-panel .rwas-impact-list {
    grid-template-columns: 1fr;
  }
}`;
  document.head.appendChild(style);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function walkCoordinates(coordinates, visitor) {
  if (!Array.isArray(coordinates)) return;
  if (typeof coordinates[0] === "number" && typeof coordinates[1] === "number") {
    visitor(coordinates[0], coordinates[1]);
    return;
  }
  coordinates.forEach(function (entry) {
    walkCoordinates(entry, visitor);
  });
}

function featureBbox(feature) {
  const bbox = [Infinity, Infinity, -Infinity, -Infinity];
  if (!feature || !feature.geometry) return null;
  walkCoordinates(feature.geometry.coordinates, function (longitude, latitude) {
    bbox[0] = Math.min(bbox[0], longitude);
    bbox[1] = Math.min(bbox[1], latitude);
    bbox[2] = Math.max(bbox[2], longitude);
    bbox[3] = Math.max(bbox[3], latitude);
  });
  return Number.isFinite(bbox[0]) ? bbox : null;
}

function bboxesIntersect(a, b) {
  if (!a || !b) return true;
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

function isRelativeUrl(url) {
  return !/^[a-z][a-z0-9+.-]*:/i.test(String(url || "")) && !String(url || "").startsWith("//");
}

function resolveDataUrl(api, options) {
  const url = String(options.geoJsonUrl || "").trim();
  if (!url || !options.useProxy || isRelativeUrl(url)) return url;
  const config = api && api.getConfig ? api.getConfig() : {};
  const proxy = String(options.proxy || config.proxy || "").trim();
  if (!proxy || url.indexOf(proxy) === 0) return url;
  return proxy + encodeURIComponent(url);
}

function fetchGeoJson(url, options) {
  if (!url) return Promise.reject(new Error("GeoJSON URL is not configured."));
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timeoutMs = Math.max(1000, Number(options.fetchTimeoutMs) || 30000);
  const timer = controller ? window.setTimeout(function () { controller.abort(); }, timeoutMs) : null;
  return fetch(url, {
    cache: options.cacheMode || "default",
    signal: controller ? controller.signal : undefined
  }).then(function (response) {
    if (!response.ok) throw new Error("HTTP " + response.status + " " + response.statusText);
    return response.json();
  }).finally(function () {
    if (timer) window.clearTimeout(timer);
  });
}

function normalizeDataset(data, options) {
  if (!data || data.type !== "FeatureCollection" || !Array.isArray(data.features)) {
    throw new Error("Expected a GeoJSON FeatureCollection.");
  }
  return data.features.map(function (feature) {
    const name = feature && feature.properties && feature.properties[options.nameProperty];
    if (!feature || !feature.geometry || !name) return null;
    return {
      name: String(name).trim(),
      feature: feature,
      bbox: featureBbox(feature)
    };
  }).filter(Boolean);
}

function alertGeometry(alert, matchMode, options) {
  return (alert && Array.isArray(alert.features) ? alert.features : [])
    .filter(function (feature) {
      return !!(feature && feature.geometry);
    })
    .map(function (feature) {
      const type = feature.geometry.type;
      let matchFeature = feature;
      if (matchMode === "point-in-polygon" && type !== "Polygon" && type !== "MultiPolygon") {
        const distance = Math.max(0, Number(options.nonPolygonBufferKm) || 0);
        if (!distance || !window.turf || typeof window.turf.buffer !== "function") return null;
        try {
          matchFeature = window.turf.buffer(feature, distance, { units: "kilometers" });
        } catch (error) {
          return null;
        }
      }
      return { feature: matchFeature, bbox: featureBbox(matchFeature) };
    })
    .filter(Boolean);
}

function matchesFeature(record, alertFeatures, matchMode, options) {
  if (!window.turf) return false;
  for (let index = 0; index < alertFeatures.length; index += 1) {
    const alertFeature = alertFeatures[index];
    if (options.useBboxPrefilter && !bboxesIntersect(record.bbox, alertFeature.bbox)) continue;
    try {
      if (matchMode === "point-in-polygon") {
        if (window.turf.booleanPointInPolygon(record.feature, alertFeature.feature)) return true;
      } else if (window.turf.booleanIntersects(record.feature, alertFeature.feature)) {
        return true;
      }
    } catch (error) {
      continue;
    }
  }
  return false;
}

function matchAlert(alert, dataset, matchMode, options) {
  const features = alertGeometry(alert, matchMode, options);
  if (!features.length) return [];
  const names = [];
  dataset.forEach(function (record) {
    if (matchesFeature(record, features, matchMode, options)) names.push(record.name);
  });
  return Array.from(new Set(names)).sort(function (a, b) {
    return a.localeCompare(b, options.sortLocale || "en-NZ");
  });
}

function detailsHtml(pluginId, names, options) {
  const maximum = Math.max(0, Math.floor(Number(options.maxItems) || 0));
  const visible = maximum > 0 ? names.slice(0, maximum) : names;
  const hiddenCount = names.length - visible.length;
  const listItems = visible.map(function (name) {
    return "<li>" + escapeHtml(name) + "</li>";
  });
  if (hiddenCount > 0) {
    listItems.push("<li>and " + hiddenCount + " more</li>");
  }
  return '<details class="rwas-impact-details" data-rwas-impact="' + escapeHtml(pluginId) + '"' +
    (options.openByDefault ? " open" : "") + ">" +
    "<summary><span>" + escapeHtml(options.sectionLabel) + '</span><span class="rwas-impact-count">' +
      names.length + "</span></summary>" +
    (names.length
      ? '<ul class="rwas-impact-list">' + listItems.join("") + "</ul>"
      : '<p class="rwas-impact-empty">' + escapeHtml(options.emptyMessage) + "</p>") +
    "</details>";
}

function createPlugin(definition) {
  const defaults = mergeOptions({
    enabled: true,
    geoJsonUrl: "",
    nameProperty: "name",
    sectionLabel: "Affected locations",
    openByDefault: false,
    showWhenEmpty: false,
    emptyMessage: "No matching locations were identified.",
    maxItems: 0,
    sortLocale: "en-NZ",
    useBboxPrefilter: true,
    useProxy: false,
    proxy: "",
    cacheMode: "default",
    fetchTimeoutMs: 30000,
    nonPolygonBufferKm: 2
  }, definition.defaults);

  return {
    id: definition.id,
    name: definition.name,
    version: definition.version || "0.1.0",
    description: definition.description,
    category: "alert-enrichment",
    capabilities: ["alert-card-enrichment", "geojson", definition.matchMode, "agent-metadata"],
    agentMetadata: {
      purpose: definition.description,
      reads: ["alert polygon features", "pluginConfig." + definition.id, defaults.geoJsonUrl],
      writes: ["expandable alert-card section"]
    },
    options: defaults,
    dataset: null,
    datasetUrl: "",
    datasetPromise: null,
    lastContext: null,
    lastApi: null,
    lastMatchCount: 0,

    getOptions: function (api) {
      return mergeOptions(defaults, api && api.getOptions ? api.getOptions() : {});
    },

    init: function (api) {
      injectStyles();
      this.lastApi = api;
      this.loadDataset(api);
    },

    loadDataset: function (api) {
      const plugin = this;
      const options = this.getOptions(api);
      if (!options.enabled) return Promise.resolve([]);
      const url = resolveDataUrl(api, options);
      if (this.dataset && this.datasetUrl === url) return Promise.resolve(this.dataset);
      if (this.datasetPromise && this.datasetUrl === url) return this.datasetPromise;
      this.datasetUrl = url;
      this.dataset = null;
      this.datasetPromise = fetchGeoJson(url, options)
        .then(function (data) {
          plugin.dataset = normalizeDataset(data, options);
          if (api && api.setMetadata) {
            api.setMetadata({
              dataStatus: "ready",
              geoJsonUrl: options.geoJsonUrl,
              featureCount: plugin.dataset.length,
              nameProperty: options.nameProperty,
              matchMode: definition.matchMode
            });
          }
          if (plugin.lastContext) plugin.render(plugin.lastContext, api);
          return plugin.dataset;
        })
        .catch(function (error) {
          plugin.dataset = [];
          if (api && api.setMetadata) {
            api.setMetadata({
              dataStatus: "error",
              geoJsonUrl: options.geoJsonUrl,
              error: error.message
            });
          }
          console.warn(definition.name + " could not load GeoJSON:", error);
          return [];
        })
        .finally(function () {
          plugin.datasetPromise = null;
        });
      return this.datasetPromise;
    },

    removeExisting: function (panel) {
      if (!panel) return;
      panel.querySelectorAll('[data-rwas-impact="' + definition.id + '"]').forEach(function (element) {
        element.remove();
      });
    },

    render: function (context, api) {
      this.lastContext = context;
      this.lastApi = api;
      const options = this.getOptions(api);
      this.removeExisting(context && context.panel);
      if (!options.enabled || !context || context.state === "empty") return;
      if (!this.dataset || this.datasetUrl !== resolveDataUrl(api, options)) {
        this.loadDataset(api);
        return;
      }
      const directCards = Array.from(context.panel.querySelectorAll(".rwas-popup-body > .alert-card"));
      const cardsByKey = {};
      context.panel.querySelectorAll(".alert-card[data-rwas-alert-key]").forEach(function (card) {
        cardsByKey[card.getAttribute("data-rwas-alert-key")] = card;
      });
      const alerts = Array.isArray(context.allAlerts) ? context.allAlerts : (context.alerts || []);
      let directCardIndex = 0;
      let totalMatches = 0;
      alerts.forEach(function (alert) {
        const key = alert && alert.rwasDismissalKey;
        const card = key && cardsByKey[key]
          ? cardsByKey[key]
          : (!alert.dismissed ? directCards[directCardIndex++] : null);
        if (!card) return;
        const names = matchAlert(alert, this.dataset, definition.matchMode, options);
        totalMatches += names.length;
        if (!names.length && !options.showWhenEmpty) return;
        card.insertAdjacentHTML("beforeend", detailsHtml(definition.id, names, options));
      }, this);
      this.lastMatchCount = totalMatches;
      if (api && api.setMetadata) {
        api.setMetadata({
          dataStatus: "ready",
          featureCount: this.dataset.length,
          totalMatches: totalMatches,
          alertCount: alerts.length
        });
      }
    },

    onRuntimeUpdated: function (runtime, api) {
      const options = this.getOptions(api);
      const url = resolveDataUrl(api, options);
      if (options.enabled && (!this.dataset || this.datasetUrl !== url)) {
        this.loadDataset(api);
      }
    },

    destroy: function () {
      if (this.lastContext) this.removeExisting(this.lastContext.panel);
      this.dataset = null;
      this.datasetPromise = null;
    }
  };
}

window.RWAS_FAR_NORTH_IMPACT = {
  createPlugin: createPlugin,
  featureBbox: featureBbox,
  matchAlert: matchAlert,
  cloneJson: cloneJson
};
})(window, document);
