(() => {
  'use strict';

  const MEDIAPIPE_VERSION = '1.0.1';
  const MEDIAPIPE_MODULE_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/vision_bundle.mjs`;
  const MEDIAPIPE_WASM_ROOT = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_VERSION}/wasm`;
  const FACE_LANDMARKER_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

  const SIGNALS = {
    smile: {
      label: 'Smile',
      score(scores) {
        return average(scores.mouthSmileLeft, scores.mouthSmileRight);
      }
    },
    mouthOpen: {
      label: 'Mouth open',
      score(scores) {
        return numberOrZero(scores.jawOpen);
      }
    },
    blink: {
      label: 'Blink',
      score(scores) {
        return average(scores.eyeBlinkLeft, scores.eyeBlinkRight);
      }
    },
    browRaise: {
      label: 'Brows raised',
      score(scores) {
        return numberOrZero(scores.browInnerUp);
      }
    }
  };

  class FaceControlEngine {
    constructor() {
      this.video = null;
      this.faceLandmarker = null;
      this.enabled = false;
      this.loading = false;
      this.frameHandle = null;
      this.lastInferenceAt = 0;
      this.lastVideoTime = -1;
      this.options = {
        threshold: 0.55,
        holdMs: 350,
        cooldownMs: 1500,
        inferenceFps: 5,
        rules: {
          smile: 'play',
          mouthOpen: 'off',
          blink: 'off',
          browRaise: 'off'
        },
        onTrigger: () => {},
        onStatus: () => {}
      };
      this.signalState = {};
      this.resetSignalState();
    }

    configure(options = {}) {
      this.options = {
        ...this.options,
        ...options,
        rules: {
          ...this.options.rules,
          ...(options.rules || {})
        }
      };
    }

    async enable(video, options = {}) {
      this.configure(options);
      this.video = video;
      if (!this.video) throw new Error('A camera video element is required.');
      if (this.enabled) return;
      this.enabled = true;
      this.resetSignalState();
      this.emitStatus({ state: 'loading', message: 'Loading face controls…' });

      try {
        await this.ensureModel();
        if (!this.enabled) return;
        this.emitStatus({ state: 'ready', message: 'Face controls ready' });
        this.scheduleFrame();
      } catch (error) {
        this.enabled = false;
        this.emitStatus({ state: 'error', message: friendlyError(error), error });
        throw error;
      }
    }

    disable() {
      this.enabled = false;
      if (this.frameHandle) cancelAnimationFrame(this.frameHandle);
      this.frameHandle = null;
      this.lastVideoTime = -1;
      this.resetSignalState();
      this.emitStatus({ state: 'off', message: 'Face controls off' });
    }

    async ensureModel() {
      if (this.faceLandmarker || this.loading) {
        while (this.loading) await delay(40);
        return this.faceLandmarker;
      }

      this.loading = true;
      try {
        const vision = await import(MEDIAPIPE_MODULE_URL);
        const fileset = await vision.FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_ROOT);
        const baseOptions = {
          modelAssetPath: FACE_LANDMARKER_MODEL_URL,
          delegate: 'GPU'
        };

        try {
          this.faceLandmarker = await vision.FaceLandmarker.createFromOptions(fileset, {
            baseOptions,
            runningMode: 'VIDEO',
            numFaces: 1,
            outputFaceBlendshapes: true,
            outputFacialTransformationMatrixes: false,
            minFaceDetectionConfidence: 0.5,
            minFacePresenceConfidence: 0.5,
            minTrackingConfidence: 0.5
          });
        } catch (gpuError) {
          this.faceLandmarker = await vision.FaceLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: FACE_LANDMARKER_MODEL_URL },
            runningMode: 'VIDEO',
            numFaces: 1,
            outputFaceBlendshapes: true,
            outputFacialTransformationMatrixes: false,
            minFaceDetectionConfidence: 0.5,
            minFacePresenceConfidence: 0.5,
            minTrackingConfidence: 0.5
          });
        }
        return this.faceLandmarker;
      } finally {
        this.loading = false;
      }
    }

    scheduleFrame() {
      if (!this.enabled) return;
      this.frameHandle = requestAnimationFrame((timestamp) => this.processFrame(timestamp));
    }

    processFrame(timestamp) {
      if (!this.enabled) return;
      this.scheduleFrame();

      const fps = clamp(Number(this.options.inferenceFps) || 5, 2, 12);
      const minimumInterval = 1000 / fps;
      if (timestamp - this.lastInferenceAt < minimumInterval) return;
      if (!this.video || this.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
      if (this.video.currentTime === this.lastVideoTime) return;
      if (!this.faceLandmarker) return;

      this.lastInferenceAt = timestamp;
      this.lastVideoTime = this.video.currentTime;

      try {
        const result = this.faceLandmarker.detectForVideo(this.video, timestamp);
        this.handleResult(result, timestamp);
      } catch (error) {
        this.emitStatus({ state: 'warning', message: 'Face detection paused', error });
      }
    }

    handleResult(result, timestamp) {
      const classifications = result && Array.isArray(result.faceBlendshapes) ? result.faceBlendshapes : [];
      if (!classifications.length) {
        this.markNoFace();
        this.emitStatus({ state: 'searching', message: 'Looking for a face', hasFace: false, scores: {} });
        return;
      }

      const categories = Array.isArray(classifications[0].categories) ? classifications[0].categories : [];
      const scores = {};
      categories.forEach((category) => {
        const name = category.categoryName || category.displayName;
        if (name) scores[name] = Number(category.score) || 0;
      });

      const signalScores = {};
      let strongest = { key: null, label: 'Face detected', score: 0 };
      Object.entries(SIGNALS).forEach(([key, signal]) => {
        const score = clamp(signal.score(scores), 0, 1);
        signalScores[key] = score;
        if (score > strongest.score) strongest = { key, label: signal.label, score };
        this.updateSignal(key, score, timestamp);
      });

      this.emitStatus({
        state: 'tracking',
        message: strongest.score >= 0.2 ? `${strongest.label} ${Math.round(strongest.score * 100)}%` : 'Face detected',
        hasFace: true,
        strongest,
        scores: signalScores
      });
    }

    updateSignal(key, score, timestamp) {
      const rule = this.options.rules[key] || 'off';
      const state = this.signalState[key];
      const threshold = clamp(Number(this.options.threshold) || 0.55, 0.2, 0.95);
      const releaseThreshold = Math.max(0.1, threshold - 0.12);
      const holdMs = clamp(Number(this.options.holdMs) || 350, 100, 2000);
      const cooldownMs = clamp(Number(this.options.cooldownMs) || 1500, 500, 10000);

      if (score < releaseThreshold) {
        state.activeSince = 0;
        state.latched = false;
        return;
      }
      if (score < threshold || state.latched || rule === 'off') return;

      if (!state.activeSince) state.activeSince = timestamp;
      if (timestamp - state.activeSince < holdMs) return;
      if (timestamp - state.lastTriggeredAt < cooldownMs) return;

      state.latched = true;
      state.lastTriggeredAt = timestamp;
      this.options.onTrigger({
        signal: key,
        label: SIGNALS[key].label,
        action: rule,
        score
      });
    }

    markNoFace() {
      Object.values(this.signalState).forEach((state) => {
        state.activeSince = 0;
        state.latched = false;
      });
    }

    resetSignalState() {
      this.signalState = Object.fromEntries(
        Object.keys(SIGNALS).map((key) => [key, { activeSince: 0, lastTriggeredAt: -Infinity, latched: false }])
      );
    }

    emitStatus(payload) {
      try {
        this.options.onStatus(payload);
      } catch (error) {
        console.warn('Face control status callback failed', error);
      }
    }
  }

  function average(...values) {
    const numbers = values.map(numberOrZero);
    return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
  }

  function numberOrZero(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function friendlyError(error) {
    const message = error && error.message ? error.message : String(error || '');
    if (/fetch|network|load/i.test(message)) return 'Face controls need an internet connection the first time they load';
    return 'Face controls could not be started';
  }

  window.TeleprompterFaceControl = {
    engine: new FaceControlEngine(),
    signals: Object.fromEntries(Object.entries(SIGNALS).map(([key, value]) => [key, value.label])),
    mediaPipeVersion: MEDIAPIPE_VERSION
  };
})();
