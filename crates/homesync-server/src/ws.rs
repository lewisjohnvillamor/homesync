//! The control WebSocket.
//!
//! One socket per client carries the whole control protocol: the clock
//! exchange, room state, transport commands and telemetry.

use crate::room::OutFrame;
use crate::state::App;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::Response;
use futures_util::{SinkExt, StreamExt};
use homesync_audio::LatencyProfile;
use homesync_protocol::{
    ClockPong, Envelope, ErrorMessage, Payload, RoomSnapshot, SourceMode, TransportState, Welcome, YoutubeRendezvous,
    MAX_CONTROL_FRAME_BYTES, PROTOCOL_VERSION,
};
use std::sync::Arc;
use tokio::sync::mpsc;
use ulid::Ulid;

/// Upgrades an HTTP request to the control socket.
pub async fn ws_handler(ws: WebSocketUpgrade, State(app): State<Arc<App>>) -> Response {
    ws.on_upgrade(move |socket| handle_socket(socket, app))
}

/// Per-connection state held by the reader task.
struct Session {
    client_id: String,
    device_id: String,
    room_code: Option<String>,
    tx: mpsc::UnboundedSender<OutFrame>,
}

impl Session {
    /// Sends one frame to this client only.
    fn send(&self, app: &App, payload: Payload, request_id: Option<String>) {
        let envelope = Envelope::new(payload).with_request_id(request_id).stamped(app.now_ns());
        if let Ok(text) = serde_json::to_string(&envelope) {
            let _ = self.tx.send(OutFrame::Text(text));
        }
    }

    /// Sends an error frame. Errors never close the socket: a client that sends
    /// one bad frame usually recovers, and dropping it would cost a full rejoin
    /// and clock re-warm.
    fn error(&self, app: &App, code: &str, message: impl Into<String>, request_id: Option<String>) {
        self.send(app, Payload::Error(ErrorMessage::new(code, message)), request_id);
    }
}

async fn handle_socket(socket: WebSocket, app: Arc<App>) {
    let (mut sink, mut stream) = socket.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<OutFrame>();

    // A dedicated writer task keeps a slow socket from blocking room updates
    // for everyone else: broadcasts only ever push into an unbounded channel.
    let writer = tokio::spawn(async move {
        while let Some(frame) = rx.recv().await {
            let message = match frame {
                OutFrame::Text(text) => Message::Text(text.into()),
                OutFrame::Binary(bytes) => Message::Binary(bytes.as_ref().clone().into()),
            };
            if sink.send(message).await.is_err() {
                break;
            }
        }
        let _ = sink.close().await;
    });

    let mut session = Session {
        client_id: Ulid::new().to_string(),
        device_id: Ulid::new().to_string(),
        room_code: None,
        tx: tx.clone(),
    };

    while let Some(Ok(message)) = stream.next().await {
        match message {
            Message::Text(text) => {
                if text.len() > MAX_CONTROL_FRAME_BYTES {
                    session.error(&app, "frame_too_large", "control frame exceeds the size limit", None);
                    continue;
                }
                handle_text(&app, &mut session, text.as_str());
            }
            Message::Close(_) => break,
            // Binary frames flow coordinator to receiver only. A client has
            // nothing to say that needs them.
            Message::Binary(_) => session.error(&app, "unsupported", "clients may not send binary frames", None),
            Message::Ping(_) | Message::Pong(_) => {}
        }
    }

    leave_room(&app, &mut session);
    drop(tx);
    drop(session);
    let _ = writer.await;
}

fn handle_text(app: &Arc<App>, session: &mut Session, text: &str) {
    // Stamp receipt before any other work so the clock exchange measures the
    // network path rather than this process's parsing time.
    let t1 = app.now_ns();

    let envelope: Envelope = match serde_json::from_str(text) {
        Ok(envelope) => envelope,
        Err(error) => {
            session.error(app, "bad_frame", format!("could not parse control frame: {error}"), None);
            return;
        }
    };
    if envelope.v != PROTOCOL_VERSION {
        session.error(
            app,
            "bad_version",
            format!("this coordinator speaks protocol v{PROTOCOL_VERSION}, client sent v{}", envelope.v),
            envelope.request_id.clone(),
        );
        return;
    }

    let request_id = envelope.request_id.clone();
    match envelope.payload {
        // Answered first and without touching the room lock: an offset estimate
        // is only as good as the symmetry of the path it measures.
        Payload::ClockPing(ping) => {
            let pong = ClockPong { t0: ping.t0, t1, t2: app.now_ns(), seq: ping.seq };
            session.send(app, Payload::ClockPong(pong), request_id);
        }

        Payload::Hello(hello) => {
            if let Some(device_id) = hello.device_id.filter(|d| !d.is_empty() && d.len() <= 64) {
                session.device_id = device_id;
            }
            session.send(
                app,
                Payload::Welcome(Welcome {
                    client_id: session.client_id.clone(),
                    device_id: session.device_id.clone(),
                    protocol_version: PROTOCOL_VERSION,
                    server_version: app.version.to_string(),
                    server_ns: app.now_ns(),
                }),
                request_id,
            );
        }

        Payload::JoinRoom(join) => {
            if session.room_code.is_some() {
                session.error(app, "already_joined", "this connection is already in a room", request_id);
                return;
            }
            let code = join.room_code.trim().to_uppercase();
            let mut rooms = app.rooms();
            let Some(room) = rooms.get_mut(&code) else {
                session.error(app, "no_such_room", "no room with that code", request_id);
                return;
            };
            // Constant-time comparison is unnecessary here: the secret is a
            // 26-character ULID and joins are LAN-local, but a mismatch must
            // reveal nothing beyond "wrong secret".
            if room.secret != join.secret {
                session.error(app, "bad_secret", "room secret is incorrect", request_id);
                return;
            }
            let name = sanitise_name(&join.name, &session.device_id);
            if let Err(error) =
                room.join(session.client_id.clone(), session.device_id.clone(), name, join.role, session.tx.clone())
            {
                session.send(app, Payload::Error(error), request_id);
                return;
            }
            // Restore whatever this device learned last time. Compensation is
            // expensive to obtain — by ear, or by a calibration run with the
            // whole room quiet — so losing it to a restart is not acceptable.
            if let Some(profile) = app.profiles.get(&session.device_id) {
                if let Some(client) = room.clients.get_mut(&session.client_id) {
                    client.info.acoustic_offset_ms = profile.acoustic_offset_ms;
                    // The browser holds its own manual value and will send it;
                    // this is the fallback for a device whose storage was
                    // cleared.
                    if profile.manual_offset_ms != 0.0 {
                        client.info.manual_offset_ms = profile.manual_offset_ms;
                    }
                }
                tracing::info!(
                    device = %session.device_id,
                    acoustic_ms = profile.acoustic_offset_ms,
                    "restored a saved device profile"
                );
            }

            session.room_code = Some(code.clone());
            tracing::info!(client = %session.client_id, room = %code, role = ?join.role, "client joined");

            let now = app.now_ns();
            let snapshot = room.snapshot(app.media.manifest());
            room.broadcast(Payload::RoomSnapshot(Box::new(snapshot)), now);
            room.dirty = false;
        }

        Payload::LeaveRoom => leave_room(app, session),

        Payload::ClientUpdate(update) => with_room(app, session, request_id, |app, session, room| {
            let client = room.clients.get_mut(&session.client_id)?;
            if let Some(name) = update.name {
                client.info.name = sanitise_name(&name, &session.device_id);
            }
            if let Some(role) = update.role {
                client.info.role = role;
            }
            if let Some(offset) = update.manual_offset_ms {
                // Compensation beyond a second is never a real device latency;
                // clamping keeps a slipped slider from making audio vanish.
                client.info.manual_offset_ms = offset.clamp(-1000.0, 1000.0);
            }
            if let Some(volume) = update.volume {
                client.info.volume = volume.clamp(0.0, 1.0);
            }
            if let Some(muted) = update.muted {
                client.info.muted = muted;
            }
            if let Some(available) = update.microphone_available {
                client.info.microphone_available = available;
            }

            let remembered = client.info.clone();
            app.profiles.update(&session.device_id, |profile| {
                profile.name = remembered.name.clone();
                profile.role = remembered.role;
                profile.manual_offset_ms = remembered.manual_offset_ms;
            });

            let now = app.now_ns();
            let snapshot = room.snapshot(app.media.manifest());
            room.broadcast(Payload::RoomSnapshot(Box::new(snapshot)), now);
            room.dirty = false;
            None
        }),

        Payload::ClockReport(report) => with_room(app, session, request_id, |_app, session, room| {
            room.set_clock_report(&session.client_id, report);
            room.dirty = true;
            None
        }),

        Payload::DiagnosticReport(report) => with_room(app, session, request_id, |_app, session, room| {
            room.set_diagnostics(&session.client_id, report);
            room.dirty = true;
            None
        }),

        Payload::ReceiverReady(ready) => with_room(app, session, request_id, |app, session, room| {
            if !ready.hash_verified {
                return Some(ErrorMessage::new(
                    "hash_mismatch",
                    "downloaded media did not match the manifest hash; refusing to mark ready",
                ));
            }
            room.set_ready(&session.client_id, &ready.media_id);
            let now = app.now_ns();
            let snapshot = room.snapshot(app.media.manifest());
            room.broadcast(Payload::RoomSnapshot(Box::new(snapshot)), now);
            room.dirty = false;
            None
        }),

        Payload::SelectSource(select) => {
            let Some(code) = session.room_code.clone() else {
                session.error(app, "not_in_room", "join a room before sending that message", request_id);
                return;
            };
            // Switching source mode always ends any live stream: two sources
            // feeding one room would interleave audio from both.
            app.stop_stream(&code);

            let mut rooms = app.rooms();
            let Some(room) = rooms.get_mut(&code) else { return };
            if let Some(id) = &select.media_id {
                if !app.media.contains(id) {
                    drop(rooms);
                    session.error(app, "no_such_media", "media id is not in the catalogue", request_id);
                    return;
                }
            }
            if select.mode == SourceMode::Youtube {
                match select.youtube_video_id.as_deref().map(valid_video_id) {
                    Some(true) => {}
                    _ => {
                        drop(rooms);
                        session.error(app, "bad_video_id", "that is not a YouTube video id", request_id);
                        return;
                    }
                }
            }
            let now = app.now_ns();
            room.stream = None;
            room.select_source(select.mode, select.media_id, select.youtube_video_id, now);
            tracing::info!(client = %session.client_id, mode = ?select.mode, "source selected");
            broadcast_transport_and_snapshot(app, room, now);
        }

        Payload::Play(command) => with_room(app, session, request_id, |app, _session, room| {
            let now = app.now_ns();
            if let Err(error) = room.play(now, command.force) {
                return Some(error);
            }
            broadcast_transport_and_snapshot(app, room, now);
            send_youtube_rendezvous(app, room, now, None);
            None
        }),

        Payload::Pause => with_room(app, session, request_id, |app, _session, room| {
            let now = app.now_ns();
            room.pause(now);
            broadcast_transport_and_snapshot(app, room, now);
            None
        }),

        Payload::Seek(seek) => with_room(app, session, request_id, |app, _session, room| {
            let now = app.now_ns();
            room.seek(seek.position_ns, now);
            broadcast_transport_and_snapshot(app, room, now);
            send_youtube_rendezvous(app, room, now, None);
            None
        }),

        Payload::Stop => with_room(app, session, request_id, |app, _session, room| {
            let now = app.now_ns();
            room.stop(now);
            broadcast_transport_and_snapshot(app, room, now);
            None
        }),

        Payload::Volume(volume) => with_room(app, session, request_id, |app, session, room| {
            let target = volume.client_id.unwrap_or_else(|| session.client_id.clone());
            if let Some(client) = room.clients.get_mut(&target) {
                client.info.volume = volume.volume.clamp(0.0, 1.0);
            }
            let now = app.now_ns();
            let snapshot = room.snapshot(app.media.manifest());
            room.broadcast(Payload::RoomSnapshot(Box::new(snapshot)), now);
            room.dirty = false;
            None
        }),

        Payload::Mute(mute) => with_room(app, session, request_id, |app, session, room| {
            let target = mute.client_id.unwrap_or_else(|| session.client_id.clone());
            if let Some(client) = room.clients.get_mut(&target) {
                client.info.muted = mute.muted;
            }
            let now = app.now_ns();
            let snapshot = room.snapshot(app.media.manifest());
            room.broadcast(Payload::RoomSnapshot(Box::new(snapshot)), now);
            room.dirty = false;
            None
        }),

        Payload::StreamStart(start) => {
            let Some(code) = session.room_code.clone() else {
                session.error(app, "not_in_room", "join a room before sending that message", request_id);
                return;
            };
            let Some(profile) = LatencyProfile::parse(&start.profile) else {
                session.error(app, "bad_profile", "profile must be live, movie or music", request_id);
                return;
            };

            // Restarting means a fresh epoch, so receivers rebuild their
            // buffers instead of mixing two streams on one timeline.
            app.stop_stream(&code);
            let epoch = {
                let mut rooms = app.rooms();
                let Some(room) = rooms.get_mut(&code) else { return };
                room.transport.epoch += 1;
                room.transport.epoch
            };

            match crate::stream::start(Arc::clone(app), code.clone(), profile, start.synthetic, epoch) {
                Ok(handle) => {
                    let info = handle.info.clone();
                    app.set_stream(&code, handle);
                    let now = app.now_ns();
                    let mut rooms = app.rooms();
                    let Some(room) = rooms.get_mut(&code) else { return };
                    room.stream = Some(info.clone());
                    room.select_source(SourceMode::SystemAudio, None, None, now);
                    room.transport.state = TransportState::Playing;
                    room.broadcast(Payload::StreamInfo(info), now);
                    broadcast_transport_and_snapshot(app, room, now);
                }
                Err(error) => session.error(app, "capture_unavailable", error, request_id),
            }
        }

        Payload::StreamStop => with_room(app, session, request_id, |app, _session, room| {
            let code = room.code.clone();
            app.stop_stream(&code);
            room.stream = None;
            let now = app.now_ns();
            room.select_source(SourceMode::Idle, None, None, now);
            broadcast_transport_and_snapshot(app, room, now);
            None
        }),

        Payload::BufferReport(report) => with_room(app, session, request_id, |_app, session, room| {
            room.set_buffer_report(&session.client_id, report);
            room.dirty = true;
            None
        }),

        Payload::YoutubeState(state) => with_room(app, session, request_id, |app, session, room| {
            room.set_youtube_state(&session.client_id, state);
            room.dirty = true;
            // A player that has drifted beyond what a listener would tolerate
            // gets a fresh rendezvous rather than being left to wander.
            //
            // Only that player, and the room timeline is not touched. Moving
            // the timeline to chase one device restarts every other device and
            // — because the anchor is pushed into the future by the start lead
            // — leaves the ones that were fine looking adrift, which triggers
            // another correction. That feedback loop is what made playback stop
            // every few seconds.
            let now = app.now_ns();
            if room.youtube_needs_correction(&session.client_id, now) {
                let drift = room.youtube_drift_ms(&session.client_id, now).unwrap_or_default();
                tracing::info!(client = %session.client_id, drift_ms = drift, "YouTube drift exceeded; re-converging one device");
                send_youtube_rendezvous(app, room, now, Some(&session.client_id));
            }
            None
        }),

        Payload::CalibrationStart(start) => {
            let Some(code) = session.room_code.clone() else {
                session.error(app, "not_in_room", "join a room before sending that message", request_id);
                return;
            };
            let session_id = Ulid::new().to_string();
            let repetitions = start.repetitions.clamp(3, 15);

            {
                let rooms = app.rooms();
                let Some(room) = rooms.get(&code) else { return };
                if room.calibration.is_some() {
                    drop(rooms);
                    session.error(app, "busy", "a calibration run is already in progress", request_id);
                    return;
                }
                if !room.clients.contains_key(&start.microphone_client_id) {
                    drop(rooms);
                    session.error(app, "no_such_client", "the microphone device is not in the room", request_id);
                    return;
                }
            }

            let (uploads, cancel) = app.calibration.open(&session_id);
            let app_for_run = Arc::clone(app);
            tokio::spawn(crate::calibration::run(
                app_for_run,
                code,
                session_id,
                start.microphone_client_id,
                repetitions,
                uploads,
                cancel,
            ));
        }

        Payload::CalibrationCancel => with_room(app, session, request_id, |app, _session, room| {
            if let Some(progress) = &room.calibration {
                app.calibration.cancel(&progress.session_id);
            }
            None
        }),

        // Server-originated message types are not accepted from clients.
        Payload::Welcome(_)
        | Payload::RoomSnapshot(_)
        | Payload::ClockPong(_)
        | Payload::MediaManifest(_)
        | Payload::Transport(_)
        | Payload::StreamInfo(_)
        | Payload::YoutubeRendezvous(_)
        | Payload::CalibrationPlay(_)
        | Payload::CalibrationRecord(_)
        | Payload::CalibrationProgress(_)
        | Payload::CalibrationResult(_)
        | Payload::Error(_) => {
            session.error(app, "unexpected_type", "that message type is server-originated", request_id);
        }
    }
}

/// Whether a string looks like a YouTube video id.
///
/// Not a security control — the id goes into an iframe the browser fetches
/// from YouTube — but it stops a mistyped URL from being distributed to every
/// device in the room as if it were a video.
fn valid_video_id(id: &str) -> bool {
    id.len() == 11 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Tells receivers where to be, and when, in YouTube mode.
///
/// Each device gets its own learned start latency so it can call
/// `playVideo()` early by however long its player actually takes to begin.
///
/// `only` restricts the rendezvous to a single device, which is how a drifting
/// player is corrected without interrupting the rest of the room.
///
/// The meeting point is the room's own anchor whenever that is still ahead of
/// us — the case when a room has just been told to play — and otherwise a
/// short hop into the future, read off the *unchanged* timeline. Either way
/// the timeline itself is never moved by a rendezvous.
fn send_youtube_rendezvous(app: &App, room: &mut crate::room::Room, now_ns: u64, only: Option<&str>) {
    if room.transport.mode != SourceMode::Youtube || room.transport.state != TransportState::Playing {
        return;
    }
    let Some(video_id) = room.transport.youtube_video_id.clone() else { return };
    let epoch = room.next_rendezvous_epoch();
    let start_server_ns = room.transport.anchor_server_ns.max(now_ns + crate::room::YOUTUBE_CORRECTION_LEAD_NS);
    let target_position_s = room.transport.position_at(start_server_ns) as f64 / 1e9;

    let targets = match only {
        Some(id) => vec![id.to_string()],
        None => room.receiver_ids(),
    };
    for client_id in targets {
        let start_latency_ms = room.youtube_lead_ms(&client_id);
        room.send_to(
            &client_id,
            Payload::YoutubeRendezvous(YoutubeRendezvous {
                epoch,
                video_id: video_id.clone(),
                target_position_s,
                start_server_ns,
                start_latency_ms,
            }),
            now_ns,
        );
    }
    let _ = app;
}

/// Runs `f` against the session's room, reporting an error frame if the client
/// is not in one or if `f` returns a failure.
fn with_room<F>(app: &App, session: &mut Session, request_id: Option<String>, f: F)
where
    F: FnOnce(&App, &Session, &mut crate::room::Room) -> Option<ErrorMessage>,
{
    let Some(code) = session.room_code.clone() else {
        session.error(app, "not_in_room", "join a room before sending that message", request_id);
        return;
    };
    let mut rooms = app.rooms();
    let Some(room) = rooms.get_mut(&code) else {
        session.error(app, "no_such_room", "the room no longer exists", request_id);
        return;
    };
    if let Some(error) = f(app, session, room) {
        drop(rooms);
        session.send(app, Payload::Error(error), request_id);
    }
}

/// Publishes a transport change.
///
/// The dedicated `transport` frame is what receivers schedule against, and it
/// is sent first so a large snapshot cannot delay it. The snapshot follows so
/// the diagnostics view stays consistent with the timeline.
fn broadcast_transport_and_snapshot(app: &App, room: &mut crate::room::Room, now_ns: u64) {
    room.broadcast(Payload::Transport(room.transport.clone()), now_ns);
    let snapshot = room.snapshot(app.media.manifest());
    room.broadcast(Payload::RoomSnapshot(Box::new(snapshot)), now_ns);
    room.dirty = false;
}

fn leave_room(app: &App, session: &mut Session) {
    let Some(code) = session.room_code.take() else { return };
    let mut rooms = app.rooms();
    let Some(room) = rooms.get_mut(&code) else { return };
    room.remove(&session.client_id);
    tracing::info!(client = %session.client_id, room = %code, "client left");
    let now = app.now_ns();
    let snapshot = room.snapshot(app.media.manifest());
    room.broadcast(Payload::RoomSnapshot(Box::new(snapshot)), now);
    room.dirty = false;
}

/// Trims a client-supplied name to something safe to display, falling back to
/// a short form of the device id when the name is empty.
fn sanitise_name(name: &str, device_id: &str) -> String {
    let cleaned: String = name.trim().chars().filter(|c| !c.is_control()).take(48).collect();
    if cleaned.is_empty() {
        let short: String = device_id.chars().rev().take(4).collect();
        format!("Device {short}")
    } else {
        cleaned
    }
}

/// Broadcasts a snapshot to every room whose telemetry changed since the last
/// tick. Called on a timer so per-second reports from many receivers cost one
/// broadcast per room rather than one per report.
pub fn flush_dirty_rooms(app: &App) {
    let now = app.now_ns();
    let manifest = app.media.manifest();
    let mut rooms = app.rooms();
    for room in rooms.values_mut() {
        if !room.dirty || room.clients.is_empty() {
            continue;
        }
        let snapshot: RoomSnapshot = room.snapshot(manifest.clone());
        room.broadcast(Payload::RoomSnapshot(Box::new(snapshot)), now);
        room.dirty = false;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_trimmed_and_control_characters_removed() {
        assert_eq!(sanitise_name("  Kitchen\n ", "dev"), "Kitchen");
        assert_eq!(sanitise_name("a\u{0007}b", "dev"), "ab");
    }

    #[test]
    fn empty_names_fall_back_to_the_device_id() {
        assert_eq!(sanitise_name("   ", "01ABCDEF"), "Device FEDC");
    }

    #[test]
    fn long_names_are_truncated() {
        let name = sanitise_name(&"x".repeat(200), "dev");
        assert_eq!(name.chars().count(), 48);
    }
}
