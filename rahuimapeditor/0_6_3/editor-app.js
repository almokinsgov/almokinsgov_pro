import { APP_VERSION, exportSettings, loadSettings, saveSettings } from './config.js';
import { createStorage, normalizePublicConfig, seedLocalStorageIfEmpty } from './storage.js';
import { createBlankRahui, createRahuiId, geometryFromFeatureCollection, geometryToFeatureCollection, getComputedStatus, normalizeRahui, toGeoJsonFeature, validateRahui } from './model.js';
import { addRahuiLegend, bindPolygonLabel, createBaseMap, dateSummary, escapeHtml, fitGeometry, formatDate, safeHref, styleForRahui } from './map.js';
import { getLocationSources, queryReferenceLayer, searchLocationLookups, toLocationReference } from './location-lookup.js';

let settings = loadSettings();
await seedLocalStorageIfEmpty('../data/rahui.sample.json');
let storage = createStorage(settings, { editor: true });
let records = [];
let current = createBlankRahui({ id: createRahuiId(), createdBy: settings.editorName, updatedBy: settings.editorName });
let dirty = false;
let saving = false;
let map;
let drawnItems;
let lookupLayer;
let drawControl;
let editorMode = 'guided';
let currentStep = 'what';
let lookupResults = [];
const referenceLayers = new Map();
let referenceLayerRefreshTimer = null;
const STEPS = ['what', 'when', 'where'];

const ids = [
  'editorSearch','editorStatusFilter','editorPublishedFilter','editorList','editorMapMessage','editorFormPanel','formHeading','rahuiForm','rahuiId',
  'title','summary','description','locationText','type','basis','legalBasis','reason','authority','iwiHapu','marae','contactName','contactDetails',
  'notifiedDate','startDate','endDate','reviewDate','liftedDate','statusOverride','restrictions','exceptions','sourceLinks','published','archived',
  'internalNotes','debugField','debugOutput','unsavedIndicator','newRahui','openImport','exportWorkspace','openSettings','saveRahui','fitPolygon',
  'exportGeoJson','duplicateRahui','archiveRahui','settingsModal','importModal','storageMode','gasWebAppUrl','writeToken','editorName','tileUrl',
  'tileAttribution','mapCenterLat','mapCenterLng','mapZoom','publicRecentDays','showDebug','testBackend','saveSettings','importFile','runImport','toastStack',
  'editorModeGuided','editorModeFull','stepNav','guidedNavigation','previousStep','nextStep','locationLookupSearch','runLocationLookup','locationLookupSources',
  'locationLookupResults','locationReferences','locationLookupCard','locationLookupEnabled','locationLookupFarNorthOnly','locationLookupLimit',
  'dateOverview','dateStatusPreview','copyRahuiId','recordVersion','recordSyncState','busyOverlay','busyTitle','busyMessage','polygonLabelField','polygonLabelMode',
  'editorReferenceLayers','editorLayerCount','editorLayerStatus'
];
const els = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));

init();

async function init() {
  map = createBaseMap('editorMap', settings);
  setupDrawTools();
  setupLookupLayer();
  setupReferenceLayers();
  addRahuiLegend(map, { position: 'bottomleft', collapsed: true });
  bindEvents();
  loadSettingsForm();
  applyLookupSettingState();
  setEditorMode('guided');
  setStep('what');
  setBusy(true, 'Loading rāhui', 'Syncing records from the configured storage.');
  try {
    await reloadRecords();
    newRecord();
  } finally {
    setBusy(false);
  }
  loadSharedPublicConfig().then(() => {
    loadSettingsForm();
    refreshEditorPolygonLabels();
  });
}

function setupDrawTools() {
  drawnItems = new L.FeatureGroup().addTo(map);
  drawControl = new L.Control.Draw({
    position: 'topleft',
    draw: {
      polygon: { allowIntersection: false, showArea: true },
      polyline: false,
      rectangle: false,
      circle: false,
      circlemarker: false,
      marker: false
    },
    edit: { featureGroup: drawnItems, edit: true, remove: true }
  });
  map.addControl(drawControl);
  map.on(L.Draw.Event.CREATED, event => { drawnItems.addLayer(event.layer); geometryChanged(); });
  map.on(L.Draw.Event.EDITED, geometryChanged);
  map.on(L.Draw.Event.DELETED, geometryChanged);
}

function setupLookupLayer() {
  lookupLayer = new L.FeatureGroup().addTo(map);
}

function setupReferenceLayers() {
  const sources = getLocationSources();
  if (!map.getPane('referenceAreasPane')) {
    map.createPane('referenceAreasPane').style.zIndex = '320';
    map.createPane('referenceLinesPane').style.zIndex = '335';
    map.createPane('referencePointsPane').style.zIndex = '350';
  }
  const enabled = new Set(Array.isArray(settings.editorReferenceLayers) ? settings.editorReferenceLayers : []);
  els.editorReferenceLayers?.querySelectorAll('[data-reference-layer]').forEach(input => {
    const key = input.value;
    const source = sources[key];
    if (!source) return;
    const group = L.layerGroup();
    referenceLayers.set(key, { key, source, group, requestId: 0, truncated: false });
    input.checked = enabled.has(key);
    if (input.checked) group.addTo(map);
  });
  updateReferenceLayerSummary();
  scheduleReferenceLayerRefresh(20);
}

function scheduleReferenceLayerRefresh(delay = 180) {
  clearTimeout(referenceLayerRefreshTimer);
  referenceLayerRefreshTimer = setTimeout(refreshReferenceLayers, delay);
}

async function refreshReferenceLayers() {
  if (!referenceLayers.size) return;
  const zoom = map.getZoom();
  const active = [...referenceLayers.values()].filter(entry => map.hasLayer(entry.group));
  updateReferenceLayerSummary();
  if (!active.length) {
    if (els.editorLayerStatus) els.editorLayerStatus.textContent = 'Choose a layer to show it on the map.';
    return;
  }
  const status = [];
  for (const entry of active) {
    if (zoom < entry.source.minZoom) {
      entry.group.clearLayers();
      status.push(`${entry.source.shortLabel}: zoom to ${entry.source.minZoom}+`);
      continue;
    }
    const requestId = ++entry.requestId;
    status.push(`${entry.source.shortLabel}: loading`);
    renderReferenceLayerStatus(status);
    try {
      const data = await queryReferenceLayer(entry.key, map.getBounds(), { farNorthOnly: settings.locationLookupFarNorthOnly, limit: entry.key === 'gazetteer' ? 900 : 600 });
      if (requestId !== entry.requestId || !map.hasLayer(entry.group)) continue;
      renderReferenceLayer(entry, data);
      entry.truncated = Boolean(data.truncated);
      const count = data.features?.length || 0;
      const index = status.findIndex(value => value.startsWith(`${entry.source.shortLabel}:`));
      if (index >= 0) status[index] = `${entry.source.shortLabel}: ${count}${entry.truncated ? '+' : ''}`;
      renderReferenceLayerStatus(status);
    } catch (error) {
      if (requestId !== entry.requestId) continue;
      entry.group.clearLayers();
      const index = status.findIndex(value => value.startsWith(`${entry.source.shortLabel}:`));
      if (index >= 0) status[index] = `${entry.source.shortLabel}: unavailable`;
      renderReferenceLayerStatus(status);
    }
  }
}

function renderReferenceLayer(entry, data) {
  entry.group.clearLayers();
  const layer = L.geoJSON(data, {
    pane: referencePane(entry.key),
    style: () => referenceLayerStyle(entry.key),
    pointToLayer: (feature, latlng) => L.circleMarker(latlng, referencePointStyle(entry.key)),
    onEachFeature: (feature, featureLayer) => {
      const p = feature.properties || {};
      const name = p.name || p.major_name || p.name_ascii || 'Unnamed feature';
      const type = p.type || p.feat_type || '';
      featureLayer.bindTooltip(`${escapeHtml(name)}${type ? `<br><small>${escapeHtml(type)}</small>` : ''}`, { sticky: true, className: 'editor-reference-tooltip' });
    }
  });
  entry.group.addLayer(layer);
}

function referencePane(key) {
  if (key === 'gazetteer') return 'referencePointsPane';
  if (key === 'riverLines') return 'referenceLinesPane';
  return 'referenceAreasPane';
}

function referenceLayerStyle(key) {
  if (key === 'localities') return { color: '#557c6d', weight: 1.6, opacity: 0.9, fillColor: '#85b29f', fillOpacity: 0.06, dashArray: '5 4', pane: 'referenceAreasPane' };
  if (key === 'riverLines') return { color: '#2779a7', weight: 2.2, opacity: 0.82, fillOpacity: 0, pane: 'referenceLinesPane' };
  if (key === 'riverPolygons') return { color: '#388aad', weight: 1.3, opacity: 0.75, fillColor: '#61a9c6', fillOpacity: 0.13, pane: 'referenceAreasPane' };
  return { color: '#47675c', weight: 1, opacity: 0.8, fillOpacity: 0, pane: 'referencePointsPane' };
}

function referencePointStyle(key) {
  return { radius: key === 'gazetteer' ? 4 : 3, color: '#315f50', weight: 1.4, fillColor: '#ffffff', fillOpacity: 0.96, pane: 'referencePointsPane' };
}

function handleReferenceLayerChange(event) {
  const input = event.target.closest('[data-reference-layer]');
  if (!input) return;
  const entry = referenceLayers.get(input.value);
  if (!entry) return;
  if (input.checked) entry.group.addTo(map);
  else {
    map.removeLayer(entry.group);
    entry.group.clearLayers();
    entry.requestId += 1;
  }
  const enabled = [...els.editorReferenceLayers.querySelectorAll('[data-reference-layer]:checked')].map(box => box.value);
  settings = saveSettings({ ...settings, editorReferenceLayers: enabled });
  updateReferenceLayerSummary();
  scheduleReferenceLayerRefresh(20);
}

function updateReferenceLayerSummary() {
  if (!els.editorLayerCount) return;
  const count = [...els.editorReferenceLayers.querySelectorAll('[data-reference-layer]:checked')].length;
  els.editorLayerCount.textContent = `${count} on`;
}

function renderReferenceLayerStatus(parts) {
  if (els.editorLayerStatus) els.editorLayerStatus.textContent = parts.filter(Boolean).join(' · ');
}

function bindEvents() {
  els.editorSearch.addEventListener('input', renderList);
  els.editorStatusFilter.addEventListener('change', renderList);
  els.editorPublishedFilter.addEventListener('change', renderList);
  els.editorReferenceLayers?.addEventListener('change', handleReferenceLayerChange);
  map.on('moveend', () => scheduleReferenceLayerRefresh());
  els.newRahui.addEventListener('click', newRecord);
  els.copyRahuiId.addEventListener('click', copyCurrentId);
  els.rahuiForm.addEventListener('submit', saveCurrent);
  els.fitPolygon.addEventListener('click', () => fitGeometry(map, collectGeometry()));
  els.exportGeoJson.addEventListener('click', exportCurrentGeoJson);
  els.duplicateRahui.addEventListener('click', duplicateCurrent);
  els.archiveRahui.addEventListener('click', archiveCurrent);
  els.openSettings.addEventListener('click', () => openModal(els.settingsModal));
  els.openImport.addEventListener('click', () => openModal(els.importModal));
  els.exportWorkspace.addEventListener('click', exportWorkspace);
  els.saveSettings.addEventListener('click', persistSettings);
  els.testBackend.addEventListener('click', testBackend);
  els.runImport.addEventListener('click', runImport);
  els.editorModeGuided.addEventListener('click', () => setEditorMode('guided'));
  els.editorModeFull.addEventListener('click', () => setEditorMode('full'));
  els.stepNav.addEventListener('click', event => {
    const button = event.target.closest('[data-step]');
    if (button) setStep(button.dataset.step);
  });
  els.previousStep.addEventListener('click', () => moveStep(-1));
  els.nextStep.addEventListener('click', () => moveStep(1));
  els.runLocationLookup.addEventListener('click', runLocationLookup);
  els.locationLookupSearch.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      runLocationLookup();
    }
  });
  els.locationLookupResults.addEventListener('click', handleLookupResultAction);
  els.locationReferences.addEventListener('click', handleReferenceAction);
  document.querySelectorAll('[data-close-modal]').forEach(button => button.addEventListener('click', () => closeModal(document.getElementById(button.dataset.closeModal))));
  els.rahuiForm.addEventListener('input', event => {
    if (event.target.closest('.lookup-card')) return;
    readFormIntoCurrent();
    setDirty(true);
  });
  document.querySelector('#activityOptions').addEventListener('change', () => { readFormIntoCurrent(); setDirty(true); });
  window.addEventListener('beforeunload', event => {
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = '';
  });
}

function setEditorMode(mode) {
  editorMode = mode === 'full' ? 'full' : 'guided';
  els.editorFormPanel.classList.toggle('guided-mode', editorMode === 'guided');
  els.editorFormPanel.classList.toggle('full-mode', editorMode === 'full');
  els.editorModeGuided.classList.toggle('active', editorMode === 'guided');
  els.editorModeFull.classList.toggle('active', editorMode === 'full');
  els.stepNav.hidden = editorMode !== 'guided';
  els.guidedNavigation.hidden = editorMode !== 'guided';
  applyStepVisibility();
}

function setStep(step) {
  if (!STEPS.includes(step)) return;
  currentStep = step;
  applyStepVisibility();
  for (const button of els.stepNav.querySelectorAll('[data-step]')) {
    button.classList.toggle('active', button.dataset.step === currentStep);
  }
  const index = STEPS.indexOf(currentStep);
  els.previousStep.disabled = index === 0;
  els.nextStep.textContent = index === STEPS.length - 1 ? 'Back To What It Is' : 'Next';
  if (currentStep === 'where') setTimeout(() => map.invalidateSize(), 50);
}

function applyStepVisibility() {
  const guided = editorMode === 'guided';
  document.querySelectorAll('[data-guided-step]').forEach(section => {
    section.hidden = guided && section.dataset.guidedStep !== currentStep;
  });
  document.querySelectorAll('[data-step-intro]').forEach(intro => {
    intro.hidden = !guided || intro.dataset.stepIntro !== currentStep;
  });
}

function moveStep(direction) {
  const index = STEPS.indexOf(currentStep);
  if (direction > 0 && index === STEPS.length - 1) return setStep('what');
  const next = Math.max(0, Math.min(STEPS.length - 1, index + direction));
  setStep(STEPS[next]);
  els.editorFormPanel.scrollTo({ top: 0, behavior: 'smooth' });
}

async function reloadRecords(selectId = '') {
  try {
    records = (await storage.list()).map(normalizeRahui);
    renderList();
    if (selectId) selectRecord(selectId);
  } catch (error) {
    showToast(error.message, true);
  }
}

function newRecord() {
  if (!confirmDiscardIfDirty()) return;
  current = createBlankRahui({ id: createRahuiId(), createdBy: settings.editorName, updatedBy: settings.editorName });
  drawnItems.clearLayers();
  lookupLayer.clearLayers();
  lookupResults = [];
  writeCurrentToForm();
  renderLookupResults();
  setDirty(false);
  renderList();
  els.formHeading.textContent = 'New rāhui';
  els.archiveRahui.disabled = true;
  if (editorMode === 'guided') setStep('what');
}

function selectRecord(id) {
  if (!confirmDiscardIfDirty()) return;
  const item = records.find(record => record.id === id);
  if (!item) return;
  current = normalizeRahui(JSON.parse(JSON.stringify(item)));
  loadGeometry(current.geometry);
  lookupLayer.clearLayers();
  lookupResults = [];
  writeCurrentToForm();
  renderLookupResults();
  setDirty(false);
  renderList();
  els.formHeading.textContent = current.title || 'Rāhui';
  els.archiveRahui.disabled = !current.id || current.archived;
  fitGeometry(map, current.geometry);
  if (window.innerWidth <= 1180) els.editorFormPanel.classList.add('open');
}

function renderList() {
  const query = els.editorSearch.value.trim().toLowerCase();
  const statusFilter = els.editorStatusFilter.value;
  const publishedFilter = els.editorPublishedFilter.value;
  const items = records.filter(item => {
    const computed = item.archived ? 'archived' : (!item.published ? 'draft' : getComputedStatus(item));
    const referenceNames = (item.locationReferences || []).map(ref => ref.name).join(' ');
    const haystack = [item.id, item.title, item.locationText, item.authority, item.iwiHapu, item.type, referenceNames].join(' ').toLowerCase();
    if (query && !haystack.includes(query)) return false;
    if (statusFilter && computed !== statusFilter && !(statusFilter === 'expired' && ['expired','ended'].includes(computed))) return false;
    if (publishedFilter === 'yes' && !item.published) return false;
    if (publishedFilter === 'no' && item.published) return false;
    return true;
  }).sort((a,b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));

  els.editorList.innerHTML = '';
  if (!items.length) {
    els.editorList.innerHTML = '<div class="empty-state">No records match the current filters.</div>';
    return;
  }
  for (const item of items) {
    const computed = item.archived ? 'archived' : (!item.published ? 'draft' : getComputedStatus(item));
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `editor-list-item${item.id && item.id === current.id ? ' selected' : ''}`;
    const timing = dateSummary(item);
    const shortId = item.id ? item.id.slice(0, 8) : 'no-id';
    button.innerHTML = `<div class="editor-list-top"><span class="status-chip ${computed}">${escapeHtml(statusLabel(computed))}</span><span class="record-version">v${item.version || 1}</span></div><h3>${escapeHtml(item.title || 'Untitled rāhui')}</h3><p>${escapeHtml(item.locationText || item.authority || 'No area description')}</p><p class="record-date">${escapeHtml(timing)}</p><span class="record-id-short" title="${escapeHtml(item.id || '')}">ID ${escapeHtml(shortId)}</span>`;
    button.addEventListener('click', () => selectRecord(item.id));
    els.editorList.append(button);
  }
}

async function saveCurrent(event) {
  event?.preventDefault();
  if (saving) return;
  readFormIntoCurrent();
  const wasExisting = records.some(record => record.id === current.id);
  current.geometry = collectGeometry();
  current.updatedBy = settings.editorName;
  if (!current.createdBy) current.createdBy = settings.editorName;
  if (current.archived) current.published = false;
  if (!current.id) {
    current.id = createRahuiId();
    els.rahuiId.value = current.id;
  }
  const errors = validateRahui(current);
  if (errors.length) {
    showToast(errors.join(' '), true);
    return;
  }
  saving = true;
  setBusy(true, wasExisting ? 'Saving changes' : 'Adding rāhui', 'Please wait while the record is synced. Do not close or refresh this page.');
  const saveLabel = els.saveRahui.textContent;
  els.saveRahui.disabled = true;
  els.saveRahui.textContent = 'Saving...';
  els.unsavedIndicator.hidden = false;
  els.unsavedIndicator.textContent = 'Saving';
  els.unsavedIndicator.classList.add('saving');
  try {
    const saved = normalizeRahui(await storage.save(current));
    current = saved;
    setDirty(false);
    await reloadRecords(saved.id);
    showToast('Rāhui saved.');
  } catch (error) {
    setDirty(true);
    showToast(error.message, true);
  } finally {
    saving = false;
    setBusy(false);
    els.saveRahui.disabled = false;
    els.saveRahui.textContent = saveLabel;
    els.unsavedIndicator.classList.remove('saving');
    setDirty(dirty);
  }
}

async function archiveCurrent() {
  if (!current.id || current.archived) return;
  if (!confirm(`Archive ${current.title || 'this rāhui'}? It will be removed from the public view.`)) return;
  setBusy(true, 'Archiving rāhui', 'Please wait while the record is updated.');
  try {
    await storage.archive(current.id);
    setDirty(false);
    await reloadRecords();
    newRecord();
    showToast('Rāhui archived.');
  } catch (error) {
    showToast(error.message, true);
  } finally {
    setBusy(false);
  }
}

function readFormIntoCurrent() {
  const fields = ['rahuiId','title','summary','description','locationText','type','basis','legalBasis','reason','authority','iwiHapu','marae','contactName','contactDetails','notifiedDate','startDate','endDate','reviewDate','liftedDate','statusOverride','restrictions','exceptions','internalNotes'];
  current.id = els.rahuiId.value;
  for (const field of fields.filter(f => f !== 'rahuiId')) current[field] = els[field].value;
  current.published = els.published.checked;
  current.archived = els.archived.checked;
  current.affectedActivities = [...document.querySelectorAll('#activityOptions input:checked')].map(input => input.value);
  current.sourceLinks = els.sourceLinks.value.split(/\r?\n/).map(line => {
    const text = line.trim();
    if (!text) return null;
    const separator = text.indexOf('|');
    if (separator < 0) return { label: '', url: text };
    return { label: text.slice(0, separator).trim(), url: text.slice(separator + 1).trim() };
  }).filter(link => link?.url);
  current.geometry = collectGeometry();
  updateDateOverview();
  updateDebug();
}

function writeCurrentToForm() {
  const fields = ['title','summary','description','locationText','type','basis','legalBasis','reason','authority','iwiHapu','marae','contactName','contactDetails','notifiedDate','startDate','endDate','reviewDate','liftedDate','statusOverride','restrictions','exceptions','internalNotes'];
  els.rahuiId.value = current.id;
  for (const field of fields) els[field].value = current[field] || '';
  els.published.checked = Boolean(current.published);
  els.archived.checked = Boolean(current.archived);
  els.sourceLinks.value = (current.sourceLinks || []).map(link => link.label ? `${link.label} | ${link.url}` : link.url).join('\n');
  document.querySelectorAll('#activityOptions input').forEach(input => input.checked = current.affectedActivities.includes(input.value));
  renderLocationReferences();
  updateDateOverview();
  updateRecordIdentity();
  refreshEditorPolygonLabels();
  updateDebug();
}

function geometryChanged() {
  current.geometry = collectGeometry();
  setDirty(true);
  refreshEditorPolygonLabels();
  updateDebug();
}

function collectGeometry() {
  return geometryFromFeatureCollection(drawnItems.toGeoJSON());
}

function loadGeometry(geometry) {
  drawnItems.clearLayers();
  const fc = geometryToFeatureCollection(geometry);
  L.geoJSON(fc, { style: () => styleForRahui(current) }).eachLayer(layer => { drawnItems.addLayer(layer); bindPolygonLabel(layer, current, settings); });
}

async function runLocationLookup() {
  if (!settings.locationLookupEnabled) return showToast('Location lookup is disabled in Settings.', true);
  const term = els.locationLookupSearch.value.trim();
  if (term.length < 2) return showToast('Enter at least two characters to search.', true);
  const sources = [...els.locationLookupSources.querySelectorAll('input:checked')].map(input => input.value);
  if (!sources.length) return showToast('Choose at least one lookup source.', true);
  els.runLocationLookup.disabled = true;
  els.runLocationLookup.textContent = 'Searching...';
  els.locationLookupResults.innerHTML = '<div class="empty-state">Searching location sources...</div>';
  try {
    lookupResults = await searchLocationLookups(term, {
      sources,
      farNorthOnly: settings.locationLookupFarNorthOnly,
      limit: settings.locationLookupLimit
    });
    renderLookupResults();
  } catch (error) {
    lookupResults = [];
    els.locationLookupResults.innerHTML = `<div class="notice">${escapeHtml(error.message || 'Location lookup failed.')}</div>`;
  } finally {
    els.runLocationLookup.disabled = false;
    els.runLocationLookup.textContent = 'Search';
  }
}

function renderLookupResults() {
  if (!lookupResults.length) {
    els.locationLookupResults.innerHTML = '<div class="empty-state">Search for a location to see lookup results.</div>';
    return;
  }
  els.locationLookupResults.innerHTML = lookupResults.map((result, index) => {
    const isPolygon = ['Polygon','MultiPolygon'].includes(result.geometry?.type);
    const sourceHref = safeHref(result.sourceUrl);
    return `<article class="lookup-result">
      <div class="lookup-result-main">
        <strong>${escapeHtml(result.name)}</strong>
        <span>${escapeHtml(result.detail || result.featureType || result.sourceLabel)}</span>
        <small>${escapeHtml(result.sourceLabel)}${result.geometryNote ? ` · ${escapeHtml(result.geometryNote)}` : ''}</small>
      </div>
      <div class="lookup-result-actions">
        <button class="btn small" type="button" data-lookup-action="show" data-lookup-index="${index}">Show</button>
        <button class="btn small" type="button" data-lookup-action="name" data-lookup-index="${index}">Use name</button>
        ${isPolygon ? `<button class="btn small" type="button" data-lookup-action="boundary" data-lookup-index="${index}">Use boundary</button>` : ''}
        ${sourceHref ? `<a class="btn small" href="${escapeHtml(sourceHref)}" target="_blank" rel="noopener">Source</a>` : ''}
      </div>
    </article>`;
  }).join('');
}

function handleLookupResultAction(event) {
  const button = event.target.closest('[data-lookup-action]');
  if (!button) return;
  const result = lookupResults[Number(button.dataset.lookupIndex)];
  if (!result) return;
  const action = button.dataset.lookupAction;
  if (action === 'show') return showLookupResult(result);
  if (action === 'name') return useLookupName(result);
  if (action === 'boundary') return useLookupBoundary(result);
}

function showLookupResult(result) {
  lookupLayer.clearLayers();
  if (!result.geometry) return showToast('This lookup result has no geometry to show.', true);
  const style = result.kind === 'river'
    ? { color: '#1d6fac', weight: 4, fillColor: '#74a9d8', fillOpacity: 0.18, dashArray: '7 5' }
    : { color: '#6d4b8a', weight: 3, fillColor: '#9b82b4', fillOpacity: 0.12, dashArray: '5 5' };
  const geoLayer = L.geoJSON({ type: 'Feature', properties: {}, geometry: result.geometry }, {
    style: () => style,
    pointToLayer: (_, latlng) => L.circleMarker(latlng, { radius: 7, color: '#6d4b8a', weight: 3, fillOpacity: 0.4 })
  }).addTo(lookupLayer);
  const bounds = geoLayer.getBounds?.();
  if (bounds?.isValid()) map.fitBounds(bounds, { padding: [28, 28], maxZoom: 15 });
  geoLayer.bindPopup(`<strong>${escapeHtml(result.name)}</strong><br>${escapeHtml(result.sourceLabel)}<br><small>${escapeHtml(result.geometryNote || '')}</small>`).openPopup();
}

function useLookupName(result) {
  readFormIntoCurrent();
  els.locationText.value = result.name;
  current.locationText = result.name;
  addLocationReference(result);
  showLookupResult(result);
  setDirty(true);
  updateDebug();
  showToast(`Location set to ${result.name}.`);
}

function useLookupBoundary(result) {
  if (!['Polygon','MultiPolygon'].includes(result.geometry?.type)) return showToast('This result does not provide polygon geometry.', true);
  const existing = collectGeometry();
  if (existing && !confirm('Replace the current rāhui polygon with this lookup boundary?')) return;
  loadGeometry(result.geometry);
  current.geometry = collectGeometry();
  if (!els.locationText.value.trim()) {
    els.locationText.value = result.name;
    current.locationText = result.name;
  }
  addLocationReference(result);
  showLookupResult(result);
  fitGeometry(map, current.geometry);
  setDirty(true);
  updateDebug();
  showToast('Lookup boundary copied into the editable rāhui polygon. Check and adjust it before publishing.');
}

function addLocationReference(result) {
  const ref = toLocationReference(result);
  const key = `${ref.source}:${ref.sourceId || ref.name}`;
  current.locationReferences = (current.locationReferences || []).filter(existing => `${existing.source}:${existing.sourceId || existing.name}` !== key);
  current.locationReferences.push(ref);
  renderLocationReferences();
}

function renderLocationReferences() {
  const refs = current.locationReferences || [];
  if (!refs.length) {
    els.locationReferences.innerHTML = '<div class="empty-state compact">No source references linked yet.</div>';
    return;
  }
  els.locationReferences.innerHTML = refs.map((ref, index) => {
    const href = safeHref(ref.sourceUrl);
    return `<div class="location-reference">
      <div><strong>${escapeHtml(ref.name)}</strong><span>${escapeHtml([ref.featureType, ref.status].filter(Boolean).join(' · ') || ref.source)}</span></div>
      <div class="location-reference-actions">${href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener">Source</a>` : ''}<button type="button" class="link-button" data-reference-remove="${index}">Remove</button></div>
    </div>`;
  }).join('');
}

function handleReferenceAction(event) {
  const button = event.target.closest('[data-reference-remove]');
  if (!button) return;
  current.locationReferences.splice(Number(button.dataset.referenceRemove), 1);
  renderLocationReferences();
  setDirty(true);
  updateDebug();
}

function setDirty(value) {
  dirty = Boolean(value);
  if (saving) return;
  els.unsavedIndicator.hidden = !dirty;
  els.unsavedIndicator.textContent = 'Unsaved changes';
  updateRecordIdentity();
}

function confirmDiscardIfDirty() {
  return !dirty || confirm('Discard unsaved changes?');
}

function loadSettingsForm() {
  for (const field of ['storageMode','gasWebAppUrl','writeToken','editorName','tileUrl','tileAttribution','mapCenterLat','mapCenterLng','mapZoom','publicRecentDays','locationLookupLimit','polygonLabelField','polygonLabelMode']) els[field].value = settings[field] ?? '';
  els.showDebug.checked = Boolean(settings.showDebug);
  els.locationLookupEnabled.checked = Boolean(settings.locationLookupEnabled);
  els.locationLookupFarNorthOnly.checked = Boolean(settings.locationLookupFarNorthOnly);
  els.debugField.hidden = !settings.showDebug;
}

function readSettingsForm() {
  return {
    ...settings,
    storageMode: els.storageMode.value,
    gasWebAppUrl: els.gasWebAppUrl.value.trim(),
    writeToken: els.writeToken.value,
    editorName: els.editorName.value.trim(),
    tileUrl: els.tileUrl.value.trim(),
    tileAttribution: els.tileAttribution.value.trim(),
    mapCenterLat: Number(els.mapCenterLat.value),
    mapCenterLng: Number(els.mapCenterLng.value),
    mapZoom: Number(els.mapZoom.value),
    publicRecentDays: Number(els.publicRecentDays.value),
    locationLookupEnabled: els.locationLookupEnabled.checked,
    locationLookupFarNorthOnly: els.locationLookupFarNorthOnly.checked,
    locationLookupLimit: Number(els.locationLookupLimit.value),
    polygonLabelField: els.polygonLabelField.value,
    polygonLabelMode: els.polygonLabelMode.value,
    showDebug: els.showDebug.checked
  };
}

async function persistSettings() {
  const nextSettings = saveSettings(readSettingsForm());
  const nextStorage = createStorage(nextSettings, { editor: true });
  setBusy(true, 'Saving settings', 'Updating editor settings and public map label configuration.');
  settings = nextSettings;
  storage = nextStorage;
  let publicConfigWarning = '';
  try {
    try {
      await storage.savePublicConfig(normalizePublicConfig(settings));
    } catch (configError) {
      publicConfigWarning = configError.message || 'Public polygon label settings could not be synced.';
    }
    els.debugField.hidden = !settings.showDebug;
    applyLookupSettingState();
    refreshEditorPolygonLabels();
    scheduleReferenceLayerRefresh(20);
    closeModal(els.settingsModal);
    await reloadRecords(current.id);
    if (publicConfigWarning) {
      showToast(`Settings saved locally, but public polygon label settings were not synced: ${publicConfigWarning}`, true);
    } else {
      showToast('Settings saved. Public polygon label settings were also updated.');
    }
  } catch (error) {
    showToast(error.message, true);
  } finally {
    setBusy(false);
  }
}

function applyLookupSettingState() {
  els.locationLookupCard.classList.toggle('disabled-card', !settings.locationLookupEnabled);
  els.locationLookupSearch.disabled = !settings.locationLookupEnabled;
  els.runLocationLookup.disabled = !settings.locationLookupEnabled;
}

async function testBackend() {
  const testSettings = readSettingsForm();
  setBusy(true, 'Testing backend', 'Checking the configured storage connection.');
  try {
    const adapter = createStorage(testSettings, { editor: true });
    const result = await adapter.health();
    showToast(`Backend OK: ${result.provider || testSettings.storageMode}`);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    setBusy(false);
  }
}

function exportWorkspace() {
  const payload = {
    schema: 'rahui-map-workspace',
    version: APP_VERSION,
    exportedAt: new Date().toISOString(),
    settings: exportSettings(settings).settings,
    items: records
  };
  downloadJson(`rahui-map-workspace-v${APP_VERSION}.json`, payload);
}

async function runImport() {
  const file = els.importFile.files?.[0];
  if (!file) return showToast('Choose a JSON or GeoJSON file first.', true);
  try {
    const data = JSON.parse(await file.text());
    if (data.type === 'FeatureCollection' || data.type === 'Feature') {
      const fc = data.type === 'FeatureCollection' ? data : { type: 'FeatureCollection', features: [data] };
      const geometry = geometryFromFeatureCollection(fc);
      if (!geometry) throw new Error('The GeoJSON does not contain polygon geometry.');
      loadGeometry(geometry);
      current.geometry = geometry;
      setDirty(true);
      closeModal(els.importModal);
      fitGeometry(map, geometry);
      return showToast('GeoJSON loaded into the current rāhui.');
    }
    const items = Array.isArray(data) ? data : data.items;
    if (!Array.isArray(items)) throw new Error('The file is not a recognised workspace or record list.');
    const preparedItems = prepareImportedItems(items);
    if (!confirm(`Replace all records in ${settings.storageMode === 'gas' ? 'the configured backend' : 'local browser storage'} with ${preparedItems.length} imported records?`)) return;
    setBusy(true, 'Importing workspace', 'Please wait while all rāhui records are replaced and synced.');
    await storage.replaceAll(preparedItems);
    await reloadRecords();
    newRecord();
    closeModal(els.importModal);
    showToast('Workspace imported.');
  } catch (error) {
    showToast(error.message, true);
  } finally {
    setBusy(false);
  }
}

function exportCurrentGeoJson() {
  readFormIntoCurrent();
  const geometry = collectGeometry();
  if (!geometry) return showToast('Draw or import a polygon before exporting GeoJSON.', true);
  const item = normalizeRahui({ ...current, geometry });
  const feature = toGeoJsonFeature(item);
  downloadJson(`${slug(item.title || 'rahui')}.geojson`, feature);
}

function duplicateCurrent() {
  readFormIntoCurrent();
  const geometry = collectGeometry();
  current = createBlankRahui({
    ...JSON.parse(JSON.stringify(current)),
    id: createRahuiId(),
    title: current.title ? `${current.title} copy` : '',
    published: false,
    archived: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: settings.editorName,
    updatedBy: settings.editorName,
    version: 1,
    geometry
  });
  writeCurrentToForm();
  setDirty(true);
  els.formHeading.textContent = 'Duplicated rāhui';
  els.archiveRahui.disabled = true;
  renderList();
  showToast('Duplicated as a new draft. Save to create the new record.');
}

function updateDebug() {
  if (!settings.showDebug) return;
  const debugRecord = { ...current, geometry: collectGeometry() };
  els.debugOutput.textContent = JSON.stringify(debugRecord, null, 2);
}

function updateDateOverview() {
  if (!els.dateOverview || !els.dateStatusPreview) return;
  const values = [
    ['Notified', current.notifiedDate],
    ['Starts', current.startDate],
    ['Ends', current.endDate],
    ['Review', current.reviewDate],
    ['Lifted', current.liftedDate]
  ];
  els.dateOverview.innerHTML = values.map(([label, value]) => `<div class="date-overview-item${value ? '' : ' empty'}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value ? formatDate(value) : 'Not set')}</strong></div>`).join('');
  const status = current.archived ? 'archived' : (!current.published ? 'draft' : getComputedStatus(current));
  els.dateStatusPreview.innerHTML = `<span class="status-chip ${status}">${escapeHtml(statusLabel(status))}</span><span>${escapeHtml(dateSummary(current))}</span>`;
}


async function loadSharedPublicConfig() {
  try {
    const publicConfig = normalizePublicConfig(await storage.getPublicConfig());
    settings = { ...settings, ...publicConfig };
  } catch {
    settings = { ...settings, ...normalizePublicConfig(settings) };
  }
}

function copyCurrentId() {
  const id = current.id || els.rahuiId.value;
  if (!id) return showToast('This record does not have an ID yet.', true);
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(id).then(() => showToast('Record ID copied.')).catch(() => fallbackCopyId(id));
  } else {
    fallbackCopyId(id);
  }
}

function fallbackCopyId(id) {
  const input = els.rahuiId;
  input.focus();
  input.select();
  try { document.execCommand('copy'); showToast('Record ID copied.'); }
  catch { showToast(`Record ID: ${id}`); }
  input.setSelectionRange(0, 0);
}

function updateRecordIdentity() {
  if (!els.recordVersion || !els.recordSyncState) return;
  els.recordVersion.textContent = `Version ${current.version || 1}`;
  const stored = records.some(record => record.id === current.id);
  els.recordSyncState.textContent = dirty ? 'Unsaved changes' : (stored ? 'Synced record' : 'New record');
}

function refreshEditorPolygonLabels() {
  if (!drawnItems) return;
  drawnItems.eachLayer(layer => {
    if (layer.unbindTooltip) layer.unbindTooltip();
    bindPolygonLabel(layer, current, settings);
  });
}

function prepareImportedItems(items) {
  const seen = new Set();
  return items.map(input => {
    const item = normalizeRahui(input);
    if (!item.id) item.id = createRahuiId();
    if (seen.has(item.id)) throw new Error(`The import contains duplicate record ID ${item.id}. Fix the duplicate before importing.`);
    seen.add(item.id);
    return item;
  });
}

function setBusy(active, title = 'Working', message = 'Please wait.') {
  if (!els.busyOverlay) return;
  els.busyTitle.textContent = title;
  els.busyMessage.textContent = message;
  els.busyOverlay.hidden = !active;
  document.body.classList.toggle('app-busy', Boolean(active));
}

function slug(value) {
  return String(value || 'rahui').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'rahui';
}

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function openModal(modal) { modal.hidden = false; }
function closeModal(modal) { modal.hidden = true; }

function statusLabel(status) {
  return ({ active: 'Active', upcoming: 'Upcoming', expired: 'Ended', ended: 'Ended', lifted: 'Lifted', draft: 'Draft', archived: 'Archived' })[status] || status;
}

function showToast(message, isError = false) {
  const toast = document.createElement('div');
  toast.className = `toast${isError ? ' error' : ''}`;
  toast.textContent = message;
  els.toastStack.append(toast);
  setTimeout(() => toast.remove(), 5000);
}
