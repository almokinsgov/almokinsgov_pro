;(function (window, document) {
"use strict";

const PLUGIN_ID = "rwas-notifications";
const VERSION = "0.1.0";
const DEFAULTS = {
  enabled: true,
  alertNotifications: true,
  pluginNotifications: true,
  notifyOnLoad: true,
  notifyOn: "new-alerts",
  includeExpired: true,
  minimumSeverity: "",
  showInPage: true,
  browserNotifications: false,
  requestBrowserPermission: false,
  maxAlertsPerNotification: 3,
  toastDurationMs: 9000,
  cooldownMs: 1200,
  position: "top-right",
  title: "RWAS alerts"
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

function alertKey(alert, index) {
  return String(alert && (alert.id || alert.link || alert.title || index));
}

function severityRank(value) {
  const text = String(value || "").toLowerCase();
  if (!text) return 0;
  if (text.indexOf("minor") >= 0 || text.indexOf("yellow") >= 0) return 1;
  if (text.indexOf("moderate") >= 0 || text.indexOf("orange") >= 0) return 2;
  if (text.indexOf("severe") >= 0 || text.indexOf("red") >= 0) return 3;
  if (text.indexOf("extreme") >= 0) return 4;
  return 0;
}

function alertSeverity(alert) {
  return alert && (alert.severity || alert.colourCode || "");
}

function ensureTray(plugin) {
  if (plugin.tray && document.body.contains(plugin.tray)) return plugin.tray;
  const tray = document.createElement("div");
  tray.className = "rwas-notification-tray";
  tray.setAttribute("data-position", plugin.options.position || DEFAULTS.position);
  tray.setAttribute("aria-live", "polite");
  document.body.appendChild(tray);
  plugin.tray = tray;
  return tray;
}

function compactAlertList(alerts, maxItems) {
  const selected = alerts.slice(0, Math.max(1, maxItems || 1));
  const names = selected.map(function (alert) {
    return alert.title || "RWAS alert";
  });
  const remaining = alerts.length - selected.length;
  return names.join("; ") + (remaining > 0 ? "; +" + remaining + " more" : "");
}

function shouldIncludeAlert(alert, options) {
  if (!alert) return false;
  if (!options.includeExpired && alert.status === "expired") return false;
  const minRank = severityRank(options.minimumSeverity);
  if (minRank && severityRank(alertSeverity(alert)) < minRank) return false;
  return true;
}

const notificationPlugin = {
  id: PLUGIN_ID,
  name: "RWAS Notifications",
  version: VERSION,
  description: "Shows in-page notification toasts and optional browser notifications for RWAS alert updates and plugin notification requests.",
  category: "notification",
  capabilities: ["notification", "toast", "browser-notification", "background", "agent-metadata"],
  agentMetadata: {
    purpose: "Turns RWAS alert updates and plugin notification requests into host-page notifications.",
    reads: ["alerts", "summary", "pluginConfig.rwas-notifications"],
    writes: ["rwas-notification-tray", "Notification API when enabled"]
  },
  options: DEFAULTS,
  tray: null,
  seenAlertIds: {},
  hasProcessedInitialAlerts: false,
  lastNotificationAt: 0,
  offNotification: null,

  init: function (api) {
    this.options = getOptions(api);
    injectStyle("rwas-notification-plugin-styles", `
.rwas-notification-tray {
  position: fixed;
  z-index: 2147483100;
  display: grid;
  gap: 8px;
  width: min(360px, calc(100vw - 24px));
  pointer-events: none;
}
.rwas-notification-tray[data-position="top-right"] {
  top: 12px;
  right: 12px;
}
.rwas-notification-tray[data-position="bottom-right"] {
  right: 12px;
  bottom: 84px;
}
.rwas-notification-tray[data-position="top-left"] {
  top: 12px;
  left: 12px;
}
.rwas-notification-tray[data-position="bottom-left"] {
  left: 12px;
  bottom: 84px;
}
.rwas-notification-toast {
  pointer-events: auto;
  border: 1px solid rgba(20, 24, 34, 0.18);
  border-left: 5px solid #b91c1c;
  border-radius: 8px;
  background: #ffffff;
  color: #172033;
  box-shadow: 0 14px 36px rgba(0,0,0,0.20);
  padding: 10px 34px 10px 12px;
  position: relative;
  font-family: Arial, Helvetica, sans-serif;
}
.rwas-notification-toast strong {
  display: block;
  margin-bottom: 4px;
  font-size: 13px;
}
.rwas-notification-toast span {
  display: block;
  color: #5d6678;
  font-size: 12px;
  line-height: 1.35;
}
.rwas-notification-toast button {
  position: absolute;
  top: 7px;
  right: 7px;
  width: 24px;
  height: 24px;
  border: 1px solid #aeb6c4;
  border-radius: 6px;
  background: #ffffff;
  color: #172033;
  cursor: pointer;
  line-height: 1;
}
`);
    if (this.options.showInPage) ensureTray(this);
    if (api && api.on) {
      this.offNotification = api.on("notification", this.handlePluginNotification.bind(this, api));
    }
    if (api && api.setMetadata) {
      api.setMetadata({
        enabled: this.options.enabled,
        showInPage: this.options.showInPage,
        browserNotifications: this.options.browserNotifications,
        notifyOn: this.options.notifyOn
      });
    }
  },

  handlePluginNotification: function (api, detail) {
    this.options = getOptions(api);
    if (!this.options.enabled || !this.options.pluginNotifications) return;
    this.showNotification({
      title: detail && detail.title ? detail.title : "RWAS notification",
      body: detail && detail.body ? detail.body : "A RWAS extension requested a notification.",
      source: detail && detail.pluginId ? detail.pluginId : "plugin"
    }, api);
  },

  onAlertsUpdated: function (summary, api) {
    this.options = getOptions(api);
    if (!this.options.enabled || !this.options.alertNotifications) return;
    const now = Date.now();
    if (now - this.lastNotificationAt < this.options.cooldownMs) return;
    const alerts = (api.getAlerts ? api.getAlerts() : [])
      .filter(function (alert) {
        return shouldIncludeAlert(alert, notificationPlugin.options);
      });
    const ids = alerts.map(alertKey);
    if (!this.hasProcessedInitialAlerts && !this.options.notifyOnLoad) {
      ids.forEach(function (id) { notificationPlugin.seenAlertIds[id] = true; });
      this.hasProcessedInitialAlerts = true;
      return;
    }
    const newAlerts = alerts.filter(function (alert, index) {
      return !notificationPlugin.seenAlertIds[alertKey(alert, index)];
    });
    ids.forEach(function (id) { notificationPlugin.seenAlertIds[id] = true; });
    this.hasProcessedInitialAlerts = true;
    if (this.options.notifyOn === "new-alerts" && !newAlerts.length) return;
    if (!alerts.length) return;
    const alertSet = this.options.notifyOn === "new-alerts" ? newAlerts : alerts;
    if (!alertSet.length) return;
    this.showNotification({
      title: this.options.title,
      body: compactAlertList(alertSet, this.options.maxAlertsPerNotification),
      source: "alerts",
      count: alertSet.length
    }, api);
  },

  showNotification: function (payload, api) {
    this.lastNotificationAt = Date.now();
    const detail = {
      title: payload.title || "RWAS notification",
      body: payload.body || "",
      source: payload.source || "rwas",
      count: payload.count || 0,
      createdAt: new Date().toISOString()
    };
    if (this.options.showInPage) {
      const tray = ensureTray(this);
      tray.setAttribute("data-position", this.options.position || DEFAULTS.position);
      const toast = document.createElement("div");
      toast.className = "rwas-notification-toast";
      toast.innerHTML = "<strong>" + escapeHtml(detail.title) + "</strong>" +
        "<span>" + escapeHtml(detail.body) + "</span>" +
        '<button type="button" aria-label="Dismiss notification">x</button>';
      toast.querySelector("button").addEventListener("click", function () {
        toast.remove();
      });
      tray.appendChild(toast);
      const toastDurationMs = Math.max(1000, this.options.toastDurationMs || DEFAULTS.toastDurationMs);
      window.setTimeout(function () {
        toast.remove();
      }, toastDurationMs);
    }
    if (this.options.browserNotifications && "Notification" in window) {
      if (Notification.permission === "granted") {
        new Notification(detail.title, { body: detail.body });
      } else if (this.options.requestBrowserPermission && Notification.permission === "default") {
        Notification.requestPermission().then(function (permission) {
          if (permission === "granted") new Notification(detail.title, { body: detail.body });
        });
      }
    }
    window.dispatchEvent(new CustomEvent("rwas:notification-shown", { detail: detail }));
    if (api && api.setMetadata) {
      api.setMetadata({
        lastNotificationAt: detail.createdAt,
        lastNotificationSource: detail.source,
        lastNotificationTitle: detail.title
      });
    }
  },

  destroy: function () {
    if (typeof this.offNotification === "function") this.offNotification();
    if (this.tray) this.tray.remove();
    this.tray = null;
  }
};

window.RWAS_PLUGINS = window.RWAS_PLUGINS || [];
window.RWAS_PLUGINS.push(notificationPlugin);
})(window, document);
