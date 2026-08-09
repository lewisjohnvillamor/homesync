//! Turns capture blocks into evenly spaced, timestamped PCM frames.
//!
//! Capture callbacks arrive at irregular intervals and in whatever size the
//! driver feels like. If each block's presentation time came from the moment
//! it happened to arrive, every receiver would inherit the host's callback
//! jitter. Instead the framer lays frames on a timeline derived from a single
//! anchor and a sample count, so presentation times are exactly evenly spaced
//! whatever the capture layer does.
//!
//! The sound card's clock and the coordinator's clock are not the same clock,
//! so that timeline slowly slides against real time. When it slides far
//! enough, the framer re-anchors and marks the frame as a discontinuity rather
//! than pretending nothing happened.

use crate::frame::{encode, flags, Format, FrameHeader};

/// Frames per PCM frame at 48 kHz: 10 ms (specification section 11.1).
pub const FRAME_SAMPLES: u16 = 480;

/// How far the capture timeline may drift from the intended lead before the
/// framer re-anchors, in nanoseconds.
///
/// Generous enough that ordinary sound-card drift (a few parts per million,
/// so milliseconds per hour) never triggers it, tight enough that a genuine
/// stall is corrected before receivers start dropping frames.
pub const REANCHOR_THRESHOLD_NS: i128 = 120_000_000;

/// One frame ready to send.
#[derive(Debug, Clone, PartialEq)]
pub struct OutgoingFrame {
    /// Frame header.
    pub header: FrameHeader,
    /// Encoded bytes, ready for the wire.
    pub bytes: Vec<u8>,
}

/// Accumulates capture samples and emits fixed-size timestamped frames.
#[derive(Debug)]
pub struct Framer {
    sample_rate: u32,
    channels: u16,
    format: Format,
    frame_samples: u16,
    /// How far ahead of capture time frames are presented. This is the
    /// receiver's buffer depth: the whole budget for network delivery and
    /// playout buffering.
    lead_ns: u64,
    pending: Vec<f32>,
    sequence: u64,
    /// Coordinator time of stream sample zero.
    anchor_ns: u64,
    /// Frames (per channel) emitted since the anchor.
    emitted_frames: u64,
    /// Set when the next frame must be marked as a discontinuity.
    mark_discontinuity: bool,
    reanchor_count: u32,
}

impl Framer {
    /// Creates a framer anchored so the first frame is presented `lead_ns`
    /// after `now_ns`.
    pub fn new(sample_rate: u32, channels: u16, format: Format, lead_ns: u64, now_ns: u64) -> Self {
        Self {
            sample_rate,
            channels,
            format,
            frame_samples: FRAME_SAMPLES,
            lead_ns,
            pending: Vec::new(),
            sequence: 0,
            anchor_ns: now_ns + lead_ns,
            emitted_frames: 0,
            mark_discontinuity: false,
            reanchor_count: 0,
        }
    }

    /// Times the timeline has been re-anchored, for diagnostics.
    pub fn reanchor_count(&self) -> u32 {
        self.reanchor_count
    }

    /// Frames emitted so far.
    pub fn sequence(&self) -> u64 {
        self.sequence
    }

    /// Presentation time of the next frame, derived from the anchor rather
    /// than accumulated, so rounding never drifts over a long session.
    fn next_presentation_ns(&self) -> u64 {
        self.anchor_ns + (self.emitted_frames as u128 * 1_000_000_000 / self.sample_rate as u128) as u64
    }

    /// Accepts interleaved capture samples and returns any complete frames.
    pub fn push(&mut self, samples: &[f32], now_ns: u64) -> Vec<OutgoingFrame> {
        self.pending.extend_from_slice(samples);

        let per_frame = self.frame_samples as usize * self.channels as usize;
        let mut out = Vec::new();

        while self.pending.len() >= per_frame {
            // If the timeline has slid too far from the intended lead — the
            // host stalled, or the sound-card clock has drifted — restart it
            // rather than emitting frames receivers will drop as late.
            let presentation = self.next_presentation_ns();
            let error = presentation as i128 - (now_ns as i128 + self.lead_ns as i128);
            if error.abs() > REANCHOR_THRESHOLD_NS {
                self.anchor_ns = now_ns + self.lead_ns;
                self.emitted_frames = 0;
                self.mark_discontinuity = true;
                self.reanchor_count += 1;
                // Buffered audio belongs to the old timeline; keeping it would
                // put a duplicated fragment at the start of the new one.
                let drop_to = self.pending.len() - per_frame;
                self.pending.drain(0..drop_to);
            }

            let frame: Vec<f32> = self.pending.drain(0..per_frame).collect();
            let mut header = FrameHeader {
                flags: 0,
                format: self.format,
                channels: self.channels as u8,
                sample_rate: self.sample_rate,
                sequence: self.sequence,
                presentation_ns: self.next_presentation_ns(),
                frame_samples: self.frame_samples,
            };
            if self.mark_discontinuity {
                header.flags |= flags::DISCONTINUITY;
                self.mark_discontinuity = false;
            }
            if frame.iter().all(|s| *s == 0.0) {
                header.flags |= flags::SILENCE;
            }

            let payload = match self.format {
                Format::S16Le => crate::frame::f32_to_s16le(&frame),
                Format::F32Le => frame.iter().flat_map(|s| s.to_le_bytes()).collect(),
            };
            // A silence frame carries no payload: it costs one header instead
            // of two kilobytes, and receivers already know what to render.
            let bytes =
                if header.flags & flags::SILENCE != 0 { encode(&header, &[]) } else { encode(&header, &payload) };

            out.push(OutgoingFrame { header, bytes });
            self.sequence += 1;
            self.emitted_frames += self.frame_samples as u64;
        }

        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::frame::decode;

    const RATE: u32 = 48_000;
    const CHANNELS: u16 = 2;
    const LEAD_NS: u64 = 200_000_000;
    const FRAME_NS: u64 = 10_000_000;

    fn framer(now_ns: u64) -> Framer {
        Framer::new(RATE, CHANNELS, Format::S16Le, LEAD_NS, now_ns)
    }

    /// A block of `frames` sample-frames, all set to `value`.
    fn block(frames: usize, value: f32) -> Vec<f32> {
        vec![value; frames * CHANNELS as usize]
    }

    #[test]
    fn emits_nothing_until_a_whole_frame_is_available() {
        let mut framer = framer(0);
        assert!(framer.push(&block(100, 0.5), 0).is_empty());
        assert!(framer.push(&block(300, 0.5), 0).is_empty());
        // 100 + 300 + 80 = 480.
        assert_eq!(framer.push(&block(80, 0.5), 0).len(), 1);
    }

    #[test]
    fn presentation_times_are_exactly_evenly_spaced_despite_jittery_capture() {
        let mut framer = framer(0);
        let mut presentations = Vec::new();
        // Blocks arrive at irregular sizes and irregular times.
        let sizes = [480usize, 960, 240, 240, 1440, 480];
        let mut now = 0u64;
        for (i, size) in sizes.iter().enumerate() {
            now += 7_000_000 + i as u64 * 3_000_000; // deliberately uneven
            for frame in framer.push(&block(*size, 0.5), now) {
                presentations.push(frame.header.presentation_ns);
            }
        }
        assert!(presentations.len() >= 6);
        for pair in presentations.windows(2) {
            assert_eq!(pair[1] - pair[0], FRAME_NS, "spacing must not inherit capture jitter");
        }
        assert_eq!(presentations[0], LEAD_NS, "the first frame is presented one lead ahead");
    }

    #[test]
    fn sequence_numbers_are_contiguous() {
        let mut framer = framer(0);
        let frames = framer.push(&block(4_800, 0.25), 0);
        assert_eq!(frames.len(), 10);
        for (i, frame) in frames.iter().enumerate() {
            assert_eq!(frame.header.sequence, i as u64);
        }
        assert_eq!(framer.sequence(), 10);
    }

    #[test]
    fn frames_decode_to_the_samples_that_went_in() {
        let mut framer = Framer::new(RATE, CHANNELS, Format::S16Le, LEAD_NS, 0);
        let frames = framer.push(&block(480, 0.5), 0);
        let (header, payload) = decode(&frames[0].bytes).expect("decode");
        assert_eq!(header.frame_samples, FRAME_SAMPLES);
        assert_eq!(header.channels, CHANNELS as u8);
        let recovered = crate::frame::s16le_to_f32(payload);
        assert_eq!(recovered.len(), 480 * CHANNELS as usize);
        assert!(recovered.iter().all(|s| (s - 0.5).abs() < 1e-4));
    }

    #[test]
    fn silent_frames_are_flagged_and_carry_no_payload() {
        // Silence is the common case when nothing is playing on the host, and
        // it would otherwise cost 1.5 Mbit/s per receiver to send nothing.
        let mut framer = framer(0);
        let frames = framer.push(&block(480, 0.0), 0);
        let frame = &frames[0];
        assert_eq!(frame.header.flags & flags::SILENCE, flags::SILENCE);
        let (header, payload) = decode(&frame.bytes).expect("decode");
        assert!(payload.is_empty());
        assert_eq!(header.duration_ns(), FRAME_NS, "a silent frame still occupies its time");
    }

    #[test]
    fn ordinary_clock_drift_does_not_trigger_a_re_anchor() {
        // A sound card 50 ppm fast against the coordinator: 3 ms per minute.
        let mut framer = framer(0);
        let mut now = 0u64;
        for _ in 0..600 {
            now += FRAME_NS - 500; // 50 ppm
            framer.push(&block(480, 0.3), now);
        }
        assert_eq!(framer.reanchor_count(), 0, "normal drift must not restart the stream");
    }

    #[test]
    fn a_long_stall_re_anchors_and_marks_a_discontinuity() {
        let mut framer = framer(0);
        framer.push(&block(4_800, 0.3), 0);
        assert_eq!(framer.reanchor_count(), 0);

        // The host froze for two seconds; the buffered audio's presentation
        // times are now far in the past.
        let frames = framer.push(&block(480, 0.3), 2_000_000_000);
        assert_eq!(framer.reanchor_count(), 1);
        let frame = frames.last().expect("a frame");
        assert_eq!(frame.header.flags & flags::DISCONTINUITY, flags::DISCONTINUITY);
        assert_eq!(
            frame.header.presentation_ns,
            2_000_000_000 + LEAD_NS,
            "the new timeline starts one lead ahead of now"
        );
    }

    #[test]
    fn re_anchoring_discards_the_stale_backlog() {
        // Otherwise the new timeline opens with audio from before the stall.
        let mut framer = framer(0);
        framer.push(&block(240, 0.9), 0); // half a frame left pending
        let frames = framer.push(&block(720, 0.1), 5_000_000_000);
        assert_eq!(framer.reanchor_count(), 1);
        let (_, payload) = decode(&frames[0].bytes).expect("decode");
        let samples = crate::frame::s16le_to_f32(payload);
        assert!(samples.iter().all(|s| (s - 0.1).abs() < 1e-3), "stale audio leaked into the restart");
    }

    #[test]
    fn timeline_does_not_drift_over_a_long_session() {
        // Ten minutes of frames, which is long enough for per-frame rounding
        // error to show up if presentation times were accumulated rather than
        // derived from the stream origin.
        let mut framer = framer(0);
        let mut last = None;
        let mut now = 0u64;
        let frames = 60_000u64;
        for _ in 0..frames {
            now += FRAME_NS;
            for frame in framer.push(&block(480, 0.2), now) {
                last = Some(frame.header.presentation_ns);
            }
        }
        let expected = LEAD_NS + (frames - 1) * FRAME_NS;
        assert_eq!(last, Some(expected), "presentation timeline drifted over a long session");
        assert_eq!(framer.reanchor_count(), 0);
    }
}
