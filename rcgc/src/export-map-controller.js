import * as L from "leaflet";
import { featureStyles } from "./data.js";
import {
  isFarNorthPoint,
  loadFarNorthBoundary
} from "./gis-data.js";
import {
  loadReferenceViewport,
  mapBoundsLiteral,
  routeRoadNamesForProject
} from "./reference-layers.js";
import { escapeHtml } from "./utils.js";

const createPointIcon = (feature) =>
  L.divIcon({
    className: "graphic-point-icon-wrap",
    html: `<span class="graphic-point-icon ${feature.type}">${feature.type === "works" ? "●" : "i"}</span>`,
    iconSize: [42, 42],
    iconAnchor: [21, 21]
  });

const createClosureIcon = () =>
  L.divIcon({
    className: "graphic-closure-icon-wrap",
    html: '<span class="graphic-closure-icon"><i></i></span>',
    iconSize: [52, 52],
    iconAnchor: [26, 26]
  });

const createFeatureLabelIcon = (feature, content, labelClass = "") =>
  L.divIcon({
    className: `graphic-feature-label-marker-wrap ${feature.type}-feature-label-marker`,
    html: `<span class="graphic-feature-label${labelClass}" data-feature-id="${escapeHtml(feature.id)}">${escapeHtml(content)}</span>`,
    iconSize: [320, 80],
    iconAnchor: [0, 40]
  });

const createReferenceLabelIcon = ({
  key,
  content,
  labelClass = ""
}) =>
  L.divIcon({
    className: "reference-label-marker-wrap",
    html: `<span class="${labelClass}" data-reference-label-id="${escapeHtml(key)}">${escapeHtml(content)}</span>`,
    iconSize: [260, 48],
    iconAnchor: [0, 24]
  });

const hasDistanceText = (value) =>
  /\b\d+(?:[.,]\d+)?\s*(?:km|kilomet(?:re|er)s?)\b/i.test(
    String(value || "")
  );

const distanceKm = (coordinates) => {
  const earthRadiusKm = 6371.0088;
  return coordinates.slice(1).reduce((total, [lat, lng], index) => {
    const [previousLat, previousLng] = coordinates[index];
    const toRadians = (value) => (value * Math.PI) / 180;
    const latDelta = toRadians(lat - previousLat);
    const lngDelta = toRadians(lng - previousLng);
    const firstLat = toRadians(previousLat);
    const secondLat = toRadians(lat);
    const haversine =
      Math.sin(latDelta / 2) ** 2 +
      Math.cos(firstLat) *
        Math.cos(secondLat) *
        Math.sin(lngDelta / 2) ** 2;
    return (
      total +
      earthRadiusKm * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
    );
  }, 0);
};

export class ExportMapController {
  constructor(element, project, callbacks = {}) {
    this.element = element;
    this.project = project;
    this.callbacks = callbacks;
    this.contextKey = "";
    this.renderSequence = 0;
    this.suppressViewEvents = false;
    this.userChangingView = false;

    this.map = L.map(element, {
      attributionControl: false,
      boxZoom: false,
      doubleClickZoom: true,
      dragging: true,
      keyboard: true,
      preferCanvas: true,
      scrollWheelZoom: true,
      tap: true,
      touchZoom: true,
      zoomControl: false,
      zoomSnap: 0.25
    }).setView([project.lat, project.lng], Math.max(10, project.zoom || 13));

    this.map.createPane("referenceBoundary");
    this.map.getPane("referenceBoundary").style.zIndex = "230";
    this.map.createPane("referenceAreaPolygons");
    this.map.getPane("referenceAreaPolygons").style.zIndex = "238";
    this.map.createPane("referenceAreas");
    this.map.getPane("referenceAreas").style.zIndex = "245";
    this.map.createPane("referenceRoads");
    this.map.getPane("referenceRoads").style.zIndex = "260";
    this.map.createPane("referenceAddresses");
    this.map.getPane("referenceAddresses").style.zIndex = "300";
    this.map.createPane("referenceLabels");
    this.map.getPane("referenceLabels").style.zIndex = "560";
    this.map.createPane("closureFeatures");
    this.map.getPane("closureFeatures").style.zIndex = "460";
    this.map.createPane("closureLabels");
    this.map.getPane("closureLabels").style.zIndex = "620";

    this.tileLayer = L.tileLayer(
      "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        crossOrigin: true,
        maxZoom: 19
      }
    ).addTo(this.map);
    this.boundaryLayer = L.layerGroup().addTo(this.map);
    this.allAreaLayer = L.layerGroup().addTo(this.map);
    this.areaLayer = L.layerGroup().addTo(this.map);
    this.roadLayer = L.layerGroup().addTo(this.map);
    this.addressLayer = L.layerGroup().addTo(this.map);
    this.referenceLabelLayer = L.layerGroup().addTo(this.map);
    this.featureLayer = L.layerGroup().addTo(this.map);
    this.labelLayer = L.layerGroup().addTo(this.map);
    ["wheel", "dblclick", "keydown", "touchmove"].forEach(
      (eventName) => {
        this.element.addEventListener(
          eventName,
          () => {
            this.userChangingView = true;
          },
          { passive: true }
        );
      }
    );
    this.map.on("dragstart", () => {
      this.userChangingView = true;
    });
    this.map.on("moveend", () => this.handleViewChange());
    this.render(project);
  }

  destroy() {
    this.map.remove();
  }

  withSuppressedViewEvents(action) {
    this.suppressViewEvents = true;
    action();
    requestAnimationFrame(() => {
      this.suppressViewEvents = false;
    });
  }

  handleViewChange() {
    if (this.suppressViewEvents || !this.userChangingView) return;
    this.userChangingView = false;
    const centre = this.map.getCenter();
    this.callbacks.onViewChange?.({
      manual: true,
      lat: Number(centre.lat.toFixed(7)),
      lng: Number(centre.lng.toFixed(7)),
      zoom: Number(this.map.getZoom().toFixed(2))
    });
    const sequence = ++this.renderSequence;
    this.contextKey = "";
    this.renderReferenceContext(sequence);
  }

  async render(project) {
    this.project = project;
    const sequence = ++this.renderSequence;
    this.map.stop();
    this.map.invalidateSize({ animate: false, pan: false });
    this.renderFeatures();
    this.renderArea();
    this.applyProjectView();
    await this.renderReferenceContext(sequence);
  }

  applyProjectView() {
    const publicationMap = this.project.publicationMap || {};
    const hasManualView =
      publicationMap.manual &&
      Number.isFinite(Number(publicationMap.lat)) &&
      Number.isFinite(Number(publicationMap.lng)) &&
      Number.isFinite(Number(publicationMap.zoom));
    this.withSuppressedViewEvents(() => {
      if (hasManualView) {
        this.map.setView(
          [Number(publicationMap.lat), Number(publicationMap.lng)],
          Number(publicationMap.zoom),
          { animate: false }
        );
      } else {
        this.fitProject();
      }
    });
  }

  renderArea() {
    this.areaLayer.clearLayers();
    if (!this.project.areaGeometry) return;
    L.geoJSON(
      {
        type: "Feature",
        properties: {},
        geometry: this.project.areaGeometry
      },
      {
        pane: "referenceAreas",
        style: {
          color: "#087f9f",
          dashArray: "12 8",
          fillColor: "#0ba7c2",
          fillOpacity: 0.08,
          opacity: 0.75,
          weight: 4
        }
      }
    ).addTo(this.areaLayer);
  }

  addFeatureLabel(feature, position, content, labelClass = "") {
    if (!String(content || "").trim()) return;
    const marker = L.marker(position, {
      autoPan: true,
      draggable: false,
      icon: createFeatureLabelIcon(feature, content, labelClass),
      keyboard: true,
      pane: "closureLabels",
      title: `Move ${feature.label || featureStyles[feature.type]?.label || "map"} label`
    })
      .addTo(this.labelLayer);
    this.attachFeatureLabelDragging(marker, feature);
  }

  attachFeatureLabelDragging(marker, feature) {
    const element = marker.getElement();
    if (!element) return;
    let dragging = false;
    let restoreMapDragging = false;
    let pointerId = null;

    const finish = (event) => {
      if (!dragging) return;
      event.preventDefault();
      event.stopPropagation();
      dragging = false;
      element.classList.remove("label-dragging");
      if (
        pointerId !== null &&
        element.hasPointerCapture?.(pointerId)
      ) {
        element.releasePointerCapture(pointerId);
      }
      if (restoreMapDragging) this.map.dragging.enable();
      const latLng = marker.getLatLng();
      const savedPosition = [
        Number(latLng.lat.toFixed(7)),
        Number(latLng.lng.toFixed(7))
      ];
      feature.labelPosition = savedPosition;
      this.callbacks.onFeatureLabelMove?.(feature, savedPosition);
      pointerId = null;
    };

    element.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      dragging = true;
      pointerId = event.pointerId;
      restoreMapDragging = this.map.dragging.enabled();
      this.map.dragging.disable();
      element.setPointerCapture?.(pointerId);
      element.classList.add("label-dragging");
    });
    element.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      event.preventDefault();
      event.stopPropagation();
      marker.setLatLng(this.map.mouseEventToLatLng(event));
    });
    element.addEventListener("pointerup", finish);
    element.addEventListener("pointercancel", finish);
  }

  referenceLabelPosition(key, automaticPosition) {
    const saved = this.project.referenceLabelPositions?.[key];
    return Array.isArray(saved) && saved.length >= 2
      ? saved.map(Number)
      : automaticPosition;
  }

  addReferenceLabel({
    key,
    type,
    position,
    content,
    labelClass
  }) {
    if (
      !key ||
      !String(content || "").trim() ||
      !Array.isArray(position) ||
      position.length < 2
    ) {
      return;
    }
    const marker = L.marker(this.referenceLabelPosition(key, position), {
      autoPan: true,
      bubblingMouseEvents: false,
      draggable: false,
      icon: createReferenceLabelIcon({
        key,
        content,
        labelClass
      }),
      keyboard: true,
      pane: "referenceLabels",
      title: `Move ${content} reference label`
    }).addTo(this.referenceLabelLayer);
    this.attachReferenceLabelDragging(marker, {
      key,
      type,
      label: content
    });
  }

  attachReferenceLabelDragging(marker, referenceLabel) {
    const element = marker.getElement();
    if (!element) return;
    const dragTarget =
      element.querySelector("[data-reference-label-id]") || element;
    let dragging = false;
    let restoreMapDragging = false;
    let pointerId = null;

    const finish = (event) => {
      if (!dragging) return;
      event.preventDefault();
      event.stopPropagation();
      dragging = false;
      element.classList.remove("label-dragging");
      if (
        pointerId !== null &&
        dragTarget.hasPointerCapture?.(pointerId)
      ) {
        dragTarget.releasePointerCapture(pointerId);
      }
      if (restoreMapDragging) this.map.dragging.enable();
      const latLng = marker.getLatLng();
      const savedPosition = [
        Number(latLng.lat.toFixed(7)),
        Number(latLng.lng.toFixed(7))
      ];
      this.project.referenceLabelPositions ||= {};
      this.project.referenceLabelPositions[referenceLabel.key] = savedPosition;
      this.callbacks.onReferenceLabelMove?.({
        ...referenceLabel,
        position: savedPosition
      });
      pointerId = null;
    };

    dragTarget.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      dragging = true;
      pointerId = event.pointerId;
      restoreMapDragging = this.map.dragging.enabled();
      this.map.dragging.disable();
      dragTarget.setPointerCapture?.(pointerId);
      element.classList.add("label-dragging");
    });
    dragTarget.addEventListener("pointermove", (event) => {
      if (!dragging) return;
      event.preventDefault();
      event.stopPropagation();
      marker.setLatLng(this.map.mouseEventToLatLng(event));
    });
    dragTarget.addEventListener("pointerup", finish);
    dragTarget.addEventListener("pointercancel", finish);
  }

  resetReferenceLabelPositions() {
    this.project.referenceLabelPositions = {};
    this.contextKey = "";
    this.renderReferenceContext(++this.renderSequence);
  }

  nudgeFeatureLabel(featureId, xPixels, yPixels) {
    const feature = this.project.features.find((item) => item.id === featureId);
    if (!feature?.coordinates?.length) return;
    const automaticPosition =
      feature.coordinates[Math.floor(feature.coordinates.length / 2)];
    const currentPosition = feature.labelPosition || automaticPosition;
    const point = this.map
      .latLngToLayerPoint(currentPosition)
      .add([Number(xPixels) || 0, Number(yPixels) || 0]);
    const latLng = this.map.layerPointToLatLng(point);
    const savedPosition = [
      Number(latLng.lat.toFixed(7)),
      Number(latLng.lng.toFixed(7))
    ];
    feature.labelPosition = savedPosition;
    this.renderFeatures();
    this.callbacks.onFeatureLabelMove?.(feature, savedPosition);
  }

  renderFeatures() {
    this.featureLayer.clearLayers();
    this.labelLayer.clearLayers();
    const labels = this.project.graphicLabels || {};

    this.project.features.forEach((feature) => {
      const style = featureStyles[feature.type] || featureStyles.note;
      if (!feature.coordinates?.length) return;
      if (
        feature.type === "note" ||
        feature.type === "works" ||
        feature.coordinates.length === 1
      ) {
        L.marker(feature.coordinates[0], {
          icon: createPointIcon(feature),
          pane: "closureFeatures"
        }).addTo(this.featureLayer);
        if (
          labels.showFeatureLabels !== false &&
          String(feature.label || "").trim()
        ) {
          this.addFeatureLabel(
            feature,
            feature.labelPosition || feature.coordinates[0],
            feature.label
          );
        }
        return;
      }

      L.polyline(feature.coordinates, {
        color: style.color,
        dashArray: style.dash || undefined,
        lineCap: "round",
        lineJoin: "round",
        opacity: 1,
        pane: "closureFeatures",
        weight: Math.max(9, style.weight)
      }).addTo(this.featureLayer);

      const midpoint =
        feature.coordinates[Math.floor(feature.coordinates.length / 2)];
      if (feature.type === "closure") {
        L.marker(midpoint, {
          icon: createClosureIcon(),
          pane: "closureLabels"
        }).addTo(this.labelLayer);
      }

      const labelParts = [];
      const showingFeatureLabel =
        labels.showFeatureLabels !== false &&
        String(feature.label || "").trim();
      if (showingFeatureLabel) labelParts.push(feature.label);
      if (
        labels.showDistances !== false &&
        (!showingFeatureLabel || !hasDistanceText(feature.label))
      ) {
        labelParts.push(`${distanceKm(feature.coordinates).toFixed(1)} km`);
      }
      if (!labelParts.length) return;
      const labelClass =
        feature.type === "closure"
          ? " closure-label"
          : feature.type === "detour"
            ? " detour-label"
            : " access-label";
      this.addFeatureLabel(
        feature,
        feature.labelPosition || midpoint,
        labelParts.join(" · "),
        labelClass
      );
    });
  }

  fitProject() {
    const points = this.project.features.flatMap((feature) => [
      ...(feature.coordinates || []),
      ...(Array.isArray(feature.labelPosition) ? [feature.labelPosition] : [])
    ]);
    if (points.length > 1) {
      this.map.fitBounds(L.latLngBounds(points), {
        animate: false,
        maxZoom: 14.5,
        paddingBottomRight: [190, 125],
        paddingTopLeft: [90, 100]
      });
    } else {
      this.map.setView(
        [Number(this.project.lat), Number(this.project.lng)],
        Math.max(11, Math.min(14, Number(this.project.zoom) || 13)),
        { animate: false }
      );
    }
  }

  zoomIn() {
    this.userChangingView = true;
    this.map.setZoom(Math.min(19, this.map.getZoom() + 0.5));
  }

  zoomOut() {
    this.userChangingView = true;
    this.map.setZoom(Math.max(3, this.map.getZoom() - 0.5));
  }

  resetView() {
    this.userChangingView = false;
    this.project.publicationMap = {
      manual: false,
      lat: null,
      lng: null,
      zoom: null
    };
    this.withSuppressedViewEvents(() => this.fitProject());
    this.contextKey = "";
    this.callbacks.onViewChange?.({ ...this.project.publicationMap });
    this.renderReferenceContext(++this.renderSequence);
  }

  clearBundledReferenceLayers() {
    this.boundaryLayer.clearLayers();
    this.allAreaLayer.clearLayers();
    this.roadLayer.clearLayers();
    this.addressLayer.clearLayers();
    this.referenceLabelLayer.clearLayers();
  }

  async renderReferenceContext(sequence) {
    const centre = this.map.getCenter();
    const farNorth = await isFarNorthPoint(centre.lat, centre.lng);
    if (sequence !== this.renderSequence) return;
    if (!farNorth) {
      this.contextKey = "outside-far-north";
      this.clearBundledReferenceLayers();
      this.element.dataset.gisContext = "OpenStreetMap";
      this.callbacks.onReferenceLayersRendered?.({
        surface: "publication",
        zoom: this.map.getZoom(),
        active: {},
        counts: { roads: 0, roadNames: 0, addresses: 0, areas: 0 }
      });
      return;
    }

    const bounds = this.map.getBounds();
    const zoom = this.map.getZoom();
    this.element.dataset.referenceViewport = JSON.stringify({
      centre: [Number(centre.lat.toFixed(6)), Number(centre.lng.toFixed(6))],
      bounds: mapBoundsLiteral(bounds),
      zoom: Number(zoom.toFixed(2))
    });
    const contextKey = [
      bounds.getSouth().toFixed(2),
      bounds.getWest().toFixed(2),
      bounds.getNorth().toFixed(2),
      bounds.getEast().toFixed(2),
      zoom.toFixed(2),
      JSON.stringify(this.project.referenceLayers || {}),
      JSON.stringify(routeRoadNamesForProject(this.project))
    ].join(":");
    if (this.contextKey === contextKey) return;
    this.contextKey = contextKey;

    const [boundary, viewport] = await Promise.all([
      loadFarNorthBoundary(),
      loadReferenceViewport({
        bounds: mapBoundsLiteral(bounds, 0.035),
        zoom,
        settings: this.project.referenceLayers,
        routeRoadNames: routeRoadNamesForProject(this.project)
      })
    ]);
    if (sequence !== this.renderSequence) return;

    this.clearBundledReferenceLayers();
    L.geoJSON(boundary, {
      pane: "referenceBoundary",
      style: {
        color: "#67838e",
        fillColor: "#e9e9e3",
        fillOpacity: 0.08,
        opacity: 0.45,
        weight: 2
      }
    }).addTo(this.boundaryLayer);

    if (viewport.active.areas && viewport.areas.length) {
      L.geoJSON(
        {
          type: "FeatureCollection",
          features: viewport.areas.map((area) => ({
            type: "Feature",
            properties: { name: area.name, type: area.type },
            geometry: area.geometry
          }))
        },
        {
          pane: "referenceAreaPolygons",
          style: {
            color: "#087f9f",
            dashArray: "9 7",
            fillColor: "#58b7c8",
            fillOpacity: 0.09,
            opacity: 0.62,
            weight: 2.5
          }
        }
      ).addTo(this.allAreaLayer);
      viewport.areas.forEach((area) => {
        this.addReferenceLabel({
          key: `area:${area.id}`,
          type: "area",
          position: [Number(area.lat), Number(area.lng)],
          content: area.name,
          labelClass: "reference-area-label publication-reference-label"
        });
      });
    }

    if (viewport.active.roads && viewport.roads.length) {
      L.geoJSON(
        {
          type: "FeatureCollection",
          features: viewport.roads
        },
        {
          pane: "referenceRoads",
          renderer: L.canvas({ padding: 0.25 }),
          style: (feature) => {
            const stateHighway =
              feature.properties?.road_name_type === "State Highway";
            const polygon = ["Polygon", "MultiPolygon"].includes(
              feature.geometry?.type
            );
            return {
              color: stateHighway ? "#f4cf16" : "#ffffff",
              fillColor: stateHighway ? "#f4cf16" : "#ffffff",
              fillOpacity: polygon ? 0.18 : 0,
              lineCap: "round",
              lineJoin: "round",
              opacity: stateHighway ? 0.96 : 0.72,
              weight: stateHighway ? 6 : 2.5
            };
          }
        }
      ).addTo(this.roadLayer);
    }

    viewport.roadNames.forEach((road) => {
      this.addReferenceLabel({
        key: `road:${road.id}`,
        type: "road",
        position: road.point,
        content: road.name,
        labelClass: `reference-road-name publication-reference-label${road.stateHighway ? " state-highway" : ""}`
      });
    });

    viewport.addresses.forEach((address) => {
      L.circleMarker([address.lat, address.lng], {
        pane: "referenceAddresses",
        radius: 4.5,
        color: "#ffffff",
        fillColor: "#7b3ea1",
        fillOpacity: 1,
        opacity: 1,
        weight: 1.5
      }).addTo(this.addressLayer);
      this.addReferenceLabel({
        key: `address:${address.id}`,
        type: "address",
        position: [address.lat, address.lng],
        content: address.address,
        labelClass: "reference-address-label publication-reference-label"
      });
    });

    this.element.dataset.gisContext = "Far North GIS";
    this.callbacks.onReferenceLayersRendered?.({
      surface: "publication",
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
  }

  async prepareForExport() {
    this.map.stop();
    this.map.invalidateSize({ animate: false, pan: false });
    this.applyProjectView();
    await this.renderReferenceContext(this.renderSequence);
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve))
    );
  }
}
