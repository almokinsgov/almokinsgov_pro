/*
  Extracted from: v23 v32 - addedd in v32 - live for cap feeds.html
  Source lines: 5658-6278
  Note: Keep this as a classic script (no type="module").
  If hosting remotely, you can replace the HTML <script src> with a URL to this file.
*/
;(function (window, document) {
"use strict";

// Region warning and alerts - created by Amorangi Mathews 
 //version and current functionality 
  //1.2.1.7 to 1.3.2.0 single html file to JS,CSS and HTML, hosted in Github served with a CDN  
const version = "1.3.2.0-fned-popup.9";

const RWAS_SCRIPT = document.currentScript ||
  document.querySelector("script[data-rwas],script[src*='rwas-popup.js'],script[src*='RWASJS.js']");

function rwasLowerFirst(value) {
  return value ? value.charAt(0).toLowerCase() + value.slice(1) : value;
}

function rwasParseDataValue(rawValue) {
  const value = String(rawValue || "").trim();
  if (value === "") return "";
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if ((value.charAt(0) === "{" && value.charAt(value.length - 1) === "}") ||
      (value.charAt(0) === "[" && value.charAt(value.length - 1) === "]")) {
    try {
      return JSON.parse(value);
    } catch (err) {
      console.warn("RWAS could not parse data attribute JSON:", err);
    }
  }
  return value;
}

function rwasMergeConfig() {
  const merged = {};
  for (let i = 0; i < arguments.length; i++) {
    const cfg = arguments[i];
    if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) continue;
    Object.keys(cfg).forEach(function (key) {
      if (cfg[key] !== undefined) merged[key] = cfg[key];
    });
  }
  return merged;
}

function rwasParseScriptConfig(script) {
  const cfg = {};
  if (!script || !script.dataset) return cfg;
  const dataset = script.dataset;
  if (dataset.rwasConfig) {
    const parsed = rwasParseDataValue(dataset.rwasConfig);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      Object.assign(cfg, parsed);
    }
  }
  Object.keys(dataset).forEach(function (datasetKey) {
    if (datasetKey === "rwas" || datasetKey === "rwasConfig") return;
    if (datasetKey.indexOf("rwas") !== 0) return;
    const optionKey = rwasLowerFirst(datasetKey.slice(4));
    if (!optionKey) return;
    const parsed = rwasParseDataValue(dataset[datasetKey]);
    if (typeof parsed === "string" && /^(alertSourceOrder|alertSeverityOrder|areaDisplayOrder|linzSelectedAreas|selectedCustomGeoAreas|nztaEventTypes)$/i.test(optionKey)) {
      cfg[optionKey] = parsed.split(",").map(function (entry) { return entry.trim(); }).filter(Boolean);
    } else {
      cfg[optionKey] = parsed;
    }
  });
  return cfg;
}

// Standalone RWAS config, with FNED config accepted as a backward-compatible source.
const RWAS_COMPAT_CFG = (window.FNED_CONFIG && window.FNED_CONFIG.regionWarnings)
  ? window.FNED_CONFIG.regionWarnings
  : {};
const RWAS_WINDOW_CFG = (window.RWAS_CONFIG && typeof window.RWAS_CONFIG === "object")
  ? window.RWAS_CONFIG
  : {};
const RWAS_SCRIPT_CFG = rwasParseScriptConfig(RWAS_SCRIPT);
const RWAS_HTML_CFG = rwasMergeConfig(RWAS_COMPAT_CFG, RWAS_WINDOW_CFG, RWAS_SCRIPT_CFG);
let RWAS_FILE_CFG = {};
let RWAS_RUNTIME_OVERRIDE_CFG = {};
let FNED_RWAS_CFG = {};

function rebuildRwasConfig() {
  const merged = rwasMergeConfig(RWAS_FILE_CFG, RWAS_HTML_CFG, RWAS_RUNTIME_OVERRIDE_CFG);
  Object.keys(FNED_RWAS_CFG).forEach(function (key) {
    delete FNED_RWAS_CFG[key];
  });
  Object.assign(FNED_RWAS_CFG, merged);
  window.RWAS_CONFIG = FNED_RWAS_CFG;
  window.FNED_CONFIG = window.FNED_CONFIG || {};
  window.FNED_CONFIG.regionWarnings = FNED_RWAS_CFG;
  if (window.RWAS) {
    window.RWAS.config = FNED_RWAS_CFG;
  }
  return FNED_RWAS_CFG;
}

rebuildRwasConfig();
const RWAS_GLOBAL_ENDPOINTS = window.FNED_ENDPOINTS || {};
const RWAS_ENDPOINTS = RWAS_GLOBAL_ENDPOINTS.regionWarnings || {};
const RWAS_SHARED_FETCH = window.FNED_FETCH || null;
let RWAS_FETCH_TIMEOUT_MS = Math.max(1000, cfgNum(FNED_RWAS_CFG.fetchTimeoutMs, 15000));
let RWAS_FETCH_RETRIES = Math.max(0, Math.floor(cfgNum(FNED_RWAS_CFG.fetchRetries, 1)));
let RWAS_TIME_LOCALE = cfgStr(FNED_RWAS_CFG.timeLocale, "en-NZ");
let RWAS_TIME_ZONE = cfgStr(FNED_RWAS_CFG.timeZone, "Pacific/Auckland");

function cfgBool(value, fallback) {
  return (typeof value === "boolean") ? value : fallback;
}

function cfgNum(value, fallback) {
  return (typeof value === "number" && !Number.isNaN(value)) ? value : fallback;
}

function cfgStr(value, fallback) {
  return (typeof value === "string" && value.trim()) ? value.trim() : fallback;
}

function cfgObj(value, fallback) {
  return (value && typeof value === "object" && !Array.isArray(value)) ? value : fallback;
}

function cfgStrArray(value, fallback) {
  if (!Array.isArray(value)) return fallback;
  const clean = value
    .map(function (entry) { return (typeof entry === "string") ? entry.trim() : ""; })
    .filter(Boolean);
  return clean.length ? clean : fallback;
}

function cfgOptionalStrArray(value) {
  if (!Array.isArray(value)) return null;
  return value
    .map(function (entry) { return (typeof entry === "string") ? entry.trim() : ""; })
    .filter(Boolean);
}

function cfgMode(value, validModes, fallback) {
  const mode = cfgStr(value, fallback).toLowerCase();
  return validModes.indexOf(mode) >= 0 ? mode : fallback;
}

function cfgBoolFromKeys(cfg, keys, fallback) {
  const source = (cfg && typeof cfg === "object") ? cfg : {};
  for (let i = 0; i < keys.length; i++) {
    if (typeof source[keys[i]] === "boolean") {
      return source[keys[i]];
    }
  }
  return fallback;
}

const RWAS_PLUGIN_RECORDS = [];
const RWAS_PLUGIN_EVENTS = {};
let RWAS_EXTENSIONS_ENABLED = cfgBool(FNED_RWAS_CFG.extensionsEnabled, true);
let RWAS_PLUGIN_CONFIG = cfgObj(FNED_RWAS_CFG.pluginConfig, cfgObj(FNED_RWAS_CFG.plugins, {}));

function getRwasPluginId(plugin) {
  const raw = plugin && (plugin.id || plugin.name);
  return cfgStr(raw, "plugin-" + (RWAS_PLUGIN_RECORDS.length + 1))
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, "-");
}

function getRwasPluginOptions(pluginId) {
  const config = cfgObj(RWAS_PLUGIN_CONFIG, {});
  return cfgObj(config[pluginId], {});
}

function cloneRwasFeature(feature) {
  try {
    return feature ? JSON.parse(JSON.stringify(feature)) : null;
  } catch (err) {
    return feature || null;
  }
}

function includeDismissedRwasAlerts(options) {
  return options === true || !!(options && options.includeDismissed);
}

function getRwasAlertsForPlugins(options) {
  const alerts = includeDismissedRwasAlerts(options)
    ? combinedAlertList
    : combinedAlertList.filter(function (alert) { return !alert.dismissed; });
  return alerts.map(function (alert) {
    const copy = Object.assign({}, alert);
    if (Array.isArray(alert.features)) {
      copy.features = alert.features.map(cloneRwasFeature).filter(Boolean);
    }
    return copy;
  });
}

function getRwasDismissedAlertsForPlugins() {
  return getRwasAlertsForPlugins({ includeDismissed: true }).filter(function (alert) {
    return !!alert.dismissed;
  });
}

function getRwasAlertFeaturesForPlugins(options) {
  const features = [];
  const alerts = includeDismissedRwasAlerts(options)
    ? combinedAlertList
    : combinedAlertList.filter(function (alert) { return !alert.dismissed; });
  alerts.forEach(function (alert) {
    if (!Array.isArray(alert.features)) return;
    alert.features.forEach(function (feature) {
      const clone = cloneRwasFeature(feature);
      if (clone) features.push(clone);
    });
  });
  return {
    type: "FeatureCollection",
    features: features
  };
}

function rwasPluginOn(eventName, handler) {
  if (typeof handler !== "function") return function () {};
  const name = String(eventName || "").trim();
  if (!name) return function () {};
  RWAS_PLUGIN_EVENTS[name] = RWAS_PLUGIN_EVENTS[name] || [];
  RWAS_PLUGIN_EVENTS[name].push(handler);
  return function () {
    const list = RWAS_PLUGIN_EVENTS[name] || [];
    const index = list.indexOf(handler);
    if (index >= 0) list.splice(index, 1);
  };
}

function rwasPluginEmit(eventName, detail) {
  const name = String(eventName || "").trim();
  if (!name) return;
  (RWAS_PLUGIN_EVENTS[name] || []).slice().forEach(function (handler) {
    try {
      handler(detail);
    } catch (err) {
      console.warn("RWAS plugin event handler failed:", name, err);
    }
  });
  if (typeof window.dispatchEvent === "function" && typeof CustomEvent === "function") {
    window.dispatchEvent(new CustomEvent("rwas:plugin-" + name, { detail: detail }));
  }
}

function createRwasPluginSlot(slotName) {
  const name = String(slotName || "").trim();
  if (!name || !document.body) return null;
  const id = "rwas-plugin-slot-" + name.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase();
  let slot = document.getElementById(id);
  if (!slot) {
    slot = document.createElement("div");
    slot.id = id;
    slot.className = "rwas-plugin-slot rwas-external-plugin-slot";
    slot.setAttribute("data-rwas-slot", name);
    document.body.appendChild(slot);
  }
  return slot;
}

function normalizeRwasPluginManifest(plugin, record) {
  const rawManifest = cfgObj(plugin.manifest, {});
  const rawMetadata = cfgObj(plugin.metadata, cfgObj(plugin.agentMetadata, {}));
  const manifest = {
    id: record.id,
    name: cfgStr(plugin.name, cfgStr(rawManifest.name, record.id)),
    version: cfgStr(plugin.version, cfgStr(rawManifest.version, "")),
    description: cfgStr(plugin.description, cfgStr(rawManifest.description, "")),
    category: cfgStr(plugin.category, cfgStr(rawManifest.category, "general")),
    capabilities: Array.isArray(plugin.capabilities)
      ? plugin.capabilities.slice()
      : (Array.isArray(rawManifest.capabilities) ? rawManifest.capabilities.slice() : []),
    metadata: Object.assign({}, rawMetadata)
  };
  if (plugin.agentMetadata && typeof plugin.agentMetadata === "object") {
    manifest.agentMetadata = Object.assign({}, plugin.agentMetadata);
  }
  if (rawManifest.agentMetadata && typeof rawManifest.agentMetadata === "object") {
    manifest.agentMetadata = Object.assign({}, manifest.agentMetadata || {}, rawManifest.agentMetadata);
  }
  return manifest;
}

function getRwasPluginManifest(record) {
  if (!record || !record.manifest) return null;
  try {
    return JSON.parse(JSON.stringify(record.manifest));
  } catch (err) {
    return Object.assign({}, record.manifest);
  }
}

function updateRwasPluginManifest(record, nextMetadata) {
  if (!record || !nextMetadata || typeof nextMetadata !== "object" || Array.isArray(nextMetadata)) {
    return getRwasPluginManifest(record);
  }
  record.manifest = record.manifest || normalizeRwasPluginManifest({}, record);
  if (nextMetadata.metadata && typeof nextMetadata.metadata === "object" && !Array.isArray(nextMetadata.metadata)) {
    record.manifest.metadata = Object.assign({}, record.manifest.metadata || {}, nextMetadata.metadata);
  }
  if (nextMetadata.agentMetadata && typeof nextMetadata.agentMetadata === "object" && !Array.isArray(nextMetadata.agentMetadata)) {
    record.manifest.agentMetadata = Object.assign({}, record.manifest.agentMetadata || {}, nextMetadata.agentMetadata);
  }
  Object.keys(nextMetadata).forEach(function (key) {
    if (key === "metadata" || key === "agentMetadata" || key === "id") return;
    if (nextMetadata[key] !== undefined) record.manifest[key] = nextMetadata[key];
  });
  return getRwasPluginManifest(record);
}

function createRwasPluginPanel(panelName, options) {
  const name = String(panelName || "").trim();
  if (!name || !document.body) return null;
  const panelOptions = cfgObj(options, {});
  const id = "rwas-plugin-panel-" + name.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase();
  let panel = document.getElementById(id);
  if (!panel) {
    panel = document.createElement("section");
    panel.id = id;
    panel.className = "rwas-plugin-panel";
    panel.setAttribute("data-rwas-plugin-panel", name);
    panel.setAttribute("role", cfgStr(panelOptions.role, "dialog"));
    panel.setAttribute("aria-hidden", "true");
    document.body.appendChild(panel);
  }
  if (panelOptions.className) {
    panel.className = "rwas-plugin-panel " + String(panelOptions.className).trim();
  }
  if (panelOptions.title) {
    panel.setAttribute("aria-label", String(panelOptions.title));
  }
  if (panelOptions.html !== undefined) {
    panel.innerHTML = String(panelOptions.html);
  }
  return panel;
}

function setRwasPluginPanelOpen(panel, isOpen) {
  if (!panel) return;
  panel.setAttribute("aria-hidden", isOpen ? "false" : "true");
  panel.toggleAttribute("data-rwas-open", !!isOpen);
}

function notifyFromRwasPlugin(record, payload) {
  const detail = Object.assign({
    pluginId: record.id,
    pluginName: record.name,
    createdAt: new Date().toISOString()
  }, cfgObj(payload, {}));
  rwasPluginEmit("notification", detail);
  if (typeof window.dispatchEvent === "function" && typeof CustomEvent === "function") {
    window.dispatchEvent(new CustomEvent("rwas:notification-requested", { detail: detail }));
  }
  return detail;
}

function renderRwasPluginsIfReady(reason) {
  const panel = document.getElementById(RWAS_POPUP_CONTAINER_ID);
  const button = document.getElementById(RWAS_TOGGLE_BUTTON_ID);
  if (!panel || !button || !panel.querySelector("[data-rwas-slot]")) return;
  const activeAlerts = combinedAlertList.filter(function (alert) { return !alert.dismissed; });
  const dismissedAlerts = combinedAlertList.filter(function (alert) { return !!alert.dismissed; });
  renderRwasPluginSlots({
    panel: panel,
    button: button
  }, {
    state: activeAlerts.length ? "alerts" : (dismissedAlerts.length ? "dismissed" : "empty"),
    reason: reason || "plugin-refresh"
  });
}

function createRwasPluginApi(record) {
  return {
    id: record.id,
    version: version,
    getConfig: function () { return FNED_RWAS_CFG; },
    getRuntime: function () { return window.RWAS_RUNTIME || null; },
    getSummary: function () { return window.RWAS_ALERT_SUMMARY || null; },
    getAlerts: getRwasAlertsForPlugins,
    getAllAlerts: function () { return getRwasAlertsForPlugins({ includeDismissed: true }); },
    getDismissedAlerts: getRwasDismissedAlertsForPlugins,
    getAlertFeatures: getRwasAlertFeaturesForPlugins,
    getAreaFeatures: getRwasAreaFeaturesForPlugins,
    getOptions: function () { return getRwasPluginOptions(record.id); },
    getManifest: function () { return getRwasPluginManifest(record); },
    setManifest: function (metadata) { return updateRwasPluginManifest(record, metadata); },
    setMetadata: function (metadata) { return updateRwasPluginManifest(record, { metadata: metadata }); },
    notify: function (payload) { return notifyFromRwasPlugin(record, payload); },
    on: rwasPluginOn,
    off: function (eventName, handler) {
      const list = RWAS_PLUGIN_EVENTS[String(eventName || "").trim()] || [];
      const index = list.indexOf(handler);
      if (index >= 0) list.splice(index, 1);
    },
    emit: rwasPluginEmit,
    reload: function () { return window.RWAS && window.RWAS.reload ? window.RWAS.reload() : Promise.resolve(); },
    refresh: function () { return refreshRwasPresentation("plugin-refresh"); },
    setConfig: function (nextConfig) {
      return window.RWAS && window.RWAS.setConfig
        ? window.RWAS.setConfig(nextConfig)
        : Promise.resolve();
    },
    open: function () { setRwasPopupOpen(true); },
    close: function () { setRwasPopupOpen(false); },
    createSlot: createRwasPluginSlot,
    createPanel: createRwasPluginPanel,
    setPanelOpen: setRwasPluginPanelOpen
  };
}

function normalizeRwasPlugin(plugin) {
  if (typeof plugin === "function") {
    return {
      id: plugin.name || "",
      init: plugin
    };
  }
  return (plugin && typeof plugin === "object") ? plugin : null;
}

function registerRwasPlugin(pluginInput) {
  const plugin = normalizeRwasPlugin(pluginInput);
  if (!plugin) return null;
  const id = getRwasPluginId(plugin);
  const existing = RWAS_PLUGIN_RECORDS.find(function (record) { return record.id === id; });
  if (existing) {
    renderRwasPluginsIfReady("plugin-existing");
    return existing.api;
  }
  const record = {
    id: id,
    name: cfgStr(plugin.name, id),
    plugin: plugin,
    status: RWAS_EXTENSIONS_ENABLED ? "registered" : "disabled",
    error: null,
    initialized: false,
    manifest: null,
    api: null
  };
  record.manifest = normalizeRwasPluginManifest(plugin, record);
  record.api = createRwasPluginApi(record);
  RWAS_PLUGIN_RECORDS.push(record);
  activateRwasPluginRecord(record);
  renderRwasPluginsIfReady("plugin-registered");
  return record.api;
}

function activateRwasPluginRecord(record) {
  if (!record || !record.plugin || record.status === "active") return;
  if (!RWAS_EXTENSIONS_ENABLED) {
    record.status = "disabled";
    return;
  }
  try {
    if (typeof record.plugin.init === "function" && !record.initialized) {
      record.plugin.init(record.api);
      record.initialized = true;
    }
    record.status = "active";
    record.error = null;
    if (window.RWAS_RUNTIME && typeof record.plugin.onRuntimeUpdated === "function") {
      record.plugin.onRuntimeUpdated(window.RWAS_RUNTIME, record.api);
    }
    if (window.RWAS_ALERT_SUMMARY && typeof record.plugin.onAlertsUpdated === "function") {
      record.plugin.onAlertsUpdated(window.RWAS_ALERT_SUMMARY, record.api);
    }
  } catch (err) {
    record.status = "error";
    record.error = err && err.message ? err.message : String(err);
    console.warn("RWAS plugin failed to activate:", record.id, err);
  }
}

function refreshRwasPluginActivation() {
  RWAS_PLUGIN_RECORDS.forEach(function (record) {
    if (RWAS_EXTENSIONS_ENABLED) {
      activateRwasPluginRecord(record);
    } else if (record.status !== "error") {
      record.status = "disabled";
    }
  });
}

function unregisterRwasPlugin(pluginId) {
  const id = String(pluginId || "").trim();
  const index = RWAS_PLUGIN_RECORDS.findIndex(function (record) { return record.id === id; });
  if (index < 0) return false;
  const record = RWAS_PLUGIN_RECORDS[index];
  try {
    if (record.plugin && typeof record.plugin.destroy === "function") {
      record.plugin.destroy(record.api);
    }
  } catch (err) {
    console.warn("RWAS plugin destroy failed:", id, err);
  }
  RWAS_PLUGIN_RECORDS.splice(index, 1);
  return true;
}

function getRwasPluginStatus() {
  return RWAS_PLUGIN_RECORDS.map(function (record) {
    return {
      id: record.id,
      name: record.name,
      status: record.status,
      error: record.error,
      manifest: getRwasPluginManifest(record)
    };
  });
}

function notifyRwasPlugins(eventName, detail) {
  if (!RWAS_EXTENSIONS_ENABLED) return;
  const lifecycle = {
    "runtime-updated": "onRuntimeUpdated",
    "alerts-updated": "onAlertsUpdated",
    "render": "render"
  };
  const methodName = lifecycle[eventName];
  RWAS_PLUGIN_RECORDS.forEach(function (record) {
    if (record.status !== "active" || !record.plugin) return;
    if (!methodName || typeof record.plugin[methodName] !== "function") return;
    try {
      record.plugin[methodName](detail, record.api);
    } catch (err) {
      record.status = "error";
      record.error = err && err.message ? err.message : String(err);
      console.warn("RWAS plugin hook failed:", record.id, eventName, err);
    }
  });
  rwasPluginEmit(eventName, detail);
}

async function collectRwasPluginAlerts() {
  if (!RWAS_EXTENSIONS_ENABLED) return [];
  const providers = RWAS_PLUGIN_RECORDS.filter(function (record) {
    return record.status === "active" &&
      record.plugin &&
      typeof record.plugin.provideAlerts === "function";
  });
  const providerResults = await Promise.all(providers.map(async function (record) {
    try {
      const alerts = await record.plugin.provideAlerts(record.api);
      return {
        record: record,
        alerts: Array.isArray(alerts) ? alerts : [],
        error: null
      };
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      updateRwasPluginManifest(record, {
        metadata: {
          providerStatus: "error",
          providerError: message
        }
      });
      console.warn("RWAS alert provider failed:", record.id, error);
      return { record: record, alerts: [], error: message };
    }
  }));
  const collected = [];
  providerResults.forEach(function (result) {
    result.alerts.forEach(function (alert) {
      if (!alert || typeof alert !== "object" || Array.isArray(alert) || !alert.html) return;
      collected.push(alert);
    });
    if (!result.error) {
      updateRwasPluginManifest(result.record, {
        metadata: {
          providerStatus: "ready",
          providerError: "",
          providedAlertCount: result.alerts.length
        }
      });
    }
  });
  combinedAlertList.push.apply(combinedAlertList, collected);
  rwasPluginEmit("provider-alerts-collected", {
    count: collected.length,
    alerts: collected.map(function (alert) {
      return {
        id: alert.id || "",
        source: alert.source || "",
        title: alert.title || ""
      };
    })
  });
  return collected;
}

function processRwasPluginAlerts() {
  if (!RWAS_EXTENSIONS_ENABLED) return combinedAlertList;
  RWAS_PLUGIN_RECORDS.forEach(function (record) {
    if (record.status !== "active" || !record.plugin || typeof record.plugin.processAlerts !== "function") return;
    try {
      const processed = record.plugin.processAlerts(combinedAlertList, record.api);
      if (Array.isArray(processed) && processed !== combinedAlertList) {
        combinedAlertList = processed;
      }
    } catch (error) {
      record.status = "error";
      record.error = error && error.message ? error.message : String(error);
      console.warn("RWAS alert processor failed:", record.id, error);
    }
  });
  return combinedAlertList;
}

function initializeQueuedRwasPlugins() {
  const queued = Array.isArray(window.RWAS_PLUGINS) ? window.RWAS_PLUGINS.slice() : [];
  window.RWAS_PLUGINS = queued;
  queued.forEach(registerRwasPlugin);
  if (!window.RWAS_PLUGINS.__rwasQueueHooked) {
    const nativePush = window.RWAS_PLUGINS.push;
    window.RWAS_PLUGINS.push = function () {
      const result = nativePush.apply(window.RWAS_PLUGINS, arguments);
      Array.prototype.forEach.call(arguments, registerRwasPlugin);
      return result;
    };
    Object.defineProperty(window.RWAS_PLUGINS, "__rwasQueueHooked", {
      value: true,
      configurable: true
    });
  }
}

function getRwasConfigFileUrl() {
  return cfgStr(
    RWAS_HTML_CFG.configUrl,
    cfgStr(RWAS_HTML_CFG.configFile, cfgStr(RWAS_HTML_CFG.configPath, ""))
  );
}

function extractRwasConfigFileObject(data) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};
  if (data.regionWarnings && typeof data.regionWarnings === "object" && !Array.isArray(data.regionWarnings)) {
    return data.regionWarnings;
  }
  if (data.rwas && typeof data.rwas === "object" && !Array.isArray(data.rwas)) {
    return data.rwas;
  }
  return data;
}

let rwasConfigFilePromise = null;

function loadRwasConfigFile() {
  const url = getRwasConfigFileUrl();
  if (!url) {
    rebuildRwasConfig();
    return Promise.resolve(FNED_RWAS_CFG);
  }
  if (rwasConfigFilePromise) return rwasConfigFilePromise;

  rwasConfigFilePromise = fetch(url, { cache: "no-store" })
    .then(function (response) {
      if (!response.ok) {
        throw new Error("HTTP " + response.status + " " + response.statusText);
      }
      return response.json();
    })
    .then(function (data) {
      RWAS_FILE_CFG = extractRwasConfigFileObject(data);
      rebuildRwasConfig();
      return FNED_RWAS_CFG;
    })
    .catch(function (error) {
      RWAS_FILE_CFG = {};
      rebuildRwasConfig();
      console.warn("RWAS config file could not be loaded:", url, error);
      return FNED_RWAS_CFG;
    });

  return rwasConfigFilePromise;
}

let RWAS_POPUP_CONTAINER_ID = cfgStr(
  FNED_RWAS_CFG.containerId,
  cfgStr(FNED_RWAS_CFG.popupContainerId, "floating-alerts-container")
);
let RWAS_TOGGLE_BUTTON_ID = cfgStr(
  FNED_RWAS_CFG.buttonId,
  cfgStr(FNED_RWAS_CFG.toggleButtonId, "toggle-alerts-btn")
);
let RWAS_POSITION = cfgStr(FNED_RWAS_CFG.position, "bottom-right");
let RWAS_BUTTON_LABEL = cfgStr(FNED_RWAS_CFG.buttonLabel, "!");
let RWAS_AUTO_ALERT_BUTTON_ICON = cfgBool(FNED_RWAS_CFG.autoAlertButtonIcon, true);
let RWAS_WEATHER_BUTTON_LABEL = cfgStr(FNED_RWAS_CFG.weatherButtonLabel, "\ud83c\udf27\ufe0f");
let RWAS_WARNING_BUTTON_LABEL = cfgStr(FNED_RWAS_CFG.warningButtonLabel, "\u26a0\ufe0f");
let RWAS_BUTTON_TITLE = cfgStr(FNED_RWAS_CFG.buttonTitle, "Region warnings and alerts");
let RWAS_PANEL_TITLE = cfgStr(FNED_RWAS_CFG.panelTitle, "Local Warnings and Alerts");
let RWAS_EMPTY_MESSAGE = cfgStr(
  FNED_RWAS_CFG.emptyMessage,
  "No current region-wide warnings detected for the configured alert area."
);
let RWAS_HIDE_WHEN_EMPTY = cfgBool(FNED_RWAS_CFG.hideWhenEmpty, true);
let RWAS_SHOW_EMPTY_STATE = cfgBool(FNED_RWAS_CFG.showEmptyState, true);
let RWAS_AUTO_OPEN = cfgBool(FNED_RWAS_CFG.autoOpen, false);
let RWAS_OPEN_ON_ALERT = cfgBool(FNED_RWAS_CFG.openOnAlert, false);
let RWAS_INJECT_STYLES = cfgBool(FNED_RWAS_CFG.injectStyles, true);
let RWAS_AUTO_LOAD_TURF = cfgBool(FNED_RWAS_CFG.autoLoadTurf, true);
let RWAS_USE_TURF_FALLBACK = cfgBool(FNED_RWAS_CFG.useTurfFallback, true);
let RWAS_TURF_URL = cfgStr(FNED_RWAS_CFG.turfUrl, "https://unpkg.com/@turf/turf@6/turf.min.js");
let RWAS_AUTO_LOAD_PROJ4 = cfgBool(FNED_RWAS_CFG.autoLoadProj4, true);
let RWAS_PROJ4_URL = cfgStr(FNED_RWAS_CFG.proj4Url, "https://unpkg.com/proj4@2.12.1/dist/proj4.js");
let RWAS_AREA_LIST_LIMIT = Math.max(1, Math.floor(cfgNum(FNED_RWAS_CFG.areaListLimit, 5)));
RWAS_EXTENSIONS_ENABLED = cfgBool(FNED_RWAS_CFG.extensionsEnabled, true);
RWAS_PLUGIN_CONFIG = cfgObj(FNED_RWAS_CFG.pluginConfig, cfgObj(FNED_RWAS_CFG.plugins, {}));
let rwasPopupOpen = RWAS_AUTO_OPEN;
let rwasPopupUserTouched = false;
let rwasPopupRenderedOnce = false;
let rwasTurfPromise = null;
let rwasProj4Promise = null;

function rwasPositionClass() {
  const position = RWAS_POSITION.toLowerCase().replace(/[^a-z-]/g, "");
  if (position === "bottom-left" || position === "top-left" || position === "top-right") {
    return "rwas-pos-" + position;
  }
  return "rwas-pos-bottom-right";
}

function injectRwasStyles() {
  if (!RWAS_INJECT_STYLES || document.getElementById("rwas-popup-embed-styles")) return;
  const style = document.createElement("style");
  style.id = "rwas-popup-embed-styles";
  style.textContent = `
.rwas-popup-panel,
.rwas-alert-button {
  box-sizing: border-box;
  font-family: Arial, Helvetica, sans-serif;
}
.rwas-popup-panel {
  position: fixed;
  width: min(440px, calc(100vw - 32px));
  max-height: min(74vh, 720px);
  overflow: auto;
  z-index: 2147483000;
  display: none;
  background: #ffffff;
  color: #182230;
  border: 1px solid #b8c0cc;
  border-radius: 8px;
  box-shadow: 0 18px 44px rgba(15, 23, 42, 0.24);
  font-size: 14px;
  line-height: 1.45;
}
.rwas-popup-panel.rwas-open {
  display: block;
}
.rwas-popup-panel.rwas-pos-bottom-right {
  right: 16px;
  bottom: 84px;
}
.rwas-popup-panel.rwas-pos-bottom-left {
  left: 16px;
  bottom: 84px;
}
.rwas-popup-panel.rwas-pos-top-right {
  right: 16px;
  top: 84px;
}
.rwas-popup-panel.rwas-pos-top-left {
  left: 16px;
  top: 84px;
}
.rwas-alert-button {
  position: fixed;
  z-index: 2147483001;
  width: 48px;
  height: 48px;
  display: none;
  align-items: center;
  justify-content: center;
  border-style: solid;
  border-width: medium;
  border-color: #750000;
  border-radius: 50%;
  background: linear-gradient(to right, #ed0017, #ed0017);
  color: #000000;
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.3);
  cursor: pointer;
  font-size: 24px;
  font-weight: 600;
  line-height: 1;
}
.rwas-alert-button.rwas-visible {
  display: flex;
}
.rwas-alert-button:hover,
.rwas-alert-button:focus-visible {
  background: linear-gradient(to right, #ffeb00, #ed0017);
  border-color: #750000;
  color: #000000;
  outline: 3px solid rgba(255, 235, 0, 0.35);
  outline-offset: 2px;
}
.rwas-alert-button.rwas-pos-bottom-right {
  right: 18px;
  bottom: 18px;
}
.rwas-alert-button.rwas-pos-bottom-left {
  left: 18px;
  bottom: 18px;
}
.rwas-alert-button.rwas-pos-top-right {
  right: 18px;
  top: 18px;
}
.rwas-alert-button.rwas-pos-top-left {
  left: 18px;
  top: 18px;
}
.rwas-alert-button[data-rwas-count]:after {
  content: attr(data-rwas-count);
  position: absolute;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  top: -6px;
  right: -6px;
  border: 2px solid #ffffff;
  border-radius: 999px;
  background: #1f2937;
  color: #ffffff;
  font-size: 11px;
  line-height: 16px;
}
.rwas-popup-header {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  justify-content: space-between;
  padding: 0.75rem 1rem;
  background: linear-gradient(to right, #dc3545, #dc3545);
  color: #ffffff;
  border-style: solid;
  border-width: medium;
  border-color: #750000;
  border-radius: 8px 8px 0 0;
  line-height: 1.4;
  box-shadow: 0 2px 4px rgba(0,0,0,0.05);
}
.rwas-popup-title {
  margin: 0;
  font-size: 16px;
  font-weight: 800;
  letter-spacing: 0;
}
.rwas-popup-meta {
  margin-top: 4px;
  font-size: 12px;
  opacity: 0.94;
}
.rwas-close-btn {
  flex: 0 0 auto;
  width: 30px;
  height: 30px;
  border: 1px solid rgba(255,255,255,0.55);
  border-radius: 6px;
  background: rgba(255,255,255,0.12);
  color: #ffffff;
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
}
.rwas-close-btn:hover,
.rwas-close-btn:focus-visible {
  background: rgba(255,255,255,0.24);
  outline: 2px solid rgba(255,255,255,0.45);
  outline-offset: 2px;
}
.rwas-popup-body {
  padding: 1rem;
}
.rwas-plugin-slot {
  margin: 0 0 1rem;
}
.rwas-plugin-slot:empty {
  display: none;
}
.rwas-popup-footer .rwas-plugin-slot {
  margin: 0.5rem 0 0;
}
.rwas-plugin-panel {
  position: fixed;
  z-index: 100000;
  right: 1rem;
  bottom: 5.25rem;
  width: min(420px, calc(100vw - 2rem));
  max-height: min(640px, calc(100vh - 7rem));
  overflow: auto;
  border: 1px solid rgba(20, 24, 34, 0.18);
  border-radius: 8px;
  background: #ffffff;
  color: #172033;
  box-shadow: 0 18px 42px rgba(0,0,0,0.22);
  padding: 1rem;
}
.rwas-plugin-panel[aria-hidden="true"] {
  display: none;
}
.rwas-popup-panel .alert-card {
  background: #fff0f0;
  border-left: 5px solid #ffa500;
  margin: 0 0 1rem;
  padding: 1rem;
  border-radius: 6px;
}
.rwas-popup-panel .alert-card:last-child {
  margin-bottom: 0;
}
.rwas-popup-panel .far-north {
  border-left-color: #dc3545;
}
.rwas-popup-panel .alert-default {
  border-left-color: #ffa500;
  background: #fffaf0;
}
.rwas-popup-panel .alert-orange {
  border-left-color: #FF8918;
  background: #fff3e0;
}
.rwas-popup-panel .alert-red {
  border-left-color: #d32f2f;
  background: #fdecea;
}
.rwas-popup-panel .alert-yellow {
  border-left-color: #fbc02d;
  background: #fffde7;
}
.rwas-popup-panel .alert-green {
  border-left-color: #388e3c;
  background: #e8f5e9;
}
.rwas-popup-panel .badge {
  display: inline-block;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.8em;
  margin-top: 4px;
  font-weight: 600;
  color: #ffffff;
}
.rwas-popup-panel .badge.alert-met {
  background: #172344;
}
.rwas-popup-panel .badge.alert-cd {
  color: #ffffff;
  background: #123c59;
  border: solid;
  border-width: thin;
  border-color: #fffc38;
}
.rwas-popup-panel .badge.alert-orange {
  background: #FF8918;
  border: solid;
  border-width: thin;
  border-color: #000000;
}
.rwas-popup-panel .badge.alert-red,
.rwas-popup-panel .active-badge,
.rwas-popup-panel .upcoming-badge {
  background: #e53935;
  color: #ffffff;
}
.rwas-popup-panel .badge.alert-red {
  background: #d32f2f;
  border: solid;
  border-width: thin;
  border-color: #000000;
}
.rwas-popup-panel .badge.alert-yellow {
  background: #fbc02d;
  color: #000000;
  border: solid;
  border-width: thin;
  border-color: #000000;
}
.rwas-popup-panel .badge.alert-green {
  background: #388e3c;
}
.rwas-popup-panel .expired-badge {
  background: #464951;
  color: #ffffff;
  border: solid;
  border-width: thin;
  border-color: #000000;
}
.rwas-popup-panel .cancelled-badge {
  background: #616161;
  color: #ffffff;
  border: solid;
  border-width: thin;
  border-color: #000000;
}
.rwas-popup-footer,
.rwas-empty-state {
  border-top: 1px solid #e5e7eb;
  padding: 0.75rem 1rem;
  background: #f4f6f8;
  color: #555555;
  font-size: 12px;
  text-align: left;
}
.rwas-popup-footer a,
.rwas-popup-panel .alert-card a {
  color: #dc3545;
  font-weight: 500;
  text-decoration: none;
}
.rwas-popup-footer a:hover,
.rwas-popup-panel .alert-card a:hover {
  text-decoration: underline;
}
@media (max-width: 600px) {
  .rwas-popup-panel {
    width: calc(100vw - 20px);
    max-height: 68vh;
  }
  .rwas-popup-panel.rwas-pos-bottom-right,
  .rwas-popup-panel.rwas-pos-bottom-left {
    left: 10px;
    right: 10px;
    bottom: 78px;
  }
  .rwas-popup-panel.rwas-pos-top-right,
  .rwas-popup-panel.rwas-pos-top-left {
    left: 10px;
    right: 10px;
    top: 78px;
  }
}`;
  document.head.appendChild(style);
}

function ensureRwasPopupShell() {
  if (!document.body) return null;
  injectRwasStyles();
  const positionClass = rwasPositionClass();
  let panel = document.getElementById(RWAS_POPUP_CONTAINER_ID);
  if (!panel) {
    panel = document.createElement("section");
    panel.id = RWAS_POPUP_CONTAINER_ID;
    document.body.appendChild(panel);
  }
  panel.classList.add("rwas-popup-panel", positionClass);
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-live", "polite");
  panel.setAttribute("aria-label", RWAS_PANEL_TITLE);

  let button = document.getElementById(RWAS_TOGGLE_BUTTON_ID);
  if (!button) {
    button = document.createElement("button");
    button.id = RWAS_TOGGLE_BUTTON_ID;
    button.type = "button";
    document.body.appendChild(button);
  }
  button.classList.add("rwas-alert-button", positionClass);
  button.type = "button";
  if (!RWAS_AUTO_ALERT_BUTTON_ICON || !button.textContent) {
    button.textContent = RWAS_BUTTON_LABEL;
  }
  button.title = RWAS_BUTTON_TITLE;
  button.setAttribute("aria-label", RWAS_BUTTON_TITLE);
  button.setAttribute("aria-controls", RWAS_POPUP_CONTAINER_ID);
  button.onclick = function () {
    rwasPopupUserTouched = true;
    setRwasPopupOpen(!rwasPopupOpen);
  };
  setRwasPopupOpen(rwasPopupOpen, true);
  return { panel: panel, button: button };
}

function bindRwasCloseButton(panel) {
  const closeBtn = panel ? panel.querySelector("[data-rwas-close]") : null;
  if (!closeBtn) return;
  closeBtn.onclick = function () {
    rwasPopupUserTouched = true;
    setRwasPopupOpen(false);
  };
}

function setRwasPopupOpen(open, skipShell) {
  rwasPopupOpen = !!open;
  const shell = skipShell ? null : ensureRwasPopupShell();
  const panel = shell ? shell.panel : document.getElementById(RWAS_POPUP_CONTAINER_ID);
  const button = shell ? shell.button : document.getElementById(RWAS_TOGGLE_BUTTON_ID);
  if (panel) {
    panel.classList.toggle("rwas-open", rwasPopupOpen);
    panel.style.display = rwasPopupOpen ? "block" : "none";
  }
  if (button) {
    button.setAttribute("aria-expanded", rwasPopupOpen ? "true" : "false");
  }
}

function setRwasButtonVisible(button, visible, count) {
  if (!button) return;
  button.classList.toggle("rwas-visible", !!visible);
  button.style.display = visible ? "flex" : "none";
  if (count > 0) {
    button.setAttribute("data-rwas-count", String(count));
  } else {
    button.removeAttribute("data-rwas-count");
  }
}

function setRwasButtonLabel(button, alertSources) {
  if (!button) return;
  const sources = alertSources || {};
  button.textContent = RWAS_AUTO_ALERT_BUTTON_ICON
    ? ((sources.hasCivilDefence || sources.hasEmergencyMobileAlert || sources.hasNzta) ? RWAS_WARNING_BUTTON_LABEL : RWAS_WEATHER_BUTTON_LABEL)
    : RWAS_BUTTON_LABEL;
}

function createRwasTurfFallback() {
  function walkCoords(coords, points) {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === "number" && typeof coords[1] === "number") {
      points.push(coords);
      return;
    }
    coords.forEach(function (entry) { walkCoords(entry, points); });
  }
  function bboxOf(input) {
    const points = [];
    if (!input) return null;
    if (input.type === "FeatureCollection" && Array.isArray(input.features)) {
      input.features.forEach(function (feature) { walkCoords(feature.geometry && feature.geometry.coordinates, points); });
    } else if (input.type === "Feature") {
      walkCoords(input.geometry && input.geometry.coordinates, points);
    } else if (input.type && input.coordinates) {
      walkCoords(input.coordinates, points);
    }
    if (!points.length) return null;
    return points.reduce(function (box, point) {
      return [
        Math.min(box[0], point[0]),
        Math.min(box[1], point[1]),
        Math.max(box[2], point[0]),
        Math.max(box[3], point[1])
      ];
    }, [points[0][0], points[0][1], points[0][0], points[0][1]]);
  }
  function boxesOverlap(a, b) {
    return !!a && !!b && a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
  }
  return {
    polygon: function (coordinates) {
      return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: coordinates } };
    },
    booleanIntersects: function (left, right) {
      return boxesOverlap(bboxOf(left), bboxOf(right));
    },
    _rwasFallback: true
  };
}

function ensureRwasTurf() {
  if (window.turf && typeof window.turf.booleanIntersects === "function") {
    return Promise.resolve(window.turf);
  }
  if (rwasTurfPromise) return rwasTurfPromise;
  rwasTurfPromise = new Promise(function (resolve, reject) {
    function useFallback(error) {
      if (!RWAS_USE_TURF_FALLBACK) {
        reject(error || new Error("Turf is required for RWAS geospatial filtering."));
        return;
      }
      console.warn("RWAS is using its simple Turf fallback. Load @turf/turf for exact polygon intersections.", error || "");
      window.turf = createRwasTurfFallback();
      resolve(window.turf);
    }

    if (!RWAS_AUTO_LOAD_TURF) {
      useFallback(new Error("RWAS autoLoadTurf is disabled."));
      return;
    }

    if (!document.head) {
      useFallback(new Error("Document head is not available for loading Turf."));
      return;
    }

    const existing = document.querySelector("script[data-rwas-turf-loader]");
    if (existing) {
      existing.addEventListener("load", function () { resolve(window.turf); }, { once: true });
      existing.addEventListener("error", useFallback, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = RWAS_TURF_URL;
    script.async = true;
    script.setAttribute("data-rwas-turf-loader", "1");
    script.onload = function () {
      if (window.turf && typeof window.turf.booleanIntersects === "function") {
        resolve(window.turf);
      } else {
        useFallback(new Error("Turf loaded without booleanIntersects."));
      }
    };
    script.onerror = useFallback;
    document.head.appendChild(script);
  });
  return rwasTurfPromise;
}

function ensureRwasProj4() {
  if (window.proj4 && typeof window.proj4 === "function") {
    return Promise.resolve(window.proj4);
  }
  if (rwasProj4Promise) return rwasProj4Promise;
  rwasProj4Promise = new Promise(function (resolve, reject) {
    if (!RWAS_AUTO_LOAD_PROJ4) {
      reject(new Error("Proj4 is required to convert EPSG:2193 area files and autoLoadProj4 is disabled."));
      return;
    }
    if (!document.head) {
      reject(new Error("Document head is not available for loading Proj4."));
      return;
    }
    const existing = document.querySelector("script[data-rwas-proj4-loader]");
    if (existing) {
      existing.addEventListener("load", function () {
        if (window.proj4) resolve(window.proj4);
        else reject(new Error("Proj4 loaded without a global API."));
      }, { once: true });
      existing.addEventListener("error", function () {
        reject(new Error("Proj4 failed to load."));
      }, { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = RWAS_PROJ4_URL;
    script.async = true;
    script.setAttribute("data-rwas-proj4-loader", "1");
    script.onload = function () {
      if (window.proj4 && typeof window.proj4 === "function") {
        resolve(window.proj4);
      } else {
        reject(new Error("Proj4 loaded without a global API."));
      }
    };
    script.onerror = function () {
      reject(new Error("Proj4 failed to load."));
    };
    document.head.appendChild(script);
  });
  return rwasProj4Promise;
}

const RWAS_FEED_STATUS_API = window.FNED_FEED_STATUS_API || null;
const RWAS_TEXT_REQUEST_CACHE = new Map();
const RWAS_JSON_REQUEST_CACHE = new Map();

function rwasFeedStatusStart(feedKey, url) {
  if (RWAS_FEED_STATUS_API && typeof RWAS_FEED_STATUS_API.start === "function") {
    RWAS_FEED_STATUS_API.start(feedKey, url);
  }
}

function rwasFeedStatusOk(feedKey, httpStatus) {
  if (RWAS_FEED_STATUS_API && typeof RWAS_FEED_STATUS_API.ok === "function") {
    RWAS_FEED_STATUS_API.ok(feedKey, { httpStatus: httpStatus || null });
  }
}

function rwasFeedStatusFail(feedKey, error) {
  if (RWAS_FEED_STATUS_API && typeof RWAS_FEED_STATUS_API.fail === "function") {
    RWAS_FEED_STATUS_API.fail(feedKey, error, { httpStatus: error && error.httpStatus ? error.httpStatus : null });
  }
}

async function rwasFetchWithRetry(url, responseType) {
  let lastError = null;
  const attempts = RWAS_FETCH_RETRIES + 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeoutId = controller
      ? window.setTimeout(function () { controller.abort(); }, RWAS_FETCH_TIMEOUT_MS)
      : null;
    try {
      const response = await fetch(url, controller ? { signal: controller.signal } : undefined);
      if (timeoutId) window.clearTimeout(timeoutId);
      if (!response.ok) {
        const httpError = new Error("HTTP " + response.status + " " + response.statusText);
        httpError.httpStatus = response.status;
        throw httpError;
      }
      return responseType === "json" ? response.json() : response.text();
    } catch (error) {
      if (timeoutId) window.clearTimeout(timeoutId);
      lastError = error;
      if (attempt >= attempts - 1) break;
      await new Promise(function (resolve) {
        window.setTimeout(resolve, Math.min(1000 * (attempt + 1), 3000));
      });
    }
  }
  throw lastError || new Error("RWAS fetch failed");
}

async function rwasFetchTextTracked(feedKey, url) {
  const cacheKey = String(url || "");
  if (cacheKey && RWAS_TEXT_REQUEST_CACHE.has(cacheKey)) {
    return RWAS_TEXT_REQUEST_CACHE.get(cacheKey);
  }

  const requestPromise = (async function () {
  if (RWAS_SHARED_FETCH && typeof RWAS_SHARED_FETCH.fetchText === "function") {
    return RWAS_SHARED_FETCH.fetchText(url, {
      feedKey: feedKey,
      feedStatusApi: RWAS_FEED_STATUS_API,
      timeoutMs: RWAS_FETCH_TIMEOUT_MS,
      retries: RWAS_FETCH_RETRIES
    });
  }

  rwasFeedStatusStart(feedKey, url);
  try {
    const text = await rwasFetchWithRetry(url, "text");
    rwasFeedStatusOk(feedKey, null);
    return text;
  } catch (error) {
    rwasFeedStatusFail(feedKey, error);
    throw error;
  }
  })();

  if (cacheKey) {
    RWAS_TEXT_REQUEST_CACHE.set(cacheKey, requestPromise);
    requestPromise.finally(function () {
      RWAS_TEXT_REQUEST_CACHE.delete(cacheKey);
    }).catch(function () {});
  }

  return requestPromise;
}

async function rwasFetchJsonTracked(feedKey, url) {
  const cacheKey = String(url || "");
  if (cacheKey && RWAS_JSON_REQUEST_CACHE.has(cacheKey)) {
    return RWAS_JSON_REQUEST_CACHE.get(cacheKey);
  }

  const requestPromise = (async function () {
  if (RWAS_SHARED_FETCH && typeof RWAS_SHARED_FETCH.fetchJson === "function") {
    return RWAS_SHARED_FETCH.fetchJson(url, {
      feedKey: feedKey,
      feedStatusApi: RWAS_FEED_STATUS_API,
      timeoutMs: RWAS_FETCH_TIMEOUT_MS,
      retries: RWAS_FETCH_RETRIES
    });
  }

  rwasFeedStatusStart(feedKey, url);
  try {
    const data = await rwasFetchWithRetry(url, "json");
    rwasFeedStatusOk(feedKey, null);
    return data;
  } catch (error) {
    rwasFeedStatusFail(feedKey, error);
    throw error;
  }
  })();

  if (cacheKey) {
    RWAS_JSON_REQUEST_CACHE.set(cacheKey, requestPromise);
    requestPromise.finally(function () {
      RWAS_JSON_REQUEST_CACHE.delete(cacheKey);
    }).catch(function () {});
  }

  return requestPromise;
}

  let lastUpdatedTime = new Date();
  const functions = "Alert display, Container, Popup, onset window, non far north display, isstillactivecolour classes, simpilfy, cachefix, expiry tag, sorted, expiry hide, CD alerts added, sorting, badges, formatted alrert for cd, custom geo area with proxy and url support,  newgeojsonurl, temp urls for cd and met, area name extraction and apply to alert html,disable far north alerts, custom new geo json url. area definitions , html edit (msgType removed), multi area in alert html with and for multi location, custom sorted custom area,popup header and footer, restyled header and footer, restyle badges, hide cancelled cd alerts, changed icon to thunderstorm, auto change to warning econ when cd alert is present,button stlyling change, border to popup ";
  //Planned 
  const plannedadds = "cors config, js files and package for other systems, geonet cap feed adition, unplanned out power outages with custom alert and config, div mode, expired alert window with config, unplanned outages from top energy,road closures from nzta,button location,refresh button, duration in hours or days in alert html x hours from x to x";
  //alerts config
  let SHOW_EXPIRED_ALERTS = cfgBool(FNED_RWAS_CFG.showExpiredAlerts, true); // Change to true to show expired alerts
  let SHOW_NON_FAR_NORTH_ALERTS = cfgBool(FNED_RWAS_CFG.showNonFarNorthAlerts, false); //show all alerts in the feed
  let REQUIRE_ONSET_WITHIN_WINDOW = cfgBool(FNED_RWAS_CFG.requireOnsetWithinWindow, true); //filter results based on how long to start time
  let HOUR_WINDOW = cfgNum(FNED_RWAS_CFG.hourWindow, 24); //Amount of hours between the alert start time and date and the current time and date
  let ENABLE_MET_SERVICE_ALERTS = cfgBool(FNED_RWAS_CFG.enableMetServiceAlerts, cfgBool(FNED_RWAS_CFG.enableWeatherAlerts, true));
  let MET_SERVICE_DETAIL_MODE = cfgMode(FNED_RWAS_CFG.metServiceDetailMode, ["auto", "atom", "cap"], "auto");
  const DEFAULT_PROXY_PREFIX_RWAS = "";

  function normalizeProxyPrefixRwas(rawPrefix) {
    let prefix = cfgStr(rawPrefix, DEFAULT_PROXY_PREFIX_RWAS);
    if (!prefix) prefix = DEFAULT_PROXY_PREFIX_RWAS;
    if (/url=/i.test(prefix)) {
      return prefix;
    }
    const endChar = prefix.charAt(prefix.length - 1);
    if (endChar === "?" || endChar === "&" || endChar === "=") {
      return prefix;
    }
    return prefix.indexOf("?") >= 0 ? (prefix + "&url=") : (prefix + "?url=");
  }

  function normalizeProxyTargetRwas(rawUrl) {
    const value = cfgStr(rawUrl, "");
    if (!value) return "";
    if (/^https?%3A%2F%2F/i.test(value)) {
      try {
        return decodeURIComponent(value);
      } catch (err) {
        return value;
      }
    }
    return value;
  }

  function buildProxyRequestUrlWithMode(rawUrl, useProxyForRequest) {
    const value = normalizeProxyTargetRwas(rawUrl);
    if (!value) return "";
    if (!/^https?:\/\//i.test(value)) return value;
    if (!useProxyForRequest || !proxy) return value;
    if (proxy && value.indexOf(proxy) === 0) {
      return value;
    }
    return proxy + encodeURIComponent(value);
  }

  function buildProxyRequestUrl(rawUrl) {
    return buildProxyRequestUrlWithMode(rawUrl, USE_PROXY_FOR_ALERT_FEEDS);
  }

  function getRwasFeedProxyFlag(feed, fallback) {
    return cfgBoolFromKeys(feed, ["useProxy", "proxyEnabled", "useProxyForFeed"], fallback);
  }

  function resolveRwasFeedUrl(primaryUrl, endpointUrl, fallbackUrl, useProxyForRequest) {
    const rawUrl = cfgStr(primaryUrl, cfgStr(endpointUrl, fallbackUrl));
    return buildProxyRequestUrlWithMode(rawUrl, useProxyForRequest);
  }

  let USE_PROXY_FOR_ALERT_FEEDS = cfgBool(
    FNED_RWAS_CFG.useProxy,
    cfgBool(FNED_RWAS_CFG.proxyEnabled, false)
  );
  let proxy = normalizeProxyPrefixRwas(cfgStr(FNED_RWAS_CFG.proxy, cfgStr(RWAS_ENDPOINTS.proxyPrefix, DEFAULT_PROXY_PREFIX_RWAS))); //cors proxy url
  //Met service feed url with proxy add in, this should be a github url, we dont want to overload metservices infrastructure in an emergency
  let metServiceSourceUrl = cfgStr(FNED_RWAS_CFG.metServiceSourceUrl, cfgStr(RWAS_ENDPOINTS.metServiceSourceUrl, "https://raw.githubusercontent.com/almokinsgov/NZSHAPE/refs/heads/main/alerts/latest.xml"));
  let MET_SERVICE_USE_PROXY = cfgBoolFromKeys(FNED_RWAS_CFG, ["metServiceUseProxy", "useProxyForMetService", "metServiceProxyEnabled"], USE_PROXY_FOR_ALERT_FEEDS);
  let METSERVICE_ATOM_URL_OVERRIDE = cfgStr(FNED_RWAS_CFG.metServiceAtomUrl, "");
let feedURL = resolveRwasFeedUrl(METSERVICE_ATOM_URL_OVERRIDE, RWAS_ENDPOINTS.metServiceAtom, metServiceSourceUrl, MET_SERVICE_USE_PROXY);
  //Civil defence live feed tester and visialsier - https://codepen.io/Amorangi-Mathews/full/QwjGPyv
  //Met service feed visualiser and tester https://codepen.io/Amorangi-Mathews/full/WbQGRvr
// Civil defence alerts 
let ENABLE_CD_ALERTS = cfgBool(FNED_RWAS_CFG.enableCivilDefenceAlerts, true); // Set to false to disable Civil Defence alerts
let CD_ALERT_FEED_URL = cfgStr(FNED_RWAS_CFG.civilDefenceAtomUrl, cfgStr(RWAS_ENDPOINTS.civilDefenceSourceUrl, "https://www.civildefence.govt.nz/home/rss")); //civil defence alert feed (atom)
  let CIVIL_DEFENCE_USE_PROXY = cfgBoolFromKeys(FNED_RWAS_CFG, ["civilDefenceUseProxy", "useProxyForCivilDefence", "civilDefenceProxyEnabled"], USE_PROXY_FOR_ALERT_FEEDS);
  let CIVIL_DEFENCE_ATOM_URL_OVERRIDE = cfgStr(FNED_RWAS_CFG.civilDefenceAtomFeedUrl, "");
let CD_ALERT_ATOM_URL = resolveRwasFeedUrl(CIVIL_DEFENCE_ATOM_URL_OVERRIDE, RWAS_ENDPOINTS.civilDefenceAtom, CD_ALERT_FEED_URL, CIVIL_DEFENCE_USE_PROXY);
  let SHOW_CANCELLED_CD_ALERTS = cfgBool(FNED_RWAS_CFG.showCancelledCivilDefenceAlerts, false); // Change to true to display CD alerts with msgType "Cancel"
let ENABLE_EMERGENCY_MOBILE_ALERTS = cfgBool(FNED_RWAS_CFG.enableEmergencyMobileAlerts, true);
let EMERGENCY_MOBILE_ALERT_FEED_URL = cfgStr(FNED_RWAS_CFG.emergencyMobileAlertAtomUrl, cfgStr(RWAS_ENDPOINTS.emergencyMobileAlertSourceUrl, "https://alerthub.civildefence.govt.nz/atom/pwp"));
let EMERGENCY_MOBILE_ALERT_USE_PROXY = cfgBoolFromKeys(FNED_RWAS_CFG, ["emergencyMobileAlertUseProxy", "useProxyForEmergencyMobileAlerts", "emergencyMobileAlertProxyEnabled"], USE_PROXY_FOR_ALERT_FEEDS);
let EMERGENCY_MOBILE_ALERT_ATOM_URL_OVERRIDE = cfgStr(FNED_RWAS_CFG.emergencyMobileAlertFeedUrl, "");
let EMA_ALERT_ATOM_URL = resolveRwasFeedUrl(EMERGENCY_MOBILE_ALERT_ATOM_URL_OVERRIDE, RWAS_ENDPOINTS.emergencyMobileAlertAtom, EMERGENCY_MOBILE_ALERT_FEED_URL, EMERGENCY_MOBILE_ALERT_USE_PROXY);
let SHOW_CANCELLED_EMA_ALERTS = cfgBool(FNED_RWAS_CFG.showCancelledEmergencyMobileAlerts, false);

 //custom geojson area alerts 
 let SHOW_CUSTOM_GEOJSON_ALERTS = cfgBool(FNED_RWAS_CFG.showCustomGeoJsonAlerts, false); //Show alerts for custom areas that are defined
let USE_PROXY_FOR_CUSTOM_GEOJSON = cfgBool(FNED_RWAS_CFG.useProxyForCustomGeoJson, false);  //use proxy for custom grojson urls under the custom geo areas
let AREA_CATALOG_ENABLED = cfgBool(FNED_RWAS_CFG.areaCatalogEnabled, false);
let AREA_CATALOG_URL = cfgStr(FNED_RWAS_CFG.areaCatalogUrl, "");
let SELECTED_CUSTOM_GEO_AREAS = cfgOptionalStrArray(FNED_RWAS_CFG.selectedCustomGeoAreas);
let AVAILABLE_CUSTOM_GEO_AREAS = {};
let ACTIVE_CUSTOM_AREA_KEYS = [];
let areaCatalogPromise = null;
let areaCatalogPromiseUrl = "";
let USE_LINZ_AREAS = cfgBool(FNED_RWAS_CFG.useLinzAreas, false);
const DEFAULT_LINZ_API_KEY = "27a1097e44b44690a5c7726aa065a076";
const DEFAULT_LINZ_WFS_LAYER_URL = "https://data.linz.govt.nz/services;key=27a1097e44b44690a5c7726aa065a076/wfs/layer-113763/";
const DEFAULT_LINZ_WFS_TYPENAME = "layer-113763";
let LINZ_FORCE_BUNDLED_SOURCE = cfgBool(FNED_RWAS_CFG.linzForceBundledSource, true);
let USE_PROXY_FOR_LINZ_AREAS = cfgBool(FNED_RWAS_CFG.useProxyForLinzAreas, false);
let LINZ_SUBURB_LAYER_URL = LINZ_FORCE_BUNDLED_SOURCE
  ? DEFAULT_LINZ_WFS_LAYER_URL
  : cfgStr(FNED_RWAS_CFG.linzSuburbLayerUrl, DEFAULT_LINZ_WFS_LAYER_URL);
let LINZ_API_KEY = LINZ_FORCE_BUNDLED_SOURCE
  ? DEFAULT_LINZ_API_KEY
  : cfgStr(FNED_RWAS_CFG.linzApiKey, DEFAULT_LINZ_API_KEY);
let LINZ_API_KEY_PARAM = LINZ_FORCE_BUNDLED_SOURCE
  ? "api_key"
  : cfgStr(FNED_RWAS_CFG.linzApiKeyParam, "api_key");
let LINZ_WFS_TYPENAME = LINZ_FORCE_BUNDLED_SOURCE
  ? DEFAULT_LINZ_WFS_TYPENAME
  : cfgStr(FNED_RWAS_CFG.linzWfsTypeName, DEFAULT_LINZ_WFS_TYPENAME);
let LINZ_SELECTED_AREAS = cfgStrArray(FNED_RWAS_CFG.linzSelectedAreas, []);

let DISABLE_FAR_NORTH_ALERTS = cfgBool(FNED_RWAS_CFG.disableFarNorthAlerts, false);    //Hide Far north geo jason alerts 
//const withinTime = true; legacy content, was the alternative to isitactivestill
  let farNorthGeoJSON = null;
//Far north geojson config
  const GEOJSON_KEY = "farNorthGeoJSON";
  const GEOJSON_TIMESTAMP_KEY = "farNorthGeoJSON_timestamp";
  let GEOJSON_EXPIRY_HOURS = Math.max(1, cfgNum(FNED_RWAS_CFG.geoJsonExpiryHours, 24)); //Time period for Far North geojson cache refresh

  //check to see if the stored Far North geojson is still ative, uses geo expiry hours
  function isGeoJSONExpired() {
    const saved = localStorage.getItem(GEOJSON_TIMESTAMP_KEY);
    if (!saved) return true;
    const age = (Date.now() - parseInt(saved)) / (1000 * 60 * 60);
    return age > GEOJSON_EXPIRY_HOURS;
  }
//custom geo areas polygon creator https://codepen.io/Amorangi-Mathews/full/yyYgmLM
  const DEFAULT_CUSTOM_GEO_AREAS = {/*
  Area1: {
    type: "FeatureCollection",
    name: "Area 1",
    features: [
      {
        type: "Feature",
        properties: { Name: "Custom Area 1" },
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [173.295593, -35.250529],
              [173.298374, -35.251049],
              [173.299805, -35.248748],
              [173.295593, -35.250529]
            ]
          ]
        }
      }
    ]
  },*/
    "Far North": "https://raw.githubusercontent.com/almokinsgov/NZSHAPE/refs/heads/main/Areas/farnorth.geojson",
    "\u014ctur\u016b Marae": "https://raw.githubusercontent.com/almokinsgov/NZSHAPE/refs/heads/main/Areas/Marae/oturumarae.geojson",
    "Whang\u0101rei District": "https://raw.githubusercontent.com/almokinsgov/NZSHAPE/refs/heads/main/Areas/whangarei.geojson",
    "Gisborne": "https://raw.githubusercontent.com/almokinsgov/NZSHAPE/refs/heads/main/Areas/gisborne.geojson",
    "Nelson": "https://raw.githubusercontent.com/almokinsgov/NZSHAPE/refs/heads/main/Areas/nelson.geojson",
    "Southland": "https://raw.githubusercontent.com/almokinsgov/NZSHAPE/refs/heads/main/Areas/cantosouth.geojson",
};
  let CustomGeoAreas = cfgObj(FNED_RWAS_CFG.customGeoAreas, DEFAULT_CUSTOM_GEO_AREAS);

function resolveRwasRelativeUrl(rawUrl, baseUrl) {
  const value = cfgStr(rawUrl, "");
  if (!value) return "";
  try {
    return new URL(value, baseUrl || document.baseURI).href;
  } catch (error) {
    return value;
  }
}

function normalizeRwasAreaCatalog(data, catalogUrl) {
  const output = {};
  const catalogBaseUrl = resolveRwasRelativeUrl(catalogUrl, document.baseURI);
  if (data && Array.isArray(data.areas)) {
    data.areas.forEach(function (entry) {
      if (!entry || typeof entry !== "object") return;
      const name = cfgStr(entry.name, "");
      const url = cfgStr(entry.url, cfgStr(entry.file, ""));
      if (name && url) output[name] = resolveRwasRelativeUrl(url, catalogBaseUrl);
    });
    return output;
  }
  if (data && typeof data === "object" && !Array.isArray(data)) {
    Object.keys(data).forEach(function (name) {
      const entry = data[name];
      if (typeof entry === "string") {
        output[name] = resolveRwasRelativeUrl(entry, catalogBaseUrl);
      }
    });
  }
  return output;
}

async function loadRwasAreaCatalog() {
  if (!AREA_CATALOG_ENABLED || !AREA_CATALOG_URL) return {};
  const resolvedCatalogUrl = resolveRwasRelativeUrl(AREA_CATALOG_URL, document.baseURI);
  if (areaCatalogPromise && areaCatalogPromiseUrl === resolvedCatalogUrl) {
    return areaCatalogPromise;
  }
  areaCatalogPromiseUrl = resolvedCatalogUrl;
  areaCatalogPromise = rwasFetchJsonTracked("rwas.custom_geojson.catalog", resolvedCatalogUrl)
    .then(function (data) {
      return normalizeRwasAreaCatalog(data, resolvedCatalogUrl);
    })
    .catch(function (error) {
      console.warn("RWAS area catalog could not be loaded:", error);
      return {};
    });
  return areaCatalogPromise;
}

function rwasGeoJsonCrsName(geojson) {
  return String(
    geojson &&
    geojson.crs &&
    geojson.crs.properties &&
    geojson.crs.properties.name ||
    ""
  );
}

function transformRwasCoordinates(coords, converter) {
  if (!Array.isArray(coords)) return coords;
  if (typeof coords[0] === "number" && typeof coords[1] === "number") {
    const converted = converter([coords[0], coords[1]]);
    return [converted[0], converted[1]].concat(coords.slice(2));
  }
  return coords.map(function (entry) {
    return transformRwasCoordinates(entry, converter);
  });
}

async function normalizeRwasCustomAreaGeoJson(geojson) {
  if (!geojson || geojson.type !== "FeatureCollection") return geojson;
  if (!/2193/i.test(rwasGeoJsonCrsName(geojson))) return geojson;
  const proj4Api = await ensureRwasProj4();
  proj4Api.defs(
    "EPSG:2193",
    "+proj=tmerc +lat_0=0 +lon_0=173 +k=0.9996 +x_0=1600000 +y_0=10000000 +ellps=GRS80 +units=m +no_defs +type=crs"
  );
  const clone = JSON.parse(JSON.stringify(geojson));
  clone.features.forEach(function (feature) {
    if (!feature || !feature.geometry) return;
    feature.geometry.coordinates = transformRwasCoordinates(
      feature.geometry.coordinates,
      function (coordinate) {
        return proj4Api("EPSG:2193", "EPSG:4326", coordinate);
      }
    );
    delete feature.bbox;
  });
  delete clone.bbox;
  delete clone.crs;
  return clone;
}

async function getEffectiveCustomGeoAreaEntries() {
  const catalogAreas = await loadRwasAreaCatalog();
  AVAILABLE_CUSTOM_GEO_AREAS = Object.assign({}, catalogAreas, CustomGeoAreas);
  const availableNames = Object.keys(AVAILABLE_CUSTOM_GEO_AREAS)
    .sort(function (a, b) { return a.localeCompare(b, RWAS_TIME_LOCALE); });
  const selectedSet = SELECTED_CUSTOM_GEO_AREAS === null
    ? null
    : new Set(SELECTED_CUSTOM_GEO_AREAS);
  ACTIVE_CUSTOM_AREA_KEYS = selectedSet === null
    ? availableNames.slice()
    : availableNames.filter(function (name) { return selectedSet.has(name); });
  AREA_DISPLAY_ORDER = Array.from(new Set(AREA_DISPLAY_ORDER.concat(availableNames)));
  return ACTIVE_CUSTOM_AREA_KEYS.map(function (name) {
    return {
      name: name,
      entry: AVAILABLE_CUSTOM_GEO_AREAS[name]
    };
  });
}
  
  // or: const newGeoJSON = { type: "FeatureCollection", features: [...] };
let newGeoJSON = cfgStr(
  FNED_RWAS_CFG.farNorthGeoJsonUrl,
  "https://raw.githubusercontent.com/almokinsgov/NZSHAPE/refs/heads/main/Areas/farnorth.geojson"
);

  //try and load far north geo json
  async function loadFarNorthGeoJSON() {
  if (!isGeoJSONExpired()) {
    try {
      const stored = JSON.parse(localStorage.getItem(GEOJSON_KEY));
      if (stored && stored.type === "FeatureCollection") return stored;
    } catch {
      console.warn("Corrupted stored Far North GeoJSON, regenerating.");
    }
  }

  let finalGeoJSON = null;
//if there is a url load through a proxy if enabled
  try {
    if (typeof newGeoJSON === "string") {
      const url = USE_PROXY_FOR_CUSTOM_GEOJSON ? buildProxyRequestUrl(newGeoJSON) : newGeoJSON;
      finalGeoJSON = await rwasFetchJsonTracked("rwas.far_north_geojson", url);
    } else if (newGeoJSON?.type === "FeatureCollection") {
      finalGeoJSON = newGeoJSON;
    }
  } catch (e) {
    console.warn("Failed to load newGeoJSON:", e);
  } 

  if (finalGeoJSON) {
    localStorage.setItem(GEOJSON_KEY, JSON.stringify(finalGeoJSON));
    localStorage.setItem(GEOJSON_TIMESTAMP_KEY, Date.now().toString());
  }

  return finalGeoJSON;
}

//custom sorting for areas displayed in the alert html from the custom geo area

const DEFAULT_AREA_DISPLAY_ORDER = [
"Far North District",
"Far North",
"\u014ctur\u016b Marae",
 "Whang\u0101rei District",
"Gisborne",
"Nelson",
"Southland",
];
const DEFAULT_ALERT_SOURCE_ORDER = ["civilDefence", "metService", "nzta"];
const DEFAULT_ALERT_SEVERITY_ORDER = ["red", "orange", "yellow", "default"];
window.FNED_RWAS_DEFAULTS = {
  customGeoAreas: JSON.parse(JSON.stringify(DEFAULT_CUSTOM_GEO_AREAS)),
  alertSourceOrder: DEFAULT_ALERT_SOURCE_ORDER.slice(),
  alertSeverityOrder: DEFAULT_ALERT_SEVERITY_ORDER.slice(),
  areaDisplayOrder: DEFAULT_AREA_DISPLAY_ORDER.slice(),
  selectedCustomGeoAreas: null
};
let ALERT_SOURCE_ORDER = cfgStrArray(FNED_RWAS_CFG.alertSourceOrder, DEFAULT_ALERT_SOURCE_ORDER);
let ALERT_SEVERITY_ORDER = cfgStrArray(FNED_RWAS_CFG.alertSeverityOrder, DEFAULT_ALERT_SEVERITY_ORDER);
let AREA_DISPLAY_ORDER = cfgStrArray(FNED_RWAS_CFG.areaDisplayOrder, DEFAULT_AREA_DISPLAY_ORDER);
function hasCustomAreaFilters() {
  return (SHOW_CUSTOM_GEOJSON_ALERTS && (ACTIVE_CUSTOM_AREA_KEYS.length > 0 || customGeoAreas.length > 0)) ||
    (USE_LINZ_AREAS && LINZ_SELECTED_AREAS.length > 0);
}
function hasLocalAreaFilters() {
  return (!DISABLE_FAR_NORTH_ALERTS) || hasCustomAreaFilters();
}

function isLinzSelectionConfigured() {
  return USE_LINZ_AREAS && LINZ_SELECTED_AREAS.length > 0;
}

function isLinzFilteringDegraded() {
  return isLinzSelectionConfigured() && linzGeoAreas.length === 0;
}

function isScopedAreaFilteringActive() {
  const hasCustomScope = SHOW_CUSTOM_GEOJSON_ALERTS && customGeoAreas.length > 0;
  const hasLinzScope = USE_LINZ_AREAS && linzGeoAreas.length > 0;
  return hasCustomScope || hasLinzScope;
}

function shouldIncludeAlertByArea(intersects) {
  if (SHOW_NON_FAR_NORTH_ALERTS) return true;
  return !!intersects;
}

function passesAlertTimeWindow(onsetText, expiresText, alertStatus) {
  if (!REQUIRE_ONSET_WITHIN_WINDOW) return true;
  if (SHOW_EXPIRED_ALERTS && alertStatus === "expired") return true;
  return isWithinHourWindow(onsetText, expiresText);
}

function getRwasXmlText(parent, tagName) {
  const el = parent && parent.getElementsByTagName ? parent.getElementsByTagName(tagName)[0] : null;
  return el ? String(el.textContent || "").trim() : "";
}

function getRwasRssLink(item) {
  const linkEl = item && item.getElementsByTagName ? item.getElementsByTagName("link")[0] : null;
  if (!linkEl) return "";
  return String(linkEl.getAttribute("href") || linkEl.textContent || "").trim();
}

function cleanRwasAlertText(text) {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function escapeRwasHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatRwasNZTime(iso) {
  if (!iso) return "";
  const dt = new Date(iso);
  if (isNaN(dt.getTime())) return "";
  return dt.toLocaleString(RWAS_TIME_LOCALE, {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: RWAS_TIME_ZONE
  });
}

function rwasDateToIso(dateText) {
  if (!dateText) return "";
  const dt = new Date(dateText);
  return isNaN(dt.getTime()) ? "" : dt.toISOString();
}

function passesRwasRssPublicationWindow(pubDateText) {
  if (!REQUIRE_ONSET_WITHIN_WINDOW) return true;
  if (!pubDateText) return true;
  const published = new Date(pubDateText);
  if (isNaN(published.getTime())) return true;
  const ageHours = (Date.now() - published.getTime()) / 1000 / 3600;
  if (ageHours < 0) {
    return Math.abs(ageHours) <= HOUR_WINDOW;
  }
  return ageHours <= Math.max(HOUR_WINDOW, 24);
}

function getActiveAlertScopeAreas() {
  const areas = [];
  if (!DISABLE_FAR_NORTH_ALERTS && farNorthGeoJSON) {
    areas.push({ name: "Far North District", geojson: farNorthGeoJSON });
  }
  if ((SHOW_CUSTOM_GEOJSON_ALERTS || USE_LINZ_AREAS) && customGeoAreas.length) {
    customGeoAreas.forEach(function (item) {
      areas.push(item);
    });
  }
  if ((SHOW_CUSTOM_GEOJSON_ALERTS || USE_LINZ_AREAS) && linzGeoAreas.length) {
    linzGeoAreas.forEach(function (item) {
      areas.push(item);
    });
  }
  return areas;
}

function getRwasAreaFeaturesForPlugins() {
  const features = [];
  getActiveAlertScopeAreas().forEach(function (area) {
    const geojson = area && area.geojson;
    if (!geojson) return;
    const sourceFeatures = geojson.type === "FeatureCollection"
      ? geojson.features
      : (geojson.type === "Feature" ? [geojson] : []);
    (sourceFeatures || []).forEach(function (feature) {
      const clone = cloneRwasFeature(feature);
      if (!clone) return;
      clone.properties = Object.assign({}, clone.properties || {}, {
        rwasAreaName: area.name || ""
      });
      features.push(clone);
    });
  });
  return {
    type: "FeatureCollection",
    features: features
  };
}

function alertScopeIntersectsGeoJsonFeature(feature) {
  if (!feature || !feature.geometry || typeof turf === "undefined") {
    return false;
  }
  const areas = getActiveAlertScopeAreas();
  let intersects = false;
  for (let i = 0; i < areas.length; i++) {
    const area = areas[i];
    if (area && area.geojson && turf.booleanIntersects(feature, area.geojson)) {
      intersects = true;
      break;
    }
  }
  return shouldIncludeAlertByArea(intersects);
}

function buildAlertScopeApi() {
  return {
    isScopedAreaFilteringActive: isScopedAreaFilteringActive(),
    showNonFarNorthAlerts: !!SHOW_NON_FAR_NORTH_ALERTS,
    disableFarNorthAlerts: !!DISABLE_FAR_NORTH_ALERTS,
    showCustomGeoJsonAlerts: !!SHOW_CUSTOM_GEOJSON_ALERTS,
    useLinzAreas: !!USE_LINZ_AREAS,
    availableCustomAreaNames: Object.keys(AVAILABLE_CUSTOM_GEO_AREAS),
    selectedCustomAreaNames: SELECTED_CUSTOM_GEO_AREAS === null
      ? ACTIVE_CUSTOM_AREA_KEYS.slice()
      : SELECTED_CUSTOM_GEO_AREAS.slice(),
    loadedCustomAreaNames: customGeoAreas.map(function (item) { return item.name; }),
    loadedLinzAreaNames: linzGeoAreas.map(function (item) { return item.name; }),
    featureMatchesAreaScope: function (feature) {
      return alertScopeIntersectsGeoJsonFeature(feature);
    }
  };
}


//Format the times

  function formatReadableTime(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleString(RWAS_TIME_LOCALE, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: RWAS_TIME_ZONE
    });
  } 
  //predifinitions and clering 
  let customGeoAreas = [];
  let linzGeoAreas = [];
let combinedAlertList = []; // Holds all alerts for sorting and display

function isLinzArcGisEndpoint() {
  return /arcgis\/rest/i.test(String(LINZ_SUBURB_LAYER_URL || ""));
}

function linzArcGisQueryUrl(params) {
  const base = LINZ_SUBURB_LAYER_URL.replace(/\/+$/, "") + "/query";
  const requestParams = {};
  Object.keys(params || {}).forEach(function (key) {
    requestParams[key] = params[key];
  });
  if (LINZ_API_KEY && LINZ_API_KEY_PARAM) {
    requestParams[LINZ_API_KEY_PARAM] = LINZ_API_KEY;
  }
  const pairs = Object.keys(requestParams).map(function (key) {
    return encodeURIComponent(key) + "=" + encodeURIComponent(requestParams[key]);
  });
  const url = base + "?" + pairs.join("&");
  return USE_PROXY_FOR_LINZ_AREAS ? buildProxyRequestUrl(url) : url;
}

function linzWfsGetFeatureUrl(startIndex, count) {
  const base = LINZ_SUBURB_LAYER_URL.replace(/\/+$/, "") + "/";
  const requestParams = {
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typeNames: LINZ_WFS_TYPENAME || DEFAULT_LINZ_WFS_TYPENAME,
    outputFormat: "application/json",
    srsName: "EPSG:4326",
    count: String(count),
    startIndex: String(startIndex)
  };
  const pairs = Object.keys(requestParams).map(function (key) {
    return encodeURIComponent(key) + "=" + encodeURIComponent(requestParams[key]);
  });
  const url = base + "?" + pairs.join("&");
  return USE_PROXY_FOR_LINZ_AREAS ? buildProxyRequestUrl(url) : url;
}

function pickLinzName(attrs) {
  if (!attrs || typeof attrs !== "object") return "";
  const candidates = [
    "name",
    "Name",
    "SUBURB_LOCALITY",
    "SUBURB_LOC",
    "LOCALITY_NAME",
    "LOCALITY",
    "SUBURB",
    "suburb",
    "label"
  ];
  for (let i = 0; i < candidates.length; i++) {
    const value = attrs[candidates[i]];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  const keys = Object.keys(attrs);
  for (let i = 0; i < keys.length; i++) {
    const value = attrs[keys[i]];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function latFromArcGisGeometry(geometry) {
  if (!geometry) return null;
  if (typeof geometry.y === "number") return geometry.y;
  if (!Array.isArray(geometry.rings)) return null;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < geometry.rings.length; i++) {
    const ring = geometry.rings[i];
    if (!Array.isArray(ring)) continue;
    for (let j = 0; j < ring.length; j++) {
      const pt = ring[j];
      if (Array.isArray(pt) && typeof pt[1] === "number") {
        sum += pt[1];
        count += 1;
      }
    }
  }
  return count ? (sum / count) : null;
}

function latFromGeoJsonGeometry(geometry) {
  if (!geometry || !Array.isArray(geometry.coordinates)) return null;
  let sum = 0;
  let count = 0;
  (function walk(node) {
    if (!Array.isArray(node)) return;
    if (node.length >= 2 && typeof node[0] === "number" && typeof node[1] === "number") {
      sum += node[1];
      count += 1;
      return;
    }
    for (let i = 0; i < node.length; i++) walk(node[i]);
  })(geometry.coordinates);
  return count ? (sum / count) : null;
}

function arcGisGeometryToFeatureCollection(geometry, attrs) {
  if (!geometry) return null;
  if (Array.isArray(geometry.rings)) {
    return {
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        properties: attrs || {},
        geometry: {
          type: "Polygon",
          coordinates: geometry.rings
        }
      }]
    };
  }
  if (typeof geometry.x === "number" && typeof geometry.y === "number") {
    return {
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        properties: attrs || {},
        geometry: {
          type: "Point",
          coordinates: [geometry.x, geometry.y]
        }
      }]
    };
  }
  return null;
}

function geoJsonGeometryToFeatureCollection(geometry, attrs) {
  if (!geometry || !Array.isArray(geometry.coordinates)) return null;
  return {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      properties: attrs || {},
      geometry: geometry
    }]
  };
}

let linzAreaCatalogPromise = null;
let linzAreaCatalog = [];
let linzAreaGeoMap = {};
let linzAreaCatalogFetchedAt = 0;
let linzAreaCatalogSourceKey = "";
const LINZ_AREA_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const LINZ_WFS_PAGE_SIZE = 250;

function getLinzSourceKey() {
  return [
    String(LINZ_SUBURB_LAYER_URL || ""),
    String(LINZ_WFS_TYPENAME || ""),
    String(LINZ_API_KEY_PARAM || ""),
    String(LINZ_API_KEY || ""),
    String(LINZ_FORCE_BUNDLED_SOURCE ? "1" : "0"),
    String(USE_PROXY_FOR_LINZ_AREAS ? "1" : "0"),
    String(proxy || "")
  ].join("|");
}

async function loadLinzAreaCatalog(force) {
  const sourceKey = getLinzSourceKey();
  const cacheAge = Date.now() - linzAreaCatalogFetchedAt;
  const cacheIsFresh = linzAreaCatalogFetchedAt > 0 && cacheAge >= 0 && cacheAge < LINZ_AREA_CACHE_TTL_MS;
  if (!force && linzAreaCatalogPromise && cacheIsFresh && sourceKey === linzAreaCatalogSourceKey) return linzAreaCatalogPromise;
  if (!cacheIsFresh || sourceKey !== linzAreaCatalogSourceKey) {
    linzAreaCatalogPromise = null;
    linzAreaCatalog = [];
    linzAreaGeoMap = {};
  }
  linzAreaCatalogPromise = (async function () {
    const list = [];
    const geoByName = {};
    let offset = 0;
    const pageSize = LINZ_WFS_PAGE_SIZE;
    let guard = 0;
    while (guard < 50) {
      guard += 1;
      const page = isLinzArcGisEndpoint()
        ? await rwasFetchJsonTracked("rwas.linz.localities", linzArcGisQueryUrl({
          where: "1=1",
          outFields: "*",
          returnGeometry: "true",
          outSR: "4326",
          resultOffset: String(offset),
          resultRecordCount: String(pageSize),
          f: "json"
        }))
        : await rwasFetchJsonTracked("rwas.linz.localities", linzWfsGetFeatureUrl(offset, pageSize));
      const features = Array.isArray(page && page.features) ? page.features : [];
      if (!features.length) break;
      for (let i = 0; i < features.length; i++) {
        const feature = features[i] || {};
        const attrs = isLinzArcGisEndpoint() ? (feature.attributes || {}) : (feature.properties || {});
        const name = pickLinzName(attrs);
        if (!name || geoByName[name]) continue;
        const geojson = isLinzArcGisEndpoint()
          ? arcGisGeometryToFeatureCollection(feature.geometry, attrs)
          : geoJsonGeometryToFeatureCollection(feature.geometry, attrs);
        if (!geojson) continue;
        const latitude = isLinzArcGisEndpoint()
          ? latFromArcGisGeometry(feature.geometry)
          : latFromGeoJsonGeometry(feature.geometry);
        geoByName[name] = geojson;
        list.push({ name: name, latitude: (typeof latitude === "number" ? latitude : -90) });
      }
      if (features.length < pageSize) break;
      if (isLinzArcGisEndpoint() && page.exceededTransferLimit !== true) break;
      offset += features.length;
    }
    list.sort(function (a, b) { return b.latitude - a.latitude; });
    linzAreaCatalog = list;
    linzAreaGeoMap = geoByName;
    linzAreaCatalogFetchedAt = Date.now();
    linzAreaCatalogSourceKey = sourceKey;
    return { list: list, geoByName: geoByName };
  })().catch(function (err) {
    linzAreaCatalogPromise = null;
    throw err;
  });
  return linzAreaCatalogPromise;
}

async function loadSelectedLinzGeoAreas() {
  if (!USE_LINZ_AREAS || !LINZ_SELECTED_AREAS.length) return [];
  try {
    const catalog = await loadLinzAreaCatalog(false);
    const geoByName = catalog.geoByName || {};
    const lowerNameMap = {};
    Object.keys(geoByName).forEach(function (name) {
      lowerNameMap[name.toLowerCase()] = name;
    });
    const selected = [];
    LINZ_SELECTED_AREAS.forEach(function (rawName) {
      const normalized = String(rawName || "").trim();
      if (!normalized) return;
      const exact = geoByName[normalized];
      if (exact) {
        selected.push({ name: normalized, geojson: exact });
        return;
      }
      const resolved = lowerNameMap[normalized.toLowerCase()];
      if (resolved && geoByName[resolved]) {
        selected.push({ name: resolved, geojson: geoByName[resolved] });
      }
    });
    return selected;
  } catch (err) {
    console.warn("Failed to load selected LINZ areas:", err);
    return [];
  }
}

window.FNED_LINZ_AREAS_API = {
  getAreaList: async function (force) {
    const catalog = await loadLinzAreaCatalog(!!force);
    return (catalog.list || []).map(function (item) {
      return { name: item.name, latitude: item.latitude };
    });
  },
  getStatus: function () {
    return {
      loaded: !!linzAreaCatalogFetchedAt,
      count: Array.isArray(linzAreaCatalog) ? linzAreaCatalog.length : 0,
      fetchedAt: linzAreaCatalogFetchedAt || 0,
      cacheTtlMs: LINZ_AREA_CACHE_TTL_MS,
      sourceKey: linzAreaCatalogSourceKey
    };
  },
  clearCache: function () {
    linzAreaCatalogPromise = null;
    linzAreaCatalog = [];
    linzAreaGeoMap = {};
    linzAreaCatalogFetchedAt = 0;
    linzAreaCatalogSourceKey = "";
  }
};
window.RWAS_LINZ_AREAS_API = window.FNED_LINZ_AREAS_API;
  
  
function getRwasAtomText(entry, tagName) {
  const ns = "http://www.w3.org/2005/Atom";
  const el = entry && entry.getElementsByTagNameNS
    ? entry.getElementsByTagNameNS(ns, tagName)[0]
    : null;
  return el ? String(el.textContent || "").trim() : "";
}

function getRwasAtomLink(entry, rel) {
  if (!entry || !entry.querySelector) return "";
  const selector = rel ? "link[rel='" + rel + "']" : "link";
  return entry.querySelector(selector)?.getAttribute("href") || "";
}

function shouldLoadMetServiceCapDetails(options) {
  const mode = cfgMode(options && options.detailMode, ["auto", "atom", "cap"], MET_SERVICE_DETAIL_MODE);
  if (mode === "cap") return true;
  if (mode === "atom") return false;
  return cfgBool(options && options.useProxy, USE_PROXY_FOR_ALERT_FEEDS);
}

function getMetServiceAtomEntryStatus(dateText) {
  if (!dateText) return "active-now";
  const published = new Date(dateText);
  if (isNaN(published.getTime())) return "active-now";
  const ageHours = (Date.now() - published.getTime()) / 1000 / 3600;
  if (ageHours < 0) return "upcoming";
  return ageHours > Math.max(HOUR_WINDOW, 24) ? "expired" : "active-now";
}

function getMetServiceStatusBadge(alertStatus) {
  if (alertStatus === "upcoming") return `<span class="badge upcoming-badge">Upcoming</span>`;
  if (alertStatus === "active-now") return `<span class="badge active-badge">Active Now</span>`;
  if (alertStatus === "expired") return `<span class="badge expired-badge">Expired</span>`;
  return "";
}

function getMetServiceAtomColourCode(title) {
  const text = String(title || "");
  const explicit = text.match(/\b(Red|Orange|Yellow|Green)\b/i);
  if (explicit) {
    return explicit[1].charAt(0).toUpperCase() + explicit[1].slice(1).toLowerCase();
  }
  if (/\bWatch\b/i.test(text) || /\bAdvisory\b/i.test(text)) {
    return "Yellow";
  }
  return "";
}

function pushMetServiceAtomEntry(entry, relatedUrl, options) {
  if (!entry) return;

  const title = getRwasAtomText(entry, "title") || "MetService weather alert";
  const summary = cleanRwasAlertText(getRwasAtomText(entry, "summary") || getRwasAtomText(entry, "content"));
  const updated = getRwasAtomText(entry, "updated") || getRwasAtomText(entry, "published");
  const link = getRwasAtomLink(entry, "alternate") || relatedUrl || options.defaultLink || "";
  const id = getRwasAtomText(entry, "id") || relatedUrl || (title + "|" + updated);
  const alertStatus = getMetServiceAtomEntryStatus(updated);
  const isAllowedStatus =
    alertStatus === "active-now" ||
    alertStatus === "upcoming" ||
    (alertStatus === "expired" && SHOW_EXPIRED_ALERTS);
  const withinHourWindow = (alertStatus === "expired" && SHOW_EXPIRED_ALERTS)
    ? true
    : passesRwasRssPublicationWindow(updated);
  const includeByArea = SHOW_NON_FAR_NORTH_ALERTS || !isScopedAreaFilteringActive();

  if (!includeByArea || !isAllowedStatus || !withinHourWindow) {
    return;
  }

  const matchedAreaNames = [];
  const colourCode = getMetServiceAtomColourCode(title);
  const colourClass = colourCode ? `alert-${colourCode.toLowerCase()}` : "alert-default";
  const alertHTML = `
<div class="alert-card far-north ${alertStatus} ${colourClass}">
  <b>${escapeRwasHtml(title)}</b><br>
  MetService has issued a weather alert that includes parts of ${formatAreaList(matchedAreaNames)}<br>
  ${link ? `<a href="${escapeRwasHtml(link)}" target="_blank" rel="noopener">Visit MetService website for more information.</a><br>` : ""}
  <span class="badge alert-met">MetService</span>
  ${colourCode ? `<span class="badge ${colourClass}">${escapeRwasHtml(colourCode)}</span>` : ""}
  ${getMetServiceStatusBadge(alertStatus)}
</div>`;

  combinedAlertList.push({
    id: id,
    title: title,
    html: alertHTML,
    status: alertStatus,
    source: "met",
    sourceLabel: options.sourceLabel || "MetService",
    areas: matchedAreaNames,
    startsAt: updated || "",
    endsAt: "",
    description: summary,
    colourCode: colourCode,
    link: link,
    recordType: "atom",
    features: []
  });
}

function getRwasCapElements(parent, tagName) {
  if (!parent || !parent.getElementsByTagNameNS) return [];
  const capNS = "urn:oasis:names:tc:emergency:cap:1.2";
  const nsElements = parent.getElementsByTagNameNS(capNS, tagName);
  if (nsElements && nsElements.length) return Array.prototype.slice.call(nsElements);
  return Array.prototype.slice.call(parent.getElementsByTagName(tagName));
}

function getRwasCapText(parent, tagName) {
  const el = getRwasCapElements(parent, tagName)[0];
  return el ? String(el.textContent || "").trim() : "";
}

function getRwasCapParameterValue(infoNode, paramName) {
  const params = getRwasCapElements(infoNode, "parameter");
  for (const param of params) {
    const name = getRwasCapText(param, "valueName");
    const value = getRwasCapText(param, "value");
    if (name && value && name === paramName) return value;
  }
  return "";
}

function parseRwasCapPolygonCoordinates(text) {
  const coords = String(text || "")
    .trim()
    .split(/\s+/)
    .map(function (pair) {
      const parts = pair.split(",").map(Number);
      return parts.length >= 2 && Number.isFinite(parts[0]) && Number.isFinite(parts[1])
        ? [parts[1], parts[0]]
        : null;
    })
    .filter(Boolean);
  if (coords.length < 3) return [];
  const first = coords[0];
  const last = coords[coords.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    coords.push([first[0], first[1]]);
  }
  return coords;
}

function buildRwasAlertFeatures(geoCoords, properties) {
  return (Array.isArray(geoCoords) ? geoCoords : [])
    .filter(function (coords) { return Array.isArray(coords) && coords.length >= 4; })
    .map(function (coords, index) {
      return {
        type: "Feature",
        properties: Object.assign({ polygonIndex: index }, properties || {}),
        geometry: {
          type: "Polygon",
          coordinates: [coords]
        }
      };
    });
}

function pushMetServiceCapAlert(capXML, url, options) {
  const capIdentifier = getRwasCapText(capXML, "identifier") || url || "";
  const info = getRwasCapElements(capXML, "info")[0];
  if (!info) return;

  const headline = getRwasCapText(info, "headline") || getRwasCapText(info, "event") || "MetService weather alert";
  const description = getRwasCapText(info, "description");
  const onset = getRwasCapText(info, "onset");
  const expires = getRwasCapText(info, "expires");
  const web = getRwasCapText(info, "web") || url || "";
  const severity = getRwasCapText(info, "severity");
  const colourCode = getRwasCapParameterValue(info, "ColourCode");
  const colourClass = colourCode ? `alert-${colourCode.toLowerCase()}` : "alert-default";
  const polygons = getRwasCapElements(info, "polygon");
  const geoCoords = [];

  polygons.forEach(function (polygon) {
    const coords = parseRwasCapPolygonCoordinates(polygon.textContent);
    if (coords.length) {
      geoCoords.push(coords);
    }
  });

  let intersects = false;
  let matchedAreaNames = [];
  geoCoords.forEach(function (coords) {
    try {
      const poly = turf.polygon([coords]);
      if (!DISABLE_FAR_NORTH_ALERTS && farNorthGeoJSON && turf.booleanIntersects(poly, farNorthGeoJSON)) {
        intersects = true;
        if (!matchedAreaNames.includes("Far North District")) {
          matchedAreaNames.push("Far North District");
        }
      }

      const activeCustomLikeAreas = customGeoAreas.concat(linzGeoAreas);
      if ((SHOW_CUSTOM_GEOJSON_ALERTS || USE_LINZ_AREAS) && activeCustomLikeAreas.length) {
        for (let i = 0; i < activeCustomLikeAreas.length; i++) {
          const custom = activeCustomLikeAreas[i];
          if (custom.geojson && turf.booleanIntersects(poly, custom.geojson)) {
            intersects = true;
            if (!matchedAreaNames.includes(custom.name)) {
              matchedAreaNames.push(custom.name);
            }
          }
        }
      }
    } catch (err) {
      console.warn("Skipping invalid MetService CAP polygon", err);
    }
  });

  const now = new Date();
  let alertStatus = "";
  if (onset && expires) {
    const onsetTime = new Date(onset);
    const expiresTime = new Date(expires);
    if (now >= onsetTime && now <= expiresTime) {
      alertStatus = "active-now";
    } else if (now < onsetTime) {
      alertStatus = "upcoming";
    } else {
      alertStatus = "expired";
    }
  } else {
    alertStatus = "active-now";
  }

  const isAllowedStatus =
    alertStatus === "active-now" ||
    alertStatus === "upcoming" ||
    (alertStatus === "expired" && SHOW_EXPIRED_ALERTS);
  const withinHourWindow = passesAlertTimeWindow(onset, expires, alertStatus);
  const includeByArea = shouldIncludeAlertByArea(intersects);
  const qualifies = includeByArea && isAllowedStatus && withinHourWindow;

  matchedAreaNames.sort(function (a, b) {
    const iA = AREA_DISPLAY_ORDER.indexOf(a);
    const iB = AREA_DISPLAY_ORDER.indexOf(b);
    return (iA === -1 ? 999 : iA) - (iB === -1 ? 999 : iB);
  });

  const alertHTML = `
<div class="alert-card ${qualifies ? "far-north" : ""} ${alertStatus} ${colourClass}">
  <b>${escapeRwasHtml(headline)}</b><br>
  MetService has issued a weather alert that includes parts of ${formatAreaList(matchedAreaNames)}
  ${onset ? ` from ${escapeRwasHtml(formatReadableTime(onset))} ` : ""}
  ${expires ? `to ${escapeRwasHtml(formatReadableTime(expires))}.<br>` : "<br>"}
  ${web ? `<a href="${escapeRwasHtml(web)}" target="_blank" rel="noopener">Visit MetService website for more information.</a><br>` : ""}
  <span class="badge alert-met">MetService</span>
  ${colourCode ? `<span class="badge ${colourClass}">${escapeRwasHtml(colourCode)}</span>` : ""}
  ${getMetServiceStatusBadge(alertStatus)}
</div>`;

  if (qualifies) {
    const features = buildRwasAlertFeatures(geoCoords, {
      id: capIdentifier,
      title: headline,
      source: "met",
      sourceLabel: options.sourceLabel || "MetService",
      status: alertStatus,
      severity: severity,
      colourCode: colourCode
    });
    combinedAlertList.push({
      id: capIdentifier,
      title: headline,
      html: alertHTML,
      status: alertStatus,
      source: "met",
      sourceLabel: options.sourceLabel || "MetService",
      areas: matchedAreaNames,
      startsAt: onset || "",
      endsAt: expires || "",
      description: description,
      severity: severity,
      colourCode: colourCode,
      link: web || url || "",
      recordType: "cap",
      features: features
    });
  }
}

async function fetchMetServiceFeed(options) {
  if (!options || !options.enabled || !options.atomUrl) return;

  try {
    const xmlText = await rwasFetchTextTracked(options.atomFeedKey, options.atomUrl);
    const xml = new DOMParser().parseFromString(xmlText, "application/xml");
    const ns = "http://www.w3.org/2005/Atom";
    const entries = [...xml.getElementsByTagNameNS(ns, "entry")];

    if (!entries.length && getRwasCapElements(xml, "info").length) {
      pushMetServiceCapAlert(xml, options.atomUrl, options);
      lastUpdatedTime = new Date().toISOString();
      return;
    }

    const relatedEntries = [];
    const seenLinks = new Set();
    entries.forEach(function (entry) {
      const url = normalizeProxyTargetRwas(getRwasAtomLink(entry, "related"));
      if (!url || seenLinks.has(url)) return;
      seenLinks.add(url);
      relatedEntries.push({ entry: entry, url: url });
    });

    if (shouldLoadMetServiceCapDetails(options) && relatedEntries.length) {
      for (const item of relatedEntries) {
        try {
          const capUrl = buildProxyRequestUrlWithMode(item.url, cfgBool(options.useProxy, USE_PROXY_FOR_ALERT_FEEDS));
          const capText = await rwasFetchTextTracked(options.capFeedKey, capUrl);
          const capXML = new DOMParser().parseFromString(capText, "application/xml");
          pushMetServiceCapAlert(capXML, item.url, options);
        } catch (capErr) {
          console.warn("Skipping MetService CAP detail due to load/parse error", item.url, capErr);
        }
      }
    } else {
      entries.forEach(function (entry) {
        pushMetServiceAtomEntry(entry, normalizeProxyTargetRwas(getRwasAtomLink(entry, "related")), options);
      });
    }

    lastUpdatedTime = new Date().toISOString();
  } catch (err) {
    console.error(err);
  }
}

  //check metservice feed, create html, sort
async function fetchAlerts() {
  const feedConfigs = [{
    enabled: ENABLE_MET_SERVICE_ALERTS,
    atomUrl: feedURL,
    atomFeedKey: "rwas.metservice.atom",
    capFeedKey: "rwas.metservice.cap",
    source: "met",
    sourceLabel: "MetService",
    badgeText: "MetService",
    useProxy: MET_SERVICE_USE_PROXY,
    detailMode: MET_SERVICE_DETAIL_MODE,
    defaultLink: "https://metservice.com/warnings/home"
  }];

  const configuredFeeds = Array.isArray(FNED_RWAS_CFG.metServiceFeeds)
    ? FNED_RWAS_CFG.metServiceFeeds
    : [];
  configuredFeeds.forEach(function (feed, index) {
    if (!feed || typeof feed !== "object") return;
    const rawUrl = cfgStr(feed.atomFeedUrl, cfgStr(feed.feedUrl, cfgStr(feed.atomUrl, cfgStr(feed.url, ""))));
    const feedUseProxy = getRwasFeedProxyFlag(feed, USE_PROXY_FOR_ALERT_FEEDS);
    const resolvedUrl = buildProxyRequestUrlWithMode(rawUrl, feedUseProxy);
    feedConfigs.push({
      enabled: cfgBool(feed.enabled, true),
      atomUrl: resolvedUrl,
      atomFeedKey: cfgStr(feed.atomFeedKey, "rwas.metservice.extra." + index + ".atom"),
      capFeedKey: cfgStr(feed.capFeedKey, "rwas.metservice.extra." + index + ".cap"),
      source: "met",
      sourceLabel: cfgStr(feed.sourceLabel, cfgStr(feed.label, "MetService")),
      badgeText: cfgStr(feed.badgeText, "MetService"),
      useProxy: feedUseProxy,
      detailMode: cfgMode(feed.detailMode || feed.metServiceDetailMode, ["auto", "atom", "cap"], MET_SERVICE_DETAIL_MODE),
      defaultLink: cfgStr(feed.defaultLink, "https://metservice.com/warnings/home")
    });
  });

  await Promise.all(feedConfigs.map(function (feed) {
    return fetchMetServiceFeed(feed);
  }));
}

  
  //check civil defence style atom cap feeds, check areas, make alerts html, sort
async function fetchCivilDefenceStyleAlerts(options) {
  if (!options || !options.enabled || !options.atomUrl) return;

  try {
    const xmlText = await rwasFetchTextTracked(options.atomFeedKey, options.atomUrl);
    const xml = new DOMParser().parseFromString(xmlText, "application/xml");
    const ns = "http://www.w3.org/2005/Atom";
    const entries = [...xml.getElementsByTagNameNS(ns, "entry")];
    const rssItems = [...xml.getElementsByTagName("item")];

    for (const item of rssItems) {
      try {
        const title = getRwasXmlText(item, "title") || options.sourceLabel || "Civil Defence alert";
        const link = getRwasRssLink(item) || options.defaultLink || "";
        const guid = getRwasXmlText(item, "guid");
        const pubDate = getRwasXmlText(item, "pubDate");
        const effective = rwasDateToIso(pubDate);
        const descriptionText = cleanRwasAlertText(getRwasXmlText(item, "description"));
        const advisoryText = "For more information, head to the Civil Defence website.";
        const fullDescriptionText = cleanRwasAlertText(descriptionText || advisoryText);
        if (!passesRwasRssPublicationWindow(pubDate)) {
          continue;
        }

        const publishedLabel = formatRwasNZTime(effective);
        const alertHTML = `
<div class="alert-card far-north alert-red active-now">
  <b>${escapeRwasHtml(title)}</b><br>
  ${escapeRwasHtml(options.sourceLabel || "Civil Defence alert")} has published a national update${publishedLabel ? " at " + escapeRwasHtml(publishedLabel) : ""}.<br>
  ${fullDescriptionText ? escapeRwasHtml(fullDescriptionText).replace(/\n/g, "<br>") + "<br>" : ""}
  <span class="badge alert-cd">${escapeRwasHtml(options.badgeText || "Civil Defence")}</span>
  <span class="badge active-badge">Active Now</span>
</div>`;

        combinedAlertList.push({
          id: guid || link || (title + "|" + pubDate),
          title: title,
          html: alertHTML,
          status: "active-now",
          source: options.source,
          sourceGroup: "civilDefence",
          sourceLabel: options.sourceLabel,
          areas: ["National"],
          startsAt: effective || pubDate || "",
          endsAt: "",
          description: descriptionText || advisoryText,
          instruction: "",
          fullDescription: fullDescriptionText,
          event: "Civil Defence update",
          urgency: "",
          severity: "",
          cancelled: false,
          link: link,
          features: []
        });
      } catch (rssErr) {
        console.warn("Skipping " + options.sourceLabel + " RSS item due to load/parse error", rssErr);
      }
    }

    for (const entry of entries) {
      try {
      let contentXML = entry.getElementsByTagNameNS(ns, "content")[0]?.textContent || "";
      const altHref = entry.querySelector("link[rel='alternate']")?.getAttribute("href") || "";
      const atomSummary = entry.getElementsByTagNameNS(ns, "summary")[0]?.textContent || "";
      if (!contentXML && altHref) {
        contentXML = await rwasFetchTextTracked(options.capFeedKey, buildProxyRequestUrl(altHref));
      }
      if (!contentXML) continue;

      const capXML = new DOMParser().parseFromString(contentXML, "application/xml");
      const capNS = "urn:oasis:names:tc:emergency:cap:1.2";

      const getTag = (parent, tag) => parent.getElementsByTagNameNS(capNS, tag)[0]?.textContent || '';
      const info = capXML.getElementsByTagNameNS(capNS, "info")[0];
      if (!info) continue;

      const areaNodes = [...info.getElementsByTagNameNS(capNS, "area")];

      const identifier = getTag(capXML, "identifier");
      const msgType = getTag(capXML, "msgType");
      const senderName = getTag(info, "senderName");
      const headline = getTag(info, "headline");
      const effective = getTag(info, "effective");
      const expires = getTag(info, "expires");
      const urgency = getTag(info, "urgency");
      const severity = getTag(info, "severity");
      const description = getTag(info, "description");
      const instruction = getTag(info, "instruction");
      const event = getTag(info, "event");

      const now = new Date();
      const onsetTime = new Date(effective);
      const expiresTime = new Date(expires);
      let alertStatus = "";

      if (now >= onsetTime && now <= expiresTime) {
        alertStatus = "active-now";
      } else if (now < onsetTime) {
        alertStatus = "upcoming";
      } else {
        alertStatus = "expired";
      }

      const isAllowedStatus =
        alertStatus === "active-now" ||
        alertStatus === "upcoming" ||
        (alertStatus === "expired" && SHOW_EXPIRED_ALERTS);

      const withinHourWindow = passesAlertTimeWindow(effective, expires, alertStatus);

      let intersects = false;
      let matchedAreaNames = [];
      const geoCoords = [];

      areaNodes.forEach(area => {
        const polyEls = [...area.getElementsByTagNameNS(capNS, "polygon")];
        polyEls.forEach(p => {
          const coords = parseRwasCapPolygonCoordinates(p.textContent);
          if (coords.length) geoCoords.push(coords);
        });
      });

      geoCoords.forEach(coords => {
        const poly = turf.polygon([coords]);

        if (!DISABLE_FAR_NORTH_ALERTS && farNorthGeoJSON && turf.booleanIntersects(poly, farNorthGeoJSON)) {
          intersects = true;
          if (!matchedAreaNames.includes("Far North District")) {
            matchedAreaNames.push("Far North District");
          }
        }

        const activeCustomLikeAreas = customGeoAreas.concat(linzGeoAreas);
        if ((SHOW_CUSTOM_GEOJSON_ALERTS || USE_LINZ_AREAS) && activeCustomLikeAreas.length) {
          for (let i = 0; i < activeCustomLikeAreas.length; i++) {
            const custom = activeCustomLikeAreas[i];
            if (turf.booleanIntersects(poly, custom.geojson)) {
              intersects = true;
              if (!matchedAreaNames.includes(custom.name)) {
                matchedAreaNames.push(custom.name);
              }
            }
          }
        }
      });

      const isCancelled = msgType.toLowerCase() === "cancel";
      const includeByArea = shouldIncludeAlertByArea(intersects);
      const qualifies =
        includeByArea &&
        isAllowedStatus &&
        withinHourWindow &&
        (!isCancelled || (isCancelled && options.showCancelled));

      const descriptionText = cleanRwasAlertText(description || atomSummary);
      const instructionText = cleanRwasAlertText(instruction);
      const fullDescription = [descriptionText];
      if (instructionText && fullDescription.indexOf(instructionText) === -1) {
        fullDescription.push(instructionText);
      }
      const fullDescriptionText = fullDescription.join("\n\n").trim();

      matchedAreaNames.sort((a, b) => {
        const iA = AREA_DISPLAY_ORDER.indexOf(a);
        const iB = AREA_DISPLAY_ORDER.indexOf(b);
        return (iA === -1 ? 999 : iA) - (iB === -1 ? 999 : iB);
      });

      const infoLink = altHref || options.defaultLink;
      const alertHTML = `
<div class="alert-card far-north alert-red ${alertStatus}">
  <b>${headline}</b><br>
  ${senderName} has issued an alert that covers parts of ${formatAreaList(matchedAreaNames)} from ${formatRwasNZTime(effective)}
  to ${formatRwasNZTime(expires)}.<br>
  <b>Urgency:</b> ${urgency} <b>Severity:</b> ${severity}<br>
  <span class="badge alert-cd">${options.badgeText}</span>
  ${alertStatus === 'upcoming' ? `<span class="badge upcoming-badge">Upcoming</span>` : ''}
  ${alertStatus === 'active-now' ? `<span class="badge active-badge">Active Now</span>` : ''}
  ${alertStatus === 'expired' ? `<span class="badge expired-badge">Expired</span>` : ''}
${isCancelled ? `<span class="badge cancelled-badge">Cancelled</span><br>` : ''}
</div>`;

      if (qualifies) {
        const features = buildRwasAlertFeatures(geoCoords, {
          id: identifier || (headline + "|" + effective + "|" + expires),
          title: headline,
          source: options.source,
          sourceGroup: "civilDefence",
          sourceLabel: options.sourceLabel,
          status: alertStatus,
          event: event || "",
          severity: severity || "",
          cancelled: isCancelled
        });
        combinedAlertList.push({
          id: identifier || (headline + "|" + effective + "|" + expires),
          title: headline,
          html: alertHTML,
          status: alertStatus,
          source: options.source,
          sourceGroup: "civilDefence",
          sourceLabel: options.sourceLabel,
          areas: matchedAreaNames,
          startsAt: effective || "",
          endsAt: expires || "",
          description: descriptionText,
          instruction: instructionText,
          fullDescription: fullDescriptionText,
          event: event || "",
          urgency: urgency || "",
          severity: severity || "",
          cancelled: isCancelled,
          link: infoLink,
          features: features
        });
      }
      } catch (entryErr) {
        console.warn("Skipping " + options.sourceLabel + " entry due to load/parse error", entryErr);
      }
    }

    lastUpdatedTime = new Date().toISOString();
  } catch (err) {
    console.error(options.errorLabel + " fetch failed", err);
  }
}

async function fetchCDAlerts() {
  const feedConfigs = [{
    enabled: ENABLE_CD_ALERTS,
    atomUrl: CD_ALERT_ATOM_URL,
    atomFeedKey: "rwas.civil_defence.rss",
    capFeedKey: "rwas.civil_defence.cap",
    source: "cd",
    sourceLabel: "Civil Defence RSS",
    badgeText: "Civil Defence",
    showCancelled: SHOW_CANCELLED_CD_ALERTS,
    useProxy: CIVIL_DEFENCE_USE_PROXY,
    defaultLink: "https://www.civildefence.govt.nz/",
    linkLabel: "civildefence.govt.nz",
    errorLabel: "Civil Defence RSS"
  }];

  const configuredFeeds = Array.isArray(FNED_RWAS_CFG.civilDefenceFeeds)
    ? FNED_RWAS_CFG.civilDefenceFeeds
    : [];
  configuredFeeds.forEach(function (feed, index) {
    if (!feed || typeof feed !== "object") return;
    const rawUrl = cfgStr(feed.atomFeedUrl, cfgStr(feed.feedUrl, cfgStr(feed.atomUrl, cfgStr(feed.url, ""))));
    const feedUseProxy = getRwasFeedProxyFlag(feed, USE_PROXY_FOR_ALERT_FEEDS);
    const resolvedUrl = buildProxyRequestUrlWithMode(rawUrl, feedUseProxy);
    feedConfigs.push({
      enabled: cfgBool(feed.enabled, true),
      atomUrl: resolvedUrl,
      atomFeedKey: cfgStr(feed.atomFeedKey, "rwas.civil_defence.extra." + index + ".atom"),
      capFeedKey: cfgStr(feed.capFeedKey, "rwas.civil_defence.extra." + index + ".cap"),
      source: cfgStr(feed.source, "cd-extra-" + index),
      sourceLabel: cfgStr(feed.sourceLabel, cfgStr(feed.label, "Civil Defence Atom")),
      badgeText: cfgStr(feed.badgeText, "Civil Defence"),
      showCancelled: cfgBool(feed.showCancelled, SHOW_CANCELLED_CD_ALERTS),
      useProxy: feedUseProxy,
      defaultLink: cfgStr(feed.defaultLink, "https://www.civildefence.govt.nz/"),
      linkLabel: cfgStr(feed.linkLabel, "civildefence.govt.nz"),
      errorLabel: cfgStr(feed.errorLabel, "Civil Defence feed")
    });
  });

  await Promise.all(feedConfigs.map(function (feed) {
    return fetchCivilDefenceStyleAlerts(feed);
  }));
}

async function fetchEmergencyMobileAlerts() {
  const feedConfigs = [{
    enabled: ENABLE_EMERGENCY_MOBILE_ALERTS,
    atomUrl: EMA_ALERT_ATOM_URL,
    atomFeedKey: "rwas.emergency_mobile.atom",
    capFeedKey: "rwas.emergency_mobile.cap",
    source: "ema",
    sourceLabel: "Emergency Mobile alert",
    badgeText: "Emergency Mobile alert",
    showCancelled: SHOW_CANCELLED_EMA_ALERTS,
    useProxy: EMERGENCY_MOBILE_ALERT_USE_PROXY,
    defaultLink: "https://alerthub.civildefence.govt.nz/atom/pwp",
    linkLabel: "alerthub.civildefence.govt.nz",
    errorLabel: "Emergency Mobile alert"
  }];

  const configuredFeeds = Array.isArray(FNED_RWAS_CFG.emergencyMobileAlertFeeds)
    ? FNED_RWAS_CFG.emergencyMobileAlertFeeds
    : [];
  configuredFeeds.forEach(function (feed, index) {
    if (!feed || typeof feed !== "object") return;
    const rawUrl = cfgStr(feed.atomFeedUrl, cfgStr(feed.feedUrl, cfgStr(feed.atomUrl, cfgStr(feed.url, ""))));
    const feedUseProxy = getRwasFeedProxyFlag(feed, USE_PROXY_FOR_ALERT_FEEDS);
    const resolvedUrl = buildProxyRequestUrlWithMode(rawUrl, feedUseProxy);
    feedConfigs.push({
      enabled: cfgBool(feed.enabled, true),
      atomUrl: resolvedUrl,
      atomFeedKey: cfgStr(feed.atomFeedKey, "rwas.emergency_mobile.extra." + index + ".atom"),
      capFeedKey: cfgStr(feed.capFeedKey, "rwas.emergency_mobile.extra." + index + ".cap"),
      source: cfgStr(feed.source, "ema-extra-" + index),
      sourceLabel: cfgStr(feed.sourceLabel, cfgStr(feed.label, "Emergency Mobile alert")),
      badgeText: cfgStr(feed.badgeText, "Emergency Mobile alert"),
      showCancelled: cfgBool(feed.showCancelled, SHOW_CANCELLED_EMA_ALERTS),
      useProxy: feedUseProxy,
      defaultLink: cfgStr(feed.defaultLink, "https://alerthub.civildefence.govt.nz/atom/pwp"),
      linkLabel: cfgStr(feed.linkLabel, "alerthub.civildefence.govt.nz"),
      errorLabel: cfgStr(feed.errorLabel, "Emergency Mobile alert")
    });
  });

  await Promise.all(feedConfigs.map(function (feed) {
    return fetchCivilDefenceStyleAlerts(feed);
  }));
}

function applyRegionWarningAreaConfigFromRuntime() {
  const cfg = FNED_RWAS_CFG;
  RWAS_FETCH_TIMEOUT_MS = Math.max(1000, cfgNum(cfg.fetchTimeoutMs, 15000));
  RWAS_FETCH_RETRIES = Math.max(0, Math.floor(cfgNum(cfg.fetchRetries, 1)));
  RWAS_TIME_LOCALE = cfgStr(cfg.timeLocale, "en-NZ");
  RWAS_TIME_ZONE = cfgStr(cfg.timeZone, "Pacific/Auckland");
  RWAS_POPUP_CONTAINER_ID = cfgStr(cfg.containerId, cfgStr(cfg.popupContainerId, "floating-alerts-container"));
  RWAS_TOGGLE_BUTTON_ID = cfgStr(cfg.buttonId, cfgStr(cfg.toggleButtonId, "toggle-alerts-btn"));
  RWAS_POSITION = cfgStr(cfg.position, "bottom-right");
  RWAS_BUTTON_LABEL = cfgStr(cfg.buttonLabel, "!");
  RWAS_AUTO_ALERT_BUTTON_ICON = cfgBool(cfg.autoAlertButtonIcon, true);
  RWAS_WEATHER_BUTTON_LABEL = cfgStr(cfg.weatherButtonLabel, "\ud83c\udf27\ufe0f");
  RWAS_WARNING_BUTTON_LABEL = cfgStr(cfg.warningButtonLabel, "\u26a0\ufe0f");
  RWAS_BUTTON_TITLE = cfgStr(cfg.buttonTitle, "Region warnings and alerts");
  RWAS_PANEL_TITLE = cfgStr(cfg.panelTitle, "Local Warnings and Alerts");
  RWAS_EMPTY_MESSAGE = cfgStr(cfg.emptyMessage, "No current region-wide warnings detected for the configured alert area.");
  RWAS_HIDE_WHEN_EMPTY = cfgBool(cfg.hideWhenEmpty, true);
  RWAS_SHOW_EMPTY_STATE = cfgBool(cfg.showEmptyState, true);
  RWAS_AUTO_OPEN = cfgBool(cfg.autoOpen, false);
  RWAS_OPEN_ON_ALERT = cfgBool(cfg.openOnAlert, false);
  RWAS_INJECT_STYLES = cfgBool(cfg.injectStyles, true);
  RWAS_AUTO_LOAD_TURF = cfgBool(cfg.autoLoadTurf, true);
  RWAS_USE_TURF_FALLBACK = cfgBool(cfg.useTurfFallback, true);
  RWAS_TURF_URL = cfgStr(cfg.turfUrl, "https://unpkg.com/@turf/turf@6/turf.min.js");
  RWAS_AUTO_LOAD_PROJ4 = cfgBool(cfg.autoLoadProj4, true);
  RWAS_PROJ4_URL = cfgStr(cfg.proj4Url, "https://unpkg.com/proj4@2.12.1/dist/proj4.js");
  RWAS_AREA_LIST_LIMIT = Math.max(1, Math.floor(cfgNum(cfg.areaListLimit, 5)));
  RWAS_EXTENSIONS_ENABLED = cfgBool(cfg.extensionsEnabled, true);
  RWAS_PLUGIN_CONFIG = cfgObj(cfg.pluginConfig, cfgObj(cfg.plugins, {}));
  refreshRwasPluginActivation();
  if (!rwasPopupRenderedOnce && !rwasPopupUserTouched) {
    rwasPopupOpen = RWAS_AUTO_OPEN;
  }
  SHOW_EXPIRED_ALERTS = cfgBool(cfg.showExpiredAlerts, true);
  SHOW_NON_FAR_NORTH_ALERTS = cfgBool(cfg.showNonFarNorthAlerts, false);
  REQUIRE_ONSET_WITHIN_WINDOW = cfgBool(cfg.requireOnsetWithinWindow, true);
  HOUR_WINDOW = cfgNum(cfg.hourWindow, 24);
  ENABLE_MET_SERVICE_ALERTS = cfgBool(cfg.enableMetServiceAlerts, cfgBool(cfg.enableWeatherAlerts, true));
  MET_SERVICE_DETAIL_MODE = cfgMode(cfg.metServiceDetailMode, ["auto", "atom", "cap"], "auto");
  USE_PROXY_FOR_ALERT_FEEDS = cfgBool(cfg.useProxy, cfgBool(cfg.proxyEnabled, false));
  proxy = normalizeProxyPrefixRwas(cfgStr(cfg.proxy, cfgStr(RWAS_ENDPOINTS.proxyPrefix, DEFAULT_PROXY_PREFIX_RWAS)));
  metServiceSourceUrl = cfgStr(cfg.metServiceSourceUrl, cfgStr(RWAS_ENDPOINTS.metServiceSourceUrl, "https://raw.githubusercontent.com/almokinsgov/NZSHAPE/refs/heads/main/alerts/latest.xml"));
  MET_SERVICE_USE_PROXY = cfgBoolFromKeys(cfg, ["metServiceUseProxy", "useProxyForMetService", "metServiceProxyEnabled"], USE_PROXY_FOR_ALERT_FEEDS);
  METSERVICE_ATOM_URL_OVERRIDE = cfgStr(cfg.metServiceAtomUrl, "");
  feedURL = resolveRwasFeedUrl(METSERVICE_ATOM_URL_OVERRIDE, RWAS_ENDPOINTS.metServiceAtom, metServiceSourceUrl, MET_SERVICE_USE_PROXY);
  ENABLE_CD_ALERTS = cfgBool(cfg.enableCivilDefenceAlerts, true);
  CD_ALERT_FEED_URL = cfgStr(cfg.civilDefenceAtomUrl, cfgStr(RWAS_ENDPOINTS.civilDefenceSourceUrl, "https://www.civildefence.govt.nz/home/rss"));
  CIVIL_DEFENCE_USE_PROXY = cfgBoolFromKeys(cfg, ["civilDefenceUseProxy", "useProxyForCivilDefence", "civilDefenceProxyEnabled"], USE_PROXY_FOR_ALERT_FEEDS);
  CIVIL_DEFENCE_ATOM_URL_OVERRIDE = cfgStr(cfg.civilDefenceAtomFeedUrl, "");
  CD_ALERT_ATOM_URL = resolveRwasFeedUrl(CIVIL_DEFENCE_ATOM_URL_OVERRIDE, RWAS_ENDPOINTS.civilDefenceAtom, CD_ALERT_FEED_URL, CIVIL_DEFENCE_USE_PROXY);
  SHOW_CANCELLED_CD_ALERTS = cfgBool(cfg.showCancelledCivilDefenceAlerts, false);
  ENABLE_EMERGENCY_MOBILE_ALERTS = cfgBool(cfg.enableEmergencyMobileAlerts, true);
  EMERGENCY_MOBILE_ALERT_FEED_URL = cfgStr(cfg.emergencyMobileAlertAtomUrl, cfgStr(RWAS_ENDPOINTS.emergencyMobileAlertSourceUrl, "https://alerthub.civildefence.govt.nz/atom/pwp"));
  EMERGENCY_MOBILE_ALERT_USE_PROXY = cfgBoolFromKeys(cfg, ["emergencyMobileAlertUseProxy", "useProxyForEmergencyMobileAlerts", "emergencyMobileAlertProxyEnabled"], USE_PROXY_FOR_ALERT_FEEDS);
  EMERGENCY_MOBILE_ALERT_ATOM_URL_OVERRIDE = cfgStr(cfg.emergencyMobileAlertFeedUrl, "");
  EMA_ALERT_ATOM_URL = resolveRwasFeedUrl(EMERGENCY_MOBILE_ALERT_ATOM_URL_OVERRIDE, RWAS_ENDPOINTS.emergencyMobileAlertAtom, EMERGENCY_MOBILE_ALERT_FEED_URL, EMERGENCY_MOBILE_ALERT_USE_PROXY);
  SHOW_CANCELLED_EMA_ALERTS = cfgBool(cfg.showCancelledEmergencyMobileAlerts, false);
  SHOW_CUSTOM_GEOJSON_ALERTS = cfgBool(cfg.showCustomGeoJsonAlerts, false);
  USE_PROXY_FOR_CUSTOM_GEOJSON = cfgBool(cfg.useProxyForCustomGeoJson, false);
  AREA_CATALOG_ENABLED = cfgBool(cfg.areaCatalogEnabled, false);
  const nextAreaCatalogUrl = cfgStr(cfg.areaCatalogUrl, "");
  if (nextAreaCatalogUrl !== AREA_CATALOG_URL) {
    areaCatalogPromise = null;
    areaCatalogPromiseUrl = "";
  }
  AREA_CATALOG_URL = nextAreaCatalogUrl;
  SELECTED_CUSTOM_GEO_AREAS = cfgOptionalStrArray(cfg.selectedCustomGeoAreas);
  USE_LINZ_AREAS = cfgBool(cfg.useLinzAreas, false);
  LINZ_FORCE_BUNDLED_SOURCE = cfgBool(cfg.linzForceBundledSource, true);
  USE_PROXY_FOR_LINZ_AREAS = cfgBool(cfg.useProxyForLinzAreas, false);
  if (LINZ_FORCE_BUNDLED_SOURCE) {
    LINZ_SUBURB_LAYER_URL = DEFAULT_LINZ_WFS_LAYER_URL;
    LINZ_API_KEY = DEFAULT_LINZ_API_KEY;
    LINZ_API_KEY_PARAM = "api_key";
    LINZ_WFS_TYPENAME = DEFAULT_LINZ_WFS_TYPENAME;
  } else {
    LINZ_SUBURB_LAYER_URL = cfgStr(
      cfg.linzSuburbLayerUrl,
      DEFAULT_LINZ_WFS_LAYER_URL
    );
    LINZ_API_KEY = cfgStr(cfg.linzApiKey, DEFAULT_LINZ_API_KEY);
    LINZ_API_KEY_PARAM = cfgStr(cfg.linzApiKeyParam, "api_key");
    LINZ_WFS_TYPENAME = cfgStr(cfg.linzWfsTypeName, DEFAULT_LINZ_WFS_TYPENAME);
  }
  LINZ_SELECTED_AREAS = cfgStrArray(cfg.linzSelectedAreas, []);
  DISABLE_FAR_NORTH_ALERTS = cfgBool(cfg.disableFarNorthAlerts, false);
  GEOJSON_EXPIRY_HOURS = Math.max(1, cfgNum(cfg.geoJsonExpiryHours, 24));
  newGeoJSON = cfgStr(
    cfg.farNorthGeoJsonUrl,
    "https://raw.githubusercontent.com/almokinsgov/NZSHAPE/refs/heads/main/Areas/farnorth.geojson"
  );
  CustomGeoAreas = cfgObj(cfg.customGeoAreas, DEFAULT_CUSTOM_GEO_AREAS);
  AVAILABLE_CUSTOM_GEO_AREAS = Object.assign({}, CustomGeoAreas);
  ACTIVE_CUSTOM_AREA_KEYS = [];
  ALERT_SOURCE_ORDER = cfgStrArray(cfg.alertSourceOrder, DEFAULT_ALERT_SOURCE_ORDER);
  ALERT_SEVERITY_ORDER = cfgStrArray(cfg.alertSeverityOrder, DEFAULT_ALERT_SEVERITY_ORDER);
  AREA_DISPLAY_ORDER = cfgStrArray(cfg.areaDisplayOrder, DEFAULT_AREA_DISPLAY_ORDER);
}

async function runRegionWarningCycle() {
  applyRegionWarningAreaConfigFromRuntime();
  const [farNorth, customAreas, selectedLinzAreas] = await Promise.all([
    loadFarNorthGeoJSON(),
    loadCustomGeoJSONAreas(),
    loadSelectedLinzGeoAreas()
  ]);
  farNorthGeoJSON = farNorth;
  customGeoAreas = customAreas;
  linzGeoAreas = selectedLinzAreas;
  window.FNED_RWAS_RUNTIME = {
    areaCatalogEnabled: AREA_CATALOG_ENABLED,
    areaCatalogUrl: AREA_CATALOG_URL,
    availableCustomAreaNames: Object.keys(AVAILABLE_CUSTOM_GEO_AREAS),
    selectedCustomAreaNames: SELECTED_CUSTOM_GEO_AREAS === null
      ? ACTIVE_CUSTOM_AREA_KEYS.slice()
      : SELECTED_CUSTOM_GEO_AREAS.slice(),
    activeCustomAreaKeys: ACTIVE_CUSTOM_AREA_KEYS.slice(),
    loadedCustomAreaNames: customGeoAreas.map(function (item) { return item.name; }),
    useLinzAreas: USE_LINZ_AREAS,
    useProxyForLinzAreas: USE_PROXY_FOR_LINZ_AREAS,
    linzForceBundledSource: LINZ_FORCE_BUNDLED_SOURCE,
    linzApiKeyConfigured: !!LINZ_API_KEY,
    linzApiKeyParam: LINZ_API_KEY_PARAM,
    linzLayerUrl: LINZ_SUBURB_LAYER_URL,
    linzWfsTypeName: LINZ_WFS_TYPENAME,
    selectedLinzAreas: LINZ_SELECTED_AREAS.slice(),
    loadedLinzAreaNames: linzGeoAreas.map(function (item) { return item.name; }),
    configUrl: getRwasConfigFileUrl(),
    configFileLoaded: Object.keys(RWAS_FILE_CFG || {}).length > 0,
    configPrecedence: "js defaults < config file < HTML/window/script config < RWAS.setConfig",
    useProxy: USE_PROXY_FOR_ALERT_FEEDS,
    proxy: proxy,
    enableMetServiceAlerts: ENABLE_MET_SERVICE_ALERTS,
    metServiceDetailMode: MET_SERVICE_DETAIL_MODE,
    metServiceUseProxy: MET_SERVICE_USE_PROXY,
    metServiceSourceUrl: metServiceSourceUrl,
    metServiceAtomUrl: feedURL,
    autoAlertButtonIcon: RWAS_AUTO_ALERT_BUTTON_ICON,
    buttonLabel: RWAS_BUTTON_LABEL,
    weatherButtonLabel: RWAS_WEATHER_BUTTON_LABEL,
    warningButtonLabel: RWAS_WARNING_BUTTON_LABEL,
    metServiceExtraFeeds: Array.isArray(FNED_RWAS_CFG.metServiceFeeds) ? FNED_RWAS_CFG.metServiceFeeds.slice() : [],
    civilDefenceUseProxy: CIVIL_DEFENCE_USE_PROXY,
    civilDefenceSourceUrl: CD_ALERT_FEED_URL,
    civilDefenceAtomUrl: CD_ALERT_ATOM_URL,
    civilDefenceExtraFeeds: Array.isArray(FNED_RWAS_CFG.civilDefenceFeeds) ? FNED_RWAS_CFG.civilDefenceFeeds.slice() : [],
    emergencyMobileAlertUseProxy: EMERGENCY_MOBILE_ALERT_USE_PROXY,
    emergencyMobileAlertSourceUrl: EMERGENCY_MOBILE_ALERT_FEED_URL,
    emergencyMobileAlertAtomUrl: EMA_ALERT_ATOM_URL,
    emergencyMobileAlertExtraFeeds: Array.isArray(FNED_RWAS_CFG.emergencyMobileAlertFeeds) ? FNED_RWAS_CFG.emergencyMobileAlertFeeds.slice() : [],
    disableFarNorthAlerts: DISABLE_FAR_NORTH_ALERTS,
    showCustomGeoJsonAlerts: SHOW_CUSTOM_GEOJSON_ALERTS,
    areaListLimit: RWAS_AREA_LIST_LIMIT,
    alertSourceOrder: ALERT_SOURCE_ORDER.slice(),
    alertSeverityOrder: ALERT_SEVERITY_ORDER.slice(),
    areaDisplayOrder: AREA_DISPLAY_ORDER.slice(),
    autoLoadProj4: RWAS_AUTO_LOAD_PROJ4,
    proj4Url: RWAS_PROJ4_URL,
    extensionsEnabled: RWAS_EXTENSIONS_ENABLED,
    pluginConfig: JSON.parse(JSON.stringify(RWAS_PLUGIN_CONFIG || {})),
    plugins: getRwasPluginStatus()
  };
  window.RWAS_RUNTIME = window.FNED_RWAS_RUNTIME;
  window.FNED_ALERT_SCOPE_API = buildAlertScopeApi();
  window.RWAS_ALERT_SCOPE_API = window.FNED_ALERT_SCOPE_API;
  if (typeof window.dispatchEvent === "function" && typeof CustomEvent === "function") {
    window.dispatchEvent(new CustomEvent("fned:rwas-runtime-updated", {
      detail: window.FNED_RWAS_RUNTIME
    }));
    window.dispatchEvent(new CustomEvent("rwas:runtime-updated", {
      detail: window.RWAS_RUNTIME
    }));
  }
  notifyRwasPlugins("runtime-updated", window.RWAS_RUNTIME);
  combinedAlertList = [];
  await Promise.all([fetchCDAlerts(), fetchEmergencyMobileAlerts(), fetchAlerts()]);
  await collectRwasPluginAlerts();
  processRwasPluginAlerts();
  renderCombinedAlerts();
}

function rwasWhenReady(callback) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", callback, { once: true });
  } else {
    callback();
  }
}

function reloadRwasWarnings() {
  return loadRwasConfigFile()
    .then(function () {
      applyRegionWarningAreaConfigFromRuntime();
      ensureRwasPopupShell();
      return ensureRwasTurf();
    })
    .then(runRegionWarningCycle)
    .catch(function (err) {
      console.error("RWAS reload failed", err);
      renderCombinedAlerts();
    });
}

window.FNED_REGION_WARNINGS_RELOAD = reloadRwasWarnings;
window.RWAS = {
  version: version,
  config: FNED_RWAS_CFG,
  defaults: function () {
    return {
      customGeoAreas: JSON.parse(JSON.stringify(DEFAULT_CUSTOM_GEO_AREAS)),
      alertSourceOrder: DEFAULT_ALERT_SOURCE_ORDER.slice(),
      alertSeverityOrder: DEFAULT_ALERT_SEVERITY_ORDER.slice(),
      areaDisplayOrder: DEFAULT_AREA_DISPLAY_ORDER.slice(),
      selectedCustomGeoAreas: null
    };
  },
  reload: reloadRwasWarnings,
  open: function () { setRwasPopupOpen(true); },
  close: function () { setRwasPopupOpen(false); },
  toggle: function () { setRwasPopupOpen(!rwasPopupOpen); },
  getSummary: function () { return window.RWAS_ALERT_SUMMARY || null; },
  getRuntime: function () { return window.RWAS_RUNTIME || null; },
  getConfig: function () { return FNED_RWAS_CFG; },
  getConfigFile: function () { return RWAS_FILE_CFG; },
  getAlerts: getRwasAlertsForPlugins,
  getAllAlerts: function () { return getRwasAlertsForPlugins({ includeDismissed: true }); },
  getDismissedAlerts: getRwasDismissedAlertsForPlugins,
  getAlertFeatures: getRwasAlertFeaturesForPlugins,
  getAreaFeatures: getRwasAreaFeaturesForPlugins,
  registerPlugin: registerRwasPlugin,
  unregisterPlugin: unregisterRwasPlugin,
  getPlugins: getRwasPluginStatus,
  getExtensions: getRwasPluginStatus,
  on: rwasPluginOn,
  emit: rwasPluginEmit,
  createSlot: createRwasPluginSlot,
  createPanel: createRwasPluginPanel,
  setPanelOpen: setRwasPluginPanelOpen,
  refresh: function () { return refreshRwasPresentation("public-refresh"); },
  setConfig: function (nextConfig) {
    if (nextConfig && typeof nextConfig === "object" && !Array.isArray(nextConfig)) {
      Object.assign(RWAS_RUNTIME_OVERRIDE_CFG, nextConfig);
      rebuildRwasConfig();
    }
    return reloadRwasWarnings();
  },
  reloadConfigFile: function () {
    rwasConfigFilePromise = null;
    return loadRwasConfigFile();
  }
};

rwasWhenReady(function () {
  loadRwasConfigFile().then(function () {
    applyRegionWarningAreaConfigFromRuntime();
    initializeQueuedRwasPlugins();
    ensureRwasPopupShell();
    if (cfgBool(FNED_RWAS_CFG.autoStart, true)) {
      reloadRwasWarnings();
    }
  });
});

 async function loadCustomGeoJSONAreas() {
  const areas = [];
  const entries = await getEffectiveCustomGeoAreaEntries();

  for (const item of entries) {
    const key = item.name;
    const entry = item.entry;

    if (typeof entry === "string") {
      try {
        const url = USE_PROXY_FOR_CUSTOM_GEOJSON ? buildProxyRequestUrl(entry) : entry;
        const rawGeoJson = await rwasFetchJsonTracked("rwas.custom_geojson." + key, url);
        const geojson = await normalizeRwasCustomAreaGeoJson(rawGeoJson);
        if (geojson.type === "FeatureCollection") {
          areas.push({ name: key, geojson });
        }
      } catch (e) {
        console.warn(`Failed to fetch custom GeoJSON for ${key}:`, e);
      }
    } else if (entry?.type === "FeatureCollection") {
      try {
        areas.push({
          name: key,
          geojson: await normalizeRwasCustomAreaGeoJson(entry)
        });
      } catch (e) {
        console.warn(`Failed to normalize custom GeoJSON for ${key}:`, e);
      }
    }
  }

  return areas;
}

function publishRwasAlertSummary() {
  const activeItems = combinedAlertList.filter(function (alert) { return alert && !alert.dismissed; });
  const dismissedItems = combinedAlertList.filter(function (alert) { return alert && !!alert.dismissed; });
  const weatherItems = activeItems.filter(a => a && a.source === "met");
  const civilDefenceItems = activeItems.filter(a => a && (a.sourceGroup === "civilDefence" || a.source === "cd" || a.source === "ema"));
  const emergencyMobileAlertItems = activeItems.filter(a => a && a.source === "ema");
  const nztaItems = activeItems.filter(a => a && a.source === "nzta");
  const summary = {
    totalCount: activeItems.length,
    allCount: combinedAlertList.length,
    dismissedCount: dismissedItems.length,
    weatherCount: weatherItems.length,
    civilDefenceCount: civilDefenceItems.length,
    emergencyMobileAlertCount: emergencyMobileAlertItems.length,
    nztaCount: nztaItems.length,
    weatherItems: weatherItems,
    civilDefenceItems: civilDefenceItems,
    emergencyMobileAlertItems: emergencyMobileAlertItems,
    nztaItems: nztaItems,
    dismissedItems: dismissedItems,
    lastUpdatedTime: lastUpdatedTime || "",
    featureCount: getRwasAlertFeaturesForPlugins().features.length,
    notation: "Source: Region Warnings And Alert System popup."
  };
  window.FNED_RWAS_ALERT_SUMMARY = summary;
  window.RWAS_ALERT_SUMMARY = summary;
  if (typeof window.dispatchEvent === "function" && typeof CustomEvent === "function") {
    window.dispatchEvent(new CustomEvent("fned:rwas-alerts-updated", { detail: summary }));
    window.dispatchEvent(new CustomEvent("rwas:alerts-updated", { detail: summary }));
  }
  notifyRwasPlugins("alerts-updated", summary);
}

function getRwasPopupPluginSlots(panel) {
  const slots = {};
  if (!panel || !panel.querySelectorAll) return slots;
  panel.querySelectorAll("[data-rwas-slot]").forEach(function (slot) {
    const name = slot.getAttribute("data-rwas-slot");
    if (name) slots[name] = slot;
  });
  return slots;
}

function renderRwasPluginSlots(shell, context) {
  if (!RWAS_EXTENSIONS_ENABLED || !shell || !shell.panel) return;
  const detail = Object.assign({
    panel: shell.panel,
    slots: getRwasPopupPluginSlots(shell.panel),
    alerts: getRwasAlertsForPlugins(),
    allAlerts: getRwasAlertsForPlugins({ includeDismissed: true }),
    dismissedAlerts: getRwasDismissedAlertsForPlugins(),
    features: getRwasAlertFeaturesForPlugins(),
    summary: window.RWAS_ALERT_SUMMARY || null,
    runtime: window.RWAS_RUNTIME || null
  }, context || {});
  notifyRwasPlugins("render", detail);
}

function getAlertSourceHierarchyKey(alert) {
  const source = String(alert && alert.source || "").toLowerCase();
  const sourceGroup = String(alert && alert.sourceGroup || "").toLowerCase();
  if (sourceGroup === "civildefence" || source === "ema" || source.indexOf("ema") === 0 ||
      source === "cd" || source.indexOf("cd") === 0) {
    return "civildefence";
  }
  if (source === "met" || source.indexOf("metservice") === 0) return "metservice";
  if (source === "nzta" || source.indexOf("nzta") === 0) return "nzta";
  return sourceGroup || source || "other";
}

function normalizeAlertSourceHierarchyKey(value) {
  const key = String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  if (key === "cd" || key === "ema" || key === "civildefence" || key === "emergencymobilealerts") {
    return "civildefence";
  }
  if (key === "met" || key === "metservice") return "metservice";
  if (key === "nzta") return "nzta";
  return key;
}

function getAlertSourceHierarchyRank(alert) {
  const sourceKey = getAlertSourceHierarchyKey(alert);
  const order = ALERT_SOURCE_ORDER.map(normalizeAlertSourceHierarchyKey);
  const index = order.indexOf(sourceKey);
  return index >= 0 ? index : order.length + 1;
}

function getAlertSeverityHierarchyKey(alert) {
  const colourCode = String(alert && alert.colourCode || "").trim().toLowerCase();
  const severity = String(alert && alert.severity || "").trim().toLowerCase();
  const html = String(alert && alert.html || "").toLowerCase();
  if (colourCode === "red" || /^(extreme|severe|critical)$/.test(severity) || html.indexOf("alert-red") >= 0) {
    return "red";
  }
  if (colourCode === "orange" || severity === "moderate" || html.indexOf("alert-orange") >= 0) {
    return "orange";
  }
  if (colourCode === "yellow" || severity === "minor" || html.indexOf("alert-yellow") >= 0) {
    return "yellow";
  }
  return "default";
}

function getAlertSeverityHierarchyRank(alert) {
  const severityKey = getAlertSeverityHierarchyKey(alert);
  const order = ALERT_SEVERITY_ORDER.map(function (value) {
    return String(value || "").trim().toLowerCase();
  });
  const index = order.indexOf(severityKey);
  return index >= 0 ? index : order.length + 1;
}

function getAlertAreaHierarchyRank(alert) {
  const areaOrder = AREA_DISPLAY_ORDER.map(function (area) {
    return String(area || "").trim().toLocaleLowerCase(RWAS_TIME_LOCALE);
  });
  let bestRank = areaOrder.length + 1;
  (Array.isArray(alert && alert.areas) ? alert.areas : []).forEach(function (area) {
    const index = areaOrder.indexOf(String(area || "").trim().toLocaleLowerCase(RWAS_TIME_LOCALE));
    if (index >= 0 && index < bestRank) bestRank = index;
  });
  return bestRank;
}

  // Display hierarchy: Civil Defence, MetService, NZTA; then severity and configured area priority.
function renderCombinedAlerts() {
  // Modern browsers use stable Array.sort, so equal hierarchy values preserve feed order.
  combinedAlertList.sort((a, b) => {
    const sourceDifference = getAlertSourceHierarchyRank(a) - getAlertSourceHierarchyRank(b);
    if (sourceDifference) return sourceDifference;
    const severityDifference = getAlertSeverityHierarchyRank(a) - getAlertSeverityHierarchyRank(b);
    if (severityDifference) return severityDifference;
    return getAlertAreaHierarchyRank(a) - getAlertAreaHierarchyRank(b);
  });
  const activeAlertList = combinedAlertList.filter(function (alert) { return !alert.dismissed; });
  const dismissedAlertList = combinedAlertList.filter(function (alert) { return !!alert.dismissed; });

  const shell = ensureRwasPopupShell();
  if (!shell) {
    publishRwasAlertSummary();
    return;
  }

  if (combinedAlertList.length) {
    const allAreaMentions = activeAlertList.flatMap(a => a.areas || []);
    const uniqueAreas = [...new Set(allAreaMentions.filter(Boolean))];
    const areaLabel = uniqueAreas.length ? formatAreaList(uniqueAreas) : "the configured alert area";
    const hasCDAlert = activeAlertList.some(function (a) {
      const source = String(a.source || "");
      return source === "cd" || source.indexOf("cd") === 0;
    });
    const hasEmaAlert = activeAlertList.some(function (a) {
      const source = String(a.source || "");
      return source === "ema" || source.indexOf("ema") === 0;
    });
    const hasMetAlert = activeAlertList.some(a => a.source === "met");
    const hasNztaAlert = activeAlertList.some(a => a.source === "nzta");
    const sourceText = [
      hasEmaAlert ? "Emergency Mobile Alerts" : "",
      hasCDAlert ? "Civil Defence" : "",
      hasMetAlert ? "MetService" : "",
      hasNztaAlert ? "NZTA Journey Planner" : ""
    ].filter(Boolean).join(", ");
    const cardsHTML = activeAlertList
      .map(a => a.html)
      .join("\n");

    shell.panel.innerHTML = `
      <div class="rwas-popup-header">
        <div>
          <h2 class="rwas-popup-title">${escapeRwasHtml(RWAS_PANEL_TITLE)}</h2>
          <div class="rwas-popup-meta">Showing warnings and alerts for ${escapeRwasHtml(areaLabel)}.</div>
        </div>
        <button class="rwas-close-btn" type="button" aria-label="Close alerts" data-rwas-close>x</button>
      </div>
      <div class="rwas-popup-body">
        <div class="rwas-plugin-slot" data-rwas-slot="popup-before-alerts"></div>
        ${cardsHTML}
        <div class="rwas-plugin-slot" data-rwas-slot="popup-after-alerts"></div>
      </div>
      <div class="rwas-popup-footer">
        ${isLinzFilteringDegraded() ? "LINZ areas are enabled but none loaded, so filtering has fallen back to base area scope.<br>" : ""}
        Last updated: ${escapeRwasHtml(formatReadableTime(lastUpdatedTime))}.<br>
        Source: <a href="https://almokinsgov.github.io/Region-warning-and-alerts/" target="_blank" rel="noopener">Region Warnings And Alert System</a>
        v${escapeRwasHtml(version)}${sourceText ? " including " + escapeRwasHtml(sourceText) : ""}.
        <div class="rwas-plugin-slot" data-rwas-slot="popup-footer"></div>
      </div>`;
    bindRwasCloseButton(shell.panel);
    renderRwasPluginSlots(shell, {
      state: activeAlertList.length ? "alerts" : "dismissed",
      dismissedCount: dismissedAlertList.length
    });
    setRwasButtonLabel(shell.button, {
      hasCivilDefence: hasCDAlert,
      hasEmergencyMobileAlert: hasEmaAlert,
      hasNzta: hasNztaAlert,
      hasMetService: hasMetAlert
    });
    setRwasButtonVisible(shell.button, true, activeAlertList.length);
    if (activeAlertList.length && ((RWAS_OPEN_ON_ALERT && !rwasPopupUserTouched) || (RWAS_AUTO_OPEN && !rwasPopupRenderedOnce))) {
      setRwasPopupOpen(true);
    } else {
      setRwasPopupOpen(rwasPopupOpen);
    }
  } else {
    if (RWAS_SHOW_EMPTY_STATE) {
      shell.panel.innerHTML = `
        <div class="rwas-popup-header">
          <div>
            <h2 class="rwas-popup-title">${escapeRwasHtml(RWAS_PANEL_TITLE)}</h2>
            <div class="rwas-popup-meta">Configured area scope is active.</div>
          </div>
          <button class="rwas-close-btn" type="button" aria-label="Close alerts" data-rwas-close>x</button>
        </div>
        <div class="rwas-empty-state">${escapeRwasHtml(RWAS_EMPTY_MESSAGE)}</div>
        <div class="rwas-popup-footer">
          Last checked: ${escapeRwasHtml(formatReadableTime(lastUpdatedTime))}.<br>
          Source: Region Warnings And Alert System v${escapeRwasHtml(version)}.
          <div class="rwas-plugin-slot" data-rwas-slot="popup-footer"></div>
        </div>`;
      bindRwasCloseButton(shell.panel);
    } else {
      shell.panel.innerHTML = "";
    }
    renderRwasPluginSlots(shell, { state: "empty" });
    setRwasButtonLabel(shell.button, {
      hasCivilDefence: false,
      hasEmergencyMobileAlert: false,
      hasMetService: false
    });
    setRwasButtonVisible(shell.button, !RWAS_HIDE_WHEN_EMPTY, 0);
    if (RWAS_HIDE_WHEN_EMPTY) {
      setRwasPopupOpen(false);
    } else {
      setRwasPopupOpen(rwasPopupOpen);
    }
  }

  rwasPopupRenderedOnce = true;
  publishRwasAlertSummary();
}

function refreshRwasPresentation(reason) {
  processRwasPluginAlerts();
  renderCombinedAlerts();
  rwasPluginEmit("presentation-refreshed", {
    reason: reason || "refresh",
    activeCount: combinedAlertList.filter(function (alert) { return !alert.dismissed; }).length,
    dismissedCount: combinedAlertList.filter(function (alert) { return !!alert.dismissed; }).length
  });
  return Promise.resolve(window.RWAS_ALERT_SUMMARY || null);
}



  function isStillActive(onsetText, expiresText) {
  const now = new Date();
  const onset = onsetText ? new Date(onsetText) : null;
  const expires = expiresText ? new Date(expiresText) : null;

  if (expires && now > expires) return false;
  if (onset && now < onset) return true;
  if (onset && expires) return now >= onset && now <= expires;
  if (expires) return now <= expires;

  return true;
}

  
 function isWithinHourWindow(onsetText, expiresText) {
  const now = new Date();
  const onset = onsetText ? new Date(onsetText) : null;
  const expires = expiresText ? new Date(expiresText) : null;
 
  if (onset && expires) {
    const isActive = now >= onset && now <= expires;
    const startsSoon = onset > now && (onset - now) / 1000 / 3600 <= HOUR_WINDOW;
    return isActive || startsSoon;
  }

  if (onset) {
    const diffHours = (onset - now) / 1000 / 3600;
    const inWindow = diffHours >= 0 && diffHours <= HOUR_WINDOW;
    return inWindow;
  }

  return false;
}

function formatAreaList(areaArray) {
  const areas = Array.from(new Set((areaArray || []).filter(Boolean)));
  if (areas.length === 0) return "the alert region";
  const visible = areas.slice(0, RWAS_AREA_LIST_LIMIT);
  const remaining = areas.length - visible.length;
  if (remaining > 0) {
    const suffix = remaining + " other " + (remaining === 1 ? "area" : "areas");
    return visible.length === 1
      ? visible[0] + " and " + suffix
      : visible.join(", ") + ", and " + suffix;
  }
  if (visible.length === 1) return visible[0];
  if (visible.length === 2) return visible[0] + " and " + visible[1];
  return visible.slice(0, -1).join(", ") + ", and " + visible[visible.length - 1];
}

// Popup toggle binding is handled by ensureRwasPopupShell().
})(window, document);
