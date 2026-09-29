(function () {
  'use strict';

  const DEG = Math.PI / 180;
  const RAD = 180 / Math.PI;

  function finite(value) {
    return Number.isFinite(value) ? value : null;
  }

  function cameraPoseFromOrientation(event) {
    const alpha = finite(event.alpha);
    const beta = finite(event.beta);
    const gamma = finite(event.gamma);
    if (alpha == null || beta == null || gamma == null) return null;

    const a = alpha * DEG;
    const b = beta * DEG;
    const g = gamma * DEG;

    // Transform the back camera look vector through the DeviceOrientation
    // Z-X-Y Euler rotations. X is east, Y is north and Z is up.
    const east = -Math.cos(a) * Math.sin(g) - Math.sin(a) * Math.cos(g) * Math.sin(b);
    const north = -Math.sin(a) * Math.sin(g) + Math.cos(a) * Math.cos(g) * Math.sin(b);
    const up = -Math.cos(g) * Math.cos(b);
    const horizontal = Math.hypot(east, north);

    if (horizontal < 0.015) return {
      yaw: null,
      pitch: GeoTools.clamp(Math.atan2(up, horizontal) * RAD, -89, 89),
      alpha,
      beta,
      gamma
    };

    return {
      yaw: GeoTools.normaliseHeading(Math.atan2(east, north) * RAD),
      pitch: GeoTools.clamp(Math.atan2(up, horizontal) * RAD, -89, 89),
      alpha,
      beta,
      gamma
    };
  }

  class ArViewer {
    constructor(options) {
      this.video = options.video;
      this.fallback = options.fallback;
      this.container = options.container;
      this.anchorCanvas = options.anchorCanvas || null;
      this.anchorContext = this.anchorCanvas?.getContext?.('2d', { alpha: true }) || null;
      this.horizon = options.horizon || null;
      this.onStatus = options.onStatus || (() => {});
      this.onPosition = options.onPosition || (() => {});
      this.onHeading = options.onHeading || (() => {});
      this.onFeatureClick = options.onFeatureClick || (() => {});
      this.position = null;
      this.heading = 0;
      this.sensorHeading = 0;
      this.compassHeading = null;
      this.rawYaw = null;
      this.pitch = 0;
      this.headingOffset = 0;
      this.features = [];
      this.labelLimit = Math.max(0, Number(options.labelLimit) || 75);
      this.labelFeatureIndexes = [];
      this.visibleAnchorCount = 0;
      this.visibleGroupCount = 0;
      this.clusteredItemCount = 0;
      this.occludedItemCount = 0;
      this.overlapMode = ['cluster','fade','all'].includes(options.overlapMode) ? options.overlapMode : 'cluster';
      this.overlapRadius = GeoTools.clamp(Number(options.overlapRadius) || 44, 12, 160);
      this.stream = null;
      this.watchId = null;
      this.orientationHandler = event => this.handleOrientation(event);
      this.screenOrientationHandler = () => { this.reanchorPending = true; this.scheduleRender(); };
      this.manualHeading = false;
      this.fov = 62;
      this.verticalFov = 46;
      this.verticalScale = 1;
      this.orientationSeen = false;
      this.orientationTimer = null;
      this.markerElements = [];
      this.renderFrame = null;
      this.lastHudUpdate = 0;
      this.lastStatusUpdate = 0;
      this.orientationEvents = 0;
      this.renderFrames = 0;
      this.rateWindowStarted = performance.now();
      this.orientationHz = 0;
      this.renderHz = 0;

      this.yawOffset = null;
      this.yawMode = 'waiting';
      this.yawVelocity = 0;
      this.lastRawYaw = null;
      this.lastRawYawTime = 0;
      this.yawMovingUntil = 0;
      this.reanchorPending = false;
      this.pose = null;

      this.container.addEventListener('click', event => {
        const marker = event.target.closest('[data-ar-index]');
        if (!marker || !this.container.contains(marker)) return;
        const index = Number(marker.dataset.arIndex);
        if (Number.isInteger(index) && this.features[index]) this.onFeatureClick(this.features[index]);
      });
    }

    async enable() {
      const result = { location: false, orientation: false, camera: false };
      result.orientation = await this.enableOrientation();
      result.camera = await this.enableCamera();
      result.location = await this.enableLocation();
      return result;
    }

    async enableLocation() {
      if (!navigator.geolocation) {
        this.onStatus('location', 'Unsupported', { reason: 'geolocation-api-missing' });
        return false;
      }
      if (this.watchId != null) navigator.geolocation.clearWatch(this.watchId);
      return new Promise(resolve => {
        let first = true;
        const success = pos => {
          const next = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            altitude: pos.coords.altitude,
            altitudeAccuracy: pos.coords.altitudeAccuracy,
            timestamp: pos.timestamp
          };
          this.position = next;
          this.updateFeatureMetrics();
          this.onPosition(next);
          this.onStatus('location', `±${Math.round(next.accuracy)} m`, { accuracy: next.accuracy, altitude: next.altitude });
          if (first) { first = false; resolve(true); }
        };
        const error = err => {
          const status = err.code === 1 ? 'Denied' : err.code === 3 ? 'Timed out' : 'Unavailable';
          this.onStatus('location', status, { code: err.code, message: err.message || '' });
          if (first) { first = false; resolve(false); }
        };
        this.watchId = navigator.geolocation.watchPosition(success, error, {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 1500
        });
      });
    }

    async enableOrientation() {
      try {
        if (typeof DeviceOrientationEvent === 'undefined') {
          this.onStatus('heading', 'Unsupported', { reason: 'device-orientation-api-missing' });
          return false;
        }

        if (typeof DeviceOrientationEvent.requestPermission === 'function') {
          const activation = Boolean(navigator.userActivation?.isActive);
          this.onStatus('heading', 'Requesting', { userActivation: activation });
          let permission;
          try {
            permission = await DeviceOrientationEvent.requestPermission();
          } catch (error) {
            this.onStatus('heading', error?.name === 'NotAllowedError' ? 'Tap required' : 'Unavailable', {
              name: error?.name || 'Error',
              message: error?.message || '',
              userActivation: activation
            });
            return false;
          }
          if (permission !== 'granted') {
            this.onStatus('heading', 'Denied', { permission });
            return false;
          }
        }

        window.removeEventListener('deviceorientationabsolute', this.orientationHandler, true);
        window.removeEventListener('deviceorientation', this.orientationHandler, true);
        window.removeEventListener('orientationchange', this.screenOrientationHandler, true);
        if (screen.orientation?.removeEventListener) screen.orientation.removeEventListener('change', this.screenOrientationHandler);
        window.addEventListener('deviceorientationabsolute', this.orientationHandler, true);
        window.addEventListener('deviceorientation', this.orientationHandler, true);
        window.addEventListener('orientationchange', this.screenOrientationHandler, true);
        if (screen.orientation?.addEventListener) screen.orientation.addEventListener('change', this.screenOrientationHandler);
        this.orientationSeen = false;
        this.reanchorPending = true;
        clearTimeout(this.orientationTimer);
        this.orientationTimer = setTimeout(() => {
          if (!this.orientationSeen) this.onStatus('heading', 'No sensor data', { reason: 'orientation-event-timeout' });
        }, 2500);
        this.onStatus('heading', 'Starting', { permission: 'granted-or-not-required' });
        return true;
      } catch (error) {
        this.onStatus('heading', 'Unavailable', { name: error?.name || 'Error', message: error?.message || '' });
        return false;
      }
    }

    async enableCamera() {
      if (!navigator.mediaDevices?.getUserMedia) {
        this.onStatus('camera', 'Unsupported', { reason: 'get-user-media-missing' });
        return false;
      }
      try {
        if (this.stream) this.stream.getTracks().forEach(track => track.stop());
        this.stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 }
          },
          audio: false
        });
        this.video.srcObject = this.stream;
        await this.video.play();
        this.fallback.classList.add('hidden');
        this.onStatus('camera', 'On', { tracks: this.stream.getVideoTracks().length });
        return true;
      } catch (error) {
        this.onStatus('camera', error.name === 'NotAllowedError' ? 'Denied' : 'Unavailable', { name: error.name || 'Error', message: error.message || '' });
        return false;
      }
    }

    handleOrientation(event) {
      const now = performance.now();
      const pose = cameraPoseFromOrientation(event);
      const compass = Number.isFinite(event.webkitCompassHeading)
        ? GeoTools.normaliseHeading(event.webkitCompassHeading)
        : null;

      if (!pose && compass == null) return;
      if (pose && pose.yaw == null && compass == null) return;

      this.orientationSeen = true;
      clearTimeout(this.orientationTimer);
      this.manualHeading = false;
      if (pose) {
        this.pose = pose;
        this.pitch = Number.isFinite(pose.pitch) ? pose.pitch : this.pitch;
      }
      if (compass != null) this.compassHeading = compass;

      if (pose && pose.yaw != null) {
        this.rawYaw = pose.yaw;
        this.updateYawVelocity(pose.yaw, now);

        if (event.absolute === true && compass == null) {
          this.sensorHeading = pose.yaw;
          this.yawMode = 'absolute-euler';
          this.yawOffset = 0;
          this.reanchorPending = false;
        } else {
          if (this.yawOffset == null || this.reanchorPending) {
            const anchor = compass != null ? compass : this.sensorHeading;
            this.yawOffset = GeoTools.signedAngle(anchor - pose.yaw);
            this.reanchorPending = false;
          }

          let fastHeading = GeoTools.normaliseHeading(pose.yaw + this.yawOffset);
          if (compass != null && now >= this.yawMovingUntil) {
            const error = GeoTools.signedAngle(compass - fastHeading);
            const gain = Math.abs(error) > 20 ? 0.08 : 0.035;
            this.yawOffset = GeoTools.signedAngle(this.yawOffset + error * gain);
            fastHeading = GeoTools.normaliseHeading(pose.yaw + this.yawOffset);
          }
          this.sensorHeading = fastHeading;
          this.yawMode = compass != null ? 'fused-relative-compass' : 'relative-euler';
        }
      } else if (compass != null) {
        this.sensorHeading = compass;
        this.yawMode = 'compass-only';
      }

      this.heading = GeoTools.normaliseHeading(this.sensorHeading + this.headingOffset);
      this.orientationEvents += 1;
      this.updateRates();

      if (now - this.lastHudUpdate >= 50) {
        this.lastHudUpdate = now;
        this.onHeading(this.heading, this.pitch);
      }
      if (now - this.lastStatusUpdate >= 500) {
        this.lastStatusUpdate = now;
        this.onStatus('heading', `${Math.round(this.heading)}°`, {
          source: this.yawMode,
          compassHeading: this.compassHeading,
          rawYaw: this.rawYaw,
          yawVelocity: Number(this.yawVelocity.toFixed(1)),
          absolute: Boolean(event.absolute),
          compassAccuracy: Number.isFinite(event.webkitCompassAccuracy) ? event.webkitCompassAccuracy : null,
          orientationHz: this.orientationHz,
          renderHz: this.renderHz
        });
      }
      this.scheduleRender();
    }

    updateYawVelocity(rawYaw, now) {
      if (this.lastRawYaw != null && this.lastRawYawTime) {
        const dt = Math.max(0.001, (now - this.lastRawYawTime) / 1000);
        const delta = GeoTools.signedAngle(rawYaw - this.lastRawYaw);
        const instantaneous = delta / dt;
        this.yawVelocity = this.yawVelocity * 0.55 + instantaneous * 0.45;
        if (Math.abs(this.yawVelocity) > 2.5) this.yawMovingUntil = now + 800;
      }
      this.lastRawYaw = rawYaw;
      this.lastRawYawTime = now;
    }

    updateRates() {
      const now = performance.now();
      const elapsed = now - this.rateWindowStarted;
      if (elapsed < 1000) return;
      const seconds = elapsed / 1000;
      this.orientationHz = Number((this.orientationEvents / seconds).toFixed(1));
      this.renderHz = Number((this.renderFrames / seconds).toFixed(1));
      this.orientationEvents = 0;
      this.renderFrames = 0;
      this.rateWindowStarted = now;
    }

    setManualHeading(value) {
      this.manualHeading = true;
      this.sensorHeading = GeoTools.normaliseHeading(Number(value));
      this.heading = GeoTools.normaliseHeading(this.sensorHeading + this.headingOffset);
      this.yawMode = 'manual';
      this.onHeading(this.heading, this.pitch);
      this.onStatus('heading', `${Math.round(this.heading)}° sim`);
      this.scheduleRender();
    }

    setHeadingOffset(value) {
      this.headingOffset = Number(value) || 0;
      this.heading = GeoTools.normaliseHeading(this.sensorHeading + this.headingOffset);
      this.onHeading(this.heading, this.pitch);
      this.scheduleRender();
    }

    setFov(value) {
      this.fov = GeoTools.clamp(Number(value) || 62, 35, 110);
      this.scheduleRender();
    }

    setVerticalScale(value) {
      this.verticalScale = GeoTools.clamp(Number(value) || 1, 1, 5);
      this.scheduleRender();
    }

    reanchorYaw() {
      if (this.rawYaw != null && this.compassHeading != null) {
        this.yawOffset = GeoTools.signedAngle(this.compassHeading - this.rawYaw);
        this.sensorHeading = GeoTools.normaliseHeading(this.rawYaw + this.yawOffset);
        this.heading = GeoTools.normaliseHeading(this.sensorHeading + this.headingOffset);
        this.reanchorPending = false;
        this.yawMode = 'fused-relative-compass';
      } else {
        this.reanchorPending = true;
      }
      this.scheduleRender();
      return {
        heading: this.heading,
        compassHeading: this.compassHeading,
        rawYaw: this.rawYaw,
        pending: this.reanchorPending
      };
    }

    setLabelLimit(value) {
      const next = Math.max(0, Math.min(500, Number(value) || 0));
      if (next === this.labelLimit) return;
      this.labelLimit = next;
      this.rebuildMarkers();
      this.scheduleRender();
    }

    setOverlapMode(value) {
      const next = ['cluster', 'fade', 'all'].includes(value) ? value : 'cluster';
      if (next === this.overlapMode) return;
      this.overlapMode = next;
      this.scheduleRender();
    }

    setOverlapRadius(value) {
      const next = GeoTools.clamp(Number(value) || 44, 12, 160);
      if (next === this.overlapRadius) return;
      this.overlapRadius = next;
      this.scheduleRender();
    }

    setFeatures(items) {
      this.features = items || [];
      this.updateFeatureMetrics(false);
      this.rebuildMarkers();
      this.scheduleRender();
    }

    chooseLabelFeatureIndexes() {
      const limit = Math.min(this.labelLimit, this.features.length);
      if (!limit) return [];
      const sectorCount = 12;
      const buckets = Array.from({ length: sectorCount }, () => []);
      this.features.forEach((item, index) => {
        const bearing = Number.isFinite(item.bearing) ? GeoTools.normaliseHeading(item.bearing) : 0;
        const sector = Math.min(sectorCount - 1, Math.floor(bearing / (360 / sectorCount)));
        buckets[sector].push({ index, distance: Number(item.distance) || Infinity });
      });
      buckets.forEach(bucket => bucket.sort((a, b) => a.distance - b.distance));
      const selected = [];
      let depth = 0;
      while (selected.length < limit) {
        let added = false;
        for (const bucket of buckets) {
          if (bucket[depth] && selected.length < limit) {
            selected.push(bucket[depth].index);
            added = true;
          }
        }
        if (!added) break;
        depth += 1;
      }
      if (selected.length < limit) {
        const used = new Set(selected);
        const remaining = this.features
          .map((item, index) => ({ index, distance: Number(item.distance) || Infinity }))
          .filter(item => !used.has(item.index))
          .sort((a, b) => a.distance - b.distance);
        for (const item of remaining) {
          selected.push(item.index);
          if (selected.length >= limit) break;
        }
      }
      return selected;
    }

    rebuildMarkers() {
      this.labelFeatureIndexes = this.chooseLabelFeatureIndexes();
      const fragment = document.createDocumentFragment();
      this.markerElements = this.labelFeatureIndexes.map(featureIndex => {
        const item = this.features[featureIndex];
        const marker = document.createElement('div');
        marker.className = 'ar-marker';
        marker.dataset.arIndex = String(featureIndex);
        marker.style.setProperty('--layer-colour', item?.colour || '#147d92');

        const stem = document.createElement('span');
        stem.className = 'ar-anchor-stem';
        stem.setAttribute('aria-hidden', 'true');
        const dot = document.createElement('span');
        dot.className = 'ar-anchor-dot';
        dot.setAttribute('aria-hidden', 'true');

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'ar-marker-card';
        const strong = document.createElement('strong');
        strong.textContent = item?.label || item?.layerName || 'Feature';
        const span = document.createElement('span');
        span.textContent = this.markerMeta(item || {});
        const badge = document.createElement('span');
        badge.className = 'ar-cluster-badge';
        badge.setAttribute('aria-hidden', 'true');
        button.append(strong, span);
        marker.append(stem, dot, badge, button);
        marker._metaSpan = span;
        marker._clusterBadge = badge;
        fragment.append(marker);
        return marker;
      });
      this.container.replaceChildren(fragment);
    }

    markerMeta(item) {
      const parts = [item.layerName || 'Layer', GeoTools.formatDistance(item.distance), `${Math.round(item.bearing)}°`];
      if (Number(item._arClusterCount) > 1) parts.push(`${item._arClusterCount} items`);
      if (Number.isFinite(item.groundElevationM)) parts.push(`${Math.round(item.groundElevationM)} m ground`);
      if (Number.isFinite(item.verticalDeltaM) && Math.abs(item.verticalDeltaM) >= 0.5) parts.push(`${item.verticalDeltaM > 0 ? '+' : ''}${Math.round(item.verticalDeltaM)} m vertical`);
      if (Math.abs(item.elevationAngle || 0) >= 0.25) parts.push(`${item.elevationAngle > 0 ? '+' : ''}${item.elevationAngle.toFixed(1)}° elev`);
      return parts.join(' · ');
    }

    updateFeatureMetrics(schedule = true) {
      if (!this.position || !this.features.length) return;
      this.features.forEach(item => {
        if (!item.point) return;
        item.distance = GeoTools.distanceMetres(this.position, item.point);
        item.bearing = GeoTools.bearingDegrees(this.position, item.point);
        if (Number.isFinite(item.observerAltitudeM) && Number.isFinite(item.targetAltitudeM)) {
          item.verticalDeltaM = item.targetAltitudeM - item.observerAltitudeM;
          item.elevationAngle = Math.atan2(item.verticalDeltaM, Math.max(0.01, item.distance)) * RAD;
        } else {
          item.elevationAngle = GeoTools.elevationAngleDegrees(this.position, item.point);
        }
      });
      this.markerElements.forEach(marker => {
        const item = this.features[Number(marker.dataset.arIndex)];
        if (item && marker._metaSpan) marker._metaSpan.textContent = this.markerMeta(item);
      });
      if (schedule) this.scheduleRender();
    }

    refreshFeatureMetrics() {
      this.updateFeatureMetrics(true);
    }

    scheduleRender() {
      if (this.renderFrame != null) return;
      this.renderFrame = requestAnimationFrame(() => {
        this.renderFrame = null;
        this.render();
      });
    }

    projectItem(item, width, height, tanHalfH, tanHalfV, visibleMargin = 0.24) {
      const relativeYawDeg = GeoTools.signedAngle(item.bearing - this.heading);
      const actualElevationAngle = Number.isFinite(item.elevationAngle) ? item.elevationAngle : 0;
      let projectedElevationAngle = actualElevationAngle;
      if (this.verticalScale !== 1 && Number.isFinite(item.verticalDeltaM) && Number.isFinite(item.distance)) {
        projectedElevationAngle = Math.atan2(item.verticalDeltaM * this.verticalScale, Math.max(0.01, item.distance)) * RAD;
      }
      const relativePitchDeg = projectedElevationAngle - this.pitch;
      const behind = Math.abs(relativeYawDeg) >= 89.5;
      let ndcX = 99;
      let ndcY = 99;
      if (!behind) {
        ndcX = Math.tan(relativeYawDeg * DEG) / tanHalfH;
        ndcY = Math.tan(relativePitchDeg * DEG) / tanHalfV;
      }
      const offscreen = behind || ndcX < -1 - visibleMargin || ndcX > 1 + visibleMargin || ndcY < -1 - visibleMargin || ndcY > 1 + visibleMargin;
      const x = width * (0.5 + ndcX * 0.5);
      const y = height * (0.5 - ndcY * 0.5);
      const distance = Math.max(1, Number(item.distance) || 1);
      return {
        offscreen,
        x,
        y,
        distance,
        scale: GeoTools.clamp(1.08 - Math.log10(distance + 10) * 0.095, 0.72, 1.02),
        opacity: GeoTools.clamp(1.04 - Math.log10(distance + 10) * 0.055, 0.55, 1)
      };
    }

    resolveOverlapGroups(visible) {
      visible.forEach(entry => {
        entry.item._arDisplayHidden = false;
        entry.item._arOccluded = false;
        entry.item._arClusterCount = 1;
        entry.item._arClusterMembers = null;
      });
      if (this.overlapMode === 'all' || !visible.length) {
        this.visibleGroupCount = visible.length;
        this.clusteredItemCount = 0;
        this.occludedItemCount = 0;
        return visible.map(entry => [entry]);
      }

      const radius = Math.max(12, this.overlapRadius);
      const buckets = new Map();
      visible.forEach(entry => {
        const key = `${Math.floor(entry.projection.x / radius)}:${Math.floor(entry.projection.y / radius)}`;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(entry);
      });
      const groups = [...buckets.values()];
      let clustered = 0;
      let occluded = 0;
      groups.forEach(group => {
        group.sort((a, b) => a.projection.distance - b.projection.distance);
        if (this.overlapMode === 'cluster') {
          const representative = group[0];
          representative.item._arClusterCount = group.length;
          representative.item._arClusterMembers = group.map(entry => entry.item);
          group.slice(1).forEach(entry => { entry.item._arDisplayHidden = true; });
          clustered += Math.max(0, group.length - 1);
        } else if (this.overlapMode === 'fade') {
          group.slice(1).forEach(entry => { entry.item._arOccluded = true; occluded += 1; });
        }
      });
      this.visibleGroupCount = groups.length;
      this.clusteredItemCount = clustered;
      this.occludedItemCount = occluded;
      return groups;
    }

    prepareAnchorCanvas(width, height) {
      if (!this.anchorCanvas || !this.anchorContext) return null;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const pixelWidth = Math.max(1, Math.round(width * dpr));
      const pixelHeight = Math.max(1, Math.round(height * dpr));
      if (this.anchorCanvas.width !== pixelWidth || this.anchorCanvas.height !== pixelHeight) {
        this.anchorCanvas.width = pixelWidth;
        this.anchorCanvas.height = pixelHeight;
      }
      if (this.anchorCanvas.style.width !== `${width}px`) this.anchorCanvas.style.width = `${width}px`;
      if (this.anchorCanvas.style.height !== `${height}px`) this.anchorCanvas.style.height = `${height}px`;
      const ctx = this.anchorContext;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      return ctx;
    }

    render() {
      const width = this.container.clientWidth || window.innerWidth;
      const height = this.container.clientHeight || window.innerHeight;
      if (!width || !height) return;

      const hFovRad = this.fov * DEG;
      const aspect = width / height;
      const vFovRad = 2 * Math.atan(Math.tan(hFovRad / 2) / Math.max(0.2, aspect));
      this.verticalFov = vFovRad * RAD;
      const tanHalfH = Math.tan(hFovRad / 2);
      const tanHalfV = Math.tan(vFovRad / 2);
      const visibleMargin = 0.24;

      if (this.horizon) {
        const horizonPitch = (-this.pitch) * DEG;
        const horizonNdcY = Math.tan(horizonPitch) / tanHalfV;
        const horizonY = height * (0.5 - horizonNdcY * 0.5);
        this.horizon.style.top = `${GeoTools.clamp(horizonY, -height * .5, height * 1.5).toFixed(1)}px`;
      }

      const ctx = this.prepareAnchorCanvas(width, height);
      const visible = [];
      this.features.forEach((item, index) => {
        const projection = this.projectItem(item, width, height, tanHalfH, tanHalfV, visibleMargin);
        item._arProjection = projection;
        item._arDisplayHidden = false;
        item._arOccluded = false;
        item._arClusterCount = 1;
        if (!projection.offscreen) visible.push({ item, index, projection });
      });
      const groups = this.resolveOverlapGroups(visible);

      if (ctx) {
        visible.forEach(entry => {
          const { item, projection } = entry;
          if (this.overlapMode === 'cluster' && item._arDisplayHidden) return;
          const radius = GeoTools.clamp(4.8 - Math.log10(projection.distance + 10) * 0.55, 2.1, 4.2);
          const depthOpacity = item._arOccluded ? projection.opacity * 0.18 : projection.opacity;
          ctx.globalAlpha = depthOpacity;
          ctx.beginPath();
          ctx.arc(projection.x, projection.y, radius + 1.2, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255,255,255,.88)';
          ctx.fill();
          ctx.beginPath();
          ctx.arc(projection.x, projection.y, radius, 0, Math.PI * 2);
          ctx.fillStyle = item.colour || '#147d92';
          ctx.fill();
          if (this.overlapMode === 'cluster' && item._arClusterCount > 1) {
            const count = item._arClusterCount;
            const badgeRadius = GeoTools.clamp(7 + Math.log10(count + 1) * 4, 8, 15);
            ctx.globalAlpha = Math.max(.82, projection.opacity);
            ctx.beginPath();
            ctx.arc(projection.x + radius + 5, projection.y - radius - 5, badgeRadius, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(15,23,42,.92)';
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.font = '700 9px system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(count > 999 ? '999+' : String(count), projection.x + radius + 5, projection.y - radius - 5);
          }
        });
        ctx.globalAlpha = 1;
      }
      this.visibleAnchorCount = visible.length;
      this.visibleGroupCount = groups.length;

      this.markerElements.forEach(marker => {
        const item = this.features[Number(marker.dataset.arIndex)];
        const projection = item?._arProjection;
        const displayHidden = this.overlapMode === 'cluster' && item?._arDisplayHidden;
        const hidden = !item || !projection || projection.offscreen || displayHidden;
        marker.classList.toggle('offscreen', hidden);
        marker.classList.toggle('occluded', Boolean(item?._arOccluded));
        const clusterCount = Number(item?._arClusterCount || 1);
        marker.classList.toggle('has-cluster', !hidden && this.overlapMode === 'cluster' && clusterCount > 1);
        if (marker._clusterBadge) marker._clusterBadge.textContent = clusterCount > 999 ? '999+' : String(clusterCount);
        if (hidden) {
          marker.style.opacity = '0';
          return;
        }
        const markerOpacity = item._arOccluded ? projection.opacity * .28 : projection.opacity;
        marker.style.opacity = markerOpacity.toFixed(3);
        marker.style.zIndex = String(Math.max(1, 100000 - Math.round(projection.distance)));
        marker.style.transform = `translate3d(${projection.x.toFixed(1)}px, ${projection.y.toFixed(1)}px, 0) scale(${projection.scale.toFixed(3)})`;
      });

      this.renderFrames += 1;
      this.updateRates();
    }

    getDiagnostics() {
      return {
        heading: this.heading,
        sensorHeading: this.sensorHeading,
        compassHeading: this.compassHeading,
        rawYaw: this.rawYaw,
        yawMode: this.yawMode,
        yawVelocity: Number(this.yawVelocity.toFixed(1)),
        pitch: this.pitch,
        horizontalFov: this.fov,
        verticalFov: Number(this.verticalFov.toFixed(1)),
        verticalScale: this.verticalScale,
        orientationSeen: this.orientationSeen,
        orientationHz: this.orientationHz,
        renderHz: this.renderHz,
        spatialItemCount: this.features.length,
        visibleAnchorCount: this.visibleAnchorCount,
        visibleGroupCount: this.visibleGroupCount,
        overlapMode: this.overlapMode,
        overlapRadius: this.overlapRadius,
        clusteredItemCount: this.clusteredItemCount,
        occludedItemCount: this.occludedItemCount,
        labelLimit: this.labelLimit,
        labelCount: this.markerElements.length,
        elevationMarkerCount: this.features.filter(item => Number.isFinite(item.groundElevationM)).length,
        manualHeading: this.manualHeading,
        pose: this.pose ? {
          alpha: this.pose.alpha,
          beta: this.pose.beta,
          gamma: this.pose.gamma
        } : null
      };
    }

    stop() {
      if (this.watchId != null && navigator.geolocation) navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
      window.removeEventListener('deviceorientationabsolute', this.orientationHandler, true);
      window.removeEventListener('deviceorientation', this.orientationHandler, true);
      window.removeEventListener('orientationchange', this.screenOrientationHandler, true);
      if (screen.orientation?.removeEventListener) screen.orientation.removeEventListener('change', this.screenOrientationHandler);
      if (this.stream) this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
      clearTimeout(this.orientationTimer);
      this.orientationTimer = null;
      if (this.renderFrame != null) cancelAnimationFrame(this.renderFrame);
      this.renderFrame = null;
    }
  }

  window.ArViewer = ArViewer;
}());
