/**
 * Clock offset estimation in the browser.
 *
 * Mirrors `crates/homesync-clock/src/lib.rs`. That crate is the tested
 * reference; if you change the algorithm, change both and re-run
 * `cargo test -p homesync-clock`.
 *
 * All client-side times are nanoseconds derived from `performance.now()`,
 * which is monotonic and unaffected by wall-clock adjustments.
 */

/** Samples retained in the rolling window. */
const WINDOW = 60;

/** Accepted samples required before the estimate may be called stable. */
const MIN_SAMPLES_FOR_STABLE = 8;

/**
 * Offset uncertainty at or below which the estimate is stable, in nanoseconds.
 * Five rather than two milliseconds because the uncertainty figure includes a
 * half-round-trip bound: a healthy 6 ms LAN round trip already contributes 3 ms.
 */
export const STABLE_UNCERTAINTY_NS = 5e6;

/** An offset jump larger than this may be a discontinuity rather than jitter. */
const DISCONTINUITY_NS = 100e6;

/**
 * Consecutive samples that must agree on a jump before it is believed. One
 * stalled reply shifts the computed offset by half the stall, which is
 * indistinguishable from a clock step until the next sample disagrees with it.
 */
export const DISCONTINUITY_CONFIRMATIONS = 3;

/** Current client monotonic time in nanoseconds. */
export function clientNow() {
  return performance.now() * 1e6;
}

function median(values) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function percentileOfSorted(sorted, p) {
  if (sorted.length === 0) return 0;
  const index = Math.round((sorted.length - 1) * p);
  return sorted[Math.min(index, sorted.length - 1)];
}

/** Rolling four-timestamp clock estimator. */
export class ClockEstimator {
  constructor() {
    this.samples = [];
    this.offsetNs = 0;
    this.uncertaintyNs = 0;
    this.driftPpm = 0;
    this.haveEstimate = false;
    this.resyncRequired = false;
    this.pendingStep = 0;
    /** Set by the app when the page is hidden or the audio context suspends. */
    this.suspended = false;
  }

  /**
   * Feeds one exchange. `t0`/`t3` are client nanoseconds, `t1`/`t2` are
   * coordinator nanoseconds. Returns whether the sample was accepted.
   */
  push(t0, t1, t2, t3) {
    const sample = { t0, t1, t2, t3 };
    const rtt = rttOf(sample);
    if (!Number.isFinite(rtt) || rtt < 0) return false;

    if (this.haveEstimate && Math.abs(offsetOf(sample) - this.offsetNs) > DISCONTINUITY_NS) {
      this.pendingStep += 1;
      // Probably one stalled reply; drop it and keep the estimate.
      if (this.pendingStep < DISCONTINUITY_CONFIRMATIONS) return false;
      // Confirmed: device sleep, network change or a coordinator restart.
      // Throwing the window away is much faster than letting the median walk
      // to the new value one sample at a time.
      this.samples = [];
      this.haveEstimate = false;
      this.resyncRequired = true;
      this.pendingStep = 0;
    } else {
      this.pendingStep = 0;
    }

    this.samples.push(sample);
    if (this.samples.length > WINDOW) this.samples.splice(0, this.samples.length - WINDOW);

    const accepted = this.accepted();
    this.#recompute(accepted);
    return accepted.includes(sample);
  }

  /** Samples surviving median-absolute-deviation filtering on round-trip time. */
  accepted() {
    if (this.samples.length < 4) return [...this.samples];
    const rtts = this.samples.map(rttOf);
    const med = median(rtts);
    const mad = median(rtts.map((r) => Math.abs(r - med)));
    // Floor the deviation so a very quiet network does not reject everything.
    const limit = med + 3 * Math.max(mad, 0.25e6);
    return this.samples.filter((s) => rttOf(s) <= limit);
  }

  #recompute(accepted) {
    if (accepted.length === 0) return;

    // Lowest-RTT samples carry the least path asymmetry.
    const byRtt = [...accepted].sort((a, b) => rttOf(a) - rttOf(b));
    const best = byRtt.slice(0, Math.max(1, Math.floor(byRtt.length / 4)));
    const offsets = best.map(offsetOf);

    this.offsetNs = median(offsets);
    const spread = (Math.max(...offsets) - Math.min(...offsets)) / 2;
    // A symmetric-path assumption can never beat half the best round trip.
    this.uncertaintyNs = Math.max(spread, rttOf(byRtt[0]) / 2);
    this.driftPpm = driftPpm(accepted);
    this.haveEstimate = true;
    if (accepted.length >= MIN_SAMPLES_FOR_STABLE) this.resyncRequired = false;
  }

  /** Converts a client monotonic timestamp into coordinator time. */
  toServerNs(clientNs) {
    return clientNs + this.offsetNs;
  }

  /** Converts a coordinator timestamp into client monotonic time. */
  toClientNs(serverNs) {
    return serverNs - this.offsetNs;
  }

  /** Coordinator time right now, in nanoseconds. */
  serverNow() {
    return this.toServerNs(clientNow());
  }

  /** Quality state, matching the protocol enum. */
  quality() {
    if (this.suspended) return 'suspended';
    if (this.resyncRequired) return 'resync_required';
    const accepted = this.accepted().length;
    if (!this.haveEstimate || accepted < MIN_SAMPLES_FOR_STABLE) return 'warming_up';
    return this.uncertaintyNs <= STABLE_UNCERTAINTY_NS ? 'stable' : 'degraded';
  }

  /** Snapshot in the shape of the protocol's `clock_report` payload. */
  report() {
    const accepted = this.accepted();
    const rtts = accepted.map(rttOf).sort((a, b) => a - b);
    const toMs = (v) => v / 1e6;
    return {
      offset_ns: this.offsetNs,
      rtt_min_ms: rtts.length ? toMs(rtts[0]) : 0,
      rtt_median_ms: toMs(median(rtts)),
      rtt_p95_ms: toMs(percentileOfSorted(rtts, 0.95)),
      offset_uncertainty_ms: toMs(this.uncertaintyNs),
      drift_ppm: this.driftPpm,
      samples: accepted.length,
      quality: this.quality(),
    };
  }

  /** Forces a fresh estimate, e.g. after the page returns from the background. */
  reset() {
    this.samples = [];
    this.haveEstimate = false;
    this.resyncRequired = true;
    this.pendingStep = 0;
  }
}

function rttOf(s) {
  return s.t3 - s.t0 - (s.t2 - s.t1);
}

function offsetOf(s) {
  return (s.t1 - s.t0 + (s.t2 - s.t3)) / 2;
}

/** Least-squares slope of offset against client time, in parts per million. */
function driftPpm(samples) {
  if (samples.length < 4) return 0;
  const n = samples.length;
  const meanT = samples.reduce((a, s) => a + s.t3, 0) / n;
  const meanO = samples.reduce((a, s) => a + offsetOf(s), 0) / n;
  let num = 0;
  let den = 0;
  for (const s of samples) {
    const dt = s.t3 - meanT;
    num += dt * (offsetOf(s) - meanO);
    den += dt * dt;
  }
  if (den < 1) return 0;
  return (num / den) * 1e6;
}
