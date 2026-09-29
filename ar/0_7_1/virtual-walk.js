/* GIS AR Viewer virtual walk controller v0.1.0
 * Desktop WASD movement and pointer-lock mouse look.
 */
(function () {
  'use strict';

  const VERSION = '0.1.0';
  const DEG = Math.PI / 180;

  function editableTarget(target) {
    if (!target) return false;
    const tag = String(target.tagName || '').toLowerCase();
    return target.isContentEditable || tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'button';
  }

  class VirtualWalkController {
    constructor(options = {}) {
      this.pointerTarget = options.pointerTarget || null;
      this.getPosition = options.getPosition || (() => null);
      this.getHeading = options.getHeading || (() => 0);
      this.getPitch = options.getPitch || (() => 0);
      this.getActive = options.getActive || (() => true);
      this.onMove = options.onMove || (() => {});
      this.onLook = options.onLook || (() => {});
      this.onStatus = options.onStatus || (() => {});
      this.enabled = false;
      this.speedMps = 2;
      this.sensitivity = 0.12;
      this.sprintMultiplier = 4;
      this.keys = new Set();
      this.frame = null;
      this.lastFrameAt = 0;
      this.distanceTravelledM = 0;
      this.pointerLocked = false;
      this.boundKeyDown = event => this.handleKeyDown(event);
      this.boundKeyUp = event => this.handleKeyUp(event);
      this.boundMouseMove = event => this.handleMouseMove(event);
      this.boundPointerLock = () => this.handlePointerLockChange();
      this.boundBlur = () => this.keys.clear();
      document.addEventListener('keydown', this.boundKeyDown, true);
      document.addEventListener('keyup', this.boundKeyUp, true);
      document.addEventListener('mousemove', this.boundMouseMove, true);
      document.addEventListener('pointerlockchange', this.boundPointerLock, true);
      window.addEventListener('blur', this.boundBlur);
    }

    configure(options = {}) {
      if (options.speedMps != null) this.speedMps = GeoTools.clamp(Number(options.speedMps) || 2, 0.1, 100);
      if (options.sensitivity != null) this.sensitivity = GeoTools.clamp(Number(options.sensitivity) || 0.12, 0.01, 1);
      if (options.sprintMultiplier != null) this.sprintMultiplier = GeoTools.clamp(Number(options.sprintMultiplier) || 4, 1, 10);
      return this;
    }

    setEnabled(enabled) {
      const next = Boolean(enabled);
      if (next === this.enabled) {
        this.emitStatus();
        return this.enabled;
      }
      this.enabled = next;
      this.keys.clear();
      this.lastFrameAt = 0;
      if (this.enabled) this.start();
      else {
        this.stop();
        this.releasePointerLock();
      }
      this.emitStatus();
      return this.enabled;
    }

    start() {
      if (this.frame != null) return;
      const tick = now => {
        this.frame = null;
        if (!this.enabled) return;
        this.step(now);
        this.frame = requestAnimationFrame(tick);
      };
      this.frame = requestAnimationFrame(tick);
    }

    stop() {
      if (this.frame != null) cancelAnimationFrame(this.frame);
      this.frame = null;
      this.lastFrameAt = 0;
      this.keys.clear();
    }

    destroy() {
      this.stop();
      this.releasePointerLock();
      document.removeEventListener('keydown', this.boundKeyDown, true);
      document.removeEventListener('keyup', this.boundKeyUp, true);
      document.removeEventListener('mousemove', this.boundMouseMove, true);
      document.removeEventListener('pointerlockchange', this.boundPointerLock, true);
      window.removeEventListener('blur', this.boundBlur);
    }

    capturePointer() {
      if (!this.enabled || !this.pointerTarget?.requestPointerLock) return false;
      this.pointerTarget.requestPointerLock();
      return true;
    }

    releasePointerLock() {
      if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
    }

    handlePointerLockChange() {
      this.pointerLocked = document.pointerLockElement === this.pointerTarget;
      this.pointerTarget?.classList.toggle('virtual-look-active', this.pointerLocked && this.enabled);
      this.emitStatus();
    }

    handleKeyDown(event) {
      if (!this.enabled || !this.getActive() || editableTarget(event.target)) return;
      const accepted = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight'];
      if (!accepted.includes(event.code)) return;
      this.keys.add(event.code);
      if (event.code.startsWith('Key')) event.preventDefault();
    }

    handleKeyUp(event) {
      this.keys.delete(event.code);
    }

    handleMouseMove(event) {
      if (!this.enabled || !this.getActive() || document.pointerLockElement !== this.pointerTarget) return;
      const heading = GeoTools.normaliseHeading(Number(this.getHeading()) + Number(event.movementX || 0) * this.sensitivity);
      const pitch = GeoTools.clamp(Number(this.getPitch()) - Number(event.movementY || 0) * this.sensitivity, -89, 89);
      this.onLook(heading, pitch, { movementX: event.movementX || 0, movementY: event.movementY || 0, sensitivity: this.sensitivity });
    }

    step(now) {
      if (!this.getActive()) {
        this.lastFrameAt = now;
        return;
      }
      if (!this.lastFrameAt) {
        this.lastFrameAt = now;
        return;
      }
      if (now - this.lastFrameAt < 32) return;
      const dt = Math.min(0.1, Math.max(0, (now - this.lastFrameAt) / 1000));
      this.lastFrameAt = now;
      if (dt <= 0) return;

      const forward = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
      const strafe = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
      if (!forward && !strafe) return;
      const position = this.getPosition();
      if (!position || !Number.isFinite(position.lat) || !Number.isFinite(position.lng)) return;

      const magnitude = Math.max(1, Math.hypot(forward, strafe));
      const forwardUnit = forward / magnitude;
      const strafeUnit = strafe / magnitude;
      const sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
      const speed = this.speedMps * (sprint ? this.sprintMultiplier : 1);
      const distanceM = speed * dt;
      const heading = Number(this.getHeading()) || 0;
      const headingRad = heading * DEG;
      const rightRad = (heading + 90) * DEG;
      const eastM = Math.sin(headingRad) * forwardUnit * distanceM + Math.sin(rightRad) * strafeUnit * distanceM;
      const northM = Math.cos(headingRad) * forwardUnit * distanceM + Math.cos(rightRad) * strafeUnit * distanceM;
      const actualDistance = Math.hypot(eastM, northM);
      if (actualDistance < 0.0001) return;
      const bearing = GeoTools.normaliseHeading(Math.atan2(eastM, northM) / DEG);
      const next = GeoTools.destinationPoint(position, bearing, actualDistance);
      this.distanceTravelledM += actualDistance;
      this.onMove(next, { dt, distanceM: actualDistance, speedMps: speed, sprint, bearing, totalDistanceM: this.distanceTravelledM });
    }

    emitStatus(extra = {}) {
      this.onStatus({
        version: VERSION,
        enabled: this.enabled,
        pointerLocked: this.pointerLocked,
        speedMps: this.speedMps,
        sensitivity: this.sensitivity,
        distanceTravelledM: this.distanceTravelledM,
        ...extra
      });
    }

    diagnostics() {
      return {
        version: VERSION,
        enabled: this.enabled,
        pointerLocked: this.pointerLocked,
        speedMps: this.speedMps,
        sensitivity: this.sensitivity,
        sprintMultiplier: this.sprintMultiplier,
        activeKeys: [...this.keys],
        distanceTravelledM: this.distanceTravelledM
      };
    }
  }

  window.VirtualWalkController = VirtualWalkController;
}());
