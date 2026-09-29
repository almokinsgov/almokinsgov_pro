(function () {
  'use strict';

  const VERSION = '0.5.0';
  const STORAGE_KEY = 'gis-ar-viewer-config-v1';
  const DEFAULT_ELEVATION_PROVIDER = 'auto';
  const OPEN_METEO_ELEVATION_URL = 'https://api.open-meteo.com/v1/elevation';
  const PALETTE = ['#147d92', '#a54747', '#6d5ba8', '#4b7b36', '#ad742b', '#a13c74', '#386b9c', '#7b6540'];

  const state = {
    mode: 'map',
    layers: [],
    baseLayer: null,
    userMarker: null,
    mapDirectionLayer: null,
    mapHeadingMarker: null,
    mapSpiderLayer: null,
    position: null,
    heading: 0,
    headingValid: false,
    queryTimer: null,
    arQueryTimer: null,
    arQueryPosition: null,
    queryGeneration: 0,
    arFeatures: [],
    elevationGeneration: 0,
    elevationAbort: null,
    elevationTimer: null,
    elevationPosition: null,
    debug: []
  };

  const els = {};
  let map;
  let arViewer;
  let elevationModel;

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    cacheElements();
    initMap();
    initAr();
    initElevation();
    bindEvents();
    updateElevationProviderUi();
    els.arSpatialLimitValue.textContent = els.arSpatialLimit.value;
    els.arMaxFeaturesValue.textContent = els.arMaxFeatures.value;
    els.mapClusterRadiusValue.textContent = `${els.mapClusterRadius.value} px`;
    els.arOverlapRadiusValue.textContent = `${els.arOverlapRadius.value} px`;
    setArRange(els.arRange.value, false);
    arViewer.setLabelLimit(Number(els.arMaxFeatures.value));
    arViewer.setOverlapMode(els.arOverlapMode.value);
    arViewer.setOverlapRadius(Number(els.arOverlapRadius.value));
    loadConfig();
    renderLayers();
    updateBasemap();
    registerServiceWorker();
    log('init', { version: VERSION, secureContext: window.isSecureContext });
  }

  function cacheElements() {
    [
      'mapModeBtn','arModeBtn','sidebarToggle','sidebar','sourceForm','sourceUrl','proxyUrl','discoveryPanel','layerList',
      'basemapSelect','locateBtn','fitBtn','mapFacingEnabled','mapPointMode','mapClusterRadius','mapClusterRadiusValue','arRange','arRangeValue','arRangeNumber','arSpatialLimit','arSpatialLimitValue','arMaxFeatures','arMaxFeaturesValue','arOverlapMode','arOverlapRadius','arOverlapRadiusValue','headingOffset','headingOffsetValue','cameraFov','cameraFovValue','reanchorYawBtn','enableArBtn',
      'elevationEnabled','elevationProvider','elevationProviderHelp','eyeHeight','targetHeight','verticalScale','verticalScaleValue','sourceElevationMode','sourceElevationField','elevationRefreshBtn','elevationClearCacheBtn',
      'locationStatus','headingStatus','cameraStatus','elevationStatus','featureCount','arSpatialStatus','exportDebugBtn','mapView','arView','mapMessage','zoomToMeBtn',
      'cameraVideo','arFallback','arAnchorCanvas','arMarkers','arHorizon','hudHeading','hudDirection','hudAccuracy','hudElevation','arRefreshBtn','desktopHeading','permissionHelp','permissionHelpText','featureDialog',
      'featureDialogClose','featureDialogContent'
    ].forEach(id => { els[id] = document.getElementById(id); });
  }

  function initMap() {
    map = L.map('map', { zoomControl: true, preferCanvas: true }).setView([-35.1, 173.25], 9);
    map.on('moveend', () => { clearMapSpider(); scheduleMapRefresh(150); updateMapDirection(); });
    map.on('zoomend', () => { clearMapSpider(); refreshMapRendering(); updateMapDirection(); });
  }

  function initAr() {
    arViewer = new ArViewer({
      video: els.cameraVideo,
      fallback: els.arFallback,
      container: els.arMarkers,
      anchorCanvas: els.arAnchorCanvas,
      horizon: els.arHorizon,
      labelLimit: Number(els.arMaxFeatures?.value) || 75,
      onStatus: (type, value, detail) => {
        if (type === 'location') els.locationStatus.textContent = value;
        if (type === 'heading') els.headingStatus.textContent = value;
        if (type === 'camera') els.cameraStatus.textContent = value;
        if (detail) log(`ar-${type}`, detail);
        updatePermissionHelp();
      },
      onPosition: position => {
        state.position = position;
        updateUserMarker();
        updateMapDirection();
        els.hudAccuracy.textContent = `±${Math.round(position.accuracy)} m`;
        const moved = state.arQueryPosition ? GeoTools.distanceMetres(state.arQueryPosition, position) : Infinity;
        const refreshDistance = Math.max(20, Math.min(75, Number(position.accuracy || 0)));
        if (state.mode === 'ar' && moved >= refreshDistance) scheduleArRefresh(350);
        const elevationMoved = state.elevationPosition ? GeoTools.distanceMetres(state.elevationPosition, position) : Infinity;
        const elevationRefreshDistance = Math.max(5, Math.min(15, Number(position.accuracy || 0) * 0.5));
        if (state.mode === 'ar' && state.arFeatures.length && elevationMoved >= elevationRefreshDistance && moved < refreshDistance) scheduleElevationRefresh(300);
      },
      onHeading: heading => {
        state.heading = heading;
        state.headingValid = true;
        els.hudHeading.textContent = `${String(Math.round(heading)).padStart(3, '0')}°`;
        els.hudDirection.textContent = GeoTools.cardinal(heading);
        els.desktopHeading.value = String(Math.round(heading));
        updateMapDirection();
      },
      onFeatureClick: item => showFeature(item.feature, item.layer, item)
    });
  }

  function initElevation() {
    elevationModel = new WorkbenchAR.TerrainElevationModel({
      provider: createElevationProvider(DEFAULT_ELEVATION_PROVIDER),
      enabled: true,
      eyeHeightM: 1.65,
      targetHeightM: 1.5,
      sourceElevationMode: 'ignore',
      gpsAltitudeMaxAccuracyM: 20
    });
  }

  function createElevationProvider(mode = DEFAULT_ELEVATION_PROVIDER) {
    if (mode === 'open-meteo') return new WorkbenchAR.OpenMeteoElevationProvider({ url: OPEN_METEO_ELEVATION_URL, batchSize: 100 });
    if (mode === 'terrarium') return new WorkbenchAR.TerrariumTileElevationProvider({ zoom: 14, maxConcurrentTiles: 8 });
    return new WorkbenchAR.FallbackElevationProvider({
      id: 'auto-elevation',
      providers: [
        new WorkbenchAR.TerrariumTileElevationProvider({ zoom: 14, maxConcurrentTiles: 8 }),
        new WorkbenchAR.OpenMeteoElevationProvider({ url: OPEN_METEO_ELEVATION_URL, batchSize: 100 })
      ]
    });
  }

  function updateElevationProviderUi() {
    const mode = els.elevationProvider?.value || DEFAULT_ELEVATION_PROVIDER;
    if (!els.elevationProviderHelp) return;
    els.elevationProviderHelp.textContent = mode === 'auto'
      ? 'Token-free. Auto samples public Terrarium terrain tiles first and falls back to Open-Meteo in batches of up to 100 coordinates.'
      : mode === 'terrarium'
        ? 'Token-free. Samples public Terrarium raster tiles directly in the browser and reuses each loaded tile for every GIS item inside it.'
        : 'Token-free. Samples the Copernicus GLO-90 DEM through Open-Meteo in automatic batches of up to 100 coordinates.';
  }

  function configureElevationModel(rebuildProvider = false) {
    if (!elevationModel) initElevation();
    if (rebuildProvider) {
      const mode = els.elevationProvider?.value || DEFAULT_ELEVATION_PROVIDER;
      elevationModel.setProvider(createElevationProvider(mode));
      updateElevationProviderUi();
    }
    elevationModel.configure({
      enabled: els.elevationEnabled.checked,
      eyeHeightM: Number.isFinite(Number(els.eyeHeight.value)) ? Number(els.eyeHeight.value) : 1.65,
      targetHeightM: Number.isFinite(Number(els.targetHeight.value)) ? Number(els.targetHeight.value) : 1.5,
      sourceElevationMode: els.sourceElevationMode.value || 'ignore',
      sourceElevationField: els.sourceElevationField.value.trim(),
      gpsAltitudeMaxAccuracyM: 20
    });
  }

  function scheduleElevationRefresh(delay = 250) {
    clearTimeout(state.elevationTimer);
    state.elevationTimer = setTimeout(() => {
      state.elevationTimer = null;
      void refreshArElevation(false, state.arFeatures);
    }, delay);
  }

  async function refreshArElevation(force = false, features = state.arFeatures) {
    configureElevationModel(false);
    const items = features || [];
    if (!state.position || !items.length) {
      els.elevationStatus.textContent = els.elevationEnabled.checked ? 'Waiting' : 'Off';
      els.hudElevation.textContent = els.elevationEnabled.checked ? 'Elevation waiting' : 'Elevation off';
      return;
    }

    if (state.elevationAbort) state.elevationAbort.abort();
    state.elevationAbort = new AbortController();
    const signal = state.elevationAbort.signal;
    const generation = ++state.elevationGeneration;
    if (force && typeof elevationModel.provider?.clearCache === 'function') elevationModel.provider.clearCache();

    els.elevationStatus.textContent = els.elevationEnabled.checked ? 'Sampling…' : 'Off';
    try {
      await elevationModel.enrich(state.position, items, { signal });
      if (signal.aborted || generation !== state.elevationGeneration) return;
      state.elevationPosition = { lat: state.position.lat, lng: state.position.lng };
      arViewer.refreshFeatureMetrics();
      updateElevationStatus();
      log('ar-elevation', elevationModel.diagnostics());
    } catch (error) {
      if (error?.name === 'AbortError') return;
      els.elevationStatus.textContent = 'Fallback';
      els.hudElevation.textContent = 'Terrain unavailable';
      log('ar-elevation-error', { message: error?.message || String(error) });
    }
  }

  function updateElevationStatus() {
    const diagnostic = elevationModel?.diagnostics();
    const last = diagnostic?.last || {};
    if (!els.elevationEnabled.checked || last.status === 'disabled') {
      els.elevationStatus.textContent = 'Off';
      els.hudElevation.textContent = 'Elevation off';
      return;
    }
    if (last.status === 'sampling') {
      els.elevationStatus.textContent = 'Sampling…';
      els.hudElevation.textContent = 'Sampling terrain';
      return;
    }
    const sampled = Number(last.sampledItems || 0);
    const total = state.arFeatures.length;
    const spread = Number(last.groundSpreadM);
    const unique = Number(last.groundUniqueCount || 0);
    const uniqueText = unique ? ` · ${unique} heights` : '';
    const spreadText = Number.isFinite(spread) ? ` · Δ${Math.round(spread)} m` : '';
    const providerText = elevationProviderStatusLabel(diagnostic?.provider);
    if (last.status === 'ready') els.elevationStatus.textContent = `${sampled}/${total} terrain${uniqueText}${spreadText}${providerText}`;
    else if (last.status === 'partial') els.elevationStatus.textContent = `${sampled}/${total} partial${uniqueText}${spreadText}${providerText}`;
    else els.elevationStatus.textContent = 'Fallback';
    if (Number.isFinite(last.observerGroundElevationM)) {
      els.hudElevation.textContent = `Ground ${Math.round(last.observerGroundElevationM)} m${uniqueText}${spreadText}`;
    } else if (last.observerAltitudeSource === 'gps-altitude' && Number.isFinite(last.observerAltitudeM)) els.hudElevation.textContent = `GPS alt ${Math.round(last.observerAltitudeM)} m`;
    else els.hudElevation.textContent = 'Flat elevation';
  }

  function elevationProviderStatusLabel(provider) {
    if (!provider) return '';
    const ids = Array.isArray(provider.lastResolvedBy) && provider.lastResolvedBy.length ? provider.lastResolvedBy : [provider.id].filter(Boolean);
    const names = ids.map(id => id === 'aws-terrarium-elevation' ? 'Terrarium' : id === 'open-meteo-elevation' ? 'Open-Meteo' : id === 'arcgis-elevation' ? 'ArcGIS' : id === 'auto-elevation' ? 'Auto' : id);
    return names.length ? ` · ${names.join('+')}` : '';
  }

  function bindEvents() {
    els.mapModeBtn.addEventListener('click', () => setMode('map'));
    els.arModeBtn.addEventListener('click', () => setMode('ar'));
    els.sidebarToggle.addEventListener('click', () => els.sidebar.classList.toggle('open'));
    els.sourceForm.addEventListener('submit', handleSourceSubmit);
    els.basemapSelect.addEventListener('change', () => { updateBasemap(); saveConfig(); });
    els.locateBtn.addEventListener('click', enableMapTracking);
    els.zoomToMeBtn.addEventListener('click', enableMapTracking);
    els.fitBtn.addEventListener('click', fitLayers);
    els.mapFacingEnabled.addEventListener('change', () => { updateMapDirection(); saveConfig(); });
    els.mapPointMode.addEventListener('change', () => { clearMapSpider(); refreshMapRendering(); saveConfig(); });
    els.mapClusterRadius.addEventListener('input', event => { els.mapClusterRadiusValue.textContent = `${event.target.value} px`; clearMapSpider(); refreshMapRendering(); saveConfig(); });
    els.enableArBtn.addEventListener('click', enableAr);
    els.arRefreshBtn.addEventListener('click', refreshArFeatures);
    els.desktopHeading.addEventListener('input', event => arViewer.setManualHeading(event.target.value));
    els.headingOffset.addEventListener('input', event => {
      els.headingOffsetValue.textContent = `${event.target.value}°`;
      arViewer.setHeadingOffset(event.target.value);
      saveConfig();
    });
    els.cameraFov.addEventListener('input', event => {
      els.cameraFovValue.textContent = `${event.target.value}°`;
      arViewer.setFov(event.target.value);
      saveConfig();
    });
    els.reanchorYawBtn.addEventListener('click', () => {
      const result = arViewer.reanchorYaw();
      log('ar-yaw-reanchor', result);
      showMessage(result.pending ? 'Yaw will re-anchor when compass data arrives.' : `Yaw re-anchored at ${Math.round(result.heading)}°.`);
    });
    els.arRange.addEventListener('input', () => setArRange(els.arRange.value, true));
    els.arRangeNumber.addEventListener('change', () => setArRange(els.arRangeNumber.value, true));
    document.querySelectorAll('[data-ar-range]').forEach(button => button.addEventListener('click', () => setArRange(button.dataset.arRange, true)));
    els.arSpatialLimit.addEventListener('change', () => { els.arSpatialLimitValue.textContent = els.arSpatialLimit.value; saveConfig(); scheduleArRefresh(100); });
    els.arMaxFeatures.addEventListener('change', () => { els.arMaxFeaturesValue.textContent = els.arMaxFeatures.value; arViewer.setLabelLimit(Number(els.arMaxFeatures.value)); saveConfig(); });
    els.arOverlapMode.addEventListener('change', () => { arViewer.setOverlapMode(els.arOverlapMode.value); saveConfig(); });
    els.arOverlapRadius.addEventListener('input', event => { els.arOverlapRadiusValue.textContent = `${event.target.value} px`; arViewer.setOverlapRadius(Number(event.target.value)); saveConfig(); });
    els.elevationEnabled.addEventListener('change', () => { configureElevationModel(false); saveConfig(); void refreshArElevation(); });
    els.elevationProvider.addEventListener('change', () => { configureElevationModel(true); saveConfig(); void refreshArElevation(true); });
    els.verticalScale.addEventListener('input', event => {
      const value = Number(event.target.value) || 1;
      els.verticalScaleValue.textContent = `${value.toFixed(1)}×`;
      arViewer.setVerticalScale(value);
      saveConfig();
    });
    [els.eyeHeight, els.targetHeight, els.sourceElevationMode, els.sourceElevationField].forEach(element => element.addEventListener('change', () => { configureElevationModel(false); saveConfig(); void refreshArElevation(); }));
    els.elevationRefreshBtn.addEventListener('click', () => void refreshArElevation());
    els.elevationClearCacheBtn.addEventListener('click', () => void refreshArElevation(true));
    els.exportDebugBtn.addEventListener('click', exportDiagnostics);
    els.featureDialogClose.addEventListener('click', () => els.featureDialog.close());
    window.addEventListener('resize', () => { map.invalidateSize(); arViewer.render(); });
    window.addEventListener('beforeunload', () => { if (state.elevationAbort) state.elevationAbort.abort(); clearTimeout(state.elevationTimer); arViewer.stop(); });
  }

  async function handleSourceSubmit(event) {
    event.preventDefault();
    const rawUrl = els.sourceUrl.value.trim();
    if (!rawUrl) return;
    setBusy(els.sourceForm, true);
    try {
      const client = new FeatureServer.FeatureServerClient({ proxy: els.proxyUrl.value.trim() });
      const result = await client.inspect(rawUrl);
      if (result.kind === 'service') showDiscovery(result, client);
      else await addLayer(result.layerUrl, result.metadata, client);
      els.sourceUrl.value = '';
    } catch (error) {
      showMessage(error.message);
      log('source-error', { url: rawUrl, message: error.message });
    } finally {
      setBusy(els.sourceForm, false);
    }
  }

  function showDiscovery(result, client) {
    if (!result.layers.length) {
      showMessage('No feature layers were advertised by this service.');
      return;
    }
    els.discoveryPanel.classList.remove('hidden');
    els.discoveryPanel.innerHTML = `<h3>Select layers from ${escapeHtml(result.service.name || 'Feature service')}</h3>
      <div class="discovery-items">${result.layers.map(layer => `<div class="discovery-item"><input type="checkbox" id="discover-${layer.id}" value="${layer.id}" checked><label for="discover-${layer.id}">${escapeHtml(layer.name)} <span class="muted">${escapeHtml(layer.type)}</span></label></div>`).join('')}</div>
      <div class="discovery-actions"><button type="button" class="secondary-button" data-discover-cancel>Cancel</button><button type="button" class="primary-button" data-discover-add>Add selected</button></div>`;
    els.discoveryPanel.querySelector('[data-discover-cancel]').addEventListener('click', () => els.discoveryPanel.classList.add('hidden'));
    els.discoveryPanel.querySelector('[data-discover-add]').addEventListener('click', async () => {
      const ids = [...els.discoveryPanel.querySelectorAll('input:checked')].map(input => Number(input.value));
      if (!ids.length) return;
      setBusy(els.discoveryPanel, true);
      for (const id of ids) {
        const url = `${result.serviceUrl}/${id}`;
        try {
          const metadata = await client.layerMetadata(url);
          await addLayer(url, metadata, client, false);
        } catch (error) {
          log('layer-add-error', { url, message: error.message });
        }
      }
      setBusy(els.discoveryPanel, false);
      els.discoveryPanel.classList.add('hidden');
      await fitLayers();
    });
  }

  async function addLayer(url, metadata, client, fit = true) {
    if (state.layers.some(layer => layer.url.toLowerCase() === url.toLowerCase())) {
      showMessage('That layer is already loaded.');
      return;
    }
    const index = state.layers.length;
    const layer = {
      id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
      url,
      name: metadata.name || `Layer ${index + 1}`,
      metadata,
      proxy: client.proxy,
      colour: PALETTE[index % PALETTE.length],
      opacity: .8,
      visible: true,
      leaflet: L.layerGroup(),
      features: [],
      extent: null,
      truncated: false
    };
    layer.leaflet.addTo(map);
    state.layers.push(layer);
    renderLayers();
    saveConfig();
    try {
      layer.extent = await client.layerExtent(url);
    } catch (error) {
      log('extent-error', { layer: layer.name, message: error.message });
    }
    if (fit && layer.extent) fitBoundsObject(layer.extent);
    scheduleMapRefresh(10);
    if (state.position) scheduleArRefresh(10);
  }

  function makeLeafletStyle(colour, opacity) {
    return {
      style: () => ({ color: colour, weight: 2, opacity, fillColor: colour, fillOpacity: opacity * .22 }),
      pointToLayer: (_feature, latlng) => L.circleMarker(latlng, { radius: 6, color: '#fff', weight: 1.5, fillColor: colour, fillOpacity: opacity })
    };
  }

  function refreshMapRendering() {
    state.layers.filter(layer => layer.visible).forEach(renderMapLayer);
  }

  function renderMapLayer(layer) {
    if (!layer?.leaflet) return;
    layer.leaflet.clearLayers();
    if (!layer.visible || !layer.features.length) return;
    const pointLayer = String(layer.metadata?.geometryType || '').toLowerCase().includes('point');
    if (!pointLayer || els.mapPointMode.value === 'individual') {
      const collection = { type: 'FeatureCollection', features: layer.features };
      const geo = L.geoJSON(collection, makeLeafletStyle(layer.colour, layer.opacity));
      geo.eachLayer(child => {
        if (child.feature) child.on('click', () => showFeature(child.feature, layer));
        layer.leaflet.addLayer(child);
      });
      return;
    }
    renderPointClusters(layer);
  }

  function renderPointClusters(layer) {
    const configuredRadius = Math.max(12, Number(els.mapClusterRadius.value) || 48);
    const zoom = map.getZoom();
    const autoScale = zoom <= 12 ? 1.45 : zoom <= 14 ? 1.2 : zoom <= 16 ? .85 : .55;
    const radius = els.mapPointMode.value === 'auto' ? Math.max(18, configuredRadius * autoScale) : configuredRadius;
    const buckets = new Map();
    layer.features.forEach((feature, index) => {
      const point = GeoTools.representativePoint(feature.geometry);
      if (!point) return;
      const screen = map.latLngToContainerPoint([point.lat, point.lng]);
      const key = `${Math.floor(screen.x / radius)}:${Math.floor(screen.y / radius)}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push({ feature, index, point });
    });

    buckets.forEach(items => {
      if (items.length === 1) {
        addMapPoint(items[0].feature, items[0].point, layer);
        return;
      }
      const lat = items.reduce((sum, item) => sum + item.point.lat, 0) / items.length;
      const lng = items.reduce((sum, item) => sum + item.point.lng, 0) / items.length;
      const large = items.length >= 100 ? ' large' : '';
      const icon = L.divIcon({
        className: 'map-cluster-icon',
        html: `<span class="map-cluster-badge${large}" style="--cluster-colour:${layer.colour}">${items.length}</span>`,
        iconSize: [1, 1],
        iconAnchor: [0, 0]
      });
      const marker = L.marker([lat, lng], { icon, keyboard: true, riseOnHover: true });
      marker.bindTooltip(`${items.length} ${layer.name} items`, { direction: 'top', offset: [0, -18] });
      marker.on('click', () => handleMapClusterClick(items, layer, { lat, lng }));
      layer.leaflet.addLayer(marker);
    });
  }

  function addMapPoint(feature, point, layer) {
    const marker = L.circleMarker([point.lat, point.lng], {
      radius: 6,
      color: '#fff',
      weight: 1.5,
      fillColor: layer.colour,
      fillOpacity: layer.opacity,
      opacity: layer.opacity
    });
    marker.feature = feature;
    marker.on('click', () => showFeature(feature, layer));
    layer.leaflet.addLayer(marker);
  }

  function handleMapClusterClick(items, layer, centre) {
    const bounds = L.latLngBounds(items.map(item => [item.point.lat, item.point.lng]));
    const spreadM = bounds.isValid()
      ? GeoTools.distanceMetres({ lat: bounds.getSouth(), lng: bounds.getWest() }, { lat: bounds.getNorth(), lng: bounds.getEast() })
      : 0;
    if (map.getZoom() < 18 && spreadM > 2) {
      map.flyToBounds(bounds.pad(.6), { maxZoom: Math.min(18, map.getZoom() + 3), duration: .35 });
      return;
    }
    showMapSpider(items, layer, centre);
  }

  function showMapSpider(items, layer, centre) {
    clearMapSpider();
    state.mapSpiderLayer = L.layerGroup().addTo(map);
    const centrePoint = map.latLngToLayerPoint([centre.lat, centre.lng]);
    const shown = items.slice(0, 60);
    const ringStep = 12;
    shown.forEach((item, index) => {
      const ring = Math.floor(index / ringStep);
      const inRing = Math.min(ringStep, shown.length - ring * ringStep);
      const ringIndex = index % ringStep;
      const angle = (ringIndex / Math.max(1, inRing)) * Math.PI * 2 - Math.PI / 2;
      const pixelRadius = 34 + ring * 24;
      const targetPoint = L.point(centrePoint.x + Math.cos(angle) * pixelRadius, centrePoint.y + Math.sin(angle) * pixelRadius);
      const target = map.layerPointToLatLng(targetPoint);
      L.polyline([[centre.lat, centre.lng], target], { className: 'map-spider-line', interactive: false }).addTo(state.mapSpiderLayer);
      const marker = L.circleMarker(target, { radius: 6, color: '#fff', weight: 1.5, fillColor: layer.colour, fillOpacity: 1 });
      marker.bindTooltip(featureLabel(item.feature, layer), { direction: 'top' });
      marker.on('click', () => showFeature(item.feature, layer));
      marker.addTo(state.mapSpiderLayer);
    });
    if (items.length > shown.length) showMessage(`Showing ${shown.length} of ${items.length} overlapping items. Zoom further or reduce cluster spacing for more detail.`);
  }

  function clearMapSpider() {
    if (state.mapSpiderLayer && map.hasLayer(state.mapSpiderLayer)) map.removeLayer(state.mapSpiderLayer);
    state.mapSpiderLayer = null;
  }

  function renderLayers() {
    if (!state.layers.length) {
      els.layerList.innerHTML = '<div class="empty-state">No layers yet.<br>Add a public FeatureServer URL above.</div>';
      els.featureCount.textContent = '0';
      return;
    }
    els.layerList.innerHTML = state.layers.map(layer => `<div class="layer-card" data-layer-id="${layer.id}" style="--layer-colour:${layer.colour}">
      <div class="layer-card-top">
        <span class="layer-swatch"></span>
        <div class="layer-title"><strong title="${escapeHtml(layer.name)}">${escapeHtml(layer.name)}</strong><span title="${escapeHtml(layer.url)}">${escapeHtml(layer.metadata.geometryType || 'Feature layer')}</span></div>
        <div class="layer-actions"><label class="switch" title="Show layer"><input type="checkbox" data-layer-visible ${layer.visible ? 'checked' : ''}><span></span></label><button type="button" data-layer-remove title="Remove">×</button></div>
      </div>
      <div class="layer-card-bottom"><input type="range" min="0" max="1" step="0.05" value="${layer.opacity}" data-layer-opacity aria-label="Layer opacity"><span class="layer-count">${layer.features.length}${layer.truncated ? '+' : ''}</span></div>
    </div>`).join('');

    els.layerList.querySelectorAll('[data-layer-id]').forEach(card => {
      const layer = state.layers.find(item => item.id === card.dataset.layerId);
      card.querySelector('[data-layer-visible]').addEventListener('change', event => {
        layer.visible = event.target.checked;
        if (layer.visible) layer.leaflet.addTo(map); else map.removeLayer(layer.leaflet);
        saveConfig();
        scheduleMapRefresh(10);
        scheduleArRefresh(10);
      });
      card.querySelector('[data-layer-opacity]').addEventListener('input', event => {
        layer.opacity = Number(event.target.value);
        applyLayerStyle(layer);
        saveConfig();
      });
      card.querySelector('[data-layer-remove]').addEventListener('click', () => removeLayer(layer.id));
    });
    updateFeatureCount();
  }

  function applyLayerStyle(layer) {
    renderMapLayer(layer);
  }

  function removeLayer(id) {
    const index = state.layers.findIndex(layer => layer.id === id);
    if (index < 0) return;
    map.removeLayer(state.layers[index].leaflet);
    state.layers.splice(index, 1);
    renderLayers();
    saveConfig();
    scheduleArRefresh(10);
  }

  function scheduleMapRefresh(delay) {
    clearTimeout(state.queryTimer);
    state.queryTimer = setTimeout(refreshMapFeatures, delay);
  }

  async function refreshMapFeatures() {
    const generation = ++state.queryGeneration;
    const bounds = map.getBounds();
    const bbox = { west: bounds.getWest(), south: bounds.getSouth(), east: bounds.getEast(), north: bounds.getNorth() };
    const visible = state.layers.filter(layer => layer.visible);
    await Promise.all(visible.map(async layer => {
      try {
        const client = new FeatureServer.FeatureServerClient({ proxy: layer.proxy });
        const result = await client.queryBounds(layer, bbox, { maxFeatures: 4000 });
        if (generation !== state.queryGeneration) return;
        layer.features = result.features;
        layer.truncated = result.truncated;
        renderMapLayer(layer);
      } catch (error) {
        log('query-error', { layer: layer.name, message: error.message });
      }
    }));
    if (generation === state.queryGeneration) renderLayers();
  }

  function scheduleArRefresh(delay) {
    clearTimeout(state.arQueryTimer);
    state.arQueryTimer = setTimeout(refreshArFeatures, delay);
  }

  async function refreshArFeatures() {
    clearTimeout(state.arQueryTimer);
    state.arQueryTimer = null;
    if (!state.position) {
      state.arFeatures = [];
      arViewer.setFeatures([]);
      els.arSpatialStatus.textContent = '0';
      updateElevationStatus();
      showMessage('Enable location before loading nearby AR features.');
      return;
    }
    const radius = Number(els.arRange.value);
    const bbox = GeoTools.bboxAround(state.position.lat, state.position.lng, radius);
    const spatialLimit = Math.max(1, Number(els.arSpatialLimit.value) || 500);
    const queryLimitPerLayer = Math.min(20000, Math.max(2000, spatialLimit * 3));
    const candidates = [];
    await Promise.all(state.layers.filter(layer => layer.visible).map(async layer => {
      try {
        const client = new FeatureServer.FeatureServerClient({ proxy: layer.proxy });
        const result = await client.queryBounds(layer, bbox, { maxFeatures: queryLimitPerLayer });
        result.features.forEach(feature => {
          const point = GeoTools.representativePoint(feature.geometry);
          if (!point) return;
          const distance = GeoTools.distanceMetres(state.position, point);
          if (distance > radius) return;
          candidates.push({
            feature,
            layer,
            layerName: layer.name,
            colour: layer.colour,
            point,
            distance,
            bearing: GeoTools.bearingDegrees(state.position, point),
            elevationAngle: GeoTools.elevationAngleDegrees(state.position, point),
            label: featureLabel(feature, layer)
          });
        });
      } catch (error) {
        log('ar-query-error', { layer: layer.name, message: error.message });
      }
    }));
    candidates.sort((a, b) => a.distance - b.distance);
    const spatialItems = candidates.slice(0, spatialLimit);
    state.arFeatures = spatialItems;
    arViewer.setLabelLimit(Number(els.arMaxFeatures.value) || 75);
    arViewer.setFeatures(spatialItems);
    els.arSpatialStatus.textContent = candidates.length > spatialItems.length ? `${spatialItems.length}/${candidates.length}` : String(spatialItems.length);
    state.arQueryPosition = { lat: state.position.lat, lng: state.position.lng };
    log('ar-refresh', {
      radius,
      candidates: candidates.length,
      spatialLimit,
      spatialItems: spatialItems.length,
      labelLimit: Number(els.arMaxFeatures.value) || 75,
      queryLimitPerLayer
    });
    void refreshArElevation(false, spatialItems);
  }

  function featureLabel(feature, layer) {
    const props = feature.properties || {};
    const preferred = ['applicationnumber', 'ApplicationNumber', 'application_number', layer.metadata.displayField, 'name', 'Name', 'NAME', 'label', 'Label', 'title', 'Title'].filter(Boolean);
    for (const key of preferred) {
      if (props[key] != null && String(props[key]).trim()) return String(props[key]);
    }
    const objectId = layer.metadata.objectIdField && props[layer.metadata.objectIdField];
    return objectId != null ? `${layer.name} ${objectId}` : layer.name;
  }

  function showFeature(feature, layer, arItem = null) {
    const props = feature?.properties || {};
    const rows = Object.entries(props).filter(([, value]) => value !== null && value !== '').slice(0, 60);
    const spatial = arItem ? `<div class="spatial-summary"><h4>AR spatial position</h4><dl>
        <dt>Distance</dt><dd>${escapeHtml(GeoTools.formatDistance(arItem.distance))}</dd>
        <dt>Bearing</dt><dd>${Number.isFinite(arItem.bearing) ? `${Math.round(arItem.bearing)}°` : 'Unknown'}</dd>
        <dt>Ground elevation</dt><dd>${formatElevation(arItem.groundElevationM)}</dd>
        <dt>Target altitude</dt><dd>${formatElevation(arItem.targetAltitudeM)}</dd>
        <dt>Observer altitude</dt><dd>${formatElevation(arItem.observerAltitudeM)}</dd>
        <dt>Vertical difference</dt><dd>${formatSignedMetres(arItem.verticalDeltaM)}</dd>
        <dt>Elevation angle</dt><dd>${Number.isFinite(arItem.elevationAngle) ? `${arItem.elevationAngle > 0 ? '+' : ''}${arItem.elevationAngle.toFixed(1)}°` : 'Unknown'}</dd>
        <dt>Height source</dt><dd>${escapeHtml(arItem.elevationSource || 'Horizontal only')}</dd>
      </dl></div>` : '';
    const clusterMembers = Array.isArray(arItem?._arClusterMembers) ? arItem._arClusterMembers : [];
    const cluster = clusterMembers.length > 1 ? `<div class="spatial-summary cluster-summary"><h4>${clusterMembers.length} overlapping AR items</h4><p class="muted">The nearest item is shown on top. Select another item below or change AR overlap handling to fade or show every item.</p><div class="cluster-member-list">${clusterMembers.slice(0, 40).map((member, index) => `<button type="button" data-cluster-member="${index}"><strong>${escapeHtml(member.label || member.layerName || 'Feature')}</strong><span>${escapeHtml(GeoTools.formatDistance(member.distance))}${Number.isFinite(member.groundElevationM) ? ` · ${Math.round(member.groundElevationM)} m ground` : ''}</span></button>`).join('')}</div>${clusterMembers.length > 40 ? `<p class="muted">Showing the nearest 40 of ${clusterMembers.length} items.</p>` : ''}</div>` : '';
    els.featureDialogContent.innerHTML = `<h3>${escapeHtml(featureLabel(feature, layer))}</h3>
      <p class="muted">${escapeHtml(layer.name)}</p>
      ${cluster}
      ${spatial}
      <table class="feature-table"><tbody>${rows.map(([key, value]) => `<tr><th>${escapeHtml(fieldAlias(layer, key))}</th><td>${formatValue(value)}</td></tr>`).join('')}</tbody></table>`;
    els.featureDialogContent.querySelectorAll('[data-cluster-member]').forEach(button => {
      button.addEventListener('click', () => {
        const member = clusterMembers[Number(button.dataset.clusterMember)];
        if (member) showFeature(member.feature, member.layer, member);
      });
    });
    if (!els.featureDialog.open) els.featureDialog.showModal();
  }

  function fieldAlias(layer, key) {
    const field = (layer.metadata.fields || []).find(item => item.name === key);
    return field?.alias || key;
  }

  function formatElevation(value) {
    return Number.isFinite(value) ? `${Math.round(value)} m` : 'Unknown';
  }

  function formatSignedMetres(value) {
    if (!Number.isFinite(value)) return 'Unknown';
    return `${value > 0 ? '+' : ''}${value.toFixed(1)} m`;
  }

  function formatValue(value) {
    if (typeof value === 'number' && value > 1e11 && value < 4e12) {
      const date = new Date(value);
      if (!Number.isNaN(date.valueOf())) return escapeHtml(date.toLocaleString('en-NZ'));
    }
    if (typeof value === 'object') return escapeHtml(JSON.stringify(value));
    return escapeHtml(String(value));
  }

  function setMode(mode) {
    state.mode = mode;
    const isMap = mode === 'map';
    els.mapView.classList.toggle('active-view', isMap);
    els.arView.classList.toggle('active-view', !isMap);
    els.mapModeBtn.classList.toggle('active', isMap);
    els.arModeBtn.classList.toggle('active', !isMap);
    els.mapModeBtn.setAttribute('aria-selected', String(isMap));
    els.arModeBtn.setAttribute('aria-selected', String(!isMap));
    els.sidebar.classList.remove('open');
    if (isMap) setTimeout(() => { map.invalidateSize(); updateMapDirection(); refreshMapRendering(); }, 0); else scheduleArRefresh(30);
  }

  async function enableAr() {
    els.enableArBtn.disabled = true;
    els.enableArBtn.textContent = 'Requesting access…';
    log('ar-enable-start', { userActivation: Boolean(navigator.userActivation?.isActive), platform: mobilePlatform() });
    const result = await arViewer.enable();
    const allReady = result.camera && result.orientation && result.location;
    els.enableArBtn.textContent = allReady ? 'AR access enabled' : 'Retry camera and sensors';
    els.enableArBtn.disabled = false;
    updatePermissionHelp(result);
    log('ar-enable-result', result);
    if (result.location) await refreshArFeatures();
  }

  async function enableMapTracking() {
    const orientationPromise = arViewer.enableOrientation();
    const locationPromise = arViewer.enableLocation();
    const [orientation, location] = await Promise.all([orientationPromise, locationPromise]);
    log('map-tracking-enable', { orientation, location });
    updateMapDirection();
    if (location && state.position) map.setView([state.position.lat, state.position.lng], Math.max(map.getZoom(), 16));
    updatePermissionHelp({ orientation, location });
  }

  function requestLocation() {
    if (!navigator.geolocation) return showMessage('Geolocation is not available in this browser.');
    navigator.geolocation.getCurrentPosition(pos => {
      state.position = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, altitude: pos.coords.altitude, altitudeAccuracy: pos.coords.altitudeAccuracy, timestamp: pos.timestamp };
      els.locationStatus.textContent = `±${Math.round(pos.coords.accuracy)} m`;
      els.hudAccuracy.textContent = `±${Math.round(pos.coords.accuracy)} m`;
      updateUserMarker();
      updateMapDirection();
      updatePermissionHelp();
      map.setView([state.position.lat, state.position.lng], Math.max(map.getZoom(), 16));
    }, error => {
      const detail = { code: error.code, message: error.message || '', platform: mobilePlatform() };
      log('location-request-error', detail);
      els.locationStatus.textContent = error.code === 1 ? 'Denied' : error.code === 3 ? 'Timed out' : 'Unavailable';
      updatePermissionHelp();
      showMessage(error.code === 1 ? locationDeniedMessage() : error.code === 3 ? 'Location request timed out. Try again outdoors or with a clearer sky view.' : 'Could not get your location.');
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 3000 });
  }

  function mobilePlatform() {
    const ua = navigator.userAgent || '';
    if (/iPhone|iPad|iPod/i.test(ua)) return /CriOS/i.test(ua) ? 'iOS Chrome' : 'iOS WebKit';
    if (/Android/i.test(ua)) return 'Android';
    return 'desktop';
  }

  function locationDeniedMessage() {
    if (mobilePlatform().startsWith('iOS')) return 'Location is denied by iPhone or the browser. Allow Location for Chrome in iPhone Settings then retry.';
    return 'Location permission was denied. Allow location for this site then retry.';
  }

  function updatePermissionHelp(result = null) {
    if (!els.permissionHelp || !els.permissionHelpText) return;
    const locationText = els.locationStatus.textContent || '';
    const headingText = els.headingStatus.textContent || '';
    const cameraText = els.cameraStatus.textContent || '';
    const messages = [];
    const platform = mobilePlatform();

    if (/Denied/i.test(locationText)) {
      if (platform === 'iOS Chrome') messages.push('Location: open iPhone Settings > Privacy & Security > Location Services > Chrome. Choose While Using the App and turn Precise Location on. Then return here and retry.');
      else if (platform.startsWith('iOS')) messages.push('Location: open iPhone Settings > Privacy & Security > Location Services and allow location for this browser. Turn Precise Location on for field AR.');
      else messages.push('Location: allow this site to use your location in browser settings then retry.');
    }
    if (/Denied|Unavailable|No sensor data/i.test(headingText)) {
      if (platform.startsWith('iOS')) messages.push('Heading: tap Retry camera and sensors again after reloading this version. iPhone requires the motion/orientation permission request to happen directly from your tap.');
      else messages.push('Heading: allow motion/orientation sensors for this site or device then retry.');
    }
    if (/Denied|Unavailable/i.test(cameraText)) messages.push('Camera: allow camera access for this site or browser then retry.');
    if (result && !result.orientation && !messages.some(item => item.startsWith('Heading:'))) messages.push('Heading: no compass data has been received yet. Keep the phone upright and move it in a figure-eight if calibration is needed.');

    els.permissionHelpText.innerHTML = messages.map(message => `<span>${escapeHtml(message)}</span>`).join('');
    els.permissionHelp.classList.toggle('hidden', messages.length === 0);
  }

  function updateUserMarker() {
    if (!state.position) return;
    const latlng = [state.position.lat, state.position.lng];
    if (!state.userMarker) {
      state.userMarker = L.circleMarker(latlng, { radius: 7, color: '#fff', weight: 2, fillColor: '#13739c', fillOpacity: 1 }).addTo(map).bindTooltip('Your location');
    } else state.userMarker.setLatLng(latlng);
  }

  function updateMapDirection() {
    if (!map || !els.mapFacingEnabled) return;
    const enabled = els.mapFacingEnabled.checked && state.position && state.headingValid && Number.isFinite(state.heading);
    if (!enabled) {
      if (state.mapDirectionLayer && map.hasLayer(state.mapDirectionLayer)) map.removeLayer(state.mapDirectionLayer);
      state.mapDirectionLayer = null;
      if (state.mapHeadingMarker && map.hasLayer(state.mapHeadingMarker)) map.removeLayer(state.mapHeadingMarker);
      state.mapHeadingMarker = null;
      return;
    }

    const origin = { lat: state.position.lat, lng: state.position.lng };
    const zoom = map.getZoom();
    const length = GeoTools.clamp(6000 / Math.pow(2, zoom - 10), 22, 2200);
    const halfAngle = GeoTools.clamp(18 + (16 - zoom) * 1.5, 15, 28);
    const left = GeoTools.destinationPoint(origin, state.heading - halfAngle, length);
    const right = GeoTools.destinationPoint(origin, state.heading + halfAngle, length);
    const forward = GeoTools.destinationPoint(origin, state.heading, length * 1.08);

    if (!state.mapDirectionLayer) {
      state.mapDirectionLayer = L.layerGroup().addTo(map);
      L.polygon([[origin.lat, origin.lng], [left.lat, left.lng], [forward.lat, forward.lng], [right.lat, right.lng]], {
        className: 'map-facing-cone', interactive: false
      }).addTo(state.mapDirectionLayer);
      L.polyline([[origin.lat, origin.lng], [forward.lat, forward.lng]], { className: 'map-facing-ray', interactive: false }).addTo(state.mapDirectionLayer);
    } else {
      const children = state.mapDirectionLayer.getLayers();
      children[0]?.setLatLngs([[origin.lat, origin.lng], [left.lat, left.lng], [forward.lat, forward.lng], [right.lat, right.lng]]);
      children[1]?.setLatLngs([[origin.lat, origin.lng], [forward.lat, forward.lng]]);
    }

    if (!state.mapHeadingMarker) {
      const icon = L.divIcon({ className: 'map-heading-icon', html: '<span class="map-heading-arrow"></span>', iconSize: [24, 24], iconAnchor: [12, 12] });
      state.mapHeadingMarker = L.marker([origin.lat, origin.lng], { icon, interactive: false, zIndexOffset: 1200 }).addTo(map);
    }
    state.mapHeadingMarker.setLatLng([origin.lat, origin.lng]);
    const arrow = state.mapHeadingMarker.getElement()?.querySelector('.map-heading-arrow');
    if (arrow) arrow.style.transform = `rotate(${state.heading.toFixed(1)}deg)`;
  }

  function updateBasemap() {
    if (state.baseLayer) map.removeLayer(state.baseLayer);
    const value = els.basemapSelect.value;
    if (value === 'blank') {
      state.baseLayer = L.layerGroup().addTo(map);
      return;
    }
    const options = value === 'topo'
      ? { url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', attribution: 'Map data © OpenStreetMap contributors, SRTM | Map style © OpenTopoMap' }
      : { url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '© OpenStreetMap contributors' };
    state.baseLayer = L.tileLayer(options.url, { maxZoom: 19, attribution: options.attribution }).addTo(map);
    state.baseLayer.bringToBack();
  }

  async function fitLayers() {
    const extents = state.layers.filter(layer => layer.visible && layer.extent).map(layer => layer.extent);
    if (!extents.length) {
      const points = [];
      state.layers.filter(layer => layer.visible).forEach(layer => {
        layer.features.forEach(feature => {
          const point = GeoTools.representativePoint(feature.geometry);
          if (point) points.push([point.lat, point.lng]);
        });
      });
      const featureBounds = points.length ? L.latLngBounds(points) : null;
      if (featureBounds?.isValid()) map.fitBounds(featureBounds.pad(.08)); else showMessage('No layer extent is available yet.');
      return;
    }
    const combined = extents.reduce((acc, item) => ({
      west: Math.min(acc.west, item.west), south: Math.min(acc.south, item.south), east: Math.max(acc.east, item.east), north: Math.max(acc.north, item.north)
    }));
    fitBoundsObject(combined);
  }

  function fitBoundsObject(bounds) {
    if (![bounds.west, bounds.south, bounds.east, bounds.north].every(Number.isFinite)) return;
    map.fitBounds([[bounds.south, bounds.west], [bounds.north, bounds.east]], { padding: [20, 20], maxZoom: 17 });
  }

  function saveConfig() {
    const config = {
      version: VERSION,
      basemap: els.basemapSelect.value,
      mapFacingEnabled: els.mapFacingEnabled.checked,
      mapPointMode: els.mapPointMode.value,
      mapClusterRadius: Number(els.mapClusterRadius.value),
      arRange: Number(els.arRange.value),
      arSpatialLimit: Number(els.arSpatialLimit.value),
      arMaxFeatures: Number(els.arMaxFeatures.value),
      arOverlapMode: els.arOverlapMode.value,
      arOverlapRadius: Number(els.arOverlapRadius.value),
      headingOffset: Number(els.headingOffset.value),
      cameraFov: Number(els.cameraFov.value),
      elevationEnabled: els.elevationEnabled.checked,
      elevationProvider: els.elevationProvider.value || DEFAULT_ELEVATION_PROVIDER,
      verticalScale: Number(els.verticalScale.value),
      eyeHeight: Number(els.eyeHeight.value),
      targetHeight: Number(els.targetHeight.value),
      sourceElevationMode: els.sourceElevationMode.value,
      sourceElevationField: els.sourceElevationField.value.trim(),
      layers: state.layers.map(layer => ({ url: layer.url, name: layer.name, colour: layer.colour, opacity: layer.opacity, visible: layer.visible, proxy: layer.proxy || '' }))
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }

  async function loadConfig() {
    let config;
    try { config = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch { config = null; }
    if (!config) return;
    els.basemapSelect.value = config.basemap || 'osm';
    els.mapFacingEnabled.checked = config.mapFacingEnabled !== false;
    els.mapPointMode.value = ['auto','cluster','individual'].includes(config.mapPointMode) ? config.mapPointMode : 'auto';
    els.mapClusterRadius.value = String(GeoTools.clamp(Number(config.mapClusterRadius) || 48, 24, 120));
    els.mapClusterRadiusValue.textContent = `${els.mapClusterRadius.value} px`;
    setArRange(config.arRange || 2000, false);
    els.arSpatialLimit.value = String(config.arSpatialLimit || 500);
    if (![...els.arSpatialLimit.options].some(option => option.value === els.arSpatialLimit.value)) els.arSpatialLimit.value = '500';
    els.arSpatialLimitValue.textContent = els.arSpatialLimit.value;
    els.arMaxFeatures.value = String(config.arMaxFeatures || 75);
    if (![...els.arMaxFeatures.options].some(option => option.value === els.arMaxFeatures.value)) els.arMaxFeatures.value = '75';
    els.arMaxFeaturesValue.textContent = els.arMaxFeatures.value;
    arViewer.setLabelLimit(Number(els.arMaxFeatures.value));
    els.arOverlapMode.value = ['cluster','fade','all'].includes(config.arOverlapMode) ? config.arOverlapMode : 'cluster';
    els.arOverlapRadius.value = String(GeoTools.clamp(Number(config.arOverlapRadius) || 44, 16, 120));
    els.arOverlapRadiusValue.textContent = `${els.arOverlapRadius.value} px`;
    arViewer.setOverlapMode(els.arOverlapMode.value);
    arViewer.setOverlapRadius(Number(els.arOverlapRadius.value));
    els.headingOffset.value = String(config.headingOffset || 0);
    els.headingOffsetValue.textContent = `${els.headingOffset.value}°`;
    arViewer.setHeadingOffset(config.headingOffset || 0);
    els.cameraFov.value = String(config.cameraFov || 62);
    els.cameraFovValue.textContent = `${els.cameraFov.value}°`;
    arViewer.setFov(config.cameraFov || 62);
    els.elevationEnabled.checked = config.elevationEnabled !== false;
    const migratedProvider = inferElevationProvider(config.elevationProvider, config.elevationUrl);
    els.elevationProvider.value = migratedProvider;
    updateElevationProviderUi();
    els.verticalScale.value = String(config.verticalScale ?? 1);
    els.verticalScaleValue.textContent = `${Number(els.verticalScale.value).toFixed(1)}×`;
    arViewer.setVerticalScale(Number(els.verticalScale.value) || 1);
    els.eyeHeight.value = String(config.eyeHeight ?? 1.65);
    els.targetHeight.value = String(config.targetHeight ?? 1.5);
    els.sourceElevationMode.value = config.sourceElevationMode || 'ignore';
    els.sourceElevationField.value = config.sourceElevationField || '';
    configureElevationModel(true);
    updateElevationStatus();
    updateBasemap();
    for (const stored of config.layers || []) {
      try {
        const client = new FeatureServer.FeatureServerClient({ proxy: stored.proxy || '' });
        const result = await client.inspect(stored.url);
        if (result.kind !== 'layer') continue;
        await addLayer(result.layerUrl, result.metadata, client, false);
        const layer = state.layers[state.layers.length - 1];
        layer.colour = stored.colour || layer.colour;
        layer.opacity = stored.opacity ?? layer.opacity;
        layer.visible = stored.visible !== false;
        if (!layer.visible) map.removeLayer(layer.leaflet);
        applyLayerStyle(layer);
      } catch (error) {
        log('restore-error', { url: stored.url, message: error.message });
      }
    }
    renderLayers();
    if (state.layers.length) fitLayers();
  }

  function updateFeatureCount() {
    const total = state.layers.filter(layer => layer.visible).reduce((sum, layer) => sum + layer.features.length, 0);
    els.featureCount.textContent = String(total);
  }

  function inferElevationProvider(provider, legacyUrl) {
    const mode = String(provider || '').trim().toLowerCase();
    if (mode === 'terrarium' || mode === 'open-meteo' || mode === 'auto') return mode;
    const url = String(legacyUrl || '').toLowerCase();
    if (url.includes('api.open-meteo.com/v1/elevation')) return 'open-meteo';
    if (url.includes('elevation-tiles-prod/terrarium')) return 'terrarium';
    return 'auto';
  }

  function setArRange(value, refresh = false) {
    const parsed = Number(value);
    const next = Math.round(GeoTools.clamp(Number.isFinite(parsed) ? parsed : 2000, 25, 50000) / 25) * 25;
    els.arRange.value = String(next);
    if (els.arRangeNumber) els.arRangeNumber.value = String(next);
    els.arRangeValue.textContent = formatRange(next);
    if (refresh) {
      saveConfig();
      scheduleArRefresh(180);
    }
    return next;
  }

  function formatRange(value) {
    return value < 1000 ? `${value} m` : `${(value / 1000).toFixed(value % 1000 ? 1 : 0)} km`;
  }

  function setBusy(container, busy) {
    container.querySelectorAll('button, input, select').forEach(el => { el.disabled = busy; });
  }

  function showMessage(message) {
    els.mapMessage.textContent = message;
    els.mapMessage.classList.remove('hidden');
    clearTimeout(showMessage.timer);
    showMessage.timer = setTimeout(() => els.mapMessage.classList.add('hidden'), 4200);
  }

  function log(type, detail) {
    state.debug.push({ time: new Date().toISOString(), type, detail });
    if (state.debug.length > 300) state.debug.shift();
  }

  async function exportDiagnostics() {
    const permissions = {};
    if (navigator.permissions?.query) {
      for (const name of ['geolocation', 'camera']) {
        try { permissions[name] = (await navigator.permissions.query({ name })).state; } catch { permissions[name] = 'query-unsupported'; }
      }
    }
    const payload = {
      appVersion: VERSION,
      spatialSubsystemVersion: window.WorkbenchAR?.VERSION || null,
      time: new Date().toISOString(),
      location: location.href,
      secureContext: window.isSecureContext,
      online: navigator.onLine,
      userAgent: navigator.userAgent,
      platform: mobilePlatform(),
      userActivation: {
        isActive: Boolean(navigator.userActivation?.isActive),
        hasBeenActive: Boolean(navigator.userActivation?.hasBeenActive)
      },
      capabilities: {
        geolocation: Boolean(navigator.geolocation),
        camera: Boolean(navigator.mediaDevices?.getUserMedia),
        deviceOrientation: typeof DeviceOrientationEvent !== 'undefined',
        orientationPermissionRequest: typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function',
        serviceWorker: 'serviceWorker' in navigator
      },
      permissions,
      status: {
        location: els.locationStatus.textContent,
        heading: els.headingStatus.textContent,
        camera: els.cameraStatus.textContent,
        elevation: els.elevationStatus.textContent,
        arSpatialItems: els.arSpatialStatus.textContent
      },
      settings: {
        mode: state.mode,
        mapFacingEnabled: els.mapFacingEnabled.checked,
        mapPointMode: els.mapPointMode.value,
        mapClusterRadius: Number(els.mapClusterRadius.value),
        arRange: Number(els.arRange.value),
        arSpatialLimit: Number(els.arSpatialLimit.value),
        arLabelLimit: Number(els.arMaxFeatures.value),
        arOverlapMode: els.arOverlapMode.value,
        arOverlapRadius: Number(els.arOverlapRadius.value),
        headingOffset: Number(els.headingOffset.value),
        cameraFov: Number(els.cameraFov.value),
        elevationEnabled: els.elevationEnabled.checked,
        elevationProvider: els.elevationProvider.value || DEFAULT_ELEVATION_PROVIDER,
        tokenFreeRuntime: true,
        verticalScale: Number(els.verticalScale.value),
        eyeHeight: Number(els.eyeHeight.value),
        targetHeight: Number(els.targetHeight.value),
        sourceElevationMode: els.sourceElevationMode.value,
        sourceElevationField: els.sourceElevationField.value.trim()
      },
      elevation: elevationModel?.diagnostics() || null,
      arPerformance: arViewer.getDiagnostics(),
      layers: state.layers.map(layer => ({ name: layer.name, url: layer.url, geometryType: layer.metadata.geometryType, visible: layer.visible, mapFeatureCount: layer.features.length, truncated: layer.truncated })),
      debug: state.debug
    };
    downloadJson(`gis-ar-viewer-diagnostics-${new Date().toISOString().slice(0, 10)}.json`, payload);
  }

  function downloadJson(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function registerServiceWorker() {
    if ('serviceWorker' in navigator && (window.isSecureContext || location.hostname === 'localhost')) {
      navigator.serviceWorker.register('./sw.js').catch(error => log('sw-error', { message: error.message }));
    }
  }

  function escapeHtml(value) {
    return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  }
}());
