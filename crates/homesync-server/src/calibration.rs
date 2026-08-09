//! Acoustic calibration orchestration.
//!
//! One device's microphone listens while every other device emits a coded
//! chirp at a scheduled instant, several times each. The coordinator
//! match-filters each recording, aggregates the repetitions, and solves for
//! per-device compensation.
//!
//! Two properties make the result meaningful:
//!
//! - The chirp is scheduled through exactly the same path as ordinary
//!   playback, compensation included, so what is measured is what a listener
//!   would actually hear.
//! - The microphone's own input latency is a constant across every device it
//!   measures, so it cancels in the alignment — which only ever uses
//!   *differences* between devices. The absolute numbers reported are
//!   therefore inflated by that constant; the differences are not.

use crate::state::App;
use homesync_dsp::{aggregate, estimate_delay, solve_alignment, ChirpSpec, DelayEstimate, DeviceLatency};
use homesync_protocol::{CalibrationMeasurement, CalibrationProgress, CalibrationResult, Payload, Role};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::mpsc;

/// Sample rate chirps are rendered at for playback.
pub const CHIRP_RATE: u32 = 48_000;

/// How far ahead each chirp is scheduled. Long enough for the receiver to
/// fetch the chirp on a first repetition and schedule it comfortably.
const CHIRP_LEAD_NS: u64 = 1_500_000_000;

/// Recording starts this far before the scheduled instant, so a device that
/// emits sound *early* is still captured rather than silently clipped.
const PRE_ROLL_NS: u64 = 250_000_000;

/// Length of each recording window.
const RECORD_DURATION_MS: f64 = 1_200.0;

/// How long to wait for a recording before giving up on that repetition.
const UPLOAD_TIMEOUT: Duration = Duration::from_secs(8);

/// Gap between repetitions, so a room's reverberation has died away before the
/// next chirp is emitted.
const REPETITION_GAP: Duration = Duration::from_millis(400);

/// A recording uploaded by the microphone device.
#[derive(Debug)]
pub struct RecordingUpload {
    /// Calibration run this belongs to.
    pub session_id: String,
    /// Device that was emitting.
    pub target_client_id: String,
    /// Repetition index.
    pub repetition: u32,
    /// Sample rate of the recording.
    pub sample_rate: u32,
    /// The microphone's best estimate, in coordinator time, of when the first
    /// recorded sample entered the microphone.
    pub first_sample_server_ns: u64,
    /// Mono float samples.
    pub samples: Vec<f32>,
}

/// Routes uploads to the run that asked for them, and lets a run be cancelled.
#[derive(Debug, Default)]
pub struct CalibrationRegistry {
    senders: Mutex<HashMap<String, mpsc::UnboundedSender<RecordingUpload>>>,
    cancels: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl CalibrationRegistry {
    /// Registers a run and returns its upload channel and cancel flag.
    pub fn open(&self, session_id: &str) -> (mpsc::UnboundedReceiver<RecordingUpload>, Arc<AtomicBool>) {
        let (tx, rx) = mpsc::unbounded_channel();
        let cancel = Arc::new(AtomicBool::new(false));
        self.senders.lock().unwrap_or_else(|e| e.into_inner()).insert(session_id.to_string(), tx);
        self.cancels.lock().unwrap_or_else(|e| e.into_inner()).insert(session_id.to_string(), Arc::clone(&cancel));
        (rx, cancel)
    }

    /// Delivers an upload. Returns false when no run is expecting it.
    pub fn deliver(&self, upload: RecordingUpload) -> bool {
        let senders = self.senders.lock().unwrap_or_else(|e| e.into_inner());
        match senders.get(&upload.session_id) {
            Some(sender) => sender.send(upload).is_ok(),
            None => false,
        }
    }

    /// Cancels a run.
    pub fn cancel(&self, session_id: &str) {
        if let Some(flag) = self.cancels.lock().unwrap_or_else(|e| e.into_inner()).get(session_id) {
            flag.store(true, Ordering::Relaxed);
        }
    }

    /// Whether a run is currently registered.
    pub fn is_active(&self, session_id: &str) -> bool {
        self.senders.lock().unwrap_or_else(|e| e.into_inner()).contains_key(session_id)
    }

    /// Forgets a finished run.
    pub fn close(&self, session_id: &str) {
        self.senders.lock().unwrap_or_else(|e| e.into_inner()).remove(session_id);
        self.cancels.lock().unwrap_or_else(|e| e.into_inner()).remove(session_id);
    }
}

/// Measures when a chirp arrived, relative to the instant it was scheduled.
///
/// Returns the delay in seconds together with the underlying estimate, or
/// `None` when nothing chirp-like was heard clearly enough to trust.
///
/// The reference is rendered at the *recording's* sample rate rather than
/// resampling the recording: a chirp is a formula, so rendering it at any rate
/// is exact, while resampling would add error to the thing being measured.
pub fn analyse_recording(
    chirp_code: u32,
    sample_rate: u32,
    first_sample_server_ns: u64,
    samples: &[f32],
    scheduled_start_ns: u64,
) -> Option<(f64, DelayEstimate)> {
    if sample_rate == 0 || samples.is_empty() {
        return None;
    }
    let reference = ChirpSpec::for_code(chirp_code, sample_rate).render();
    let estimate = estimate_delay(&reference, samples, sample_rate)?;

    let arrival_ns = first_sample_server_ns as f64 + estimate.delay_seconds * 1e9;
    let delay_seconds = (arrival_ns - scheduled_start_ns as f64) / 1e9;
    Some((delay_seconds, estimate))
}

/// Runs one calibration session to completion.
pub async fn run(
    app: Arc<App>,
    room_code: String,
    session_id: String,
    microphone_client_id: String,
    repetitions: u32,
    mut uploads: mpsc::UnboundedReceiver<RecordingUpload>,
    cancel: Arc<AtomicBool>,
) {
    let targets = collect_targets(&app, &room_code, &microphone_client_id);
    let total = targets.len() as u32 * repetitions;

    if targets.is_empty() {
        finish(
            &app,
            &room_code,
            CalibrationResult {
                session_id: session_id.clone(),
                applied: false,
                measurements: Vec::new(),
                detail: "no receivers to measure; the microphone device cannot measure itself".to_string(),
            },
        );
        app.calibration.close(&session_id);
        return;
    }

    let reporter = Reporter { app: &app, room_code: &room_code, session_id: &session_id, total };
    reporter.say("preparing", None, 0, "starting calibration");

    let mut per_device: Vec<(TargetDevice, Vec<DelayEstimate>, Vec<f64>)> = Vec::new();
    let mut completed = 0u32;

    for (code, target) in targets.iter().enumerate() {
        let chirp_code = code as u32;
        let mut estimates = Vec::new();
        let mut delays = Vec::new();

        for repetition in 0..repetitions {
            if cancel.load(Ordering::Relaxed) {
                reporter.say("cancelled", None, completed, "cancelled");
                finish(
                    &app,
                    &room_code,
                    CalibrationResult {
                        session_id: session_id.clone(),
                        applied: false,
                        measurements: Vec::new(),
                        detail: "calibration cancelled".to_string(),
                    },
                );
                app.calibration.close(&session_id);
                return;
            }

            let start_ns = app.now_ns() + CHIRP_LEAD_NS;
            reporter.say(
                "measuring",
                Some(target.client_id.clone()),
                completed,
                &format!("{}: chirp {} of {}", target.name, repetition + 1, repetitions),
            );

            {
                let rooms = app.rooms();
                let Some(room) = rooms.get(&room_code) else { break };
                room.send_to(
                    &microphone_client_id,
                    Payload::CalibrationRecord(homesync_protocol::CalibrationRecord {
                        session_id: session_id.clone(),
                        target_client_id: target.client_id.clone(),
                        chirp_code,
                        start_server_ns: start_ns.saturating_sub(PRE_ROLL_NS),
                        duration_ms: RECORD_DURATION_MS,
                        repetition,
                    }),
                    app.now_ns(),
                );
                room.send_to(
                    &target.client_id,
                    Payload::CalibrationPlay(homesync_protocol::CalibrationPlay {
                        session_id: session_id.clone(),
                        chirp_code,
                        chirp_url: format!("/api/v1/calibration/chirp/{chirp_code}"),
                        start_server_ns: start_ns,
                        repetition,
                    }),
                    app.now_ns(),
                );
            }

            match tokio::time::timeout(UPLOAD_TIMEOUT, uploads.recv()).await {
                Ok(Some(upload)) => {
                    if upload.target_client_id != target.client_id || upload.repetition != repetition {
                        // A straggler from an earlier device or repetition,
                        // arriving after its timeout. Attributing it to the
                        // current measurement would corrupt the result.
                        tracing::warn!(
                            expected_device = %target.client_id,
                            got_device = %upload.target_client_id,
                            expected_repetition = repetition,
                            got_repetition = upload.repetition,
                            "discarding a stale calibration recording"
                        );
                    } else if let Some((delay, estimate)) = analyse_recording(
                        chirp_code,
                        upload.sample_rate,
                        upload.first_sample_server_ns,
                        &upload.samples,
                        start_ns,
                    ) {
                        estimates.push(estimate);
                        delays.push(delay);
                    } else {
                        tracing::info!(
                            device = %target.name,
                            repetition,
                            "no clear chirp arrival in this recording"
                        );
                    }
                }
                Ok(None) => break,
                Err(_) => tracing::warn!(device = %target.name, repetition, "recording never arrived"),
            }

            completed += 1;
            tokio::time::sleep(REPETITION_GAP).await;
        }

        per_device.push((target.clone(), estimates, delays));
    }

    reporter.say("analysing", None, completed, "solving alignment");
    let result = solve_and_apply(&app, &room_code, &session_id, per_device);
    finish(&app, &room_code, result);
    app.calibration.close(&session_id);
}

/// A device to be measured.
#[derive(Debug, Clone)]
struct TargetDevice {
    client_id: String,
    name: String,
    /// Compensation the device was applying when measured, in seconds.
    compensation_seconds: f64,
    /// Manual part of that compensation, in milliseconds. Preserved so a
    /// calibration run never silently discards a human's adjustment.
    manual_offset_ms: f64,
}

fn collect_targets(app: &App, room_code: &str, microphone_client_id: &str) -> Vec<TargetDevice> {
    let rooms = app.rooms();
    let Some(room) = rooms.get(room_code) else { return Vec::new() };
    room.clients
        .values()
        .filter(|client| client.info.role.renders_audio())
        // A device cannot measure its own output with its own microphone in a
        // way that means anything: it would capture its speaker directly.
        .filter(|client| client.info.client_id != microphone_client_id)
        .filter(|client| client.info.role != Role::Controller)
        .map(|client| TargetDevice {
            client_id: client.info.client_id.clone(),
            name: client.info.name.clone(),
            compensation_seconds: client.info.total_offset_ms() / 1000.0,
            manual_offset_ms: client.info.manual_offset_ms,
        })
        .collect()
}

/// Aggregates, solves and applies. Split out so the policy is one readable
/// function rather than buried in the measurement loop.
fn solve_and_apply(
    app: &App,
    room_code: &str,
    session_id: &str,
    per_device: Vec<(TargetDevice, Vec<DelayEstimate>, Vec<f64>)>,
) -> CalibrationResult {
    let mut latencies = Vec::new();
    let mut partial = Vec::new();

    for (target, estimates, delays) in per_device {
        // Aggregate over the delays relative to the scheduled instant, using
        // the per-recording estimates only for their quality flags.
        let relative: Vec<DelayEstimate> = estimates
            .iter()
            .zip(&delays)
            .map(|(estimate, delay)| DelayEstimate { delay_seconds: *delay, ..*estimate })
            .collect();
        let reflective = relative.iter().any(|e| e.used_earlier_arrival);

        match aggregate(&relative) {
            Some(summary) => {
                latencies.push(DeviceLatency {
                    client_id: target.client_id.clone(),
                    measured_seconds: summary.delay_seconds,
                    current_compensation_seconds: target.compensation_seconds,
                    stable: summary.is_stable(),
                });
                partial.push((target, Some(summary), reflective));
            }
            None => partial.push((target, None, reflective)),
        }
    }

    if latencies.is_empty() {
        return CalibrationResult {
            session_id: session_id.to_string(),
            applied: false,
            measurements: Vec::new(),
            detail: "no device produced enough clear measurements; check the microphone \
                     permission, the volume, and that the phone can hear the speakers"
                .to_string(),
        };
    }

    let alignment = solve_alignment(&latencies);
    let solved: HashMap<&str, &homesync_dsp::Alignment> = alignment.iter().map(|a| (a.client_id.as_str(), a)).collect();

    let mut measurements = Vec::new();
    let mut rooms = app.rooms();

    for (target, summary, reflective) in partial {
        let Some(summary) = summary else {
            measurements.push(CalibrationMeasurement {
                client_id: target.client_id.clone(),
                name: target.name.clone(),
                measured_delay_ms: f64::NAN,
                deviation_ms: f64::NAN,
                accepted: 0,
                rejected: 0,
                intrinsic_latency_ms: f64::NAN,
                applied_compensation_ms: 0.0,
                stable: false,
                reflective_room: reflective,
            });
            continue;
        };
        let Some(solution) = solved.get(target.client_id.as_str()) else { continue };

        // The solved value is the device's *total* compensation. The user's
        // manual adjustment is kept and the acoustic part absorbs the rest.
        let total_ms = solution.compensation_seconds * 1000.0;
        let acoustic_ms = total_ms - target.manual_offset_ms;

        measurements.push(CalibrationMeasurement {
            client_id: target.client_id.clone(),
            name: target.name.clone(),
            measured_delay_ms: summary.delay_seconds * 1000.0,
            deviation_ms: summary.deviation_seconds * 1000.0,
            accepted: summary.accepted as u32,
            rejected: summary.rejected as u32,
            intrinsic_latency_ms: solution.intrinsic_latency_seconds * 1000.0,
            applied_compensation_ms: total_ms,
            stable: summary.is_stable(),
            reflective_room: reflective,
        });

        if let Some(room) = rooms.get_mut(room_code) {
            room.set_acoustic_offset_ms(&target.client_id, acoustic_ms);
        }
    }

    let unstable = measurements.iter().filter(|m| !m.stable).count();
    let detail = if unstable > 0 {
        format!(
            "{unstable} device(s) had unstable output latency; they did not set the room's target \
             and their compensation may not hold"
        )
    } else {
        "compensation applied to every measured device".to_string()
    };

    CalibrationResult { session_id: session_id.to_string(), applied: true, measurements, detail }
}

/// Narrates one calibration run to the room.
///
/// A struct rather than a function with a long tail of arguments: the room,
/// session and total never change during a run, and only the stage does.
struct Reporter<'a> {
    app: &'a App,
    room_code: &'a str,
    session_id: &'a str,
    total: u32,
}

impl Reporter<'_> {
    fn say(&self, stage: &str, client_id: Option<String>, completed: u32, detail: &str) {
        let update = CalibrationProgress {
            session_id: self.session_id.to_string(),
            stage: stage.to_string(),
            client_id,
            completed,
            total: self.total,
            detail: detail.to_string(),
        };
        let now = self.app.now_ns();
        let mut rooms = self.app.rooms();
        let Some(room) = rooms.get_mut(self.room_code) else { return };
        room.calibration = Some(update.clone());
        room.broadcast(Payload::CalibrationProgress(update), now);
    }
}

fn finish(app: &App, room_code: &str, result: CalibrationResult) {
    let now = app.now_ns();
    let manifest = app.media.manifest();
    let mut rooms = app.rooms();
    let Some(room) = rooms.get_mut(room_code) else { return };
    room.calibration = None;
    room.broadcast(Payload::CalibrationResult(result), now);
    let snapshot = room.snapshot(manifest);
    room.broadcast(Payload::RoomSnapshot(Box::new(snapshot)), now);
    room.dirty = false;
}

#[cfg(test)]
mod tests {
    use super::*;

    const RATE: u32 = 48_000;

    /// A recording in which chirp `code` arrives `delay_ms` after the
    /// scheduled instant, with the recording starting `pre_roll_ms` early.
    fn synthetic_recording(code: u32, delay_ms: f64, pre_roll_ms: f64) -> Vec<f32> {
        let chirp = ChirpSpec::for_code(code, RATE).render();
        let mut recording = vec![0.0f32; RATE as usize];
        let offset = (((pre_roll_ms + delay_ms) / 1000.0) * RATE as f64) as usize;
        for (i, sample) in chirp.iter().enumerate() {
            if offset + i < recording.len() {
                recording[offset + i] = sample * 0.4;
            }
        }
        recording
    }

    #[test]
    fn measures_delay_relative_to_the_scheduled_instant() {
        // Scheduled at t = 10 s; recording began 250 ms earlier; the chirp was
        // actually heard 120 ms after the scheduled instant.
        let scheduled = 10_000_000_000u64;
        let first_sample = scheduled - 250_000_000;
        let recording = synthetic_recording(0, 120.0, 250.0);

        let (delay, estimate) = analyse_recording(0, RATE, first_sample, &recording, scheduled).expect("a measurement");
        assert!((delay - 0.120).abs() < 0.002, "measured {delay} s");
        assert!(estimate.peak_to_sidelobe > 4.0);
    }

    #[test]
    fn a_device_that_emits_early_yields_a_negative_delay() {
        // Only detectable because recording starts before the scheduled
        // instant; without the pre-roll this arrival would be clipped away.
        let scheduled = 10_000_000_000u64;
        let first_sample = scheduled - 250_000_000;
        let recording = synthetic_recording(0, -80.0, 250.0);

        let (delay, _) = analyse_recording(0, RATE, first_sample, &recording, scheduled).expect("a measurement");
        assert!((delay + 0.080).abs() < 0.002, "measured {delay} s");
    }

    #[test]
    fn works_at_a_microphone_rate_that_differs_from_the_chirp_rate() {
        // Phones commonly record at 44.1 kHz whatever the coordinator uses.
        let rate = 44_100u32;
        let chirp = ChirpSpec::for_code(1, rate).render();
        let mut recording = vec![0.0f32; rate as usize];
        let offset = (0.3 * rate as f64) as usize;
        for (i, sample) in chirp.iter().enumerate() {
            recording[offset + i] = sample * 0.5;
        }
        let scheduled = 5_000_000_000u64;
        let first_sample = scheduled - 100_000_000;

        let (delay, _) = analyse_recording(1, rate, first_sample, &recording, scheduled).expect("a measurement");
        // Arrival is 300 ms into a recording that began 100 ms early.
        assert!((delay - 0.200).abs() < 0.002, "measured {delay} s");
    }

    #[test]
    fn silence_and_nonsense_produce_no_measurement() {
        let scheduled = 1_000_000_000u64;
        assert!(analyse_recording(0, RATE, 0, &[], scheduled).is_none());
        assert!(analyse_recording(0, 0, 0, &[0.1, 0.2], scheduled).is_none());
        assert!(analyse_recording(0, RATE, 0, &vec![0.0; RATE as usize], scheduled).is_none());
    }

    #[test]
    fn a_recording_of_the_wrong_chirp_is_not_mistaken_for_an_arrival() {
        let scheduled = 10_000_000_000u64;
        let recording = synthetic_recording(0, 120.0, 250.0);
        // Looking for code 1 (the opposite sweep) in a recording of code 0.
        match analyse_recording(1, RATE, scheduled - 250_000_000, &recording, scheduled) {
            None => {}
            Some((_, estimate)) => {
                let (_, real) =
                    analyse_recording(0, RATE, scheduled - 250_000_000, &recording, scheduled).expect("the real one");
                assert!(estimate.peak_to_sidelobe < real.peak_to_sidelobe / 2.0, "a foreign chirp scored too well");
            }
        }
    }

    #[test]
    fn the_registry_routes_uploads_and_ignores_unknown_sessions() {
        let registry = CalibrationRegistry::default();
        let (mut rx, cancel) = registry.open("session-1");
        assert!(registry.is_active("session-1"));

        assert!(registry.deliver(RecordingUpload {
            session_id: "session-1".into(),
            target_client_id: "c1".into(),
            repetition: 0,
            sample_rate: RATE,
            first_sample_server_ns: 0,
            samples: vec![0.0; 10],
        }));
        assert!(rx.try_recv().is_ok());

        // An upload for a run that has finished must not panic or be queued.
        assert!(!registry.deliver(RecordingUpload {
            session_id: "session-unknown".into(),
            target_client_id: "c1".into(),
            repetition: 0,
            sample_rate: RATE,
            first_sample_server_ns: 0,
            samples: vec![0.0; 10],
        }));

        assert!(!cancel.load(Ordering::Relaxed));
        registry.cancel("session-1");
        assert!(cancel.load(Ordering::Relaxed));

        registry.close("session-1");
        assert!(!registry.is_active("session-1"));
    }
}
