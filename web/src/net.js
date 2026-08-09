/**
 * Control-socket transport: connection lifecycle, the clock loop and
 * telemetry publishing.
 */

import { ClockEstimator, clientNow } from './clock.js';

const PROTOCOL_VERSION = 1;

/** Fast samples taken at join, then the steady cadence. */
const WARMUP_SAMPLES = 20;
const WARMUP_INTERVAL_MS = 120;
const STEADY_INTERVAL_MS = 1000;

/** How often the client republishes its clock estimate and telemetry. */
const REPORT_INTERVAL_MS = 2000;

/** Reconnect backoff bounds. */
const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 10000;

export class Connection {
  constructor({ roomCode, secret, name, role }) {
    this.roomCode = roomCode;
    this.secret = secret;
    this.name = name;
    this.role = role;

    this.clock = new ClockEstimator();
    /** @type {WebSocket|null} */
    this.socket = null;
    this.clientId = null;
    this.deviceId = localStorage.getItem('homesync.deviceId') || null;
    this.seq = 0;
    this.reconnectDelay = RECONNECT_MIN_MS;
    this.closedByUser = false;

    /** Callbacks, assigned by the app. */
    this.onStatus = () => {};
    this.onSnapshot = () => {};
    this.onTransport = () => {};
    this.onError = () => {};
    this.onWelcome = () => {};
    /** Returns the current telemetry payload, or null. */
    this.diagnosticsProvider = () => null;

    this.timers = [];
  }

  connect() {
    this.closedByUser = false;
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${scheme}://${location.host}/ws`);
    this.socket = socket;
    this.onStatus('connecting');

    socket.onopen = () => {
      this.reconnectDelay = RECONNECT_MIN_MS;
      this.onStatus('connected');
      this.send('hello', {
        client_version: 'homesync-web/0.1.0',
        user_agent: navigator.userAgent.slice(0, 200),
        device_id: this.deviceId ?? undefined,
      });
      this.send('join_room', {
        room_code: this.roomCode,
        secret: this.secret,
        name: this.name,
        role: this.role,
      });
      this.#startLoops();
    };

    socket.onmessage = (event) => {
      // Stamp arrival before parsing so the clock exchange measures the
      // network, not JSON parsing on a slow phone.
      const t3 = clientNow();
      let envelope;
      try {
        envelope = JSON.parse(event.data);
      } catch {
        return;
      }
      this.#handle(envelope, t3);
    };

    socket.onclose = () => {
      this.#stopLoops();
      if (this.closedByUser) {
        this.onStatus('closed');
        return;
      }
      this.onStatus('reconnecting');
      // The socket carried our room membership, so a reconnect means a fresh
      // join and a fresh clock estimate.
      this.clock.reset();
      setTimeout(() => this.connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
    };

    socket.onerror = () => {
      // 'close' always follows; reconnection is handled there.
    };
  }

  close() {
    this.closedByUser = true;
    this.#stopLoops();
    this.socket?.close();
  }

  /** Sends one control frame. Silently drops if the socket is not open. */
  send(type, payload) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    const frame = { v: PROTOCOL_VERSION, type };
    if (payload !== undefined) frame.payload = payload;
    this.socket.send(JSON.stringify(frame));
  }

  #handle(envelope, t3) {
    switch (envelope.type) {
      case 'clock_pong': {
        const { t0, t1, t2 } = envelope.payload;
        this.clock.push(t0, t1, t2, t3);
        break;
      }
      case 'welcome': {
        this.clientId = envelope.payload.client_id;
        this.deviceId = envelope.payload.device_id;
        localStorage.setItem('homesync.deviceId', this.deviceId);
        this.onWelcome(envelope.payload);
        break;
      }
      case 'room_snapshot':
        this.onSnapshot(envelope.payload);
        break;
      case 'transport':
        this.onTransport(envelope.payload);
        break;
      case 'error':
        this.onError(envelope.payload);
        break;
      default:
        break;
    }
  }

  #startLoops() {
    this.#stopLoops();
    this.seq = 0;
    let sent = 0;

    const ping = () => {
      this.send('clock_ping', { t0: clientNow(), seq: this.seq++ });
      sent += 1;
      if (sent === WARMUP_SAMPLES) {
        // Warm-up finished: drop to the steady cadence.
        this.#clearTimer(0);
        this.timers[0] = setInterval(ping, STEADY_INTERVAL_MS);
      }
    };
    this.timers[0] = setInterval(ping, WARMUP_INTERVAL_MS);
    ping();

    this.timers[1] = setInterval(() => {
      if (this.clock.haveEstimate) this.send('clock_report', this.clock.report());
      const diagnostics = this.diagnosticsProvider();
      if (diagnostics) this.send('diagnostic_report', diagnostics);
    }, REPORT_INTERVAL_MS);
  }

  #clearTimer(index) {
    if (this.timers[index]) {
      clearInterval(this.timers[index]);
      this.timers[index] = null;
    }
  }

  #stopLoops() {
    this.timers.forEach((timer) => timer && clearInterval(timer));
    this.timers = [];
  }
}
