;(function (window, document) {
"use strict";

const PLUGIN_ID = "rwas-alert-dismissal";
const VERSION = "0.1.0";
const DEFAULTS = {
  enabled: true,
  persist: true,
  storageKey: "rwas-dismissed-alerts-v1",
  retentionDays: 30,
  sectionLabel: "Dismissed alerts and warnings",
  openByDefault: false,
  dismissLabel: "Dismiss",
  restoreLabel: "Restore",
  restoreAllLabel: "Restore all",
  showRestoreAll: true,
  metServiceEnabled: false,
  civilDefenceEnabled: false,
  emergencyMobileAlertEnabled: false,
  nztaEnabled: true
};

let memoryStore = {};

function mergeDefined(base, next) {
  const out = Object.assign({}, base || {});
  Object.keys(next || {}).forEach(function (key) {
    if (next[key] !== undefined) out[key] = next[key];
  });
  return out;
}

function optionsFor(api) {
  const config = api && api.getConfig ? api.getConfig() : {};
  const aliases = {};
  if (typeof config.enableAlertDismissal === "boolean") aliases.enabled = config.enableAlertDismissal;
  if (typeof config.enableMetServiceDismiss === "boolean") aliases.metServiceEnabled = config.enableMetServiceDismiss;
  if (typeof config.enableCivilDefenceDismiss === "boolean") aliases.civilDefenceEnabled = config.enableCivilDefenceDismiss;
  if (typeof config.enableEmergencyMobileAlertDismiss === "boolean") {
    aliases.emergencyMobileAlertEnabled = config.enableEmergencyMobileAlertDismiss;
  }
  if (typeof config.enableNztaDismiss === "boolean") aliases.nztaEnabled = config.enableNztaDismiss;
  return mergeDefined(mergeDefined(DEFAULTS, api && api.getOptions ? api.getOptions() : {}), aliases);
}

function escapeHtml(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function feedFamily(alert) {
  const source = String(alert && alert.source || "").toLowerCase();
  const sourceGroup = String(alert && alert.sourceGroup || "").toLowerCase();
  if (source === "ema" || source.indexOf("ema") === 0) return "emergencyMobileAlert";
  if (sourceGroup === "civildefence" || source === "cd" || source.indexOf("cd") === 0) return "civilDefence";
  if (source === "met" || source.indexOf("metservice") === 0) return "metService";
  if (source === "nzta" || source.indexOf("nzta") === 0) return "nzta";
  return "other";
}

function familyEnabled(family, options) {
  if (family === "metService") return !!options.metServiceEnabled;
  if (family === "civilDefence") return !!options.civilDefenceEnabled;
  if (family === "emergencyMobileAlert") return !!options.emergencyMobileAlertEnabled;
  if (family === "nzta") return !!options.nztaEnabled;
  return false;
}

function alertIdentity(alert, index) {
  const identity = alert && (alert.id || alert.link ||
    [alert.title, alert.startsAt, alert.endsAt, alert.sourceLabel].filter(Boolean).join("|"));
  return String(identity || ("alert-" + index));
}

function dismissalKey(alert, index) {
  return feedFamily(alert) + "::" + alertIdentity(alert, index);
}

function readStore(options) {
  let store = {};
  if (options.persist) {
    try {
      store = JSON.parse(window.localStorage.getItem(options.storageKey) || "{}");
    } catch (error) {
      store = {};
    }
  } else {
    store = Object.assign({}, memoryStore);
  }
  if (!store || typeof store !== "object" || Array.isArray(store)) store = {};
  const retentionMs = Math.max(0, Number(options.retentionDays) || 0) * 86400000;
  if (retentionMs) {
    const cutoff = Date.now() - retentionMs;
    Object.keys(store).forEach(function (key) {
      const dismissedAt = new Date(store[key] && store[key].dismissedAt || 0).getTime();
      if (!dismissedAt || dismissedAt < cutoff) delete store[key];
    });
  }
  return store;
}

function writeStore(store, options) {
  if (options.persist) {
    try {
      window.localStorage.setItem(options.storageKey, JSON.stringify(store || {}));
    } catch (error) {
      console.warn("RWAS dismissal state could not be saved.", error);
    }
  } else {
    memoryStore = Object.assign({}, store || {});
  }
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

function injectStyles() {
  if (document.getElementById("rwas-alert-dismissal-styles")) return;
  const style = document.createElement("style");
  style.id = "rwas-alert-dismissal-styles";
  style.textContent = `
.rwas-dismiss-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 9px;
  padding-top: 8px;
  border-top: 1px solid rgba(24, 34, 48, 0.14);
}
.rwas-dismiss-actions button,
.rwas-dismissed-header button {
  min-height: 30px;
  border: 1px solid #aeb6c4;
  border-radius: 6px;
  background: #ffffff;
  color: #172033;
  cursor: pointer;
  font: 700 12px Arial, sans-serif;
  padding: 5px 9px;
}
.rwas-dismiss-actions button:hover,
.rwas-dismiss-actions button:focus-visible,
.rwas-dismissed-header button:hover,
.rwas-dismissed-header button:focus-visible {
  border-color: #7f1d1d;
  outline: 2px solid rgba(185, 28, 28, 0.2);
  outline-offset: 1px;
}
.rwas-dismissed-section {
  margin-top: 10px;
  border: 1px solid #cdd5e0;
  border-radius: 8px;
  background: #f8fafc;
  overflow: hidden;
}
.rwas-dismissed-section > summary {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 42px;
  padding: 9px 11px;
  cursor: pointer;
  color: #172033;
  font-weight: 800;
  list-style: none;
}
.rwas-dismissed-section > summary::-webkit-details-marker {
  display: none;
}
.rwas-dismissed-section > summary::before {
  content: "";
  width: 8px;
  height: 8px;
  border-right: 2px solid currentColor;
  border-bottom: 2px solid currentColor;
  transform: rotate(-45deg);
  transition: transform 120ms ease;
}
.rwas-dismissed-section[open] > summary::before {
  transform: rotate(45deg);
}
.rwas-dismissed-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 24px;
  min-height: 22px;
  margin-left: auto;
  border-radius: 999px;
  background: #e2e8f0;
  color: #334155;
  font-size: 11px;
}
.rwas-dismissed-header {
  display: flex;
  justify-content: flex-end;
  padding: 0 10px 8px;
}
.rwas-dismissed-list {
  display: grid;
  gap: 8px;
  padding: 0 8px 8px;
}
.rwas-dismissed-list > .alert-card {
  margin: 0;
  opacity: 0.86;
}
`;
  document.head.appendChild(style);
}

function actionHtml(action, key, label) {
  return '<div class="rwas-dismiss-actions"><button type="button" data-rwas-dismiss-action="' +
    escapeHtml(action) + '" data-rwas-dismiss-key="' + escapeHtml(key) + '">' +
    escapeHtml(label) + "</button></div>";
}

const dismissalPlugin = {
  id: PLUGIN_ID,
  name: "RWAS Alert Dismissal",
  version: VERSION,
  description: "Allows configured feed alerts to be dismissed, persisted, and restored from a collapsed archive.",
  category: "alert-management",
  capabilities: ["alert-processing", "dismiss", "restore", "local-storage", "popup-slot", "agent-metadata"],
  agentMetadata: {
    purpose: "Partitions configured feed alerts into active and dismissed presentation states.",
    reads: ["alerts", "pluginConfig.rwas-alert-dismissal", "localStorage"],
    writes: ["alert.dismissed", "popup-after-alerts", "rwas:alert-dismissed", "rwas:alert-restored"]
  },
  options: DEFAULTS,
  api: null,
  store: {},

  init: function (api) {
    this.api = api;
    this.options = optionsFor(api);
    this.store = readStore(this.options);
    writeStore(this.store, this.options);
    injectStyles();
    window.RWAS_DISMISSAL = {
      dismiss: this.dismiss.bind(this),
      restore: this.restore.bind(this),
      restoreAll: this.restoreAll.bind(this),
      getDismissed: function () {
        return api.getDismissedAlerts ? api.getDismissedAlerts() : [];
      }
    };
  },

  processAlerts: function (alerts, api) {
    this.options = optionsFor(api);
    this.store = readStore(this.options);
    (alerts || []).forEach(function (alert, index) {
      const family = feedFamily(alert);
      const key = dismissalKey(alert, index);
      const dismissible = this.options.enabled && familyEnabled(family, this.options);
      alert.rwasDismissalKey = key;
      alert.rwasDismissalFamily = family;
      alert.dismissible = dismissible;
      alert.dismissed = !!(dismissible && this.store[key]);
      alert.dismissedAt = alert.dismissed ? this.store[key].dismissedAt || "" : "";
    }, this);
    if (api && api.setMetadata) {
      api.setMetadata({
        enabled: !!this.options.enabled,
        persistent: !!this.options.persist,
        storageKey: this.options.storageKey,
        dismissedCount: (alerts || []).filter(function (alert) { return !!alert.dismissed; }).length,
        feedDismissEnabled: {
          metService: !!this.options.metServiceEnabled,
          civilDefence: !!this.options.civilDefenceEnabled,
          emergencyMobileAlert: !!this.options.emergencyMobileAlertEnabled,
          nzta: !!this.options.nztaEnabled
        }
      });
    }
    return alerts;
  },

  dismiss: function (key) {
    const alert = this.findAlert(key);
    if (!alert || !alert.dismissible) return Promise.resolve(false);
    this.store = readStore(this.options);
    this.store[key] = {
      dismissedAt: new Date().toISOString(),
      title: alert.title || "",
      source: alert.source || "",
      sourceLabel: alert.sourceLabel || ""
    };
    writeStore(this.store, this.options);
    window.dispatchEvent(new CustomEvent("rwas:alert-dismissed", {
      detail: { key: key, alert: Object.assign({}, alert) }
    }));
    return this.api.refresh().then(function () { return true; });
  },

  restore: function (key) {
    this.store = readStore(this.options);
    if (!this.store[key]) return Promise.resolve(false);
    delete this.store[key];
    writeStore(this.store, this.options);
    window.dispatchEvent(new CustomEvent("rwas:alert-restored", {
      detail: { key: key }
    }));
    return this.api.refresh().then(function () { return true; });
  },

  restoreAll: function () {
    const dismissed = this.api.getDismissedAlerts ? this.api.getDismissedAlerts() : [];
    this.store = readStore(this.options);
    dismissed.forEach(function (alert) {
      if (alert.rwasDismissalKey) delete dismissalPlugin.store[alert.rwasDismissalKey];
    });
    writeStore(this.store, this.options);
    window.dispatchEvent(new CustomEvent("rwas:alerts-restored", {
      detail: { count: dismissed.length }
    }));
    return this.api.refresh().then(function () { return dismissed.length; });
  },

  findAlert: function (key) {
    const alerts = this.api && this.api.getAllAlerts ? this.api.getAllAlerts() : [];
    return alerts.find(function (alert) { return alert.rwasDismissalKey === key; }) || null;
  },

  bindActions: function (root) {
    if (!root) return;
    root.querySelectorAll("[data-rwas-dismiss-action]").forEach(function (button) {
      button.addEventListener("click", function () {
        const action = button.getAttribute("data-rwas-dismiss-action");
        const key = button.getAttribute("data-rwas-dismiss-key");
        button.disabled = true;
        const operation = action === "restore"
          ? dismissalPlugin.restore(key)
          : dismissalPlugin.dismiss(key);
        Promise.resolve(operation).catch(function (error) {
          button.disabled = false;
          console.warn("RWAS dismissal action failed.", error);
        });
      });
    });
    const restoreAll = root.querySelector("[data-rwas-restore-all]");
    if (restoreAll) {
      restoreAll.addEventListener("click", function () {
        restoreAll.disabled = true;
        dismissalPlugin.restoreAll().catch(function (error) {
          restoreAll.disabled = false;
          console.warn("RWAS restore-all action failed.", error);
        });
      });
    }
  },

  render: function (context, api) {
    this.options = optionsFor(api);
    const activeAlerts = context && Array.isArray(context.alerts) ? context.alerts : [];
    const dismissedAlerts = context && Array.isArray(context.dismissedAlerts) ? context.dismissedAlerts : [];
    const activeCards = context && context.panel
      ? Array.from(context.panel.querySelectorAll(".rwas-popup-body > .alert-card"))
      : [];

    activeAlerts.forEach(function (alert, index) {
      const card = activeCards[index];
      if (!card || !alert.rwasDismissalKey) return;
      card.setAttribute("data-rwas-alert-key", alert.rwasDismissalKey);
      if (!this.options.enabled || !alert.dismissible) return;
      card.insertAdjacentHTML("beforeend",
        actionHtml("dismiss", alert.rwasDismissalKey, this.options.dismissLabel));
      this.bindActions(card);
    }, this);

    const slot = context && context.slots
      ? context.slots["popup-after-alerts"]
      : null;
    const root = ensureSlotRoot(slot);
    if (!root) return;
    if (!this.options.enabled || !dismissedAlerts.length) {
      root.innerHTML = "";
      return;
    }
    const cardsHtml = dismissedAlerts.map(function (alert) {
      return String(alert.html || "").replace(
        /class="alert-card/,
        'data-rwas-alert-key="' + escapeHtml(alert.rwasDismissalKey) + '" class="alert-card'
      ).replace(
        /<\/div>\s*$/,
        actionHtml("restore", alert.rwasDismissalKey, dismissalPlugin.options.restoreLabel) + "</div>"
      );
    }).join("");
    root.innerHTML =
      '<details class="rwas-dismissed-section"' + (this.options.openByDefault ? " open" : "") + ">" +
        "<summary><span>" + escapeHtml(this.options.sectionLabel) + '</span><span class="rwas-dismissed-count">' +
          dismissedAlerts.length + "</span></summary>" +
        (this.options.showRestoreAll
          ? '<div class="rwas-dismissed-header"><button type="button" data-rwas-restore-all>' +
            escapeHtml(this.options.restoreAllLabel) + "</button></div>"
          : "") +
        '<div class="rwas-dismissed-list">' + cardsHtml + "</div>" +
      "</details>";
    this.bindActions(root);
  },

  destroy: function () {
    delete window.RWAS_DISMISSAL;
    document.querySelectorAll('[data-rwas-extension="' + PLUGIN_ID + '"]').forEach(function (root) {
      root.remove();
    });
    document.querySelectorAll(".rwas-dismiss-actions").forEach(function (actions) {
      actions.remove();
    });
  }
};

window.RWAS_PLUGINS = window.RWAS_PLUGINS || [];
window.RWAS_PLUGINS.push(dismissalPlugin);
})(window, document);
