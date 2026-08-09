//! Clock offset estimation from four-timestamp exchanges.
//!
//! This is the reference implementation of the algorithm described in spec
//! section 9. The browser client in `web/src/clock.js` implements the same
//! algorithm; keeping a Rust copy means the maths can be tested against
//! synthetic latency, jitter, drift and step discontinuities without a browser,
//! and lets the built-in load generator (`--simulate`) exercise checkpoint 1
//! headlessly.
//!
//! ```
//! use homesync_clock::ClockEstimator;
//!
//! let mut est = ClockEstimator::new();
//! // Server runs 5 ms ahead of the client; 4 ms round trip, split evenly.
//! for i in 0..20 {
//!     let t0 = i as f64 * 1e9;
//!     est.push(t0, t0 + 7e6, t0 + 7e6, t0 + 4e6);
//! }
//! assert!((est.offset_ns() - 5e6).abs() < 1e5);
//! ```

use homesync_protocol::{ClockQuality, ClockReport};

/// Samples retained in the rolling window (spec section 9.3).
pub const WINDOW: usize = 60;

/// Accepted samples required before the estimate may be called `stable`.
pub const MIN_SAMPLES_FOR_STABLE: usize = 8;

/// Offset uncertainty at or below which the estimate is `stable`, in
/// nanoseconds.
///
/// Five milliseconds rather than the 2 ms accuracy target of spec section
/// 20.1, because the uncertainty figure includes the half-round-trip bound
/// below: a perfectly behaved 6 ms LAN round trip already yields 3 ms of
/// bound. Requiring 2 ms here would mark healthy home networks `degraded` and
/// block playback that would in fact have been fine.
pub const STABLE_UNCERTAINTY_NS: f64 = 5_000_000.0;

/// An offset jump larger than this may be a discontinuity (device sleep,
/// network change, coordinator restart).
pub const DISCONTINUITY_NS: f64 = 100_000_000.0;

/// Consecutive samples that must agree on a jump before it is believed.
///
/// One badly delayed reply looks exactly like a clock step — a 400 ms one-way
/// stall shifts the computed offset by 200 ms — so acting on a single sample
/// would throw away a good estimate every time Wi-Fi hiccups.
pub const DISCONTINUITY_CONFIRMATIONS: u32 = 3;

/// One completed four-timestamp exchange.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Sample {
    /// Client send time, client monotonic nanoseconds.
    pub t0: f64,
    /// Server receive time, coordinator monotonic nanoseconds.
    pub t1: f64,
    /// Server send time, coordinator monotonic nanoseconds.
    pub t2: f64,
    /// Client receive time, client monotonic nanoseconds.
    pub t3: f64,
}

impl Sample {
    /// Round-trip delay with the server's own processing time removed.
    pub fn rtt_ns(&self) -> f64 {
        (self.t3 - self.t0) - (self.t2 - self.t1)
    }

    /// Estimated `server - client` offset, assuming a symmetric path.
    pub fn offset_ns(&self) -> f64 {
        ((self.t1 - self.t0) + (self.t2 - self.t3)) / 2.0
    }
}

/// Rolling estimator over the most recent [`WINDOW`] samples.
#[derive(Debug, Default)]
pub struct ClockEstimator {
    samples: Vec<Sample>,
    offset_ns: f64,
    uncertainty_ns: f64,
    drift_ppm: f64,
    have_estimate: bool,
    /// Set when a discontinuity is detected and cleared once the window has
    /// refilled enough to produce a trustworthy estimate again.
    resync_required: bool,
    /// Consecutive samples so far that disagree with the current estimate by
    /// more than [`DISCONTINUITY_NS`].
    pending_step: u32,
}

impl ClockEstimator {
    /// Creates an estimator with an empty window.
    pub fn new() -> Self {
        Self::default()
    }

    /// Feeds one exchange and recomputes the estimate.
    ///
    /// Returns `false` if the sample was rejected as an outlier. A sample that
    /// looks like a discontinuity rather than jitter clears the window instead
    /// of being rejected, so the estimator recovers from sleep and network
    /// changes without operator intervention.
    pub fn push(&mut self, t0: f64, t1: f64, t2: f64, t3: f64) -> bool {
        let sample = Sample { t0, t1, t2, t3 };

        // Physically impossible samples (negative round trip) mean one of the
        // two clocks stepped mid-exchange. Never let them into the window.
        if !sample.rtt_ns().is_finite() || sample.rtt_ns() < 0.0 {
            return false;
        }

        if self.have_estimate && (sample.offset_ns() - self.offset_ns).abs() > DISCONTINUITY_NS {
            self.pending_step += 1;
            if self.pending_step < DISCONTINUITY_CONFIRMATIONS {
                // Probably one stalled reply. Drop it and keep the estimate.
                return false;
            }
            self.samples.clear();
            self.have_estimate = false;
            self.resync_required = true;
            self.pending_step = 0;
        } else {
            self.pending_step = 0;
        }

        self.samples.push(sample);
        if self.samples.len() > WINDOW {
            let excess = self.samples.len() - WINDOW;
            self.samples.drain(0..excess);
        }

        let accepted = self.accepted();
        let was_accepted = accepted.contains(&sample);
        self.recompute(&accepted);
        was_accepted
    }

    /// Samples that survive median-absolute-deviation filtering on round-trip
    /// time. A congested Wi-Fi burst inflates RTT and biases the offset in one
    /// direction, so those samples are dropped before anything is estimated.
    fn accepted(&self) -> Vec<Sample> {
        if self.samples.len() < 4 {
            return self.samples.clone();
        }
        let rtts: Vec<f64> = self.samples.iter().map(Sample::rtt_ns).collect();
        let median = median_of(&rtts);
        let deviations: Vec<f64> = rtts.iter().map(|r| (r - median).abs()).collect();
        let mad = median_of(&deviations);

        // With a very quiet network the MAD collapses to ~0, which would reject
        // almost everything. The floor keeps the filter from being absurdly
        // strict when there is nothing to filter.
        let limit = median + 3.0 * mad.max(250_000.0);
        self.samples.iter().copied().filter(|s| s.rtt_ns() <= limit).collect()
    }

    fn recompute(&mut self, accepted: &[Sample]) {
        if accepted.is_empty() {
            return;
        }

        // The lowest-RTT samples carry the least path asymmetry, so the offset
        // comes from the best quarter of the window rather than from all of it.
        let mut by_rtt = accepted.to_vec();
        by_rtt.sort_by(|a, b| a.rtt_ns().total_cmp(&b.rtt_ns()));
        let best_count = (by_rtt.len() / 4).max(1);
        let best = &by_rtt[..best_count];

        let offsets: Vec<f64> = best.iter().map(Sample::offset_ns).collect();
        self.offset_ns = median_of(&offsets);

        // Uncertainty is half the spread of the best samples, floored by half
        // the best round trip: a symmetric-path assumption can never be more
        // accurate than that, however quiet the measurements look.
        let spread = match (offsets.iter().copied().reduce(f64::min), offsets.iter().copied().reduce(f64::max)) {
            (Some(lo), Some(hi)) => (hi - lo) / 2.0,
            _ => 0.0,
        };
        let best_rtt = by_rtt.first().map(Sample::rtt_ns).unwrap_or(0.0);
        self.uncertainty_ns = spread.max(best_rtt / 2.0);

        self.drift_ppm = drift_ppm(accepted);
        self.have_estimate = true;
        if accepted.len() >= MIN_SAMPLES_FOR_STABLE {
            self.resync_required = false;
        }
    }

    /// Best estimate of `server_ns - client_ns`.
    pub fn offset_ns(&self) -> f64 {
        self.offset_ns
    }

    /// Half-spread of the offset estimate, in nanoseconds.
    pub fn uncertainty_ns(&self) -> f64 {
        self.uncertainty_ns
    }

    /// Estimated relative clock rate error, in parts per million.
    pub fn drift_ppm(&self) -> f64 {
        self.drift_ppm
    }

    /// Whether any estimate exists yet.
    pub fn has_estimate(&self) -> bool {
        self.have_estimate
    }

    /// Converts a client monotonic timestamp into coordinator time.
    pub fn to_server_ns(&self, client_ns: f64) -> f64 {
        client_ns + self.offset_ns
    }

    /// Converts a coordinator timestamp into client monotonic time.
    pub fn to_client_ns(&self, server_ns: f64) -> f64 {
        server_ns - self.offset_ns
    }

    /// Current quality state (spec section 9.4).
    pub fn quality(&self) -> ClockQuality {
        if self.resync_required {
            return ClockQuality::ResyncRequired;
        }
        let accepted = self.accepted().len();
        if !self.have_estimate || accepted < MIN_SAMPLES_FOR_STABLE {
            return ClockQuality::WarmingUp;
        }
        if self.uncertainty_ns <= STABLE_UNCERTAINTY_NS {
            ClockQuality::Stable
        } else {
            ClockQuality::Degraded
        }
    }

    /// Snapshot suitable for publishing over the control channel.
    pub fn report(&self) -> ClockReport {
        let accepted = self.accepted();
        let mut rtts: Vec<f64> = accepted.iter().map(Sample::rtt_ns).collect();
        rtts.sort_by(f64::total_cmp);
        let ns_to_ms = |v: f64| v / 1e6;
        ClockReport {
            offset_ns: self.offset_ns,
            rtt_min_ms: rtts.first().copied().map(ns_to_ms).unwrap_or(0.0),
            rtt_median_ms: ns_to_ms(median_of(&rtts)),
            rtt_p95_ms: ns_to_ms(percentile_of_sorted(&rtts, 0.95)),
            offset_uncertainty_ms: ns_to_ms(self.uncertainty_ns),
            drift_ppm: self.drift_ppm,
            samples: accepted.len() as u32,
            quality: self.quality(),
        }
    }
}

/// Least-squares slope of offset against client time, expressed in parts per
/// million. Needs a reasonable time span to mean anything, so short windows
/// report zero rather than fitting noise.
fn drift_ppm(samples: &[Sample]) -> f64 {
    if samples.len() < 4 {
        return 0.0;
    }
    let n = samples.len() as f64;
    let mean_t: f64 = samples.iter().map(|s| s.t3).sum::<f64>() / n;
    let mean_o: f64 = samples.iter().map(Sample::offset_ns).sum::<f64>() / n;
    let mut num = 0.0;
    let mut den = 0.0;
    for s in samples {
        let dt = s.t3 - mean_t;
        num += dt * (s.offset_ns() - mean_o);
        den += dt * dt;
    }
    // Under a nanosecond-squared of span is a degenerate fit.
    if den < 1.0 {
        return 0.0;
    }
    (num / den) * 1e6
}

/// Median of an unsorted slice. Returns 0 for an empty slice.
fn median_of(values: &[f64]) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    let mut v = values.to_vec();
    v.sort_by(f64::total_cmp);
    let mid = v.len() / 2;
    if v.len().is_multiple_of(2) {
        (v[mid - 1] + v[mid]) / 2.0
    } else {
        v[mid]
    }
}

/// Nearest-rank percentile of an already sorted slice.
fn percentile_of_sorted(sorted: &[f64], p: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    let idx = ((sorted.len() as f64 - 1.0) * p).round() as usize;
    sorted[idx.min(sorted.len() - 1)]
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Tiny deterministic generator, so tests never depend on an RNG crate or
    /// on wall-clock behaviour.
    struct Noise(u64);
    impl Noise {
        fn next_unit(&mut self) -> f64 {
            // xorshift64*
            self.0 ^= self.0 >> 12;
            self.0 ^= self.0 << 25;
            self.0 ^= self.0 >> 27;
            let x = self.0.wrapping_mul(0x2545_F491_4F6C_DD1D);
            (x >> 11) as f64 / (1u64 << 53) as f64
        }
    }

    /// Simulates one exchange for a client whose clock is `offset` behind the
    /// server, over a path with `up`/`down` one-way delays.
    fn exchange(est: &mut ClockEstimator, client_now: f64, offset: f64, up: f64, down: f64) -> bool {
        let t0 = client_now;
        let t1 = t0 + offset + up;
        let t2 = t1 + 50_000.0; // 50 us of server processing
        let t3 = t2 - offset + down;
        est.push(t0, t1, t2, t3)
    }

    #[test]
    fn recovers_a_known_offset_on_a_symmetric_path() {
        let mut est = ClockEstimator::new();
        let offset = 12_345_678.0;
        for i in 0..20 {
            exchange(&mut est, i as f64 * 1e8, offset, 3e6, 3e6);
        }
        assert!((est.offset_ns() - offset).abs() < 100_000.0, "offset {}", est.offset_ns());
        assert_eq!(est.quality(), ClockQuality::Stable);
    }

    #[test]
    fn stays_within_the_two_millisecond_target_under_jitter() {
        // Checkpoint 1: offset error under ~2 ms with realistic Wi-Fi jitter.
        let mut est = ClockEstimator::new();
        let mut noise = Noise(0x5EED);
        let offset = -7_500_000.0;
        for i in 0..200 {
            // 2 ms base each way plus up to 12 ms of one-sided queueing delay.
            let up = 2e6 + noise.next_unit() * 12e6;
            let down = 2e6 + noise.next_unit() * 12e6;
            exchange(&mut est, i as f64 * 2e8, offset, up, down);
        }
        let error = (est.offset_ns() - offset).abs();
        assert!(error < 2_000_000.0, "error {} ns exceeds the 2 ms target", error);
    }

    #[test]
    fn rejects_a_single_congested_outlier() {
        let mut est = ClockEstimator::new();
        let offset = 1e6;
        for i in 0..20 {
            exchange(&mut est, i as f64 * 1e8, offset, 2e6, 2e6);
        }
        let before = est.offset_ns();
        // One badly delayed reply: 400 ms on the return path only. This is
        // large enough to look like a clock step, so it exercises both the
        // outlier filter and the confirmation counter.
        let accepted = exchange(&mut est, 21e8, offset, 2e6, 400e6);
        assert!(!accepted, "a 400 ms one-sided sample must be rejected");
        assert_eq!(est.quality(), ClockQuality::Stable, "one stall must not force a resync");
        assert!((est.offset_ns() - before).abs() < 50_000.0, "outlier moved the estimate");

        // A milder outlier stays inside the discontinuity threshold and must be
        // rejected by the round-trip filter instead.
        let accepted = exchange(&mut est, 22e8, offset, 2e6, 60e6);
        assert!(!accepted, "a 60 ms one-sided sample must be rejected");
        assert!((est.offset_ns() - before).abs() < 50_000.0, "outlier moved the estimate");
    }

    #[test]
    fn detects_a_discontinuity_and_re_locks() {
        let mut est = ClockEstimator::new();
        for i in 0..20 {
            exchange(&mut est, i as f64 * 1e8, 1e6, 2e6, 2e6);
        }
        assert_eq!(est.quality(), ClockQuality::Stable);

        // The device sleeps and its monotonic clock steps by 3 seconds. The
        // step is only believed once enough samples agree on it.
        let stepped = 3e9;
        for i in 0..DISCONTINUITY_CONFIRMATIONS {
            exchange(&mut est, 21e8 + i as f64 * 1e8, stepped, 2e6, 2e6);
        }
        assert_eq!(est.quality(), ClockQuality::ResyncRequired);

        for i in 0..20 {
            exchange(&mut est, 25e8 + i as f64 * 1e8, stepped, 2e6, 2e6);
        }
        assert_eq!(est.quality(), ClockQuality::Stable);
        assert!((est.offset_ns() - stepped).abs() < 100_000.0);
    }

    #[test]
    fn measures_clock_rate_drift() {
        let mut est = ClockEstimator::new();
        // Client clock runs 40 ppm slow, so the offset grows over time.
        let ppm = 40.0;
        for i in 0..60 {
            let client_now = i as f64 * 1e9;
            let offset = 1e6 + client_now * ppm / 1e6;
            exchange(&mut est, client_now, offset, 2e6, 2e6);
        }
        assert!((est.drift_ppm() - ppm).abs() < 5.0, "drift {} ppm", est.drift_ppm());
    }

    #[test]
    fn asymmetric_paths_bias_the_estimate_by_half_the_asymmetry() {
        // Documents the fundamental limit: a symmetric-path assumption cannot
        // see a fixed one-way imbalance, and the error is exactly half of it.
        let mut est = ClockEstimator::new();
        for i in 0..20 {
            exchange(&mut est, i as f64 * 1e8, 0.0, 2e6, 12e6);
        }
        assert!((est.offset_ns() - (-5e6)).abs() < 200_000.0, "offset {}", est.offset_ns());
    }

    #[test]
    fn window_is_bounded() {
        let mut est = ClockEstimator::new();
        for i in 0..500 {
            exchange(&mut est, i as f64 * 1e8, 1e6, 2e6, 2e6);
        }
        assert!(est.samples.len() <= WINDOW);
    }

    #[test]
    fn negative_round_trips_are_discarded() {
        let mut est = ClockEstimator::new();
        assert!(!est.push(1000.0, 0.0, 5000.0, 1100.0));
        assert!(!est.has_estimate());
    }

    #[test]
    fn conversions_are_inverses() {
        let mut est = ClockEstimator::new();
        for i in 0..20 {
            exchange(&mut est, i as f64 * 1e8, 5e6, 2e6, 2e6);
        }
        let client = 1.234e9;
        assert!((est.to_client_ns(est.to_server_ns(client)) - client).abs() < 1e-6);
    }

    #[test]
    fn report_percentiles_are_ordered() {
        let mut est = ClockEstimator::new();
        let mut noise = Noise(7);
        for i in 0..60 {
            let up = 2e6 + noise.next_unit() * 8e6;
            exchange(&mut est, i as f64 * 1e8, 1e6, up, 2e6);
        }
        let r = est.report();
        assert!(r.rtt_min_ms <= r.rtt_median_ms);
        assert!(r.rtt_median_ms <= r.rtt_p95_ms);
        assert!(r.samples > 0);
    }
}
