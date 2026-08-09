/**
 * Controlled-audio receiver.
 *
 * The whole synchronisation idea lives in `#audioTimeForServerNs` and
 * `applyTransport`: translate one coordinator instant into this device's audio
 * clock, then hand that instant to `AudioBufferSourceNode.start`. Everything
 * else is bookkeeping.
 */

import { sha256Hex } from './sha256.js';

/**
 * Minimum time between "now" and a scheduled start, in seconds. Below this,
 * the browser may have already rendered past the requested instant.
 */
export const MIN_SCHEDULE_LEAD_S = 0.06;

/** How the device's own output latency is being compensated. */
export const LatencyMode = {
  /** `getOutputTimestamp()` maps audio time to when sound is actually heard. */
  OutputTimestamp: 'output-timestamp',
  /** Fall back to `baseLatency + outputLatency` reported by the context. */
  ReportedLatency: 'reported-latency',
};

export class Player {
  /**
   * @param {import('./clock.js').ClockEstimator} clock
   */
  constructor(clock) {
    this.clock = clock;
    /** @type {AudioContext|null} */
    this.ctx = null;
    this.gain = null;
    /** @type {AudioBuffer|null} */
    this.buffer = null;
    /** Media id the decoded buffer belongs to. */
    this.bufferMediaId = null;
    /** @type {AudioBufferSourceNode|null} */
    this.source = null;

    /** Manual compensation in ms. Positive means "this device is late". */
    this.manualOffsetMs = 0;
    this.volume = 1;
    this.muted = false;

    this.latencyMode = LatencyMode.ReportedLatency;
    this.reportedLatencyMs = 0;
    /** Epoch of the transport the current source was scheduled for. */
    this.scheduledEpoch = -1;
    this.scheduledStartServerNs = null;
    this.scheduleShiftMs = 0;
    this.startAudioTime = 0;
    this.startMediaOffsetNs = 0;
    this.playing = false;
    this.suspendEvents = 0;
    this.resyncCount = 0;
    /** @type {((message: string) => void)|null} */
    this.onLog = null;
  }

  /**
   * Creates and unlocks the audio context. Must be called from a user gesture:
   * every mobile browser blocks audio until then, and a receiver that skipped
   * this step stays silent while looking perfectly synchronised.
   */
  async unlock() {
    if (!this.ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) throw new Error('this browser has no Web Audio support');
      // 'playback' asks for the most stable, highest-latency clock, which is
      // what we want: predictable latency beats low latency here.
      this.ctx = new Ctor({ latencyHint: 'playback' });
      this.gain = this.ctx.createGain();
      this.gain.connect(this.ctx.destination);
      this.ctx.onstatechange = () => {
        if (this.ctx.state !== 'running') {
          this.suspendEvents += 1;
          this.clock.suspended = true;
        } else {
          this.clock.suspended = false;
        }
      };
    }
    if (this.ctx.state !== 'running') await this.ctx.resume();

    // A one-frame silent buffer forces iOS to actually start the graph.
    const silence = this.ctx.createBuffer(1, 1, this.ctx.sampleRate);
    const node = this.ctx.createBufferSource();
    node.buffer = silence;
    node.connect(this.gain);
    node.start();

    this.#refreshLatency();
    this.#applyGain();
    return this.ctx.state;
  }

  get ready() {
    return Boolean(this.ctx && this.ctx.state === 'running');
  }

  /** Downloads, verifies and decodes one media item. */
  async load(item, onStage = () => {}) {
    if (!this.ctx) throw new Error('enable audio first');
    if (this.bufferMediaId === item.id && this.buffer) return this.buffer;

    onStage('downloading');
    const response = await fetch(`/api/v1/media/${encodeURIComponent(item.id)}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`download failed with HTTP ${response.status}`);
    const bytes = await response.arrayBuffer();

    onStage('verifying');
    const digest = await sha256Hex(bytes);
    if (digest !== item.sha256) {
      throw new Error('downloaded media does not match the coordinator hash');
    }

    onStage('decoding');
    // decodeAudioData detaches the buffer on some engines, so decode a copy and
    // keep the original bytes untouched for any retry.
    const decoded = await this.ctx.decodeAudioData(bytes.slice(0));
    this.buffer = decoded;
    this.bufferMediaId = item.id;
    onStage('ready');
    return decoded;
  }

  /** Forgets the decoded buffer, e.g. when the controller changes source. */
  clearMedia() {
    this.stopSource();
    this.buffer = null;
    this.bufferMediaId = null;
    this.scheduledEpoch = -1;
  }

  /**
   * Applies an authoritative transport message.
   *
   * `force` reschedules even when the epoch has not changed, which is how a
   * device recovers after waking from the background or after the user changes
   * their compensation mid-playback.
   */
  applyTransport(transport, { force = false } = {}) {
    if (!this.ctx || !this.buffer) return;
    if (!force && transport.epoch === this.scheduledEpoch) return;
    if (transport.media_id !== this.bufferMediaId) return;

    this.scheduledEpoch = transport.epoch;
    this.stopSource();

    if (transport.state !== 'playing') {
      this.playing = false;
      this.scheduledStartServerNs = null;
      return;
    }

    this.#refreshLatency();

    let startAudioTime = this.#audioTimeForServerNs(transport.anchor_server_ns) - this.compensationSeconds();
    let mediaOffsetNs = transport.anchor_media_ns;

    // Late join, or a start instant that has already passed. Move the start
    // forward and skip the same amount into the media, which keeps this device
    // on the room's timeline instead of trailing it.
    const earliest = this.ctx.currentTime + MIN_SCHEDULE_LEAD_S;
    if (startAudioTime < earliest) {
      const shift = earliest - startAudioTime;
      startAudioTime = earliest;
      mediaOffsetNs += shift * 1e9;
      this.scheduleShiftMs = shift * 1000;
    } else {
      this.scheduleShiftMs = 0;
    }

    const offsetSeconds = mediaOffsetNs / 1e9;
    if (offsetSeconds >= this.buffer.duration) {
      this.#log('transport is past the end of this media; nothing scheduled');
      this.playing = false;
      return;
    }

    const source = this.ctx.createBufferSource();
    source.buffer = this.buffer;
    source.connect(this.gain);
    source.onended = () => {
      if (this.source === source) this.playing = false;
    };
    source.start(startAudioTime, Math.max(0, offsetSeconds));

    this.source = source;
    this.startAudioTime = startAudioTime;
    this.startMediaOffsetNs = mediaOffsetNs;
    this.scheduledStartServerNs = transport.anchor_server_ns;
    this.playing = true;
  }

  /** Stops any scheduled or running source without touching the decoded buffer. */
  stopSource() {
    if (this.source) {
      try {
        this.source.onended = null;
        this.source.stop();
      } catch {
        // Already stopped, or never started. Nothing to do.
      }
      this.source.disconnect();
      this.source = null;
    }
    this.playing = false;
  }

  /**
   * Total compensation applied to the scheduled start, in seconds.
   *
   * Positive values start the audio earlier. Two things contribute: the
   * device's own output latency (only when the context cannot tell us when
   * sound is actually heard) and the user's manual adjustment.
   */
  compensationSeconds() {
    const reported = this.latencyMode === LatencyMode.ReportedLatency ? this.reportedLatencyMs : 0;
    return (reported + this.manualOffsetMs) / 1000;
  }

  /**
   * Position of the audio currently reaching the speaker, in nanoseconds, or
   * null when nothing is playing.
   *
   * Manual compensation is excluded on purpose: it exists precisely because
   * software cannot measure that part of the latency, so counting it here
   * would report a device as perfectly aligned merely because someone moved a
   * slider.
   */
  heardPositionNs() {
    if (!this.playing || !this.ctx) return null;
    const heardContextTime = this.#heardContextTime();
    const elapsed = heardContextTime - this.startAudioTime;
    if (elapsed < 0) return this.startMediaOffsetNs;
    return this.startMediaOffsetNs + elapsed * 1e9 - this.manualOffsetMs * 1e6;
  }

  /** Sets manual compensation and reschedules if audio is already running. */
  setManualOffsetMs(ms, transport) {
    this.manualOffsetMs = ms;
    if (this.playing && transport) {
      this.resyncCount += 1;
      this.applyTransport(transport, { force: true });
    }
  }

  setVolume(volume) {
    this.volume = volume;
    this.#applyGain();
  }

  setMuted(muted) {
    this.muted = muted;
    this.#applyGain();
  }

  /** Telemetry in the shape of the protocol's `diagnostic_report` payload. */
  diagnostics(transport) {
    const heard = this.heardPositionNs();
    let driftMs = 0;
    if (heard != null && transport && transport.state === 'playing') {
      const expected = positionAtServerNs(transport, this.clock.serverNow());
      driftMs = (heard - expected) / 1e6;
    }
    return {
      sample_rate: this.ctx ? Math.round(this.ctx.sampleRate) : 0,
      audio_context_state: this.ctx ? this.ctx.state : 'closed',
      output_latency_ms: this.reportedLatencyMs,
      scheduled_start_server_ns: this.scheduledStartServerNs ?? undefined,
      schedule_error_ms: this.scheduleShiftMs,
      position_ns: heard != null ? Math.max(0, Math.round(heard)) : undefined,
      drift_ms: driftMs,
      page_visible: document.visibilityState === 'visible',
      suspend_events: this.suspendEvents,
      resync_count: this.resyncCount,
    };
  }

  #applyGain() {
    if (!this.gain || !this.ctx) return;
    const target = this.muted ? 0 : this.volume;
    // A short ramp instead of a step: an instant gain change on a running
    // buffer is an audible click.
    this.gain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.01);
  }

  #refreshLatency() {
    if (!this.ctx) return;
    const base = Number.isFinite(this.ctx.baseLatency) ? this.ctx.baseLatency : 0;
    const output = Number.isFinite(this.ctx.outputLatency) ? this.ctx.outputLatency : 0;
    this.reportedLatencyMs = (base + output) * 1000;
    this.latencyMode = this.#outputTimestamp() ? LatencyMode.OutputTimestamp : LatencyMode.ReportedLatency;
  }

  /**
   * `getOutputTimestamp()` when it returns a usable pair.
   *
   * The pair says "the sample at `contextTime` is heard at `performanceTime`",
   * which already accounts for this device's output latency — so when it is
   * available, no further latency correction is applied. Before the graph has
   * rendered anything it returns zeros, which is why the values are checked.
   */
  #outputTimestamp() {
    if (!this.ctx || typeof this.ctx.getOutputTimestamp !== 'function') return null;
    try {
      const ts = this.ctx.getOutputTimestamp();
      if (!ts) return null;
      if (!Number.isFinite(ts.contextTime) || !Number.isFinite(ts.performanceTime)) return null;
      if (ts.contextTime <= 0 || ts.performanceTime <= 0) return null;
      return ts;
    } catch {
      return null;
    }
  }

  /** Audio-context time of the sound currently reaching the speaker. */
  #heardContextTime() {
    const ts = this.#outputTimestamp();
    if (ts) return ts.contextTime;
    return this.ctx.currentTime - this.reportedLatencyMs / 1000;
  }

  /**
   * Converts a coordinator instant into this device's audio clock.
   *
   * Two hops: coordinator time to `performance.now()` via the clock estimator,
   * then `performance.now()` to `AudioContext` time via an anchor pair. When
   * `getOutputTimestamp()` supplies that pair, the result is the audio time
   * whose sound is *heard* at the requested instant.
   */
  #audioTimeForServerNs(serverNs) {
    const ts = this.#outputTimestamp();
    const contextTime = ts ? ts.contextTime : this.ctx.currentTime;
    const performanceTime = ts ? ts.performanceTime : performance.now();
    const clientMs = this.clock.toClientNs(serverNs) / 1e6;
    return contextTime + (clientMs - performanceTime) / 1000;
  }

  #log(message) {
    if (this.onLog) this.onLog(message);
  }
}

/** Media position of a transport message at a coordinator instant, in ns. */
export function positionAtServerNs(transport, serverNs) {
  if (!transport || transport.state !== 'playing') return transport?.anchor_media_ns ?? 0;
  const elapsed = Math.max(0, serverNs - transport.anchor_server_ns);
  return transport.anchor_media_ns + elapsed;
}
