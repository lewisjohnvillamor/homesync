//! Changing a device's timing compensation during a YouTube video has to reach
//! that device's ears, not merely its display.
//!
//! A device playing its own audio applies new compensation itself, by
//! rescheduling the buffer it already holds. A YouTube receiver cannot: its
//! start instant was fixed by the last rendezvous, and the compensation only
//! enters the arithmetic when a new one is issued. So the coordinator has to
//! issue one, and this test is what says it does — the failure it guards
//! against is silent, because the number on screen changes either way.

use futures_util::{SinkExt, StreamExt};
use homesync_protocol::{
    ClientUpdate, Envelope, Hello, JoinRoom, Payload, PlayCommand, Role, SelectSource, SourceMode, PROTOCOL_VERSION,
};
use std::time::Duration;
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};

const PORT: u16 = 18141;
const ROOM: &str = "YTCOMP";
const SECRET: &str = "yt-secret";

type Socket = WebSocketStream<MaybeTlsStream<TcpStream>>;

struct Coordinator(std::process::Child);

impl Drop for Coordinator {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

async fn start_coordinator() -> Coordinator {
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
            "--no-state",
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
            client_version: "youtube-compensation-test".into(),
            user_agent: "test".into(),
            device_id: None,
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

    loop {
        let message = socket.next().await.expect("a frame").expect("no socket error");
        if let Message::Text(text) = message {
            if let Ok(envelope) = serde_json::from_str::<Envelope>(&text) {
                if matches!(envelope.payload, Payload::Welcome(_)) {
                    return socket;
                }
            }
        }
    }
}

/// Collects frames until the socket goes quiet, returning any rendezvous seen.
///
/// Quiet rather than "the next frame": the coordinator sends snapshots and
/// transport updates around a rendezvous, so waiting for one specific frame
/// would pass on the first snapshot and never look at what followed.
async fn drain_rendezvous(socket: &mut Socket) -> Vec<homesync_protocol::YoutubeRendezvous> {
    let mut found = Vec::new();
    loop {
        match tokio::time::timeout(Duration::from_millis(400), socket.next()).await {
            Ok(Some(Ok(Message::Text(text)))) => {
                if let Ok(envelope) = serde_json::from_str::<Envelope>(&text) {
                    if let Payload::YoutubeRendezvous(rendezvous) = envelope.payload {
                        found.push(rendezvous);
                    }
                }
            }
            Ok(Some(Ok(_))) => {}
            // Quiet, closed, or an error: either way there is nothing more.
            _ => return found,
        }
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn changing_compensation_re_converges_a_youtube_receiver() {
    let _coordinator = start_coordinator().await;

    let mut receiver = join("Television", Role::Speaker).await;
    let mut controller = join("Phone", Role::Controller).await;

    controller
        .send(frame(Payload::SelectSource(SelectSource {
            mode: SourceMode::Youtube,
            youtube_video_id: Some("aaaaaaaaaaa".into()),
            ..Default::default()
        })))
        .await
        .expect("select source");
    controller.send(frame(Payload::Play(PlayCommand { force: true }))).await.expect("play");

    // The play itself rendezvouses everybody; that is the known-good path and
    // not what is under test.
    let initial = drain_rendezvous(&mut receiver).await;
    let baseline = initial.last().expect("playing a video should rendezvous the receiver").clone();

    // The controller's own compensation must not disturb the room: it renders
    // no audio, so there is nothing to converge.
    controller
        .send(frame(Payload::ClientUpdate(ClientUpdate { manual_offset_ms: Some(75.0), ..Default::default() })))
        .await
        .expect("controller offset");
    assert!(
        drain_rendezvous(&mut receiver).await.is_empty(),
        "a controller's compensation should not re-converge the receivers"
    );

    // The receiver moves its own slider, which is the case that used to change
    // nothing audible.
    receiver
        .send(frame(Payload::ClientUpdate(ClientUpdate { manual_offset_ms: Some(-50.0), ..Default::default() })))
        .await
        .expect("receiver offset");

    let after = drain_rendezvous(&mut receiver).await;
    let rendezvous = after.last().expect("changing compensation should issue a rendezvous");
    assert!(rendezvous.epoch > baseline.epoch, "a rendezvous should be a new epoch, not a repeat");
    assert!(
        (rendezvous.start_latency_ms - (baseline.start_latency_ms - 50.0)).abs() < 1e-6,
        "the lead should carry the new compensation: {} against a baseline of {}",
        rendezvous.start_latency_ms,
        baseline.start_latency_ms
    );

    // Sending the same value again is not a change, and re-converging on it
    // would restart the video every time a client reconnects and republishes
    // what it already had.
    receiver
        .send(frame(Payload::ClientUpdate(ClientUpdate { manual_offset_ms: Some(-50.0), ..Default::default() })))
        .await
        .expect("repeat offset");
    assert!(
        drain_rendezvous(&mut receiver).await.is_empty(),
        "re-sending an unchanged compensation should not re-converge the device"
    );
}
