//! Acoustic calibration: chirp generation and delay estimation.
//!
//! This is what separates HomeSync from a room full of devices that *believe*
//! they are synchronised. Everything else in the project measures software:
//! clock offsets, scheduled instants, reported latencies. This module measures
//! sound — when a chirp played by one device actually reaches a microphone —
//! and that is the only number that corresponds to what a listener hears.
//!
//! The pipeline is: generate a coded chirp, schedule it, record the room,
//! match-filter the recording against the chirp, take the first arrival,
//! repeat, reject outliers, and solve for per-device compensation.
//!
//! ```
//! use homesync_dsp::{ChirpSpec, estimate_delay};
//!
//! let spec = ChirpSpec::for_code(0, 48_000);
//! let chirp = spec.render();
//!
//! // A recording in which the chirp arrives 1000 samples late.
//! let mut recording = vec![0.0f32; 48_000];
//! for (i, sample) in chirp.iter().enumerate() {
//!     recording[1000 + i] = sample * 0.4;
//! }
//!
//! let estimate = estimate_delay(&chirp, &recording, 48_000).expect("a clear arrival");
//! assert!((estimate.delay_samples - 1000.0).abs() < 1.0);
//! ```

pub mod fft;

use fft::{fft_in_place, next_power_of_two};

/// Default chirp duration, in seconds.
///
/// Long enough to spread energy for a sharp match-filter peak and to be heard
/// over room noise, short enough that a full calibration of several devices
/// with repetitions does not test the user's patience.
pub const DEFAULT_CHIRP_SECONDS: f64 = 0.2;

/// Fade applied to each end of a chirp, in seconds. Without it the abrupt
/// start is an audible click, and clicks correlate against everything.
const FADE_SECONDS: f64 = 0.005;

/// Peak-to-sidelobe ratio below which a measurement is discarded as noise.
pub const MIN_PEAK_TO_SIDELOBE: f32 = 4.0;

/// A peak this fraction of the maximum, arriving earlier than the maximum, is
/// taken as the true arrival.
///
/// In a reverberant room a reflection can arrive later and, when it sums with
/// other reflections, measure stronger than the direct sound. The direct path
/// is always the *first* substantial arrival, so the earliest qualifying peak
/// is the physically meaningful one.
const FIRST_ARRIVAL_FRACTION: f32 = 0.4;

/// Minimum separation between the strongest peak and an earlier one for the
/// earlier one to count as a distinct arrival, in seconds.
///
/// Without this, the search finds the rising flank of the main lobe — which is
/// the same arrival, a few samples early — and every clean measurement comes
/// back biased. Two milliseconds is also about the point below which two paths
/// are physically indistinguishable: 2 ms is 70 cm of extra path length.
const MIN_ARRIVAL_SEPARATION_SECONDS: f64 = 0.002;

/// Repetition spread above which a device's latency is called unstable, in
/// seconds. No fixed compensation can help a device that varies more than this
/// between identical measurements.
pub const MAX_STABLE_DEVIATION_SECONDS: f64 = 0.005;

/// Guard interval around the peak excluded from the sidelobe estimate, in
/// seconds.
const SIDELOBE_GUARD_SECONDS: f64 = 0.01;

/// Parameters of one coded chirp.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ChirpSpec {
    /// Sample rate the chirp is rendered at.
    pub sample_rate: u32,
    /// Duration in seconds.
    pub duration_seconds: f64,
    /// Sweep start frequency, in hertz.
    pub start_hz: f64,
    /// Sweep end frequency, in hertz.
    pub end_hz: f64,
}

impl ChirpSpec {
    /// The chirp assigned to receiver number `code`.
    ///
    /// Receivers are measured one at a time, but codes still differ so that a
    /// mistimed or reflected chirp from one device cannot masquerade as
    /// another's arrival: alternate codes sweep in opposite directions, and
    /// successive codes occupy slightly different bands. Two chirps that
    /// sweep opposite ways correlate very weakly against each other.
    pub fn for_code(code: u32, sample_rate: u32) -> Self {
        // Band chosen for ordinary phone and laptop speakers: above most room
        // rumble, below the range where small transducers roll off sharply.
        let shift = 1.0 + 0.08 * (code / 2) as f64;
        let low = 600.0 * shift;
        let high = (6_000.0 * shift).min(sample_rate as f64 * 0.4);
        let ascending = code.is_multiple_of(2);
        Self {
            sample_rate,
            duration_seconds: DEFAULT_CHIRP_SECONDS,
            start_hz: if ascending { low } else { high },
            end_hz: if ascending { high } else { low },
        }
    }

    /// Number of samples the rendered chirp occupies.
    pub fn len(&self) -> usize {
        (self.duration_seconds * self.sample_rate as f64).round() as usize
    }

    /// Whether the chirp is empty, which only happens for a zero duration.
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Renders the chirp as mono float samples in `-1.0..=1.0`.
    ///
    /// An exponential sweep is used rather than a linear one: it spends equal
    /// time per octave, which matches how both room noise and small speakers
    /// behave, and it still auto-correlates to a sharp peak.
    pub fn render(&self) -> Vec<f32> {
        let n = self.len();
        if n == 0 {
            return Vec::new();
        }
        let rate = self.sample_rate as f64;
        let duration = n as f64 / rate;
        let f0 = self.start_hz.max(1.0);
        let f1 = self.end_hz.max(1.0);
        let ratio = f1 / f0;
        let fade = (FADE_SECONDS * rate).round().max(1.0) as usize;

        (0..n)
            .map(|i| {
                let t = i as f64 / rate;
                // Phase of an exponential sweep. The linear case is a distinct
                // formula because the exponential one divides by ln(ratio).
                let phase = if (ratio - 1.0).abs() < 1e-9 {
                    std::f64::consts::TAU * f0 * t
                } else {
                    let k = duration / ratio.ln();
                    std::f64::consts::TAU * f0 * k * (ratio.powf(t / duration) - 1.0)
                };
                let envelope = raised_cosine_envelope(i, n, fade);
                (phase.sin() * envelope) as f32
            })
            .collect()
    }
}

/// Raised-cosine fade in and out, flat in between.
fn raised_cosine_envelope(index: usize, len: usize, fade: usize) -> f64 {
    let fade = fade.min(len / 2).max(1);
    let ramp = |x: f64| 0.5 * (1.0 - (std::f64::consts::PI * x).cos());
    if index < fade {
        ramp(index as f64 / fade as f64)
    } else if index >= len - fade {
        ramp((len - 1 - index) as f64 / fade as f64)
    } else {
        1.0
    }
}

/// Result of match-filtering one recording.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DelayEstimate {
    /// Arrival delay in samples, with sub-sample interpolation.
    pub delay_samples: f64,
    /// Arrival delay in seconds.
    pub delay_seconds: f64,
    /// Correlation value at the chosen arrival.
    pub peak: f32,
    /// Peak divided by the root-mean-square of the correlation away from the
    /// peak. The confidence measure: a clear arrival scores tens, noise scores
    /// close to one.
    pub peak_to_sidelobe: f32,
    /// True when an earlier arrival was chosen over a stronger later one,
    /// which indicates a reflective room.
    pub used_earlier_arrival: bool,
}

/// Cross-correlates `recording` against `reference` through the frequency
/// domain, returning the correlation at every non-negative lag.
///
/// The mean is removed from both signals first: microphone captures routinely
/// carry a DC offset, which would otherwise dominate the correlation.
pub fn correlate(reference: &[f32], recording: &[f32]) -> Vec<f32> {
    if reference.is_empty() || recording.len() < reference.len() {
        return Vec::new();
    }
    let lags = recording.len() - reference.len() + 1;
    let size = next_power_of_two(recording.len() + reference.len());

    let reference_mean = mean(reference);
    let recording_mean = mean(recording);

    let mut ref_re = vec![0.0f64; size];
    let mut ref_im = vec![0.0f64; size];
    for (i, sample) in reference.iter().enumerate() {
        ref_re[i] = (*sample - reference_mean) as f64;
    }
    let mut rec_re = vec![0.0f64; size];
    let mut rec_im = vec![0.0f64; size];
    for (i, sample) in recording.iter().enumerate() {
        rec_re[i] = (*sample - recording_mean) as f64;
    }

    fft_in_place(&mut ref_re, &mut ref_im, false);
    fft_in_place(&mut rec_re, &mut rec_im, false);

    // Multiply the recording by the conjugate of the reference: correlation
    // rather than convolution.
    for i in 0..size {
        let re = rec_re[i] * ref_re[i] + rec_im[i] * ref_im[i];
        let im = rec_im[i] * ref_re[i] - rec_re[i] * ref_im[i];
        rec_re[i] = re;
        rec_im[i] = im;
    }
    fft_in_place(&mut rec_re, &mut rec_im, true);

    rec_re[..lags].iter().map(|v| *v as f32).collect()
}

/// Estimates when `reference` arrives inside `recording`.
///
/// Returns `None` when nothing in the recording resembles the reference
/// strongly enough to trust — a silent device, a muted output, or a
/// microphone too far away. Returning `None` is the right answer far more
/// often than returning a confident wrong number.
pub fn estimate_delay(reference: &[f32], recording: &[f32], sample_rate: u32) -> Option<DelayEstimate> {
    let correlation = correlate(reference, recording);
    if correlation.is_empty() {
        return None;
    }

    let (max_index, max_value) = correlation
        .iter()
        .enumerate()
        .max_by(|(_, a), (_, b)| a.abs().total_cmp(&b.abs()))
        .map(|(i, v)| (i, v.abs()))?;
    if max_value <= 0.0 {
        return None;
    }

    // Prefer the first substantial arrival: the direct sound always precedes
    // its own reflections. Only a distinct earlier *peak*, separated from the
    // strongest one by more than the main lobe, counts — otherwise the search
    // just finds the rising flank of the same arrival.
    let threshold = max_value * FIRST_ARRIVAL_FRACTION;
    let separation = (MIN_ARRIVAL_SEPARATION_SECONDS * sample_rate as f64).round() as usize;
    let search_end = max_index.saturating_sub(separation);
    let arrival_index = (1..search_end)
        .find(|i| {
            let value = correlation[*i].abs();
            value >= threshold && value >= correlation[i - 1].abs() && value >= correlation[i + 1].abs()
        })
        .unwrap_or(max_index);
    let used_earlier_arrival = arrival_index != max_index;

    let guard = (SIDELOBE_GUARD_SECONDS * sample_rate as f64).round() as usize;
    let peak_to_sidelobe = peak_to_sidelobe(&correlation, arrival_index, guard);
    if !peak_to_sidelobe.is_finite() || peak_to_sidelobe < MIN_PEAK_TO_SIDELOBE {
        return None;
    }

    let refined = parabolic_peak(&correlation, arrival_index);
    Some(DelayEstimate {
        delay_samples: refined,
        delay_seconds: refined / sample_rate as f64,
        peak: correlation[arrival_index],
        peak_to_sidelobe,
        used_earlier_arrival,
    })
}

/// Sub-sample peak position from a parabola through the peak and its
/// neighbours. At 48 kHz one sample is 21 us, so this is a refinement rather
/// than a necessity — but it costs three multiplications.
fn parabolic_peak(correlation: &[f32], index: usize) -> f64 {
    if index == 0 || index + 1 >= correlation.len() {
        return index as f64;
    }
    let before = correlation[index - 1].abs() as f64;
    let at = correlation[index].abs() as f64;
    let after = correlation[index + 1].abs() as f64;
    let denominator = before - 2.0 * at + after;
    if denominator.abs() < 1e-12 {
        return index as f64;
    }
    let shift = 0.5 * (before - after) / denominator;
    // A parabola fitted to a genuine peak never moves it more than half a
    // sample; anything larger means the neighbourhood is not peak-shaped.
    if shift.abs() > 0.5 {
        return index as f64;
    }
    index as f64 + shift
}

/// Peak amplitude divided by the RMS of the correlation outside a guard band.
fn peak_to_sidelobe(correlation: &[f32], peak_index: usize, guard: usize) -> f32 {
    let low = peak_index.saturating_sub(guard);
    let high = (peak_index + guard + 1).min(correlation.len());
    let mut sum_squares = 0.0f64;
    let mut count = 0usize;
    for (i, value) in correlation.iter().enumerate() {
        if i >= low && i < high {
            continue;
        }
        sum_squares += (*value as f64) * (*value as f64);
        count += 1;
    }
    if count == 0 {
        return f32::INFINITY;
    }
    let rms = (sum_squares / count as f64).sqrt();
    if rms <= 0.0 {
        return f32::INFINITY;
    }
    (correlation[peak_index].abs() as f64 / rms) as f32
}

/// Summary of several repeated measurements of one device.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Aggregate {
    /// Median accepted delay, in seconds.
    pub delay_seconds: f64,
    /// Median absolute deviation of the accepted delays, in seconds. Large
    /// values mean the device's output latency is not stable, which no fixed
    /// compensation can fix.
    pub deviation_seconds: f64,
    /// Measurements kept.
    pub accepted: usize,
    /// Measurements discarded as outliers.
    pub rejected: usize,
}

impl Aggregate {
    /// Whether the repetitions agree closely enough for a fixed compensation
    /// to be meaningful.
    ///
    /// Kept separate from [`aggregate`] on purpose: the measurement and the
    /// decision about whether to trust it are different things, and the
    /// coordinator can explain an untrustworthy result to the user instead of
    /// silently reporting nothing.
    pub fn is_stable(&self) -> bool {
        self.deviation_seconds <= MAX_STABLE_DEVIATION_SECONDS
    }
}

/// Median with outlier rejection over repeated measurements (spec 13.2).
///
/// Requires at least three surviving measurements: two agreeing values could
/// both be the same reflection.
pub fn aggregate(measurements: &[DelayEstimate]) -> Option<Aggregate> {
    if measurements.len() < 3 {
        return None;
    }
    let delays: Vec<f64> = measurements.iter().map(|m| m.delay_seconds).collect();
    let median = median_of(&delays);
    let deviations: Vec<f64> = delays.iter().map(|d| (d - median).abs()).collect();
    let mad = median_of(&deviations);

    // A 0.5 ms floor: when every repetition agrees the MAD collapses to zero
    // and would reject everything but the exact median.
    let limit = 3.0 * mad.max(0.0005);
    let accepted: Vec<f64> = delays.iter().copied().filter(|d| (d - median).abs() <= limit).collect();
    if accepted.len() < 3 {
        return None;
    }

    let accepted_median = median_of(&accepted);
    let accepted_deviations: Vec<f64> = accepted.iter().map(|d| (d - accepted_median).abs()).collect();
    Some(Aggregate {
        delay_seconds: accepted_median,
        deviation_seconds: median_of(&accepted_deviations),
        accepted: accepted.len(),
        rejected: delays.len() - accepted.len(),
    })
}

/// One device's calibration input.
#[derive(Debug, Clone, PartialEq)]
pub struct DeviceLatency {
    /// Whose latency this is.
    pub client_id: String,
    /// Measured acoustic arrival delay, in seconds, relative to the instant
    /// the device was scheduled to emit sound.
    pub measured_seconds: f64,
    /// Compensation the device was already applying during the measurement,
    /// in seconds. Positive means it was starting early.
    pub current_compensation_seconds: f64,
    /// Whether this device's repetitions agreed closely enough to trust.
    pub stable: bool,
}

/// One device's solved compensation.
#[derive(Debug, Clone, PartialEq)]
pub struct Alignment {
    /// Whose compensation this is.
    pub client_id: String,
    /// New compensation, in seconds. Positive starts the device earlier;
    /// negative starts it later.
    pub compensation_seconds: f64,
    /// The device's intrinsic output latency, in seconds — what it would
    /// exhibit with no compensation at all.
    pub intrinsic_latency_seconds: f64,
}

/// Solves per-device compensation so every device is heard at the same instant.
///
/// A device's intrinsic latency is what it was measured at plus whatever
/// compensation it was already applying. Alignment can only ever hold everyone
/// to the *slowest* device: no amount of scheduling makes a speaker emit sound
/// before its own hardware does. So faster devices are delayed, which is why
/// most results are negative.
///
/// Only devices whose repetitions agreed set the target. Letting a device with
/// wandering latency define it would delay the entire room to match a number
/// nobody can trust — but such a device still receives its own best-effort
/// compensation, because leaving it wildly out of alignment helps no one.
pub fn solve_alignment(devices: &[DeviceLatency]) -> Vec<Alignment> {
    let intrinsic: Vec<f64> = devices.iter().map(|d| d.measured_seconds + d.current_compensation_seconds).collect();

    let stable_max = devices
        .iter()
        .zip(&intrinsic)
        .filter(|(device, _)| device.stable)
        .map(|(_, latency)| *latency)
        .fold(f64::NEG_INFINITY, f64::max);
    let slowest =
        if stable_max.is_finite() { stable_max } else { intrinsic.iter().copied().fold(f64::NEG_INFINITY, f64::max) };
    if !slowest.is_finite() {
        return Vec::new();
    }
    devices
        .iter()
        .zip(intrinsic)
        .map(|(device, latency)| Alignment {
            client_id: device.client_id.clone(),
            compensation_seconds: latency - slowest,
            intrinsic_latency_seconds: latency,
        })
        .collect()
}

fn mean(values: &[f32]) -> f32 {
    if values.is_empty() {
        return 0.0;
    }
    values.iter().map(|v| *v as f64).sum::<f64>() as f32 / values.len() as f32
}

fn median_of(values: &[f64]) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    let mut sorted = values.to_vec();
    sorted.sort_by(f64::total_cmp);
    let mid = sorted.len() / 2;
    if sorted.len().is_multiple_of(2) {
        (sorted[mid - 1] + sorted[mid]) / 2.0
    } else {
        sorted[mid]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: u32 = 48_000;

    /// Deterministic noise, so no test depends on an RNG crate or the clock.
    struct Noise(u64);
    impl Noise {
        fn next_bipolar(&mut self) -> f32 {
            self.0 ^= self.0 >> 12;
            self.0 ^= self.0 << 25;
            self.0 ^= self.0 >> 27;
            let x = self.0.wrapping_mul(0x2545_F491_4F6C_DD1D);
            ((x >> 11) as f64 / (1u64 << 53) as f64) as f32 * 2.0 - 1.0
        }
    }

    /// A recording of `chirp` arriving at `delay` samples, scaled by `gain`.
    fn recording_with(chirp: &[f32], delay: usize, gain: f32, length: usize) -> Vec<f32> {
        let mut recording = vec![0.0f32; length];
        for (i, sample) in chirp.iter().enumerate() {
            if delay + i < length {
                recording[delay + i] += sample * gain;
            }
        }
        recording
    }

    #[test]
    fn chirp_is_bounded_correctly_sized_and_click_free() {
        let spec = ChirpSpec::for_code(0, RATE);
        let chirp = spec.render();

        assert_eq!(chirp.len(), (DEFAULT_CHIRP_SECONDS * RATE as f64) as usize);
        assert!(chirp.iter().all(|s| s.is_finite() && s.abs() <= 1.0), "chirp must stay in range");
        // The fade must bring both ends to near silence, or the discontinuity
        // is a click that correlates against everything.
        assert!(chirp[0].abs() < 0.01, "start {}", chirp[0]);
        assert!(chirp[chirp.len() - 1].abs() < 0.01, "end {}", chirp[chirp.len() - 1]);
        // And the middle must be at full level.
        let peak = chirp.iter().map(|s| s.abs()).fold(0.0f32, f32::max);
        assert!(peak > 0.9, "peak {peak}");
    }

    #[test]
    fn different_codes_produce_distinguishable_chirps() {
        let a = ChirpSpec::for_code(0, RATE).render();
        let b = ChirpSpec::for_code(1, RATE).render();

        let recording = recording_with(&a, 1000, 0.5, RATE as usize);
        // The correct chirp is found...
        let own = estimate_delay(&a, &recording, RATE).expect("own chirp found");
        assert!((own.delay_samples - 1000.0).abs() < 1.0);
        // ...and the opposite-sweep chirp is not confidently mistaken for it.
        match estimate_delay(&b, &recording, RATE) {
            None => {}
            Some(other) => assert!(
                other.peak_to_sidelobe < own.peak_to_sidelobe / 2.0,
                "a foreign chirp scored {} against {} for the real one",
                other.peak_to_sidelobe,
                own.peak_to_sidelobe
            ),
        }
    }

    #[test]
    fn finds_a_known_delay_exactly() {
        let chirp = ChirpSpec::for_code(0, RATE).render();
        for delay in [0usize, 137, 4_800, 20_000] {
            let recording = recording_with(&chirp, delay, 0.6, RATE as usize);
            let estimate = estimate_delay(&chirp, &recording, RATE).expect("arrival");
            assert!(
                (estimate.delay_samples - delay as f64).abs() < 1.0,
                "delay {delay}: estimated {}",
                estimate.delay_samples
            );
            assert!(!estimate.used_earlier_arrival);
        }
    }

    #[test]
    fn survives_heavy_background_noise() {
        // Noise at roughly the same amplitude as the chirp: a phone microphone
        // across a room with a fan running.
        let chirp = ChirpSpec::for_code(0, RATE).render();
        let mut recording = recording_with(&chirp, 9_000, 0.25, RATE as usize);
        let mut noise = Noise(0xC0FFEE);
        for sample in recording.iter_mut() {
            *sample += noise.next_bipolar() * 0.25;
        }

        let estimate = estimate_delay(&chirp, &recording, RATE).expect("arrival despite noise");
        assert!((estimate.delay_samples - 9_000.0).abs() < 5.0, "estimated {}", estimate.delay_samples);
    }

    #[test]
    fn prefers_the_direct_sound_over_a_stronger_reflection() {
        // A hard wall can return more energy to the microphone than the direct
        // path. Taking the strongest peak would report the reflection's delay.
        let chirp = ChirpSpec::for_code(0, RATE).render();
        let mut recording = recording_with(&chirp, 5_000, 0.4, RATE as usize);
        for (i, sample) in chirp.iter().enumerate() {
            recording[7_400 + i] += sample * 0.7; // louder, later
        }

        let estimate = estimate_delay(&chirp, &recording, RATE).expect("arrival");
        assert!(
            (estimate.delay_samples - 5_000.0).abs() < 5.0,
            "should report the direct path, got {}",
            estimate.delay_samples
        );
        assert!(estimate.used_earlier_arrival, "the reflective case should be flagged");
    }

    #[test]
    fn refuses_to_guess_at_pure_noise() {
        let chirp = ChirpSpec::for_code(0, RATE).render();
        let mut noise = Noise(1234);
        let recording: Vec<f32> = (0..RATE as usize).map(|_| noise.next_bipolar() * 0.5).collect();
        assert!(estimate_delay(&chirp, &recording, RATE).is_none(), "noise must not produce a confident measurement");
    }

    #[test]
    fn refuses_to_guess_at_silence() {
        let chirp = ChirpSpec::for_code(0, RATE).render();
        let silence = vec![0.0f32; RATE as usize];
        assert!(estimate_delay(&chirp, &silence, RATE).is_none());
    }

    #[test]
    fn a_dc_offset_does_not_shift_the_result() {
        // Phone microphones routinely deliver a DC bias.
        let chirp = ChirpSpec::for_code(0, RATE).render();
        let mut recording = recording_with(&chirp, 3_000, 0.4, RATE as usize);
        for sample in recording.iter_mut() {
            *sample += 0.3;
        }
        let estimate = estimate_delay(&chirp, &recording, RATE).expect("arrival");
        assert!((estimate.delay_samples - 3_000.0).abs() < 1.0, "estimated {}", estimate.delay_samples);
    }

    #[test]
    fn a_recording_shorter_than_the_chirp_is_not_an_error() {
        let chirp = ChirpSpec::for_code(0, RATE).render();
        assert!(estimate_delay(&chirp, &chirp[..100], RATE).is_none());
        assert!(correlate(&chirp, &[]).is_empty());
    }

    #[test]
    fn aggregate_takes_the_median_and_drops_outliers() {
        let make = |seconds: f64| DelayEstimate {
            delay_samples: seconds * RATE as f64,
            delay_seconds: seconds,
            peak: 1.0,
            peak_to_sidelobe: 20.0,
            used_earlier_arrival: false,
        };
        let measurements = [
            make(0.100),
            make(0.101),
            make(0.0995),
            make(0.100_5),
            make(0.350), // a door closing, or a reflection mistaken for arrival
        ];
        let result = aggregate(&measurements).expect("aggregate");
        assert_eq!(result.rejected, 1);
        assert_eq!(result.accepted, 4);
        assert!((result.delay_seconds - 0.1) < 0.002, "median {}", result.delay_seconds);
        assert!(result.deviation_seconds < 0.002);
    }

    #[test]
    fn aggregate_requires_enough_agreement() {
        let make = |seconds: f64| DelayEstimate {
            delay_samples: 0.0,
            delay_seconds: seconds,
            peak: 1.0,
            peak_to_sidelobe: 20.0,
            used_earlier_arrival: false,
        };
        // Too few repetitions to trust at all.
        assert!(aggregate(&[make(0.1), make(0.1)]).is_none());

        // Three that disagree wildly cannot be rejected as outliers — there is
        // no majority to be an outlier from — so they are reported as an
        // unstable measurement rather than silently discarded.
        let wild = aggregate(&[make(0.1), make(0.5), make(0.9)]).expect("still a measurement");
        assert!(!wild.is_stable(), "a device varying by 400 ms cannot be compensated");

        // Repetitions that agree are stable.
        let tight = aggregate(&[make(0.100), make(0.101), make(0.099)]).expect("aggregate");
        assert!(tight.is_stable());
    }

    #[test]
    fn alignment_delays_the_fast_devices_to_match_the_slowest() {
        let devices = vec![
            DeviceLatency {
                client_id: "fast".into(),
                measured_seconds: 0.040,
                current_compensation_seconds: 0.0,
                stable: true,
            },
            DeviceLatency {
                client_id: "slow".into(),
                measured_seconds: 0.180,
                current_compensation_seconds: 0.0,
                stable: true,
            },
        ];
        let alignment = solve_alignment(&devices);

        let fast = &alignment[0];
        let slow = &alignment[1];
        assert!((slow.compensation_seconds - 0.0).abs() < 1e-9, "the slowest device cannot be helped");
        assert!(
            (fast.compensation_seconds - -0.140).abs() < 1e-9,
            "the fast device must be delayed by the difference, got {}",
            fast.compensation_seconds
        );
    }

    #[test]
    fn alignment_accounts_for_compensation_already_applied() {
        // Both are heard together already, but only because one is starting
        // 100 ms early. Its intrinsic latency is the larger of the two.
        let devices = vec![
            DeviceLatency {
                client_id: "a".into(),
                measured_seconds: 0.05,
                current_compensation_seconds: 0.10,
                stable: true,
            },
            DeviceLatency {
                client_id: "b".into(),
                measured_seconds: 0.05,
                current_compensation_seconds: 0.0,
                stable: true,
            },
        ];
        let alignment = solve_alignment(&devices);
        assert!((alignment[0].intrinsic_latency_seconds - 0.15).abs() < 1e-9);
        assert!((alignment[1].intrinsic_latency_seconds - 0.05).abs() < 1e-9);
        // 'a' is the slow one, so it keeps its compensation and 'b' is delayed.
        assert!((alignment[0].compensation_seconds - 0.0).abs() < 1e-9);
        assert!((alignment[1].compensation_seconds - -0.10).abs() < 1e-9);
    }

    #[test]
    fn alignment_is_idempotent() {
        // Re-running calibration on an already-aligned room must not drift.
        let devices = vec![
            DeviceLatency {
                client_id: "a".into(),
                measured_seconds: 0.18,
                current_compensation_seconds: -0.14,
                stable: true,
            },
            DeviceLatency {
                client_id: "b".into(),
                measured_seconds: 0.18,
                current_compensation_seconds: 0.0,
                stable: true,
            },
        ];
        let alignment = solve_alignment(&devices);
        assert!((alignment[0].compensation_seconds - -0.14).abs() < 1e-9, "{:?}", alignment[0]);
        assert!((alignment[1].compensation_seconds - 0.0).abs() < 1e-9, "{:?}", alignment[1]);
    }

    #[test]
    fn an_unstable_device_does_not_drag_the_whole_room() {
        // The wandering device measures slowest, but delaying everyone by
        // 300 ms to match a number that will not hold is worse than leaving it
        // slightly out. It still gets its own best-effort compensation.
        let devices = vec![
            DeviceLatency {
                client_id: "steady".into(),
                measured_seconds: 0.050,
                current_compensation_seconds: 0.0,
                stable: true,
            },
            DeviceLatency {
                client_id: "wandering".into(),
                measured_seconds: 0.350,
                current_compensation_seconds: 0.0,
                stable: false,
            },
        ];
        let alignment = solve_alignment(&devices);
        assert!((alignment[0].compensation_seconds - 0.0).abs() < 1e-9, "{:?}", alignment[0]);
        assert!(
            (alignment[1].compensation_seconds - 0.300).abs() < 1e-9,
            "the unstable device is still compensated: {:?}",
            alignment[1]
        );
    }

    #[test]
    fn alignment_falls_back_to_all_devices_when_none_are_stable() {
        let devices = vec![
            DeviceLatency {
                client_id: "a".into(),
                measured_seconds: 0.05,
                current_compensation_seconds: 0.0,
                stable: false,
            },
            DeviceLatency {
                client_id: "b".into(),
                measured_seconds: 0.20,
                current_compensation_seconds: 0.0,
                stable: false,
            },
        ];
        let alignment = solve_alignment(&devices);
        assert!((alignment[0].compensation_seconds - -0.15).abs() < 1e-9);
        assert!((alignment[1].compensation_seconds - 0.0).abs() < 1e-9);
    }

    #[test]
    fn alignment_of_an_empty_room_is_empty() {
        assert!(solve_alignment(&[]).is_empty());
    }

    #[test]
    fn end_to_end_two_devices_in_a_noisy_reverberant_room() {
        // The whole pipeline: two devices with different real latencies, each
        // measured five times through noise and reflections, then solved.
        let mut noise = Noise(0xA11CE);
        let mut measure = |code: u32, true_delay_samples: usize| {
            let chirp = ChirpSpec::for_code(code, RATE).render();
            let mut estimates = Vec::new();
            for repetition in 0..5 {
                let mut recording = recording_with(&chirp, true_delay_samples, 0.35, RATE as usize);
                // A reflection 30 ms later, and one at 55 ms.
                for (i, sample) in chirp.iter().enumerate() {
                    let first = true_delay_samples + 1_440 + i;
                    let second = true_delay_samples + 2_640 + i;
                    if first < recording.len() {
                        recording[first] += sample * 0.28;
                    }
                    if second < recording.len() {
                        recording[second] += sample * 0.2;
                    }
                }
                for sample in recording.iter_mut() {
                    *sample += noise.next_bipolar() * 0.12;
                }
                if let Some(estimate) = estimate_delay(&chirp, &recording, RATE) {
                    estimates.push(estimate);
                } else {
                    panic!("repetition {repetition} of code {code} produced no measurement");
                }
            }
            aggregate(&estimates).expect("aggregate")
        };

        // 40 ms and 180 ms of output latency: a laptop and a slow TV.
        let laptop = measure(0, (0.040 * RATE as f64) as usize);
        let television = measure(1, (0.180 * RATE as f64) as usize);
        assert!((laptop.delay_seconds - 0.040).abs() < 0.002, "laptop {}", laptop.delay_seconds);
        assert!((television.delay_seconds - 0.180).abs() < 0.002, "tv {}", television.delay_seconds);

        let alignment = solve_alignment(&[
            DeviceLatency {
                client_id: "laptop".into(),
                measured_seconds: laptop.delay_seconds,
                current_compensation_seconds: 0.0,
                stable: laptop.is_stable(),
            },
            DeviceLatency {
                client_id: "tv".into(),
                measured_seconds: television.delay_seconds,
                current_compensation_seconds: 0.0,
                stable: television.is_stable(),
            },
        ]);
        // The laptop is delayed by about 140 ms to meet the television.
        assert!((alignment[0].compensation_seconds - -0.140).abs() < 0.004, "{:?}", alignment[0]);
        assert!(alignment[1].compensation_seconds.abs() < 1e-9);
    }
}
