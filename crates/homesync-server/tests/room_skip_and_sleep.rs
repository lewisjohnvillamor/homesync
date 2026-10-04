//! Skipping tracks and the sleep timer, over the real protocol.
//!
//! Both are the room's rather than a device's, and both are checked here by
//! watching what a *second* device is told. That is the property that matters:
//! a Next button that moved only the phone that pressed it, or a sleep timer
//! that only the phone knew about, would leave the house disagreeing about
//! what is playing and when it stops.
//!
//! What is *not* here is a timer actually firing. That needs the deadline to
//! pass, and waiting a minute of wall clock in the suite to learn something
//! `room.rs` already proves against a fake clock — the pause, the kept
//! position, the cancelled held start — is a minute spent badly. This test
//! covers the wire contract: the command arrives, the deadline reaches every
//! device, and cancelling works.

use futures_util::{SinkExt, StreamExt};
use homesync_protocol::{
    Envelope, Hello, JoinRoom, Payload, Role, RoomSnapshot, SelectSource, Skip, SleepTimer, SourceMode,
    PROTOCOL_VERSION,
};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};

const PORT: u16 = 18163;
const ROOM: &str = "SKIPLS";
const SECRET: &str = "skip-secret";

type Socket = WebSocketStream<MaybeTlsStream<TcpStream>>;

struct Coordinator(std::process::Child);

impl Drop for Coordinator {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

/// Three short WAVs, so the queue has something real to skip through.
fn media() -> (PathBuf, Vec<String>) {
    let mut dir = std::env::temp_dir();
    dir.push(format!("homesync-skip-{}", std::process::id()));
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
            client_version: "skip-test".into(),
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
async fn skipping_moves_the_whole_room_and_the_sleep_timer_reaches_every_device() {
    let (dir, ids) = media();
    let mut state_file = dir.clone();
    state_file.push("state.json");
    let _coordinator = start_coordinator(&dir, &state_file).await;

    let mut controller = join("Phone", Role::Controller).await;
    let mut speaker = join("Kitchen", Role::Speaker).await;

    controller
        .send(frame(Payload::SelectSource(SelectSource {
            mode: SourceMode::ControlledAudio,
            queue: ids.clone(),
            ..Default::default()
        })))
        .await
        .expect("queue");
    snapshot_where(&mut speaker, |s| s.queue.len() == 3).await;

    // One press on the phone, and the speaker is told the room moved — both
    // the queue position and the track on the transport, which have to agree
    // or a device schedules one file against another file's timeline.
    controller.send(frame(Payload::Skip(Skip { delta: 1 }))).await.expect("skip");
    let seen = snapshot_where(&mut speaker, |s| s.queue_index == 1).await;
    assert_eq!(seen.transport.media_id.as_ref(), Some(&ids[1]), "the transport must follow the queue");

    controller.send(frame(Payload::Skip(Skip { delta: 1 }))).await.expect("skip");
    let seen = snapshot_where(&mut speaker, |s| s.queue_index == 2).await;
    assert_eq!(seen.transport.media_id.as_ref(), Some(&ids[2]));

    // Back from the last track, early in it, steps to the previous one.
    controller.send(frame(Payload::Skip(Skip { delta: -1 }))).await.expect("back");
    let seen = snapshot_where(&mut speaker, |s| s.queue_index == 1).await;
    assert_eq!(seen.transport.media_id.as_ref(), Some(&ids[1]));

    // The sleep deadline is broadcast, not kept by the device that set it:
    // somebody arming a timer and taking their phone to bed must not take the
    // timer with them.
    controller.send(frame(Payload::SleepTimer(SleepTimer { minutes: Some(30) }))).await.expect("sleep");
    let seen = snapshot_where(&mut speaker, |s| s.sleep_at_ns.is_some()).await;
    let armed = seen.sleep_at_ns.expect("a deadline");
    assert!(armed > 0, "the deadline should be an instant on the coordinator's clock");

    // Cancelling likewise reaches everyone.
    controller.send(frame(Payload::SleepTimer(SleepTimer { minutes: None }))).await.expect("cancel");
    snapshot_where(&mut speaker, |s| s.sleep_at_ns.is_none()).await;

    // Twelve hours is the cap. A value past it is clamped rather than refused
    // or allowed to overflow the deadline arithmetic.
    controller.send(frame(Payload::SleepTimer(SleepTimer { minutes: Some(u32::MAX) }))).await.expect("huge");
    let seen = snapshot_where(&mut speaker, |s| s.sleep_at_ns.is_some()).await;
    let capped = seen.sleep_at_ns.expect("a deadline");
    assert!(capped > armed, "a capped timer is still longer than thirty minutes");
    assert!(
        capped - armed < 12 * 60 * 60 * 1_000_000_000,
        "and no longer than the twelve-hour cap: {capped} against {armed}"
    );

    let _ = std::fs::remove_dir_all(&dir);
}
