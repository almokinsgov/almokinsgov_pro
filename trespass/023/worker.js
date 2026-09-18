let timer = null;
let state = { pollMs: 10000, active: false, awaiting: false, queued: false };

function schedule(delay = state.pollMs) {
  clearTimeout(timer);
  if (!state.active) return;
  timer = setTimeout(triggerPoll, Math.max(500, Number(delay) || 10000));
}

function triggerPoll() {
  if (!state.active) return;
  if (state.awaiting) {
    state.queued = true;
    return;
  }
  state.awaiting = true;
  postMessage({ type: 'pollRequest', at: Date.now() });
}

self.onmessage = event => {
  const message = event.data || {};
  if (message.type === 'configure') {
    state.pollMs = Math.max(3000, Number(message.value?.pollMs || state.pollMs));
    state.active = true;
    state.awaiting = false;
    state.queued = false;
    schedule(100);
  } else if (message.type === 'pollNow') {
    if (state.awaiting) state.queued = true;
    else schedule(20);
  } else if (message.type === 'pollComplete') {
    state.awaiting = false;
    if (state.queued) {
      state.queued = false;
      schedule(20);
    } else {
      schedule(message.retryDelay || state.pollMs);
    }
  } else if (message.type === 'stop') {
    state.active = false;
    state.awaiting = false;
    state.queued = false;
    clearTimeout(timer);
  }
};
