//! Room state: membership, readiness and the authoritative playback timeline.
//!
//! Everything in this module is synchronous and free of I/O so the state
//! machine can be tested directly. Sockets appear only as an outbound channel
//! of already-serialised frames.

use homesync_protocol::{
    ClientInfo, ClockQuality, ClockReport, DiagnosticReport, Envelope, ErrorMessage, MediaManifest, Payload, Role,
    RoomSnapshot, Transport, TransportState,
};
use std::collections::BTreeMap;
use tokio::sync::mpsc;

/// Outbound frames for one connection.
pub type ClientSender = mpsc::UnboundedSender<String>;

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
            volume: 1.0,
            muted: false,
            ready: false,
            clock: ClockReport::default(),
            diagnostics: None,
        };
        self.clients.insert(client_id.clone(), Client { info, ready_media_id: None, tx });
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

    /// Selects the media everyone should preload, clearing stale readiness.
    pub fn select_source(&mut self, media_id: Option<String>, now_ns: u64) {
        for client in self.clients.values_mut() {
            client.info.ready = false;
            client.ready_media_id = None;
        }
        self.transport = Transport {
            epoch: self.transport.epoch + 1,
            state: if media_id.is_some() { TransportState::Loading } else { TransportState::Idle },
            media_id,
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
        receivers.peek().is_some() && receivers.all(|c| c.info.ready)
    }

    /// Clients that are not yet safe to start, with the reason.
    fn blockers(&self) -> Vec<String> {
        let mut reasons = Vec::new();
        let receivers: Vec<&Client> = self.clients.values().filter(|c| c.info.role.renders_audio()).collect();
        if receivers.is_empty() {
            reasons.push("no receivers have joined".to_string());
        }
        for client in receivers {
            if !client.info.ready {
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
        if self.transport.media_id.is_none() {
            return Err(ErrorMessage::new("no_source", "select media before starting playback"));
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
        if self.transport.media_id.is_none() {
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
        if self.transport.media_id.is_none() {
            return;
        }
        self.transport.state = if self.all_receivers_ready() { TransportState::Ready } else { TransportState::Loading };
        self.transport.anchor_media_ns = 0;
        self.transport.anchor_server_ns = now_ns;
        self.transport.epoch += 1;
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
            let _ = client.tx.send(text.clone());
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

    fn add(room: &mut Room, id: &str, role: Role) -> mpsc::UnboundedReceiver<String> {
        let (tx, rx) = mpsc::unbounded_channel();
        room.join(id.into(), format!("dev-{id}"), id.into(), role, tx).expect("join");
        rx
    }

    /// Adds a receiver that has verified `media` and holds a stable clock.
    fn add_ready(room: &mut Room, id: &str, media: &str) -> mpsc::UnboundedReceiver<String> {
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
        room.select_source(Some("m1".into()), 0);

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
        room.select_source(Some("m1".into()), 0);
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
        room.select_source(Some("m1".into()), 0);
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
        room.select_source(Some("m1".into()), 0);
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
        room.select_source(Some("m1".into()), 0);
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
        room.select_source(Some("m1".into()), 0);
        add_ready(&mut room, "a", "m1");
        room.seek(7_000_000_000, 100);
        assert_eq!(room.transport.state, TransportState::Ready);
        assert_eq!(room.transport.position_at(999_999_999), 7_000_000_000);
    }

    #[test]
    fn stop_rewinds_but_keeps_the_media_and_readiness() {
        let mut room = room();
        room.select_source(Some("m1".into()), 0);
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
        room.select_source(Some("m1".into()), 0);
        add_ready(&mut room, "a", "m1");
        assert_eq!(room.transport.state, TransportState::Ready);

        room.select_source(Some("m2".into()), 1);
        assert!(!room.clients["a"].info.ready);
        assert_eq!(room.transport.state, TransportState::Loading);
    }

    #[test]
    fn readiness_for_stale_media_is_ignored() {
        let mut room = room();
        add(&mut room, "a", Role::Speaker);
        room.select_source(Some("m2".into()), 0);
        // A report for the previous selection arrives late.
        room.set_ready("a", "m1");
        assert!(!room.clients["a"].info.ready);
        assert_eq!(room.transport.state, TransportState::Loading);
    }

    #[test]
    fn controllers_do_not_hold_up_the_readiness_barrier() {
        let mut room = room();
        room.select_source(Some("m1".into()), 0);
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

        room.select_source(Some("m1".into()), 0);
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
        room.select_source(Some("m1".into()), 0);
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
        let text = a.try_recv().expect("a receives");
        assert!(text.contains("\"type\":\"stop\""));
        assert!(text.contains("\"sent_server_ns\":123"));
        assert!(b.try_recv().is_ok(), "b receives");
    }

    #[test]
    fn snapshot_reports_the_configured_lead_in_milliseconds() {
        let room = room();
        let snapshot = room.snapshot(MediaManifest::default());
        assert_eq!(snapshot.start_lead_ms, 2000.0);
        assert_eq!(snapshot.room_code, "ABC123");
    }
}
