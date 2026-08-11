//! System-audio capture.
//!
//! Capture is behind a trait with two implementations:
//!
//! - [`SyntheticCapture`], available everywhere, generates a known test signal.
//!   It exists so the entire live-streaming path — framing, distribution,
//!   buffering, playout — can be exercised end to end on any machine, and so a
//!   user can verify their room works before trusting it with real audio.
//! - [`wasapi::LoopbackCapture`], Windows only, captures the default render
//!   endpoint through WASAPI loopback (specification section 11.1).
//!
//! **The WASAPI backend has never been run.** It is written against `cpal` and
//! type-checked for `x86_64-pc-windows-msvc`, which catches API misuse but
//! proves nothing about device enumeration, format negotiation or timing on
//! real hardware. Treat it as unverified until someone runs it on Windows.

use std::time::{Duration, Instant};

/// Audio format produced by a capture source.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CaptureFormat {
    /// Samples per second, per channel.
    pub sample_rate: u32,
    /// Channel count.
    pub channels: u16,
}

impl CaptureFormat {
    /// The format the coordinator normalises to.
    pub fn standard() -> Self {
        Self { sample_rate: 48_000, channels: 2 }
    }
}

/// A source of system audio.
pub trait CaptureSource: Send {
    /// Format of the samples this source produces.
    fn format(&self) -> CaptureFormat;

    /// Blocks until the next block of interleaved samples is available.
    ///
    /// Returns `None` once the source has stopped. Implementations should
    /// return blocks close to `block_frames`, but callers must not assume it.
    fn next_block(&mut self) -> Option<Vec<f32>>;

    /// Stops capture and releases the device.
    fn stop(&mut self) {}

    /// Blocks the source had to discard because the consumer fell behind.
    ///
    /// Reported rather than merely counted: a capture backend that silently
    /// drops audio when the network stalls looks exactly like one that is
    /// working, and the difference only shows up as a gap somebody hears.
    /// Sources that cannot drop anything return zero.
    fn dropped_blocks(&self) -> u64 {
        0
    }
}

/// How long a capture backend may deliver nothing before it is treated as
/// stopped rather than slow.
///
/// A render endpoint that has produced no callback for this long has been
/// taken away — the device changed, another application claimed it in
/// exclusive mode, or the session was torn down. None of those recover on
/// their own, and blocking forever on one turns a stoppable stream into a
/// thread that cannot be stopped at all.
pub const CAPTURE_STALL_TIMEOUT: Duration = Duration::from_secs(2);

/// Frames per block at the standard rate: 10 ms, per specification 11.1.
pub const DEFAULT_BLOCK_FRAMES: usize = 480;

/// A capture source that synthesises a known signal.
///
/// The signal is a quiet two-tone chord with a short click at the top of each
/// second. The click matters: it makes misalignment audible between two
/// receivers exactly as the built-in click track does, so live mode can be
/// judged by ear and not only by counters.
#[derive(Debug)]
pub struct SyntheticCapture {
    format: CaptureFormat,
    block_frames: usize,
    phase: u64,
    /// Emitted blocks are paced to real time so the stream behaves like a
    /// sound card rather than producing an hour of audio instantly.
    paced: bool,
    /// When the next block is due. Pacing against a deadline rather than
    /// sleeping a fixed interval per block matters: a fixed sleep plus the
    /// cost of generating each block runs *slower* than real time, so the
    /// stream would fall a little further behind every block until the framer
    /// gave up and re-anchored.
    next_block_at: Option<Instant>,
    stopped: bool,
}

impl SyntheticCapture {
    /// Creates a synthetic source at the standard format.
    pub fn new() -> Self {
        Self {
            format: CaptureFormat::standard(),
            block_frames: DEFAULT_BLOCK_FRAMES,
            phase: 0,
            paced: true,
            next_block_at: None,
            stopped: false,
        }
    }

    /// Disables real-time pacing, for tests that want blocks immediately.
    pub fn unpaced(mut self) -> Self {
        self.paced = false;
        self
    }

    /// Total frames generated so far.
    pub fn frames_generated(&self) -> u64 {
        self.phase
    }
}

impl Default for SyntheticCapture {
    fn default() -> Self {
        Self::new()
    }
}

impl CaptureSource for SyntheticCapture {
    fn format(&self) -> CaptureFormat {
        self.format
    }

    fn next_block(&mut self) -> Option<Vec<f32>> {
        if self.stopped {
            return None;
        }
        if self.paced {
            let block_duration =
                Duration::from_nanos(self.block_frames as u64 * 1_000_000_000 / self.format.sample_rate as u64);
            let now = Instant::now();
            let due = self.next_block_at.unwrap_or(now);
            if due > now {
                std::thread::sleep(due - now);
            }
            // If we have fallen more than a block behind — the machine was
            // busy — resume from now rather than sprinting through a backlog.
            let next = if now.saturating_duration_since(due) > block_duration { now } else { due };
            self.next_block_at = Some(next + block_duration);
        }

        let rate = self.format.sample_rate as f64;
        let channels = self.format.channels as usize;
        let mut block = Vec::with_capacity(self.block_frames * channels);

        for i in 0..self.block_frames {
            let index = self.phase + i as u64;
            let t = index as f64 / rate;
            let chord =
                (t * 220.0 * std::f64::consts::TAU).sin() * 0.12 + (t * 330.0 * std::f64::consts::TAU).sin() * 0.08;

            // A 20 ms decaying click on each second boundary.
            let into_second = index % self.format.sample_rate as u64;
            let click = if into_second < self.format.sample_rate as u64 / 50 {
                let ct = into_second as f64 / rate;
                (ct * 1_500.0 * std::f64::consts::TAU).sin() * (-ct * 300.0).exp() * 0.5
            } else {
                0.0
            };

            let sample = (chord + click) as f32;
            for _ in 0..channels {
                block.push(sample);
            }
        }
        self.phase += self.block_frames as u64;
        Some(block)
    }

    fn stop(&mut self) {
        self.stopped = true;
    }
}

#[cfg(windows)]
pub mod wasapi {
    //! WASAPI loopback capture.
    //!
    //! Unverified: compile-checked for Windows but never executed. See the
    //! module documentation above.

    use super::{CaptureFormat, CaptureSource, CAPTURE_STALL_TIMEOUT};
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    use std::sync::mpsc::{sync_channel, Receiver, RecvTimeoutError, SyncSender, TrySendError};

    /// Blocks buffered between the capture callback and the sender. The
    /// callback must never block, so the channel is bounded and overflow is
    /// dropped: losing a block is recoverable, stalling the audio engine is
    /// not.
    const CHANNEL_BLOCKS: usize = 64;

    /// Captures the default Windows render endpoint through WASAPI loopback.
    pub struct LoopbackCapture {
        format: CaptureFormat,
        receiver: Receiver<Vec<f32>>,
        /// Held to keep the device alive; dropping it stops capture.
        stream: Option<cpal::Stream>,
        /// Blocks the callback had to discard because the channel was full.
        dropped: std::sync::Arc<std::sync::atomic::AtomicU64>,
    }

    impl LoopbackCapture {
        /// Opens loopback capture on the default output device.
        pub fn new() -> Result<Self, String> {
            let host = cpal::default_host();
            let device = host.default_output_device().ok_or("no default output device")?;
            // On WASAPI, building an input stream on an *output* device is
            // what selects loopback mode.
            let config =
                device.default_output_config().map_err(|error| format!("no default output config: {error}"))?;
            let format = CaptureFormat { sample_rate: config.sample_rate().0, channels: config.channels() };

            let (sender, receiver) = sync_channel::<Vec<f32>>(CHANNEL_BLOCKS);
            let dropped = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));

            let stream = match config.sample_format() {
                cpal::SampleFormat::F32 => Self::build::<f32>(&device, &config.into(), sender, dropped.clone()),
                cpal::SampleFormat::I16 => Self::build::<i16>(&device, &config.into(), sender, dropped.clone()),
                cpal::SampleFormat::U16 => Self::build::<u16>(&device, &config.into(), sender, dropped.clone()),
                other => Err(format!("unsupported sample format {other:?}")),
            }?;
            stream.play().map_err(|error| format!("could not start capture: {error}"))?;

            Ok(Self { format, receiver, stream: Some(stream), dropped })
        }

        fn build<T>(
            device: &cpal::Device,
            config: &cpal::StreamConfig,
            sender: SyncSender<Vec<f32>>,
            dropped: std::sync::Arc<std::sync::atomic::AtomicU64>,
        ) -> Result<cpal::Stream, String>
        where
            T: cpal::SizedSample + cpal::FromSample<f32> + Send + 'static,
            f32: cpal::FromSample<T>,
        {
            device
                .build_input_stream(
                    config,
                    move |data: &[T], _: &cpal::InputCallbackInfo| {
                        let block: Vec<f32> = data.iter().map(|sample| cpal::Sample::from_sample(*sample)).collect();
                        if let Err(TrySendError::Full(_)) = sender.try_send(block) {
                            dropped.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                        }
                    },
                    move |error| tracing::error!(%error, "WASAPI capture error"),
                    None,
                )
                .map_err(|error| format!("could not open loopback stream: {error}"))
        }
    }

    impl CaptureSource for LoopbackCapture {
        fn format(&self) -> CaptureFormat {
            self.format
        }

        fn next_block(&mut self) -> Option<Vec<f32>> {
            match self.receiver.recv_timeout(CAPTURE_STALL_TIMEOUT) {
                Ok(block) => Some(block),
                // The device stopped producing. Ending the stream with a
                // reason in the log is the whole point: a bare `recv()` here
                // parks this thread forever, and because the consuming loop
                // only checks its stop flag between blocks, the stream then
                // cannot be stopped by anything short of killing the process.
                Err(RecvTimeoutError::Timeout) => {
                    tracing::warn!(
                        seconds = CAPTURE_STALL_TIMEOUT.as_secs(),
                        "WASAPI loopback delivered nothing; treating the endpoint as gone"
                    );
                    None
                }
                // The stream was dropped by `stop`, which is the ordinary end.
                Err(RecvTimeoutError::Disconnected) => None,
            }
        }

        fn stop(&mut self) {
            self.stream = None;
        }

        fn dropped_blocks(&self) -> u64 {
            self.dropped.load(std::sync::atomic::Ordering::Relaxed)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn synthetic_capture_produces_the_standard_format() {
        let capture = SyntheticCapture::new().unpaced();
        assert_eq!(capture.format(), CaptureFormat::standard());
    }

    #[test]
    fn synthetic_blocks_are_the_right_size_and_in_range() {
        let mut capture = SyntheticCapture::new().unpaced();
        for _ in 0..10 {
            let block = capture.next_block().expect("block");
            assert_eq!(block.len(), DEFAULT_BLOCK_FRAMES * 2);
            assert!(block.iter().all(|s| s.is_finite() && s.abs() <= 1.0), "sample out of range");
        }
        assert_eq!(capture.frames_generated(), 10 * DEFAULT_BLOCK_FRAMES as u64);
    }

    #[test]
    fn synthetic_capture_is_continuous_across_block_boundaries() {
        // A discontinuity at the seam would be an audible buzz at the block
        // rate, and would make the source useless for judging alignment.
        let mut capture = SyntheticCapture::new().unpaced();
        let first = capture.next_block().expect("first");
        let second = capture.next_block().expect("second");
        let step_inside = (first[first.len() - 2] - first[first.len() - 4]).abs();
        let step_across = (second[0] - first[first.len() - 2]).abs();
        assert!(step_across <= step_inside * 4.0 + 1e-4, "seam jump {step_across} against in-block step {step_inside}");
    }

    #[test]
    fn synthetic_capture_contains_the_per_second_click() {
        let mut capture = SyntheticCapture::new().unpaced();
        let mut peak_first_block = 0.0f32;
        for sample in capture.next_block().expect("block") {
            peak_first_block = peak_first_block.max(sample.abs());
        }
        // The click at t=0 is much louder than the chord alone.
        assert!(peak_first_block > 0.35, "no click at the second boundary: peak {peak_first_block}");

        // A block from the middle of the second is the quiet chord only.
        for _ in 0..50 {
            capture.next_block();
        }
        let quiet = capture.next_block().expect("block");
        let peak_quiet = quiet.iter().fold(0.0f32, |a, s| a.max(s.abs()));
        assert!(peak_quiet < 0.25, "unexpected transient mid-second: {peak_quiet}");
    }

    #[test]
    fn a_source_that_cannot_drop_anything_reports_none() {
        // The default exists so the streaming loop can log this number without
        // knowing which backend it has. A synthetic source hands its blocks
        // over directly and has nothing to discard.
        let capture = SyntheticCapture::new().unpaced();
        assert_eq!(capture.dropped_blocks(), 0);
    }

    #[test]
    fn the_stall_timeout_outlasts_an_ordinary_block() {
        // It has to be far longer than the ~10 ms between callbacks, or a
        // scheduling hiccup would be reported as a device that has gone away.
        // It also has to be short enough that a stopped stream does not hold
        // its thread for an uncomfortable time.
        let block = Duration::from_millis(10);
        assert!(CAPTURE_STALL_TIMEOUT > block * 20, "too eager: {CAPTURE_STALL_TIMEOUT:?}");
        assert!(CAPTURE_STALL_TIMEOUT <= Duration::from_secs(5), "too patient: {CAPTURE_STALL_TIMEOUT:?}");
    }

    #[test]
    fn paced_capture_keeps_up_with_real_time() {
        // A source that runs slower than real time makes every receiver's
        // buffer drain until the stream re-anchors, which is audible.
        let mut capture = SyntheticCapture::new();
        let blocks = 40; // 400 ms of audio
        let start = std::time::Instant::now();
        for _ in 0..blocks {
            capture.next_block().expect("block");
        }
        let elapsed = start.elapsed();
        let expected = Duration::from_millis(400);
        assert!(elapsed >= expected.mul_f64(0.85), "produced audio far too fast: {elapsed:?}");
        assert!(
            elapsed <= expected.mul_f64(1.30),
            "capture drifted behind real time: {elapsed:?} for {expected:?} of audio"
        );
    }

    #[test]
    fn a_stopped_source_yields_nothing_further() {
        let mut capture = SyntheticCapture::new().unpaced();
        assert!(capture.next_block().is_some());
        capture.stop();
        assert!(capture.next_block().is_none());
    }
}
