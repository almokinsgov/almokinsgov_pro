;(function (window, document) {
"use strict";

const PLUGIN_ID = "rwas-jsonld";
const VERSION = "0.1.0";
const DEFAULTS = {
  enabled: true,
  exposeGlobal: true,
  globalName: "RWAS_JSON_LD",
  scriptElementId: "rwas-jsonld",
  maxAlerts: 50,
  publisherName: "Region Warnings And Alert System",
  publisherUrl: "",
  includeExpired: true
};

function optionsFor(api) {
  return Object.assign({}, DEFAULTS, api && api.getOptions ? api.getOptions() : {});
}

function cleanText(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isoDate(value) {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function ensureScript(id, json) {
  let script = document.getElementById(id);
  if (!script) {
    script = document.createElement("script");
    script.id = id;
    script.type = "application/ld+json";
    script.setAttribute("data-rwas-jsonld", "true");
    document.head.appendChild(script);
  }
  script.textContent = JSON.stringify(json, null, 2);
  return script;
}

function alertToAnnouncement(alert, index) {
  const title = cleanText(alert.title || alert.event || alert.headline || "Regional warning or alert");
  const announcement = {
    "@type": "SpecialAnnouncement",
    "@id": alert.id ? String(alert.id) : window.location.href + "#rwas-alert-" + (index + 1),
    name: title,
    text: cleanText(alert.description || alert.summary || alert.instruction || ""),
    category: cleanText(alert.event || alert.sourceLabel || alert.source || ""),
    datePosted: isoDate(alert.startsAt || alert.sent || alert.effective),
    expires: isoDate(alert.endsAt || alert.expires),
    url: alert.link || undefined
  };
  const areas = Array.isArray(alert.areas) ? alert.areas.filter(Boolean) : [];
  if (areas.length) {
    announcement.spatialCoverage = areas.map(function (area) {
      return { "@type": "Place", name: area };
    });
  }
  Object.keys(announcement).forEach(function (key) {
    if (announcement[key] === undefined || announcement[key] === "") delete announcement[key];
  });
  return announcement;
}

const jsonLdPlugin = {
  id: PLUGIN_ID,
  name: "RWAS JSON-LD Output",
  version: VERSION,
  description: "Publishes current RWAS alerts as schema.org JSON-LD.",
  category: "structured-data",
  capabilities: ["json-ld", "structured-data", "agent-metadata"],
  agentMetadata: {
    purpose: "Makes current alert summaries available as schema.org SpecialAnnouncement records.",
    writes: ["application/ld+json script element", "window.RWAS_JSON_LD", "rwas:jsonld-updated"]
  },
  options: DEFAULTS,
  output: null,

  init: function (api) {
    this.publish(api);
  },

  build: function (api) {
    const options = optionsFor(api);
    const alerts = (api.getAlerts ? api.getAlerts() : [])
      .filter(function (alert) {
        return options.includeExpired || alert.status !== "expired";
      })
      .slice(0, Math.max(0, Number(options.maxAlerts) || 0));
    const output = {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: "Regional warnings and alerts",
      dateModified: new Date().toISOString(),
      numberOfItems: alerts.length,
      itemListElement: alerts.map(function (alert, index) {
        return {
          "@type": "ListItem",
          position: index + 1,
          item: alertToAnnouncement(alert, index)
        };
      })
    };
    if (options.publisherName) {
      output.publisher = {
        "@type": "Organization",
        name: options.publisherName
      };
      if (options.publisherUrl) output.publisher.url = options.publisherUrl;
    }
    return output;
  },

  publish: function (api) {
    const options = optionsFor(api);
    if (!options.enabled) return null;
    this.output = this.build(api);
    ensureScript(options.scriptElementId, this.output);
    if (options.exposeGlobal && options.globalName) {
      window[options.globalName] = this.output;
    }
    window.dispatchEvent(new CustomEvent("rwas:jsonld-updated", {
      detail: this.output
    }));
    if (api && api.setMetadata) {
      api.setMetadata({
        scriptElementId: options.scriptElementId,
        globalName: options.globalName,
        itemCount: this.output.numberOfItems,
        generatedAt: this.output.dateModified
      });
    }
    return this.output;
  },

  onRuntimeUpdated: function (runtime, api) {
    this.publish(api);
  },

  onAlertsUpdated: function (summary, api) {
    this.publish(api);
  }
};

window.RWAS_PLUGINS = window.RWAS_PLUGINS || [];
window.RWAS_PLUGINS.push(jsonLdPlugin);
})(window, document);
