;(function (window, document) {
"use strict";

const PLUGIN_ID = "rwas-agent-metadata";
const VERSION = "0.1.0";
const DEFAULTS = {
  enabled: true,
  exposeGlobal: true,
  globalName: "RWAS_AGENT_METADATA",
  scriptElementId: "rwas-agent-metadata-json",
  renderPanel: true,
  slotName: "popup-footer",
  includeRuntime: true,
  includeAlerts: true,
  includeDismissedAlerts: true,
  includeAlertHtml: false,
  includeGeoJson: true,
  includeExtensions: true,
  maxAlerts: 50,
  downloadFileName: "rwas-agent-metadata.json"
};

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

function cloneJson(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    return null;
  }
}

function summarizeAlert(alert, options) {
  const out = {
    id: alert.id || "",
    title: alert.title || "",
    source: alert.source || "",
    sourceLabel: alert.sourceLabel || "",
    sourceGroup: alert.sourceGroup || "",
    status: alert.status || "",
    startsAt: alert.startsAt || "",
    endsAt: alert.endsAt || "",
    areas: Array.isArray(alert.areas) ? alert.areas.slice() : [],
    description: alert.description || "",
    event: alert.event || "",
    urgency: alert.urgency || "",
    severity: alert.severity || alert.colourCode || "",
    cancelled: !!alert.cancelled,
    dismissed: !!alert.dismissed,
    dismissedAt: alert.dismissedAt || "",
    link: alert.link || "",
    featureCount: Array.isArray(alert.features) ? alert.features.length : 0
  };
  if (options.includeAlertHtml) out.html = alert.html || "";
  return out;
}

function featureBounds(features) {
  const bounds = {
    minLng: Infinity,
    minLat: Infinity,
    maxLng: -Infinity,
    maxLat: -Infinity
  };
  function walk(coords) {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === "number" && typeof coords[1] === "number") {
      bounds.minLng = Math.min(bounds.minLng, coords[0]);
      bounds.minLat = Math.min(bounds.minLat, coords[1]);
      bounds.maxLng = Math.max(bounds.maxLng, coords[0]);
      bounds.maxLat = Math.max(bounds.maxLat, coords[1]);
      return;
    }
    coords.forEach(walk);
  }
  (features || []).forEach(function (feature) {
    if (feature && feature.geometry) walk(feature.geometry.coordinates);
  });
  if (!Number.isFinite(bounds.minLng)) return null;
  return bounds;
}

function ensureJsonScript(id, jsonText) {
  let script = document.getElementById(id);
  if (!script) {
    script = document.createElement("script");
    script.id = id;
    script.type = "application/json";
    script.setAttribute("data-rwas-agent-metadata", "true");
    document.head.appendChild(script);
  }
  script.textContent = jsonText;
}

function ensureSlotRoot(slot) {
  if (!slot) return null;
  let root = slot.querySelector('[data-rwas-extension="' + PLUGIN_ID + '"]');
  if (!root) {
    root = document.createElement("span");
    root.className = "rwas-agent-metadata-slot";
    root.setAttribute("data-rwas-extension", PLUGIN_ID);
    slot.appendChild(root);
  }
  return root;
}

function makeDownloadHref(jsonText) {
  return "data:application/json;charset=utf-8," + encodeURIComponent(jsonText);
}

const metadataPlugin = {
  id: PLUGIN_ID,
  name: "RWAS Agent Metadata",
  version: VERSION,
  description: "Publishes structured RWAS metadata for agents, automation, and MCP tooling.",
  category: "agent-metadata",
  capabilities: ["agent-metadata", "json-export", "panel", "mcp-resource-metadata"],
  agentMetadata: {
    purpose: "Exports RWAS runtime, alert, feature, and extension state as structured JSON.",
    reads: ["runtime", "summary", "alerts", "features", "extensions"],
    writes: ["window.RWAS_AGENT_METADATA", "application/json script element", "rwas:agent-metadata-updated"]
  },
  options: DEFAULTS,
  metadata: null,
  metadataJson: "{}",
  panel: null,

  init: function (api) {
    this.options = getOptions(api);
    injectStyle("rwas-agent-metadata-plugin-styles", `
.rwas-agent-metadata-slot {
  display: inline-flex;
  margin-top: 6px;
}
.rwas-agent-metadata-slot button,
.rwas-agent-metadata-panel button,
.rwas-agent-metadata-panel a {
  min-height: 30px;
  border: 1px solid #aeb6c4;
  border-radius: 6px;
  background: #ffffff;
  color: #172033;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  padding: 5px 8px;
  text-decoration: none;
}
.rwas-agent-metadata-panel {
  display: grid;
  gap: 10px;
}
.rwas-agent-metadata-panel-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.rwas-agent-metadata-panel pre {
  max-height: 420px;
  overflow: auto;
  margin: 0;
  padding: 10px;
  border: 1px solid #d7dce5;
  border-radius: 8px;
  background: #f8fafc;
  color: #172033;
  font: 12px/1.45 Consolas, "Courier New", monospace;
  white-space: pre-wrap;
}
`);
    if (this.options.renderPanel) {
      this.panel = api.createPanel("agent-metadata", {
        title: "RWAS agent metadata",
        className: "rwas-agent-metadata-panel",
        html: this.panelHtml()
      });
      this.bindPanel(api);
    }
    this.publish(api);
  },

  panelHtml: function () {
    return '<div class="rwas-agent-metadata-panel">' +
      "<strong>Agent metadata</strong>" +
      '<div class="rwas-agent-metadata-panel-actions">' +
        '<button type="button" data-rwas-agent-copy>Copy JSON</button>' +
        '<a data-rwas-agent-download download="' + escapeHtml(this.options.downloadFileName) + '" href="#">Download JSON</a>' +
        '<button type="button" data-rwas-agent-close>Close</button>' +
      "</div>" +
      '<pre data-rwas-agent-json>{}</pre>' +
    "</div>";
  },

  bindPanel: function (api) {
    if (!this.panel) return;
    const close = this.panel.querySelector("[data-rwas-agent-close]");
    if (close) close.onclick = function () { api.setPanelOpen(metadataPlugin.panel, false); };
    const copy = this.panel.querySelector("[data-rwas-agent-copy]");
    if (copy) {
      copy.onclick = function () {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(metadataPlugin.metadataJson);
        }
      };
    }
  },

  buildMetadata: function (api) {
    const options = this.options;
    const runtime = api.getRuntime ? api.getRuntime() : null;
    const summary = api.getSummary ? api.getSummary() : null;
    const alerts = api.getAlerts ? api.getAlerts() : [];
    const dismissedAlerts = api.getDismissedAlerts ? api.getDismissedAlerts() : [];
    const features = api.getAlertFeatures ? api.getAlertFeatures() : { type: "FeatureCollection", features: [] };
    const limitedAlerts = alerts.slice(0, Math.max(0, options.maxAlerts));
    const metadata = {
      schemaVersion: "rwas-agent-metadata-v1",
      generatedAt: new Date().toISOString(),
      page: {
        href: window.location.href,
        title: document.title || ""
      },
      rwas: {
        version: api.version || "",
        summary: summary ? {
          totalCount: summary.totalCount,
          allCount: summary.allCount,
          dismissedCount: summary.dismissedCount,
          weatherCount: summary.weatherCount,
          civilDefenceCount: summary.civilDefenceCount,
          emergencyMobileAlertCount: summary.emergencyMobileAlertCount,
          featureCount: summary.featureCount,
          lastUpdatedTime: summary.lastUpdatedTime
        } : null
      },
      mcp: {
        recommendedResourceUri: "rwas://metadata",
        resources: [
          { uri: "rwas://metadata", name: "RWAS metadata", mimeType: "application/json" },
          { uri: "rwas://alerts", name: "RWAS alerts", mimeType: "application/json" },
          { uri: "rwas://features", name: "RWAS alert GeoJSON", mimeType: "application/geo+json" },
          { uri: "rwas://extensions", name: "RWAS extensions", mimeType: "application/json" }
        ]
      }
    };
    if (options.includeRuntime) metadata.runtime = cloneJson(runtime);
    if (options.includeAlerts) {
      metadata.alerts = limitedAlerts.map(function (alert) {
        return summarizeAlert(alert, options);
      });
      metadata.alertLimit = options.maxAlerts;
      metadata.alertCount = alerts.length;
    }
    if (options.includeDismissedAlerts) {
      metadata.dismissedAlerts = dismissedAlerts
        .slice(0, Math.max(0, options.maxAlerts))
        .map(function (alert) { return summarizeAlert(alert, options); });
      metadata.dismissedAlertCount = dismissedAlerts.length;
    }
    if (options.includeGeoJson) {
      metadata.features = cloneJson(features);
      metadata.featureBounds = featureBounds(features.features);
    } else {
      metadata.featureCount = features.features ? features.features.length : 0;
    }
    if (options.includeExtensions && window.RWAS && window.RWAS.getExtensions) {
      metadata.extensions = cloneJson(window.RWAS.getExtensions());
    }
    return metadata;
  },

  publish: function (api) {
    this.options = getOptions(api);
    if (!this.options.enabled) return null;
    this.metadata = this.buildMetadata(api);
    this.metadataJson = JSON.stringify(this.metadata, null, 2);
    if (this.options.exposeGlobal && this.options.globalName) {
      window[this.options.globalName] = this.metadata;
    }
    ensureJsonScript(this.options.scriptElementId, this.metadataJson);
    window.dispatchEvent(new CustomEvent("rwas:agent-metadata-updated", {
      detail: this.metadata
    }));
    if (api && api.setMetadata) {
      api.setMetadata({
        globalName: this.options.globalName,
        scriptElementId: this.options.scriptElementId,
        lastGeneratedAt: this.metadata.generatedAt,
        alertCount: this.metadata.alertCount || 0,
        featureCount: this.metadata.features && this.metadata.features.features ? this.metadata.features.features.length : 0
      });
    }
    this.updatePanel();
    return this.metadata;
  },

  updatePanel: function () {
    if (!this.panel) return;
    const pre = this.panel.querySelector("[data-rwas-agent-json]");
    if (pre) pre.textContent = this.metadataJson;
    const download = this.panel.querySelector("[data-rwas-agent-download]");
    if (download) {
      download.href = makeDownloadHref(this.metadataJson);
      download.download = this.options.downloadFileName;
    }
  },

  onRuntimeUpdated: function (runtime, api) {
    this.publish(api);
  },

  onAlertsUpdated: function (summary, api) {
    this.publish(api);
  },

  render: function (context, api) {
    this.options = getOptions(api);
    if (!this.options.enabled || !this.options.renderPanel) return;
    this.publish(api);
    const root = ensureSlotRoot(context.slots[this.options.slotName] || context.slots["popup-footer"]);
    if (!root) return;
    root.innerHTML = '<button type="button" data-rwas-agent-open>Agent metadata</button>';
    root.querySelector("button").onclick = function () {
      api.setPanelOpen(metadataPlugin.panel, true);
    };
  }
};

window.RWAS_PLUGINS = window.RWAS_PLUGINS || [];
window.RWAS_PLUGINS.push(metadataPlugin);
})(window, document);
