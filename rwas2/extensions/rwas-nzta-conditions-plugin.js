;(function (window, document) {
"use strict";

const PLUGIN_ID = "rwas-nzta-conditions";
const VERSION = "0.1.0";
const DEFAULT_EVENT_TYPES = ["closures", "warnings", "roadworks", "hazards"];
const DEFAULTS = {
  enabled: true,
  feedUrl: "https://www.journeys.nzta.govt.nz/assets/map-data-cache/delays.json",
  eventTypes: DEFAULT_EVENT_TYPES,
  useProxy: true,
  proxy: "",
  fetchTimeoutMs: 30000,
  cacheMode: "no-store",
  filterByArea: true,
  includeScheduled: true,
  includeExpired: null,
  includeItemsWithoutGeometry: false,
  roadEventsOnly: true,
  maxAlerts: 0,
  sourceLabel: "NZTA Journey Planner",
  badgeText: "NZTA",
  linkUrl: "https://www.journeys.nzta.govt.nz/highway-conditions",
  linkLabel: "View this condition on NZTA Journey Planner."
};

function mergeDefined(base, next) {
  const out = Object.assign({}, base || {});
  Object.keys(next || {}).forEach(function (key) {
    if (next[key] !== undefined) out[key] = next[key];
  });
  return out;
}

function configOptions(api) {
  const config = api && api.getConfig ? api.getConfig() : {};
  const pluginOptions = api && api.getOptions ? api.getOptions() : {};
  const aliases = {};
  if (typeof config.enableNztaAlerts === "boolean") aliases.enabled = config.enableNztaAlerts;
  if (typeof config.nztaUrl === "string" && config.nztaUrl.trim()) aliases.feedUrl = config.nztaUrl.trim();
  if (Array.isArray(config.nztaEventTypes)) aliases.eventTypes = config.nztaEventTypes;
  if (typeof config.nztaUseProxy === "boolean") aliases.useProxy = config.nztaUseProxy;
  return mergeDefined(mergeDefined(DEFAULTS, pluginOptions), aliases);
}

function escapeHtml(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function cleanText(value) {
  const text = String(value || "");
  if (!/<[a-z][\s\S]*>/i.test(text)) return text.replace(/\s+/g, " ").trim();
  const doc = new DOMParser().parseFromString(text, "text/html");
  return String(doc.body ? doc.body.textContent : text).replace(/\s+/g, " ").trim();
}

function isRelativeUrl(url) {
  return !/^[a-z][a-z0-9+.-]*:/i.test(String(url || "")) && !String(url || "").startsWith("//");
}

function requestUrl(api, options) {
  const url = String(options.feedUrl || "").trim();
  if (!url || !options.useProxy || isRelativeUrl(url)) return url;
  const config = api && api.getConfig ? api.getConfig() : {};
  const proxy = String(options.proxy || config.proxy || "").trim();
  if (!proxy || url.indexOf(proxy) === 0) return url;
  return proxy + encodeURIComponent(url);
}

function fetchJson(url, options) {
  if (!url) return Promise.reject(new Error("NZTA feed URL is not configured."));
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timeoutMs = Math.max(1000, Number(options.fetchTimeoutMs) || 30000);
  const timer = controller ? window.setTimeout(function () { controller.abort(); }, timeoutMs) : null;
  return fetch(url, {
    cache: options.cacheMode || "no-store",
    signal: controller ? controller.signal : undefined
  }).then(function (response) {
    if (!response.ok) throw new Error("HTTP " + response.status + " " + response.statusText);
    return response.json();
  }).finally(function () {
    if (timer) window.clearTimeout(timer);
  });
}

function normalizeEventTypes(value) {
  const source = Array.isArray(value)
    ? value
    : String(value || "").split(",");
  return Array.from(new Set(source.map(function (entry) {
    return String(entry || "").trim().toLowerCase();
  }).filter(Boolean)));
}

function parseDate(value) {
  if (!value) return null;
  const normalized = String(value).trim().replace(" ", "T");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isoDate(value) {
  const date = parseDate(value);
  return date ? date.toISOString() : "";
}

function alertStatus(properties, options) {
  const now = new Date();
  const starts = parseDate(properties.StartDate);
  const ends = parseDate(properties.EndDate);
  if (ends && ends < now) return "expired";
  if (starts && starts > now) return "upcoming";
  if (String(properties.Status || "").toLowerCase() === "scheduled" && options.includeScheduled) {
    return starts && starts > now ? "upcoming" : "active-now";
  }
  return "active-now";
}

function statusBadge(status) {
  if (status === "upcoming") return '<span class="badge upcoming-badge">Upcoming</span>';
  if (status === "expired") return '<span class="badge expired-badge">Expired</span>';
  return '<span class="badge active-badge">Active Now</span>';
}

function typePresentation(type, properties) {
  if (type === "closures") return { label: "Closure", cardClass: "alert-red", badgeClass: "alert-red", colourCode: "Red" };
  if (type === "warnings") return { label: "Warning", cardClass: "alert-orange", badgeClass: "alert-orange", colourCode: "Orange" };
  if (type === "hazards") return { label: "Hazard", cardClass: "alert-yellow", badgeClass: "alert-yellow", colourCode: "Yellow" };
  if (type === "roadworks") return { label: "Roadworks", cardClass: "alert-yellow", badgeClass: "alert-yellow", colourCode: "Yellow" };
  if (properties && properties.IsCritical) return { label: properties.EventType || "Critical", cardClass: "alert-red", badgeClass: "alert-red", colourCode: "Red" };
  return { label: properties && properties.EventType || type || "Condition", cardClass: "alert-default", badgeClass: "alert-default", colourCode: "" };
}

function cloneFeature(feature, alertProperties) {
  if (!feature || !feature.geometry) return null;
  const clone = JSON.parse(JSON.stringify(feature));
  clone.properties = Object.assign({}, clone.properties || {}, alertProperties || {});
  return clone;
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
  if (!feature || !feature.geometry) return null;
  const bbox = [Infinity, Infinity, -Infinity, -Infinity];
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

function areaRecords(api) {
  if (!api.getAreaFeatures) return [];
  const areaCollection = api.getAreaFeatures();
  return (areaCollection.features || []).map(function (feature) {
    return { feature: feature, bbox: featureBbox(feature) };
  });
}

function matchedAreaNames(feature, areas) {
  if (!feature || !feature.geometry || !window.turf) return [];
  const bbox = featureBbox(feature);
  const names = [];
  (areas || []).forEach(function (area) {
    if (!bboxesIntersect(bbox, area.bbox)) return;
    try {
      if (window.turf.booleanIntersects(feature, area.feature)) {
        const name = area.feature.properties && area.feature.properties.rwasAreaName;
        if (name) names.push(name);
      }
    } catch (error) {
      return;
    }
  });
  return Array.from(new Set(names));
}

function includeByArea(options, feature) {
  if (!options.filterByArea) return true;
  if (!feature || !feature.geometry) return !!options.includeItemsWithoutGeometry;
  const scope = window.RWAS_ALERT_SCOPE_API;
  if (!scope || typeof scope.featureMatchesAreaScope !== "function") return true;
  if (scope.showNonFarNorthAlerts) return true;
  return scope.featureMatchesAreaScope(feature);
}

function timingText(properties) {
  const parts = [];
  if (properties.StartDateNice) parts.push("Starts " + properties.StartDateNice);
  if (properties.EndDateNice) parts.push("Ends " + properties.EndDateNice);
  else if (properties.ExpectedResolution) parts.push("Expected resolution: " + properties.ExpectedResolution);
  return parts.join(". ");
}

function otherDetails(properties) {
  const parts = [];
  if (properties.Impact) parts.push("Impact: " + properties.Impact);
  const route = cleanText(properties.AlternativeRoute);
  if (route && !/^(n\/?a|not applicable)$/i.test(route)) parts.push("Alternative route: " + route);
  if (properties.Status) parts.push("Status: " + properties.Status);
  if (properties.InformationSource) parts.push("Information source: " + properties.InformationSource);
  if (properties.LastUpdatedNice) parts.push("Last updated: " + properties.LastUpdatedNice);
  return parts.join(". ");
}

function cardHtml(properties, status, presentation, options) {
  const title = cleanText(properties.Name || properties.EventType || "NZTA road condition");
  const eventText = [cleanText(properties.EventType), cleanText(properties.EventDescription)].filter(Boolean).join(" - ");
  const locationText = cleanText(properties.LocationArea || properties.EventIsland || "");
  const details = cleanText(properties.EventComments || properties.Content || "");
  const timing = timingText(properties);
  const other = otherDetails(properties);
  return '\n<div class="alert-card far-north ' + status + " " + presentation.cardClass + '">' +
    "<b>" + escapeHtml(title) + "</b><br>" +
    (eventText ? "<b>Event:</b> " + escapeHtml(eventText) + "<br>" : "") +
    (locationText ? "<b>Location:</b> " + escapeHtml(locationText) + "<br>" : "") +
    (details ? "<b>Details:</b> " + escapeHtml(details) + "<br>" : "") +
    (timing ? "<b>Timing:</b> " + escapeHtml(timing) + "<br>" : "") +
    (other ? "<b>Additional information:</b> " + escapeHtml(other) + "<br>" : "") +
    (options.linkUrl ? '<a href="' + escapeHtml(options.linkUrl) + '" target="_blank" rel="noopener">' +
      escapeHtml(options.linkLabel) + "</a><br>" : "") +
    '<span class="badge alert-nzta">' + escapeHtml(options.badgeText) + "</span> " +
    '<span class="badge ' + presentation.badgeClass + '">' + escapeHtml(presentation.label) + "</span> " +
    statusBadge(status) +
  "\n</div>";
}

function injectStyles() {
  if (document.getElementById("rwas-nzta-conditions-styles")) return;
  const style = document.createElement("style");
  style.id = "rwas-nzta-conditions-styles";
  style.textContent = `
.rwas-popup-panel .badge.alert-nzta {
  border: 1px solid #ffffff;
  background: #00529b;
  color: #ffffff;
}`;
  document.head.appendChild(style);
}

const nztaPlugin = {
  id: PLUGIN_ID,
  name: "RWAS NZTA Conditions and Warnings",
  version: VERSION,
  description: "Adds selected NZTA Journey Planner road conditions as native RWAS alerts.",
  category: "alert-provider",
  capabilities: ["alert-provider", "geojson", "transport", "map", "notification", "agent-metadata"],
  agentMetadata: {
    purpose: "Loads NZTA closures, warnings, roadworks, and hazards into the RWAS alert lifecycle.",
    reads: ["NZTA delays GeoJSON", "RWAS area scope", "pluginConfig.rwas-nzta-conditions"],
    writes: ["RWAS alert collection"]
  },
  options: DEFAULTS,

  init: function (api) {
    injectStyles();
    const options = configOptions(api);
    if (api && api.setMetadata) {
      api.setMetadata({
        feedUrl: options.feedUrl,
        eventTypes: normalizeEventTypes(options.eventTypes),
        useProxy: !!options.useProxy
      });
    }
  },

  provideAlerts: async function (api) {
    const options = configOptions(api);
    if (!options.enabled) return [];
    const url = requestUrl(api, options);
    const data = await fetchJson(url, options);
    if (!data || data.type !== "FeatureCollection" || !Array.isArray(data.features)) {
      throw new Error("Expected NZTA delays GeoJSON FeatureCollection.");
    }
    const selectedTypes = normalizeEventTypes(options.eventTypes);
    const config = api.getConfig ? api.getConfig() : {};
    const includeExpired = typeof options.includeExpired === "boolean"
      ? options.includeExpired
      : !!config.showExpiredAlerts;
    const alerts = [];
    const configuredAreas = areaRecords(api);
    data.features.forEach(function (feature) {
      const properties = feature && feature.properties || {};
      const type = String(properties.type || "").toLowerCase();
      if (selectedTypes.indexOf(type) < 0) return;
      if (options.roadEventsOnly && properties.ClassName !== "RoadEvent") return;
      const status = alertStatus(properties, options);
      if (status === "expired" && !includeExpired) return;
      if (status === "upcoming" && !options.includeScheduled) return;
      if (!includeByArea(options, feature)) return;
      const presentation = typePresentation(type, properties);
      const id = "nzta-" + String(properties.id || properties.ExternalId || properties.uniq || alerts.length);
      const title = cleanText(properties.Name || properties.EventType || "NZTA road condition");
      const sourceFeature = cloneFeature(feature, {
        id: id,
        title: title,
        source: "nzta",
        sourceGroup: "transport",
        sourceLabel: options.sourceLabel,
        status: status,
        event: properties.EventType || "",
        severity: properties.Impact || presentation.label,
        colourCode: presentation.colourCode,
        nztaType: type
      });
      alerts.push({
        id: id,
        title: title,
        html: cardHtml(properties, status, presentation, options),
        status: status,
        source: "nzta",
        sourceGroup: "transport",
        sourceLabel: options.sourceLabel,
        areas: matchedAreaNames(feature, configuredAreas),
        startsAt: isoDate(properties.StartDate),
        endsAt: isoDate(properties.EndDate),
        description: cleanText(properties.EventComments || properties.Content || properties.EventDescription || ""),
        event: properties.EventType || presentation.label,
        urgency: properties.Impact || "",
        severity: properties.IsCritical ? "Severe" : (properties.Impact || presentation.label),
        colourCode: presentation.colourCode,
        link: options.linkUrl,
        recordType: "nzta-" + type,
        nztaType: type,
        location: properties.LocationArea || "",
        features: sourceFeature ? [sourceFeature] : []
      });
    });
    const maximum = Math.max(0, Math.floor(Number(options.maxAlerts) || 0));
    const limited = maximum ? alerts.slice(0, maximum) : alerts;
    if (api && api.setMetadata) {
      api.setMetadata({
        providerStatus: "ready",
        feedUrl: options.feedUrl,
        requestedUrl: url,
        feedFeatureCount: data.features.length,
        selectedEventTypes: selectedTypes,
        providedAlertCount: limited.length,
        feedLastUpdated: data.lastUpdated || null
      });
    }
    return limited;
  }
};

window.RWAS_PLUGINS = window.RWAS_PLUGINS || [];
window.RWAS_PLUGINS.push(nztaPlugin);
})(window, document);
