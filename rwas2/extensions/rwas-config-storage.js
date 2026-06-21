;(function (window, document) {
"use strict";

const DEFAULT_STORAGE_KEY = "rwas-popup-test-config-v1";

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function normalizeConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("The imported file must contain a JSON object.");
  }
  if (value.regionWarnings && typeof value.regionWarnings === "object" && !Array.isArray(value.regionWarnings)) {
    return cloneJson(value.regionWarnings);
  }
  if (value.rwas && typeof value.rwas === "object" && !Array.isArray(value.rwas)) {
    return cloneJson(value.rwas);
  }
  return cloneJson(value);
}

function getEffectiveConfig() {
  return normalizeConfig(window.RWAS && window.RWAS.getConfig
    ? window.RWAS.getConfig()
    : (window.RWAS_CONFIG || {}));
}

function save(config, storageKey) {
  const normalized = normalizeConfig(config);
  window.localStorage.setItem(storageKey || DEFAULT_STORAGE_KEY, JSON.stringify(normalized, null, 2));
  return normalized;
}

function load(storageKey) {
  const raw = window.localStorage.getItem(storageKey || DEFAULT_STORAGE_KEY);
  if (!raw) return null;
  return normalizeConfig(JSON.parse(raw));
}

function exportConfig(config, fileName) {
  const normalized = normalizeConfig(config);
  const blob = new Blob([JSON.stringify(normalized, null, 2) + "\n"], {
    type: "application/json"
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName || "rwas-config-export.json";
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(function () {
    URL.revokeObjectURL(url);
  }, 0);
  return normalized;
}

function importFile(file) {
  if (!file) return Promise.reject(new Error("Choose a JSON file to import."));
  return file.text().then(function (text) {
    return normalizeConfig(JSON.parse(text));
  });
}

window.RWAS_CONFIG_STORAGE = {
  defaultStorageKey: DEFAULT_STORAGE_KEY,
  normalizeConfig: normalizeConfig,
  getEffectiveConfig: getEffectiveConfig,
  save: save,
  load: load,
  exportConfig: exportConfig,
  importFile: importFile
};
})(window, document);
