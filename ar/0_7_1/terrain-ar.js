(function () {
  'use strict';

  const VERSION = '0.2.0';
  const DEG = Math.PI / 180;
  const RAD = 180 / Math.PI;
  const EARTH_RADIUS_M = 6371008.8;

  function finite(value, fallback = null) {
    if (value === null || value === undefined || value === '') return fallback;
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function terrainDetailSize(detail) {
    if (detail === 'low') return 17;
    if (detail === 'high') return 33;
    if (detail === 'ultra') return 41;
    return 25;
  }

  function colourForElevation(value, min, max, alpha) {
    const span = Math.max(1, max - min);
    const t = Math.max(0, Math.min(1, (value - min) / span));
    const hue = 132 - t * 92;
    const lightness = 28 + t * 17;
    return `hsla(${hue.toFixed(0)}, 40%, ${lightness.toFixed(0)}%, ${alpha})`;
  }

  class TerrainArRenderer {
    constructor(options = {}) {
      this.canvas = options.canvas || null;
      this.context = this.canvas?.getContext?.('2d', { alpha: true }) || null;
      this.provider = options.provider || null;
      this.mode = options.mode || 'off';
      this.radiusM = Math.max(100, finite(options.radiusM, 2000));
      this.detail = options.detail || 'medium';
      this.opacity = Math.max(0.03, Math.min(0.9, finite(options.opacity, 0.26)));
      this.eyeHeightM = Math.max(0, finite(options.eyeHeightM, 1.65));
      this.verticalScale = Math.max(0.1, finite(options.verticalScale, 1));
      this.curvature = options.curvature !== false;
      this.mesh = null;
      this.position = null;
      this.observerPosition = null;
      this.observerGroundElevationM = null;
      this.observerAltitudeOverrideM = null;
      this.observerOffsetM = 0;
      this.generation = 0;
      this.abortController = null;
      this.last = {
        status: 'idle',
        sampledVertices: 0,
        totalVertices: 0,
        triangles: 0,
        groundMinM: null,
        groundMaxM: null,
        groundSpreadM: null,
        observerGroundElevationM: null,
        radiusM: this.radiusM,
        detail: this.detail,
        lastUpdatedAt: null,
        lastError: null
      };
    }

    setProvider(provider) {
      this.provider = provider || null;
      this.clear();
      return this;
    }

    configure(options = {}) {
      const before = `${this.radiusM}|${this.detail}|${this.eyeHeightM}|${this.verticalScale}`;
      if (options.mode != null) this.mode = String(options.mode);
      if (options.radiusM != null) this.radiusM = Math.max(100, finite(options.radiusM, this.radiusM));
      if (options.detail != null) this.detail = String(options.detail);
      if (options.opacity != null) this.opacity = Math.max(0.03, Math.min(0.9, finite(options.opacity, this.opacity)));
      if (options.eyeHeightM != null) this.eyeHeightM = Math.max(0, finite(options.eyeHeightM, this.eyeHeightM));
      if (options.verticalScale != null) this.verticalScale = Math.max(0.1, finite(options.verticalScale, this.verticalScale));
      if (options.curvature != null) this.curvature = Boolean(options.curvature);
      const after = `${this.radiusM}|${this.detail}|${this.eyeHeightM}|${this.verticalScale}`;
      if (before !== after && this.mesh) this.mesh.projectVersion = (this.mesh.projectVersion || 0) + 1;
      if (this.mode === 'off') this.clearCanvas();
      return this;
    }

    clearCanvas() {
      if (!this.context || !this.canvas) return;
      const width = this.canvas.clientWidth || this.canvas.width || 1;
      const height = this.canvas.clientHeight || this.canvas.height || 1;
      this.context.setTransform(1, 0, 0, 1, 0, 0);
      this.context.clearRect(0, 0, width, height);
    }

    clear() {
      this.mesh = null;
      this.position = null;
      this.observerPosition = null;
      this.observerGroundElevationM = null;
      this.observerAltitudeOverrideM = null;
      this.observerOffsetM = 0;
      if (this.abortController) this.abortController.abort();
      this.abortController = null;
      this.last = { ...this.last, status: 'idle', sampledVertices: 0, totalVertices: 0, triangles: 0, lastError: null };
      this.clearCanvas();
    }

    async refresh(position, options = {}) {
      if (!position || !Number.isFinite(position.lat) || !Number.isFinite(position.lng)) return null;
      if (this.mode === 'off') {
        this.clearCanvas();
        this.last.status = 'off';
        return null;
      }
      if (!this.provider || typeof this.provider.sampleMany !== 'function') {
        this.last = { ...this.last, status: 'unavailable', lastError: 'Elevation provider unavailable' };
        return null;
      }

      if (this.abortController) this.abortController.abort();
      this.abortController = new AbortController();
      const signal = options.signal || this.abortController.signal;
      const generation = ++this.generation;
      const gridSize = terrainDetailSize(this.detail);
      this.last = {
        ...this.last,
        status: 'sampling',
        lastError: null,
        radiusM: this.radiusM,
        detail: this.detail,
        gridSize: `${gridSize}×${gridSize}`,
        totalVertices: gridSize * gridSize
      };

      try {
        const mesh = await this.buildMesh(position, signal);
        if (signal.aborted || generation !== this.generation) return null;
        this.mesh = mesh;
        this.position = { lat: position.lat, lng: position.lng };
        this.observerPosition = { lat: position.lat, lng: position.lng };
        this.observerGroundElevationM = mesh.observerGroundElevationM;
        this.observerAltitudeOverrideM = null;
        this.observerOffsetM = 0;
        this.updateObserver(position, mesh.observerGroundElevationM);
        this.last = {
          status: mesh.sampledVertices ? 'ready' : 'fallback',
          sampledVertices: mesh.sampledVertices,
          totalVertices: mesh.sampleTargetCount,
          triangles: mesh.triangles.length,
          groundMinM: mesh.groundMinM,
          groundMaxM: mesh.groundMaxM,
          groundSpreadM: Number.isFinite(mesh.groundMinM) && Number.isFinite(mesh.groundMaxM) ? mesh.groundMaxM - mesh.groundMinM : null,
          observerGroundElevationM: mesh.observerGroundElevationM,
          radiusM: this.radiusM,
          detail: this.detail,
          gridSize: `${mesh.size}×${mesh.size}`,
          lastUpdatedAt: new Date().toISOString(),
          lastError: null
        };
        return mesh;
      } catch (error) {
        if (signal.aborted) return null;
        this.mesh = null;
        this.position = null;
        this.clearCanvas();
        this.last = { ...this.last, status: 'error', sampledVertices: 0, triangles: 0, lastError: error?.message || String(error), lastUpdatedAt: new Date().toISOString() };
        return null;
      }
    }

    async buildMesh(position, signal) {
      const size = terrainDetailSize(this.detail);
      const radius = this.radiusM;
      const step = (radius * 2) / (size - 1);
      const vertices = [];
      const samplePoints = [];
      let observerIndex = -1;

      for (let row = 0; row < size; row += 1) {
        for (let col = 0; col < size; col += 1) {
          const eastM = -radius + col * step;
          const northM = radius - row * step;
          const distanceM = Math.hypot(eastM, northM);
          const valid = distanceM <= radius * 1.015;
          const bearing = distanceM < 0.01 ? 0 : GeoTools.normaliseHeading(Math.atan2(eastM, northM) * RAD);
          const point = distanceM < 0.01 ? { lat: position.lat, lng: position.lng } : GeoTools.destinationPoint(position, bearing, distanceM);
          const vertex = {
            row,
            col,
            eastM,
            northM,
            distanceM,
            bearing,
            lat: point.lat,
            lng: point.lng,
            valid,
            sampleIndex: -1,
            groundElevationM: null
          };
          if (valid) {
            vertex.sampleIndex = samplePoints.length;
            if (distanceM < step * 0.25) observerIndex = vertex.sampleIndex;
            samplePoints.push({ lat: point.lat, lon: point.lng });
          }
          vertices.push(vertex);
        }
      }

      const values = await this.provider.sampleMany(samplePoints, signal);
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      let sampledVertices = 0;
      let groundMinM = Infinity;
      let groundMaxM = -Infinity;
      vertices.forEach(vertex => {
        if (!vertex.valid || vertex.sampleIndex < 0) return;
        const value = finite(values?.[vertex.sampleIndex]);
        if (value == null) return;
        vertex.groundElevationM = value;
        sampledVertices += 1;
        groundMinM = Math.min(groundMinM, value);
        groundMaxM = Math.max(groundMaxM, value);
      });

      if (!sampledVertices) throw new Error('Terrain source returned no usable elevations');

      let observerGroundElevationM = observerIndex >= 0 ? finite(values?.[observerIndex]) : null;
      if (observerGroundElevationM == null) {
        const observerValues = await this.provider.sampleMany([{ lat: position.lat, lon: position.lng }], signal);
        observerGroundElevationM = finite(observerValues?.[0]);
      }
      if (observerGroundElevationM == null) {
        const nearestSample = vertices
          .filter(vertex => vertex.valid && Number.isFinite(vertex.groundElevationM))
          .sort((a, b) => a.distanceM - b.distanceM)[0];
        observerGroundElevationM = nearestSample ? nearestSample.groundElevationM : null;
      }
      if (observerGroundElevationM == null && Number.isFinite(position.altitude)) observerGroundElevationM = Number(position.altitude) - this.eyeHeightM;
      if (observerGroundElevationM == null) throw new Error('Observer terrain elevation is unavailable');

      const triangles = [];
      const index = (row, col) => row * size + col;
      const addTriangle = (a, b, c) => {
        const va = vertices[a];
        const vb = vertices[b];
        const vc = vertices[c];
        if (!va?.valid || !vb?.valid || !vc?.valid) return;
        if (![va.groundElevationM, vb.groundElevationM, vc.groundElevationM].every(Number.isFinite)) return;
        const avgDistance = (va.distanceM + vb.distanceM + vc.distanceM) / 3;
        const avgElevation = (va.groundElevationM + vb.groundElevationM + vc.groundElevationM) / 3;
        triangles.push({ a, b, c, avgDistance, avgElevation });
      };
      for (let row = 0; row < size - 1; row += 1) {
        for (let col = 0; col < size - 1; col += 1) {
          const a = index(row, col);
          const b = index(row, col + 1);
          const c = index(row + 1, col);
          const d = index(row + 1, col + 1);
          addTriangle(a, b, d);
          addTriangle(a, d, c);
        }
      }
      triangles.sort((a, b) => b.avgDistance - a.avgDistance);
      const bearingBuckets = Array.from({ length: 360 }, () => []);
      vertices.forEach(vertex => {
        if (!vertex.valid || !Number.isFinite(vertex.groundElevationM) || vertex.distanceM < 5) return;
        const bin = Math.round(vertex.bearing) % 360;
        bearingBuckets[bin].push(vertex);
      });
      bearingBuckets.forEach(bucket => bucket.sort((a, b) => a.distanceM - b.distanceM));

      return {
        size,
        radiusM: radius,
        stepM: step,
        vertices,
        triangles,
        sampledVertices,
        sampleTargetCount: samplePoints.length,
        observerGroundElevationM,
        observerAltitudeM: observerGroundElevationM + this.eyeHeightM,
        groundMinM: Number.isFinite(groundMinM) ? groundMinM : null,
        groundMaxM: Number.isFinite(groundMaxM) ? groundMaxM : null,
        bearingBuckets
      };
    }

    groundAtPosition(position) {
      if (!this.mesh || !this.position || !position || !Number.isFinite(position.lat) || !Number.isFinite(position.lng)) return null;
      const distanceM = GeoTools.distanceMetres(this.position, position);
      if (!Number.isFinite(distanceM) || distanceM > this.mesh.radiusM * 1.02) return null;
      const bearing = distanceM < 0.01 ? 0 : GeoTools.bearingDegrees(this.position, position);
      const eastM = Math.sin(bearing * DEG) * distanceM;
      const northM = Math.cos(bearing * DEG) * distanceM;
      const colFloat = (eastM + this.mesh.radiusM) / this.mesh.stepM;
      const rowFloat = (this.mesh.radiusM - northM) / this.mesh.stepM;
      const col0 = Math.floor(colFloat);
      const row0 = Math.floor(rowFloat);
      const col1 = col0 + 1;
      const row1 = row0 + 1;
      if (row0 < 0 || col0 < 0 || row1 >= this.mesh.size || col1 >= this.mesh.size) return null;
      const index = (row, col) => row * this.mesh.size + col;
      const tx = colFloat - col0;
      const ty = rowFloat - row0;
      const samples = [
        { value: this.mesh.vertices[index(row0, col0)]?.groundElevationM, weight: (1 - tx) * (1 - ty) },
        { value: this.mesh.vertices[index(row0, col1)]?.groundElevationM, weight: tx * (1 - ty) },
        { value: this.mesh.vertices[index(row1, col0)]?.groundElevationM, weight: (1 - tx) * ty },
        { value: this.mesh.vertices[index(row1, col1)]?.groundElevationM, weight: tx * ty }
      ].filter(sample => Number.isFinite(sample.value) && sample.weight > 0);
      const weight = samples.reduce((sum, sample) => sum + sample.weight, 0);
      if (weight > 0.0001) return samples.reduce((sum, sample) => sum + sample.value * sample.weight, 0) / weight;

      // A circular mesh has missing corner vertices. Fall back to a small local nearest search.
      let nearest = null;
      for (let dr = -2; dr <= 2; dr += 1) {
        for (let dc = -2; dc <= 2; dc += 1) {
          const row = Math.round(rowFloat) + dr;
          const col = Math.round(colFloat) + dc;
          if (row < 0 || col < 0 || row >= this.mesh.size || col >= this.mesh.size) continue;
          const vertex = this.mesh.vertices[index(row, col)];
          if (!Number.isFinite(vertex?.groundElevationM)) continue;
          const cellDistance = Math.hypot(row - rowFloat, col - colFloat);
          if (!nearest || cellDistance < nearest.distance) nearest = { value: vertex.groundElevationM, distance: cellDistance };
        }
      }
      return nearest ? nearest.value : null;
    }

    async sampleGround(position, signal) {
      if (!position || !Number.isFinite(position.lat) || !Number.isFinite(position.lng)) return null;
      if (this.provider?.sample) {
        const value = finite(await this.provider.sample(position.lat, position.lng, signal));
        if (value != null) return value;
      }
      if (this.provider?.sampleMany) {
        const values = await this.provider.sampleMany([{ lat: position.lat, lon: position.lng }], signal);
        const value = finite(values?.[0]);
        if (value != null) return value;
      }
      return this.groundAtPosition(position);
    }

    updateObserver(position, groundElevationM = null, observerAltitudeM = null) {
      if (!this.mesh || !position || !Number.isFinite(position.lat) || !Number.isFinite(position.lng)) return null;
      const resolvedGround = finite(groundElevationM, this.groundAtPosition(position));
      this.observerPosition = { lat: Number(position.lat), lng: Number(position.lng) };
      this.observerGroundElevationM = resolvedGround != null ? resolvedGround : this.mesh.observerGroundElevationM;
      this.observerAltitudeOverrideM = observerAltitudeM !== null && observerAltitudeM !== undefined && observerAltitudeM !== '' && Number.isFinite(Number(observerAltitudeM)) ? Number(observerAltitudeM) : null;
      this.observerOffsetM = this.position ? GeoTools.distanceMetres(this.position, this.observerPosition) : 0;

      const bearingBuckets = Array.from({ length: 360 }, () => []);
      for (const vertex of this.mesh.vertices) {
        if (!vertex.valid || !Number.isFinite(vertex.groundElevationM)) continue;
        const distanceM = GeoTools.distanceMetres(this.observerPosition, vertex);
        const bearing = distanceM < 0.01 ? 0 : GeoTools.bearingDegrees(this.observerPosition, vertex);
        vertex.runtimeDistanceM = distanceM;
        vertex.runtimeBearing = bearing;
        if (distanceM >= 5) bearingBuckets[Math.round(bearing) % 360].push(vertex);
      }
      bearingBuckets.forEach(bucket => bucket.sort((a, b) => a.runtimeDistanceM - b.runtimeDistanceM));
      this.mesh.runtimeBearingBuckets = bearingBuckets;
      return this.observerGroundElevationM;
    }

    observerAltitude() {
      if (Number.isFinite(this.observerAltitudeOverrideM)) return this.observerAltitudeOverrideM;
      const ground = finite(this.observerGroundElevationM, this.mesh?.observerGroundElevationM);
      return ground == null ? null : ground + this.eyeHeightM;
    }

    prepareCanvas(width, height) {
      if (!this.canvas || !this.context) return null;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const pixelWidth = Math.max(1, Math.round(width * dpr));
      const pixelHeight = Math.max(1, Math.round(height * dpr));
      if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
        this.canvas.width = pixelWidth;
        this.canvas.height = pixelHeight;
      }
      this.canvas.style.width = `${width}px`;
      this.canvas.style.height = `${height}px`;
      const ctx = this.context;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      return ctx;
    }

    projectVertex(vertex, observerAltitudeM, heading, pitch, tanHalfH, tanHalfV, width, height, verticalScale) {
      const distanceM = Number.isFinite(vertex?.runtimeDistanceM) ? vertex.runtimeDistanceM : vertex?.distanceM;
      const bearing = Number.isFinite(vertex?.runtimeBearing) ? vertex.runtimeBearing : vertex?.bearing;
      if (!vertex || !Number.isFinite(vertex.groundElevationM) || !Number.isFinite(distanceM) || distanceM < 1) return null;
      const relativeYawDeg = GeoTools.signedAngle(bearing - heading);
      if (Math.abs(relativeYawDeg) >= 89.5) return null;
      const curvatureDropM = this.curvature ? (distanceM * distanceM) / (2 * EARTH_RADIUS_M) : 0;
      const verticalDeltaM = (vertex.groundElevationM - observerAltitudeM - curvatureDropM) * verticalScale;
      const elevationAngleDeg = Math.atan2(verticalDeltaM, Math.max(1, distanceM)) * RAD;
      const relativePitchDeg = elevationAngleDeg - pitch;
      const ndcX = Math.tan(relativeYawDeg * DEG) / tanHalfH;
      const ndcY = Math.tan(relativePitchDeg * DEG) / tanHalfV;
      return {
        x: width * (0.5 + ndcX * 0.5),
        y: height * (0.5 - ndcY * 0.5),
        ndcX,
        ndcY,
        distanceM,
        elevationAngleDeg
      };
    }

    render(view = {}) {
      const width = Number(view.width) || this.canvas?.clientWidth || 0;
      const height = Number(view.height) || this.canvas?.clientHeight || 0;
      const ctx = this.prepareCanvas(width, height);
      if (!ctx || this.mode === 'off' || !this.mesh || !width || !height) return;

      const heading = finite(view.heading, 0);
      const pitch = finite(view.pitch, 0);
      const hFov = Math.max(20, Math.min(130, finite(view.horizontalFov, 62))) * DEG;
      const aspect = width / height;
      const vFov = 2 * Math.atan(Math.tan(hFov / 2) / Math.max(0.2, aspect));
      const tanHalfH = Math.tan(hFov / 2);
      const tanHalfV = Math.tan(vFov / 2);
      const verticalScale = Math.max(0.1, finite(view.verticalScale, this.verticalScale));
      const observerAltitudeM = this.observerAltitude();
      if (!Number.isFinite(observerAltitudeM)) return;
      const projected = new Array(this.mesh.vertices.length);
      const projectAt = index => {
        if (projected[index] !== undefined) return projected[index];
        projected[index] = this.projectVertex(this.mesh.vertices[index], observerAltitudeM, heading, pitch, tanHalfH, tanHalfV, width, height, verticalScale);
        return projected[index];
      };

      const drawSurface = this.mode === 'xray' || this.mode === 'surface';
      const drawWire = this.mode === 'wireframe' || this.mode === 'xray' || this.mode === 'surface';
      const min = Number.isFinite(this.mesh.groundMinM) ? this.mesh.groundMinM : 0;
      const max = Number.isFinite(this.mesh.groundMaxM) ? this.mesh.groundMaxM : min + 1;
      const fillAlpha = this.mode === 'surface' ? Math.min(0.85, this.opacity * 1.75) : this.opacity;
      const wireAlpha = this.mode === 'wireframe' ? Math.min(0.85, this.opacity * 2.4) : Math.min(0.6, this.opacity * 1.5);

      if (drawSurface) {
        for (const triangle of this.mesh.triangles) {
          const a = projectAt(triangle.a);
          const b = projectAt(triangle.b);
          const c = projectAt(triangle.c);
          if (!a || !b || !c) continue;
          const outside = [a, b, c].every(point => point.ndcX < -1.4 || point.ndcX > 1.4 || point.ndcY < -1.4 || point.ndcY > 1.4);
          if (outside) continue;
          const span = Math.max(
            Math.hypot(a.x - b.x, a.y - b.y),
            Math.hypot(b.x - c.x, b.y - c.y),
            Math.hypot(c.x - a.x, c.y - a.y)
          );
          if (!Number.isFinite(span) || span > Math.max(width, height) * 2.5) continue;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.lineTo(c.x, c.y);
          ctx.closePath();
          ctx.fillStyle = colourForElevation(triangle.avgElevation, min, max, fillAlpha);
          ctx.fill();
        }
      }

      if (drawWire) {
        ctx.lineWidth = this.mode === 'wireframe' ? 1 : 0.65;
        ctx.strokeStyle = `rgba(190, 238, 227, ${wireAlpha})`;
        const size = this.mesh.size;
        const index = (row, col) => row * size + col;
        const drawSegment = (ia, ib) => {
          const va = this.mesh.vertices[ia];
          const vb = this.mesh.vertices[ib];
          if (!va?.valid || !vb?.valid) return;
          const a = projectAt(ia);
          const b = projectAt(ib);
          if (!a || !b) return;
          if ((Math.abs(a.ndcX) > 1.6 && Math.abs(b.ndcX) > 1.6) || (Math.abs(a.ndcY) > 1.6 && Math.abs(b.ndcY) > 1.6)) return;
          if (Math.hypot(a.x - b.x, a.y - b.y) > Math.max(width, height) * 1.8) return;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        };
        for (let row = 0; row < size; row += 1) {
          for (let col = 0; col < size; col += 1) {
            const current = index(row, col);
            if (col + 1 < size) drawSegment(current, index(row, col + 1));
            if (row + 1 < size) drawSegment(current, index(row + 1, col));
          }
        }
      }
    }

    terrainOcclusionAngle(bearing, maxDistanceM) {
      if (!this.mesh || !Number.isFinite(bearing) || !Number.isFinite(maxDistanceM)) return null;
      const observerAltitudeM = this.observerAltitude();
      if (!Number.isFinite(observerAltitudeM)) return;
      const centre = Math.round(GeoTools.normaliseHeading(bearing)) % 360;
      const binRadius = this.mesh.size >= 33 ? 1 : 2;
      let best = -Infinity;
      for (let offset = -binRadius; offset <= binRadius; offset += 1) {
        const bin = (centre + offset + 360) % 360;
        const bucket = this.mesh.runtimeBearingBuckets?.[bin] || this.mesh.bearingBuckets?.[bin] || [];
        for (const vertex of bucket) {
          const distanceM = Number.isFinite(vertex.runtimeDistanceM) ? vertex.runtimeDistanceM : vertex.distanceM;
          if (distanceM >= maxDistanceM * 0.985) break;
          const curvatureDropM = this.curvature ? (distanceM * distanceM) / (2 * EARTH_RADIUS_M) : 0;
          const verticalDelta = (vertex.groundElevationM - observerAltitudeM - curvatureDropM) * this.verticalScale;
          best = Math.max(best, Math.atan2(verticalDelta, distanceM) * RAD);
        }
      }
      return Number.isFinite(best) ? best : null;
    }

    isFeatureTerrainOccluded(item, marginDeg = 0.35) {
      if (!item || !Number.isFinite(item.distance) || !Number.isFinite(item.bearing)) return false;
      const terrainAngle = this.terrainOcclusionAngle(item.bearing, item.distance);
      if (!Number.isFinite(terrainAngle)) return false;
      let featureAngle = Number.isFinite(item.elevationAngle) ? item.elevationAngle : 0;
      if (Number.isFinite(item.verticalDeltaM)) {
        const curvatureDropM = this.curvature ? (item.distance * item.distance) / (2 * EARTH_RADIUS_M) : 0;
        featureAngle = Math.atan2((item.verticalDeltaM - curvatureDropM) * this.verticalScale, Math.max(1, item.distance)) * RAD;
      }
      return terrainAngle > featureAngle + marginDeg;
    }

    diagnostics() {
      return {
        version: VERSION,
        mode: this.mode,
        radiusM: this.radiusM,
        detail: this.detail,
        opacity: this.opacity,
        eyeHeightM: this.eyeHeightM,
        verticalScale: this.verticalScale,
        curvature: this.curvature,
        observerPosition: this.observerPosition ? { ...this.observerPosition } : null,
        observerGroundElevationM: this.observerGroundElevationM,
        observerAltitudeM: this.observerAltitude(),
        observerAltitudeOverrideM: this.observerAltitudeOverrideM,
        observerOffsetM: this.observerOffsetM,
        provider: typeof this.provider?.diagnostics === 'function' ? this.provider.diagnostics() : { id: this.provider?.id || this.provider?.constructor?.name || 'unknown' },
        last: { ...this.last }
      };
    }
  }

  window.TerrainArRenderer = TerrainArRenderer;
}());
