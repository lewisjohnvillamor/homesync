/**
 * HomeSync browser client: wiring between the control socket, the player and
 * the DOM.
 */

import { Connection } from './net.js';
import { Player, LatencyMode, positionAtServerNs } from './player.js';
import { usingFallbackDigest } from './sha256.js';

const $ = (id) => document.getElementById(id);

/** UI refresh rate. Fast enough to look live, slow enough to stay cheap. */
const UI_INTERVAL_MS = 250;

const state = {
  /** @type {Connection|null} */ connection: null,
  /** @type {Player|null} */ player: null,
  /** @type {object|null} */ snapshot: null,
  /** @type {object|null} */ transport: null,
  /** @type {object|null} */ selectedItem: null,
  seeking: false,
  loadToken: 0,
};

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

function readInvite() {
  // The secret lives in the fragment, which browsers never send to the server.
  const params = new URLSearchParams(location.hash.replace(/^#/, ''));
  return { room: params.get('room') ?? '', secret: params.get('secret') ?? '' };
}

function init() {
  const invite = readInvite();
  $('room-code').value = invite.room || localStorage.getItem('homesync.roomCode') || '';
  $('room-secret').value = invite.secret || localStorage.getItem('homesync.roomSecret') || '';
  $('device-name').value = localStorage.getItem('homesync.name') || defaultDeviceName();
  $('device-role').value = localStorage.getItem('homesync.role') || 'speaker';

  const savedOffset = Number(localStorage.getItem('homesync.offsetMs') || '0');
  $('offset').value = String(clampOffset(savedOffset));
  $('offset-number').value = String(clampOffset(savedOffset));

  $('join').addEventListener('click', join);
  wireControls();

  if (usingFallbackDigest()) {
    log('Page is not a secure context: media hashes are verified in JavaScript (slower).');
  }
  setInterval(refreshUi, UI_INTERVAL_MS);
}

function defaultDeviceName() {
  const ua = navigator.userAgent;
  if (/android/i.test(ua)) return 'Android phone';
  if (/iphone|ipad/i.test(ua)) return 'iOS device';
  if (/mac os/i.test(ua)) return 'Mac';
  if (/windows/i.test(ua)) return 'Windows PC';
  return 'Browser';
}

async function join() {
  const roomCode = $('room-code').value.trim().toUpperCase();
  const secret = $('room-secret').value.trim();
  const name = $('device-name').value.trim();
  const role = $('device-role').value;
  if (!roomCode || !secret) {
    log('Enter the room code and secret, or open the invite link from the coordinator.');
    return;
  }

  localStorage.setItem('homesync.roomCode', roomCode);
  localStorage.setItem('homesync.roomSecret', secret);
  localStorage.setItem('homesync.name', name);
  localStorage.setItem('homesync.role', role);

  const connection = new Connection({ roomCode, secret, name, role });
  const player = new Player(connection.clock);
  player.onLog = log;
  state.connection = connection;
  state.player = player;

  if (role !== 'controller') {
    try {
      // Inside the click handler, so the gesture still counts.
      const audioState = await player.unlock();
      log(`Audio context ${audioState} at ${Math.round(player.ctx.sampleRate)} Hz.`);
    } catch (error) {
      log(`Could not start audio: ${error.message}`);
      return;
    }
    player.setManualOffsetMs(Number($('offset').value));
  }

  connection.onStatus = (status) => setPill($('status'), status, status === 'connected' ? 'ok' : 'idle');
  connection.onWelcome = () => log('Connected to the coordinator.');
  connection.onError = (error) => log(`Coordinator: ${error.message}`);
  connection.onSnapshot = onSnapshot;
  connection.onTransport = onTransport;
  connection.diagnosticsProvider = () => (player.ctx ? player.diagnostics(state.transport) : null);
  connection.connect();

  $('join-panel').classList.add('hidden');
  for (const id of ['room-panel', 'device-panel', 'diagnostics-panel', 'log-panel']) {
    $(id).classList.remove('hidden');
  }
  if (role === 'controller') $('device-panel').classList.add('hidden');
}

// ---------------------------------------------------------------------------
// Server events
// ---------------------------------------------------------------------------

function onSnapshot(snapshot) {
  state.snapshot = snapshot;
  $('room-code-label').textContent = snapshot.room_code;
  renderMediaOptions(snapshot.media.items);
  onTransport(snapshot.transport);
  renderClients();
}

function onTransport(transport) {
  const previous = state.transport;
  state.transport = transport;
  setPill($('media-state'), transport.state, transport.state === 'playing' ? 'ok' : 'idle');

  const player = state.player;
  if (!player || !player.ctx) return;

  if (previous && previous.media_id !== transport.media_id) {
    player.clearMedia();
  }
  if (!transport.media_id) return;

  const item = (state.snapshot?.media.items ?? []).find((m) => m.id === transport.media_id);
  if (!item) return;

  if (player.bufferMediaId !== item.id) {
    loadMedia(item);
    return;
  }
  player.applyTransport(transport);
}

async function loadMedia(item) {
  const player = state.player;
  const token = ++state.loadToken;
  try {
    await player.load(item, (stage) => log(`${item.title}: ${stage}…`));
    // The controller may have changed source while this download was running.
    if (token !== state.loadToken) return;
    state.connection.send('receiver_ready', {
      media_id: item.id,
      hash_verified: true,
      duration_ns: Math.round(player.buffer.duration * 1e9),
      sample_rate: Math.round(player.ctx.sampleRate),
      audio_context_state: player.ctx.state,
      output_latency_ms: player.reportedLatencyMs,
    });
    log(`${item.title}: verified and decoded (${player.buffer.duration.toFixed(1)} s).`);
    if (state.transport) player.applyTransport(state.transport, { force: true });
  } catch (error) {
    if (token !== state.loadToken) return;
    log(`${item.title}: ${error.message}`);
  }
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

function wireControls() {
  $('media-select').addEventListener('change', (event) => {
    state.connection?.send('select_source', { media_id: event.target.value || null });
  });

  $('play').addEventListener('click', () => {
    state.connection?.send('play', { force: $('force').checked });
  });
  $('pause').addEventListener('click', () => state.connection?.send('pause'));
  $('stop').addEventListener('click', () => state.connection?.send('stop'));

  const seek = $('seek');
  seek.addEventListener('pointerdown', () => {
    state.seeking = true;
  });
  const commitSeek = () => {
    state.seeking = false;
    const duration = currentDurationNs();
    if (!duration) return;
    const position = (Number(seek.value) / 1000) * duration;
    state.connection?.send('seek', { position_ns: Math.round(position) });
  };
  seek.addEventListener('pointerup', commitSeek);
  seek.addEventListener('change', commitSeek);

  const applyOffset = (value) => {
    const ms = clampOffset(Number(value));
    $('offset').value = String(ms);
    $('offset-number').value = String(ms);
    localStorage.setItem('homesync.offsetMs', String(ms));
    state.player?.setManualOffsetMs(ms, state.transport);
    state.connection?.send('client_update', { manual_offset_ms: ms });
  };
  $('offset').addEventListener('input', (e) => applyOffset(e.target.value));
  $('offset-number').addEventListener('change', (e) => applyOffset(e.target.value));

  $('volume').addEventListener('input', (event) => {
    const volume = Number(event.target.value) / 100;
    state.player?.setVolume(volume);
    state.connection?.send('client_update', { volume });
  });
  $('mute').addEventListener('change', (event) => {
    state.player?.setMuted(event.target.checked);
    state.connection?.send('client_update', { muted: event.target.checked });
  });

  // Coming back from the background invalidates both the clock estimate and
  // any running schedule, so both are rebuilt rather than trusted.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const player = state.player;
    if (!player?.ctx) return;
    log('Page became visible again: re-measuring the clock and rescheduling.');
    state.connection?.clock.reset();
    player.ctx.resume().then(() => {
      if (state.transport) player.applyTransport(state.transport, { force: true });
    });
  });
}

function clampOffset(ms) {
  if (!Number.isFinite(ms)) return 0;
  return Math.max(-1000, Math.min(1000, Math.round(ms)));
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderMediaOptions(items) {
  const select = $('media-select');
  const wanted = state.transport?.media_id ?? '';
  const signature = items.map((i) => i.id).join(',');
  if (select.dataset.signature !== signature) {
    select.innerHTML = '';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = 'Select media…';
    select.append(none);
    for (const item of items) {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.title;
      select.append(option);
    }
    select.dataset.signature = signature;
  }
  if (select.value !== wanted) select.value = wanted;
  state.selectedItem = items.find((i) => i.id === wanted) ?? null;
}

function renderClients() {
  const tbody = document.querySelector('#clients tbody');
  const snapshot = state.snapshot;
  if (!snapshot) return;
  tbody.innerHTML = '';

  for (const client of snapshot.clients) {
    const row = document.createElement('tr');
    if (client.client_id === state.connection?.clientId) row.classList.add('self');
    const clock = client.clock ?? {};
    const diagnostics = client.diagnostics ?? {};
    const cells = [
      client.name + (client.client_id === snapshot.owner_client_id ? ' ★' : ''),
      client.role,
      clock.quality ?? '—',
      fmt(clock.offset_ns / 1e6, 'ms', 2),
      fmt(clock.rtt_median_ms, 'ms', 1),
      fmt(clock.offset_uncertainty_ms, 'ms', 2),
      fmt(clock.drift_ppm, '', 1),
      client.ready ? 'yes' : 'no',
      client.role === 'controller' ? '—' : fmt(diagnostics.drift_ms, 'ms', 2),
      fmt(client.manual_offset_ms, 'ms', 0),
    ];
    for (const [index, value] of cells.entries()) {
      const cell = document.createElement('td');
      cell.textContent = value;
      if (index >= 3) cell.classList.add('mono');
      row.append(cell);
    }
    tbody.append(row);
  }
}

function refreshUi() {
  const connection = state.connection;
  if (!connection) return;

  const quality = connection.clock.quality();
  setPill($('clock-quality'), `clock: ${quality}`, quality === 'stable' ? 'ok' : 'idle');
  renderClients();

  const duration = currentDurationNs();
  const position = state.transport ? positionAtServerNs(state.transport, connection.clock.serverNow()) : 0;
  const shown = Math.min(position, duration || position);
  $('position').textContent = `${formatTime(shown)} / ${formatTime(duration)}`;
  if (!state.seeking && duration > 0) {
    $('seek').value = String(Math.round((shown / duration) * 1000));
  }

  renderDeviceFacts();
}

function renderDeviceFacts() {
  const player = state.player;
  const list = $('device-facts');
  if (!player || !player.ctx) {
    list.innerHTML = '';
    return;
  }
  const latencyExplanation =
    player.latencyMode === LatencyMode.OutputTimestamp
      ? 'getOutputTimestamp() (output latency already included)'
      : 'reported baseLatency + outputLatency';

  const facts = [
    ['Sample rate', `${Math.round(player.ctx.sampleRate)} Hz`],
    ['Context state', player.ctx.state],
    ['Latency source', latencyExplanation],
    ['Reported output latency', fmt(player.reportedLatencyMs, 'ms', 1)],
    ['Total compensation applied', fmt(player.compensationSeconds() * 1000, 'ms', 1)],
    ['Start moved by (late join)', fmt(player.scheduleShiftMs, 'ms', 1)],
    ['Timeline drift', player.playing ? fmt(player.diagnostics(state.transport).drift_ms, 'ms', 2) : '—'],
  ];

  list.innerHTML = '';
  for (const [term, value] of facts) {
    const dt = document.createElement('dt');
    dt.textContent = term;
    const dd = document.createElement('dd');
    dd.textContent = value;
    dd.classList.add('mono');
    list.append(dt, dd);
  }
}

function currentDurationNs() {
  const player = state.player;
  if (player?.buffer && player.bufferMediaId === state.transport?.media_id) {
    return player.buffer.duration * 1e9;
  }
  const item = (state.snapshot?.media.items ?? []).find((m) => m.id === state.transport?.media_id);
  return item?.duration_ns ?? 0;
}

function fmt(value, unit, digits) {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value.toFixed(digits)}${unit ? ` ${unit}` : ''}`;
}

function formatTime(ns) {
  if (!Number.isFinite(ns) || ns <= 0) return '0:00';
  const total = Math.floor(ns / 1e9);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function setPill(element, text, kind) {
  element.textContent = text;
  element.className = `pill pill-${kind}`;
}

function log(message) {
  const element = $('log');
  const stamp = new Date().toLocaleTimeString();
  element.textContent = `${stamp}  ${message}\n${element.textContent}`.slice(0, 8000);
}

init();
