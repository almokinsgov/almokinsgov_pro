;(function (window, document) {
"use strict";

const PLUGIN_ID = "rwas-admin-ui";
const VERSION = "0.1.0";
const DEFAULTS = {
  enabled: true,
  renderButton: true,
  slotName: "popup-footer",
  panelTitle: "RWAS Admin",
  storageKey: "rwas-popup-test-config-v1",
  exportFileName: "rwas-config-export.json"
};

const GROUPS = [
  ["Core", ["configFileVersion", "autoStart", "fetchTimeoutMs", "fetchRetries", "timeLocale", "timeZone"]],
  ["Extensions", ["extensionsEnabled", "pluginConfig"]],
  ["Display Hierarchy", ["alertSourceOrder", "alertSeverityOrder", "areaDisplayOrder"]],
  ["Alert Dismissal", ["enableAlertDismissal", "enableMetServiceDismiss", "enableCivilDefenceDismiss", "enableEmergencyMobileAlertDismiss", "enableNztaDismiss"]],
  ["NZTA Conditions", ["enableNztaAlerts", "nztaUrl", "nztaEventTypes", "nztaUseProxy"]],
  ["MetService", ["enableMetServiceAlerts", "metServiceUseProxy", "metServiceSourceUrl", "metServiceAtomUrl", "metServiceDetailMode", "metServiceFeeds"]],
  ["Civil Defence", ["enableCivilDefenceAlerts", "civilDefenceUseProxy", "civilDefenceAtomUrl", "civilDefenceAtomFeedUrl", "civilDefenceFeeds", "showCancelledCivilDefenceAlerts"]],
  ["Emergency Mobile Alerts", ["enableEmergencyMobileAlerts", "emergencyMobileAlertUseProxy", "emergencyMobileAlertAtomUrl", "emergencyMobileAlertFeedUrl", "emergencyMobileAlertFeeds", "showCancelledEmergencyMobileAlerts"]],
  ["Proxy", ["useProxy", "proxyEnabled", "proxy"]],
  ["Time And Status", ["showExpiredAlerts", "requireOnsetWithinWindow", "hourWindow"]],
  ["Area Filters", ["disableFarNorthAlerts", "farNorthGeoJsonUrl", "geoJsonExpiryHours", "showNonFarNorthAlerts", "showCustomGeoJsonAlerts", "areaCatalogEnabled", "areaCatalogUrl", "selectedCustomGeoAreas", "customGeoAreas", "useProxyForCustomGeoJson", "areaListLimit"]],
  ["LINZ", ["useLinzAreas", "linzSelectedAreas", "useProxyForLinzAreas", "linzForceBundledSource", "linzSuburbLayerUrl", "linzApiKey", "linzApiKeyParam", "linzWfsTypeName"]],
  ["Popup UI", ["containerId", "buttonId", "position", "buttonLabel", "autoAlertButtonIcon", "weatherButtonLabel", "warningButtonLabel", "buttonTitle", "panelTitle", "emptyMessage", "autoOpen", "openOnAlert", "hideWhenEmpty", "showEmptyState", "injectStyles"]],
  ["Geospatial", ["autoLoadTurf", "turfUrl", "useTurfFallback", "autoLoadProj4", "proj4Url"]]
];

const NUMBER_KEYS = new Set([
  "configFileVersion", "fetchTimeoutMs", "fetchRetries", "hourWindow",
  "geoJsonExpiryHours", "areaListLimit"
]);
const SELECT_OPTIONS = {
  metServiceDetailMode: ["auto", "atom", "cap"],
  position: ["bottom-right", "bottom-left", "top-right", "top-left"]
};

function optionsFor(api) {
  return Object.assign({}, DEFAULTS, api && api.getOptions ? api.getOptions() : {});
}

function escapeHtml(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function labelFor(key) {
  return String(key || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, function (letter) { return letter.toUpperCase(); });
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function controlType(key, value) {
  if (SELECT_OPTIONS[key]) return "select";
  if (key === "selectedCustomGeoAreas") return "areas";
  if (NUMBER_KEYS.has(key) || typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (Array.isArray(value) || (value && typeof value === "object")) return "json";
  if (/url|proxy/i.test(key)) return "url";
  return "text";
}

function areaNames(api, config) {
  const runtime = api.getRuntime ? api.getRuntime() : null;
  const names = runtime && Array.isArray(runtime.availableCustomAreaNames)
    ? runtime.availableCustomAreaNames.slice()
    : [];
  if (config.customGeoAreas && typeof config.customGeoAreas === "object") {
    names.push.apply(names, Object.keys(config.customGeoAreas));
  }
  return Array.from(new Set(names.filter(Boolean))).sort(function (a, b) {
    return a.localeCompare(b, "en-NZ");
  });
}

function renderControl(api, key, value) {
  const type = controlType(key, value);
  const attrs = 'name="rwas-admin-' + escapeHtml(key) + '" data-rwas-admin-key="' + escapeHtml(key) +
    '" data-rwas-admin-type="' + type + '"';
  const label = escapeHtml(labelFor(key));
  if (type === "boolean") {
    return '<label class="rwas-admin-field rwas-admin-boolean"><input type="checkbox" ' + attrs +
      (value ? " checked" : "") + "><span>" + label + "</span></label>";
  }
  if (type === "select") {
    const options = SELECT_OPTIONS[key].map(function (option) {
      return '<option value="' + escapeHtml(option) + '"' + (String(value) === option ? " selected" : "") + ">" +
        escapeHtml(option) + "</option>";
    }).join("");
    return '<label class="rwas-admin-field"><span>' + label + '</span><select ' + attrs + ">" + options + "</select></label>";
  }
  if (type === "areas") {
    const config = api.getConfig ? api.getConfig() : {};
    const selected = new Set(Array.isArray(value) ? value : []);
    const names = areaNames(api, config);
    const options = names.map(function (name) {
      return '<option value="' + escapeHtml(name) + '"' + (selected.has(name) ? " selected" : "") + ">" +
        escapeHtml(name) + "</option>";
    }).join("");
    return '<label class="rwas-admin-field rwas-admin-wide"><span>' + label + '</span>' +
      '<input type="search" name="rwas-admin-area-search" data-rwas-admin-area-search placeholder="Filter areas" autocomplete="off">' +
      '<select multiple size="10" ' + attrs + ">" + options + "</select>" +
      '<small data-rwas-admin-area-count>' + selected.size + " selected / " + names.length + " available</small></label>";
  }
  if (type === "json") {
    return '<label class="rwas-admin-field"><span>' + label + '</span><textarea spellcheck="false" ' + attrs + ">" +
      escapeHtml(JSON.stringify(value, null, 2)) + "</textarea></label>";
  }
  const inputType = type === "number" ? "number" : (type === "url" ? "url" : "text");
  return '<label class="rwas-admin-field"><span>' + label + '</span><input type="' + inputType + '" value="' +
    escapeHtml(value) + '" ' + attrs + "></label>";
}

function groupedConfig(config) {
  const seen = new Set();
  const groups = GROUPS.map(function (definition) {
    const keys = definition[1].filter(function (key) {
      seen.add(key);
      return Object.prototype.hasOwnProperty.call(config, key);
    });
    return { title: definition[0], keys: keys };
  }).filter(function (group) { return group.keys.length; });
  const remaining = Object.keys(config).filter(function (key) {
    return !seen.has(key);
  }).sort();
  if (remaining.length) groups.push({ title: "Other", keys: remaining });
  return groups;
}

function injectStyles() {
  if (document.getElementById("rwas-admin-ui-styles")) return;
  const style = document.createElement("style");
  style.id = "rwas-admin-ui-styles";
  style.textContent = `
.rwas-admin-slot { display:inline-flex; margin:6px 0 0 6px; }
.rwas-admin-slot button { min-height:30px; border:1px solid #aeb6c4; border-radius:6px; background:#fff; color:#172033; cursor:pointer; font:700 12px Arial,sans-serif; padding:5px 9px; }
.rwas-plugin-panel.rwas-admin-panel { z-index:2147483500; right:1rem; bottom:1rem; width:min(960px,calc(100vw - 2rem)); max-height:calc(100vh - 2rem); padding:0; overflow:hidden; }
.rwas-admin-shell { display:grid; grid-template-rows:auto auto minmax(0,1fr); max-height:calc(100vh - 2rem); font:14px/1.45 Arial,sans-serif; }
.rwas-admin-header { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:14px 16px; border-bottom:1px solid #d7dce5; background:#172033; color:#fff; }
.rwas-admin-header h2 { margin:0; font-size:18px; letter-spacing:0; }
.rwas-admin-header button { width:34px; min-height:34px; border:1px solid rgba(255,255,255,.42); border-radius:6px; background:transparent; color:#fff; cursor:pointer; font-size:20px; }
.rwas-admin-tabs { display:flex; gap:0; border-bottom:1px solid #d7dce5; background:#f4f6f8; }
.rwas-admin-tabs button { min-height:40px; border:0; border-right:1px solid #d7dce5; background:transparent; color:#4b5563; cursor:pointer; padding:8px 16px; font-weight:700; }
.rwas-admin-tabs button[aria-selected="true"] { background:#fff; color:#991b1b; box-shadow:inset 0 -3px #b91c1c; }
.rwas-admin-view { display:none; min-height:0; overflow:auto; padding:16px; }
.rwas-admin-view[data-active="true"] { display:block; }
.rwas-admin-toolbar { position:sticky; top:-16px; z-index:2; display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin:-16px -16px 14px; padding:10px 16px; border-bottom:1px solid #d7dce5; background:#fff; }
.rwas-admin-toolbar button { min-height:34px; border:1px solid #aeb6c4; border-radius:6px; background:#fff; color:#172033; cursor:pointer; padding:6px 10px; font-weight:700; }
.rwas-admin-toolbar button[data-primary] { border-color:#7f1d1d; background:#b91c1c; color:#fff; }
.rwas-admin-status { margin-left:auto; color:#5d6678; font-size:12px; }
.rwas-admin-summary { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); border:1px solid #d7dce5; border-radius:8px; overflow:hidden; }
.rwas-admin-stat { padding:14px; border-right:1px solid #d7dce5; background:#fff; }
.rwas-admin-stat:last-child { border-right:0; }
.rwas-admin-stat strong { display:block; font-size:24px; }
.rwas-admin-stat span { color:#5d6678; font-size:12px; }
.rwas-admin-runtime { margin-top:16px; padding:12px; border-left:4px solid #15803d; background:#f0fdf4; overflow-wrap:anywhere; }
.rwas-admin-groups { display:grid; gap:10px; }
.rwas-admin-group { border:1px solid #d7dce5; border-radius:8px; background:#fff; overflow:hidden; }
.rwas-admin-group summary { cursor:pointer; padding:10px 12px; background:#f8fafc; font-weight:800; }
.rwas-admin-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; padding:12px; border-top:1px solid #d7dce5; }
.rwas-admin-field { display:grid; gap:5px; min-width:0; color:#5d6678; font-size:12px; font-weight:700; }
.rwas-admin-field input:not([type="checkbox"]),.rwas-admin-field select,.rwas-admin-field textarea { width:100%; min-width:0; border:1px solid #aeb6c4; border-radius:6px; background:#fff; color:#172033; padding:7px 8px; font:13px Arial,sans-serif; }
.rwas-admin-field textarea { min-height:118px; resize:vertical; font-family:Consolas,"Courier New",monospace; line-height:1.4; }
.rwas-admin-field select[multiple] { min-height:220px; }
.rwas-admin-field small { font-weight:400; }
.rwas-admin-boolean { grid-template-columns:auto 1fr; align-items:center; color:#172033; }
.rwas-admin-wide { grid-column:1/-1; }
.rwas-admin-extension-list { border:1px solid #d7dce5; border-radius:8px; overflow:hidden; }
.rwas-admin-extension { display:grid; grid-template-columns:minmax(180px,1.2fr) 100px 2fr; gap:12px; align-items:start; padding:12px; border-bottom:1px solid #d7dce5; background:#fff; }
.rwas-admin-extension:last-child { border-bottom:0; }
.rwas-admin-extension strong { display:block; }
.rwas-admin-extension small { color:#5d6678; }
.rwas-admin-badge { display:inline-flex; width:max-content; padding:2px 7px; border:1px solid #9ca3af; border-radius:999px; color:#4b5563; font-size:11px; font-weight:800; }
.rwas-admin-badge.active { border-color:#15803d; background:#f0fdf4; color:#166534; }
.rwas-admin-capabilities { display:flex; flex-wrap:wrap; gap:5px; }
.rwas-admin-capabilities span { padding:2px 6px; border:1px solid #bfdbfe; border-radius:4px; background:#eff6ff; color:#1e40af; font-size:11px; }
@media (max-width:720px) {
  .rwas-plugin-panel.rwas-admin-panel { inset:8px; width:auto; max-height:none; }
  .rwas-admin-shell { max-height:calc(100vh - 16px); }
  .rwas-admin-grid,.rwas-admin-summary,.rwas-admin-extension { grid-template-columns:1fr; }
  .rwas-admin-stat { border-right:0; border-bottom:1px solid #d7dce5; }
  .rwas-admin-stat:last-child { border-bottom:0; }
  .rwas-admin-status { width:100%; margin-left:0; }
}`;
  document.head.appendChild(style);
}

function panelHtml(title) {
  return '<div class="rwas-admin-shell">' +
    '<header class="rwas-admin-header"><h2>' + escapeHtml(title) + '</h2><button type="button" data-rwas-admin-close aria-label="Close">&times;</button></header>' +
    '<nav class="rwas-admin-tabs" aria-label="Admin views">' +
      '<button type="button" data-rwas-admin-tab="overview" aria-selected="true">Overview</button>' +
      '<button type="button" data-rwas-admin-tab="config" aria-selected="false">Config Lab</button>' +
      '<button type="button" data-rwas-admin-tab="extensions" aria-selected="false">Extensions</button>' +
    '</nav>' +
    '<section class="rwas-admin-view" data-rwas-admin-view="overview" data-active="true"></section>' +
    '<section class="rwas-admin-view" data-rwas-admin-view="config" data-active="false"></section>' +
    '<section class="rwas-admin-view" data-rwas-admin-view="extensions" data-active="false"></section>' +
  "</div>";
}

const adminPlugin = {
  id: PLUGIN_ID,
  name: "RWAS Admin UI",
  version: VERSION,
  description: "Provides an extension-owned admin console and complete configuration lab.",
  category: "administration",
  capabilities: ["admin-ui", "config-editor", "config-import", "config-export", "extension-inspector", "panel"],
  agentMetadata: {
    purpose: "Allows operators to inspect runtime state, configure RWAS, and inspect installed extensions."
  },
  options: DEFAULTS,
  panel: null,
  api: null,

  init: function (api) {
    this.api = api;
    this.options = optionsFor(api);
    if (!this.options.enabled) return;
    injectStyles();
    this.panel = api.createPanel("admin", {
      title: this.options.panelTitle,
      className: "rwas-admin-panel",
      html: panelHtml(this.options.panelTitle)
    });
    this.bind();
    this.refresh();
  },

  bind: function () {
    const plugin = this;
    this.panel.querySelector("[data-rwas-admin-close]").onclick = function () {
      plugin.api.setPanelOpen(plugin.panel, false);
    };
    this.panel.querySelectorAll("[data-rwas-admin-tab]").forEach(function (button) {
      button.onclick = function () {
        const target = button.getAttribute("data-rwas-admin-tab");
        plugin.panel.querySelectorAll("[data-rwas-admin-tab]").forEach(function (tab) {
          tab.setAttribute("aria-selected", tab === button ? "true" : "false");
        });
        plugin.panel.querySelectorAll("[data-rwas-admin-view]").forEach(function (view) {
          view.setAttribute("data-active", view.getAttribute("data-rwas-admin-view") === target ? "true" : "false");
        });
      };
    });
  },

  renderOverview: function () {
    const summary = this.api.getSummary ? this.api.getSummary() : null;
    const runtime = this.api.getRuntime ? this.api.getRuntime() : null;
    const extensions = window.RWAS && window.RWAS.getExtensions ? window.RWAS.getExtensions() : [];
    const loadedAreas = []
      .concat(runtime && runtime.loadedCustomAreaNames || [])
      .concat(runtime && runtime.loadedLinzAreaNames || []);
    const view = this.panel.querySelector('[data-rwas-admin-view="overview"]');
    view.innerHTML = '<div class="rwas-admin-summary">' +
      '<div class="rwas-admin-stat"><strong>' + Number(summary && summary.totalCount || 0) + '</strong><span>Alerts</span></div>' +
      '<div class="rwas-admin-stat"><strong>' + Number(summary && summary.dismissedCount || 0) + '</strong><span>Dismissed</span></div>' +
      '<div class="rwas-admin-stat"><strong>' + Number(summary && summary.featureCount || 0) + '</strong><span>Alert features</span></div>' +
      '<div class="rwas-admin-stat"><strong>' + loadedAreas.length + '</strong><span>Loaded areas</span></div>' +
      '<div class="rwas-admin-stat"><strong>' + extensions.length + '</strong><span>Extensions</span></div>' +
    '</div><div class="rwas-admin-runtime"><strong>Runtime</strong><br>' +
      escapeHtml(runtime && runtime.configPrecedence || "Waiting for RWAS runtime.") + "</div>";
  },

  renderConfig: function () {
    const config = cloneJson(this.api.getConfig ? this.api.getConfig() : {});
    const view = this.panel.querySelector('[data-rwas-admin-view="config"]');
    const groups = groupedConfig(config).map(function (group, index) {
      return '<details class="rwas-admin-group"' + (index < 2 ? " open" : "") + '><summary>' +
        escapeHtml(group.title) + '</summary><div class="rwas-admin-grid">' +
        group.keys.map(function (key) { return renderControl(adminPlugin.api, key, config[key]); }).join("") +
        "</div></details>";
    }).join("");
    view.innerHTML = '<div class="rwas-admin-toolbar">' +
      '<button type="button" data-primary data-rwas-admin-apply>Apply</button>' +
      '<button type="button" data-rwas-admin-save>Save local</button>' +
      '<button type="button" data-rwas-admin-load>Load saved</button>' +
      '<button type="button" data-rwas-admin-export>Export JSON</button>' +
      '<button type="button" data-rwas-admin-import>Import JSON</button>' +
      '<input type="file" name="rwas-admin-import-file" accept=".json,application/json" data-rwas-admin-file hidden>' +
      '<span class="rwas-admin-status" data-rwas-admin-status>Ready</span>' +
    '</div><div class="rwas-admin-groups">' + groups + "</div>";
    this.bindConfig();
  },

  readConfig: function () {
    const patch = {};
    this.panel.querySelectorAll("[data-rwas-admin-key]").forEach(function (control) {
      const key = control.getAttribute("data-rwas-admin-key");
      const type = control.getAttribute("data-rwas-admin-type");
      if (type === "boolean") patch[key] = control.checked;
      else if (type === "number") patch[key] = control.value.trim() === "" ? null : Number(control.value);
      else if (type === "json") patch[key] = control.value.trim() ? JSON.parse(control.value) : null;
      else if (type === "areas") {
        patch[key] = Array.from(control.selectedOptions).map(function (option) { return option.value; });
      } else patch[key] = control.value;
    });
    return patch;
  },

  setStatus: function (text) {
    const status = this.panel.querySelector("[data-rwas-admin-status]");
    if (status) status.textContent = text;
  },

  applyConfig: function (config, successText) {
    const plugin = this;
    this.setStatus("Applying");
    return this.api.setConfig(config).then(function () {
      plugin.setStatus(successText || "Applied");
      plugin.refresh();
    }).catch(function (error) {
      plugin.setStatus(error.message || String(error));
      throw error;
    });
  },

  bindConfig: function () {
    const plugin = this;
    const storage = window.RWAS_CONFIG_STORAGE;
    const fileInput = this.panel.querySelector("[data-rwas-admin-file]");
    this.panel.querySelector("[data-rwas-admin-apply]").onclick = function () {
      try { plugin.applyConfig(plugin.readConfig(), "Applied"); }
      catch (error) { plugin.setStatus("Invalid JSON: " + error.message); }
    };
    this.panel.querySelector("[data-rwas-admin-save]").onclick = function () {
      try {
        storage.save(plugin.readConfig(), plugin.options.storageKey);
        plugin.setStatus("Saved locally");
      } catch (error) { plugin.setStatus(error.message); }
    };
    this.panel.querySelector("[data-rwas-admin-load]").onclick = function () {
      try {
        const saved = storage.load(plugin.options.storageKey);
        if (!saved) return plugin.setStatus("No saved config");
        plugin.applyConfig(saved, "Loaded saved config");
      } catch (error) { plugin.setStatus(error.message); }
    };
    this.panel.querySelector("[data-rwas-admin-export]").onclick = function () {
      try {
        storage.exportConfig(plugin.readConfig(), plugin.options.exportFileName);
        plugin.setStatus("Exported JSON");
      } catch (error) { plugin.setStatus(error.message); }
    };
    this.panel.querySelector("[data-rwas-admin-import]").onclick = function () {
      fileInput.value = "";
      fileInput.click();
    };
    fileInput.onchange = function () {
      storage.importFile(fileInput.files[0]).then(function (config) {
        return plugin.applyConfig(config, "Imported JSON");
      }).catch(function (error) {
        plugin.setStatus(error.message);
      });
    };
    const areaSearch = this.panel.querySelector("[data-rwas-admin-area-search]");
    const areaSelect = this.panel.querySelector('[data-rwas-admin-type="areas"]');
    if (areaSearch && areaSelect) {
      areaSearch.oninput = function () {
        const query = areaSearch.value.trim().toLowerCase();
        Array.from(areaSelect.options).forEach(function (option) {
          option.hidden = !!query && option.textContent.toLowerCase().indexOf(query) === -1;
        });
      };
      areaSelect.onchange = function () {
        const count = plugin.panel.querySelector("[data-rwas-admin-area-count]");
        if (count) count.textContent = areaSelect.selectedOptions.length + " selected / " + areaSelect.options.length + " available";
      };
    }
  },

  renderExtensions: function () {
    const extensions = window.RWAS && window.RWAS.getExtensions ? window.RWAS.getExtensions() : [];
    const view = this.panel.querySelector('[data-rwas-admin-view="extensions"]');
    view.innerHTML = '<div class="rwas-admin-extension-list">' + extensions.map(function (extension) {
      const manifest = extension.manifest || {};
      const capabilities = Array.isArray(manifest.capabilities) ? manifest.capabilities : [];
      return '<div class="rwas-admin-extension">' +
        '<div><strong>' + escapeHtml(extension.name || extension.id) + '</strong><small>' + escapeHtml(extension.id) + '</small></div>' +
        '<span class="rwas-admin-badge ' + (extension.status === "active" ? "active" : "") + '">' + escapeHtml(extension.status) + '</span>' +
        '<div class="rwas-admin-capabilities">' + capabilities.map(function (capability) {
          return "<span>" + escapeHtml(capability) + "</span>";
        }).join("") + "</div>" +
      "</div>";
    }).join("") + "</div>";
  },

  refresh: function () {
    if (!this.panel) return;
    const active = document.activeElement;
    if (active && this.panel.contains(active) && active.matches("input,textarea,select")) return;
    this.options = optionsFor(this.api);
    this.renderOverview();
    this.renderConfig();
    this.renderExtensions();
  },

  onRuntimeUpdated: function () {
    this.refresh();
  },

  onAlertsUpdated: function () {
    this.renderOverview();
    this.renderExtensions();
  },

  render: function (context, api) {
    this.options = optionsFor(api);
    if (!this.options.enabled || !this.options.renderButton || !this.panel) return;
    const slot = context.slots[this.options.slotName] || context.slots["popup-footer"];
    if (!slot) return;
    let root = slot.querySelector('[data-rwas-extension="' + PLUGIN_ID + '"]');
    if (!root) {
      root = document.createElement("span");
      root.className = "rwas-admin-slot";
      root.setAttribute("data-rwas-extension", PLUGIN_ID);
      slot.appendChild(root);
    }
    root.innerHTML = '<button type="button">Admin</button>';
    root.querySelector("button").onclick = function () {
      adminPlugin.refresh();
      api.setPanelOpen(adminPlugin.panel, true);
    };
  }
};

window.RWAS_PLUGINS = window.RWAS_PLUGINS || [];
window.RWAS_PLUGINS.push(adminPlugin);
})(window, document);
