(function () {
  'use strict';

  class ArViewer {
    constructor(options) {
      this.video = options.video;
      this.fallback = options.fallback;
      this.container = options.container;
      this.onStatus = options.onStatus || (() => {});
      this.onPosition = options.onPosition || (() => {});
      this.onHeading = options.onHeading || (() => {});
      this.onFeatureClick = options.onFeatureClick || (() => {});
      this.position = null;
      this.heading = 0;
      this.pitch = 0;
      this.headingOffset = 0;
      this.features = [];
      this.stream = null;
      this.watchId = null;
      this.orientationHandler = event => this.handleOrientation(event);
      this.manualHeading = false;
      this.fov = 62;
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
      this.container.addEventListener('click', event => {
        const marker = event.target.closest('[data-ar-index]');
        if (!marker || !this.container.contains(marker)) return;
        const index = Number(marker.dataset.arIndex);
        if (Number.isInteger(index) && this.features[index]) this.onFeatureClick(this.features[index]);
      });
    }

    async enable() {
      const result = { location: false, orientation: false, camera: false };

      // iOS requires DeviceOrientationEvent.requestPermission() to be called
      // while the button tap still has transient user activation. Do this first
      // before waiting for geolocation or camera callbacks.
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
            timestamp: pos.timestamp
          };
          this.position = next;
          this.updateFeatureMetrics();
          this.onPosition(next);
          this.onStatus('location', `±${Math.round(next.accuracy)} m`, { accuracy: next.accuracy });
          if (first) { first = false; resolve(true); }
        };
        const error = err => {
          const status = err.code === 1 ? 'Denied' : err.code === 3 ? 'Timed out' : 'Unavailable';
          this.onStatus('location', status, { code: err.code, message: err.message || '' });
          if (first) { first = false; resolve(false); }
        };
        this.watchId = navigator.geolocation.watchPosition(success, error, { enableHighAccuracy: true, timeout: 15000, maximumAge: 3000 });
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
        window.addEventListener('deviceorientationabsolute', this.orientationHandler, true);
        window.addEventListener('deviceorientation', this.orientationHandler, true);
        this.orientationSeen = false;
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
        this.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
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
      let heading = null;
      let source = 'unknown';
      if (Number.isFinite(event.webkitCompassHeading)) {
        heading = event.webkitCompassHeading;
        source = 'webkitCompassHeading';
      } else if (Number.isFinite(event.alpha) && (event.absolute === true || event.type === 'deviceorientationabsolute')) {
        const screenAngle = Number(screen.orientation?.angle || window.orientation || 0);
        heading = GeoTools.normaliseHeading(360 - event.alpha + screenAngle);
        source = 'absolute-alpha';
      }
      if (heading == null) return;

      this.orientationSeen = true;
      clearTimeout(this.orientationTimer);
      this.manualHeading = false;
      this.heading = GeoTools.normaliseHeading(heading + this.headingOffset);
      this.pitch = Number.isFinite(event.beta) ? event.beta - 90 : 0;
      this.orientationEvents += 1;
      this.updateRates();

      const now = performance.now();
      if (now - this.lastHudUpdate >= 80) {
        this.lastHudUpdate = now;
        this.onHeading(this.heading, this.pitch);
      }
      if (now - this.lastStatusUpdate >= 500) {
        this.lastStatusUpdate = now;
        this.onStatus('heading', `${Math.round(this.heading)}°`, {
          source,
          absolute: Boolean(event.absolute),
          compassAccuracy: Number.isFinite(event.webkitCompassAccuracy) ? event.webkitCompassAccuracy : null,
          orientationHz: this.orientationHz,
          renderHz: this.renderHz
        });
      }
      this.scheduleRender();
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
      this.heading = GeoTools.normaliseHeading(Number(value) + this.headingOffset);
      this.onHeading(this.heading, this.pitch);
      this.onStatus('heading', `${Math.round(this.heading)}° sim`);
      this.scheduleRender();
    }

    setHeadingOffset(value) {
      const old = this.headingOffset;
      this.headingOffset = Number(value) || 0;
      this.heading = GeoTools.normaliseHeading(this.heading - old + this.headingOffset);
      this.scheduleRender();
    }

    setFeatures(items) {
      this.features = items || [];
      this.rebuildMarkers();
      this.scheduleRender();
    }

    rebuildMarkers() {
      const fragment = document.createDocumentFragment();
      this.markerElements = this.features.map((item, index) => {
        const marker = document.createElement('div');
        marker.className = 'ar-marker';
        marker.dataset.arIndex = String(index);
        marker.style.setProperty('--layer-colour', item.colour || '#147d92');

        const button = document.createElement('button');
        button.type = 'button';
        const strong = document.createElement('strong');
        strong.textContent = item.label || item.layerName || 'Feature';
        const span = document.createElement('span');
        span.textContent = `${item.layerName || 'Layer'} · ${GeoTools.formatDistance(item.distance)} · ${Math.round(item.bearing)}°`;
        button.append(strong, span);
        marker.append(button);
        marker._metaSpan = span;
        fragment.append(marker);
        return marker;
      });
      this.container.replaceChildren(fragment);
    }

    updateFeatureMetrics() {
      if (!this.position || !this.features.length) return;
      this.features.forEach((item, index) => {
        if (!item.point) return;
        item.distance = GeoTools.distanceMetres(this.position, item.point);
        item.bearing = GeoTools.bearingDegrees(this.position, item.point);
        const marker = this.markerElements[index];
        if (marker?._metaSpan) marker._metaSpan.textContent = `${item.layerName || 'Layer'} · ${GeoTools.formatDistance(item.distance)} · ${Math.round(item.bearing)}°`;
      });
      this.scheduleRender();
    }

    scheduleRender() {
      if (this.renderFrame != null) return;
      this.renderFrame = requestAnimationFrame(() => {
        this.renderFrame = null;
        this.render();
      });
    }

    render() {
      const width = this.container.clientWidth || window.innerWidth;
      const height = this.container.clientHeight || window.innerHeight;
      const hFov = this.fov;
      const visibleMargin = 12;
      const pitchOffset = GeoTools.clamp(this.pitch * .28, -12, 12);

      this.features.forEach((item, index) => {
        const marker = this.markerElements[index];
        if (!marker) return;
        const relative = GeoTools.signedAngle(item.bearing - this.heading);
        const xPercent = 50 + (relative / hFov) * 100;
        const distanceFactor = 1 - Math.min(item.distance, 10000) / 13000;
        const lane = (index % 5) - 2;
        const yPercent = 49 + lane * 7 + pitchOffset;
        const offscreen = xPercent < -visibleMargin || xPercent > 100 + visibleMargin;
        const scale = GeoTools.clamp(.72 + distanceFactor * .28, .68, 1);
        const x = width * xPercent / 100;
        const y = height * yPercent / 100;

        marker.classList.toggle('offscreen', offscreen);
        marker.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%) scale(${scale.toFixed(3)})`;
      });

      this.renderFrames += 1;
      this.updateRates();
    }

    getDiagnostics() {
      return {
        heading: this.heading,
        pitch: this.pitch,
        orientationSeen: this.orientationSeen,
        orientationHz: this.orientationHz,
        renderHz: this.renderHz,
        markerCount: this.features.length,
        manualHeading: this.manualHeading
      };
    }

    stop() {
      if (this.watchId != null && navigator.geolocation) navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
      window.removeEventListener('deviceorientationabsolute', this.orientationHandler, true);
      window.removeEventListener('deviceorientation', this.orientationHandler, true);
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
