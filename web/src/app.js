/**
 * HomeSync browser client: wiring between the control socket, the player and
 * the DOM.
 */

import { Connection } from './net.js';
import { Player, LatencyMode, positionAtServerNs, EQ_BANDS, EQ_LIMIT_DB, clampDb } from './player.js';
import { usingFallbackDigest } from './sha256.js';
import { LiveReceiver } from './live.js';
import { YoutubePlayer, parseVideoId } from './youtube.js';
import { CalibrationMicrophone, ChirpEmitter } from './calibration.js';

const $ = (id) => document.getElementById(id);

/** UI refresh rate. Fast enough to look live, slow enough to stay cheap. */
const UI_INTERVAL_MS = 250;

const state = {
  /** @type {Connection|null} */ connection: null,
  /** @type {Player|null} */ player: null,
  /** @type {LiveReceiver|null} */ live: null,
  /** @type {YoutubePlayer|null} */ youtube: null,
  /** @type {CalibrationMicrophone|null} */ microphone: null,
  /** @type {ChirpEmitter|null} */ chirps: null,
  /** @type {object|null} */ snapshot: null,
  /** @type {object|null} */ transport: null,
  /** @type {object|null} */ selectedItem: null,
  /** Media id currently being decoded ahead of time, if any. */
  preloading: null,
  /** Live stream epoch currently being rendered. */
  streamEpoch: -1,
  /** Whether compensation has been reconciled with the coordinator yet. */
  offsetReconciled: false,
  role: 'speaker',
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

  // Pasting a new invite link while the page is already open changes only the
  // fragment, which is not a reload. Without this the new room is ignored and
  // nothing appears to happen.
  window.addEventListener('hashchange', () => {
    const next = readInvite();
    if (!next.room || state.connection) return;
    $('room-code').value = next.room;
    $('room-secret').value = next.secret;
    log('Invite link picked up. Press "Enable audio & join".');
  });

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
  state.role = role;

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
    player.setEqGainsDb(savedEq());
    state.live = new LiveReceiver(player.ctx, player.gain, connection.clock);
    state.chirps = new ChirpEmitter(player);
  }
  state.youtube = new YoutubePlayer($('youtube-player'), connection.clock);
  state.youtube.onLog = log;
  // A video YouTube refuses to embed fails on every device at once, so it is
  // shown as a visible problem rather than a line in a scrolling log.
  state.youtube.onUnplayable = (message) => {
    const element = $('youtube-problem');
    element.textContent = `${message} (Most music videos are restricted this way.)`;
    element.classList.remove('hidden');
  };
  if (CalibrationMicrophone.available()) {
    state.microphone = new CalibrationMicrophone(connection.clock);
    state.microphone.onLog = log;
  } else {
    log('No microphone API here, so this device cannot be the calibration microphone.');
  }

  connection.onStatus = (status) => {
    // A reconnect re-joins the room, so compensation must be reconciled again.
    if (status === 'connecting' || status === 'reconnecting') state.offsetReconciled = false;
    setPill($('status'), status, status === 'connected' ? 'ok' : 'idle');
  };
  connection.onWelcome = () => log('Connected to the coordinator.');
  connection.onError = (error) => log(`Coordinator: ${error.message}`);
  connection.onJoinRejected = onJoinRejected;
  connection.onSnapshot = onSnapshot;
  connection.onTransport = onTransport;
  connection.diagnosticsProvider = () => (player.ctx ? player.diagnostics(state.transport) : null);
  connection.bufferProvider = () => state.live?.bufferReport() ?? null;
  connection.youtubeProvider = () =>
    state.transport?.mode === 'youtube' && state.youtube?.player ? state.youtube.state() : null;
  connection.onAudioFrame = (buffer) => state.live?.acceptFrame(buffer);
  connection.onStreamInfo = onStreamInfo;
  connection.onYoutubeRendezvous = (message) => state.youtube?.rendezvous(message).catch((e) => log(e.message));
  connection.onCalibration = onCalibration;
  connection.send('client_update', { microphone_available: CalibrationMicrophone.available() });
  connection.connect();

  $('join-panel').classList.add('hidden');
  $('room-panel').classList.remove('hidden');
  // A controller has no audio output, so nothing on it is worth compensating.
  $('device-panel').classList.toggle('hidden', role === 'controller');
}

// ---------------------------------------------------------------------------
// Server events
// ---------------------------------------------------------------------------

/**
 * The room refused us. Almost always because the coordinator was restarted
 * with a fresh room, leaving this browser holding an invite that no longer
 * exists — and because credentials live in per-browser storage, one browser can
 * work while another does not.
 *
 * The saved values are cleared so the next attempt starts from whatever the
 * user supplies rather than silently reusing what just failed.
 */
function onJoinRejected(error) {
  const explanation = {
    no_such_room: 'That room no longer exists. The coordinator was probably restarted with a new room.',
    bad_secret: 'That room secret is not accepted. It changes if the coordinator is started with a new room.',
    room_full: 'That room is full.',
    device_replaced:
      'This device opened HomeSync again in another tab or window, and that one has the room now. Two tabs on one machine would play the track twice out of the same speakers.',
  }[error.code] ?? error.message;

  // A replaced device still holds perfectly good credentials: it lost the seat,
  // not the right to the room. Clearing them would make the other tab's arrival
  // look like a bad invite and force a retype.
  if (error.code !== 'device_replaced') {
    localStorage.removeItem('homesync.roomCode');
    localStorage.removeItem('homesync.roomSecret');
  }

  state.connection = null;
  state.snapshot = null;
  state.transport = null;

  // Back to the join screen: nothing else on this page means anything now.
  $('join-panel').classList.remove('hidden');
  $('room-panel').classList.add('hidden');
  $('room-secret').value = '';
  setPill($('status'), 'not joined', 'idle');

  log(`Could not join: ${explanation}`);
  log('Open the invite link the coordinator is printing now, or scan its QR code.');
}

function onSnapshot(snapshot) {
  state.snapshot = snapshot;
  $('room-code-label').textContent = snapshot.room_code;
  renderMediaOptions(snapshot.media.items);
  renderQueue();
  renderMicrophoneOptions();
  void preloadNext();

  // The coordinator owns acoustic compensation, so it arrives here rather than
  // being decided locally.
  const me = snapshot.clients.find((c) => c.client_id === state.connection?.clientId);
  if (me && state.player) {
    state.player.setAcousticOffsetMs(me.acoustic_offset_ms || 0, state.transport);
    reconcileManualOffset(me);
    state.live?.setCompensationMs(totalCompensationMs());
  }

  onTransport(snapshot.transport);
  renderClients();
}

function onTransport(transport) {
  const previous = state.transport;
  state.transport = transport;
  setPill($('media-state'), transport.state, transport.state === 'playing' ? 'ok' : 'idle');
  showModeControls(transport.mode);

  const player = state.player;
  const modeChanged = previous?.mode !== transport.mode;

  // Leaving a mode must tear its machinery down, or a paused YouTube player
  // keeps buffering and a stale worklet keeps rendering underneath the new
  // source.
  if (modeChanged) {
    if (previous?.mode === 'youtube') state.youtube?.pause();
    if (previous?.mode === 'system_audio') {
      state.live?.stop();
      state.streamEpoch = -1;
    }
    if (previous?.mode === 'controlled_audio') player?.stopSource();
  }

  if (transport.mode === 'youtube') {
    if (modeChanged || previous?.youtube_video_id !== transport.youtube_video_id) {
      $('youtube-problem').classList.add('hidden');
    }
    if (transport.youtube_video_id) {
      state.youtube?.load(transport.youtube_video_id).catch((error) => log(error.message));
      $('youtube-stage').classList.remove('hidden');
    }
    if (transport.state !== 'playing') state.youtube?.pause();
    return;
  }
  $('youtube-stage').classList.add('hidden');

  if (transport.mode !== 'controlled_audio') return;
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

/** Builds (or rebuilds) the live playout worklet for a stream. */
async function onStreamInfo(info) {
  if (!state.live) return;
  if (info.epoch === state.streamEpoch && state.live.active) return;
  state.streamEpoch = info.epoch;
  try {
    await state.live.start(info, totalCompensationMs());
    log(
      `Live stream: ${info.source_description}, ${info.sample_rate} Hz ${info.channels}ch, ` +
        `${info.profile} profile (${info.target_depth_ms.toFixed(0)} ms buffer).`,
    );
  } catch (error) {
    log(`Could not start live playback: ${error.message}`);
  }
}

/** Handles the calibration messages addressed to this device. */
async function onCalibration(type, message) {
  try {
    switch (type) {
      case 'calibration_play': {
        if (!state.chirps) return;
        const result = await state.chirps.emit(message);
        if (result.late) log('A calibration chirp was scheduled late; that repetition may be discarded.');
        break;
      }
      case 'calibration_record': {
        if (!state.microphone) {
          // Returning quietly left the run waiting for a recording that was
          // never going to arrive, so it looked like nothing had happened.
          log(`Calibration: ${NO_MICROPHONE_HERE} Cancelling the run.`);
          setCalibrationStatus(NO_MICROPHONE_HERE);
          state.connection?.send('calibration_cancel');
          return;
        }
        const recording = await state.microphone.record(message.start_server_ns, message.duration_ms);
        await state.microphone.upload(message, recording);
        break;
      }
      case 'calibration_progress':
        renderCalibrationProgress(message);
        break;
      case 'calibration_result':
        renderCalibrationResult(message);
        break;
      default:
        break;
    }
  } catch (error) {
    log(`Calibration: ${error.message}`);
  }
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
  for (const radio of modeRadios()) {
    radio.addEventListener('change', () => selectMode(radio.value));
  }

  $('media-select').addEventListener('change', (event) => {
    const id = event.target.value;
    event.target.value = '';
    if (!id) return;
    sendQueue([...(state.snapshot?.queue ?? []), id]);
  });

  $('queue-clear').addEventListener('click', () => sendQueue([]));

  $('youtube-load').addEventListener('click', () => {
    const videoId = parseVideoId($('youtube-input').value);
    if (!videoId) {
      log('That does not look like a YouTube video id or link.');
      return;
    }
    state.connection?.send('select_source', { mode: 'youtube', youtube_video_id: videoId });
  });


  $('calibration-start').addEventListener('click', () => {
    const microphoneClientId = $('calibration-mic').value;
    if (!microphoneClientId) {
      log('Choose which device should listen first.');
      return;
    }
    if (microphoneClientId === state.connection?.clientId) {
      if (!state.microphone) {
        // Optional chaining here used to swallow the whole thing: with no
        // microphone the promise chain never ran and the button did nothing
        // at all, with no message anywhere.
        setCalibrationStatus(NO_MICROPHONE_HERE);
        log(NO_MICROPHONE_HERE);
        return;
      }
      setCalibrationStatus('asking for microphone permission…');
      state.microphone
        .enable()
        .then(() => startCalibration(microphoneClientId))
        .catch((error) => {
          setCalibrationStatus(`microphone unavailable — ${error.message}`);
          log(`Microphone: ${error.message}`);
        });
      return;
    }
    startCalibration(microphoneClientId);
  });
  $('calibration-cancel').addEventListener('click', () => state.connection?.send('calibration_cancel'));

  $('download-diagnostics').addEventListener('click', downloadDiagnostics);

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
    state.live?.setCompensationMs(totalCompensationMs());
    state.connection?.send('client_update', { manual_offset_ms: ms });
  };
  $('offset').addEventListener('input', (e) => applyOffset(e.target.value));
  $('offset-number').addEventListener('change', (e) => applyOffset(e.target.value));

  $('volume').addEventListener('input', (event) => {
    const volume = Number(event.target.value) / 100;
    state.player?.setVolume(volume);
    state.youtube?.setVolume(volume, $('mute').checked);
    state.connection?.send('client_update', { volume });
  });
  $('mute').addEventListener('change', (event) => {
    state.player?.setMuted(event.target.checked);
    state.youtube?.setVolume(Number($('volume').value) / 100, event.target.checked);
    state.connection?.send('client_update', { muted: event.target.checked });
  });

  buildEqualiser();
  $('eq-reset').addEventListener('click', () => applyEq(EQ_BANDS.map(() => 0)));

  $('invite-toggle').addEventListener('click', toggleInvite);
  $('invite-copy').addEventListener('click', copyInvite);

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

/**
 * Makes the coordinator's view of this device's manual compensation match what
 * the device is actually applying.
 *
 * Runs once per join, and matters in both directions. A browser whose storage
 * was cleared should pick up the value the coordinator remembered rather than
 * silently reverting to zero. And a browser that does have a saved value must
 * publish it, or the diagnostics table reports a compensation this device is
 * not applying — which is worse than reporting nothing.
 */
function reconcileManualOffset(me) {
  if (state.offsetReconciled) return;
  state.offsetReconciled = true;

  const saved = localStorage.getItem('homesync.offsetMs');
  const serverMs = me.manual_offset_ms || 0;

  if (saved === null && serverMs !== 0) {
    const ms = clampOffset(serverMs);
    $('offset').value = String(ms);
    $('offset-number').value = String(ms);
    localStorage.setItem('homesync.offsetMs', String(ms));
    state.player?.setManualOffsetMs(ms, state.transport);
    log(`Restored ${ms} ms of saved compensation for this device.`);
    return;
  }

  const localMs = clampOffset(Number(saved ?? 0));
  if (localMs !== serverMs) {
    state.connection?.send('client_update', { manual_offset_ms: localMs });
  }
}

/**
 * Saves a full diagnostics snapshot.
 *
 * The room secret gates it, because the report carries device names and
 * telemetry for everyone present.
 */
async function downloadDiagnostics() {
  const secret = state.connection?.secret;
  if (!secret) {
    log('Join a room before downloading diagnostics.');
    return;
  }
  try {
    const response = await fetch(`/api/v1/diagnostics?secret=${encodeURIComponent(secret)}`);
    if (!response.ok) throw new Error(`the coordinator returned HTTP ${response.status}`);
    const text = await response.text();

    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    link.download = `homesync-diagnostics-${stamp}.json`;
    link.click();
    URL.revokeObjectURL(url);
    log('Diagnostics saved.');
  } catch (error) {
    log(`Could not download diagnostics: ${error.message}`);
  }
}

/**
 * Why this device cannot listen. Almost always the secure-context rule:
 * `getUserMedia` does not exist on `http://192.168.x.x`, so the API is simply
 * absent rather than refused, and the reason has to be supplied here.
 */
const NO_MICROPHONE_HERE = window.isSecureContext
  ? 'This browser exposes no microphone API, so this device cannot listen.'
  : 'Microphone access needs a secure context. Restart the coordinator with --tls and reopen this page over https.';

/** Shows one line of calibration state where the button is. */
function setCalibrationStatus(text) {
  $('calibration-status').textContent = text;
}

/** Equaliser gains this device last used. */
function savedEq() {
  try {
    const stored = JSON.parse(localStorage.getItem('homesync.eqDb') ?? '[]');
    return EQ_BANDS.map((_, index) => clampDb(Array.isArray(stored) ? stored[index] : 0));
  } catch {
    return EQ_BANDS.map(() => 0);
  }
}

/** Draws one slider per band and wires it to the player. */
function buildEqualiser() {
  const host = $('eq');
  const gains = savedEq();
  host.replaceChildren();

  for (const [index, band] of EQ_BANDS.entries()) {
    const cell = document.createElement('div');
    cell.className = 'eq-band';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = String(-EQ_LIMIT_DB);
    slider.max = String(EQ_LIMIT_DB);
    slider.step = '0.5';
    slider.value = String(gains[index]);
    slider.dataset.band = String(index);
    slider.setAttribute('aria-label', `${band.hz} Hz`);
    slider.addEventListener('input', () => applyEq(readEqSliders()));

    const hz = document.createElement('span');
    hz.className = 'eq-hz';
    hz.textContent = band.label;

    const db = document.createElement('span');
    db.className = 'eq-db';

    cell.append(slider, hz, db);
    host.append(cell);
  }
  applyEq(gains);
}

function readEqSliders() {
  return [...$('eq').querySelectorAll('input[type="range"]')].map((input) => clampDb(input.value));
}

/** Applies gains to the player, the sliders and storage together. */
function applyEq(gainsDb) {
  const gains = EQ_BANDS.map((_, index) => clampDb(gainsDb[index]));
  const cells = [...$('eq').children];
  for (const [index, cell] of cells.entries()) {
    const slider = cell.querySelector('input');
    const readout = cell.querySelector('.eq-db');
    if (slider && slider.value !== String(gains[index])) slider.value = String(gains[index]);
    if (readout) readout.textContent = gains[index] === 0 ? '0' : `${gains[index] > 0 ? '+' : ''}${gains[index]}`;
  }
  state.player?.setEqGainsDb(gains);
  localStorage.setItem('homesync.eqDb', JSON.stringify(gains));
}

/** Publishes a queue to the room. An empty list clears the source. */
function sendQueue(mediaIds) {
  state.connection?.send('select_source', {
    mode: 'controlled_audio',
    queue: mediaIds,
    media_id: mediaIds[0] ?? null,
  });
}

/**
 * Decodes the next queued track while the current one plays.
 *
 * Reported ready as soon as it is decoded, which is what lets the coordinator
 * advance with the ordinary scheduling lead instead of waiting for a download.
 */
async function preloadNext() {
  const snapshot = state.snapshot;
  const player = state.player;
  if (!snapshot || !player?.ctx || state.transport?.mode !== 'controlled_audio') return;

  const nextId = snapshot.queue?.[(snapshot.queue_index ?? 0) + 1];
  if (!nextId || player.nextMediaId === nextId || state.preloading === nextId) return;
  const item = snapshot.media.items.find((m) => m.id === nextId);
  if (!item) return;

  state.preloading = nextId;
  try {
    await player.preload(item);
    state.connection?.send('receiver_ready', {
      media_id: item.id,
      hash_verified: true,
      duration_ns: Math.round(player.nextBuffer.duration * 1e9),
      sample_rate: Math.round(player.ctx.sampleRate),
      audio_context_state: player.ctx.state,
      output_latency_ms: player.reportedLatencyMs,
    });
    log(`${item.title}: preloaded, ready to follow on.`);
  } catch (error) {
    log(`${item.title}: could not preload — ${error.message}`);
  } finally {
    if (state.preloading === nextId) state.preloading = null;
  }
}

/** The invitation this device would hand to another. */
function inviteUrl() {
  const code = state.snapshot?.room_code ?? $('room-code').value.trim().toUpperCase();
  const secret = $('room-secret').value.trim() || localStorage.getItem('homesync.roomSecret') || '';
  return `${location.origin}/#room=${encodeURIComponent(code)}&secret=${encodeURIComponent(secret)}`;
}

/** Shows or hides the invitation, fetching the QR the first time it is opened. */
function toggleInvite() {
  const panel = $('invite');
  const showing = panel.classList.toggle('hidden');
  $('invite-toggle').textContent = showing ? 'Invite a device' : 'Hide invite';
  if (showing) return;

  $('invite-link').value = inviteUrl();
  const secret = $('room-secret').value.trim() || localStorage.getItem('homesync.roomSecret') || '';
  const query = new URLSearchParams({ secret, origin: location.origin });
  // Fetched rather than set as a src so a refusal can be explained. The common
  // one is this page being open on localhost, which scans fine and then reaches
  // nothing.
  fetch(`/api/v1/invite.svg?${query}`)
    .then(async (response) => {
      if (!response.ok) throw new Error((await response.text()) || `HTTP ${response.status}`);
      return response.blob();
    })
    .then((blob) => {
      $('invite-qr').src = URL.createObjectURL(blob);
      $('invite-qr').hidden = false;
    })
    .catch((error) => {
      $('invite-qr').hidden = true;
      $('invite-note').textContent = `No QR code: ${error.message}`;
    });
}

/**
 * Copies the invitation.
 *
 * `navigator.clipboard` is another secure-context API, so on the plain-HTTP LAN
 * address it does not exist. The selection fallback is the one that actually
 * runs in normal use; leaving the link selected is the last resort, because a
 * user who can see it selected can always press the shortcut themselves.
 */
async function copyInvite() {
  const url = inviteUrl();
  const field = $('invite-link');
  field.value = url;
  field.select();
  field.setSelectionRange(0, url.length);

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(url);
    } else if (!document.execCommand('copy')) {
      throw new Error('this browser would not copy it');
    }
    flashCopied('Copied');
  } catch {
    flashCopied('Press ⌘/Ctrl+C');
  }
}

function flashCopied(text) {
  const button = $('invite-copy');
  button.textContent = text;
  setTimeout(() => {
    button.textContent = 'Copy';
  }, 1800);
}

/** Starts a calibration run with the chosen microphone device. */
function startCalibration(microphoneClientId) {
  $('calibration-results').classList.add('hidden');
  setCalibrationStatus('starting…');
  state.connection?.send('calibration_start', {
    microphone_client_id: microphoneClientId,
    repetitions: Number($('calibration-reps').value) || 5,
  });
}

/** Total compensation this device applies, in milliseconds. */
function totalCompensationMs() {
  const player = state.player;
  if (!player) return 0;
  return player.compensationSeconds() * 1000;
}

/** Shows the controls belonging to one source mode. */
function showModeControls(mode) {
  for (const radio of modeRadios()) {
    if (radio.value === mode) radio.checked = true;
  }
  // A room with nothing selected reports `idle`, which is not a mode anyone can
  // pick. Falling back to the chosen segment means the picker for that source is
  // on screen — otherwise a fresh room shows two tabs and no way to use either.
  const shown = mode === 'controlled_audio' || mode === 'youtube' ? mode : checkedMode();
  $('mode-controlled').classList.toggle('hidden', shown !== 'controlled_audio');
  $('mode-youtube').classList.toggle('hidden', shown !== 'youtube');
  // A live stream has no timeline to scrub: it is whatever the host is playing.
  // The client can still receive one, but this build offers no way to start it.
  const timeline = mode !== 'system_audio';
  $('seek').disabled = !timeline;
  $('play').disabled = !timeline;
  $('pause').disabled = !timeline;
}

/** The source-mode radio group. */
function modeRadios() {
  return document.querySelectorAll('input[name="mode"]');
}

/** Which source segment the user currently has selected. */
function checkedMode() {
  return document.querySelector('input[name="mode"]:checked')?.value ?? 'controlled_audio';
}

/** Switches source, telling the room only when there is something to play. */
function selectMode(mode) {
  showModeControls(mode);
  if (mode === 'controlled_audio') {
    const mediaId = $('media-select').value || null;
    if (mediaId) state.connection?.send('select_source', { mode, media_id: mediaId });
  } else if (mode === 'youtube') {
    const videoId = parseVideoId($('youtube-input').value);
    if (videoId) state.connection?.send('select_source', { mode, youtube_video_id: videoId });
  }
}

function clampOffset(ms) {
  if (!Number.isFinite(ms)) return 0;
  return Math.max(-1000, Math.min(1000, Math.round(ms)));
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** Keeps the microphone picker in step with the room. */
function renderMicrophoneOptions() {
  const select = $('calibration-mic');
  const snapshot = state.snapshot;
  if (!snapshot) return;
  const candidates = snapshot.clients.filter((c) => c.microphone_available || c.client_id === state.connection?.clientId);
  const signature = candidates.map((c) => `${c.client_id}:${c.name}`).join(',');
  if (select.dataset.signature === signature) return;

  const previous = select.value;
  select.innerHTML = '';
  if (candidates.length === 0) {
    const none = document.createElement('option');
    none.value = '';
    none.textContent = 'No device reported a microphone';
    select.append(none);
  }
  for (const client of candidates) {
    const option = document.createElement('option');
    option.value = client.client_id;
    const isSelf = client.client_id === state.connection?.clientId;
    // Say which devices cannot actually listen, rather than offering them as
    // if they could and failing once the run is under way.
    const suffix = client.microphone_available ? '' : ' — no microphone';
    option.textContent = `${client.name}${isSelf ? ' (this device)' : ''}${suffix}`;
    select.append(option);
  }
  select.dataset.signature = signature;
  if (previous && candidates.some((c) => c.client_id === previous)) select.value = previous;
}

function renderCalibrationProgress(message) {
  const status = $('calibration-status');
  if (message.stage === 'done' || message.stage === 'cancelled') {
    status.textContent = message.detail || message.stage;
    return;
  }
  const progress = message.total ? ` (${message.completed}/${message.total})` : '';
  status.textContent = `${message.stage}${progress} — ${message.detail}`;
}

function renderCalibrationResult(result) {
  $('calibration-status').textContent = result.detail;
  const table = $('calibration-results');
  const tbody = table.querySelector('tbody');
  tbody.innerHTML = '';

  for (const measurement of result.measurements) {
    const notes = [];
    if (!measurement.stable) notes.push('unstable latency');
    if (measurement.reflective_room) notes.push('reflective room');
    if (measurement.rejected) notes.push(`${measurement.rejected} rejected`);

    const row = document.createElement('tr');
    const cells = [
      measurement.name,
      fmt(measurement.measured_delay_ms, 'ms', 1),
      `± ${fmt(measurement.deviation_ms, 'ms', 1)}`,
      fmt(measurement.intrinsic_latency_ms, 'ms', 1),
      fmt(measurement.applied_compensation_ms, 'ms', 1),
      notes.join(', ') || '—',
    ];
    for (const [index, value] of cells.entries()) {
      const cell = document.createElement('td');
      cell.textContent = value;
      if (index > 0 && index < 5) cell.classList.add('mono');
      row.append(cell);
    }
    tbody.append(row);
  }
  table.classList.toggle('hidden', result.measurements.length === 0);

  if (result.applied) {
    log('Calibration finished; compensation applied. Listen again and adjust manually if needed.');
  }
}

function renderMediaOptions(items) {
  const select = $('media-select');
  const signature = items.map((i) => i.id).join(',');
  if (select.dataset.signature !== signature) {
    select.innerHTML = '';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = 'Add a track…';
    select.append(none);
    for (const item of items) {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.title;
      select.append(option);
    }
    select.dataset.signature = signature;
  }
  // Always parked on the placeholder: this control adds to the queue, so
  // leaving it showing a title would suggest it reflects what is playing.
  select.value = '';
  state.selectedItem = items.find((i) => i.id === state.transport?.media_id) ?? null;
}

/** Draws the queue, marking the track the room is on. */
function renderQueue() {
  const list = $('queue');
  const snapshot = state.snapshot;
  const queue = snapshot?.queue ?? [];
  const index = snapshot?.queue_index ?? 0;
  list.replaceChildren();

  for (const [position, id] of queue.entries()) {
    const item = snapshot.media.items.find((m) => m.id === id);
    const row = document.createElement('li');
    if (position === index) row.classList.add('current');

    const number = document.createElement('span');
    number.className = 'queue-index';
    number.textContent = String(position + 1);

    const title = document.createElement('span');
    title.className = 'queue-title';
    title.textContent = item?.title ?? id;

    const drop = document.createElement('button');
    drop.className = 'btn btn-sm queue-drop';
    drop.textContent = '✕';
    drop.title = `Remove ${item?.title ?? id}`;
    drop.addEventListener('click', () => sendQueue(queue.filter((_, i) => i !== position)));

    row.append(number, title, drop);
    list.append(row);
  }
}

/**
 * One card per device: the three numbers that decide whether the room is
 * actually in sync, and nothing else.
 *
 * The wide table this replaces showed twelve columns, most of which only meant
 * something if you already knew what to look for. Everything it had is still in
 * the diagnostics export, which is the right place for it.
 */
function renderClients() {
  const host = $('devices');
  const snapshot = state.snapshot;
  if (!snapshot) return;

  renderHealth(snapshot.health);

  host.replaceChildren();
  for (const client of snapshot.clients) {
    const clock = client.clock ?? {};
    const diagnostics = client.diagnostics ?? {};
    const isSelf = client.client_id === state.connection?.clientId;

    const card = document.createElement('div');
    card.className = isSelf ? 'device device-self' : 'device';

    const top = document.createElement('div');
    top.className = 'device-top';

    const dot = document.createElement('span');
    dot.className = `dot ${clockDotClass(clock.quality)}`;
    dot.title = `clock: ${clock.quality ?? 'unknown'}`;

    const name = document.createElement('span');
    name.className = 'device-name';
    name.textContent = client.name + (client.client_id === snapshot.owner_client_id ? ' ★' : '');

    const role = document.createElement('span');
    role.className = isSelf ? 'device-role' : 'device-role device-role-role';
    role.textContent = isSelf ? 'this device' : client.role;

    top.append(dot, name, role);

    const stats = document.createElement('div');
    stats.className = 'device-stats';
    const drift = client.role === 'controller' ? '—' : fmt(diagnostics.drift_ms, 'ms', 1);
    const compensation = (client.manual_offset_ms || 0) + (client.acoustic_offset_ms || 0);
    for (const [label, value] of [
      ['Clock', fmt(clock.offset_uncertainty_ms, 'ms', 1)],
      ['Drift', drift],
      ['Comp', compensation ? `${Math.round(compensation)} ms` : '—'],
    ]) {
      const stat = document.createElement('div');
      stat.className = 'stat';
      const key = document.createElement('span');
      key.className = 'stat-label';
      key.textContent = label;
      const val = document.createElement('span');
      val.className = 'stat-value';
      val.textContent = value;
      stat.append(key, val);
      stats.append(stat);
    }

    card.append(top, stats);
    host.append(card);
  }
}

/**
 * Shows the coordinator's own reading of the room.
 *
 * Rendered rather than recomputed: the coordinator sees every device's
 * telemetry and the diagnostics export carries the same text, so a screenshot
 * and a JSON file can never disagree about what was wrong.
 */
function renderHealth(health) {
  const chip = $('health');
  const detail = $('health-detail');
  if (!health) return;

  const kind = { ok: 'ok', warn: 'warn', bad: 'bad' }[health.level] ?? 'idle';
  setPill(chip, health.summary || '—', kind);

  // The summary names only the worst thing. Everything else goes underneath,
  // so a room with three problems does not hide two of them.
  const rest = (health.findings ?? []).slice(1);
  detail.textContent = rest.join(' · ');
  detail.classList.toggle('hidden', rest.length === 0);
}

/** Traffic light for a device's clock agreement. */
function clockDotClass(quality) {
  if (quality === 'stable') return 'dot-ok';
  if (quality === 'degraded') return 'dot-warn';
  if (quality === 'resync_required') return 'dot-bad';
  return '';
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
  element.className = `chip${kind === 'idle' ? '' : ` chip-${kind}`}`;
}

function log(message) {
  const element = $('log');
  const stamp = new Date().toLocaleTimeString();
  element.textContent = `${stamp}  ${message}\n${element.textContent}`.slice(0, 8000);
}

init();
