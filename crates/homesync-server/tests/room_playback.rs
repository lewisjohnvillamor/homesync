//! Room volume, shuffle, repeat and saved playlists, over the real protocol.
//!
//! These four are the room's, not a device's, which is the whole reason they
//! are worth testing here rather than in the client: a room plays one timeline,
//! and two devices disagreeing about the next track — or about how loud the
//! house is — is the failure this project exists to prevent. So every one of
//! them is checked by watching what a *second* device is told.

use futures_util::{SinkExt, StreamExt};
use homesync_protocol::{
    Envelope, Hello, JoinRoom, Payload, PlaybackModes, PlaylistCommand, RepeatMode, Role, RoomSnapshot, RoomVolume,
    SelectSource, SourceMode, PROTOCOL_VERSION,
};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};

const PORT: u16 = 18161;
const ROOM: &str = "QUEUES";
const SECRET: &str = "queue-secret";

type Socket = WebSocketStream<MaybeTlsStream<TcpStream>>;

struct Coordinator(std::process::Child);

impl Drop for Coordinator {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

/// Three short WAVs, so the queue has something real to hold.
fn media() -> (PathBuf, Vec<String>) {
    let mut dir = std::env::temp_dir();
    dir.push(format!("homesync-queue-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("media dir");

    let mut ids = Vec::new();
    for (index, name) in ["one.wav", "two.wav", "three.wav"].iter().enumerate() {
        let samples = 4_000usize;
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&((samples + 36) as u32).to_le_bytes());
        bytes.extend_from_slice(b"WAVEfmt ");
        bytes.extend_from_slice(&16u32.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&2u16.to_le_bytes());
        bytes.extend_from_slice(&48_000u32.to_le_bytes());
        bytes.extend_from_slice(&192_000u32.to_le_bytes());
        bytes.extend_from_slice(&4u16.to_le_bytes());
        bytes.extend_from_slice(&16u16.to_le_bytes());
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&(samples as u32).to_le_bytes());
        // Different bytes per file, so each gets its own content-hash id.
        bytes.resize(44 + samples, index as u8 + 1);

        std::fs::File::create(dir.join(name)).expect("create").write_all(&bytes).expect("write");
        ids.push(homesync_media::sha256_hex(&bytes)[..16].to_string());
    }
    (dir, ids)
}

async fn start_coordinator(media_dir: &Path, state_file: &Path) -> Coordinator {
    let child = std::process::Command::new(env!("CARGO_BIN_EXE_homesync"))
        .args([
            "--bind",
            "127.0.0.1",
            "--port",
            &PORT.to_string(),
            "--room-code",
            ROOM,
            "--room-secret",
            SECRET,
            "--media-dir",
            &media_dir.to_string_lossy(),
            "--state-file",
            &state_file.to_string_lossy(),
            "--mdns",
            "false",
        ])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .expect("failed to start the coordinator");
    let coordinator = Coordinator(child);

    for _ in 0..100 {
        if TcpStream::connect(("127.0.0.1", PORT)).await.is_ok() {
            return coordinator;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    panic!("coordinator never started listening");
}

fn frame(payload: Payload) -> Message {
    let envelope = Envelope { v: PROTOCOL_VERSION, request_id: None, sent_server_ns: None, payload };
    Message::Text(serde_json::to_string(&envelope).expect("serialise").into())
}

async fn join(name: &str, role: Role) -> Socket {
    let (mut socket, _) = connect_async(format!("ws://127.0.0.1:{PORT}/ws")).await.expect("connect");
    socket
        .send(frame(Payload::Hello(Hello {
            client_version: "queue-test".into(),
            user_agent: "test".into(),
            device_id: Some(format!("device-{name}")),
        })))
        .await
        .expect("hello");
    socket
        .send(frame(Payload::JoinRoom(JoinRoom {
            room_code: ROOM.into(),
            secret: SECRET.into(),
            name: name.into(),
            role,
        })))
        .await
        .expect("join");
    socket
}

/// Waits for a snapshot that satisfies `wanted`, ignoring the rest.
///
/// The coordinator sends snapshots for its own reasons — a device joining,
/// telemetry arriving — so waiting for "the next snapshot" would read whichever
/// one happened to be in flight rather than the answer to what was just asked.
async fn snapshot_where(socket: &mut Socket, wanted: impl Fn(&RoomSnapshot) -> bool) -> RoomSnapshot {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
    while let Ok(Some(Ok(message))) = tokio::time::timeout_at(deadline, socket.next()).await {
        if let Message::Text(text) = message {
            if let Ok(envelope) = serde_json::from_str::<Envelope>(&text) {
                if let Payload::RoomSnapshot(snapshot) = envelope.payload {
                    if wanted(&snapshot) {
                        return *snapshot;
                    }
                }
            }
        }
    }
    panic!("no snapshot matched before the deadline");
}

#[tokio::test(flavor = "multi_thread")]
async fn the_room_owns_its_volume_modes_and_playlists() {
    let (dir, ids) = media();
    let mut state_file = dir.clone();
    state_file.push("state.json");
    let coordinator = start_coordinator(&dir, &state_file).await;

    let mut controller = join("Phone", Role::Controller).await;
    let mut speaker = join("Kitchen", Role::Speaker).await;

    // Room volume reaches a device that did not set it. That is the whole
    // point: one control for the house rather than one per device.
    controller.send(frame(Payload::RoomVolume(RoomVolume { volume: 0.4 }))).await.expect("room volume");
    let seen = snapshot_where(&mut speaker, |s| (s.room_volume - 0.4).abs() < 1e-6).await;
    assert!((seen.room_volume - 0.4).abs() < 1e-6);

    // Out-of-range values are clamped rather than trusted: a gain above one
    // would distort every device in the room at once.
    controller.send(frame(Payload::RoomVolume(RoomVolume { volume: 9.0 }))).await.expect("loud");
    let seen = snapshot_where(&mut speaker, |s| s.room_volume > 0.9).await;
    assert_eq!(seen.room_volume, 1.0, "gain above unity should be clamped");

    // Shuffle and repeat likewise belong to the room.
    controller
        .send(frame(Payload::PlaybackModes(PlaybackModes { shuffle: true, repeat: RepeatMode::All })))
        .await
        .expect("modes");
    let seen = snapshot_where(&mut speaker, |s| s.shuffle).await;
    assert_eq!(seen.repeat, RepeatMode::All);

    // Queue three tracks and save them under a name.
    controller
        .send(frame(Payload::SelectSource(SelectSource {
            mode: SourceMode::ControlledAudio,
            queue: ids.clone(),
            ..Default::default()
        })))
        .await
        .expect("queue");
    snapshot_where(&mut speaker, |s| s.queue.len() == 3).await;

    controller.send(frame(Payload::Playlist(PlaylistCommand::Save { name: "Sunday".into() }))).await.expect("save");
    let seen = snapshot_where(&mut speaker, |s| !s.playlists.is_empty()).await;
    assert_eq!(seen.playlists, vec!["Sunday".to_string()]);

    // Clearing and reloading has to bring the same three tracks back, in order.
    controller
        .send(frame(Payload::SelectSource(SelectSource {
            mode: SourceMode::ControlledAudio,
            queue: Vec::new(),
            ..Default::default()
        })))
        .await
        .expect("clear");
    snapshot_where(&mut speaker, |s| s.queue.is_empty()).await;

    controller.send(frame(Payload::Playlist(PlaylistCommand::Load { name: "Sunday".into() }))).await.expect("load");
    let seen = snapshot_where(&mut speaker, |s| s.queue.len() == 3).await;
    assert_eq!(seen.queue, ids, "a loaded playlist should be the queue that was saved");

    // A playlist outlives the coordinator, which is the only thing that makes
    // saving one worth doing.
    drop(coordinator);
    tokio::time::sleep(Duration::from_millis(300)).await;
    let _restarted = start_coordinator(&dir, &state_file).await;
    let mut rejoined = join("Kitchen", Role::Speaker).await;
    let seen = snapshot_where(&mut rejoined, |s| !s.playlists.is_empty()).await;
    assert_eq!(seen.playlists, vec!["Sunday".to_string()], "playlists should survive a restart");

    let _ = std::fs::remove_dir_all(&dir);
}
