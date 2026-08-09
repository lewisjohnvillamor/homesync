/**
 * Live system-audio receiver (source mode C).
 *
 * Decodes binary PCM frames and hands them to the playout worklet, and keeps
 * the worklet supplied with an audio-clock-to-coordinator-clock anchor.
 *
 * Frame parsing mirrors `crates/homesync-audio/src/frame.rs`. Every field is
 * validated before the payload is touched: these samples go straight into an
 * audio callback, so a malformed frame must fail here rather than become a
 * burst of noise at full volume.
 */

const MAGIC = 0x4853594e; // 'HSYN'
const VERSION = 1;
const HEADER_BYTES = 34;
const MAX_PAYLOAD_BYTES = 48000 * 2 * 4;
const MAX_CHANNELS = 8;

export const FLAG_DISCONTINUITY = 0b0000_0001;
export const FLAG_SILENCE = 0b0000_0010;

/** How often the worklet's clock anchor is refreshed, in milliseconds. */
const ANCHOR_INTERVAL_MS = 250;

/**
 * Parses one binary PCM frame.
 *
 * Returns `null` for anything malformed rather than throwing: a bad frame on a
 * live stream is a thing to count and skip, not an exception to unwind.
 */
export function decodeFrame(buffer) {
  if (!buffer || buffer.byteLength < HEADER_BYTES) return null;
  const view = new DataView(buffer);
  if (view.getUint32(0, false) !== MAGIC) return null;
  if (view.getUint8(4) !== VERSION) return null;

  const flags = view.getUint8(5);
  const formatCode = view.getUint8(6);
  if (formatCode !== 1 && formatCode !== 2) return null; // 3 is Opus, not implemented
  const channels = view.getUint8(7);
  if (channels === 0 || channels > MAX_CHANNELS) return null;
  const sampleRate = view.getUint32(8, false);
  if (sampleRate < 8000 || sampleRate > 192000) return null;

  // getBigUint64 keeps full precision for the sequence; presentation times are
  // converted to Number, which is exact to nanoseconds for 104 days of uptime.
  const sequence = Number(view.getBigUint64(12, false));
  const presentationNs = Number(view.getBigUint64(20, false));
  const frameSamples = view.getUint16(28, false);
  const payloadLength = view.getUint32(30, false);

  if (payloadLength > MAX_PAYLOAD_BYTES) return null;
  if (buffer.byteLength < HEADER_BYTES + payloadLength) return null;

  const bytesPerSample = formatCode === 1 ? 2 : 4;
  const expected = frameSamples * channels * bytesPerSample;
  const silent = (flags & FLAG_SILENCE) !== 0;
  if (payloadLength !== expected && !(silent && payloadLength === 0)) return null;

  let samples = null;
  if (payloadLength > 0) {
    samples = new Float32Array(frameSamples * channels);
    if (formatCode === 1) {
      for (let i = 0; i < samples.length; i += 1) {
        samples[i] = view.getInt16(HEADER_BYTES + i * 2, true) / 32767;
      }
    } else {
      for (let i = 0; i < samples.length; i += 1) {
        samples[i] = view.getFloat32(HEADER_BYTES + i * 4, true);
      }
    }
  }

  return { flags, channels, sampleRate, sequence, presentationNs, frameSamples, samples };
}

/** Receives, decodes and renders a live PCM stream. */
export class LiveReceiver {
  /**
   * @param {AudioContext} ctx
   * @param {AudioNode} destination
   * @param {import('./clock.js').ClockEstimator} clock
   */
  constructor(ctx, destination, clock) {
    this.ctx = ctx;
    this.destination = destination;
    this.clock = clock;
    /** @type {AudioWorkletNode|null} */
    this.node = null;
    this.info = null;
    this.compensationMs = 0;
    this.stats = null;
    this.decodeFailures = 0;
    this.framesReceived = 0;
    this.anchorTimer = null;
    /** @type {((stats: object) => void)|null} */
    this.onStats = null;
  }

  /** Whether a stream is currently being rendered. */
  get active() {
    return Boolean(this.node);
  }

  /**
   * Builds the worklet for a stream. Called on every `stream_info`, because a
   * new stream epoch means a different format or a restarted timeline and the
   * old buffer's contents are meaningless.
   */
  async start(info, compensationMs) {
    await this.stop();
    if (!this.ctx.audioWorklet) {
      throw new Error('this browser has no AudioWorklet, so live streaming is unavailable');
    }
    await this.ctx.audioWorklet.addModule('/audio-worklet/playout-processor.js');

    this.info = info;
    this.compensationMs = compensationMs;
    this.node = new AudioWorkletNode(this.ctx, 'homesync-playout', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [Math.min(info.channels, 2)],
      processorOptions: {
        sampleRate: info.sample_rate,
        channels: info.channels,
        targetDepthNs: info.target_depth_ms * 1e6,
      },
    });
    this.node.port.onmessage = (event) => {
      if (event.data?.type === 'stats') {
        this.stats = event.data;
        if (this.onStats) this.onStats(event.data);
      }
    };
    this.node.connect(this.destination);

    this.#sendAnchor();
    this.anchorTimer = setInterval(() => this.#sendAnchor(), ANCHOR_INTERVAL_MS);
  }

  /** Tears down the worklet. */
  async stop() {
    if (this.anchorTimer) {
      clearInterval(this.anchorTimer);
      this.anchorTimer = null;
    }
    if (this.node) {
      this.node.port.postMessage({ type: 'stop' });
      this.node.disconnect();
      this.node = null;
    }
    this.info = null;
    this.stats = null;
  }

  /** Updates the compensation applied on the audio thread. */
  setCompensationMs(ms) {
    this.compensationMs = ms;
    this.#sendAnchor();
  }

  /** Handles one binary message from the control socket. */
  acceptFrame(buffer) {
    if (!this.node) return;
    const frame = decodeFrame(buffer);
    if (!frame) {
      this.decodeFailures += 1;
      return;
    }
    this.framesReceived += 1;
    // The samples are transferred rather than copied: at 100 frames a second
    // per receiver, copying is measurable.
    const transfer = frame.samples ? [frame.samples.buffer] : [];
    this.node.port.postMessage({ type: 'frame', ...frame }, transfer);
  }

  /**
   * Sends the audio-clock anchor.
   *
   * Only the main thread can call `getOutputTimestamp()`, which is what makes
   * the anchor describe when sound is actually *heard* rather than when it is
   * rendered. Without it we fall back to the context's reported latency.
   */
  #sendAnchor() {
    if (!this.node) return;
    let contextTime = this.ctx.currentTime;
    let performanceTime = performance.now();
    const ts = this.#outputTimestamp();
    if (ts) {
      contextTime = ts.contextTime;
      performanceTime = ts.performanceTime;
    } else {
      const base = Number.isFinite(this.ctx.baseLatency) ? this.ctx.baseLatency : 0;
      const output = Number.isFinite(this.ctx.outputLatency) ? this.ctx.outputLatency : 0;
      contextTime -= base + output;
    }
    this.node.port.postMessage({
      type: 'anchor',
      contextTime,
      serverNs: this.clock.toServerNs(performanceTime * 1e6),
      compensationNs: this.compensationMs * 1e6,
    });
  }

  #outputTimestamp() {
    if (typeof this.ctx.getOutputTimestamp !== 'function') return null;
    try {
      const ts = this.ctx.getOutputTimestamp();
      if (!ts || !Number.isFinite(ts.contextTime) || !Number.isFinite(ts.performanceTime)) return null;
      if (ts.contextTime <= 0 || ts.performanceTime <= 0) return null;
      return ts;
    } catch {
      return null;
    }
  }

  /** Telemetry in the shape of the protocol's `buffer_report` payload. */
  bufferReport() {
    if (!this.stats) return null;
    return {
      depth_ms: this.stats.depth_ms,
      target_ms: this.stats.target_ms,
      primed: this.stats.primed,
      underruns: this.stats.underruns,
      overruns: this.stats.overruns,
      late_frames: this.stats.late_frames,
      duplicate_frames: this.stats.duplicate_frames,
      reprimes: this.stats.reprimes,
    };
  }
}
