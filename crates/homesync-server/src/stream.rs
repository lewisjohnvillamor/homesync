//! Live system-audio streaming (source mode C).
//!
//! A capture source feeds a [`Framer`], which lays the samples on an evenly
//! spaced presentation timeline; each frame is broadcast as one binary
//! WebSocket message to every receiver in the room. Receivers buffer to their
//! profile depth and render each frame at its presentation time.
//!
//! What this mode does *not* do is control the video that produced the audio.
//! A receiver is deliberately hundreds of milliseconds behind the host's own
//! speakers, so anything watched on the host will lead the room.

use crate::state::App;
use homesync_audio::capture::{CaptureSource, SyntheticCapture};
use homesync_audio::{Format, Framer, LatencyProfile};
use homesync_protocol::StreamInfo;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

/// Extra lead beyond the receiver's target buffer depth, to cover control-path
/// delivery on a busy Wi-Fi network.
const NETWORK_LEAD_NS: u64 = 60_000_000;

/// A running capture-and-distribute loop.
#[derive(Debug)]
pub struct StreamHandle {
    stop: Arc<AtomicBool>,
    /// Parameters published to receivers.
    pub info: StreamInfo,
}

impl StreamHandle {
    /// Signals the capture loop to finish.
    pub fn stop(&self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

/// Starts capturing and distributing system audio for one room.
///
/// `synthetic` selects the built-in test signal, which works on every
/// platform. Real capture is WASAPI loopback and therefore Windows-only; on
/// other platforms this returns an error rather than pretending.
pub fn start(
    app: Arc<App>,
    room_code: String,
    profile: LatencyProfile,
    synthetic: bool,
    epoch: u64,
) -> Result<StreamHandle, String> {
    let (source, description): (Box<dyn CaptureSource>, String) = if synthetic {
        (Box::new(SyntheticCapture::new()), "built-in synthetic test signal".to_string())
    } else {
        real_capture()?
    };

    let format = source.format();
    if format.channels == 0 || format.sample_rate == 0 {
        return Err("capture source reported an impossible format".to_string());
    }

    let info = StreamInfo {
        epoch,
        sample_rate: format.sample_rate,
        channels: format.channels,
        format: "s16le".to_string(),
        profile: profile.as_str().to_string(),
        target_depth_ms: profile.target_depth_ns() as f64 / 1e6,
        synthetic,
        source_description: description,
    };

    let stop = Arc::new(AtomicBool::new(false));
    let handle = StreamHandle { stop: Arc::clone(&stop), info: info.clone() };
    let lead_ns = profile.target_depth_ns() + NETWORK_LEAD_NS;

    // Capture blocks, so it gets a dedicated blocking thread. Broadcasting is
    // just a push into per-client unbounded channels, which never blocks, so
    // the capture loop can do it directly.
    tokio::task::spawn_blocking(move || {
        let mut source = source;
        let mut framer = Framer::new(format.sample_rate, format.channels, Format::S16Le, lead_ns, app.now_ns());
        tracing::info!(room = %room_code, ?profile, synthetic, "live stream started");

        while !stop.load(Ordering::Relaxed) {
            let Some(block) = source.next_block() else { break };
            let now = app.now_ns();
            for frame in framer.push(&block, now) {
                let bytes = Arc::new(frame.bytes);
                let rooms = app.rooms();
                let Some(room) = rooms.get(&room_code) else { break };
                room.broadcast_audio(bytes);
            }
        }

        source.stop();
        tracing::info!(
            room = %room_code,
            frames = framer.sequence(),
            reanchors = framer.reanchor_count(),
            "live stream stopped"
        );
    });

    Ok(handle)
}

#[cfg(windows)]
fn real_capture() -> Result<(Box<dyn CaptureSource>, String), String> {
    use homesync_audio::capture::wasapi::LoopbackCapture;
    let capture = LoopbackCapture::new()?;
    Ok((Box::new(capture), "Windows system audio (WASAPI loopback)".to_string()))
}

#[cfg(not(windows))]
fn real_capture() -> Result<(Box<dyn CaptureSource>, String), String> {
    Err("system-audio capture is implemented for Windows only; use the synthetic source \
         to exercise live mode on this platform"
        .to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn non_windows_hosts_say_so_instead_of_failing_obscurely() {
        // The message a Linux or macOS user sees has to point at the way
        // forward, not just report an absence.
        #[cfg(not(windows))]
        {
            let error = match real_capture() {
                Err(error) => error,
                Ok(_) => panic!("capture should be unavailable off Windows"),
            };
            assert!(error.contains("Windows"), "{error}");
            assert!(error.contains("synthetic"), "the message should offer the alternative: {error}");
        }
    }

    #[test]
    fn network_lead_is_added_on_top_of_the_profile_depth() {
        // The receiver's buffer target is its own; the extra lead is the
        // delivery budget. Conflating them would leave no slack for Wi-Fi.
        let lead = LatencyProfile::Music.target_depth_ns() + NETWORK_LEAD_NS;
        assert!(lead > LatencyProfile::Music.target_depth_ns());
        assert_eq!(lead, 460_000_000);
    }
}
