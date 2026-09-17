(() => {
  'use strict';

  const VERSION = '0.2.0';
  const cfg = window.OFFICE_SAFETY_CONFIG || {};
  const enabled = cfg.debug !== false;
  const verbose = cfg.debugVerbose !== false;
  const MAX_ENTRIES = 500;
  const entries = [];

  function time() {
    return new Date().toISOString();
  }

  function safeValue(value, depth = 0) {
    if (depth > 4) return '[max-depth]';
    if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'string') return value.length > 1200 ? `${value.slice(0, 1200)}…` : value;
    if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack || '' };
    if (Array.isArray(value)) return value.slice(0, 50).map(item => safeValue(item, depth + 1));
    if (typeof value === 'object') {
      const out = {};
      for (const [key, item] of Object.entries(value)) {
        if (/token|credential|id_token|authorization/i.test(key)) {
          out[key] = item ? '[redacted]' : item;
        } else {
          out[key] = safeValue(item, depth + 1);
        }
      }
      return out;
    }
    return String(value);
  }

  function write(level, scope, event, detail) {
    const entry = {
      time: time(),
      level,
      scope: String(scope || 'app'),
      event: String(event || ''),
      detail: safeValue(detail)
    };
    entries.push(entry);
    if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
    if (!enabled) return entry;

    const fn = console[level] || console.log;
    if (detail === undefined) fn.call(console, `[OfficeSafety][${entry.scope}] ${entry.event}`);
    else fn.call(console, `[OfficeSafety][${entry.scope}] ${entry.event}`, entry.detail);
    return entry;
  }

  function snapshot(extra = {}) {
    const gsiScript = document.getElementById('gsiClientScript');
    const sw = navigator.serviceWorker?.controller;
    return safeValue({
      debugVersion: VERSION,
      page: {
        href: location.href,
        origin: location.origin,
        protocol: location.protocol,
        host: location.host,
        referrer: document.referrer,
        referrerPolicy: document.querySelector('meta[name="referrer"]')?.content || '',
        online: navigator.onLine,
        topLevel: window.top === window.self,
        visibilityState: document.visibilityState
      },
      config: {
        apiUrl: cfg.apiUrl || '',
        googleClientId: cfg.googleClientId || '',
        appName: cfg.appName || '',
        defaultPollMs: cfg.defaultPollMs,
        apiTimeoutMs: cfg.apiTimeoutMs,
        presenceHeartbeatMs: cfg.presenceHeartbeatMs,
        debug: cfg.debug,
        debugVerbose: cfg.debugVerbose
      },
      googleIdentity: {
        scriptPresent: Boolean(gsiScript),
        scriptSrc: gsiScript?.src || '',
        libraryPresent: Boolean(window.google?.accounts?.id),
        signInIframePresent: Boolean(document.querySelector('#googleSignIn iframe'))
      },
      serviceWorker: {
        supported: 'serviceWorker' in navigator,
        controller: sw ? { scriptURL: sw.scriptURL, state: sw.state } : null
      },
      bridge: window.OfficeSafetyApi?.diagnostics?.() || null,
      extra
    });
  }

  function dump() {
    const report = { snapshot: snapshot(), entries: entries.slice() };
    console.group('[OfficeSafety] Diagnostic Dump');
    console.log(report);
    console.groupEnd();
    return report;
  }

  async function copyReport() {
    const text = JSON.stringify({ snapshot: snapshot(), entries: entries.slice() }, null, 2);
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard API is unavailable in this browser context.');
    await navigator.clipboard.writeText(text);
    write('info', 'debug', 'Diagnostic report copied to clipboard', { length: text.length });
    return text;
  }

  window.addEventListener('error', event => {
    write('error', 'browser', 'window.error', {
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      error: event.error
    });
  });

  window.addEventListener('unhandledrejection', event => {
    write('error', 'browser', 'unhandledrejection', { reason: event.reason });
  });

  window.addEventListener('securitypolicyviolation', event => {
    write('warn', 'browser', 'securitypolicyviolation', {
      blockedURI: event.blockedURI,
      violatedDirective: event.violatedDirective,
      effectiveDirective: event.effectiveDirective,
      sourceFile: event.sourceFile,
      lineNumber: event.lineNumber
    });
  });

  window.OfficeSafetyDebug = {
    version: VERSION,
    enabled,
    verbose,
    debug: (scope, event, detail) => verbose && write('debug', scope, event, detail),
    info: (scope, event, detail) => write('info', scope, event, detail),
    warn: (scope, event, detail) => write('warn', scope, event, detail),
    error: (scope, event, detail) => write('error', scope, event, detail),
    snapshot,
    dump,
    copyReport,
    clear: () => { entries.length = 0; },
    entries: () => entries.slice()
  };

  write('info', 'debug', `Debug logger v${VERSION} initialised`, snapshot());
  if (enabled) console.info('[OfficeSafety] Run OfficeSafetyDebug.dump() for a full diagnostic report or await OfficeSafetyDebug.copyReport() to copy it.');
})();
