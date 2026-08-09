//! Playout buffer model for live streaming.
//!
//! This is the reference implementation of the receiver-side buffer described
//! in specification section 11.2. The browser runs the same algorithm inside an
//! `AudioWorklet` (`web/src/audio-worklet/playout-processor.js`); keeping a
//! Rust copy means loss, reordering, duplication, late arrival and clock skew
//! can be tested exhaustively without a browser or a network.
//!
//! The central idea: a frame's *presentation time* decides when it is heard,
//! never its arrival time. Frames are placed on a sample timeline derived from
//! the coordinator's clock, gaps are concealed with silence of exactly the
//! right length, and everything that arrives too late to be heard is dropped
//! rather than played at the wrong moment.

use crate::frame::FrameHeader;
use std::collections::VecDeque;

/// Latency profile (specification section 11.3).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LatencyProfile {
    /// 80 ms. Experiments and low-latency use; higher dropout risk.
    Live,
    /// 200 ms. Video where the source delay is controllable.
    Movie,
    /// 400 ms. Strong synchronisation and Wi-Fi resilience.
    Music,
}

impl LatencyProfile {
    /// Target buffer depth, in nanoseconds.
    pub fn target_depth_ns(self) -> u64 {
        match self {
            LatencyProfile::Live => 80_000_000,
            LatencyProfile::Movie => 200_000_000,
            LatencyProfile::Music => 400_000_000,
        }
    }

    /// Wire name.
    pub fn as_str(self) -> &'static str {
        match self {
            LatencyProfile::Live => "live",
            LatencyProfile::Movie => "movie",
            LatencyProfile::Music => "music",
        }
    }

    /// Parses a wire name. Not `FromStr`, because an unknown profile is a
    /// normal thing for a client to send, not an error worth a type.
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "live" => Some(LatencyProfile::Live),
            "movie" => Some(LatencyProfile::Movie),
            "music" => Some(LatencyProfile::Music),
            _ => None,
        }
    }
}

/// How far behind the presentation timeline a render may fall before audio is
/// discarded to catch up, in nanoseconds.
///
/// The clock anchor carries a little jitter, so the computed "now" wobbles by
/// a millisecond or two either side of the truth. Skipping on every forward
/// wobble throws away buffered audio for no reason and slowly starves the
/// buffer. Sitting a couple of milliseconds late instead is inaudible and
/// self-correcting.
pub const SKIP_THRESHOLD_NS: u64 = 5_000_000;

/// Counters reported back to the coordinator for diagnostics.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct PlayoutStats {
    /// Render calls that ran out of audio and had to emit silence.
    pub underruns: u32,
    /// Frames discarded because the buffer was already over its ceiling.
    pub overruns: u32,
    /// Frames that arrived after their audio should already have been heard.
    pub late_frames: u32,
    /// Frames wholly overlapping audio already buffered: duplicates or
    /// reordered retransmissions.
    pub duplicate_frames: u32,
    /// Samples of silence inserted to bridge a gap in the stream.
    pub concealed_samples: u64,
    /// Times the buffer emptied completely and had to re-prime.
    pub reprimes: u32,
}

/// Receiver-side playout buffer.
#[derive(Debug)]
pub struct PlayoutBuffer {
    sample_rate: u32,
    channels: u16,
    target_depth_ns: u64,
    /// Presentation time of stream sample zero. `None` before the first frame.
    stream_start_ns: Option<u64>,
    /// Stream sample index (per channel) of the first buffered sample.
    head_index: u64,
    /// Interleaved samples awaiting playout.
    samples: VecDeque<f32>,
    /// False until the buffer has reached its target depth. Rendering before
    /// then guarantees an immediate underrun.
    primed: bool,
    stats: PlayoutStats,
}

impl PlayoutBuffer {
    /// Creates an empty buffer.
    pub fn new(sample_rate: u32, channels: u16, profile: LatencyProfile) -> Self {
        Self {
            sample_rate,
            channels,
            target_depth_ns: profile.target_depth_ns(),
            stream_start_ns: None,
            head_index: 0,
            samples: VecDeque::new(),
            primed: false,
            stats: PlayoutStats::default(),
        }
    }

    /// Diagnostics counters.
    pub fn stats(&self) -> PlayoutStats {
        self.stats
    }

    /// Buffered audio, in nanoseconds.
    pub fn depth_ns(&self) -> u64 {
        self.samples_per_channel_to_ns(self.buffered_per_channel())
    }

    /// Target depth, in nanoseconds.
    pub fn target_depth_ns(&self) -> u64 {
        self.target_depth_ns
    }

    /// Whether the buffer has primed and is rendering audio.
    pub fn primed(&self) -> bool {
        self.primed
    }

    /// Ceiling beyond which frames are dropped rather than buffered.
    ///
    /// Without one, a receiver that falls behind grows its buffer forever and
    /// ends up minutes late while looking healthy. Four times the target is
    /// generous enough to ride out a Wi-Fi stall.
    fn max_depth_ns(&self) -> u64 {
        self.target_depth_ns.saturating_mul(4)
    }

    fn buffered_per_channel(&self) -> u64 {
        self.samples.len() as u64 / self.channels.max(1) as u64
    }

    fn samples_per_channel_to_ns(&self, samples: u64) -> u64 {
        if self.sample_rate == 0 {
            return 0;
        }
        (samples as u128 * 1_000_000_000 / self.sample_rate as u128) as u64
    }

    /// Stream sample index (per channel) corresponding to a coordinator time.
    /// Computed from the stream origin every time rather than accumulated, so
    /// rounding never drifts over a long session.
    fn index_for_ns(&self, ns: u64) -> i128 {
        let Some(start) = self.stream_start_ns else { return 0 };
        let delta = ns as i128 - start as i128;
        (delta * self.sample_rate as i128 + 500_000_000) / 1_000_000_000
    }

    /// Restarts the timeline at `presentation_ns`, discarding buffered audio.
    fn reset_to(&mut self, presentation_ns: u64) {
        self.samples.clear();
        self.stream_start_ns = Some(presentation_ns);
        self.head_index = 0;
        self.primed = false;
    }

    /// Accepts one decoded frame.
    ///
    /// `samples` is interleaved and must contain `frame_samples * channels`
    /// values; a silence frame may pass an empty slice.
    pub fn push(&mut self, header: &FrameHeader, samples: &[f32]) {
        use crate::frame::flags;

        if header.sample_rate != self.sample_rate || header.channels as u16 != self.channels {
            // A format change mid-stream is a new stream as far as playout is
            // concerned. The caller is expected to rebuild the buffer; until
            // it does, dropping is safer than interleaving two formats.
            self.stats.duplicate_frames += 1;
            return;
        }

        let silent = header.flags & flags::SILENCE != 0;
        let frame_len = header.frame_samples as usize;
        if header.flags & flags::DISCONTINUITY != 0 || self.stream_start_ns.is_none() {
            self.reset_to(header.presentation_ns);
        }

        let target_index = self.index_for_ns(header.presentation_ns);
        let expected_index = (self.head_index + self.buffered_per_channel()) as i128;
        let frame_end = target_index + frame_len as i128;

        // Entirely in the past: this audio should already have been heard.
        if frame_end <= self.head_index as i128 {
            self.stats.late_frames += 1;
            return;
        }
        // Entirely inside audio we already hold: a duplicate or a reordered
        // retransmission. Overwriting would be audible for no benefit.
        if frame_end <= expected_index {
            self.stats.duplicate_frames += 1;
            return;
        }
        if self.depth_ns() > self.max_depth_ns() {
            self.stats.overruns += 1;
            return;
        }

        // A gap: conceal it with exactly enough silence that everything after
        // it still lands at the right moment.
        if target_index > expected_index {
            let gap = (target_index - expected_index) as u64;
            self.stats.concealed_samples += gap;
            for _ in 0..gap * self.channels as u64 {
                self.samples.push_back(0.0);
            }
        }

        // A partial overlap: keep only the part that extends the timeline.
        let skip_per_channel = (expected_index - target_index).max(0) as usize;
        let skip = skip_per_channel * self.channels as usize;

        if silent && samples.is_empty() {
            let emit = frame_len.saturating_sub(skip_per_channel) * self.channels as usize;
            for _ in 0..emit {
                self.samples.push_back(0.0);
            }
        } else {
            for sample in samples.iter().skip(skip) {
                self.samples.push_back(*sample);
            }
        }

        if !self.primed && self.depth_ns() >= self.target_depth_ns {
            self.primed = true;
        }
    }

    /// Renders `frames` sample-frames for presentation at `now_ns`.
    ///
    /// Always returns exactly `frames * channels` values: an audio callback
    /// cannot be told "nothing this time".
    pub fn render(&mut self, now_ns: u64, frames: usize) -> Vec<f32> {
        let channels = self.channels.max(1) as usize;
        let mut out = vec![0.0f32; frames * channels];

        if self.stream_start_ns.is_none() {
            return out;
        }
        if !self.primed {
            // Still filling. Silence now costs nothing; starting early
            // guarantees a stutter within milliseconds.
            return out;
        }

        let desired = self.index_for_ns(now_ns);
        let head = self.head_index as i128;

        if desired < head {
            // The stream has not reached its presentation time yet.
            return out;
        }
        let behind_ns = self.samples_per_channel_to_ns((desired - head).max(0) as u64);
        if desired > head && behind_ns > SKIP_THRESHOLD_NS {
            // Genuinely behind: discard the samples whose moment has passed
            // rather than playing them late, which would put this device
            // permanently behind every other one.
            let skip_per_channel = (desired - head) as u64;
            let skip = (skip_per_channel as usize).saturating_mul(channels).min(self.samples.len());
            self.samples.drain(0..skip);
            self.head_index += skip_per_channel;
        }

        let available = self.samples.len().min(frames * channels);
        for (slot, sample) in out.iter_mut().take(available).zip(self.samples.drain(0..available)) {
            *slot = sample;
        }
        self.head_index += (available / channels) as u64;

        if available < frames * channels {
            self.stats.underruns += 1;
            if self.samples.is_empty() {
                // Fully drained: re-prime rather than stuttering frame by
                // frame. The timeline origin is kept, so audio that arrives
                // later still lands at its correct presentation time.
                self.stats.reprimes += 1;
                self.primed = false;
            }
        }

        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::frame::{flags, Format};

    const RATE: u32 = 48_000;
    const CHANNELS: u16 = 2;
    /// 10 ms at 48 kHz.
    const FRAME: u16 = 480;
    const FRAME_NS: u64 = 10_000_000;

    fn header(sequence: u64, presentation_ns: u64, flags: u8) -> FrameHeader {
        FrameHeader {
            flags,
            format: Format::F32Le,
            channels: CHANNELS as u8,
            sample_rate: RATE,
            sequence,
            presentation_ns,
            frame_samples: FRAME,
        }
    }

    /// A frame whose every sample equals `value`, so its arrival is visible.
    fn samples(value: f32) -> Vec<f32> {
        vec![value; FRAME as usize * CHANNELS as usize]
    }

    fn buffer() -> PlayoutBuffer {
        PlayoutBuffer::new(RATE, CHANNELS, LatencyProfile::Live)
    }

    /// Pushes `count` consecutive frames starting at `start_ns`, marking each
    /// with its index so the rendered output can be identified.
    fn push_run(buffer: &mut PlayoutBuffer, start_ns: u64, count: u64) {
        for i in 0..count {
            buffer.push(&header(i, start_ns + i * FRAME_NS, 0), &samples(i as f32 + 1.0));
        }
    }

    #[test]
    fn latency_profiles_match_the_specification() {
        assert_eq!(LatencyProfile::Live.target_depth_ns(), 80_000_000);
        assert_eq!(LatencyProfile::Movie.target_depth_ns(), 200_000_000);
        assert_eq!(LatencyProfile::Music.target_depth_ns(), 400_000_000);
        assert_eq!(LatencyProfile::parse("music"), Some(LatencyProfile::Music));
        assert_eq!(LatencyProfile::parse("nonsense"), None);
    }

    #[test]
    fn renders_silence_until_the_target_depth_is_reached() {
        let mut buffer = buffer();
        push_run(&mut buffer, 1_000_000_000, 4); // 40 ms, target is 80 ms
        assert!(!buffer.primed());
        assert!(buffer.render(1_000_000_000, 128).iter().all(|s| *s == 0.0));

        push_run(&mut buffer, 1_040_000_000, 4); // now 80 ms
        assert!(buffer.primed());
        let rendered = buffer.render(1_000_000_000, 128);
        assert!(rendered.iter().all(|s| *s == 1.0), "primed buffer should render frame 1");
    }

    #[test]
    fn renders_frames_in_order_at_their_presentation_times() {
        let mut buffer = buffer();
        push_run(&mut buffer, 0, 10);
        assert!(buffer.primed());

        // Each 10 ms block should carry its own frame's marker value.
        for i in 0..5u64 {
            let rendered = buffer.render(i * FRAME_NS, FRAME as usize);
            assert!(rendered.iter().all(|s| *s == i as f32 + 1.0), "block {i} rendered {:?}", &rendered[..4]);
        }
        assert_eq!(buffer.stats(), PlayoutStats::default(), "a clean stream should report nothing");
    }

    #[test]
    fn a_lost_frame_becomes_silence_of_exactly_the_right_length() {
        let mut buffer = buffer();
        // Frames 0,1,2 then 4,5,6,7,8,9 — frame 3 never arrives.
        for i in [0u64, 1, 2, 4, 5, 6, 7, 8, 9] {
            buffer.push(&header(i, i * FRAME_NS, 0), &samples(i as f32 + 1.0));
        }
        assert_eq!(buffer.stats().concealed_samples, FRAME as u64);

        for i in 0..3u64 {
            let rendered = buffer.render(i * FRAME_NS, FRAME as usize);
            assert!(rendered.iter().all(|s| *s == i as f32 + 1.0));
        }
        // The gap.
        assert!(buffer.render(3 * FRAME_NS, FRAME as usize).iter().all(|s| *s == 0.0));
        // And crucially, frame 4 still lands in its own slot rather than
        // sliding earlier to fill the hole.
        assert!(buffer.render(4 * FRAME_NS, FRAME as usize).iter().all(|s| *s == 5.0));
    }

    #[test]
    fn duplicate_and_reordered_frames_are_dropped() {
        let mut buffer = buffer();
        push_run(&mut buffer, 0, 10);
        let before = buffer.depth_ns();

        // An exact duplicate of a frame already buffered.
        buffer.push(&header(5, 5 * FRAME_NS, 0), &samples(99.0));
        assert_eq!(buffer.stats().duplicate_frames, 1);
        assert_eq!(buffer.depth_ns(), before, "a duplicate must not extend the buffer");

        // Rendering must still produce the original audio, not the duplicate.
        for i in 0..6u64 {
            let rendered = buffer.render(i * FRAME_NS, FRAME as usize);
            assert!(rendered.iter().all(|s| *s == i as f32 + 1.0), "block {i} was overwritten");
        }
    }

    #[test]
    fn frames_that_arrive_after_their_moment_are_dropped_not_played_late() {
        let mut buffer = buffer();
        push_run(&mut buffer, 0, 10);
        // Play the first five blocks.
        for i in 0..5u64 {
            buffer.render(i * FRAME_NS, FRAME as usize);
        }
        // A retransmission of block 1 turns up far too late.
        buffer.push(&header(1, FRAME_NS, 0), &samples(99.0));
        assert_eq!(buffer.stats().late_frames, 1);

        let rendered = buffer.render(5 * FRAME_NS, FRAME as usize);
        assert!(rendered.iter().all(|s| *s == 6.0), "late audio must not be inserted into the present");
    }

    #[test]
    fn a_receiver_that_falls_behind_skips_forward_rather_than_trailing() {
        let mut buffer = buffer();
        push_run(&mut buffer, 0, 20);
        buffer.render(0, FRAME as usize);

        // The audio callback stalled for 100 ms. The right response is to
        // resume at the present, not to play the backlog.
        let rendered = buffer.render(10 * FRAME_NS, FRAME as usize);
        assert!(rendered.iter().all(|s| *s == 11.0), "expected block 10, got {:?}", &rendered[..4]);
    }

    #[test]
    fn a_millisecond_of_clock_jitter_does_not_discard_audio() {
        // The clock anchor wobbles; reacting to every wobble by dropping audio
        // starves the buffer and is the difference between a stream that holds
        // and one that stutters.
        let mut buffer = buffer();
        push_run(&mut buffer, 0, 20);
        let depth_before = buffer.depth_ns();

        // Render one block, but with "now" 2 ms ahead of the timeline.
        let rendered = buffer.render(2_000_000, FRAME as usize);
        assert!(rendered.iter().all(|s| *s == 1.0), "should still render the block that is due");
        let consumed = depth_before - buffer.depth_ns();
        assert_eq!(consumed, FRAME_NS, "only the rendered block should have been consumed");
    }

    #[test]
    fn rendering_before_the_presentation_time_produces_silence() {
        let mut buffer = buffer();
        push_run(&mut buffer, 5_000_000_000, 10);
        // One second early.
        assert!(buffer.render(4_000_000_000, 128).iter().all(|s| *s == 0.0));
        // At the right moment the audio appears.
        assert!(buffer.render(5_000_000_000, 128).iter().all(|s| *s == 1.0));
    }

    #[test]
    fn running_dry_counts_an_underrun_and_re_primes() {
        let mut buffer = buffer();
        push_run(&mut buffer, 0, 8);
        for i in 0..8u64 {
            buffer.render(i * FRAME_NS, FRAME as usize);
        }
        // Nothing left.
        let rendered = buffer.render(8 * FRAME_NS, FRAME as usize);
        assert!(rendered.iter().all(|s| *s == 0.0));
        assert_eq!(buffer.stats().underruns, 1);
        assert_eq!(buffer.stats().reprimes, 1);
        assert!(!buffer.primed(), "an empty buffer must re-prime rather than stutter");

        // Late audio that arrives after the drought still lands correctly.
        push_run(&mut buffer, 9 * FRAME_NS, 8);
        assert!(buffer.primed());
        assert!(buffer.render(9 * FRAME_NS, FRAME as usize).iter().all(|s| *s == 1.0));
    }

    #[test]
    fn the_buffer_refuses_to_grow_without_limit() {
        let mut buffer = buffer();
        // Nothing is ever rendered, so the buffer only grows: 2 s of frames
        // against an 80 ms target and a 320 ms ceiling.
        push_run(&mut buffer, 0, 200);
        assert!(buffer.overrun_free_depth_is_bounded(), "depth {} ns", buffer.depth_ns());
        assert!(buffer.stats().overruns > 0, "over-deep frames should be counted");
    }

    impl PlayoutBuffer {
        /// Test helper: depth stays within one frame of the ceiling.
        fn overrun_free_depth_is_bounded(&self) -> bool {
            self.depth_ns() <= self.max_depth_ns() + FRAME_NS
        }
    }

    #[test]
    fn a_discontinuity_flag_restarts_the_timeline() {
        let mut buffer = buffer();
        push_run(&mut buffer, 0, 10);
        assert!(buffer.primed());

        // The source restarted somewhere else entirely.
        buffer.push(&header(0, 900_000_000_000, flags::DISCONTINUITY), &samples(42.0));
        assert!(!buffer.primed(), "a restart must re-prime");
        assert_eq!(buffer.depth_ns(), FRAME_NS, "old audio must be discarded");

        push_run(&mut buffer, 900_000_000_000 + FRAME_NS, 8);
        assert!(buffer.render(900_000_000_000, FRAME as usize).iter().all(|s| *s == 42.0));
    }

    #[test]
    fn a_silence_frame_occupies_its_time_without_a_payload() {
        let mut buffer = buffer();
        buffer.push(&header(0, 0, 0), &samples(1.0));
        buffer.push(&header(1, FRAME_NS, flags::SILENCE), &[]);
        buffer.push(&header(2, 2 * FRAME_NS, 0), &samples(3.0));
        push_run(&mut buffer, 3 * FRAME_NS, 8);

        assert!(buffer.render(0, FRAME as usize).iter().all(|s| *s == 1.0));
        assert!(buffer.render(FRAME_NS, FRAME as usize).iter().all(|s| *s == 0.0));
        assert!(buffer.render(2 * FRAME_NS, FRAME as usize).iter().all(|s| *s == 3.0));
    }

    #[test]
    fn a_format_change_is_dropped_rather_than_interleaved() {
        let mut buffer = buffer();
        push_run(&mut buffer, 0, 10);
        let mono = FrameHeader { channels: 1, ..header(10, 10 * FRAME_NS, 0) };
        buffer.push(&mono, &vec![7.0; FRAME as usize]);
        assert_eq!(buffer.stats().duplicate_frames, 1);
    }

    #[test]
    fn render_always_returns_a_full_block() {
        let mut buffer = buffer();
        // Empty, unprimed, primed, and drained all return the requested size.
        assert_eq!(buffer.render(0, 128).len(), 128 * CHANNELS as usize);
        push_run(&mut buffer, 0, 10);
        assert_eq!(buffer.render(0, 128).len(), 128 * CHANNELS as usize);
        assert_eq!(buffer.render(10_000_000_000, 128).len(), 128 * CHANNELS as usize);
    }

    #[test]
    fn timeline_arithmetic_does_not_drift_over_a_long_session() {
        // Half an hour of 10 ms frames. Accumulating nanoseconds per frame
        // would drift; deriving each index from the stream origin does not.
        let mut buffer = buffer();
        let frames = 180_000u64;
        buffer.push(&header(0, 0, 0), &samples(1.0));
        let last_ns = (frames - 1) * FRAME_NS;
        assert_eq!(buffer.index_for_ns(last_ns), (frames - 1) as i128 * FRAME as i128);
    }
}
