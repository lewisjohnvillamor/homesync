/**
 * Controlled-audio receiver.
 *
 * The whole synchronisation idea lives in `audioTimeForServerNs` and
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

/**
 * Codec queries that give a straight answer, by container family.
 *
 * Asking about a container is not enough and is actively misleading: an
 * open-source Chromium answers "maybe" to `audio/mp4` — it knows the container
 * — while answering "" to `audio/mp4; codecs="mp4a.40.2"`, which is the AAC
 * decoder it does not ship. The codec-specific question is the only one worth
 * asking, so only families that have one are judged at all.
 *
 * Everything else — WAV, MP3, FLAC, AIFF — is deliberately never flagged.
 * There is no codec parameter convention for them, `canPlayType` is free to
 * answer "" for a format the browser can nonetheless decode through
 * `decodeAudioData`, and a warning on a file that plays perfectly is worse than
 * no warning at all: it teaches people to ignore the one that matters.
 */
const DECODER_PROBES = {
  'audio/m4a': ['audio/mp4; codecs="mp4a.40.2"', 'audio/mp4; codecs="mp4a.40.5"', 'audio/mp4; codecs="alac"'],
  'audio/m4b': ['audio/mp4; codecs="mp4a.40.2"', 'audio/mp4; codecs="mp4a.40.5"'],
  'audio/x-m4a': ['audio/mp4; codecs="mp4a.40.2"', 'audio/mp4; codecs="alac"'],
  'audio/mp4': ['audio/mp4; codecs="mp4a.40.2"', 'audio/mp4; codecs="mp4a.40.5"'],
  'video/mp4': ['audio/mp4; codecs="mp4a.40.2"', 'audio/mp4; codecs="mp4a.40.5"'],
  'audio/aac': ['audio/aac', 'audio/mp4; codecs="mp4a.40.2"'],
  'audio/webm': ['audio/webm; codecs=opus', 'audio/webm; codecs=vorbis'],
  'video/webm': ['audio/webm; codecs=opus', 'audio/webm; codecs=vorbis'],
  'audio/ogg': ['audio/ogg; codecs=vorbis', 'audio/ogg; codecs=opus'],
};

/**
 * Whether this browser is known to have no decoder for a track's format.
 *
 * Answers `false` unless it is *sure*, which is the whole discipline of it. The
 * one failure this exists for is real and measured: an `.m4a` library looks
 * fine on an open-source Chromium right up until every track fails to decode,
 * because the AAC decoder is licensed and not shipped. Chrome, Edge and Safari
 * license it and play the same files without complaint.
 *
 * Advisory. A flagged track can still be selected, and the real answer still
 * comes from `decodeAudioData`.
 */
export function browserRefusesType(contentType, probe = null) {
  if (!contentType) return false;
  const probes = DECODER_PROBES[contentType.toLowerCase()];
  // No reliable question to ask about this family, so no opinion is offered.
  if (!probes) return false;

  const element = probe ?? (typeof document === 'undefined' ? null : document.createElement('audio'));
  if (!element || typeof element.canPlayType !== 'function') return false;

  return !probes.some((type) => element.canPlayType(type) !== '');
}

/** How the device's own output latency is being compensated. */
export const LatencyMode = {
  /** `getOutputTimestamp()` maps audio time to when sound is actually heard. */
  OutputTimestamp: 'output-timestamp',
  /** Fall back to `baseLatency + outputLatency` reported by the context. */
  ReportedLatency: 'reported-latency',
};

/**
 * Equaliser bands: a shelf at each end and three peaks between.
 *
 * Five is a judgement, not a limit — enough to tame a boomy shelf or a harsh
 * tweeter, few enough to fit on a phone without becoming a mixing desk.
 */
export const EQ_BANDS = [
  { hz: 60, label: '60' },
  { hz: 250, label: '250' },
  { hz: 1000, label: '1k' },
  { hz: 4000, label: '4k' },
  { hz: 12000, label: '12k' },
];

/* --- Drift correction by resampling ---------------------------------------
 *
 * A device whose audio clock runs slightly fast or slow slides away from the
 * room. The old answer was a coordinated restart once the gap got big enough,
 * which is audible: everyone stops and starts again. This is the quiet answer —
 * trim playback rate by a fraction of a percent and let the device slide back
 * into position over the next half-minute.
 *
 * The numbers are chosen so the correction cannot be heard. 0.2% is about 3.5
 * cents of pitch; the just-noticeable difference for a complex tone is roughly
 * 5-10 cents, and this is a *drift* towards that bound rather than a step to
 * it. What is emphatically audible is the thing it replaces.
 */

/** Largest fractional deviation from normal speed. 0.002 is 0.2%. */
export const MAX_RATE_TRIM = 0.002;

/**
 * Seconds a correction aims to take. The trim is drift divided by this, so a
 * 20 ms error asks for 0.001 and a 40 ms error saturates the bound.
 *
 * Deliberately unhurried: the loop runs once a second against a drift figure
 * that carries measurement noise, and a controller that tries to erase the
 * error in one tick chases the noise instead of the drift.
 */
export const RATE_CONVERGE_SECONDS = 20;

/** Drift that starts a correction, in ms. Below this, nothing is wrong. */
export const RATE_DEADBAND_MS = 4;

/**
 * Smallest trim applied while a correction is running.
 *
 * Proportional control alone decays exponentially, so the last few milliseconds
 * take longer to close than the first thirty — a 30 ms error would sit at 4 ms
 * for the best part of a minute, technically converging and practically stuck.
 * A floor makes the tail linear: from here, any remaining error closes at
 * 0.2 ms per second and the correction actually ends.
 *
 * Small enough that it cannot overshoot the release threshold from outside it.
 */
const MIN_ACTIVE_TRIM = 0.0002;

/**
 * Drift that ends one, in ms.
 *
 * Lower than the entry threshold on purpose. With a single threshold the
 * controller switches on and off around it forever — correcting to just inside,
 * stopping, drifting to just outside, starting again. The gap between the two
 * is what makes a correction run to completion.
 */
export const RATE_RELEASE_MS = 1;

/**
 * Drift beyond which resampling is the wrong tool, in ms.
 *
 * At the bound, a correction closes 2 ms per second. A quarter-second error
 * would take two minutes, and something that far out is not drifting — it
 * stalled, or its clock stepped. The coordinated restart handles those.
 */
export const RATE_RESAMPLE_LIMIT_MS = 250;

/**
 * The playback rate trim this drift calls for.
 *
 * Pure, and separated from the player so the control law can be tested without
 * an `AudioContext`: every interesting case here is about what the loop does
 * over many ticks, which is miserable to check against a real audio graph.
 *
 * `drifting` is the controller's own memory — whether it is mid-correction —
 * and is returned alongside the trim so the caller can hand it back next tick.
 *
 * A positive `driftMs` means this device is *ahead* of where the room says it
 * should be, so it is asked to slow down and the trim comes back negative.
 */
export function rateTrimFor(driftMs, correcting = false) {
  const magnitude = Math.abs(driftMs);

  // Too far gone to resample, or not far enough to bother.
  if (!Number.isFinite(driftMs) || magnitude >= RATE_RESAMPLE_LIMIT_MS) {
    return { trim: 0, correcting: false };
  }
  const threshold = correcting ? RATE_RELEASE_MS : RATE_DEADBAND_MS;
  if (magnitude <= threshold) {
    return { trim: 0, correcting: false };
  }

  const wanted = -driftMs / 1000 / RATE_CONVERGE_SECONDS;
  const bounded = Math.max(-MAX_RATE_TRIM, Math.min(MAX_RATE_TRIM, wanted));
  // Floored towards the direction the correction is already going, so the tail
  // closes at a steady rate instead of asymptotically.
  const floored = Math.max(Math.abs(bounded), MIN_ACTIVE_TRIM);
  const trim = Math.sign(bounded) * floored;
  return { trim, correcting: true };
}

/** Range of each band, in decibels either side of flat. */
export const EQ_LIMIT_DB = 12;

/**
 * Whether this device should be asked to do less.
 *
 * Two comforts here trade resources for smoothness: preloading the next track
 * costs a second decoded buffer, and correcting drift by resampling costs
 * continuous interpolation in the audio thread. Both are a good trade on a
 * laptop and a bad one on a television, which has a few hundred megabytes of
 * browser heap and a processor with nothing spare.
 *
 * An unknown device is treated as capable. `deviceMemory` is coarse and absent
 * outside Chromium, and quietly disabling features on a machine that could have
 * managed them is worse than the occasional gap between tracks.
 */
export function deviceLooksConstrained(nav = typeof navigator === 'undefined' ? null : navigator) {
  if (!nav) return false;
  const memory = nav.deviceMemory;
  if (typeof memory === 'number' && memory > 0 && memory <= 2) return true;
  // A television says so in its user agent, and televisions are precisely the
  // constrained case this project targets.
  return /(smart-?tv|smarttv|webos|web0s|tizen|netcast|hbbtv|viera|bravia|aquos|philipstv|crkey)/i.test(
    nav.userAgent ?? '',
  );
}

/** Keeps a band inside the range the UI offers, and rejects nonsense. */
export function clampDb(value) {
  const db = Number(value);
  if (!Number.isFinite(db)) return 0;
  return Math.max(-EQ_LIMIT_DB, Math.min(EQ_LIMIT_DB, db));
}

export class Player {
  /**
   * @param {import('./clock.js').ClockEstimator} clock
   */
  constructor(clock) {
    this.clock = clock;
    /** @type {AudioContext|null} */
    this.ctx = null;
    this.gain = null;
    /** Equaliser gains in decibels, one per band in `EQ_BANDS`. */
    this.eqGainsDb = EQ_BANDS.map(() => 0);
    /** @type {BiquadFilterNode[]|null} */
    this.eqFilters = null;
    /** Node media sources connect to: the head of the equaliser chain. */
    this.input = null;
    /** @type {AudioBuffer|null} */
    this.buffer = null;
    /** Media id the decoded buffer belongs to. */
    this.bufferMediaId = null;
    /** @type {AudioBuffer|null} Next queued track, decoded ahead of time. */
    this.nextBuffer = null;
    /** Media id `nextBuffer` belongs to. */
    this.nextMediaId = null;
    /** @type {AudioBufferSourceNode|null} */
    this.source = null;

    /** Manual compensation in ms. Positive means "this device is late". */
    this.manualOffsetMs = 0;
    /** Compensation in ms derived from acoustic calibration. */
    this.acousticOffsetMs = 0;
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
    /* Rate-trim state. The trim changes how fast media time advances against
       the audio clock, so position can no longer be derived from the start
       anchor alone — every rate change re-anchors, and elapsed time since is
       scaled by the rate then in force. */
    this.rateTrim = 0;
    this.rateCorrecting = false;
    this.rateAnchorAudioTime = 0;
    this.rateAnchorMediaNs = 0;
    this.rateTrimChanges = 0;
    /* Whether this device corrects drift by resampling, and whether it decodes
       the next track ahead of time. Both default off on a device that looks
       unable to spare the CPU or the memory, and both can be set either way. */
    this.rateCorrectionEnabled = !deviceLooksConstrained();
    this.preloadEnabled = !deviceLooksConstrained();
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
      // Straight to the output until a slider says otherwise.
      this.input = this.gain;
      if (this.eqEngaged) this.setEqGainsDb(this.eqGainsDb);
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

  /**
   * Builds the equaliser chain, which sits between the media source and the
   * output gain.
   *
   * Deliberately *before* the gain rather than after it, because calibration
   * chirps connect straight to the gain node. A chirp that went through the
   * equaliser would measure the filters as well as the room, and the whole
   * point of an acoustic measurement is that it sees what the speaker actually
   * does.
   */
  #buildEqualiser() {
    if (this.eqFilters) return;
    this.eqFilters = EQ_BANDS.map((band, index) => {
      const filter = this.ctx.createBiquadFilter();
      filter.type = index === 0 ? 'lowshelf' : index === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking';
      filter.frequency.value = band.hz;
      filter.Q.value = 1.0;
      filter.gain.value = this.eqGainsDb[index] ?? 0;
      return filter;
    });
    for (const [index, filter] of this.eqFilters.entries()) {
      const next = this.eqFilters[index + 1];
      filter.connect(next ?? this.gain);
    }
  }

  /**
   * Puts the equaliser in or out of the signal path.
   *
   * Five biquads used to sit in front of the output permanently, filtering
   * every sample on every device whether or not anybody had touched a slider.
   * At flat they change nothing audible and still cost the arithmetic — which a
   * television, running one filter pass per band per sample, can least afford.
   *
   * So the chain is built on the first non-flat setting and taken out again
   * when everything returns to flat. A running source is reconnected to the new
   * head of the graph; going between flat filters and no filters is a
   * pass-through either way, so there is nothing to hear.
   */
  #setEqualiserEngaged(engaged) {
    if (!this.ctx) return;
    const wanted = engaged ? (this.#buildEqualiser(), this.eqFilters[0]) : this.gain;
    if (this.input === wanted) return;
    this.input = wanted;

    if (this.source) {
      this.source.disconnect();
      this.source.connect(this.input);
    }
  }

  /** Whether any band asks for anything. */
  get eqEngaged() {
    return this.eqGainsDb.some((db) => db !== 0);
  }

  /**
   * Sets the equaliser, in decibels per band.
   *
   * Ramped rather than stepped: an instant change to a filter's gain on a
   * running graph is audible as a click.
   */
  setEqGainsDb(gainsDb) {
    this.eqGainsDb = EQ_BANDS.map((_, index) => clampDb(gainsDb[index]));
    if (!this.ctx) return;
    this.#setEqualiserEngaged(this.eqEngaged);
    if (!this.eqFilters) return;
    for (const [index, filter] of this.eqFilters.entries()) {
      filter.gain.setTargetAtTime(this.eqGainsDb[index], this.ctx.currentTime, 0.02);
    }
  }

  /** Downloads, verifies and decodes one media item. */
  async load(item, onStage = () => {}) {
    if (!this.ctx) throw new Error('enable audio first');
    if (this.bufferMediaId === item.id && this.buffer) return this.buffer;

    // Already decoded ahead of time while the previous track played. This is
    // the whole point of preloading: the gap between queued tracks becomes the
    // scheduling lead rather than a download and a decode.
    if (this.nextMediaId === item.id && this.nextBuffer) {
      this.buffer = this.nextBuffer;
      this.bufferMediaId = item.id;
      this.nextBuffer = null;
      this.nextMediaId = null;
      onStage('ready');
      return this.buffer;
    }

    const decoded = await this.#fetchAndDecode(item, onStage);
    this.buffer = decoded;
    this.bufferMediaId = item.id;
    onStage('ready');
    return decoded;
  }

  /**
   * Decodes the track queued after the current one, without disturbing it.
   *
   * Costs a second decoded buffer in memory — roughly 23 MB per minute of
   * audio at 48 kHz stereo — which is the trade for tracks that follow each
   * other without a hole.
   */
  async preload(item) {
    if (!this.ctx) throw new Error('enable audio first');
    if (this.nextMediaId === item.id && this.nextBuffer) return this.nextBuffer;
    if (this.bufferMediaId === item.id) return this.buffer;

    const decoded = await this.#fetchAndDecode(item, () => {});
    this.nextBuffer = decoded;
    this.nextMediaId = item.id;
    return decoded;
  }

  async #fetchAndDecode(item, onStage) {
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
    // Handed over rather than copied. `decodeAudioData` detaches the buffer,
    // which is the point: the compressed bytes are freed as the decode starts
    // instead of being held alongside it.
    //
    // This decoded `bytes.slice(0)` to keep the original "for any retry", but
    // nothing retries — the function returns either way. The copy simply
    // doubled the compressed footprint of every load, and a FLAC's compressed
    // footprint is five to ten times an MP3's. Measured on a 12 MB FLAC: the
    // original was still alive after decoding the copy, so both were resident.
    return this.ctx.decodeAudioData(bytes);
  }

  /**
   * Releases the track decoded ahead of time, without touching the one playing.
   *
   * Used when a device is switched to going easy: the memory it is short of is
   * already committed, so waiting for the next track change to free it would
   * mean the setting appeared to do nothing at the moment it was most needed.
   */
  dropPreloaded() {
    this.nextBuffer = null;
    this.nextMediaId = null;
  }

  /** Forgets the decoded buffer, e.g. when the controller changes source. */
  clearMedia() {
    this.stopSource();
    this.buffer = null;
    this.bufferMediaId = null;
    this.nextBuffer = null;
    this.nextMediaId = null;
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

    let startAudioTime = this.audioTimeForServerNs(transport.anchor_server_ns) - this.compensationSeconds();
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
    source.connect(this.input ?? this.gain);
    source.onended = () => {
      if (this.source === source) this.playing = false;
    };
    source.start(startAudioTime, Math.max(0, offsetSeconds));

    this.source = source;
    this.startAudioTime = startAudioTime;
    this.startMediaOffsetNs = mediaOffsetNs;
    // A fresh schedule starts at normal speed: the new anchor is exact, so
    // whatever the trim was compensating for has just been erased.
    this.rateTrim = 0;
    this.rateCorrecting = false;
    this.rateAnchorAudioTime = startAudioTime;
    this.rateAnchorMediaNs = mediaOffsetNs;
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
    return (reported + this.manualOffsetMs + this.acousticOffsetMs) / 1000;
  }

  /** Compensation that software could not have derived on its own, in ms. */
  unmeasurableCompensationMs() {
    return this.manualOffsetMs + this.acousticOffsetMs;
  }

  /**
   * Position of the audio currently reaching the speaker, in nanoseconds, or
   * null when nothing is playing.
   *
   * Manual and acoustic compensation are both excluded on purpose. They exist
   * precisely because software could not derive them, so counting them here
   * would report a device as perfectly aligned merely because someone moved a
   * slider or ran a calibration.
   */
  heardPositionNs() {
    if (!this.playing || !this.ctx) return null;
    const heardContextTime = this.#heardContextTime();
    if (heardContextTime < this.startAudioTime) return this.startMediaOffsetNs;
    // From the rate anchor rather than the start anchor. They are the same
    // until the first trim; after one, media time and audio time no longer
    // advance together, and measuring from the start would report the whole
    // correction as drift and ask for it all over again.
    const elapsed = Math.max(0, heardContextTime - this.rateAnchorAudioTime);
    const media = this.rateAnchorMediaNs + elapsed * (1 + this.rateTrim) * 1e9;
    return media - this.unmeasurableCompensationMs() * 1e6;
  }

  /**
   * Nudges playback rate towards the room, and reports the trim in force.
   *
   * Called once a second from the same tick that sends telemetry. Returns the
   * fractional trim so the interface can say when a device is being corrected —
   * a correction nobody can hear is still worth being able to see.
   */
  steerTowards(transport) {
    if (!this.playing || !this.source || !this.ctx) {
      this.rateCorrecting = false;
      return 0;
    }
    // A playback rate other than 1 makes the audio thread interpolate the
    // buffer on every render quantum, for as long as the correction lasts. On a
    // television that is a real share of a processor which had nothing spare —
    // and the device most likely to be drifting is the one least able to afford
    // being corrected this way. There, drift goes back to the coordinated
    // restart, which is audible but occasional.
    if (!this.rateCorrectionEnabled) {
      if (this.rateTrim !== 0) this.#applyRateTrim(0);
      this.rateCorrecting = false;
      return 0;
    }
    if (!transport || transport.state !== 'playing') return this.rateTrim;

    const heard = this.heardPositionNs();
    if (heard == null) return this.rateTrim;
    const expected = positionAtServerNs(transport, this.clock.serverNow());
    const driftMs = (heard - expected) / 1e6;

    const { trim, correcting } = rateTrimFor(driftMs, this.rateCorrecting);
    this.rateCorrecting = correcting;
    if (trim === this.rateTrim) return this.rateTrim;
    this.#applyRateTrim(trim);
    return this.rateTrim;
  }

  /**
   * Changes the playback rate, re-anchoring so position stays continuous.
   *
   * The anchor is snapshotted *before* the rate changes. Without that, the
   * elapsed time since the previous anchor would be rescaled by the new rate
   * retroactively, and the position would jump by however long the device had
   * been playing — a correction of a few milliseconds would move it by seconds.
   */
  #applyRateTrim(trim) {
    const anchorAudioTime = this.#heardContextTime();
    const elapsed = Math.max(0, anchorAudioTime - this.rateAnchorAudioTime);
    this.rateAnchorMediaNs += elapsed * (1 + this.rateTrim) * 1e9;
    this.rateAnchorAudioTime = anchorAudioTime;
    this.rateTrim = trim;
    this.rateTrimChanges += 1;

    // Set rather than ramped. A rate step is a discontinuity in speed, not in
    // amplitude, so there is no click to smooth away — and a ramp would make
    // the anchor arithmetic above an approximation for the length of it.
    this.source.playbackRate.setValueAtTime(1 + trim, this.ctx.currentTime);
  }

  /** Sets calibration-derived compensation and reschedules if playing. */
  setAcousticOffsetMs(ms, transport) {
    if (this.acousticOffsetMs === ms) return;
    this.acousticOffsetMs = ms;
    if (this.playing && transport) {
      this.resyncCount += 1;
      this.applyTransport(transport, { force: true });
    }
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
      // Parts per million of rate trim, so a device being quietly corrected is
      // visible in an export rather than looking like it simply stopped
      // drifting for no reason.
      rate_trim_ppm: Math.round(this.rateTrim * 1e6),
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
   * Public because calibration schedules chirps through exactly this path:
   * measuring any other path would measure something nothing else uses.
   *
   * Two hops: coordinator time to `performance.now()` via the clock estimator,
   * then `performance.now()` to `AudioContext` time via an anchor pair. When
   * `getOutputTimestamp()` supplies that pair, the result is the audio time
   * whose sound is *heard* at the requested instant.
   */
  audioTimeForServerNs(serverNs) {
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
