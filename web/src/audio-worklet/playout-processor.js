/**
 * Live-PCM playout, running on the audio thread.
 *
 * Mirrors `crates/homesync-audio/src/playout.rs`, which is the tested
 * reference. Change one, change both, and re-run
 * `cargo test -p homesync-audio`.
 *
 * The audio thread must never allocate unpredictably or block, so decoding
 * happens on the main thread and arrives here as plain Float32Arrays through
 * the message port.
 *
 * The mapping from this device's audio clock to coordinator time comes from
 * the main thread as an anchor pair, because only the main thread can call
 * `getOutputTimestamp()`. Everything else — where each frame belongs, when to
 * conceal, when to skip — is decided here, per render quantum.
 */

/**
 * How far behind the presentation timeline a render may fall before audio is
 * discarded to catch up, in nanoseconds.
 *
 * The clock anchor carries a little jitter, so the computed "now" wobbles a
 * millisecond or two either side of the truth. Skipping on every forward
 * wobble throws away buffered audio for no reason and slowly starves the
 * buffer. Sitting a couple of milliseconds late instead is inaudible and
 * self-correcting.
 */
const SKIP_THRESHOLD_NS = 5e6;

/** Flags matching the Rust `frame::flags` module. */
const FLAG_DISCONTINUITY = 0b0000_0001;
const FLAG_SILENCE = 0b0000_0010;

class PlayoutProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const config = options?.processorOptions ?? {};
    this.sampleRate = config.sampleRate || 48000;
    this.channels = config.channels || 2;
    this.targetDepthNs = config.targetDepthNs || 200e6;

    /** @type {Float32Array[]} queued interleaved chunks */
    this.chunks = [];
    /** Read offset into `chunks[0]`. */
    this.offset = 0;
    /** Interleaved samples currently queued. */
    this.queued = 0;

    this.streamStartNs = null;
    this.headIndex = 0;
    this.primed = false;
    this.stats = {
      underruns: 0,
      overruns: 0,
      late_frames: 0,
      duplicate_frames: 0,
      reprimes: 0,
    };

    /** Audio-clock to coordinator-clock anchor, set by the main thread. */
    this.anchor = null;
    /** Total compensation in nanoseconds; positive means this device is late. */
    this.compensationNs = 0;
    this.running = true;

    this.port.onmessage = (event) => this.#onMessage(event.data);
  }

  #onMessage(message) {
    switch (message?.type) {
      case 'frame':
        this.#push(message);
        break;
      case 'anchor':
        this.anchor = { contextTime: message.contextTime, serverNs: message.serverNs };
        this.compensationNs = message.compensationNs || 0;
        break;
      case 'reset':
        this.#reset(null);
        break;
      case 'stop':
        this.running = false;
        break;
      default:
        break;
    }
  }

  get maxDepthNs() {
    return this.targetDepthNs * 4;
  }

  get queuedPerChannel() {
    return Math.floor(this.queued / this.channels);
  }

  get depthNs() {
    return (this.queuedPerChannel / this.sampleRate) * 1e9;
  }

  #reset(presentationNs) {
    this.chunks = [];
    this.offset = 0;
    this.queued = 0;
    this.streamStartNs = presentationNs;
    this.headIndex = 0;
    this.primed = false;
  }

  /** Stream sample index (per channel) for a coordinator instant. */
  #indexForNs(ns) {
    if (this.streamStartNs === null) return 0;
    return Math.round(((ns - this.streamStartNs) * this.sampleRate) / 1e9);
  }

  #appendSilence(perChannelSamples) {
    if (perChannelSamples <= 0) return;
    const chunk = new Float32Array(perChannelSamples * this.channels);
    this.chunks.push(chunk);
    this.queued += chunk.length;
  }

  #push(message) {
    const { presentationNs, frameSamples, flags } = message;
    const samples = message.samples;

    if (flags & FLAG_DISCONTINUITY || this.streamStartNs === null) {
      this.#reset(presentationNs);
    }

    const targetIndex = this.#indexForNs(presentationNs);
    const expectedIndex = this.headIndex + this.queuedPerChannel;
    const frameEnd = targetIndex + frameSamples;

    // Already heard: dropping is the only correct option, because playing it
    // now would put this device permanently behind the rest of the room.
    if (frameEnd <= this.headIndex) {
      this.stats.late_frames += 1;
      return;
    }
    // Wholly inside audio already queued: a duplicate or a reordered
    // retransmission.
    if (frameEnd <= expectedIndex) {
      this.stats.duplicate_frames += 1;
      return;
    }
    if (this.depthNs > this.maxDepthNs) {
      this.stats.overruns += 1;
      return;
    }

    // Conceal a gap with exactly enough silence that everything after it still
    // lands at the right moment.
    if (targetIndex > expectedIndex) {
      this.#appendSilence(targetIndex - expectedIndex);
    }

    const skipPerChannel = Math.max(0, expectedIndex - targetIndex);
    if (flags & FLAG_SILENCE && (!samples || samples.length === 0)) {
      this.#appendSilence(Math.max(0, frameSamples - skipPerChannel));
    } else if (samples && samples.length) {
      const skip = skipPerChannel * this.channels;
      const chunk = skip > 0 ? samples.subarray(skip) : samples;
      if (chunk.length) {
        this.chunks.push(chunk);
        this.queued += chunk.length;
      }
    }

    if (!this.primed && this.depthNs >= this.targetDepthNs) this.primed = true;
  }

  /** Discards `count` interleaved samples from the front. */
  #discard(count) {
    let remaining = count;
    while (remaining > 0 && this.chunks.length) {
      const chunk = this.chunks[0];
      const available = chunk.length - this.offset;
      if (available > remaining) {
        this.offset += remaining;
        this.queued -= remaining;
        remaining = 0;
      } else {
        this.chunks.shift();
        this.offset = 0;
        this.queued -= available;
        remaining -= available;
      }
    }
    return count - remaining;
  }

  /** Coordinator time this render quantum will be heard at. */
  #nowNs() {
    if (!this.anchor) return null;
    return this.anchor.serverNs + (currentTime - this.anchor.contextTime) * 1e9;
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output || output.length === 0) return this.running;
    const frames = output[0].length;
    for (const channel of output) channel.fill(0);

    if (!this.running) return false;
    if (this.streamStartNs === null || !this.primed || !this.anchor) return true;

    // Render the audio due to be *heard* now. A device that emits late must
    // pull from further ahead in the stream, which is what compensation means.
    const nowNs = this.#nowNs() + this.compensationNs;
    const desired = this.#indexForNs(nowNs);

    if (desired < this.headIndex) return true; // not due yet
    const behindNs = ((desired - this.headIndex) / this.sampleRate) * 1e9;
    if (desired > this.headIndex && behindNs > SKIP_THRESHOLD_NS) {
      const skipped = this.#discard((desired - this.headIndex) * this.channels);
      this.headIndex += Math.floor(skipped / this.channels);
    }

    const wanted = frames * this.channels;
    const available = Math.min(this.queued, wanted);
    let written = 0;
    while (written < available && this.chunks.length) {
      const chunk = this.chunks[0];
      const chunkAvailable = chunk.length - this.offset;
      const take = Math.min(chunkAvailable, available - written);
      for (let i = 0; i < take; i += 1) {
        const index = written + i;
        const frame = Math.floor(index / this.channels);
        const channel = index % this.channels;
        if (channel < output.length) output[channel][frame] = chunk[this.offset + i];
      }
      written += take;
      this.offset += take;
      this.queued -= take;
      if (this.offset >= chunk.length) {
        this.chunks.shift();
        this.offset = 0;
      }
    }
    this.headIndex += Math.floor(written / this.channels);

    if (written < wanted) {
      this.stats.underruns += 1;
      if (this.queued === 0) {
        // Fully drained: re-prime rather than stuttering quantum by quantum.
        // The timeline origin is kept, so audio arriving later still lands at
        // its correct presentation time.
        this.stats.reprimes += 1;
        this.primed = false;
      }
    }

    // One report per ~100 ms. The audio thread must not spend its budget
    // posting messages.
    this.reportCounter = (this.reportCounter || 0) + 1;
    if (this.reportCounter * frames >= this.sampleRate / 10) {
      this.reportCounter = 0;
      this.port.postMessage({
        type: 'stats',
        depth_ms: this.depthNs / 1e6,
        target_ms: this.targetDepthNs / 1e6,
        primed: this.primed,
        ...this.stats,
      });
    }

    return true;
  }
}

registerProcessor('homesync-playout', PlayoutProcessor);
