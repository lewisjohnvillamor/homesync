//! The control WebSocket.
//!
//! One socket per client carries the whole control protocol: the clock
//! exchange, room state, transport commands and telemetry.

use crate::state::App;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::Response;
use futures_util::{SinkExt, StreamExt};
use homesync_protocol::{
    ClockPong, Envelope, ErrorMessage, Payload, RoomSnapshot, Welcome, MAX_CONTROL_FRAME_BYTES, PROTOCOL_VERSION,
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
    tx: mpsc::UnboundedSender<String>,
}

impl Session {
    /// Sends one frame to this client only.
    fn send(&self, app: &App, payload: Payload, request_id: Option<String>) {
        let envelope = Envelope::new(payload).with_request_id(request_id).stamped(app.now_ns());
        if let Ok(text) = serde_json::to_string(&envelope) {
            let _ = self.tx.send(text);
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
    let (tx, mut rx) = mpsc::unbounded_channel::<String>();

    // A dedicated writer task keeps a slow socket from blocking room updates
    // for everyone else: broadcasts only ever push into an unbounded channel.
    let writer = tokio::spawn(async move {
        while let Some(text) = rx.recv().await {
            if sink.send(Message::Text(text.into())).await.is_err() {
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
            // Binary frames are reserved for live PCM streaming, which this
            // build does not implement.
            Message::Binary(_) => session.error(&app, "unsupported", "binary frames are not accepted", None),
            Message::Ping(_) | Message::Pong(_) => {}
        }
    }

    leave_room(&app, &mut session);
    drop(tx);
    drop(session);
    let _ = writer.await;
}

fn handle_text(app: &App, session: &mut Session, text: &str) {
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
            session.room_code = Some(code.clone());
            tracing::info!(client = %session.client_id, room = %code, role = ?join.role, "client joined");

            let now = app.now_ns();
            let snapshot = room.snapshot(app.media.manifest());
            room.broadcast(Payload::RoomSnapshot(snapshot), now);
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
            let now = app.now_ns();
            let snapshot = room.snapshot(app.media.manifest());
            room.broadcast(Payload::RoomSnapshot(snapshot), now);
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
            room.broadcast(Payload::RoomSnapshot(snapshot), now);
            room.dirty = false;
            None
        }),

        Payload::SelectSource(select) => with_room(app, session, request_id, |app, session, room| {
            if let Some(id) = &select.media_id {
                if !app.media.contains(id) {
                    return Some(ErrorMessage::new("no_such_media", "media id is not in the catalogue"));
                }
            }
            let now = app.now_ns();
            room.select_source(select.media_id, now);
            tracing::info!(client = %session.client_id, media = ?room.transport.media_id, "source selected");
            broadcast_transport_and_snapshot(app, room, now);
            None
        }),

        Payload::Play(command) => with_room(app, session, request_id, |app, _session, room| {
            let now = app.now_ns();
            if let Err(error) = room.play(now, command.force) {
                return Some(error);
            }
            broadcast_transport_and_snapshot(app, room, now);
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
            room.broadcast(Payload::RoomSnapshot(snapshot), now);
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
            room.broadcast(Payload::RoomSnapshot(snapshot), now);
            room.dirty = false;
            None
        }),

        // Server-originated message types are not accepted from clients.
        Payload::Welcome(_)
        | Payload::RoomSnapshot(_)
        | Payload::ClockPong(_)
        | Payload::MediaManifest(_)
        | Payload::Transport(_)
        | Payload::Error(_) => {
            session.error(app, "unexpected_type", "that message type is server-originated", request_id);
        }
    }
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
    room.broadcast(Payload::RoomSnapshot(snapshot), now_ns);
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
    room.broadcast(Payload::RoomSnapshot(snapshot), now);
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
        room.broadcast(Payload::RoomSnapshot(snapshot), now);
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
