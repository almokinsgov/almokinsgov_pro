;(function (window, document) {
"use strict";

const PLUGIN_ID = "rwas-mcp-config";
const VERSION = "0.1.0";
const DEFAULTS = {
  enabled: true,
  exposeGlobal: true,
  globalName: "RWAS_MCP_SERVER_CONFIG",
  renderPanel: true,
  slotName: "popup-footer",
  serverName: "rwas",
  command: "node",
  serverScript: "./extensions/rwas-mcp-server.mjs",
  metadataGlobal: "RWAS_AGENT_METADATA",
  metadataFile: "./rwas-agent-metadata.json",
  metadataUrl: "",
  pageUrl: "",
  includeResources: true
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

function ensureSlotRoot(slot) {
  if (!slot) return null;
  let root = slot.querySelector('[data-rwas-extension="' + PLUGIN_ID + '"]');
  if (!root) {
    root = document.createElement("span");
    root.className = "rwas-mcp-config-slot";
    root.setAttribute("data-rwas-extension", PLUGIN_ID);
    slot.appendChild(root);
  }
  return root;
}

function cloneJson(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    return null;
  }
}

function buildServerConfig(options) {
  const env = {
    RWAS_PAGE_URL: options.pageUrl || window.location.href,
    RWAS_METADATA_GLOBAL: options.metadataGlobal,
    RWAS_METADATA_FILE: options.metadataFile
  };
  if (options.metadataUrl) env.RWAS_METADATA_URL = options.metadataUrl;
  const server = {
    command: options.command,
    args: [options.serverScript],
    env: env
  };
  const config = {};
  config[options.serverName || "rwas"] = server;
  return config;
}

function buildResources() {
  return [
    { uri: "rwas://metadata", name: "RWAS metadata", mimeType: "application/json" },
    { uri: "rwas://alerts", name: "RWAS alerts", mimeType: "application/json" },
    { uri: "rwas://features", name: "RWAS alert GeoJSON", mimeType: "application/geo+json" },
    { uri: "rwas://extensions", name: "RWAS extensions", mimeType: "application/json" }
  ];
}

const mcpConfigPlugin = {
  id: PLUGIN_ID,
  name: "RWAS MCP Config",
  version: VERSION,
  description: "Publishes MCP server configuration templates and resource metadata for RWAS agent integrations.",
  category: "mcp",
  capabilities: ["mcp-config", "agent-metadata", "json-export", "panel"],
  agentMetadata: {
    purpose: "Provides MCP server configuration and resource hints for RWAS metadata consumers.",
    reads: ["runtime", "extensions", "window.RWAS_AGENT_METADATA", "pluginConfig.rwas-mcp-config"],
    writes: ["window.RWAS_MCP_SERVER_CONFIG", "rwas:mcp-config-updated"]
  },
  options: DEFAULTS,
  panel: null,
  config: null,
  configJson: "{}",

  init: function (api) {
    this.options = getOptions(api);
    injectStyle("rwas-mcp-config-plugin-styles", `
.rwas-mcp-config-slot {
  display: inline-flex;
  margin-top: 6px;
  margin-left: 6px;
}
.rwas-mcp-config-slot button,
.rwas-mcp-config-panel button {
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
}
.rwas-mcp-config-panel {
  display: grid;
  gap: 10px;
}
.rwas-mcp-config-panel-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.rwas-mcp-config-panel p {
  margin: 0;
  color: #5d6678;
  font-size: 12px;
  line-height: 1.4;
}
.rwas-mcp-config-panel pre {
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
      this.panel = api.createPanel("mcp-config", {
        title: "RWAS MCP config",
        className: "rwas-mcp-config-panel",
        html: this.panelHtml()
      });
      this.bindPanel(api);
    }
    this.publish(api);
  },

  panelHtml: function () {
    return '<div class="rwas-mcp-config-panel">' +
      "<strong>MCP server config</strong>" +
      "<p>Use this as a template for an MCP host. The bundled stdio helper reads exported RWAS metadata from RWAS_METADATA_FILE or RWAS_METADATA_URL.</p>" +
      '<div class="rwas-mcp-config-panel-actions">' +
        '<button type="button" data-rwas-mcp-copy>Copy config</button>' +
        '<button type="button" data-rwas-mcp-close>Close</button>' +
      "</div>" +
      '<pre data-rwas-mcp-json>{}</pre>' +
    "</div>";
  },

  bindPanel: function (api) {
    if (!this.panel) return;
    const close = this.panel.querySelector("[data-rwas-mcp-close]");
    if (close) close.onclick = function () { api.setPanelOpen(mcpConfigPlugin.panel, false); };
    const copy = this.panel.querySelector("[data-rwas-mcp-copy]");
    if (copy) {
      copy.onclick = function () {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(mcpConfigPlugin.configJson);
        }
      };
    }
  },

  buildConfig: function (api) {
    const options = this.options;
    const metadata = window[options.metadataGlobal] || null;
    const runtime = api.getRuntime ? api.getRuntime() : null;
    const summary = api.getSummary ? api.getSummary() : null;
    return {
      schemaVersion: "rwas-mcp-config-v1",
      generatedAt: new Date().toISOString(),
      mcpServers: buildServerConfig(options),
      resources: options.includeResources ? buildResources() : [],
      tools: [
        { name: "rwas_get_metadata", description: "Return the current RWAS metadata JSON." },
        { name: "rwas_get_alerts", description: "Return current RWAS alert summaries." },
        { name: "rwas_get_features", description: "Return current RWAS GeoJSON alert features." },
        { name: "rwas_get_extensions", description: "Return RWAS extension metadata." }
      ],
      page: {
        href: options.pageUrl || window.location.href,
        title: document.title || ""
      },
      runtimeSummary: runtime ? {
        configFileLoaded: runtime.configFileLoaded,
        useProxy: runtime.useProxy,
        extensionsEnabled: runtime.extensionsEnabled,
        pluginCount: runtime.plugins ? runtime.plugins.length : 0
      } : null,
      alertSummary: summary ? {
        totalCount: summary.totalCount,
        allCount: summary.allCount,
        dismissedCount: summary.dismissedCount,
        featureCount: summary.featureCount,
        lastUpdatedTime: summary.lastUpdatedTime
      } : null,
      metadataAvailable: !!metadata,
      metadataPreview: metadata ? {
        generatedAt: metadata.generatedAt,
        alertCount: metadata.alertCount,
        featureCount: metadata.features && metadata.features.features ? metadata.features.features.length : metadata.featureCount
      } : null
    };
  },

  publish: function (api) {
    this.options = getOptions(api);
    if (!this.options.enabled) return null;
    this.config = this.buildConfig(api);
    this.configJson = JSON.stringify(this.config, null, 2);
    if (this.options.exposeGlobal && this.options.globalName) {
      window[this.options.globalName] = cloneJson(this.config);
    }
    window.dispatchEvent(new CustomEvent("rwas:mcp-config-updated", {
      detail: this.config
    }));
    if (api && api.setMetadata) {
      api.setMetadata({
        globalName: this.options.globalName,
        serverName: this.options.serverName,
        serverScript: this.options.serverScript,
        metadataFile: this.options.metadataFile,
        metadataUrl: this.options.metadataUrl,
        lastGeneratedAt: this.config.generatedAt
      });
    }
    this.updatePanel();
    return this.config;
  },

  updatePanel: function () {
    if (!this.panel) return;
    const pre = this.panel.querySelector("[data-rwas-mcp-json]");
    if (pre) pre.textContent = this.configJson;
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
    root.innerHTML = '<button type="button" data-rwas-mcp-open>MCP config</button>';
    root.querySelector("button").onclick = function () {
      api.setPanelOpen(mcpConfigPlugin.panel, true);
    };
  }
};

window.RWAS_PLUGINS = window.RWAS_PLUGINS || [];
window.RWAS_PLUGINS.push(mcpConfigPlugin);
})(window, document);
