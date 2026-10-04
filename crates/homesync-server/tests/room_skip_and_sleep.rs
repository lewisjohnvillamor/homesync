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
    ClockQuality, ClockReport, Envelope, Hello, JoinRoom, Payload, PlayCommand, PlaybackModes, ReceiverReady,
    RepeatMode, Role, RoomSnapshot, SelectSource, Skip, SleepTimer, SourceMode, Transport, TransportState,
    PROTOCOL_VERSION,
};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};

/// A port per test. These run in parallel in one binary, so a shared port
/// means the second coordinator cannot bind and both tests fail together.
const PORT_SKIP: u16 = 18163;
const PORT_RESTART: u16 = 18164;
const PORT_GAPLESS: u16 = 18165;
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
///
/// `tag` keeps each test's library its own: two tests sharing a directory
/// means the one that finishes first deletes the other's files.
fn media(tag: &str) -> (PathBuf, Vec<String>) {
    let mut dir = std::env::temp_dir();
    dir.push(format!("homesync-skip-{tag}-{}", std::process::id()));
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

async fn start_coordinator(port: u16, media_dir: &Path, state_file: &Path) -> Coordinator {
    let child = std::process::Command::new(env!("CARGO_BIN_EXE_homesync"))
        .args([
            "--bind",
            "127.0.0.1",
            "--port",
            &port.to_string(),
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
        if TcpStream::connect(("127.0.0.1", port)).await.is_ok() {
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

async fn join(port: u16, name: &str, role: Role) -> Socket {
    let (mut socket, _) = connect_async(format!("ws://127.0.0.1:{port}/ws")).await.expect("connect");
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
    let (dir, ids) = media("skip");
    let mut state_file = dir.clone();
    state_file.push("state.json");
    let _coordinator = start_coordinator(PORT_SKIP, &dir, &state_file).await;

    let mut controller = join(PORT_SKIP, "Phone", Role::Controller).await;
    let mut speaker = join(PORT_SKIP, "Kitchen", Role::Speaker).await;

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

/// The queue comes back after the coordinator is restarted.
///
/// A room used to remember only its code, secret and name, so a restart left
/// every device looking at an empty queue — the one thing that makes a restart
/// feel like data loss rather than a restart. Saving the queue as a *playlist*
/// was the only way to keep it, which is a thing to remember to do.
#[tokio::test(flavor = "multi_thread")]
async fn a_rooms_queue_survives_a_restart() {
    let (dir, ids) = media("restart");
    let mut state_file = dir.clone();
    state_file.push("queue-state.json");
    let coordinator = start_coordinator(PORT_RESTART, &dir, &state_file).await;

    let mut controller = join(PORT_RESTART, "Phone", Role::Controller).await;
    controller
        .send(frame(Payload::SelectSource(SelectSource {
            mode: SourceMode::ControlledAudio,
            queue: ids.clone(),
            ..Default::default()
        })))
        .await
        .expect("queue");
    snapshot_where(&mut controller, |s| s.queue.len() == 3).await;

    // Move off the first track, so what comes back has to be the position as
    // well as the list.
    controller.send(frame(Payload::Skip(Skip { delta: 1 }))).await.expect("skip");
    snapshot_where(&mut controller, |s| s.queue_index == 1).await;

    controller
        .send(frame(Payload::PlaybackModes(PlaybackModes { shuffle: false, repeat: RepeatMode::All })))
        .await
        .expect("modes");
    snapshot_where(&mut controller, |s| s.repeat == RepeatMode::All).await;

    // A different process, reading the same state file.
    drop(coordinator);
    tokio::time::sleep(Duration::from_millis(300)).await;
    let _restarted = start_coordinator(PORT_RESTART, &dir, &state_file).await;

    let mut rejoined = join(PORT_RESTART, "Phone", Role::Controller).await;
    let seen = snapshot_where(&mut rejoined, |s| !s.queue.is_empty()).await;
    assert_eq!(seen.queue, ids, "the queue should come back in the order it was left");
    assert_eq!(seen.queue_index, 1, "and on the track it had reached");
    assert_eq!(seen.repeat, RepeatMode::All, "with the modes it was set to");
    assert_eq!(seen.transport.media_id.as_ref(), Some(&ids[1]), "so Play resumes the right track");
    // Paused, not playing. Nobody asked for the house to start up again.
    assert_ne!(seen.transport.state, TransportState::Playing);

    let _ = std::fs::remove_dir_all(&dir);
}

/// Waits for a transport message that satisfies `wanted`.
async fn transport_where(socket: &mut Socket, wanted: impl Fn(&Transport) -> bool) -> Transport {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
    while let Ok(Some(Ok(message))) = tokio::time::timeout_at(deadline, socket.next()).await {
        if let Message::Text(text) = message {
            if let Ok(envelope) = serde_json::from_str::<Envelope>(&text) {
                if let Payload::Transport(transport) = envelope.payload {
                    if wanted(&transport) {
                        return transport;
                    }
                }
            }
        }
    }
    panic!("no transport matched before the deadline");
}

/// Three WAVs of `seconds` each — long enough, unlike `media`'s, for the tick
/// that advances the queue to land inside the handover window before the end.
fn long_media(tag: &str, seconds: u32) -> (PathBuf, Vec<String>, u64) {
    let mut dir = std::env::temp_dir();
    dir.push(format!("homesync-skip-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("media dir");

    let frames = 48_000 * seconds as usize;
    let data_len = frames * 4;
    let mut ids = Vec::new();
    for (index, name) in ["one.wav", "two.wav", "three.wav"].iter().enumerate() {
        let mut bytes = Vec::with_capacity(44 + data_len);
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&((data_len + 36) as u32).to_le_bytes());
        bytes.extend_from_slice(b"WAVEfmt ");
        bytes.extend_from_slice(&16u32.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&2u16.to_le_bytes());
        bytes.extend_from_slice(&48_000u32.to_le_bytes());
        bytes.extend_from_slice(&192_000u32.to_le_bytes());
        bytes.extend_from_slice(&4u16.to_le_bytes());
        bytes.extend_from_slice(&16u16.to_le_bytes());
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&(data_len as u32).to_le_bytes());
        bytes.resize(44 + data_len, index as u8 + 1);
        std::fs::File::create(dir.join(name)).expect("create").write_all(&bytes).expect("write");
        ids.push(homesync_media::sha256_hex(&bytes)[..16].to_string());
    }
    (dir, ids, u64::from(seconds) * 1_000_000_000)
}

fn ready(media_id: &str, duration_ns: u64) -> Message {
    frame(Payload::ReceiverReady(ReceiverReady {
        media_id: media_id.into(),
        hash_verified: true,
        duration_ns,
        sample_rate: 48_000,
        audio_context_state: "running".into(),
        output_latency_ms: 0.0,
    }))
}

/// A track change with the next track preloaded leaves no gap.
///
/// The coordinator used to advance on the first tick after a track ended and
/// schedule the next a full start lead later — two to two and a half seconds
/// of silence between every pair of tracks. With every receiver holding the
/// next track decoded, it is now anchored at the instant the current one runs
/// out. This asserts that exactly: the next anchor is the previous anchor plus
/// the previous track's length, to the nanosecond.
#[tokio::test(flavor = "multi_thread")]
async fn a_track_change_with_the_next_track_preloaded_leaves_no_gap() {
    let (dir, ids, duration_ns) = long_media("gapless", 3);
    let mut state_file = dir.clone();
    state_file.push("state.json");
    let _coordinator = start_coordinator(PORT_GAPLESS, &dir, &state_file).await;

    let mut speaker = join(PORT_GAPLESS, "Kitchen", Role::Speaker).await;
    speaker
        .send(frame(Payload::ClockReport(ClockReport {
            quality: ClockQuality::Stable,
            samples: 20,
            ..ClockReport::default()
        })))
        .await
        .expect("clock");
    speaker
        .send(frame(Payload::SelectSource(SelectSource {
            mode: SourceMode::ControlledAudio,
            queue: ids.clone(),
            ..Default::default()
        })))
        .await
        .expect("queue");
    let seen = snapshot_where(&mut speaker, |s| s.queue.len() == 3).await;
    assert_eq!(seen.next_in_queue.as_ref(), Some(&ids[1]), "the snapshot names what to preload");

    // The current track decoded, and the next one decoded ahead of time.
    speaker.send(ready(&ids[0], duration_ns)).await.expect("ready");
    speaker.send(ready(&ids[1], duration_ns)).await.expect("preload");
    speaker.send(frame(Payload::Play(PlayCommand { force: false }))).await.expect("play");

    let first =
        transport_where(&mut speaker, |t| t.state == TransportState::Playing && t.media_id.as_ref() == Some(&ids[0]))
            .await;
    let second = transport_where(&mut speaker, |t| t.media_id.as_ref() == Some(&ids[1])).await;

    assert_eq!(second.state, TransportState::Playing);
    assert_eq!(second.anchor_media_ns, 0);
    assert_eq!(
        second.anchor_server_ns,
        first.anchor_server_ns + duration_ns,
        "the next track must begin exactly where the first runs out — a difference here is silence"
    );

    let _ = std::fs::remove_dir_all(&dir);
}
