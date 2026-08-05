import * as L from "leaflet";
import { featureStyles } from "./data.js";
import {
  loadReferenceViewport,
  mapBoundsLiteral,
  routeRoadNamesForProject
} from "./reference-layers.js";
import {
  applyMagneticControlSnaps,
  deformRouteCoordinates,
  insertRouteAnchor,
  projectPointOntoRoute,
  selectMagneticControlIndexes
} from "./route-editing.js";

const makeMarkerIcon = (feature) =>
  L.divIcon({
    className: "custom-map-marker-wrap",
    html: `<span class="custom-map-marker ${feature.type}">${feature.type === "note" ? "i" : "●"}</span>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17]
  });

const routeEndpointIcon = (key, label) =>
  L.divIcon({
    className: "route-map-marker-wrap",
    html: `<span class="route-map-marker ${key}">${label}</span>`,
    iconSize: [38, 38],
    iconAnchor: [19, 19]
  });

export class MapController {
  constructor(element, project, callbacks = {}) {
    this.element = element;
    this.project = project;
    this.callbacks = callbacks;
    this.tool = "pan";
    this.draftPoints = [];
    this.layerById = new Map();
    this.selectedFeatureId = null;
    this.referenceRenderSequence = 0;
    this.activeRouteStretch = null;

    this.map = L.map(element, {
      zoomControl: false,
      preferCanvas: true
    }).setView([project.lat, project.lng], project.zoom || 13);

    L.control.zoom({ position: "bottomright" }).addTo(this.map);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      crossOrigin: true,
      attribution: "© OpenStreetMap contributors"
    }).addTo(this.map);

    this.map.createPane("editorReferenceAreas");
    this.map.getPane("editorReferenceAreas").style.zIndex = "280";
    this.map.createPane("editorReferenceRoads");
    this.map.getPane("editorReferenceRoads").style.zIndex = "310";
    this.map.createPane("editorReferenceAddresses");
    this.map.getPane("editorReferenceAddresses").style.zIndex = "330";
    this.map.createPane("editorReferenceLabels");
    this.map.getPane("editorReferenceLabels").style.zIndex = "350";
    this.map.createPane("editorFeatures");
    this.map.getPane("editorFeatures").style.zIndex = "410";
    this.map.createPane("editorRouteStretch");
    this.map.getPane("editorRouteStretch").style.zIndex = "500";
    this.map.createPane("editorEditHandles");
    this.map.getPane("editorEditHandles").style.zIndex = "520";
    this.map.createPane("editorRouteEndpoints");
    this.map.getPane("editorRouteEndpoints").style.zIndex = "540";

    this.referenceAreaLayer = L.layerGroup().addTo(this.map);
    this.referenceRoadLayer = L.layerGroup().addTo(this.map);
    this.referenceAddressLayer = L.layerGroup().addTo(this.map);
    this.referenceLabelLayer = L.layerGroup().addTo(this.map);
    this.featureLayer = L.layerGroup().addTo(this.map);
    this.draftLayer = L.layerGroup().addTo(this.map);
    this.editLayer = L.layerGroup().addTo(this.map);
    this.referenceFocusLayer = L.layerGroup().addTo(this.map);
    this.routeEndpointLayer = L.layerGroup().addTo(this.map);
    this.map.on("click", (event) => this.handleMapClick(event));
    this.map.on("moveend", () => {
      const centre = this.map.getCenter();
      this.callbacks.onViewChange?.({
        lat: Number(centre.lat.toFixed(6)),
        lng: Number(centre.lng.toFixed(6)),
        zoom: this.map.getZoom()
      });
      this.renderReferenceLayers();
    });
    this.renderFeatures();
    this.renderRouteEndpoints(project.routing);
    setTimeout(() => {
      this.map.invalidateSize();
      this.renderReferenceLayers();
    }, 0);
  }

  destroy() {
    this.cancelRouteStretch();
    this.map.remove();
  }

  setProject(project) {
    this.project = project;
    this.draftPoints = [];
    this.draftLayer.clearLayers();
    this.clearSelection();
    this.map.setView([project.lat, project.lng], project.zoom || 13);
    this.renderFeatures();
    this.renderRouteEndpoints(project.routing);
    this.renderReferenceLayers(true);
  }

  centreOn(location) {
    const lat = Number(location.lat);
    const lng = Number(location.lng);
    const zoom = Number(location.zoom) || 13;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    this.map.stop();
    this.map.invalidateSize({ animate: false, pan: false });
    this.map.setView([lat, lng], zoom, { animate: false });
  }

  getCentre() {
    const centre = this.map.getCenter();
    return {
      lat: Number(centre.lat.toFixed(7)),
      lng: Number(centre.lng.toFixed(7)),
      zoom: this.map.getZoom()
    };
  }

  clearReferenceLayers() {
    this.referenceAreaLayer.clearLayers();
    this.referenceRoadLayer.clearLayers();
    this.referenceAddressLayer.clearLayers();
    this.referenceLabelLayer.clearLayers();
  }

  async renderReferenceLayers(force = false) {
    const sequence = ++this.referenceRenderSequence;
    const zoom = this.map.getZoom();
    const bounds = mapBoundsLiteral(this.map.getBounds(), 0.025);
    if (force) this.clearReferenceLayers();
    try {
      const viewport = await loadReferenceViewport({
        bounds,
        zoom,
        settings: this.project.referenceLayers,
        routeRoadNames: routeRoadNamesForProject(this.project)
      });
      if (sequence !== this.referenceRenderSequence) return;
      this.clearReferenceLayers();

      if (viewport.active.areas && viewport.areas.length) {
        L.geoJSON(
          {
            type: "FeatureCollection",
            features: viewport.areas.map((area) => ({
              type: "Feature",
              properties: {
                name: area.name,
                type: area.type
              },
              geometry: area.geometry
            }))
          },
          {
            pane: "editorReferenceAreas",
            style: {
              color: "#087f9f",
              dashArray: "8 7",
              fillColor: "#8ed6df",
              fillOpacity: 0.1,
              opacity: 0.72,
              weight: 2.5
            },
            onEachFeature: (feature, layer) => {
              layer.bindTooltip(feature.properties.name, {
                className: "reference-area-label editor-reference-label",
                direction: "center",
                opacity: 0.9,
                pane: "editorReferenceLabels",
                permanent: true
              });
            }
          }
        ).addTo(this.referenceAreaLayer);
      }

      if (viewport.active.roads && viewport.roads.length) {
        L.geoJSON(
          {
            type: "FeatureCollection",
            features: viewport.roads
          },
          {
            pane: "editorReferenceRoads",
            renderer: L.canvas({ padding: 0.25 }),
            style: (feature) => {
              const stateHighway =
                feature.properties?.road_name_type === "State Highway";
              const polygon = ["Polygon", "MultiPolygon"].includes(
                feature.geometry?.type
              );
              return {
                color: stateHighway ? "#f0c514" : "#315f72",
                fillColor: stateHighway ? "#f0c514" : "#7aa6b4",
                fillOpacity: polygon ? 0.18 : 0,
                lineCap: "round",
                lineJoin: "round",
                opacity: stateHighway ? 0.95 : 0.66,
                weight: stateHighway ? 5 : 2.5
              };
            }
          }
        ).addTo(this.referenceRoadLayer);
      }

      viewport.roadNames.forEach((road) => {
        L.tooltip({
          className: `reference-road-name editor-reference-label${road.stateHighway ? " state-highway" : ""}`,
          direction: "center",
          opacity: 0.92,
          pane: "editorReferenceLabels",
          permanent: true
        })
          .setLatLng(road.point)
          .setContent(road.name)
          .addTo(this.referenceLabelLayer);
      });

      viewport.addresses.forEach((address) => {
        L.circleMarker([address.lat, address.lng], {
          pane: "editorReferenceAddresses",
          radius: 4,
          color: "#ffffff",
          fillColor: "#7b3ea1",
          fillOpacity: 0.96,
          opacity: 1,
          weight: 1.5
        })
          .bindTooltip(address.address, {
            className: "reference-address-label editor-reference-label",
            direction: "right",
            offset: [5, 0],
            opacity: 0.94,
            pane: "editorReferenceLabels",
            permanent: true
          })
          .addTo(this.referenceAddressLayer);
      });

      this.callbacks.onReferenceLayersRendered?.({
        surface: "editor",
        zoom,
        active: viewport.active,
        counts: {
          roads: viewport.roads.length,
          roadNames: viewport.roadNames.length,
          addresses: viewport.addresses.length,
          areas: viewport.areas.length
        },
        choices: viewport.choices
      });
    } catch (error) {
      console.error("Could not render editor reference layers", error);
      if (sequence !== this.referenceRenderSequence) return;
      this.clearReferenceLayers();
      this.callbacks.onReferenceLayersRendered?.({
        surface: "editor",
        zoom,
        error: true,
        active: {},
        counts: {}
      });
    }
  }

  focusReferenceFeature(result) {
    this.referenceFocusLayer.clearLayers();
    if (!result) return;
    const tooltipContent = document.createElement("div");
    const strong = document.createElement("strong");
    strong.textContent = result.title;
    tooltipContent.appendChild(strong);
    if (result.subtitle) {
      const detail = document.createElement("div");
      detail.textContent = result.subtitle;
      tooltipContent.appendChild(detail);
    }

    let layer;
    if (result.geometry) {
      layer = L.geoJSON(
        { type: "Feature", properties: {}, geometry: result.geometry },
        {
          style: {
            color: "#087f9f",
            opacity: 1,
            weight: result.type === "area" ? 4 : 9,
            fillColor: "#0ba7c2",
            fillOpacity: result.type === "area" ? 0.12 : 0.04
          }
        }
      ).addTo(this.referenceFocusLayer);
    } else if (result.bounds) {
      layer = L.rectangle(result.bounds, {
        color: "#087f9f",
        dashArray: "10 8",
        fillColor: "#0ba7c2",
        fillOpacity: 0.08,
        weight: 4
      }).addTo(this.referenceFocusLayer);
    } else {
      layer = L.circleMarker([result.lat, result.lng], {
        color: "#ffffff",
        fillColor: "#087f9f",
        fillOpacity: 1,
        radius: 10,
        weight: 4
      }).addTo(this.referenceFocusLayer);
    }

    layer.bindTooltip(tooltipContent, {
      className: "map-tooltip explore-map-tooltip",
      direction: "top",
      permanent: true
    });
    if (result.bounds) {
      this.map.fitBounds(result.bounds, {
        animate: false,
        maxZoom: result.type === "road" ? 16 : 14,
        padding: [45, 45]
      });
    } else {
      this.centreOn(result);
    }
  }

  renderRouteEndpoints(routing = this.project.routing) {
    this.routeEndpointLayer.clearLayers();
    [
      ["start", "A"],
      ["end", "B"]
    ].forEach(([key, label]) => {
      const endpoint = routing?.[key];
      if (!endpoint) return;
      L.marker([endpoint.lat, endpoint.lng], {
        draggable: true,
        autoPan: true,
        pane: "editorRouteEndpoints",
        bubblingMouseEvents: false,
        icon: routeEndpointIcon(key, label)
      })
        .bindTooltip(endpoint.label || `${label} route endpoint`, {
          direction: "top",
          className: "map-tooltip"
        })
        .on("dragend", async (event) => {
          const latLng = event.target.getLatLng();
          const point = await this.resolvePoint(
            [latLng.lat, latLng.lng],
            { type: "route-endpoint", endpoint: key }
          );
          this.callbacks.onRouteEndpointChange?.(key, {
            lat: point[0],
            lng: point[1]
          });
        })
        .addTo(this.routeEndpointLayer);
    });
  }

  setTool(tool) {
    this.tool = tool;
    this.draftPoints = [];
    this.draftLayer.clearLayers();
    if (tool !== "edit") this.clearSelection();
    this.element.classList.toggle(
      "drawing",
      ["closure", "detour", "access", "works", "note"].includes(tool)
    );
    this.callbacks.onToolChange?.(tool);
  }

  handleMapClick(event) {
    if (this.tool === "pan") return;
    if (this.tool === "edit") return;

    const point = [
      Number(event.latlng.lat.toFixed(6)),
      Number(event.latlng.lng.toFixed(6))
    ];
    if (this.tool === "note" || this.tool === "works") {
      const type = this.tool;
      const feature = {
        id: `feature-${Date.now()}`,
        type,
        label:
          type === "note"
            ? `Travel note near ${this.project.area}`
            : `Works location on ${this.project.road}`,
        labelMode: "auto",
        labelPosition: null,
        coordinates: [point]
      };
      this.addFeature(feature);
      this.callbacks.onFeatureCommitted?.(feature);
      return;
    }

    this.draftPoints.push(point);
    this.renderDraft();
    this.callbacks.onDraftChange?.(this.draftPoints.length);
  }

  renderDraft() {
    this.draftLayer.clearLayers();
    if (!this.draftPoints.length) return;
    const style = featureStyles[this.tool];
    L.polyline(this.draftPoints, {
      color: style.color,
      weight: 6,
      opacity: 0.9,
      dashArray: this.draftPoints.length === 1 ? "4 8" : style.dash || undefined
    }).addTo(this.draftLayer);
    this.draftPoints.forEach((point, index) => {
      L.circleMarker(point, {
        radius: index === this.draftPoints.length - 1 ? 6 : 4,
        color: "#ffffff",
        weight: 2,
        fillColor: style.color,
        fillOpacity: 1
      }).addTo(this.draftLayer);
    });
  }

  undoPoint() {
    this.draftPoints.pop();
    this.renderDraft();
    this.callbacks.onDraftChange?.(this.draftPoints.length);
  }

  async finishDrawing() {
    if (this.draftPoints.length < 2 || this.tool === "pan") return null;
    const style = featureStyles[this.tool];
    const feature = {
      id: `feature-${Date.now()}`,
      type: this.tool,
      label: `${style.label} · ${this.project.road}`,
      labelMode: "auto",
      labelPosition: null,
      coordinates: await Promise.all(
        this.draftPoints.map((point) =>
          this.resolvePoint(point, { type: this.tool, road: this.project.road })
        )
      )
    };
    this.draftPoints = [];
    this.draftLayer.clearLayers();
    this.addFeature(feature);
    this.callbacks.onDraftChange?.(0);
    this.callbacks.onFeatureCommitted?.(feature);
    return feature;
  }

  addFeature(feature) {
    this.project.features.push(feature);
    this.renderFeatures();
  }

  removeFeature(id) {
    this.project.features = this.project.features.filter(
      (feature) => feature.id !== id
    );
    if (this.selectedFeatureId === id) this.clearSelection();
    this.renderFeatures();
    this.callbacks.onFeaturesChange?.(this.project.features);
  }

  clearFeatures() {
    this.project.features = [];
    this.draftPoints = [];
    this.draftLayer.clearLayers();
    this.clearSelection();
    this.renderFeatures();
    this.callbacks.onFeaturesChange?.(this.project.features);
  }

  renderFeatures() {
    this.featureLayer.clearLayers();
    this.layerById.clear();

    this.project.features.forEach((feature) => {
      const style = featureStyles[feature.type] || featureStyles.note;
      const latLngs = feature.coordinates;
      if (!Array.isArray(latLngs) || !latLngs.length) return;
      let layer;
      if (
        feature.type === "note" ||
        feature.type === "works" ||
        latLngs.length === 1
      ) {
        layer = L.marker(latLngs[0], {
          icon: makeMarkerIcon(feature),
          draggable: true,
          autoPan: true,
          pane: "editorFeatures",
          bubblingMouseEvents: false
        }).on("dragend", async (event) => {
          const latLng = event.target.getLatLng();
          feature.coordinates[0] = await this.resolvePoint(
            [latLng.lat, latLng.lng],
            feature
          );
          this.renderFeatures();
          this.callbacks.onFeatureEdited?.(feature);
        });
      } else {
        layer = L.polyline(latLngs, {
          pane: "editorFeatures",
          bubblingMouseEvents: false,
          color: style.color,
          weight: style.weight,
          opacity: 0.96,
          lineCap: "round",
          lineJoin: "round",
          dashArray: style.dash || undefined
        });
      }

      layer
        .bindTooltip(
          `<strong>${feature.label}</strong><br><span>${style.label}</span>`,
          { sticky: true, direction: "top", className: "map-tooltip" }
        )
        .on("click", (event) => {
          if (this.tool !== "edit") return;
          L.DomEvent.stopPropagation(event.originalEvent || event);
          this.selectFeature(feature.id);
        })
        .on("contextmenu", () => this.removeFeature(feature.id))
        .addTo(this.featureLayer);
      this.layerById.set(feature.id, layer);
    });
    if (this.selectedFeatureId) this.renderFeatureEditHandles();
  }

  async resolvePoint(point, feature = {}) {
    const normalized = [
      Number(Number(point[0]).toFixed(7)),
      Number(Number(point[1]).toFixed(7))
    ];
    if (!this.callbacks.snapPoint) return normalized;
    const snapped = await this.callbacks.snapPoint(normalized, feature);
    return Array.isArray(snapped) && snapped.length >= 2 ? snapped : normalized;
  }

  clearSelection() {
    this.cancelRouteStretch();
    this.selectedFeatureId = null;
    this.editLayer.clearLayers();
    this.callbacks.onSelectionChange?.(null);
  }

  selectFeature(id) {
    const feature = this.project.features.find((item) => item.id === id);
    if (!feature || !feature.coordinates?.length) return;
    this.selectedFeatureId = id;
    this.renderFeatureEditHandles();
    this.callbacks.onSelectionChange?.(feature);
  }

  focusFeature(id, { select = false } = {}) {
    const feature = this.project.features.find((item) => item.id === id);
    if (!feature?.coordinates?.length) return;
    if (feature.coordinates.length === 1) {
      const zoom = Math.max(this.map.getZoom(), 16);
      this.map.setView(feature.coordinates[0], Math.min(zoom, 18), {
        animate: false
      });
    } else {
      this.map.fitBounds(L.latLngBounds(feature.coordinates), {
        animate: false,
        maxZoom: 16,
        padding: [55, 55]
      });
    }
    if (select) this.selectFeature(id);
  }

  previewRouteDeformation(feature, sourceCoordinates, anchorIndex, targetPoint) {
    const deformation = deformRouteCoordinates(
      sourceCoordinates,
      anchorIndex,
      targetPoint
    );
    this.layerById.get(feature.id)?.setLatLngs(deformation.coordinates);
    return deformation;
  }

  async resolveRouteDeformation(
    feature,
    sourceCoordinates,
    anchorIndex,
    targetPoint
  ) {
    const deformation = deformRouteCoordinates(
      sourceCoordinates,
      anchorIndex,
      targetPoint
    );
    const controlIndexes = selectMagneticControlIndexes(
      deformation.weights,
      anchorIndex
    );
    const snappedControls = await Promise.all(
      controlIndexes.map((index) =>
        this.resolvePoint(deformation.coordinates[index], feature)
      )
    );
    return applyMagneticControlSnaps(
      deformation.coordinates,
      controlIndexes,
      snappedControls
    );
  }

  async resolveRouteEdit(feature, sourceCoordinates, anchorIndex, targetPoint) {
    const networkReplacement =
      await this.callbacks.onRouteStretch?.({
        feature,
        sourceCoordinates,
        anchorIndex,
        sourcePoint: sourceCoordinates[anchorIndex],
        targetPoint
      });
    if (networkReplacement?.coordinates?.length >= 2) {
      if (Array.isArray(networkReplacement.roadNames)) {
        feature.roadNames = networkReplacement.roadNames;
      }
      if (Number.isFinite(Number(networkReplacement.distanceKm))) {
        feature.distanceKm = Number(networkReplacement.distanceKm);
      }
      if (Array.isArray(networkReplacement.routeStops)) {
        feature.routeStops = networkReplacement.routeStops;
      }
      return networkReplacement.coordinates;
    }
    return this.resolveRouteDeformation(
      feature,
      sourceCoordinates,
      anchorIndex,
      targetPoint
    );
  }

  cancelRouteStretch({ restore = true } = {}) {
    const session = this.activeRouteStretch;
    if (!session) return;
    document.removeEventListener("mousemove", session.onMove);
    document.removeEventListener("mouseup", session.onEnd);
    if (session.mapDraggingWasEnabled) this.map.dragging.enable();
    this.element.classList.remove("route-stretching");
    session.anchorLayer?.remove();
    if (restore) {
      this.layerById
        .get(session.feature.id)
        ?.setLatLngs(session.feature.coordinates);
    }
    this.activeRouteStretch = null;
  }

  beginRouteStretch(event, feature) {
    if (
      this.tool !== "edit" ||
      this.selectedFeatureId !== feature.id ||
      this.activeRouteStretch
    ) {
      return;
    }
    const originalEvent = event.originalEvent;
    if (Number(originalEvent?.button || 0) !== 0) return;
    L.DomEvent.stopPropagation(originalEvent || event);
    originalEvent?.preventDefault?.();

    const projected = projectPointOntoRoute(feature.coordinates, [
      event.latlng.lat,
      event.latlng.lng
    ]);
    const anchorLayer = L.circleMarker(projected.coordinate, {
      pane: "editorEditHandles",
      radius: 9,
      color: "#ffffff",
      weight: 3,
      fillColor: "#087f9f",
      fillOpacity: 1,
      interactive: false
    }).addTo(this.editLayer);
    const startX = Number(originalEvent?.clientX || 0);
    const startY = Number(originalEvent?.clientY || 0);
    const session = {
      feature,
      sourceCoordinates: projected.coordinates,
      anchorIndex: projected.anchorIndex,
      anchorLayer,
      lastPoint: projected.coordinate,
      mapDraggingWasEnabled: this.map.dragging.enabled(),
      moved: false,
      onMove: null,
      onEnd: null
    };

    session.onMove = (moveEvent) => {
      moveEvent.preventDefault();
      const pixelDistance = Math.hypot(
        Number(moveEvent.clientX || 0) - startX,
        Number(moveEvent.clientY || 0) - startY
      );
      if (pixelDistance >= 3) session.moved = true;
      const latLng = this.map.mouseEventToLatLng(moveEvent);
      session.lastPoint = [latLng.lat, latLng.lng];
      session.anchorLayer.setLatLng(latLng);
      this.previewRouteDeformation(
        feature,
        session.sourceCoordinates,
        session.anchorIndex,
        session.lastPoint
      );
    };
    session.onEnd = async (endEvent) => {
      if (this.activeRouteStretch !== session) return;
      const latLng = this.map.mouseEventToLatLng(endEvent);
      session.lastPoint = [latLng.lat, latLng.lng];
      const moved = session.moved;
      this.cancelRouteStretch({ restore: !moved });
      if (!moved) return;
      try {
        feature.coordinates = await this.resolveRouteEdit(
          feature,
          session.sourceCoordinates,
          session.anchorIndex,
          session.lastPoint
        );
        this.commitFeatureEdit(feature);
      } catch (error) {
        console.error("Could not stretch route", error);
        this.layerById.get(feature.id)?.setLatLngs(feature.coordinates);
      }
    };

    this.activeRouteStretch = session;
    if (session.mapDraggingWasEnabled) this.map.dragging.disable();
    this.element.classList.add("route-stretching");
    document.addEventListener("mousemove", session.onMove);
    document.addEventListener("mouseup", session.onEnd);
  }

  renderFeatureEditHandles() {
    this.editLayer.clearLayers();
    const feature = this.project.features.find(
      (item) => item.id === this.selectedFeatureId
    );
    if (!feature || feature.coordinates.length < 2) return;
    const coordinates = feature.coordinates;
    L.polyline(coordinates, {
      pane: "editorRouteStretch",
      renderer: L.svg({ pane: "editorRouteStretch", padding: 0.5 }),
      bubblingMouseEvents: false,
      className: "route-stretch-hit",
      color: "#087f9f",
      weight: 28,
      opacity: 0.001,
      lineCap: "round",
      lineJoin: "round",
      interactive: true
    })
      .on("mousedown", (event) => this.beginRouteStretch(event, feature))
      .on("click", (event) =>
        L.DomEvent.stopPropagation(event.originalEvent || event)
      )
      .bindTooltip("Drag onto another road to reroute, or along this road to stretch", {
        direction: "top",
        className: "map-tooltip"
      })
      .addTo(this.editLayer);
    const vertexStep = Math.max(1, Math.ceil(coordinates.length / 70));
    const vertexIndexes = coordinates
      .map((_, index) => index)
      .filter(
        (index) =>
          index === 0 ||
          index === coordinates.length - 1 ||
          index % vertexStep === 0
      );

    vertexIndexes.forEach((coordinateIndex) => {
      L.marker(coordinates[coordinateIndex], {
        draggable: true,
        autoPan: true,
        pane: "editorEditHandles",
        bubblingMouseEvents: false,
        icon: L.divIcon({
          className: "route-edit-vertex-wrap",
          html: `<span class="route-edit-vertex" data-route-edit-index="${coordinateIndex}"></span>`,
          iconSize: [18, 18],
          iconAnchor: [9, 9]
        })
      })
        .on("dragstart", (event) => {
          event.target._routeCoordinates = feature.coordinates.map((point) => [
            point[0],
            point[1]
          ]);
        })
        .on("drag", (event) => {
          const sourceCoordinates =
            event.target._routeCoordinates || feature.coordinates;
          const latLng = event.target.getLatLng();
          this.previewRouteDeformation(
            feature,
            sourceCoordinates,
            coordinateIndex,
            [latLng.lat, latLng.lng]
          );
        })
        .on("dragend", async (event) => {
          const latLng = event.target.getLatLng();
          const sourceCoordinates =
            event.target._routeCoordinates || feature.coordinates;
          feature.coordinates = await this.resolveRouteEdit(
            feature,
            sourceCoordinates,
            coordinateIndex,
            [latLng.lat, latLng.lng]
          );
          delete event.target._routeCoordinates;
          this.commitFeatureEdit(feature);
        })
        .on("contextmenu", () => {
          if (coordinates.length <= 2) return;
          coordinates.splice(coordinateIndex, 1);
          this.commitFeatureEdit(feature);
        })
        .bindTooltip("Drag onto another road to reroute · right-click to remove", {
          direction: "top",
          className: "map-tooltip"
        })
        .addTo(this.editLayer);
    });

    const segmentStep = Math.max(1, Math.ceil((coordinates.length - 1) / 45));
    for (
      let index = 0;
      index < coordinates.length - 1;
      index += segmentStep
    ) {
      const nextIndex = Math.min(index + segmentStep, coordinates.length - 1);
      const insertionSegmentIndex = Math.min(
        index + Math.floor((nextIndex - index) / 2),
        coordinates.length - 2
      );
      const insertion = insertRouteAnchor(
        coordinates,
        insertionSegmentIndex
      );
      const midpoint = insertion.coordinates[insertion.anchorIndex];
      L.marker(midpoint, {
        pane: "editorEditHandles",
        bubblingMouseEvents: false,
        icon: L.divIcon({
          className: "route-add-vertex-wrap",
          html: `<span class="route-add-vertex" data-route-add-segment="${insertionSegmentIndex}">+</span>`,
          iconSize: [20, 20],
          iconAnchor: [10, 10]
        })
        })
        .on("click", async (event) => {
          L.DomEvent.stopPropagation(event.originalEvent || event);
          const anchored = insertRouteAnchor(
            feature.coordinates,
            insertionSegmentIndex,
            midpoint
          );
          anchored.coordinates[anchored.anchorIndex] = await this.resolvePoint(
            anchored.coordinates[anchored.anchorIndex],
            feature
          );
          feature.coordinates = anchored.coordinates;
          this.commitFeatureEdit(feature);
        })
        .bindTooltip("Add a point on this route segment", {
          direction: "top",
          className: "map-tooltip"
        })
        .addTo(this.editLayer);
    }

    const centre = L.latLngBounds(coordinates).getCenter();
    L.marker(centre, {
      draggable: true,
      autoPan: true,
      pane: "editorEditHandles",
      bubblingMouseEvents: false,
      icon: L.divIcon({
        className: "route-move-handle-wrap",
        html: '<span class="route-move-handle">✥</span>',
        iconSize: [32, 32],
        iconAnchor: [16, 16]
      })
    })
      .on("dragstart", (event) => {
        event.target._routeOrigin = [centre.lat, centre.lng];
      })
      .on("dragend", async (event) => {
        const latLng = event.target.getLatLng();
        const [originLat, originLng] = event.target._routeOrigin;
        const latDelta = latLng.lat - originLat;
        const lngDelta = latLng.lng - originLng;
        const translated = coordinates.map(([lat, lng]) => [
          lat + latDelta,
          lng + lngDelta
        ]);
        feature.coordinates =
          translated.length > 120
            ? translated
            : await Promise.all(
                translated.map((point) => this.resolvePoint(point, feature))
              );
        this.commitFeatureEdit(feature);
      })
      .bindTooltip("Drag to move the whole route", {
        direction: "top",
        className: "map-tooltip"
      })
      .addTo(this.editLayer);
  }

  commitFeatureEdit(feature) {
    feature.coordinates = feature.coordinates.map(([lat, lng]) => [
      Number(Number(lat).toFixed(7)),
      Number(Number(lng).toFixed(7))
    ]);
    this.renderFeatures();
    this.callbacks.onFeatureEdited?.(feature);
    if (this.selectedFeatureId === feature.id) {
      this.callbacks.onSelectionChange?.(feature);
    }
  }

  fitFeatures() {
    const points = this.project.features.flatMap((feature) => feature.coordinates);
    if (points.length) {
      this.map.fitBounds(L.latLngBounds(points), {
        padding: [50, 50],
        maxZoom: 15
      });
    }
  }

  importGeoJson(geojson) {
    const incoming = [];
    const addGeometry = (geometry, properties = {}) => {
      if (!geometry) return;
      const type = featureStyles[properties.type] ? properties.type : "closure";
      const base = {
        type,
        label: properties.label || properties.name || featureStyles[type].label,
        labelMode: ["auto", "custom"].includes(properties.labelMode)
          ? properties.labelMode
          : properties.label || properties.name
            ? "custom"
            : "auto",
        labelPosition:
          Array.isArray(properties.labelPosition) &&
          properties.labelPosition.length >= 2 &&
          properties.labelPosition.every((value) =>
            Number.isFinite(Number(value))
          )
            ? properties.labelPosition.map(Number)
            : null,
        generatedBy: properties.generatedBy,
        roadNames: Array.isArray(properties.roadNames)
          ? properties.roadNames
          : undefined,
        routeStops: Array.isArray(properties.routeStops)
          ? properties.routeStops
              .filter(
                (stop) =>
                  stop &&
                  Number.isFinite(Number(stop.lat)) &&
                  Number.isFinite(Number(stop.lng))
              )
              .map((stop) => ({
                road: String(stop.road || stop.label || "Route stop"),
                lat: Number(stop.lat),
                lng: Number(stop.lng)
              }))
          : [],
        avoidRoadNames: Array.isArray(properties.avoidRoadNames)
          ? properties.avoidRoadNames.map(String)
          : [],
        distanceKm: Number.isFinite(Number(properties.distanceKm))
          ? Number(properties.distanceKm)
          : undefined
      };
      if (geometry.type === "LineString") {
        incoming.push({
          ...base,
          id: `feature-${Date.now()}-${incoming.length}`,
          coordinates: geometry.coordinates.map(([lng, lat]) => [lat, lng])
        });
      } else if (geometry.type === "MultiLineString") {
        geometry.coordinates.forEach((line) =>
          incoming.push({
            ...base,
            id: `feature-${Date.now()}-${incoming.length}`,
            coordinates: line.map(([lng, lat]) => [lat, lng])
          })
        );
      } else if (geometry.type === "Point") {
        incoming.push({
          ...base,
          type: properties.type === "works" ? "works" : "note",
          id: `feature-${Date.now()}-${incoming.length}`,
          coordinates: [[geometry.coordinates[1], geometry.coordinates[0]]]
        });
      }
    };

    if (geojson.type === "FeatureCollection") {
      geojson.features.forEach((feature) => {
        if (
          feature.properties?.diagnosticOnly ||
          feature.properties?.type === "network-route-diagnostic"
        ) {
          return;
        }
        addGeometry(feature.geometry, feature.properties);
      });
    } else if (geojson.type === "Feature") {
      if (
        !geojson.properties?.diagnosticOnly &&
        geojson.properties?.type !== "network-route-diagnostic"
      ) {
        addGeometry(geojson.geometry, geojson.properties);
      }
    } else {
      addGeometry(geojson, {});
    }

    this.project.features.push(...incoming);
    this.renderFeatures();
    this.fitFeatures();
    this.callbacks.onFeaturesChange?.(this.project.features);
    return incoming.length;
  }

  toGeoJson() {
    return {
      type: "FeatureCollection",
      name: this.project.headline,
      features: this.project.features.map((feature) => ({
        type: "Feature",
        properties: {
          id: feature.id,
          type: feature.type,
          label: feature.label,
          labelMode: feature.labelMode || undefined,
          labelPosition: feature.labelPosition || undefined,
          road: this.project.road,
          area: this.project.area,
          generatedBy: feature.generatedBy || undefined,
          roadNames: feature.roadNames || undefined,
          routeStops: feature.routeStops?.length
            ? feature.routeStops
            : undefined,
          avoidRoadNames: feature.avoidRoadNames?.length
            ? feature.avoidRoadNames
            : undefined,
          distanceKm: Number.isFinite(Number(feature.distanceKm))
            ? Number(feature.distanceKm)
            : undefined
        },
        geometry:
          feature.type === "note" ||
          feature.type === "works" ||
          feature.coordinates.length === 1
            ? {
                type: "Point",
                coordinates: [
                  feature.coordinates[0][1],
                  feature.coordinates[0][0]
                ]
              }
            : {
                type: "LineString",
                coordinates: feature.coordinates.map(([lat, lng]) => [lng, lat])
              }
      }))
    };
  }
}
