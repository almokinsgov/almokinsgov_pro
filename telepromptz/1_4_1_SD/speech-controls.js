(() => {
  'use strict';

  class VoiceCommandEngine {
    constructor() {
      this.recognition = null;
      this.enabled = false;
      this.starting = false;
      this.restartTimer = null;
      this.silenceTimer = null;
      this.lastCommandAt = 0;
      this.options = {
        language: 'en-NZ',
        prefix: 'prompter',
        requirePrefix: true,
        startOnSpeech: false,
        pauseAfterSilenceMs: 0,
        ignoreResults: () => false,
        onAction: () => {},
        onStatus: () => {}
      };
    }

    isSupported() {
      return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
    }

    configure(options = {}) {
      this.options = { ...this.options, ...options };
    }

    enable(options = {}) {
      this.configure(options);
      if (this.enabled) return true;
      if (!this.isSupported()) throw new Error('Speech recognition is not supported in this browser.');
      this.enabled = true;
      this.createRecognition();
      this.startRecognition();
      return true;
    }

    disable() {
      this.enabled = false;
      this.starting = false;
      clearTimeout(this.restartTimer);
      clearTimeout(this.silenceTimer);
      this.restartTimer = null;
      this.silenceTimer = null;
      if (this.recognition) {
        try { this.recognition.abort(); } catch (_) {}
      }
      this.recognition = null;
      this.emitStatus({ state: 'off', message: 'Voice controls off' });
    }

    createRecognition() {
      const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      const recognition = new Recognition();
      recognition.continuous = true;
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;
      recognition.lang = this.options.language || 'en-NZ';

      recognition.addEventListener('start', () => {
        this.starting = false;
        this.emitStatus({ state: 'listening', message: this.commandHint() });
      });

      recognition.addEventListener('speechstart', () => {
        clearTimeout(this.silenceTimer);
        this.silenceTimer = null;
        if (this.options.startOnSpeech && !this.shouldIgnore()) {
          this.options.onAction({ action: 'play', source: 'speech-activity', transcript: '' });
        }
        this.emitStatus({ state: 'hearing', message: 'Hearing speech…' });
      });

      recognition.addEventListener('speechend', () => {
        const delay = Number(this.options.pauseAfterSilenceMs) || 0;
        if (delay > 0) {
          clearTimeout(this.silenceTimer);
          this.silenceTimer = setTimeout(() => {
            this.silenceTimer = null;
            if (this.enabled && !this.shouldIgnore()) {
              this.options.onAction({ action: 'pause', source: 'silence', transcript: '' });
            }
          }, delay);
        }
      });

      recognition.addEventListener('result', (event) => this.handleResults(event));

      recognition.addEventListener('error', (event) => {
        const fatal = ['not-allowed', 'service-not-allowed', 'audio-capture'].includes(event.error);
        const message = recognitionErrorMessage(event.error);
        this.emitStatus({ state: 'error', message, error: event.error });
        if (fatal) this.enabled = false;
      });

      recognition.addEventListener('end', () => {
        this.starting = false;
        if (!this.enabled) return;
        clearTimeout(this.restartTimer);
        this.restartTimer = setTimeout(() => this.startRecognition(), 250);
      });

      this.recognition = recognition;
    }

    startRecognition() {
      if (!this.enabled || !this.recognition || this.starting) return;
      this.starting = true;
      try {
        this.recognition.lang = this.options.language || 'en-NZ';
        this.recognition.start();
      } catch (error) {
        this.starting = false;
        if (error && error.name === 'InvalidStateError') return;
        this.emitStatus({ state: 'error', message: 'Voice controls could not start', error });
      }
    }

    handleResults(event) {
      if (!this.enabled || this.shouldIgnore()) return;
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (!result.isFinal || !result[0]) continue;
        const transcript = normaliseTranscript(result[0].transcript);
        const action = this.matchCommand(transcript);
        if (!action) {
          this.emitStatus({ state: 'listening', message: this.commandHint(), transcript });
          continue;
        }
        const now = Date.now();
        if (now - this.lastCommandAt < 650) continue;
        this.lastCommandAt = now;
        clearTimeout(this.silenceTimer);
        this.silenceTimer = null;
        this.options.onAction({ action, source: 'command', transcript });
        this.emitStatus({ state: 'triggered', message: `${prettyAction(action)} · “${transcript}”`, transcript, action });
      }
    }

    matchCommand(transcript) {
      let phrase = transcript;
      const prefix = normaliseTranscript(this.options.prefix || 'prompter');
      if (this.options.requirePrefix) {
        if (!prefix) return null;
        const prefixIndex = phrase.lastIndexOf(prefix);
        if (prefixIndex < 0) return null;
        phrase = phrase.slice(prefixIndex + prefix.length).trim();
      }

      const rules = [
        { action: 'record-stop', patterns: ['stop recording', 'finish recording', 'end recording'] },
        { action: 'record-start', patterns: ['start recording', 'record video', 'begin recording'] },
        { action: 'restart', patterns: ['restart', 'start over', 'back to top', 'from the top'] },
        { action: 'faster', patterns: ['faster', 'speed up', 'increase speed'] },
        { action: 'slower', patterns: ['slower', 'slow down', 'decrease speed'] },
        { action: 'pause', patterns: ['pause', 'stop scrolling', 'hold'] },
        { action: 'play', patterns: ['start', 'play', 'resume', 'continue', 'go'] }
      ];

      for (const rule of rules) {
        if (rule.patterns.some((pattern) => phrase === pattern || phrase.includes(pattern))) return rule.action;
      }
      return null;
    }

    commandHint() {
      const prefix = (this.options.prefix || 'prompter').trim();
      return this.options.requirePrefix && prefix ? `Listening · say “${prefix} pause”` : 'Listening for voice commands';
    }

    shouldIgnore() {
      try { return Boolean(this.options.ignoreResults()); } catch (_) { return false; }
    }

    emitStatus(payload) {
      try { this.options.onStatus(payload); } catch (error) { console.warn('Voice control status callback failed', error); }
    }
  }

  function normaliseTranscript(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9āēīōū\s-]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function prettyAction(action) {
    const labels = {
      play: 'Start scrolling',
      pause: 'Pause scrolling',
      restart: 'Restart script',
      faster: 'Increase speed',
      slower: 'Decrease speed',
      'record-start': 'Start recording',
      'record-stop': 'Stop recording'
    };
    return labels[action] || action;
  }

  function recognitionErrorMessage(error) {
    if (error === 'not-allowed' || error === 'service-not-allowed') return 'Microphone permission was not granted';
    if (error === 'audio-capture') return 'No microphone is available';
    if (error === 'network') return 'Speech recognition service is unavailable';
    if (error === 'language-not-supported') return 'Speech recognition language is not supported';
    return 'Voice recognition paused';
  }

  window.TeleprompterSpeech = {
    voiceCommands: new VoiceCommandEngine()
  };
})();
