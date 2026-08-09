//! Room state: membership, readiness and the authoritative playback timeline.
//!
//! Everything in this module is synchronous and free of I/O so the state
//! machine can be tested directly. Sockets appear only as an outbound channel
//! of already-serialised frames.

use homesync_protocol::{
    BufferReport, CalibrationProgress, CalibrationResult, ClientInfo, ClockQuality, ClockReport, DiagnosticReport,
    Envelope, ErrorMessage, MediaManifest, Payload, Role, RoomSnapshot, SourceMode, StreamInfo, Transport,
    TransportState, YoutubeState,
};
use std::collections::BTreeMap;
use std::sync::Arc;
use tokio::sync::mpsc;

/// Starting assumption for a device's YouTube start latency, in milliseconds.
/// Replaced by measurement as soon as the device reports one.
pub const DEFAULT_YOUTUBE_START_LATENCY_MS: f64 = 300.0;

/// Ceiling on a single observed YouTube start latency, in milliseconds.
pub const MAX_YOUTUBE_START_LATENCY_MS: f64 = 3_000.0;

/// Weight given to each new YouTube start-latency observation.
const YOUTUBE_LATENCY_SMOOTHING: f64 = 0.3;

/// Position error, in milliseconds, past which a YouTube player is corrected.
///
/// `getCurrentTime()` is coarse — a few hundred milliseconds of reporting
/// granularity is normal — so a tight threshold measures the API rather than
/// the playback.
pub const YOUTUBE_RESYNC_THRESHOLD_MS: f64 = 400.0;

/// Consecutive over-threshold reports before a player is corrected. One
/// reading can be a coarse timestamp or a momentary stall; two in a row is a
/// device that is genuinely adrift.
pub const YOUTUBE_RESYNC_CONFIRMATIONS: u32 = 2;

/// Drift past which one report is enough. Beyond a second or so the reading
/// cannot be explained by `getCurrentTime()` granularity, and waiting for
/// confirmation only prolongs playing the wrong part of the video.
pub const YOUTUBE_RESYNC_IMMEDIATE_MS: f64 = 1_500.0;

/// Minimum gap between corrections for the same device.
///
/// Correcting a player pauses, seeks and restarts it, which itself takes it
/// out of position for a second or two. Without a cooldown a device that
/// cannot keep up — a television browser, say — corrects itself continuously
/// and never plays anything.
pub const YOUTUBE_RESYNC_COOLDOWN_NS: u64 = 10_000_000_000;

/// How far ahead a mid-playback correction is scheduled.
///
/// Short, because the device is stopped for this long while it waits: the
/// two-second lead used to start a room from rest would be a visible stall.
/// Long enough that the seek has a chance to complete first.
pub const YOUTUBE_CORRECTION_LEAD_NS: u64 = 500_000_000;

/// One outbound frame on a client's socket.
#[derive(Debug, Clone)]
pub enum OutFrame {
    /// A JSON control frame.
    Text(String),
    /// A binary PCM frame. Held behind an `Arc` because one captured frame is
    /// sent to every receiver, and copying two kilobytes per receiver per
    /// 10 ms is pure waste.
    Binary(Arc<Vec<u8>>),
}

/// Outbound frames for one connection.
pub type ClientSender = mpsc::UnboundedSender<OutFrame>;

/// A connected participant.
#[derive(Debug)]
pub struct Client {
    /// State published to everyone in the room.
    pub info: ClientInfo,
    /// Media id this client has verified and decoded, if any. Kept separately
    /// from `info.ready` so a stale readiness report for previous media can be
    /// recognised and ignored.
    pub ready_media_id: Option<String>,
    /// Outbound channel to this client's socket writer.
    pub tx: ClientSender,
    /// Exponential moving average of this device's YouTube start latency, in
    /// milliseconds. Learned from what the player actually does rather than
    /// assumed (specification section 12.2, step 9).
    pub youtube_start_latency_ms: f64,
    /// Consecutive reports where this player was beyond the drift threshold.
    pub youtube_drift_strikes: u32,
    /// Coordinator time this device was last corrected, if it ever has been.
    /// `None` rather than zero so a device is not held off by the cooldown
    /// merely because the coordinator started recently.
    pub youtube_corrected_ns: Option<u64>,
}

/// One room.
#[derive(Debug)]
pub struct Room {
    /// Six-character display code.
    pub code: String,
    /// Shared secret required to join.
    pub secret: String,
    /// Client id of the owner, which is the first client to join.
    pub owner: Option<String>,
    /// Members, ordered by client id for stable UI ordering.
    pub clients: BTreeMap<String, Client>,
    /// Authoritative timeline.
    pub transport: Transport,
    /// Set when membership or telemetry changed and the room owes everyone a
    /// fresh snapshot. Telemetry arrives once per second per client, so
    /// snapshots are coalesced by a ticker rather than sent per report.
    pub dirty: bool,
    /// Live stream parameters, when one is running.
    pub stream: Option<StreamInfo>,
    /// Calibration progress, when a run is in flight.
    pub calibration: Option<CalibrationProgress>,
    /// The most recent finished calibration, kept so a diagnostics export
    /// carries the measurements rather than only the compensation they
    /// produced.
    pub last_calibration: Option<CalibrationResult>,
    /// Counter for YouTube rendezvous messages, independent of the transport
    /// epoch so a single device can be corrected without telling the whole
    /// room its timeline changed.
    rendezvous_epoch: u64,
    start_lead_ns: u64,
    max_clients: usize,
}

impl Room {
    /// Creates an empty room.
    pub fn new(code: String, secret: String, start_lead_ns: u64, max_clients: usize) -> Self {
        Self {
            code,
            secret,
            owner: None,
            clients: BTreeMap::new(),
            transport: Transport::default(),
            dirty: false,
            stream: None,
            calibration: None,
            last_calibration: None,
            rendezvous_epoch: 0,
            start_lead_ns,
            max_clients,
        }
    }

    /// Adds a client. The first arrival becomes the owner.
    pub fn join(
        &mut self,
        client_id: String,
        device_id: String,
        name: String,
        role: Role,
        tx: ClientSender,
    ) -> Result<(), ErrorMessage> {
        if self.clients.len() >= self.max_clients {
            return Err(ErrorMessage::new("room_full", format!("room is limited to {} clients", self.max_clients)));
        }
        let info = ClientInfo {
            client_id: client_id.clone(),
            device_id,
            name,
            role,
            manual_offset_ms: 0.0,
            acoustic_offset_ms: 0.0,
            volume: 1.0,
            muted: false,
            ready: false,
            microphone_available: false,
            clock: ClockReport::default(),
            diagnostics: None,
            buffer: None,
            youtube: None,
        };
        self.clients.insert(
            client_id.clone(),
            Client {
                info,
                ready_media_id: None,
                tx,
                youtube_start_latency_ms: DEFAULT_YOUTUBE_START_LATENCY_MS,
                youtube_drift_strikes: 0,
                youtube_corrected_ns: None,
            },
        );
        if self.owner.is_none() {
            self.owner = Some(client_id);
        }
        Ok(())
    }

    /// Removes a client. When the owner leaves, ownership passes to whoever
    /// remains so the room never becomes uncontrollable.
    pub fn remove(&mut self, client_id: &str) {
        self.clients.remove(client_id);
        if self.owner.as_deref() == Some(client_id) {
            self.owner = self.clients.keys().next().cloned();
        }
    }

    /// Switches source mode and selects what to play, clearing stale readiness.
    ///
    /// Modes that have nothing to preload go straight to `Ready`: making a
    /// YouTube room wait for a readiness barrier it can never satisfy would
    /// simply prevent playback.
    pub fn select_source(
        &mut self,
        mode: SourceMode,
        media_id: Option<String>,
        youtube_video_id: Option<String>,
        now_ns: u64,
    ) {
        for client in self.clients.values_mut() {
            client.info.ready = false;
            client.ready_media_id = None;
            client.info.youtube = None;
        }
        let selected = match mode {
            SourceMode::Idle => false,
            SourceMode::ControlledAudio => media_id.is_some(),
            SourceMode::Youtube => youtube_video_id.is_some(),
            SourceMode::SystemAudio => true,
        };
        let state = match (selected, mode.requires_preload()) {
            (false, _) => TransportState::Idle,
            (true, true) => TransportState::Loading,
            (true, false) => TransportState::Ready,
        };
        self.transport = Transport {
            epoch: self.transport.epoch + 1,
            state,
            mode,
            media_id,
            youtube_video_id,
            anchor_server_ns: now_ns,
            anchor_media_ns: 0,
        };
    }

    /// Records a receiver's readiness. Reports for anything other than the
    /// currently selected media are ignored, which is what makes a rapid
    /// source change safe.
    pub fn set_ready(&mut self, client_id: &str, media_id: &str) {
        if self.transport.media_id.as_deref() != Some(media_id) {
            return;
        }
        if let Some(client) = self.clients.get_mut(client_id) {
            client.info.ready = true;
            client.ready_media_id = Some(media_id.to_string());
        }
        if self.transport.state == TransportState::Loading && self.all_receivers_ready() {
            self.transport.state = TransportState::Ready;
            self.transport.epoch += 1;
        }
    }

    /// Whether every audio-rendering client has verified the selected media.
    /// A room with no receivers at all is not ready: there would be nothing to
    /// hear, and reporting readiness would be misleading.
    pub fn all_receivers_ready(&self) -> bool {
        let mut receivers = self.clients.values().filter(|c| c.info.role.renders_audio()).peekable();
        if receivers.peek().is_none() {
            return false;
        }
        if !self.transport.mode.requires_preload() {
            return true;
        }
        receivers.all(|c| c.info.ready)
    }

    /// Clients that are not yet safe to start, with the reason.
    fn blockers(&self) -> Vec<String> {
        let mut reasons = Vec::new();
        let receivers: Vec<&Client> = self.clients.values().filter(|c| c.info.role.renders_audio()).collect();
        if receivers.is_empty() {
            reasons.push("no receivers have joined".to_string());
        }
        let needs_media = self.transport.mode.requires_preload();
        for client in receivers {
            if needs_media && !client.info.ready {
                reasons.push(format!("{} has not verified the media", client.info.name));
            } else if client.info.clock.quality != ClockQuality::Stable {
                reasons.push(format!("{} clock is {:?}", client.info.name, client.info.clock.quality));
            }
        }
        reasons
    }

    /// Starts or resumes playback at a coordinator time `start_lead_ns` in the
    /// future, giving every receiver time to translate that instant into its
    /// own audio clock and schedule against it.
    ///
    /// Refuses unless every receiver is ready with a stable clock, unless
    /// `force` is set (spec section 9.4).
    pub fn play(&mut self, now_ns: u64, force: bool) -> Result<(), ErrorMessage> {
        if !self.has_source() {
            return Err(ErrorMessage::new("no_source", "select a source before starting playback"));
        }
        if !self.transport.mode.uses_transport_timeline() {
            return Err(ErrorMessage::new(
                "not_applicable",
                "live system audio has no timeline to start; use stream_start",
            ));
        }
        if self.transport.state == TransportState::Playing {
            return Ok(());
        }
        if !force {
            let blockers = self.blockers();
            if !blockers.is_empty() {
                return Err(ErrorMessage::new("not_ready", blockers.join("; ")));
            }
        }
        // anchor_media_ns already holds the paused position, so resuming needs
        // only a new anchor instant.
        self.transport.anchor_server_ns = now_ns + self.start_lead_ns;
        self.transport.state = TransportState::Playing;
        self.transport.epoch += 1;
        Ok(())
    }

    /// Holds playback at the position reached at `now_ns`.
    pub fn pause(&mut self, now_ns: u64) {
        if self.transport.state != TransportState::Playing {
            return;
        }
        let position = self.transport.position_at(now_ns);
        self.transport.anchor_media_ns = position;
        self.transport.anchor_server_ns = now_ns;
        self.transport.state = TransportState::Paused;
        self.transport.epoch += 1;
    }

    /// Moves to `position_ns`, keeping the current state. Seeking while playing
    /// re-anchors the timeline into the future so receivers restart together
    /// rather than each jumping at its own moment.
    pub fn seek(&mut self, position_ns: u64, now_ns: u64) {
        if !self.has_source() || !self.transport.mode.uses_transport_timeline() {
            return;
        }
        self.transport.anchor_media_ns = position_ns;
        self.transport.anchor_server_ns = match self.transport.state {
            TransportState::Playing => now_ns + self.start_lead_ns,
            _ => now_ns,
        };
        self.transport.epoch += 1;
    }

    /// Stops and rewinds, keeping the media selected and everyone's readiness.
    pub fn stop(&mut self, now_ns: u64) {
        if !self.has_source() {
            return;
        }
        self.transport.state = if self.all_receivers_ready() { TransportState::Ready } else { TransportState::Loading };
        self.transport.anchor_media_ns = 0;
        self.transport.anchor_server_ns = now_ns;
        self.transport.epoch += 1;
    }

    /// Whether a playable source is currently selected.
    pub fn has_source(&self) -> bool {
        match self.transport.mode {
            SourceMode::Idle => false,
            SourceMode::ControlledAudio => self.transport.media_id.is_some(),
            SourceMode::Youtube => self.transport.youtube_video_id.is_some(),
            SourceMode::SystemAudio => true,
        }
    }

    /// Receivers that should render audio, in a stable order.
    pub fn receiver_ids(&self) -> Vec<String> {
        self.clients.values().filter(|c| c.info.role.renders_audio()).map(|c| c.info.client_id.clone()).collect()
    }

    /// Records a client's live-stream buffer health.
    pub fn set_buffer_report(&mut self, client_id: &str, report: BufferReport) {
        if let Some(client) = self.clients.get_mut(client_id) {
            client.info.buffer = Some(report);
        }
    }

    /// Records a client's YouTube player state and folds any newly observed
    /// start latency into that device's moving average.
    pub fn set_youtube_state(&mut self, client_id: &str, state: YoutubeState) {
        let Some(client) = self.clients.get_mut(client_id) else { return };
        if let Some(observed) = state.observed_start_latency_ms {
            // Bounded, because a single pathological measurement — an ad, a
            // stall — must not poison the estimate for the rest of the session.
            let clamped = observed.clamp(0.0, MAX_YOUTUBE_START_LATENCY_MS);
            client.youtube_start_latency_ms = client.youtube_start_latency_ms * (1.0 - YOUTUBE_LATENCY_SMOOTHING)
                + clamped * YOUTUBE_LATENCY_SMOOTHING;
        }
        client.info.youtube = Some(state);
    }

    /// This device's learned YouTube start latency, in milliseconds.
    /// How much earlier than the meeting instant this device should call
    /// `playVideo()`, in milliseconds.
    ///
    /// Its learned player start latency plus the room's compensation for it.
    /// Manual and acoustic compensation mean exactly the same thing here as in
    /// the scheduled-audio path — emit sound this much earlier — and leaving
    /// them out meant the slider did nothing at all in YouTube mode, which is
    /// worse than not offering it.
    pub fn youtube_lead_ms(&self, client_id: &str) -> f64 {
        let Some(client) = self.clients.get(client_id) else { return DEFAULT_YOUTUBE_START_LATENCY_MS };
        client.youtube_start_latency_ms + client.info.manual_offset_ms + client.info.acoustic_offset_ms
    }

    /// A device's YouTube position error against the room timeline, in
    /// milliseconds. `None` unless it is actually playing and has reported a
    /// position — a buffering or paused player is behind by definition and
    /// correcting it would only interrupt it again.
    pub fn youtube_drift_ms(&self, client_id: &str, now_ns: u64) -> Option<f64> {
        let client = self.clients.get(client_id)?;
        let state = client.info.youtube.as_ref()?;
        if state.player_state != "playing" {
            return None;
        }
        let expected_s = self.transport.position_at(now_ns) as f64 / 1e9;
        Some((state.current_time_s - expected_s) * 1000.0)
    }

    /// Whether this device has drifted enough, for long enough, to be worth
    /// interrupting.
    ///
    /// Deliberately conservative. Correcting a player pauses, seeks and
    /// restarts it, so a correction that fires too readily costs more than the
    /// drift it fixes — and a device that cannot keep up would otherwise
    /// restart itself forever.
    pub fn youtube_needs_correction(&mut self, client_id: &str, now_ns: u64) -> bool {
        if self.transport.mode != SourceMode::Youtube || self.transport.state != TransportState::Playing {
            self.reset_youtube_strikes(client_id);
            return false;
        }
        let Some(drift) = self.youtube_drift_ms(client_id, now_ns) else {
            // Buffering is not a clean bill of health — it is the mechanism by
            // which a device falls behind, since YouTube resumes from where it
            // stalled rather than skipping ahead. Leaving the strikes in place
            // means a device that stutters is corrected as soon as it is
            // playing again, instead of never accumulating two consecutive
            // over-threshold reports. Only an explicit pause clears them.
            if self.youtube_player_state(client_id) == Some("paused") {
                self.reset_youtube_strikes(client_id);
            }
            return false;
        };
        let Some(client) = self.clients.get_mut(client_id) else { return false };

        if drift.abs() <= YOUTUBE_RESYNC_THRESHOLD_MS {
            client.youtube_drift_strikes = 0;
            return false;
        }
        client.youtube_drift_strikes += 1;
        // A device seconds out of position is not a coarse timestamp, and
        // waiting for a second report costs another reporting interval of
        // playing the wrong part of the video.
        if drift.abs() < YOUTUBE_RESYNC_IMMEDIATE_MS && client.youtube_drift_strikes < YOUTUBE_RESYNC_CONFIRMATIONS {
            return false;
        }
        // Still adrift but corrected recently: stay armed rather than clearing
        // the strikes, so the correction happens as soon as it is allowed.
        if client.youtube_corrected_ns.is_some_and(|last| now_ns < last + YOUTUBE_RESYNC_COOLDOWN_NS) {
            return false;
        }
        client.youtube_drift_strikes = 0;
        client.youtube_corrected_ns = Some(now_ns);
        true
    }

    /// A device's reported IFrame player state, if it has reported one.
    fn youtube_player_state(&self, client_id: &str) -> Option<&str> {
        Some(self.clients.get(client_id)?.info.youtube.as_ref()?.player_state.as_str())
    }

    fn reset_youtube_strikes(&mut self, client_id: &str) {
        if let Some(client) = self.clients.get_mut(client_id) {
            client.youtube_drift_strikes = 0;
        }
    }

    /// A fresh rendezvous epoch. Separate from the transport epoch because
    /// correcting one device must not look like a room-wide transport change.
    pub fn next_rendezvous_epoch(&mut self) -> u64 {
        self.rendezvous_epoch += 1;
        self.rendezvous_epoch
    }

    /// Sets a device's calibration-derived compensation.
    pub fn set_acoustic_offset_ms(&mut self, client_id: &str, offset_ms: f64) {
        if let Some(client) = self.clients.get_mut(client_id) {
            client.info.acoustic_offset_ms = offset_ms.clamp(-1000.0, 1000.0);
        }
    }

    /// Records a client's published clock estimate.
    pub fn set_clock_report(&mut self, client_id: &str, report: ClockReport) {
        if let Some(client) = self.clients.get_mut(client_id) {
            client.info.clock = report;
        }
    }

    /// Records a client's published telemetry.
    pub fn set_diagnostics(&mut self, client_id: &str, report: DiagnosticReport) {
        if let Some(client) = self.clients.get_mut(client_id) {
            client.info.diagnostics = Some(report);
        }
    }

    /// Full room state for publication.
    pub fn snapshot(&self, media: MediaManifest) -> RoomSnapshot {
        RoomSnapshot {
            room_code: self.code.clone(),
            owner_client_id: self.owner.clone(),
            clients: self.clients.values().map(|c| c.info.clone()).collect(),
            transport: self.transport.clone(),
            media,
            start_lead_ms: self.start_lead_ns as f64 / 1e6,
            stream: self.stream.clone(),
            calibration: self.calibration.clone(),
            supported_modes: vec![SourceMode::ControlledAudio, SourceMode::Youtube, SourceMode::SystemAudio],
        }
    }

    /// Sends one frame to every member. Clients whose writer has gone away are
    /// skipped; the reader task removes them when its socket closes.
    pub fn broadcast(&self, payload: Payload, now_ns: u64) {
        let envelope = Envelope::new(payload).stamped(now_ns);
        let Ok(text) = serde_json::to_string(&envelope) else {
            tracing::error!("failed to serialise broadcast frame");
            return;
        };
        for client in self.clients.values() {
            let _ = client.tx.send(OutFrame::Text(text.clone()));
        }
    }

    /// Sends one frame to a single member.
    pub fn send_to(&self, client_id: &str, payload: Payload, now_ns: u64) {
        let Some(client) = self.clients.get(client_id) else { return };
        let envelope = Envelope::new(payload).stamped(now_ns);
        if let Ok(text) = serde_json::to_string(&envelope) {
            let _ = client.tx.send(OutFrame::Text(text));
        }
    }

    /// Sends one binary PCM frame to every audio-rendering member.
    ///
    /// Controllers are skipped: they render nothing, and sending them
    /// 1.5 Mbit/s of audio they will discard is bandwidth taken from the
    /// devices that need it.
    pub fn broadcast_audio(&self, bytes: Arc<Vec<u8>>) {
        for client in self.clients.values() {
            if client.info.role.renders_audio() {
                let _ = client.tx.send(OutFrame::Binary(Arc::clone(&bytes)));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LEAD: u64 = 2_000_000_000;

    fn stable_clock() -> ClockReport {
        ClockReport { quality: ClockQuality::Stable, samples: 20, ..ClockReport::default() }
    }

    fn room() -> Room {
        Room::new("ABC123".into(), "secret".into(), LEAD, 4)
    }

    fn add(room: &mut Room, id: &str, role: Role) -> mpsc::UnboundedReceiver<OutFrame> {
        let (tx, rx) = mpsc::unbounded_channel();
        room.join(id.into(), format!("dev-{id}"), id.into(), role, tx).expect("join");
        rx
    }

    /// Adds a receiver that has verified `media` and holds a stable clock.
    fn add_ready(room: &mut Room, id: &str, media: &str) -> mpsc::UnboundedReceiver<OutFrame> {
        let rx = add(room, id, Role::Speaker);
        room.set_ready(id, media);
        room.set_clock_report(id, stable_clock());
        rx
    }

    #[test]
    fn first_client_becomes_owner_and_ownership_survives_their_departure() {
        let mut room = room();
        add(&mut room, "a", Role::Controller);
        add(&mut room, "b", Role::Speaker);
        assert_eq!(room.owner.as_deref(), Some("a"));

        room.remove("a");
        assert_eq!(room.owner.as_deref(), Some("b"), "ownership must pass on, not vanish");

        room.remove("b");
        assert_eq!(room.owner, None);
    }

    #[test]
    fn room_capacity_is_enforced() {
        let mut room = Room::new("ABC123".into(), "s".into(), LEAD, 2);
        add(&mut room, "a", Role::Speaker);
        add(&mut room, "b", Role::Speaker);
        let (tx, _rx) = mpsc::unbounded_channel();
        let err = room.join("c".into(), "dev-c".into(), "c".into(), Role::Speaker, tx).unwrap_err();
        assert_eq!(err.code, "room_full");
    }

    #[test]
    fn play_is_refused_until_every_receiver_is_ready() {
        let mut room = room();
        add(&mut room, "ctrl", Role::Controller);
        room.select_source(SourceMode::ControlledAudio, Some("m1".into()), None, 0);

        // No receivers at all: refuse, rather than pretending to be in sync.
        assert_eq!(room.play(0, false).unwrap_err().code, "not_ready");

        add(&mut room, "a", Role::Speaker);
        add(&mut room, "b", Role::Speaker);
        room.set_ready("a", "m1");
        room.set_clock_report("a", stable_clock());
        let err = room.play(0, false).unwrap_err();
        assert_eq!(err.code, "not_ready");
        assert!(err.message.contains('b'), "the blocking device should be named: {}", err.message);

        room.set_ready("b", "m1");
        room.set_clock_report("b", stable_clock());
        assert!(room.play(0, false).is_ok());
        assert_eq!(room.transport.state, TransportState::Playing);
    }

    #[test]
    fn a_warming_up_clock_blocks_play_but_force_overrides_it() {
        let mut room = room();
        room.select_source(SourceMode::ControlledAudio, Some("m1".into()), None, 0);
        add(&mut room, "a", Role::Speaker);
        room.set_ready("a", "m1");
        // Clock left at its default: warming_up.
        assert_eq!(room.play(0, false).unwrap_err().code, "not_ready");
        assert!(room.play(0, true).is_ok(), "force must allow a best-effort start");
    }

    #[test]
    fn play_without_a_source_is_refused_even_with_force() {
        let mut room = room();
        add(&mut room, "a", Role::Speaker);
        assert_eq!(room.play(0, true).unwrap_err().code, "no_source");
    }

    #[test]
    fn playback_starts_in_the_future_by_the_configured_lead() {
        let mut room = room();
        room.select_source(SourceMode::ControlledAudio, Some("m1".into()), None, 0);
        add_ready(&mut room, "a", "m1");

        let now = 5_000_000_000;
        room.play(now, false).expect("play");
        assert_eq!(room.transport.anchor_server_ns, now + LEAD);
        assert_eq!(room.transport.anchor_media_ns, 0);
        // At the anchor the media is still at zero; a second later it is one
        // second in.
        assert_eq!(room.transport.position_at(now + LEAD), 0);
        assert_eq!(room.transport.position_at(now + LEAD + 1_000_000_000), 1_000_000_000);
    }

    #[test]
    fn pause_freezes_the_position_and_resume_continues_from_it() {
        let mut room = room();
        room.select_source(SourceMode::ControlledAudio, Some("m1".into()), None, 0);
        add_ready(&mut room, "a", "m1");
        room.play(0, false).expect("play");

        // Three seconds after the anchor.
        let paused_at = LEAD + 3_000_000_000;
        room.pause(paused_at);
        assert_eq!(room.transport.state, TransportState::Paused);
        assert_eq!(room.transport.anchor_media_ns, 3_000_000_000);
        // Time keeps passing; a paused position must not move.
        assert_eq!(room.transport.position_at(paused_at + 10_000_000_000), 3_000_000_000);

        let resume_at = paused_at + 10_000_000_000;
        room.play(resume_at, false).expect("resume");
        assert_eq!(room.transport.anchor_server_ns, resume_at + LEAD);
        assert_eq!(room.transport.position_at(resume_at + LEAD), 3_000_000_000);
    }

    #[test]
    fn seeking_while_playing_re_anchors_into_the_future() {
        let mut room = room();
        room.select_source(SourceMode::ControlledAudio, Some("m1".into()), None, 0);
        add_ready(&mut room, "a", "m1");
        room.play(0, false).expect("play");

        let now = 10_000_000_000;
        room.seek(30_000_000_000, now);
        assert_eq!(room.transport.state, TransportState::Playing);
        assert_eq!(room.transport.anchor_server_ns, now + LEAD, "receivers need lead time to restart together");
        assert_eq!(room.transport.position_at(now + LEAD), 30_000_000_000);
    }

    #[test]
    fn seeking_while_stopped_moves_the_position_without_starting_playback() {
        let mut room = room();
        room.select_source(SourceMode::ControlledAudio, Some("m1".into()), None, 0);
        add_ready(&mut room, "a", "m1");
        room.seek(7_000_000_000, 100);
        assert_eq!(room.transport.state, TransportState::Ready);
        assert_eq!(room.transport.position_at(999_999_999), 7_000_000_000);
    }

    #[test]
    fn stop_rewinds_but_keeps_the_media_and_readiness() {
        let mut room = room();
        room.select_source(SourceMode::ControlledAudio, Some("m1".into()), None, 0);
        add_ready(&mut room, "a", "m1");
        room.play(0, false).expect("play");
        room.stop(LEAD + 5_000_000_000);

        assert_eq!(room.transport.state, TransportState::Ready);
        assert_eq!(room.transport.anchor_media_ns, 0);
        assert_eq!(room.transport.media_id.as_deref(), Some("m1"));
        assert!(room.clients["a"].info.ready);
    }

    #[test]
    fn changing_source_clears_readiness() {
        let mut room = room();
        room.select_source(SourceMode::ControlledAudio, Some("m1".into()), None, 0);
        add_ready(&mut room, "a", "m1");
        assert_eq!(room.transport.state, TransportState::Ready);

        room.select_source(SourceMode::ControlledAudio, Some("m2".into()), None, 1);
        assert!(!room.clients["a"].info.ready);
        assert_eq!(room.transport.state, TransportState::Loading);
    }

    #[test]
    fn readiness_for_stale_media_is_ignored() {
        let mut room = room();
        add(&mut room, "a", Role::Speaker);
        room.select_source(SourceMode::ControlledAudio, Some("m2".into()), None, 0);
        // A report for the previous selection arrives late.
        room.set_ready("a", "m1");
        assert!(!room.clients["a"].info.ready);
        assert_eq!(room.transport.state, TransportState::Loading);
    }

    #[test]
    fn controllers_do_not_hold_up_the_readiness_barrier() {
        let mut room = room();
        room.select_source(SourceMode::ControlledAudio, Some("m1".into()), None, 0);
        add(&mut room, "ctrl", Role::Controller);
        add_ready(&mut room, "a", "m1");
        assert!(room.all_receivers_ready());
        assert!(room.play(0, false).is_ok());
    }

    #[test]
    fn every_transport_change_bumps_the_epoch() {
        let mut room = room();
        let mut last = room.transport.epoch;
        let mut bumped = |room: &Room, label: &str| {
            assert!(room.transport.epoch > last, "{label} did not bump the epoch");
            last = room.transport.epoch;
        };

        room.select_source(SourceMode::ControlledAudio, Some("m1".into()), None, 0);
        bumped(&room, "select_source");
        add_ready(&mut room, "a", "m1");
        bumped(&room, "readiness barrier");
        room.play(0, false).expect("play");
        bumped(&room, "play");
        room.seek(1_000, 1);
        bumped(&room, "seek");
        room.pause(2);
        bumped(&room, "pause");
        room.stop(3);
        bumped(&room, "stop");
    }

    #[test]
    fn a_second_play_while_already_playing_does_not_restart_the_timeline() {
        let mut room = room();
        room.select_source(SourceMode::ControlledAudio, Some("m1".into()), None, 0);
        add_ready(&mut room, "a", "m1");
        room.play(0, false).expect("play");
        let before = room.transport.clone();
        room.play(5_000_000_000, false).expect("play again");
        assert_eq!(room.transport, before, "a redundant play must not cause an audible restart");
    }

    #[test]
    fn broadcast_reaches_every_member() {
        let mut room = room();
        let mut a = add(&mut room, "a", Role::Speaker);
        let mut b = add(&mut room, "b", Role::Speaker);
        room.broadcast(Payload::Stop, 123);
        let OutFrame::Text(text) = a.try_recv().expect("a receives") else {
            panic!("control frames must be text");
        };
        assert!(text.contains("\"type\":\"stop\""));
        assert!(text.contains("\"sent_server_ns\":123"));
        assert!(b.try_recv().is_ok(), "b receives");
    }

    #[test]
    fn youtube_mode_skips_the_readiness_barrier() {
        // There is nothing for a receiver to preload and hash-verify, so
        // requiring readiness would block playback permanently.
        let mut room = room();
        room.select_source(SourceMode::Youtube, None, Some("dQw4w9WgXcQ".into()), 0);
        assert_eq!(room.transport.state, TransportState::Ready);

        add(&mut room, "a", Role::Speaker);
        room.set_clock_report("a", stable_clock());
        assert!(room.all_receivers_ready());
        assert!(room.play(0, false).is_ok());
    }

    #[test]
    fn youtube_mode_still_requires_a_stable_clock() {
        let mut room = room();
        room.select_source(SourceMode::Youtube, None, Some("dQw4w9WgXcQ".into()), 0);
        add(&mut room, "a", Role::Speaker);
        assert_eq!(room.play(0, false).unwrap_err().code, "not_ready");
    }

    #[test]
    fn live_audio_has_no_timeline_to_start() {
        // Live system audio is driven by per-frame presentation times, so
        // 'play' is meaningless: the stream itself is the transport.
        let mut room = room();
        room.select_source(SourceMode::SystemAudio, None, None, 0);
        add_ready(&mut room, "a", "m1");
        room.set_clock_report("a", stable_clock());
        assert_eq!(room.play(0, false).unwrap_err().code, "not_applicable");
    }

    #[test]
    fn selecting_a_mode_without_a_target_leaves_the_room_idle() {
        let mut room = room();
        room.select_source(SourceMode::Youtube, None, None, 0);
        assert_eq!(room.transport.state, TransportState::Idle);
        assert!(!room.has_source());
        assert_eq!(room.play(0, true).unwrap_err().code, "no_source");
    }

    #[test]
    fn youtube_start_latency_is_learned_and_bounded() {
        let mut room = room();
        add(&mut room, "a", Role::Speaker);
        assert_eq!(room.youtube_lead_ms("a"), DEFAULT_YOUTUBE_START_LATENCY_MS);

        let report = |ms: f64| YoutubeState {
            video_id: "dQw4w9WgXcQ".into(),
            player_state: "playing".into(),
            current_time_s: 1.0,
            duration_s: 100.0,
            buffered_fraction: 1.0,
            ready: true,
            observed_start_latency_ms: Some(ms),
        };

        // Repeated agreeing observations pull the estimate towards them.
        for _ in 0..20 {
            room.set_youtube_state("a", report(120.0));
        }
        assert!((room.youtube_lead_ms("a") - 120.0).abs() < 5.0);

        // A single absurd observation — an ad, a stall — must not poison it.
        room.set_youtube_state("a", report(60_000.0));
        assert!(room.youtube_lead_ms("a") < 1_100.0, "one outlier moved the estimate to {}", room.youtube_lead_ms("a"));
    }

    #[test]
    fn changing_source_clears_stale_youtube_state() {
        let mut room = room();
        add(&mut room, "a", Role::Speaker);
        room.select_source(SourceMode::Youtube, None, Some("dQw4w9WgXcQ".into()), 0);
        room.set_youtube_state("a", YoutubeState { ready: true, ..YoutubeState::default() });
        assert!(room.clients["a"].info.youtube.is_some());

        room.select_source(SourceMode::ControlledAudio, Some("m1".into()), None, 1);
        assert!(room.clients["a"].info.youtube.is_none(), "stale player state must not linger");
    }

    #[test]
    fn acoustic_and_manual_compensation_are_tracked_separately() {
        let mut room = room();
        add(&mut room, "a", Role::Speaker);
        room.clients.get_mut("a").expect("client").info.manual_offset_ms = 15.0;
        room.set_acoustic_offset_ms("a", -140.0);

        let info = &room.clients["a"].info;
        assert_eq!(info.manual_offset_ms, 15.0, "calibration must not overwrite the user's value");
        assert_eq!(info.acoustic_offset_ms, -140.0);
        assert_eq!(info.total_offset_ms(), -125.0);
    }

    #[test]
    fn audio_is_broadcast_only_to_devices_that_render_it() {
        let mut room = room();
        let mut speaker = add(&mut room, "a", Role::Speaker);
        let mut controller = add(&mut room, "ctrl", Role::Controller);

        room.broadcast_audio(Arc::new(vec![1, 2, 3]));

        assert!(matches!(speaker.try_recv(), Ok(OutFrame::Binary(_))));
        assert!(
            controller.try_recv().is_err(),
            "a controller renders nothing and must not be sent 1.5 Mbit/s of audio"
        );
    }

    #[test]
    fn snapshot_reports_the_configured_lead_in_milliseconds() {
        let room = room();
        let snapshot = room.snapshot(MediaManifest::default());
        assert_eq!(snapshot.start_lead_ms, 2000.0);
        assert_eq!(snapshot.room_code, "ABC123");
    }

    /// A YouTube room, playing, with `id` reporting itself `position_s` in.
    fn youtube_room(id: &str) -> Room {
        let mut room = room();
        add(&mut room, id, Role::Speaker);
        room.set_clock_report(id, stable_clock());
        room.select_source(SourceMode::Youtube, None, Some("QpJD4K_PLSI".into()), 0);
        room.play(0, false).expect("youtube play needs no readiness barrier");
        room
    }

    /// Reports `id` as `state`, `offset_s` away from where the room expects it.
    fn report(room: &mut Room, id: &str, state: &str, now_ns: u64, offset_s: f64) {
        let position_s = expected_s(room, now_ns) + offset_s;
        room.set_youtube_state(
            id,
            YoutubeState {
                video_id: "QpJD4K_PLSI".into(),
                player_state: state.into(),
                current_time_s: position_s,
                duration_s: 327.0,
                buffered_fraction: 1.0,
                ready: true,
                observed_start_latency_ms: None,
            },
        );
    }

    /// Position, in seconds, the room expects at `now_ns`.
    fn expected_s(room: &Room, now_ns: u64) -> f64 {
        room.transport.position_at(now_ns) as f64 / 1e9
    }

    #[test]
    fn one_over_threshold_report_is_not_enough_to_interrupt_a_player() {
        let mut room = youtube_room("a");
        let now = LEAD + 5_000_000_000;

        // `getCurrentTime()` is coarse enough that a single bad reading means
        // very little, and a correction costs a pause and a seek.
        report(&mut room, "a", "playing", now, 1.0);
        assert!(!room.youtube_needs_correction("a", now));
        report(&mut room, "a", "playing", now, 1.0);
        assert!(room.youtube_needs_correction("a", now));
    }

    #[test]
    fn a_reading_back_in_position_clears_the_strikes() {
        let mut room = youtube_room("a");
        let now = LEAD + 5_000_000_000;

        report(&mut room, "a", "playing", now, 1.0);
        assert!(!room.youtube_needs_correction("a", now));
        report(&mut room, "a", "playing", now, 0.0);
        assert!(!room.youtube_needs_correction("a", now));
        // Back to a single strike, not the second one.
        report(&mut room, "a", "playing", now, 1.0);
        assert!(!room.youtube_needs_correction("a", now));
    }

    #[test]
    fn a_device_that_cannot_keep_up_is_corrected_at_most_once_per_cooldown() {
        let mut room = youtube_room("a");
        let mut now = LEAD + 5_000_000_000;
        let mut corrections = 0;

        // A television browser that is permanently a second behind: without a
        // cooldown this restarts itself on every report and never plays.
        for _ in 0..200 {
            report(&mut room, "a", "playing", now, -1.0);
            if room.youtube_needs_correction("a", now) {
                corrections += 1;
            }
            now += 1_000_000_000;
        }
        assert!(corrections <= 21, "corrected {corrections} times in 200 seconds");
        assert!(corrections >= 18, "a permanently adrift device should still be corrected: {corrections}");
    }

    #[test]
    fn correcting_a_device_does_not_move_the_room_timeline() {
        let mut room = youtube_room("a");
        add(&mut room, "b", Role::Speaker);
        room.set_clock_report("b", stable_clock());
        let now = LEAD + 5_000_000_000;
        let before = room.transport.clone();

        report(&mut room, "a", "playing", now, 1.0);
        assert!(!room.youtube_needs_correction("a", now));
        report(&mut room, "a", "playing", now, 1.0);
        assert!(room.youtube_needs_correction("a", now));

        // The whole point: one device's trouble must not become everyone's.
        // Moving the anchor here pushed it `start_lead_ns` into the future,
        // which made every device that *was* in position look a full two
        // seconds early — and each of those then asked to be corrected too.
        assert_eq!(room.transport, before, "a correction must leave the timeline alone");
        assert_eq!(expected_s(&room, now), before.position_at(now) as f64 / 1e9);
    }

    #[test]
    fn a_paused_or_buffering_player_is_left_alone() {
        let mut room = youtube_room("a");
        let now = LEAD + 5_000_000_000;

        // Behind by definition, and interrupting it would only set it back.
        for state in ["paused", "buffering", "cued", "unstarted"] {
            report(&mut room, "a", state, now, -5.0);
            assert!(!room.youtube_needs_correction("a", now), "{state} should not be corrected");
            report(&mut room, "a", state, now, -5.0);
            assert!(!room.youtube_needs_correction("a", now), "{state} should not be corrected");
        }
    }

    #[test]
    fn a_stuttering_device_is_corrected_once_it_is_playing_again() {
        let mut room = youtube_room("a");
        let now = LEAD + 5_000_000_000;

        // Buffering is how a device falls behind in the first place: YouTube
        // resumes from where it stalled rather than skipping ahead. Clearing
        // the strikes here meant a device that alternated playing/buffering
        // never accumulated two consecutive over-threshold reports, so it was
        // never corrected and stayed permanently behind.
        report(&mut room, "a", "playing", now, -0.8);
        assert!(!room.youtube_needs_correction("a", now));
        report(&mut room, "a", "buffering", now, -0.9);
        assert!(!room.youtube_needs_correction("a", now));
        report(&mut room, "a", "playing", now, -1.0);
        assert!(room.youtube_needs_correction("a", now), "a stall must not launder the drift away");
    }

    #[test]
    fn pausing_a_device_clears_its_strikes() {
        let mut room = youtube_room("a");
        let now = LEAD + 5_000_000_000;

        report(&mut room, "a", "playing", now, -0.8);
        assert!(!room.youtube_needs_correction("a", now));
        report(&mut room, "a", "paused", now, -0.8);
        assert!(!room.youtube_needs_correction("a", now));
        // Back to a single strike: a deliberate pause is not evidence of drift.
        report(&mut room, "a", "playing", now, -0.8);
        assert!(!room.youtube_needs_correction("a", now));
    }

    #[test]
    fn a_device_seconds_out_of_position_is_corrected_on_the_first_report() {
        let mut room = youtube_room("a");
        let now = LEAD + 5_000_000_000;

        // Two seconds cannot be a coarse timestamp, and waiting for a second
        // report means two more seconds of the wrong part of the video.
        report(&mut room, "a", "playing", now, -2.5);
        assert!(room.youtube_needs_correction("a", now));
    }

    #[test]
    fn rendezvous_epochs_are_distinct_so_a_client_never_ignores_one() {
        let mut room = youtube_room("a");
        let first = room.next_rendezvous_epoch();
        assert!(room.next_rendezvous_epoch() > first);
    }
}
