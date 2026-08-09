/**
 * Acoustic calibration: the receiver and microphone halves.
 *
 * A receiver fetches its assigned chirp and schedules it exactly the way it
 * schedules ordinary audio — same clock mapping, same compensation — so what
 * the microphone measures is what a listener would actually hear.
 *
 * The microphone device records a window around the scheduled instant and
 * uploads raw samples. It must report, in coordinator time, when the *first
 * recorded sample* entered the microphone; everything the coordinator computes
 * hangs off that number.
 */

/** Extra recording captured beyond the requested window, in seconds. */
const TAIL_SECONDS = 0.1;

/** Emits chirps on request. */
export class ChirpEmitter {
  /**
   * @param {import('./player.js').Player} player used for its context, gain
   *   node and compensation, so a chirp travels the same path as music
   */
  constructor(player) {
    this.player = player;
    /** Decoded chirps by code. */
    this.buffers = new Map();
  }

  /** Fetches and decodes a chirp, caching it for later repetitions. */
  async load(code, url) {
    if (this.buffers.has(code)) return this.buffers.get(code);
    const response = await fetch(url, { cache: 'force-cache' });
    if (!response.ok) throw new Error(`chirp download failed with HTTP ${response.status}`);
    const bytes = await response.arrayBuffer();
    const buffer = await this.player.ctx.decodeAudioData(bytes);
    this.buffers.set(code, buffer);
    return buffer;
  }

  /**
   * Schedules a chirp to be *heard* at `startServerNs`.
   *
   * Deliberately routed through the player's own scheduling maths: calibration
   * that bypassed it would measure a path nothing else uses.
   */
  async emit(message) {
    const buffer = await this.load(message.chirp_code, message.chirp_url);
    const player = this.player;
    const ctx = player.ctx;
    if (!ctx) throw new Error('audio is not enabled on this device');

    const when = player.audioTimeForServerNs(message.start_server_ns) - player.compensationSeconds();
    const earliest = ctx.currentTime + 0.02;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(player.gain);
    source.start(Math.max(when, earliest));
    return { scheduled: when, late: when < earliest };
  }
}

/** Records windows of room audio and uploads them. */
export class CalibrationMicrophone {
  /**
   * @param {import('./clock.js').ClockEstimator} clock
   */
  constructor(clock) {
    this.clock = clock;
    /** @type {MediaStream|null} */
    this.stream = null;
    /** @type {AudioContext|null} */
    this.ctx = null;
    this.source = null;
    this.processor = null;
    this.recording = null;
    /** @type {((message: string) => void)|null} */
    this.onLog = null;
  }

  /** Whether this browser can capture a microphone at all. */
  static available() {
    return Boolean(navigator.mediaDevices?.getUserMedia);
  }

  /**
   * Requests microphone access.
   *
   * The usual voice-friendly processing is switched off: echo cancellation and
   * noise suppression are designed to remove exactly the kind of signal this
   * measurement depends on, and automatic gain control moves the level between
   * repetitions.
   */
  async enable() {
    if (this.stream) return;
    if (!CalibrationMicrophone.available()) {
      throw new Error(
        'this browser exposes no microphone; over plain HTTP that usually means the page is not a secure context',
      );
    }
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
    });
    const Ctor = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctor();
    await this.ctx.resume();
    this.source = this.ctx.createMediaStreamSource(this.stream);
  }

  /** Releases the microphone. */
  release() {
    this.#teardownProcessor();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.source?.disconnect();
    this.source = null;
    this.ctx?.close();
    this.ctx = null;
  }

  #teardownProcessor() {
    if (this.processor) {
      this.processor.disconnect();
      this.processor.onaudioprocess = null;
      this.processor = null;
    }
    this.source?.disconnect();
  }

  /** Audio-context time of a coordinator instant, on the recording context. */
  #contextTimeForServerNs(serverNs) {
    const ctx = this.ctx;
    let contextTime = ctx.currentTime;
    let performanceTime = performance.now();
    if (typeof ctx.getOutputTimestamp === 'function') {
      try {
        const ts = ctx.getOutputTimestamp();
        if (ts && Number.isFinite(ts.contextTime) && ts.contextTime > 0) {
          contextTime = ts.contextTime;
          performanceTime = ts.performanceTime;
        }
      } catch {
        // Fall back to currentTime.
      }
    }
    const clientMs = this.clock.toClientNs(serverNs) / 1e6;
    return contextTime + (clientMs - performanceTime) / 1000;
  }

  /**
   * Records one window and returns the samples with the coordinator time of
   * the first sample.
   *
   * The recorded stream is timestamped by counting samples from the first
   * captured block rather than by reading the clock per block, because a
   * capture callback's arrival time carries scheduler jitter that the sample
   * count does not.
   */
  async record(startServerNs, durationMs) {
    if (!this.ctx || !this.source) throw new Error('microphone is not enabled');
    const ctx = this.ctx;
    const sampleRate = ctx.sampleRate;
    const wanted = Math.ceil(((durationMs / 1000) + TAIL_SECONDS) * sampleRate);

    return new Promise((resolve, reject) => {
      const collected = [];
      let total = 0;
      let firstSampleContextTime = null;
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('recording timed out'));
      }, durationMs + 8000);

      // ScriptProcessorNode is deprecated but is the one capture path present
      // on every browser this project targets, including older webOS. The
      // node is short-lived, so its main-thread cost is not a concern here.
      const bufferSize = 2048;
      const processor = ctx.createScriptProcessor(bufferSize, 1, 1);
      this.processor = processor;

      const startContextTime = this.#contextTimeForServerNs(startServerNs);

      const cleanup = () => {
        clearTimeout(timeout);
        processor.onaudioprocess = null;
        try {
          processor.disconnect();
          this.source.disconnect(processor);
        } catch {
          // Already torn down.
        }
        this.processor = null;
      };

      processor.onaudioprocess = (event) => {
        const now = ctx.currentTime;
        if (now < startContextTime - bufferSize / sampleRate) return; // not yet
        const input = event.inputBuffer.getChannelData(0);
        if (firstSampleContextTime === null) {
          // This block began one buffer ago in context time.
          firstSampleContextTime = now - event.inputBuffer.duration;
        }
        collected.push(new Float32Array(input));
        total += input.length;
        if (total >= wanted) {
          cleanup();
          const samples = new Float32Array(total);
          let offset = 0;
          for (const chunk of collected) {
            samples.set(chunk, offset);
            offset += chunk.length;
          }
          const clientMs = this.#clientMsForContextTime(firstSampleContextTime);
          resolve({
            samples,
            sampleRate,
            firstSampleServerNs: Math.round(this.clock.toServerNs(clientMs * 1e6)),
          });
        }
      };

      this.source.connect(processor);
      // Some engines never fire the callback on a node with no destination.
      const sink = ctx.createGain();
      sink.gain.value = 0;
      processor.connect(sink);
      sink.connect(ctx.destination);
    });
  }

  #clientMsForContextTime(contextTime) {
    const ctx = this.ctx;
    let anchorContext = ctx.currentTime;
    let anchorPerformance = performance.now();
    if (typeof ctx.getOutputTimestamp === 'function') {
      try {
        const ts = ctx.getOutputTimestamp();
        if (ts && Number.isFinite(ts.contextTime) && ts.contextTime > 0) {
          anchorContext = ts.contextTime;
          anchorPerformance = ts.performanceTime;
        }
      } catch {
        // Fall back.
      }
    }
    return anchorPerformance + (contextTime - anchorContext) * 1000;
  }

  /** Uploads one recording to the coordinator. */
  async upload(message, recording) {
    const params = new URLSearchParams({
      session: message.session_id,
      target: message.target_client_id,
      repetition: String(message.repetition),
      rate: String(recording.sampleRate),
      first_sample_server_ns: String(recording.firstSampleServerNs),
    });
    const response = await fetch(`/api/v1/calibration/recording?${params}`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: recording.samples.buffer,
    });
    if (!response.ok) {
      throw new Error(`recording upload failed with HTTP ${response.status}`);
    }
  }
}
