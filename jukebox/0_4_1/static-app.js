const $ = (selector) => document.querySelector(selector);

const config = {
  version: '0.4.1',
  spotifyClientId: '',
  spotifyRedirectUri: '',
  mockMode: false,
  peerPrefix: 'gnj-v041-',
  peer: {},
  ...(window.JUKEBOX_STATIC_CONFIG || {})
};

const SPOTIFY_SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-read-playback-state',
  'user-read-currently-playing',
  'user-modify-playback-state'
].join(' ');

const MAX_QUEUE_ITEMS = 100;
const MAX_HISTORY_ITEMS = 40;
const MAX_SEARCH_CACHE = 300;
const MAX_COOLDOWN_SECONDS = 600;
const COMMAND_TIMEOUT_MS = 15000;
const ROOM_SYNC_COOLDOWN_MS = 2000;
const PLAYBACK_END_TOLERANCE_MS = 1500;
const MAX_CHAT_MESSAGES = 80;
const MAX_CHAT_LENGTH = 280;
const CHAT_RATE_LIMIT_MS = 700;
const REACTION_RATE_LIMIT_MS = 300;
const REACTION_EMOJIS = Object.freeze(['❤️', '🔥', '😂', '🎵', '🙌', '🤘', '👏', '💀']);
const REACTION_EMOJI_SET = new Set(REACTION_EMOJIS);
const MOCK_MODE = Boolean(config.mockMode || !config.spotifyClientId);

const mockTracks = [
  ['mock-01', 'Neon Respawn', 'Pixel Raiders', 'Checkpoint Radio', 196000],
  ['mock-02', 'Critical Hit', 'Dungeon Drivers', 'Roll Initiative', 221000],
  ['mock-03', 'One More Round', 'Late Lobby', 'Party Queue', 183000],
  ['mock-04', 'Boss Fight Energy', 'Health Bar', 'No Sleep Mode', 204000],
  ['mock-05', 'Loading Screen', 'Static Arcade', 'Insert Coin', 172000],
  ['mock-06', 'Victory Lap', 'Co-op Club', 'Shared XP', 214000],
  ['mock-07', 'Keyboard Lights', 'Night Shift', 'RGB Dreams', 189000],
  ['mock-08', 'Final Circle', 'Drop Zone', 'Last Squad', 238000],
  ['mock-09', 'Lobby Music', 'Ready Check', 'Queue Again', 201000],
  ['mock-10', 'Save Point', 'Memory Card', 'Continue?', 177000],
  ['mock-11', 'No Scope Disco', 'LAN Party', 'Ping Perfect', 193000],
  ['mock-12', 'Patch Notes', 'Version Select', 'Hotfix', 209000]
].map(([id, name, artists, album, durationMs], index) => ({
  id,
  uri: `spotify:track:${id}`,
  name,
  artists,
  album,
  durationMs,
  image: '',
  externalUrl: '#',
  explicit: index % 5 === 0
}));

const state = {
  room: null,
  roomInternal: null,
  roomCode: '',
  isHost: false,
  nickname: localStorage.getItem('jukebox.nickname') || '',
  clientId: localStorage.getItem('jukebox.clientId') || crypto.randomUUID(),
  joinPin: '',
  peer: null,
  hostConnection: null,
  guestConnections: new Map(),
  pendingCommands: new Map(),
  guestReconnectTimer: null,
  progressTimer: null,
  searchCache: new Map(),
  browserPlayer: null,
  browserDeviceId: '',
  spotifySdkPromise: null,
  peerJsPromise: null,
  playbackTimer: null,
  creatingRoom: false,
  lastRoomSyncAt: 0,
  roomSyncBusy: false,
  viewMode: 'room'
};
localStorage.setItem('jukebox.clientId', state.clientId);

const refs = {
  landingView: $('#landingView'),
  roomView: $('#roomView'),
  jukeboxView: $('#jukeboxView'),
  connectionBadge: $('#connectionBadge'),
  hostNameInput: $('#hostNameInput'),
  requestModeInput: $('#requestModeInput'),
  queueModeInput: $('#queueModeInput'),
  roomPinCreateInput: $('#roomPinCreateInput'),
  requestCooldownInput: $('#requestCooldownInput'),
  createRoomButton: $('#createRoomButton'),
  roomCodeInput: $('#roomCodeInput'),
  nicknameInput: $('#nicknameInput'),
  roomPinJoinInput: $('#roomPinJoinInput'),
  roomPinJoinField: $('#roomPinJoinField'),
  joinMessage: $('#joinMessage'),
  joinRoomButton: $('#joinRoomButton'),
  roomCodeDisplay: $('#roomCodeDisplay'),
  pinBadge: $('#pinBadge'),
  copyRoomButton: $('#copyRoomButton'),
  showQrButton: $('#showQrButton'),
  syncRoomButton: $('#syncRoomButton'),
  openJukeboxViewButton: $('#openJukeboxViewButton'),
  closeJukeboxViewButton: $('#closeJukeboxViewButton'),
  qrPanel: $('#qrPanel'),
  roomQrImage: $('#roomQrImage'),
  qrMessage: $('#qrMessage'),
  roomShareHint: $('#roomShareHint'),
  leaveRoomButton: $('#leaveRoomButton'),
  searchForm: $('#searchForm'),
  searchInput: $('#searchInput'),
  clearSearchButton: $('#clearSearchButton'),
  searchMessage: $('#searchMessage'),
  searchResults: $('#searchResults'),
  queueList: $('#queueList'),
  queueCount: $('#queueCount'),
  queueModeBadge: $('#queueModeBadge'),
  queueModeHelp: $('#queueModeHelp'),
  suggestionsPanel: $('#suggestionsPanel'),
  suggestionList: $('#suggestionList'),
  suggestionCount: $('#suggestionCount'),
  historyList: $('#historyList'),
  historyCount: $('#historyCount'),
  requestModeBadge: $('#requestModeBadge'),
  cooldownBadge: $('#cooldownBadge'),
  hostPanel: $('#hostPanel'),
  spotifyBadge: $('#spotifyBadge'),
  connectSpotifyButton: $('#connectSpotifyButton'),
  browserPlayerPanel: $('#browserPlayerPanel'),
  browserPlayerStatus: $('#browserPlayerStatus'),
  browserPlayerButton: $('#browserPlayerButton'),
  activateBrowserAudioButton: $('#activateBrowserAudioButton'),
  deviceSelect: $('#deviceSelect'),
  refreshDevicesButton: $('#refreshDevicesButton'),
  playNextButton: $('#playNextButton'),
  pauseResumeButton: $('#pauseResumeButton'),
  syncPlaybackButton: $('#syncPlaybackButton'),
  autoPlayInput: $('#autoPlayInput'),
  requesterToastsInput: $('#requesterToastsInput'),
  hostRequestModeInput: $('#hostRequestModeInput'),
  hostQueueModeInput: $('#hostQueueModeInput'),
  hostCooldownInput: $('#hostCooldownInput'),
  hostMessage: $('#hostMessage'),
  nowPlayingTitle: $('#nowPlayingTitle'),
  nowPlayingMeta: $('#nowPlayingMeta'),
  nowPlayingArt: $('#nowPlayingArt'),
  progressBar: $('#progressBar'),
  progressCurrent: $('#progressCurrent'),
  progressDuration: $('#progressDuration'),
  guestPlaybackControls: $('#guestPlaybackControls'),
  guestStartButton: $('#guestStartButton'),
  guestPlaybackHint: $('#guestPlaybackHint'),
  chatList: $('#chatList'),
  chatCount: $('#chatCount'),
  chatForm: $('#chatForm'),
  chatInput: $('#chatInput'),
  jukeboxRoomCode: $('#jukeboxRoomCode'),
  jukeboxVinyl: $('#jukeboxVinyl'),
  jukeboxArt: $('#jukeboxArt'),
  jukeboxArtPlaceholder: $('#jukeboxArtPlaceholder'),
  jukeboxPlaybackState: $('#jukeboxPlaybackState'),
  jukeboxSongTitle: $('#jukeboxSongTitle'),
  jukeboxSongArtists: $('#jukeboxSongArtists'),
  jukeboxSongAlbum: $('#jukeboxSongAlbum'),
  jukeboxRequestedBy: $('#jukeboxRequestedBy'),
  jukeboxProgressBar: $('#jukeboxProgressBar'),
  jukeboxProgressCurrent: $('#jukeboxProgressCurrent'),
  jukeboxProgressDuration: $('#jukeboxProgressDuration'),
  jukeboxQueueList: $('#jukeboxQueueList'),
  jukeboxQueueCount: $('#jukeboxQueueCount'),
  jukeboxChatList: $('#jukeboxChatList'),
  jukeboxChatCount: $('#jukeboxChatCount'),
  jukeboxChatForm: $('#jukeboxChatForm'),
  jukeboxChatInput: $('#jukeboxChatInput'),
  reactionButtons: [...(document.querySelectorAll?.('.reaction-button') || [])],
  reactionLayer: $('#reactionLayer'),
  toast: $('#toast')
};
refs.nicknameInput.value = state.nickname;

function showToast(message) {
  refs.toast.classList.remove('personal-toast');
  refs.toast.dataset.kind = '';
  refs.toast.dataset.trackId = '';
  refs.toast.textContent = message;
  refs.toast.classList.remove('hidden');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => refs.toast.classList.add('hidden'), 2800);
}

function showRequesterToast(notification) {
  if (!notification?.track?.name) return;
  const title = notification.kind === 'playing' ? 'Your song is playing!' : 'Your song is up next!';
  const titleNode = document.createElement('strong');
  titleNode.className = 'toast-title';
  titleNode.textContent = title;
  const trackNode = document.createElement('span');
  trackNode.className = 'toast-track';
  trackNode.textContent = notification.track.name;
  refs.toast.replaceChildren(titleNode, trackNode);
  refs.toast.classList.add('personal-toast');
  refs.toast.classList.remove('hidden');
  refs.toast.dataset.kind = notification.kind || '';
  refs.toast.dataset.trackId = notification.itemId || '';
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => refs.toast.classList.add('hidden'), 5200);
}

function el(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== '') node.textContent = text;
  return node;
}

function randomCode(length = 8) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map((value) => alphabet[value % alphabet.length]).join('');
}

function randomToken(length = 20) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return [...bytes].map((value) => alphabet[value % alphabet.length]).join('');
}

function cleanCooldown(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(MAX_COOLDOWN_SECONDS, Math.floor(parsed)));
}

function currentNickname() {
  return (state.nickname || 'Guest').trim().slice(0, 32) || 'Guest';
}

function queueModeLabel(mode) {
  if (mode === 'roundRobin') return 'Round robin';
  if (mode === 'hostCurated') return 'Host curated';
  return 'Democratic';
}

function queueModeHelp(mode) {
  if (mode === 'roundRobin') return 'Requesters take turns. Bumps decide which of a person’s tracks is first on their turn.';
  if (mode === 'hostCurated') return 'The host controls the order. Bumps are disabled in this mode.';
  return 'Bumps decide the order. Older requests win ties.';
}

function formatTime(ms) {
  const totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function relativeTime(timestamp) {
  const seconds = Math.max(0, Math.floor((Date.now() - Number(timestamp || Date.now())) / 1000));
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

function createArt(track, sizeClass = 'track-art') {
  if (track.image) {
    const img = el('img', sizeClass);
    img.src = track.image;
    img.alt = '';
    img.loading = 'lazy';
    return img;
  }
  return el('div', `${sizeClass} placeholder-art`, '♪');
}

function createTrackCopy(track, subtext = '') {
  const copy = el('div', 'track-copy');
  const title = el('div', 'track-title');
  title.append(el('span', '', track.name));
  if (track.explicit) title.append(el('span', 'explicit', 'E'));
  const meta = el('div', 'track-meta', subtext || `${track.artists}${track.album ? ` · ${track.album}` : ''}`);
  copy.append(title, meta);
  return copy;
}

function basePageUrl() {
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  return url.toString();
}

function inviteUrl(code = state.roomCode) {
  const url = new URL(basePageUrl());
  url.searchParams.set('room', code);
  return url.toString();
}

function peerIdForRoom(code) {
  return `${config.peerPrefix || 'gnj-v041-'}${String(code || '').toLowerCase()}`;
}

function peerOptions() {
  const source = config.peer || {};
  const options = { debug: Number(source.debug || 0) };
  if (source.host) {
    options.host = source.host;
    options.port = Number(source.port || 443);
    options.path = source.path || '/';
    options.secure = source.secure !== false;
    if (source.key) options.key = source.key;
  }
  if (Array.isArray(source.iceServers) && source.iceServers.length) {
    options.config = { iceServers: source.iceServers, sdpSemantics: 'unified-plan' };
  }
  return options;
}

async function ensurePeerJs() {
  if (window.Peer) return window.Peer;
  if (state.peerJsPromise) return state.peerJsPromise;
  state.peerJsPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = config.peerClientUrl || 'https://cdn.jsdelivr.net/npm/peerjs@1.5.5/dist/peerjs.min.js';
    script.async = true;
    script.dataset.jukeboxPeerjs = '1';
    const timer = setTimeout(() => reject(new Error('PeerJS client did not load. Check your network or configure a local peerClientUrl.')), 15000);
    script.onload = () => {
      clearTimeout(timer);
      if (window.Peer) resolve(window.Peer); else reject(new Error('PeerJS loaded but did not expose the Peer client.'));
    };
    script.onerror = () => {
      clearTimeout(timer);
      state.peerJsPromise = null;
      reject(new Error('Could not download the PeerJS client.'));
    };
    document.head.append(script);
  });
  return state.peerJsPromise;
}

function queueScore(item) {
  return 1 + item.voters.size;
}

function democraticSort(a, b) {
  const voteDifference = queueScore(b) - queueScore(a);
  if (voteDifference !== 0) return voteDifference;
  return a.createdAt - b.createdAt;
}

function roundRobinOrder(room) {
  const remaining = [...room.queue];
  const result = [];
  const simulatedServed = new Map(room.roundRobinLastServed);
  let counter = room.roundRobinCounter;

  while (remaining.length) {
    const requesters = [...new Set(remaining.map((item) => item.requesterClientId))];
    requesters.sort((a, b) => {
      const aServed = simulatedServed.has(a) ? simulatedServed.get(a) : Number.NEGATIVE_INFINITY;
      const bServed = simulatedServed.has(b) ? simulatedServed.get(b) : Number.NEGATIVE_INFINITY;
      if (aServed !== bServed) return aServed - bServed;
      const aFirst = Math.min(...remaining.filter((item) => item.requesterClientId === a).map((item) => item.createdAt));
      const bFirst = Math.min(...remaining.filter((item) => item.requesterClientId === b).map((item) => item.createdAt));
      return aFirst - bFirst;
    });

    const requester = requesters[0];
    const candidates = remaining.filter((item) => item.requesterClientId === requester).sort(democraticSort);
    const chosen = candidates[0];
    result.push(chosen);
    remaining.splice(remaining.findIndex((item) => item.id === chosen.id), 1);
    counter += 1;
    simulatedServed.set(requester, counter);
  }

  return result;
}

function orderedQueue(room) {
  if (room.queueMode === 'hostCurated') return [...room.queue];
  if (room.queueMode === 'roundRobin') return roundRobinOrder(room);
  return [...room.queue].sort(democraticSort);
}

function publicQueueItem(item) {
  return {
    id: item.id,
    track: item.track,
    requestedBy: item.requestedBy,
    createdAt: item.createdAt,
    score: queueScore(item)
  };
}

function spotifyTokenRecord() {
  try {
    return JSON.parse(localStorage.getItem('jukebox.spotify.pkce.tokens') || 'null');
  } catch {
    return null;
  }
}

function spotifyConnected() {
  return MOCK_MODE || Boolean(spotifyTokenRecord()?.refreshToken || spotifyTokenRecord()?.accessToken);
}

function publicRoom(room) {
  const queue = orderedQueue(room).map(publicQueueItem);
  const suggestions = [...room.suggestions].sort((a, b) => a.createdAt - b.createdAt).map(publicQueueItem);
  return {
    code: room.code,
    createdAt: room.createdAt,
    hostName: room.hostName,
    spotifyConnected: spotifyConnected(),
    mockMode: MOCK_MODE,
    pinRequired: Boolean(room.pin),
    requestMode: room.requestMode,
    queueMode: room.queueMode,
    requestCooldownSeconds: room.requestCooldownSeconds,
    autoPlay: room.autoPlay,
    requesterToastsEnabled: room.requesterToastsEnabled !== false,
    selectedDeviceId: room.selectedDeviceId,
    selectedDeviceName: room.selectedDeviceName,
    nowPlaying: room.nowPlaying,
    history: room.history,
    chat: room.chat || [],
    queue,
    suggestions,
    queueCount: queue.length,
    suggestionCount: suggestions.length,
    votingEnabled: room.queueMode !== 'hostCurated'
  };
}

function serialiseQueue(items) {
  return items.map((item) => ({ ...item, voters: [...item.voters] }));
}

function hydrateQueue(items) {
  return (items || []).map((item) => ({ ...item, voters: new Set(item.voters || []) }));
}

function persistHostRoom() {
  if (!state.isHost || !state.roomInternal) return;
  const room = state.roomInternal;
  const serialised = {
    ...room,
    queue: serialiseQueue(room.queue),
    suggestions: serialiseQueue(room.suggestions),
    roundRobinLastServed: [...room.roundRobinLastServed.entries()],
    lastRequestAt: [...room.lastRequestAt.entries()],
    lastChatAt: [...room.lastChatAt.entries()],
    lastReactionAt: [...room.lastReactionAt.entries()],
    notifiedUpNext: [...room.notifiedUpNext],
    notifiedPlaying: [...room.notifiedPlaying]
  };
  delete serialised.trackCache;
  localStorage.setItem('jukebox.static.hostRoom', JSON.stringify(serialised));
}

function loadPersistedHostRoom(code = '') {
  try {
    const raw = JSON.parse(localStorage.getItem('jukebox.static.hostRoom') || 'null');
    if (!raw || (code && raw.code !== code)) return null;
    return {
      ...raw,
      queue: hydrateQueue(raw.queue),
      suggestions: hydrateQueue(raw.suggestions),
      chat: Array.isArray(raw.chat) ? raw.chat.slice(-MAX_CHAT_MESSAGES) : [],
      roundRobinLastServed: new Map(raw.roundRobinLastServed || []),
      lastRequestAt: new Map(raw.lastRequestAt || []),
      lastChatAt: new Map(raw.lastChatAt || []),
      lastReactionAt: new Map(raw.lastReactionAt || []),
      notifiedUpNext: new Set(raw.notifiedUpNext || []),
      notifiedPlaying: new Set(raw.notifiedPlaying || []),
      requesterToastsEnabled: raw.requesterToastsEnabled !== false,
      trackCache: new Map()
    };
  } catch {
    return null;
  }
}

function createRoomModel({ code, hostName, pin, requestMode, queueMode, requestCooldownSeconds }) {
  return {
    code,
    createdAt: Date.now(),
    hostName: String(hostName || 'Host').trim().slice(0, 32) || 'Host',
    pin,
    requestMode: requestMode === 'approval' ? 'approval' : 'open',
    queueMode: ['democratic', 'roundRobin', 'hostCurated'].includes(queueMode) ? queueMode : 'democratic',
    requestCooldownSeconds: cleanCooldown(requestCooldownSeconds),
    autoPlay: true,
    requesterToastsEnabled: true,
    queue: [],
    suggestions: [],
    history: [],
    chat: [],
    roundRobinCounter: 0,
    roundRobinLastServed: new Map(),
    lastRequestAt: new Map(),
    lastChatAt: new Map(),
    lastReactionAt: new Map(),
    notifiedUpNext: new Set(),
    notifiedPlaying: new Set(),
    trackCache: new Map(),
    selectedDeviceId: '',
    selectedDeviceName: '',
    nowPlaying: null
  };
}

function hostMember() {
  return { isHost: true, clientId: `host:${state.roomCode}`, nickname: state.roomInternal?.hostName || currentNickname() };
}

function cacheTrack(track) {
  if (!state.roomInternal) return track;
  state.roomInternal.trackCache.set(track.id, track);
  if (state.roomInternal.trackCache.size > MAX_SEARCH_CACHE) {
    const firstKey = state.roomInternal.trackCache.keys().next().value;
    state.roomInternal.trackCache.delete(firstKey);
  }
  return track;
}

function normaliseSpotifyTrack(item) {
  const images = item.album?.images || item.images || [];
  return {
    id: item.id,
    uri: item.uri,
    name: item.name,
    artists: (item.artists || []).map((artist) => artist.name).join(', ') || item.show?.name || 'Spotify',
    album: item.album?.name || item.show?.name || '',
    durationMs: item.duration_ms || 0,
    image: images[1]?.url || images[0]?.url || '',
    externalUrl: item.external_urls?.spotify || '',
    explicit: Boolean(item.explicit)
  };
}

async function refreshSpotifyAccessToken() {
  const tokens = spotifyTokenRecord();
  if (!tokens?.refreshToken) throw new Error('Connect Spotify first.');
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
      client_id: config.spotifyClientId
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (data.error === 'invalid_grant') localStorage.removeItem('jukebox.spotify.pkce.tokens');
    throw new Error(data.error_description || data.error || 'Spotify token refresh failed. Reconnect Spotify.');
  }
  const next = {
    ...tokens,
    accessToken: data.access_token,
    refreshToken: data.refresh_token || tokens.refreshToken,
    expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000 - 30000
  };
  localStorage.setItem('jukebox.spotify.pkce.tokens', JSON.stringify(next));
  return next.accessToken;
}

async function currentSpotifyAccessToken() {
  if (MOCK_MODE) throw new Error('Spotify is not configured in this static build.');
  const tokens = spotifyTokenRecord();
  if (!tokens?.accessToken && !tokens?.refreshToken) throw new Error('Connect Spotify first.');
  if (!tokens.accessToken || Date.now() >= Number(tokens.expiresAt || 0)) return refreshSpotifyAccessToken();
  return tokens.accessToken;
}

async function spotifyFetch(endpoint, options = {}, retry = true) {
  const accessToken = await currentSpotifyAccessToken();
  const response = await fetch(`https://api.spotify.com/v1${endpoint}`, {
    ...options,
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  if (response.status === 401 && retry) {
    await refreshSpotifyAccessToken();
    return spotifyFetch(endpoint, options, false);
  }
  if (response.status === 429) {
    const retryAfter = response.headers.get('retry-after') || 'a short while';
    throw new Error(`Spotify rate limit reached. Try again in ${retryAfter} seconds.`);
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data?.error?.message || `Spotify request failed (${response.status}).`);
  }
  if (response.status === 204) return null;
  return response.json();
}

async function searchTracks(query) {
  if (!state.isHost) throw new Error('Only the host browser can query Spotify directly.');
  if (MOCK_MODE) {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const scored = mockTracks.map((track) => {
      const haystack = `${track.name} ${track.artists} ${track.album}`.toLowerCase();
      const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 2 : 0), 0);
      return { track, score };
    }).sort((a, b) => b.score - a.score);
    const results = (scored.some((item) => item.score > 0) ? scored.filter((item) => item.score > 0) : scored)
      .slice(0, 10)
      .map((item) => item.track);
    results.forEach(cacheTrack);
    return results;
  }
  const data = await spotifyFetch(`/search?type=track&limit=10&q=${encodeURIComponent(query)}`);
  const results = (data.tracks?.items || []).filter(Boolean).map(normaliseSpotifyTrack);
  results.forEach(cacheTrack);
  return results;
}

async function resolveTrack(trackId) {
  const cached = state.roomInternal?.trackCache.get(trackId);
  if (cached) return cached;
  if (MOCK_MODE) {
    const track = mockTracks.find((item) => item.id === trackId);
    if (!track) throw new Error('Track not found.');
    return cacheTrack(track);
  }
  const data = await spotifyFetch(`/tracks/${encodeURIComponent(trackId)}`);
  return cacheTrack(normaliseSpotifyTrack(data));
}

function findExistingRequest(trackId) {
  const room = state.roomInternal;
  return room.queue.find((item) => item.track.id === trackId) || room.suggestions.find((item) => item.track.id === trackId) || null;
}

function enforceRequestCooldown(member) {
  const room = state.roomInternal;
  if (member.isHost || room.requestCooldownSeconds <= 0) return;
  const last = room.lastRequestAt.get(member.clientId) || 0;
  const waitMs = room.requestCooldownSeconds * 1000 - (Date.now() - last);
  if (waitMs > 0) {
    const seconds = Math.max(1, Math.ceil(waitMs / 1000));
    throw new Error(`You can add another new request in ${seconds} second${seconds === 1 ? '' : 's'}.`);
  }
}

function addRequest(track, member, target = 'queue') {
  const room = state.roomInternal;
  const existing = findExistingRequest(track.id);
  if (existing) {
    if (existing.requesterClientId !== member.clientId) existing.voters.add(member.clientId);
    return existing;
  }
  if (room.queue.length + room.suggestions.length >= MAX_QUEUE_ITEMS) throw new Error('This room has reached its request limit.');
  const item = {
    id: randomToken(14),
    track,
    requestedBy: member.nickname,
    requesterClientId: member.clientId,
    createdAt: Date.now(),
    voters: new Set()
  };
  (target === 'suggestions' ? room.suggestions : room.queue).push(item);
  if (!member.isHost) room.lastRequestAt.set(member.clientId, Date.now());
  return item;
}

function playbackEffectivelyEnded(playing) {
  if (!playing || playing.isPlaying) return false;
  const duration = Math.max(0, Number(playing.track?.durationMs || 0));
  if (!duration) return false;
  const progress = Math.max(0, Number(playing.progressMs || 0));
  return progress >= Math.max(0, duration - PLAYBACK_END_TOLERANCE_MS);
}

function archiveNowPlaying(reason = 'finished') {
  const room = state.roomInternal;
  if (!room?.nowPlaying?.track) return;
  const current = room.nowPlaying;
  room.history.unshift({
    id: randomToken(14),
    track: current.track,
    requestedBy: current.requestedBy || 'Spotify',
    playedAt: current.startedAt || Date.now(),
    endedAt: Date.now(),
    reason
  });
  if (room.history.length > MAX_HISTORY_ITEMS) room.history.length = MAX_HISTORY_ITEMS;
  room.nowPlaying = null;
}

function markRoundRobinServed(item) {
  const room = state.roomInternal;
  if (!item || room.queueMode !== 'roundRobin') return;
  room.roundRobinCounter += 1;
  room.roundRobinLastServed.set(item.requesterClientId, room.roundRobinCounter);
}

function clearPlaybackTimer() {
  clearTimeout(state.playbackTimer);
  state.playbackTimer = null;
}

function scheduleAutoNext(remainingMs) {
  clearPlaybackTimer();
  const room = state.roomInternal;
  if (!room?.autoPlay || !room.nowPlaying?.isPlaying) return;
  const delay = Math.max(1000, Number(remainingMs || room.nowPlaying.track.durationMs || 0) + 500);
  state.playbackTimer = setTimeout(() => {
    playNext('', true).catch((error) => {
      refs.hostMessage.textContent = error.message;
    });
  }, delay);
}

function enforceRoomActivityRate(map, member, cooldownMs, label) {
  const key = member.clientId;
  const last = map.get(key) || 0;
  const waitMs = cooldownMs - (Date.now() - last);
  if (waitMs > 0) {
    const seconds = Math.max(1, Math.ceil(waitMs / 1000));
    throw new Error(`${label} is limited. Try again in ${seconds} second${seconds === 1 ? '' : 's'}.`);
  }
  map.set(key, Date.now());
}

function cleanChatText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, MAX_CHAT_LENGTH);
}

function addChatMessage(member, value) {
  const room = state.roomInternal;
  const text = cleanChatText(value);
  if (!text) throw new Error('Enter a chat message.');
  enforceRoomActivityRate(room.lastChatAt, member, CHAT_RATE_LIMIT_MS, 'Chat');
  const message = {
    id: randomToken(14),
    text,
    nickname: member.nickname,
    isHost: Boolean(member.isHost),
    sentAt: Date.now()
  };
  room.chat.push(message);
  if (room.chat.length > MAX_CHAT_MESSAGES) room.chat.splice(0, room.chat.length - MAX_CHAT_MESSAGES);
  roomChanged();
  return message;
}

function renderChat(messages = []) {
  renderChatInto(refs.chatList, refs.chatCount, messages);
}
function showReaction(reaction) {
  if (!reaction?.emoji || !REACTION_EMOJI_SET.has(reaction.emoji) || !refs.reactionLayer) return;
  const particle = el('div', 'reaction-float', reaction.emoji);
  particle.dataset.by = reaction.by || '';
  const x = 12 + Math.random() * 76;
  const drift = -44 + Math.random() * 88;
  if (particle.style?.setProperty) {
    particle.style.setProperty('--reaction-x', `${x.toFixed(1)}%`);
    particle.style.setProperty('--reaction-drift', `${drift.toFixed(0)}px`);
  } else {
    particle.style['--reaction-x'] = `${x.toFixed(1)}%`;
    particle.style['--reaction-drift'] = `${drift.toFixed(0)}px`;
  }
  refs.reactionLayer.append(particle);
  const timer = setTimeout(() => particle.remove?.(), 2850);
  if (typeof timer?.unref === 'function') timer.unref();
}

function broadcastReaction(reaction) {
  if (!state.isHost) return;
  for (const [clientId, conn] of state.guestConnections) {
    if (!conn?.open) {
      state.guestConnections.delete(clientId);
      continue;
    }
    try { conn.send({ type: 'reaction', reaction }); } catch {}
  }
}

function publishReaction(member, emoji) {
  const room = state.roomInternal;
  if (!REACTION_EMOJI_SET.has(emoji)) throw new Error('That reaction is not available.');
  enforceRoomActivityRate(room.lastReactionAt, member, REACTION_RATE_LIMIT_MS, 'Reactions');
  const reaction = {
    id: randomToken(12),
    emoji,
    by: member.nickname,
    isHost: Boolean(member.isHost),
    sentAt: Date.now()
  };
  showReaction(reaction);
  broadcastReaction(reaction);
  return reaction;
}

function requesterNotification(item, kind) {
  return {
    kind,
    itemId: item.id || item.requestItemId || '',
    track: item.track,
    requestedBy: item.requestedBy || '',
    sentAt: Date.now()
  };
}

function sendRequesterNotification(clientId, item, kind) {
  const room = state.roomInternal;
  if (!room?.requesterToastsEnabled || !clientId || !item?.track) return false;
  const notification = requesterNotification(item, kind);
  if (clientId === hostMember().clientId) {
    showRequesterToast(notification);
    return true;
  }
  const conn = state.guestConnections.get(clientId);
  if (!conn?.open) return false;
  try {
    conn.send({ type: 'requesterToast', notification });
    return true;
  } catch {
    return false;
  }
}

function maybeNotifyUpNext() {
  const room = state.roomInternal;
  if (!room?.requesterToastsEnabled) return false;
  const item = orderedQueue(room)[0];
  if (!item?.id || !item.requesterClientId || room.notifiedUpNext.has(item.id)) return false;
  if (!sendRequesterNotification(item.requesterClientId, item, 'upNext')) return false;
  room.notifiedUpNext.add(item.id);
  return true;
}

function maybeNotifyPlaying(item) {
  const room = state.roomInternal;
  if (!room?.requesterToastsEnabled || !item?.id || !item.requesterClientId || room.notifiedPlaying.has(item.id)) return false;
  if (!sendRequesterNotification(item.requesterClientId, item, 'playing')) return false;
  room.notifiedPlaying.add(item.id);
  return true;
}

function maybeNotifyConnectedMember(member) {
  const room = state.roomInternal;
  if (!room?.requesterToastsEnabled || !member?.clientId) return;
  const playing = room.nowPlaying;
  if (playing?.requestItemId && playing.requesterClientId === member.clientId && !room.notifiedPlaying.has(playing.requestItemId)) {
    const item = { id: playing.requestItemId, track: playing.track, requestedBy: playing.requestedBy, requesterClientId: playing.requesterClientId };
    if (sendRequesterNotification(member.clientId, item, 'playing')) room.notifiedPlaying.add(playing.requestItemId);
  }
  const next = orderedQueue(room)[0];
  if (next?.requesterClientId === member.clientId && !room.notifiedUpNext.has(next.id)) {
    if (sendRequesterNotification(member.clientId, next, 'upNext')) room.notifiedUpNext.add(next.id);
  }
  persistHostRoom();
}

async function sendChatMessage(value) {
  if (state.isHost) return addChatMessage(hostMember(), value);
  const data = await guestCommand('chat', { text: value });
  if (data.room) {
    state.room = data.room;
    renderRoom();
  }
  return data.message;
}

async function sendRoomReaction(emoji) {
  if (state.isHost) return publishReaction(hostMember(), emoji);
  const data = await guestCommand('reaction', { emoji });
  return data.reaction;
}

function clearSearchResults({ clearInput = true } = {}) {
  if (clearInput) refs.searchInput.value = '';
  refs.searchMessage.textContent = '';
  refs.searchResults.replaceChildren();
}

function roomChanged({ notifyUpNext = true } = {}) {
  if (!state.isHost || !state.roomInternal) return;
  persistHostRoom();
  state.room = publicRoom(state.roomInternal);
  renderRoom();
  broadcastState();
  if (notifyUpNext && maybeNotifyUpNext()) persistHostRoom();
}

async function startQueueItem(item, positionMs = 0, { archive = true, archiveReason = 'skipped' } = {}) {
  const room = state.roomInternal;
  clearPlaybackTimer();
  if (!MOCK_MODE) {
    const query = room.selectedDeviceId ? `?device_id=${encodeURIComponent(room.selectedDeviceId)}` : '';
    await spotifyFetch(`/me/player/play${query}`, {
      method: 'PUT',
      body: JSON.stringify({ uris: [item.track.uri], position_ms: Math.max(0, Math.floor(positionMs)) })
    });
  }
  if (archive && room.nowPlaying) archiveNowPlaying(archiveReason);
  const now = Date.now();
  room.nowPlaying = {
    track: item.track,
    requestedBy: item.requestedBy || 'Spotify',
    requesterClientId: item.requesterClientId || '',
    requestItemId: item.id || '',
    startedAt: now - positionMs,
    progressMs: positionMs,
    isPlaying: true,
    source: MOCK_MODE ? 'mock' : 'jukebox'
  };
  markRoundRobinServed(item);
  scheduleAutoNext(item.track.durationMs - positionMs);
  roomChanged({ notifyUpNext: false });
  const playingSent = maybeNotifyPlaying(item);
  const nextSent = maybeNotifyUpNext();
  if (playingSent || nextSent) persistHostRoom();
}

async function playNext(forcedItemId = '', fromAuto = false) {
  const room = state.roomInternal;
  let item = null;
  if (forcedItemId) {
    const index = room.queue.findIndex((entry) => entry.id === forcedItemId);
    if (index >= 0) item = room.queue.splice(index, 1)[0];
  }
  if (!item) {
    const next = orderedQueue(room)[0];
    if (next) {
      const index = room.queue.findIndex((entry) => entry.id === next.id);
      item = room.queue.splice(index, 1)[0];
    }
  }
  if (!item) {
    if (fromAuto && room.nowPlaying) {
      archiveNowPlaying('finished');
      clearPlaybackTimer();
      roomChanged();
    }
    return false;
  }
  await startQueueItem(item, 0, { archive: Boolean(room.nowPlaying), archiveReason: fromAuto ? 'finished' : 'skipped' });
  return true;
}

async function pausePlayback() {
  const room = state.roomInternal;
  if (!room.nowPlaying?.isPlaying) return;
  if (!MOCK_MODE) {
    const query = room.selectedDeviceId ? `?device_id=${encodeURIComponent(room.selectedDeviceId)}` : '';
    await spotifyFetch(`/me/player/pause${query}`, { method: 'PUT' });
  }
  const elapsed = Date.now() - room.nowPlaying.startedAt;
  room.nowPlaying.progressMs = Math.min(room.nowPlaying.track.durationMs, Math.max(0, elapsed));
  room.nowPlaying.isPlaying = false;
  clearPlaybackTimer();
  roomChanged();
}

async function resumePlayback() {
  const room = state.roomInternal;
  if (!room.nowPlaying || room.nowPlaying.isPlaying) return;
  const progressMs = room.nowPlaying.progressMs || 0;
  if (!MOCK_MODE) {
    const query = room.selectedDeviceId ? `?device_id=${encodeURIComponent(room.selectedDeviceId)}` : '';
    await spotifyFetch(`/me/player/play${query}`, {
      method: 'PUT',
      body: JSON.stringify({ uris: [room.nowPlaying.track.uri], position_ms: Math.max(0, Math.floor(progressMs)) })
    });
  }
  room.nowPlaying.startedAt = Date.now() - progressMs;
  room.nowPlaying.isPlaying = true;
  scheduleAutoNext(room.nowPlaying.track.durationMs - progressMs);
  roomChanged();
}

async function startOrResumePlayback() {
  const room = state.roomInternal;
  if (room.nowPlaying?.isPlaying) throw new Error('Playback is already running.');
  if (room.nowPlaying && playbackEffectivelyEnded(room.nowPlaying)) {
    archiveNowPlaying('finished');
    clearPlaybackTimer();
  }
  if (room.nowPlaying) {
    await resumePlayback();
    return 'resumed';
  }
  const played = await playNext('', false);
  if (!played) {
    roomChanged();
    throw new Error('The queue is empty.');
  }
  return 'started';
}

async function syncPlayback() {
  if (MOCK_MODE) return roomChanged();
  const room = state.roomInternal;
  const data = await spotifyFetch('/me/player');
  if (!data?.item) {
    if (room.nowPlaying) archiveNowPlaying('stopped');
    clearPlaybackTimer();
    return roomChanged();
  }
  const track = cacheTrack(normaliseSpotifyTrack(data.item));
  const progressMs = Number(data.progress_ms || 0);
  const sameTrack = room.nowPlaying?.track?.id === track.id;
  if (room.nowPlaying && !sameTrack) archiveNowPlaying('changed-in-spotify');
  room.nowPlaying = {
    track,
    requestedBy: sameTrack ? room.nowPlaying?.requestedBy : 'Spotify',
    requesterClientId: sameTrack ? room.nowPlaying?.requesterClientId : '',
    requestItemId: sameTrack ? room.nowPlaying?.requestItemId : '',
    startedAt: Date.now() - progressMs,
    progressMs,
    isPlaying: Boolean(data.is_playing),
    source: 'spotify'
  };
  room.selectedDeviceId = data.device?.id || room.selectedDeviceId;
  room.selectedDeviceName = data.device?.name || room.selectedDeviceName;
  if (playbackEffectivelyEnded(room.nowPlaying)) {
    archiveNowPlaying('finished');
    clearPlaybackTimer();
    return roomChanged();
  }
  scheduleAutoNext(track.durationMs - progressMs);
  roomChanged();
}

function sendPeerMessage(conn, message) {
  if (!conn?.open) throw new Error('Peer connection is not ready.');
  conn.send(message);
}

function sendReply(conn, requestId, ok, data = null, error = '') {
  try {
    sendPeerMessage(conn, { type: 'response', requestId, ok, data, error });
  } catch {}
}

function broadcastState() {
  if (!state.isHost || !state.roomInternal) return;
  const room = publicRoom(state.roomInternal);
  for (const [clientId, conn] of state.guestConnections) {
    if (!conn?.open) {
      state.guestConnections.delete(clientId);
      continue;
    }
    try { conn.send({ type: 'state', room }); } catch {}
  }
}

async function handleGuestCommand(conn, message) {
  const requestId = String(message.requestId || '');
  if (!requestId) return;

  if (message.type === 'join') {
    const nickname = String(message.nickname || '').trim().slice(0, 32);
    const clientId = String(message.clientId || '').trim().slice(0, 100);
    if (!nickname || !clientId) return sendReply(conn, requestId, false, null, 'Nickname and client ID are required.');
    if (state.roomInternal.pin && String(message.pin || '').trim() !== state.roomInternal.pin) {
      return sendReply(conn, requestId, false, null, 'Incorrect room PIN.');
    }
    conn._jukeboxMember = { isHost: false, clientId, nickname };
    const previous = state.guestConnections.get(clientId);
    if (previous && previous !== conn) {
      try { previous.close(); } catch {}
    }
    state.guestConnections.set(clientId, conn);
    sendReply(conn, requestId, true, { room: publicRoom(state.roomInternal) });
    maybeNotifyConnectedMember(conn._jukeboxMember);
    return broadcastState();
  }

  const member = conn._jukeboxMember;
  if (!member) return sendReply(conn, requestId, false, null, 'Join the room first.');

  try {
    if (message.type === 'syncRoom') {
      return sendReply(conn, requestId, true, { room: publicRoom(state.roomInternal) });
    }

    if (message.type === 'search') {
      const q = String(message.q || '').trim().slice(0, 120);
      const tracks = q.length < 2 ? [] : await searchTracks(q);
      return sendReply(conn, requestId, true, { tracks });
    }

    if (message.type === 'request') {
      const trackId = String(message.trackId || '').trim();
      if (!trackId) throw new Error('Track ID is required.');
      const existing = findExistingRequest(trackId);
      if (!existing) enforceRequestCooldown(member);
      const track = existing?.track || await resolveTrack(trackId);
      const target = state.roomInternal.requestMode === 'approval' ? 'suggestions' : 'queue';
      addRequest(track, member, target);
      roomChanged();
      return sendReply(conn, requestId, true, { room: publicRoom(state.roomInternal) });
    }

    if (message.type === 'startPlayback') {
      await startOrResumePlayback();
      return sendReply(conn, requestId, true, { room: publicRoom(state.roomInternal) });
    }

    if (message.type === 'vote') {
      if (state.roomInternal.queueMode === 'hostCurated') throw new Error('Bumps are disabled in host-curated mode.');
      const item = state.roomInternal.queue.find((entry) => entry.id === message.itemId);
      if (!item) throw new Error('Queue item not found.');
      if (item.voters.has(member.clientId)) item.voters.delete(member.clientId); else item.voters.add(member.clientId);
      roomChanged();
      return sendReply(conn, requestId, true, { room: publicRoom(state.roomInternal) });
    }

    if (message.type === 'chat') {
      const chatMessage = addChatMessage(member, message.text);
      return sendReply(conn, requestId, true, { message: chatMessage, room: publicRoom(state.roomInternal) });
    }

    if (message.type === 'reaction') {
      const reaction = publishReaction(member, String(message.emoji || ''));
      return sendReply(conn, requestId, true, { reaction });
    }

    throw new Error('Unknown room command.');
  } catch (error) {
    return sendReply(conn, requestId, false, null, error.message || 'Command failed.');
  }
}

function wireHostIncomingConnection(conn) {
  conn.on('data', (message) => {
    if (!message || typeof message !== 'object') return;
    handleGuestCommand(conn, message).catch(() => {});
  });
  conn.on('close', () => {
    const clientId = conn._jukeboxMember?.clientId;
    if (clientId && state.guestConnections.get(clientId) === conn) state.guestConnections.delete(clientId);
  });
}

async function createPeerWithId(id) {
  await ensurePeerJs();
  return new Promise((resolve, reject) => {
    const peer = new window.Peer(id, peerOptions());
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      try { peer.destroy(); } catch {}
      reject(error);
    };
    const timer = setTimeout(() => fail(new Error('Could not register the jukebox room with the peer signalling service.')), 12000);
    peer.on('open', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(peer);
    });
    peer.on('error', (error) => {
      clearTimeout(timer);
      fail(error);
    });
  });
}

async function openHostPeer(roomCode) {
  let peer = null;
  let lastError = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      peer = await createPeerWithId(peerIdForRoom(roomCode));
      break;
    } catch (error) {
      lastError = error;
      if (error.type !== 'unavailable-id') throw error;
      await new Promise((resolve) => setTimeout(resolve, 900 + attempt * 350));
    }
  }
  if (!peer) throw lastError || new Error('Could not restore the host room peer ID.');
  state.peer = peer;
  peer.on('connection', wireHostIncomingConnection);
  peer.on('disconnected', () => {
    refs.connectionBadge.textContent = `${roomCode} · host reconnecting…`;
    try { peer.reconnect(); } catch {}
  });
  peer.on('open', () => {
    refs.connectionBadge.textContent = `${roomCode} · Host`;
  });
  peer.on('error', (error) => {
    if (error.type !== 'unavailable-id') refs.hostMessage.textContent = `Peer connection: ${error.message}`;
  });
}

async function createGuestPeer() {
  await ensurePeerJs();
  return new Promise((resolve, reject) => {
    const peer = new window.Peer(undefined, peerOptions());
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('Could not connect to the peer signalling service.'));
    }, 12000);
    peer.on('open', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(peer);
    });
    peer.on('error', (error) => {
      if (!settled && error.type !== 'peer-unavailable') {
        settled = true;
        clearTimeout(timer);
        reject(error);
      }
      if (error.type === 'peer-unavailable' && state.roomCode) scheduleGuestReconnect();
    });
  });
}

function handleGuestPeerMessage(message) {
  if (!message || typeof message !== 'object') return;
  if (message.type === 'state' && message.room) {
    state.room = message.room;
    renderRoom();
    return;
  }
  if (message.type === 'reaction' && message.reaction) {
    showReaction(message.reaction);
    return;
  }
  if (message.type === 'requesterToast' && message.notification) {
    showRequesterToast(message.notification);
    return;
  }
  if (message.type !== 'response') return;
  const pending = state.pendingCommands.get(message.requestId);
  if (!pending) return;
  state.pendingCommands.delete(message.requestId);
  clearTimeout(pending.timer);
  if (message.ok) pending.resolve(message.data || {}); else pending.reject(new Error(message.error || 'Room command failed.'));
}

function connectDataConnection(peer, roomCode) {
  return new Promise((resolve, reject) => {
    const conn = peer.connect(peerIdForRoom(roomCode), { reliable: true, serialization: 'json' });
    const timer = setTimeout(() => {
      try { conn.close(); } catch {}
      reject(new Error('The host room could not be reached. Check the room code or try again.'));
    }, 12000);
    conn.on('open', () => {
      clearTimeout(timer);
      conn.on('data', handleGuestPeerMessage);
      conn.on('close', () => {
        if (state.hostConnection === conn) {
          state.hostConnection = null;
          refs.connectionBadge.textContent = `${state.roomCode} · disconnected`;
          scheduleGuestReconnect();
        }
      });
      conn.on('error', () => {
        if (state.hostConnection === conn) scheduleGuestReconnect();
      });
      resolve(conn);
    });
    conn.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function guestCommand(type, payload = {}, connOverride = null) {
  const conn = connOverride || state.hostConnection;
  if (!conn?.open) return Promise.reject(new Error('The host browser is not connected.'));
  const requestId = randomToken(18);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      state.pendingCommands.delete(requestId);
      reject(new Error('The host did not respond in time.'));
    }, COMMAND_TIMEOUT_MS);
    state.pendingCommands.set(requestId, { resolve, reject, timer });
    try {
      conn.send({ type, requestId, ...payload });
    } catch (error) {
      clearTimeout(timer);
      state.pendingCommands.delete(requestId);
      reject(error);
    }
  });
}

async function connectGuest(roomCode, nickname, pin, { reconnect = false } = {}) {
  if (!state.peer || state.peer.destroyed) state.peer = await createGuestPeer();
  const conn = await connectDataConnection(state.peer, roomCode);
  const data = await guestCommand('join', { roomCode, nickname, pin, clientId: state.clientId }, conn);
  state.hostConnection = conn;
  state.viewMode = state.viewMode || 'room';
  state.room = data.room;
  state.roomCode = roomCode;
  state.nickname = nickname;
  state.joinPin = pin;
  localStorage.setItem('jukebox.nickname', nickname);
  sessionStorage.setItem(`jukebox.static.pin.${roomCode}`, pin);
  renderRoom();
  refs.connectionBadge.textContent = `${roomCode} · ${nickname}`;
  if (!reconnect) history.replaceState({}, '', `${basePageUrl()}?room=${encodeURIComponent(roomCode)}`);
}

function scheduleGuestReconnect() {
  if (state.isHost || !state.roomCode || state.guestReconnectTimer) return;
  refs.connectionBadge.textContent = `${state.roomCode} · reconnecting…`;
  state.guestReconnectTimer = setTimeout(async () => {
    state.guestReconnectTimer = null;
    try {
      await connectGuest(state.roomCode, currentNickname(), state.joinPin, { reconnect: true });
    } catch {
      scheduleGuestReconnect();
    }
  }, 2200);
}

function createMoveButton(item, direction, disabled, label) {
  const button = el('button', 'button small-button', label);
  button.type = 'button';
  button.title = direction < 0 ? 'Move up' : 'Move down';
  button.setAttribute('aria-label', button.title);
  button.disabled = disabled;
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      moveQueueItem(item.id, direction);
    } catch (error) {
      showToast(error.message);
    }
  });
  return button;
}

function createQueueRow(item, index, total) {
  const row = el('div', 'queue-row');
  row.append(el('div', 'queue-rank', String(index + 1)));
  row.append(createTrackCopy(item.track, `${item.track.artists} · requested by ${item.requestedBy}`));
  const actions = el('div', 'track-actions');

  if (state.room?.votingEnabled) {
    const vote = el('button', 'button small-button vote-button');
    vote.type = 'button';
    vote.append(el('span', 'vote-score', String(item.score)), document.createTextNode(' Bump'));
    vote.addEventListener('click', async () => {
      vote.disabled = true;
      try {
        await voteQueueItem(item.id);
      } catch (error) {
        showToast(error.message);
      } finally {
        vote.disabled = false;
      }
    });
    actions.append(vote);
  }

  if (state.isHost && state.room?.queueMode === 'hostCurated') {
    const move = el('span', 'move-buttons');
    move.append(createMoveButton(item, -1, index === 0, '↑'), createMoveButton(item, 1, index === total - 1, '↓'));
    actions.append(move);
  }

  if (state.isHost) {
    const playNow = el('button', 'button small-button', 'Play now');
    playNow.type = 'button';
    playNow.addEventListener('click', () => hostPlayerAction('next', { itemId: item.id }));
    const remove = el('button', 'button small-button danger', 'Remove');
    remove.type = 'button';
    remove.addEventListener('click', () => {
      try { removeQueueItem(item.id); } catch (error) { showToast(error.message); }
    });
    actions.append(playNow, remove);
  }

  row.append(actions);
  return row;
}

function renderSearchResults(tracks) {
  refs.searchResults.replaceChildren();
  if (!tracks.length) {
    refs.searchResults.append(el('div', 'empty-state', 'No tracks found.'));
    return;
  }
  for (const track of tracks) {
    const row = el('div', 'track-row');
    const actions = el('div', 'track-actions');
    const buttonText = state.room?.requestMode === 'approval' && !state.isHost ? 'Suggest' : 'Add';
    const add = el('button', 'button small-button primary', buttonText);
    add.type = 'button';
    add.addEventListener('click', async () => {
      add.disabled = true;
      try {
        await requestTrack(track.id);
        showToast(buttonText === 'Suggest' ? 'Suggestion sent' : 'Added or bumped');
      } catch (error) {
        showToast(error.message);
      } finally {
        add.disabled = false;
      }
    });
    actions.append(add);
    row.append(createArt(track), createTrackCopy(track), actions);
    refs.searchResults.append(row);
  }
}

function renderQueue(items) {
  refs.queueCount.textContent = String(items.length);
  refs.queueList.replaceChildren();
  if (!items.length) {
    refs.queueList.append(el('div', 'empty-state', 'The queue is empty. Search for something everyone wants to hear.'));
    return;
  }
  items.forEach((item, index) => refs.queueList.append(createQueueRow(item, index, items.length)));
}

function renderSuggestions(items) {
  refs.suggestionCount.textContent = String(items.length);
  const shouldShow = state.room?.requestMode === 'approval' && (state.isHost || items.length > 0);
  refs.suggestionsPanel.classList.toggle('hidden', !shouldShow);
  refs.suggestionList.replaceChildren();
  if (!items.length) {
    refs.suggestionList.append(el('div', 'empty-state', state.isHost ? 'No suggestions waiting for approval.' : 'Suggestions will appear here while they wait for the host.'));
    return;
  }
  for (const item of items) {
    const row = el('div', 'track-row');
    const actions = el('div', 'track-actions');
    if (state.isHost) {
      const accept = el('button', 'button small-button primary', 'Accept');
      const reject = el('button', 'button small-button danger', 'Reject');
      accept.type = reject.type = 'button';
      accept.addEventListener('click', () => suggestionAction(item.id, 'accept'));
      reject.addEventListener('click', () => suggestionAction(item.id, 'reject'));
      actions.append(accept, reject);
    } else {
      actions.append(el('span', 'pill', 'Waiting'));
    }
    row.append(createArt(item.track), createTrackCopy(item.track, `${item.track.artists} · suggested by ${item.requestedBy}`), actions);
    refs.suggestionList.append(row);
  }
}

function renderHistory(items) {
  refs.historyCount.textContent = String(items.length);
  refs.historyList.replaceChildren();
  if (!items.length) {
    refs.historyList.append(el('div', 'empty-state', 'Played tracks will appear here.'));
    return;
  }
  for (const item of items.slice(0, 20)) {
    const row = el('div', 'track-row');
    const when = relativeTime(item.endedAt || item.playedAt);
    row.append(createArt(item.track), createTrackCopy(item.track, `${item.track.artists} · ${item.requestedBy || 'Spotify'} · ${when}`), el('span', 'pill', 'Played'));
    refs.historyList.append(row);
  }
}

function renderJukeboxQueue(items = []) {
  refs.jukeboxQueueCount.textContent = String(items.length);
  refs.jukeboxQueueList.replaceChildren();
  if (!items.length) {
    refs.jukeboxQueueList.append(el('div', 'empty-state', 'The queue is empty.'));
    return;
  }
  for (const [index, item] of items.slice(0, 12).entries()) {
    const row = el('div', 'jukebox-queue-item');
    row.append(el('div', 'jukebox-queue-number', String(index + 1)));
    const copy = el('div', 'track-copy');
    copy.append(
      el('div', 'jukebox-queue-title', item.track.name),
      el('div', 'jukebox-queue-meta', `${item.track.artists} · ${item.requestedBy}`)
    );
    row.append(copy, el('div', 'jukebox-queue-score', `${item.score} bump${item.score === 1 ? '' : 's'}`));
    refs.jukeboxQueueList.append(row);
  }
}

function renderChatInto(listRef, countRef, messages = []) {
  countRef.textContent = String(messages.length);
  listRef.replaceChildren();
  if (!messages.length) {
    listRef.append(el('div', 'empty-state', 'No messages yet.'));
    return;
  }
  for (const message of messages) {
    const row = el('div', `chat-message${message.isHost ? ' host-message' : ''}`);
    const meta = el('div', 'chat-message-meta');
    meta.append(
      el('span', 'chat-message-author', message.isHost ? `${message.nickname} · Host` : message.nickname),
      el('span', '', relativeTime(message.sentAt))
    );
    row.append(meta, el('p', 'chat-message-text', message.text));
    listRef.append(row);
  }
  listRef.scrollTop = listRef.scrollHeight || 0;
}

function renderJukeboxView() {
  if (!state.room) return;
  refs.jukeboxRoomCode.textContent = state.room.code;
  const playing = state.room.nowPlaying;
  const ended = playbackEffectivelyEnded(playing);
  const active = playing && !ended ? playing : null;
  refs.jukeboxVinyl.classList.toggle('is-playing', Boolean(active?.isPlaying));
  if (!active) {
    refs.jukeboxPlaybackState.textContent = Number(state.room.queueCount || 0) > 0 ? 'Queue Ready' : 'Nothing Playing';
    refs.jukeboxSongTitle.textContent = Number(state.room.queueCount || 0) > 0 ? 'Ready for the next track' : 'Queue up a song';
    refs.jukeboxSongArtists.textContent = Number(state.room.queueCount || 0) > 0 ? 'The next request is waiting.' : 'The next request will appear here.';
    refs.jukeboxSongAlbum.textContent = '';
    refs.jukeboxRequestedBy.textContent = '';
    refs.jukeboxRequestedBy.classList.add('hidden');
    refs.jukeboxArt.classList.add('hidden');
    refs.jukeboxArtPlaceholder.classList.remove('hidden');
    refs.jukeboxProgressBar.style.width = '0%';
    refs.jukeboxProgressCurrent.textContent = '0:00';
    refs.jukeboxProgressDuration.textContent = '0:00';
  } else {
    const track = active.track;
    refs.jukeboxPlaybackState.textContent = active.isPlaying ? 'Now Playing' : 'Paused';
    refs.jukeboxSongTitle.textContent = track.name;
    refs.jukeboxSongArtists.textContent = track.artists;
    refs.jukeboxSongAlbum.textContent = track.album || '';
    refs.jukeboxRequestedBy.textContent = active.requestedBy && active.requestedBy !== 'Spotify' ? `Requested by ${active.requestedBy}` : '';
    refs.jukeboxRequestedBy.classList.toggle('hidden', !refs.jukeboxRequestedBy.textContent);
    if (track.image) {
      refs.jukeboxArt.src = track.image;
      refs.jukeboxArt.alt = `${track.name} album artwork`;
      refs.jukeboxArt.classList.remove('hidden');
      refs.jukeboxArtPlaceholder.classList.add('hidden');
    } else {
      refs.jukeboxArt.removeAttribute?.('src');
      refs.jukeboxArt.alt = '';
      refs.jukeboxArt.classList.add('hidden');
      refs.jukeboxArtPlaceholder.classList.remove('hidden');
    }
  }
  renderJukeboxQueue(state.room.queue || []);
  renderChatInto(refs.jukeboxChatList, refs.jukeboxChatCount, state.room.chat || []);
}

function applyViewMode() {
  const jukebox = state.viewMode === 'jukebox';
  refs.roomView.classList.toggle('hidden', jukebox);
  refs.jukeboxView.classList.toggle('hidden', !jukebox);
}

function renderNowPlaying() {
  const playing = state.room?.nowPlaying;
  if (!playing) {
    const queueReady = Number(state.room?.queueCount || 0) > 0;
    refs.nowPlayingTitle.textContent = 'Nothing playing';
    refs.nowPlayingMeta.textContent = queueReady ? 'The queue is ready to start.' : 'Add a track to get started.';
    const placeholder = el('div', 'album-art placeholder-art', '♪');
    placeholder.id = 'nowPlayingArt';
    refs.nowPlayingArt.replaceWith(placeholder);
    refs.nowPlayingArt = placeholder;
    refs.progressBar.style.width = '0%';
    refs.progressCurrent.textContent = '0:00';
    refs.progressDuration.textContent = '0:00';
    refs.pauseResumeButton.textContent = queueReady ? 'Start queue' : 'Resume';
    refs.pauseResumeButton.disabled = !queueReady;
    refs.guestPlaybackControls.classList.toggle('hidden', state.isHost || !queueReady);
    refs.guestStartButton.textContent = 'Start queue';
    refs.guestPlaybackHint.textContent = 'The previous queue has stopped. Start the next requested track.';
    return;
  }
  const { track } = playing;
  const ended = playbackEffectivelyEnded(playing);
  refs.nowPlayingTitle.textContent = ended ? 'Nothing playing' : track.name;
  const pieces = ended ? ['The previous track has finished.'] : [track.artists];
  if (!ended && playing.requestedBy && playing.requestedBy !== 'Spotify') pieces.push(`requested by ${playing.requestedBy}`);
  if (!ended && state.room.selectedDeviceName) pieces.push(state.room.selectedDeviceName);
  if (!ended && !playing.isPlaying) pieces.push('paused');
  refs.nowPlayingMeta.textContent = pieces.join(' · ');
  refs.guestPlaybackControls.classList.toggle('hidden', state.isHost || playing.isPlaying || (ended && Number(state.room?.queueCount || 0) <= 0));
  refs.guestStartButton.textContent = ended ? 'Start queue' : 'Resume playback';
  refs.guestPlaybackHint.textContent = ended
    ? 'The previous track has finished. Start the next requested track.'
    : 'Playback is paused. Resume the current track without skipping it.';
  const art = createArt(track, 'album-art');
  art.id = 'nowPlayingArt';
  refs.nowPlayingArt.replaceWith(art);
  refs.nowPlayingArt = art;
  refs.progressDuration.textContent = formatTime(track.durationMs);
  refs.pauseResumeButton.textContent = ended ? 'Start queue' : playing.isPlaying ? 'Pause' : 'Resume';
  refs.pauseResumeButton.disabled = ended && Number(state.room?.queueCount || 0) <= 0;
  updateProgress();
}

function updateProgress() {
  const playing = state.room?.nowPlaying;
  if (!playing) return;
  const duration = playing.track.durationMs || 1;
  const progress = playing.isPlaying ? Date.now() - playing.startedAt : playing.progressMs || 0;
  const clamped = Math.max(0, Math.min(duration, progress));
  refs.progressCurrent.textContent = formatTime(clamped);
  refs.progressDuration.textContent = formatTime(duration);
  refs.progressBar.style.width = `${Math.min(100, (clamped / duration) * 100)}%`;
  refs.jukeboxProgressCurrent.textContent = formatTime(clamped);
  refs.jukeboxProgressDuration.textContent = formatTime(duration);
  refs.jukeboxProgressBar.style.width = `${Math.min(100, (clamped / duration) * 100)}%`;
}

function renderRoom() {
  if (!state.room) return;
  refs.landingView.classList.add('hidden');
  applyViewMode();
  refs.roomCodeDisplay.textContent = state.room.code;
  refs.connectionBadge.textContent = `${state.room.code} · ${state.isHost ? 'Host' : currentNickname()}`;
  refs.syncRoomButton.classList.toggle('hidden', state.isHost);

  refs.pinBadge.textContent = state.room.pinRequired ? 'PIN protected' : 'No PIN';
  refs.pinBadge.classList.toggle('active', state.room.pinRequired);
  refs.roomShareHint.textContent = state.room.pinRequired
    ? 'Share the room code or invite link. Send the PIN separately.'
    : 'Share the room code or invite link with your friends.';

  refs.requestModeBadge.textContent = state.room.requestMode === 'approval' ? 'Approval mode' : 'Open queue';
  refs.requestModeBadge.classList.toggle('active', state.room.requestMode === 'open');
  const cooldown = Number(state.room.requestCooldownSeconds || 0);
  refs.cooldownBadge.classList.toggle('hidden', cooldown <= 0);
  refs.cooldownBadge.textContent = `${cooldown} sec cooldown`;
  refs.queueModeBadge.textContent = queueModeLabel(state.room.queueMode);
  refs.queueModeHelp.textContent = queueModeHelp(state.room.queueMode);

  refs.hostPanel.classList.toggle('hidden', !state.isHost);
  refs.spotifyBadge.textContent = state.room.mockMode ? 'Mock mode' : state.room.spotifyConnected ? 'Spotify connected' : 'Not connected';
  refs.spotifyBadge.classList.toggle('active', state.room.spotifyConnected);
  refs.connectSpotifyButton.classList.toggle('hidden', !state.isHost || state.room.spotifyConnected || state.room.mockMode);
  refs.browserPlayerButton.disabled = !state.room.spotifyConnected;
  refs.browserPlayerButton.textContent = state.room.mockMode ? 'Use mock browser' : state.browserDeviceId ? 'Browser connected' : 'Use this browser';

  refs.autoPlayInput.checked = Boolean(state.room.autoPlay);
  refs.requesterToastsInput.checked = state.room.requesterToastsEnabled !== false;
  refs.hostRequestModeInput.value = state.room.requestMode;
  refs.hostQueueModeInput.value = state.room.queueMode;
  refs.hostCooldownInput.value = String(cooldown);
  if (state.room.selectedDeviceId && [...refs.deviceSelect.options].some((option) => option.value === state.room.selectedDeviceId)) {
    refs.deviceSelect.value = state.room.selectedDeviceId;
  }

  renderQueue(state.room.queue || []);
  renderSuggestions(state.room.suggestions || []);
  renderHistory(state.room.history || []);
  renderChat(state.room.chat || []);
  renderNowPlaying();
  renderJukeboxView();

  if (state.isHost) {
    const peerMode = config.peer?.host ? `Custom peer server: ${config.peer.host}` : 'PeerJS Cloud signalling';
    refs.hostMessage.textContent = state.room.mockMode
      ? `Mock mode is active. ${peerMode}.`
      : state.room.spotifyConnected
        ? `${peerMode}. Host browser is authoritative for the room.`
        : `Connect Spotify to search and play. ${peerMode}.`;
  }
}

async function forceRoomSync() {
  if (state.isHost) return;
  if (!state.roomCode) throw new Error('Join a room first.');
  const now = Date.now();
  const waitMs = ROOM_SYNC_COOLDOWN_MS - (now - state.lastRoomSyncAt);
  if (state.roomSyncBusy) throw new Error('Room sync is already running.');
  if (waitMs > 0) throw new Error(`Try syncing again in ${Math.ceil(waitMs / 1000)} second${waitMs > 1000 ? 's' : ''}.`);
  state.lastRoomSyncAt = now;
  state.roomSyncBusy = true;
  refs.syncRoomButton.disabled = true;
  clearTimeout(state.guestReconnectTimer);
  state.guestReconnectTimer = null;
  try {
    if (!state.hostConnection?.open) {
      try { state.hostConnection?.close(); } catch {}
      state.hostConnection = null;
      await connectGuest(state.roomCode, currentNickname(), state.joinPin, { reconnect: true });
    }
    const data = await guestCommand('syncRoom');
    if (!data.room) throw new Error('The host did not return room state.');
    state.room = data.room;
    renderRoom();
    refs.connectionBadge.textContent = `${state.roomCode} · ${currentNickname()}`;
    showToast('Room synced');
  } catch (error) {
    refs.connectionBadge.textContent = `${state.roomCode} · disconnected`;
    scheduleGuestReconnect();
    throw error;
  } finally {
    state.roomSyncBusy = false;
    refs.syncRoomButton.disabled = false;
  }
}

async function performSearch(q) {
  if (state.isHost) return searchTracks(q);
  const data = await guestCommand('search', { q });
  return data.tracks || [];
}

async function guestStartPlayback() {
  if (state.isHost) return startOrResumePlayback();
  refs.guestStartButton.disabled = true;
  try {
    await guestCommand('startPlayback');
  } finally {
    refs.guestStartButton.disabled = false;
  }
}

async function requestTrack(trackId) {
  if (!state.isHost) {
    await guestCommand('request', { trackId });
    return;
  }
  const member = hostMember();
  const existing = findExistingRequest(trackId);
  const track = existing?.track || await resolveTrack(trackId);
  addRequest(track, member, 'queue');
  roomChanged();
}

async function voteQueueItem(itemId) {
  if (!state.isHost) {
    await guestCommand('vote', { itemId });
    return;
  }
  const room = state.roomInternal;
  if (room.queueMode === 'hostCurated') throw new Error('Bumps are disabled in host-curated mode.');
  const item = room.queue.find((entry) => entry.id === itemId);
  if (!item) throw new Error('Queue item not found.');
  const clientId = hostMember().clientId;
  if (item.voters.has(clientId)) item.voters.delete(clientId); else item.voters.add(clientId);
  roomChanged();
}

function suggestionAction(id, action) {
  if (!state.isHost) return;
  const room = state.roomInternal;
  const index = room.suggestions.findIndex((entry) => entry.id === id);
  if (index < 0) return showToast('Suggestion not found.');
  if (action === 'reject') {
    room.suggestions.splice(index, 1);
    return roomChanged();
  }
  const [item] = room.suggestions.splice(index, 1);
  const duplicate = room.queue.find((entry) => entry.track.id === item.track.id);
  if (duplicate) {
    for (const voter of item.voters) duplicate.voters.add(voter);
    if (duplicate.requesterClientId !== item.requesterClientId) duplicate.voters.add(item.requesterClientId);
  } else {
    room.queue.push(item);
  }
  roomChanged();
}

function moveQueueItem(id, direction) {
  if (!state.isHost) return;
  const room = state.roomInternal;
  if (room.queueMode !== 'hostCurated') throw new Error('Manual queue movement is available in host-curated mode.');
  const index = room.queue.findIndex((entry) => entry.id === id);
  if (index < 0) throw new Error('Queue item not found.');
  const target = Math.max(0, Math.min(room.queue.length - 1, index + (direction < 0 ? -1 : 1)));
  if (target !== index) {
    const [item] = room.queue.splice(index, 1);
    room.queue.splice(target, 0, item);
  }
  roomChanged();
}

function removeQueueItem(id) {
  if (!state.isHost) return;
  state.roomInternal.queue = state.roomInternal.queue.filter((entry) => entry.id !== id);
  roomChanged();
}

function updateHostSettings(settings) {
  const room = state.roomInternal;
  if (settings.requestMode === 'open' || settings.requestMode === 'approval') {
    const wasApproval = room.requestMode === 'approval';
    room.requestMode = settings.requestMode;
    if (wasApproval && room.requestMode === 'open' && room.suggestions.length) {
      for (const suggestion of room.suggestions) {
        const duplicate = room.queue.find((entry) => entry.track.id === suggestion.track.id);
        if (duplicate) {
          for (const voter of suggestion.voters) duplicate.voters.add(voter);
          if (duplicate.requesterClientId !== suggestion.requesterClientId) duplicate.voters.add(suggestion.requesterClientId);
        } else {
          room.queue.push(suggestion);
        }
      }
      room.suggestions = [];
    }
  }
  if (settings.queueMode && ['democratic', 'roundRobin', 'hostCurated'].includes(settings.queueMode)) {
    if (settings.queueMode === 'hostCurated' && room.queueMode !== 'hostCurated') room.queue = orderedQueue(room);
    room.queueMode = settings.queueMode;
  }
  if (settings.requestCooldownSeconds !== undefined) room.requestCooldownSeconds = cleanCooldown(settings.requestCooldownSeconds);
  if (typeof settings.requesterToastsEnabled === 'boolean') {
    room.requesterToastsEnabled = settings.requesterToastsEnabled;
    if (room.requesterToastsEnabled) {
      maybeNotifyUpNext();
      if (room.nowPlaying?.requestItemId) {
        maybeNotifyPlaying({
          id: room.nowPlaying.requestItemId,
          track: room.nowPlaying.track,
          requestedBy: room.nowPlaying.requestedBy,
          requesterClientId: room.nowPlaying.requesterClientId
        });
      }
    }
  }
  if (typeof settings.autoPlay === 'boolean') {
    room.autoPlay = settings.autoPlay;
    if (room.autoPlay && room.nowPlaying?.isPlaying) {
      scheduleAutoNext(room.nowPlaying.track.durationMs - (Date.now() - room.nowPlaying.startedAt));
    } else if (!room.autoPlay) {
      clearPlaybackTimer();
    }
  }
  roomChanged();
}

async function beginSpotifyLogin() {
  if (!config.spotifyClientId) throw new Error('This static build has no Spotify Client ID. Rebuild it with build-static.bat.');
  const verifier = randomToken(72);
  const challengeBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(challengeBytes)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  const oauthState = randomToken(32);
  const redirectUri = config.spotifyRedirectUri || basePageUrl();
  sessionStorage.setItem('jukebox.spotify.pkce.pending', JSON.stringify({ verifier, state: oauthState, roomCode: state.roomCode, redirectUri }));
  persistHostRoom();
  const authorize = new URL('https://accounts.spotify.com/authorize');
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('client_id', config.spotifyClientId);
  authorize.searchParams.set('scope', SPOTIFY_SCOPES);
  authorize.searchParams.set('redirect_uri', redirectUri);
  authorize.searchParams.set('state', oauthState);
  authorize.searchParams.set('code_challenge_method', 'S256');
  authorize.searchParams.set('code_challenge', challenge);
  location.href = authorize.toString();
}

async function completeSpotifyCallback(params) {
  const code = params.get('code');
  if (!code) return false;
  let pending = null;
  try { pending = JSON.parse(sessionStorage.getItem('jukebox.spotify.pkce.pending') || 'null'); } catch {}
  if (!pending || pending.state !== params.get('state')) throw new Error('Spotify login state could not be verified. Try connecting again.');
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.spotifyClientId,
      grant_type: 'authorization_code',
      code,
      redirect_uri: pending.redirectUri,
      code_verifier: pending.verifier
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error_description || data.error || 'Could not connect Spotify.');
  localStorage.setItem('jukebox.spotify.pkce.tokens', JSON.stringify({
    accessToken: data.access_token,
    refreshToken: data.refresh_token || '',
    expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000 - 30000,
    authorisedAt: Date.now()
  }));
  sessionStorage.removeItem('jukebox.spotify.pkce.pending');
  const roomCode = pending.roomCode || '';
  history.replaceState({}, '', roomCode ? `${basePageUrl()}?room=${encodeURIComponent(roomCode)}` : basePageUrl());
  return roomCode;
}

async function loadDevices() {
  if (!state.isHost) return;
  refs.refreshDevicesButton.disabled = true;
  refs.hostMessage.textContent = 'Looking for Spotify devices…';
  try {
    let devices;
    if (MOCK_MODE) {
      devices = [
        { id: 'mock-device', name: 'Mock gaming PC', type: 'computer', is_active: state.roomInternal.selectedDeviceId !== 'mock-browser' },
        { id: 'mock-browser', name: 'Game Night Jukebox Browser', type: 'computer', is_active: state.roomInternal.selectedDeviceId === 'mock-browser' }
      ];
    } else {
      const data = await spotifyFetch('/me/player/devices');
      devices = data.devices || [];
    }
    refs.deviceSelect.replaceChildren(new Option('Use active Spotify device', ''));
    for (const device of devices) {
      const option = new Option(`${device.name} · ${device.type}${device.is_active ? ' · active' : ''}`, device.id || '');
      option.dataset.name = device.name;
      refs.deviceSelect.append(option);
    }
    if (state.roomInternal.selectedDeviceId) refs.deviceSelect.value = state.roomInternal.selectedDeviceId;
    refs.hostMessage.textContent = devices.length ? 'Choose the device that should play the jukebox.' : 'No Spotify devices found. Open Spotify on a device and try again.';
  } catch (error) {
    refs.hostMessage.textContent = error.message;
  } finally {
    refs.refreshDevicesButton.disabled = false;
  }
}

async function selectPlaybackDevice(deviceId, deviceName = '', play = false) {
  const room = state.roomInternal;
  room.selectedDeviceId = String(deviceId || '').slice(0, 200);
  room.selectedDeviceName = String(deviceName || '').slice(0, 100);
  if (!MOCK_MODE && room.selectedDeviceId) {
    await spotifyFetch('/me/player', {
      method: 'PUT',
      body: JSON.stringify({ device_ids: [room.selectedDeviceId], play: Boolean(play) })
    });
  }
  roomChanged();
}

function loadSpotifySdk() {
  if (window.Spotify?.Player) return Promise.resolve(window.Spotify);
  if (state.spotifySdkPromise) return state.spotifySdkPromise;
  state.spotifySdkPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-jukebox-spotify-sdk]');
    const timeout = setTimeout(() => reject(new Error('Spotify Web Playback SDK did not load.')), 15000);
    const previousReady = window.onSpotifyWebPlaybackSDKReady;
    window.onSpotifyWebPlaybackSDKReady = () => {
      try { previousReady?.(); } catch {}
      clearTimeout(timeout);
      if (window.Spotify?.Player) resolve(window.Spotify); else reject(new Error('Spotify Web Playback SDK was unavailable.'));
    };
    if (existing) return;
    const script = document.createElement('script');
    script.src = 'https://sdk.scdn.co/spotify-player.js';
    script.async = true;
    script.dataset.jukeboxSpotifySdk = '1';
    script.onerror = () => {
      clearTimeout(timeout);
      reject(new Error('Could not download the Spotify Web Playback SDK.'));
    };
    document.head.append(script);
  });
  return state.spotifySdkPromise;
}

async function initBrowserPlayer() {
  if (!state.isHost || !state.room?.spotifyConnected) return;
  refs.browserPlayerButton.disabled = true;
  try {
    if (MOCK_MODE) {
      state.browserDeviceId = 'mock-browser';
      await selectPlaybackDevice(state.browserDeviceId, 'Game Night Jukebox Browser');
      refs.browserPlayerStatus.textContent = 'Mock browser player selected.';
      refs.browserPlayerButton.textContent = 'Browser connected';
      return loadDevices();
    }
    if (state.browserPlayer && state.browserDeviceId) {
      await selectPlaybackDevice(state.browserDeviceId, 'Game Night Jukebox Browser');
      refs.browserPlayerStatus.textContent = 'This tab is the selected Spotify Connect device.';
      return;
    }
    refs.browserPlayerStatus.textContent = 'Loading Spotify browser player…';
    const Spotify = await loadSpotifySdk();
    const player = new Spotify.Player({
      name: `Game Night Jukebox ${state.roomCode}`,
      getOAuthToken: (callback) => {
        currentSpotifyAccessToken().then(callback).catch((error) => {
          refs.browserPlayerStatus.textContent = error.message;
        });
      },
      volume: 0.7,
      enableMediaSession: true
    });
    state.browserPlayer = player;
    player.addListener('ready', async ({ device_id: deviceId }) => {
      state.browserDeviceId = deviceId;
      refs.activateBrowserAudioButton.classList.remove('hidden');
      try {
        await selectPlaybackDevice(deviceId, 'Game Night Jukebox Browser');
        refs.browserPlayerStatus.textContent = 'This tab is the selected Spotify Connect device.';
        refs.browserPlayerButton.textContent = 'Browser connected';
        await loadDevices();
      } catch (error) {
        refs.browserPlayerStatus.textContent = error.message;
      }
    });
    player.addListener('not_ready', () => {
      refs.browserPlayerStatus.textContent = 'The browser Spotify device went offline. Click Use this browser to reconnect.';
      state.browserDeviceId = '';
    });
    for (const eventName of ['initialization_error', 'authentication_error', 'account_error', 'playback_error']) {
      player.addListener(eventName, ({ message }) => { refs.browserPlayerStatus.textContent = message; });
    }
    const connected = await player.connect();
    if (!connected) throw new Error('Spotify could not connect the browser player.');
    refs.browserPlayerStatus.textContent = 'Connecting browser player to Spotify…';
  } catch (error) {
    if (!window.Spotify?.Player) state.spotifySdkPromise = null;
    refs.browserPlayerStatus.textContent = error.message;
    showToast(error.message);
  } finally {
    refs.browserPlayerButton.disabled = false;
  }
}

async function hostPlayerAction(action, payload = {}) {
  if (!state.isHost) return;
  try {
    if (action === 'next') {
      const played = await playNext(String(payload.itemId || ''));
      if (!played) throw new Error('The queue is empty.');
    } else if (action === 'start') await startOrResumePlayback();
    else if (action === 'pause') await pausePlayback();
    else if (action === 'resume') await resumePlayback();
    else if (action === 'sync') await syncPlayback();
    else if (action === 'settings') updateHostSettings(payload);
  } catch (error) {
    showToast(error.message);
  }
}

async function createStaticRoom() {
  const pin = refs.roomPinCreateInput.value.trim();
  if (pin && !/^\d{4,8}$/.test(pin)) throw new Error('Room PIN must be 4 to 8 digits.');
  if (state.creatingRoom) return;
  state.creatingRoom = true;
  refs.createRoomButton.disabled = true;
  try {
    let code = '';
    let peer = null;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      code = randomCode(8);
      try {
        peer = await createPeerWithId(peerIdForRoom(code));
        break;
      } catch (error) {
        if (error.type !== 'unavailable-id') throw error;
      }
    }
    if (!peer) throw new Error('Could not allocate a unique room code. Try again.');
    state.peer = peer;
    peer.on('connection', wireHostIncomingConnection);
    peer.on('disconnected', () => {
      refs.connectionBadge.textContent = `${code} · host reconnecting…`;
      try { peer.reconnect(); } catch {}
    });
    state.roomCode = code;
    state.isHost = true;
    state.viewMode = 'room';
    state.nickname = refs.hostNameInput.value.trim() || 'Host';
    state.roomInternal = createRoomModel({
      code,
      hostName: state.nickname,
      pin,
      requestMode: refs.requestModeInput.value,
      queueMode: refs.queueModeInput.value,
      requestCooldownSeconds: refs.requestCooldownInput.value
    });
    localStorage.setItem('jukebox.nickname', state.nickname);
    roomChanged();
    history.replaceState({}, '', `${basePageUrl()}?room=${encodeURIComponent(code)}`);
    if (MOCK_MODE) loadDevices();
  } finally {
    state.creatingRoom = false;
    refs.createRoomButton.disabled = false;
  }
}

async function restoreHostRoom(room) {
  state.roomCode = room.code;
  state.isHost = true;
  state.viewMode = 'room';
  state.nickname = room.hostName;
  state.roomInternal = room;
  await openHostPeer(room.code);
  state.room = publicRoom(room);
  renderRoom();
  if (room.nowPlaying?.isPlaying && room.autoPlay) {
    const remaining = room.nowPlaying.track.durationMs - (Date.now() - room.nowPlaying.startedAt);
    if (remaining > 0) scheduleAutoNext(remaining); else playNext('', true).catch(() => {});
  }
  if (spotifyConnected()) loadDevices();
}

function leaveRoom() {
  const wasHost = state.isHost;
  clearTimeout(state.guestReconnectTimer);
  state.guestReconnectTimer = null;
  clearPlaybackTimer();
  for (const pending of state.pendingCommands.values()) {
    clearTimeout(pending.timer);
    pending.reject(new Error('Left the room.'));
  }
  state.pendingCommands.clear();
  try { state.hostConnection?.close(); } catch {}
  try { state.peer?.destroy(); } catch {}
  try { state.browserPlayer?.disconnect(); } catch {}
  state.hostConnection = null;
  state.peer = null;
  state.guestConnections.clear();
  state.room = null;
  state.roomInternal = null;
  state.roomCode = '';
  state.isHost = false;
  state.joinPin = '';
  state.browserPlayer = null;
  state.browserDeviceId = '';
  state.lastRoomSyncAt = 0;
  state.roomSyncBusy = false;
  state.viewMode = 'room';
  refs.roomView.classList.add('hidden');
  refs.jukeboxView.classList.add('hidden');
  refs.landingView.classList.remove('hidden');
  refs.connectionBadge.textContent = 'Not in a room';
  clearSearchResults();
  refs.chatList.replaceChildren();
  refs.chatCount.textContent = '0';
  refs.qrPanel.classList.add('hidden');
  refs.showQrButton.textContent = 'Show QR';
  if (wasHost) localStorage.removeItem('jukebox.static.hostRoom');
  history.replaceState({}, '', basePageUrl());
}

refs.createRoomButton.addEventListener('click', () => {
  createStaticRoom().catch((error) => showToast(error.message));
});

refs.joinRoomButton.addEventListener('click', async () => {
  const code = refs.roomCodeInput.value.trim().toUpperCase();
  const nickname = refs.nicknameInput.value.trim();
  const pin = refs.roomPinJoinInput.value.trim();
  if (!code || !nickname) return showToast('Enter a room code and nickname.');
  refs.joinRoomButton.disabled = true;
  refs.joinMessage.textContent = 'Connecting directly to the host browser…';
  try {
    state.roomCode = code;
    state.nickname = nickname;
    state.joinPin = pin;
    await connectGuest(code, nickname, pin);
    refs.joinMessage.textContent = '';
  } catch (error) {
    refs.joinMessage.textContent = error.message;
    showToast(error.message);
    clearTimeout(state.guestReconnectTimer);
    state.guestReconnectTimer = null;
    try { state.peer?.destroy(); } catch {}
    state.peer = null;
    state.hostConnection = null;
    state.roomCode = '';
  } finally {
    refs.joinRoomButton.disabled = false;
  }
});

refs.openJukeboxViewButton.addEventListener('click', () => {
  state.viewMode = 'jukebox';
  renderJukeboxView();
  applyViewMode();
});
refs.closeJukeboxViewButton.addEventListener('click', () => {
  state.viewMode = 'room';
  applyViewMode();
});

refs.searchForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const q = refs.searchInput.value.trim();
  if (q.length < 2) return showToast('Enter at least two characters.');
  refs.searchMessage.textContent = state.isHost ? 'Searching Spotify…' : 'Asking the host to search Spotify…';
  refs.searchResults.replaceChildren();
  try {
    const tracks = await performSearch(q);
    renderSearchResults(tracks);
    refs.searchMessage.textContent = tracks.length ? `${tracks.length} result${tracks.length === 1 ? '' : 's'}` : 'No results found.';
  } catch (error) {
    refs.searchMessage.textContent = error.message;
  }
});

refs.clearSearchButton.addEventListener('click', () => clearSearchResults());
refs.searchInput.addEventListener('input', () => {
  if (!refs.searchInput.value.trim()) clearSearchResults({ clearInput: false });
});

function wireChatForm(form, input) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = input.value;
    if (!cleanChatText(text)) return;
    const submit = form.querySelector?.('button[type="submit"]');
    if (submit) submit.disabled = true;
    try {
      await sendChatMessage(text);
      input.value = '';
    } catch (error) {
      showToast(error.message);
    } finally {
      if (submit) submit.disabled = false;
    }
  });
}
wireChatForm(refs.chatForm, refs.chatInput);
wireChatForm(refs.jukeboxChatForm, refs.jukeboxChatInput);

for (const button of refs.reactionButtons) {
  button.addEventListener('click', async () => {
    const emoji = button.dataset.reaction || '';
    button.disabled = true;
    try {
      await sendRoomReaction(emoji);
    } catch (error) {
      showToast(error.message);
    } finally {
      setTimeout(() => { button.disabled = false; }, REACTION_RATE_LIMIT_MS);
    }
  });
}

refs.copyRoomButton.addEventListener('click', async () => {
  const url = inviteUrl();
  try {
    await navigator.clipboard.writeText(url);
    showToast('Invite link copied');
  } catch {
    showToast(url);
  }
});

refs.showQrButton.addEventListener('click', () => {
  const isHidden = refs.qrPanel.classList.contains('hidden');
  if (!isHidden) {
    refs.qrPanel.classList.add('hidden');
    refs.showQrButton.textContent = 'Show QR';
    return;
  }
  const qrBase = config.qrEndpoint || 'https://quickchart.io/qr';
  const qr = new URL(qrBase);
  qr.searchParams.set('text', inviteUrl());
  qr.searchParams.set('size', '280');
  refs.roomQrImage.src = qr.toString();
  refs.qrMessage.textContent = 'The QR contains the invite link only. Share the PIN separately.';
  refs.qrPanel.classList.remove('hidden');
  refs.showQrButton.textContent = 'Hide QR';
});

refs.roomQrImage.addEventListener('error', () => {
  refs.qrMessage.textContent = 'Could not load the QR image. Use Copy invite instead.';
});
refs.syncRoomButton.addEventListener('click', () => forceRoomSync().catch((error) => showToast(error.message)));
refs.leaveRoomButton.addEventListener('click', leaveRoom);
refs.connectSpotifyButton.addEventListener('click', () => beginSpotifyLogin().catch((error) => showToast(error.message)));
refs.refreshDevicesButton.addEventListener('click', loadDevices);
refs.deviceSelect.addEventListener('change', async () => {
  const option = refs.deviceSelect.selectedOptions[0];
  try {
    await selectPlaybackDevice(refs.deviceSelect.value, option?.dataset.name || '', false);
    showToast(refs.deviceSelect.value ? 'Playback device selected' : 'Using active Spotify device');
  } catch (error) {
    showToast(error.message);
  }
});
refs.browserPlayerButton.addEventListener('click', initBrowserPlayer);
refs.activateBrowserAudioButton.addEventListener('click', async () => {
  if (!state.browserPlayer) return;
  try {
    if (typeof state.browserPlayer.activateElement === 'function') await state.browserPlayer.activateElement();
    if (state.browserDeviceId) await selectPlaybackDevice(state.browserDeviceId, 'Game Night Jukebox Browser');
    refs.browserPlayerStatus.textContent = 'Browser audio activated.';
    showToast('Browser audio activated');
  } catch (error) {
    showToast(error.message);
  }
});
refs.guestStartButton.addEventListener('click', () => guestStartPlayback().catch((error) => showToast(error.message)));
refs.playNextButton.addEventListener('click', () => hostPlayerAction('next'));
refs.pauseResumeButton.addEventListener('click', () => {
  const playing = state.room?.nowPlaying;
  if (playing?.isPlaying) return hostPlayerAction('pause');
  if (!playing || playbackEffectivelyEnded(playing)) return hostPlayerAction('start');
  return hostPlayerAction('resume');
});
refs.syncPlaybackButton.addEventListener('click', () => hostPlayerAction('sync'));
refs.autoPlayInput.addEventListener('change', () => hostPlayerAction('settings', { autoPlay: refs.autoPlayInput.checked }));
refs.requesterToastsInput.addEventListener('change', () => hostPlayerAction('settings', { requesterToastsEnabled: refs.requesterToastsInput.checked }));
refs.hostRequestModeInput.addEventListener('change', () => hostPlayerAction('settings', { requestMode: refs.hostRequestModeInput.value }));
refs.hostQueueModeInput.addEventListener('change', () => hostPlayerAction('settings', { queueMode: refs.hostQueueModeInput.value }));
refs.hostCooldownInput.addEventListener('change', () => {
  const value = cleanCooldown(refs.hostCooldownInput.value);
  refs.hostCooldownInput.value = String(value);
  hostPlayerAction('settings', { requestCooldownSeconds: value });
});

async function bootstrap() {
  const localHost = ['localhost', '127.0.0.1', '::1'].includes(location.hostname);
  if (location.protocol !== 'https:' && !localHost) {
    refs.joinMessage.textContent = 'Use the HTTPS version of this site for Spotify login and browser playback.';
  }
  const params = new URLSearchParams(location.search);
  let spotifyRoomCode = '';
  if (params.get('code')) {
    try {
      spotifyRoomCode = await completeSpotifyCallback(params);
      showToast('Spotify connected');
    } catch (error) {
      showToast(error.message);
      history.replaceState({}, '', basePageUrl());
    }
  } else if (params.get('error')) {
    showToast(`Spotify authorization was not completed: ${params.get('error')}`);
    history.replaceState({}, '', basePageUrl());
  }

  const requestedCode = String(spotifyRoomCode || new URLSearchParams(location.search).get('room') || '').trim().toUpperCase();
  if (requestedCode) refs.roomCodeInput.value = requestedCode;

  const persisted = requestedCode ? loadPersistedHostRoom(requestedCode) : null;
  if (persisted && (!requestedCode || persisted.code === requestedCode)) {
    try {
      await restoreHostRoom(persisted);
      return;
    } catch (error) {
      refs.joinMessage.textContent = `Saved host room could not be restored: ${error.message}`;
    }
  }

  if (requestedCode) {
    const savedPin = sessionStorage.getItem(`jukebox.static.pin.${requestedCode}`) || '';
    refs.roomPinJoinInput.value = savedPin;
    refs.joinMessage.textContent = 'Enter your nickname and PIN if the host enabled one.';
  }

  if (MOCK_MODE) {
    refs.joinMessage.textContent ||= 'This static build is in mock Spotify mode until a Spotify Client ID is configured.';
  }
}

state.progressTimer = setInterval(updateProgress, 500);
window.addEventListener('beforeunload', () => {
  clearTimeout(state.guestReconnectTimer);
  clearPlaybackTimer();
  clearInterval(state.progressTimer);
  try { state.browserPlayer?.disconnect(); } catch {}
  try { state.hostConnection?.close(); } catch {}
  try { state.peer?.destroy(); } catch {}
});

bootstrap();
