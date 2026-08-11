//! The join limiter, against the real binary over a real socket.
//!
//! The unit tests drive the accounting with a fake clock. This checks the part
//! they cannot: that the limit is actually wired into the join path, that it
//! sits *before* the secret comparison, and that a device doing nothing wrong
//! is never caught by it.

use futures_util::{SinkExt, StreamExt};
use homesync_protocol::{Envelope, Hello, JoinRoom, Payload, Role};
use std::time::Duration;
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};

const ROOM: &str = "LIMTST";
const SECRET: &str = "limit-secret";

/// Matches `join_limit::MAX_FAILURES`. Duplicated rather than imported because
/// the binary is not a library, and a mismatch fails loudly here.
const MAX_FAILURES: usize = 10;

const WRONG_SECRET_PORT: u16 = 18131;
const HONEST_DEVICE_PORT: u16 = 18132;

type Socket = WebSocketStream<MaybeTlsStream<TcpStream>>;

struct Coordinator(std::process::Child);

impl Drop for Coordinator {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

async fn start_coordinator(port: u16) -> Coordinator {
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
        if TcpStream::connect(("127.0.0.1", port)).await.is_ok() {
            return coordinator;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    panic!("coordinator never started listening");
}

fn frame(payload: Payload) -> Message {
    Message::Text(serde_json::to_string(&Envelope::new(payload)).expect("encode").into())
}

/// Opens a socket, says hello, and attempts one join. Returns the error code
/// the coordinator answered with, or `None` if the join succeeded.
async fn attempt_join(port: u16, secret: &str, room: &str) -> Option<String> {
    let (mut socket, _) =
        connect_async(format!("ws://127.0.0.1:{port}/ws")).await.expect("connect to the control socket");

    socket
        .send(frame(Payload::Hello(Hello {
            client_version: "join-limit-test".into(),
            user_agent: "integration-test".into(),
            device_id: None,
        })))
        .await
        .expect("send hello");

    socket
        .send(frame(Payload::JoinRoom(JoinRoom {
            room_code: room.to_string(),
            secret: secret.to_string(),
            name: "Prober".into(),
            role: Role::Speaker,
        })))
        .await
        .expect("send join");

    let outcome = read_join_outcome(&mut socket).await;
    let _ = socket.close(None).await;
    outcome
}

async fn read_join_outcome(socket: &mut Socket) -> Option<String> {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    while let Ok(Some(Ok(message))) = tokio::time::timeout_at(deadline, socket.next()).await {
        let Message::Text(text) = message else { continue };
        let Ok(envelope) = serde_json::from_str::<Envelope>(&text) else { continue };
        match envelope.payload {
            Payload::Error(error) => return Some(error.code),
            Payload::RoomSnapshot(_) => return None,
            _ => continue,
        }
    }
    panic!("the coordinator never answered the join");
}

/// Enough wrong secrets and the address is asked to wait — and once it is, the
/// answer stops depending on whether the secret was right, which is what makes
/// it a limit rather than a slower oracle.
#[tokio::test(flavor = "multi_thread")]
async fn repeated_wrong_secrets_earn_a_wait() {
    let _coordinator = start_coordinator(WRONG_SECRET_PORT).await;

    for attempt in 1..MAX_FAILURES {
        let code = attempt_join(WRONG_SECRET_PORT, "not-the-secret", ROOM).await;
        assert_eq!(code.as_deref(), Some("bad_secret"), "attempt {attempt} should still be answered normally");
    }

    // The one that spends the last attempt is still answered as a bad secret;
    // it is the *next* one that is refused outright.
    let code = attempt_join(WRONG_SECRET_PORT, "not-the-secret", ROOM).await;
    assert_eq!(code.as_deref(), Some("bad_secret"));

    let code = attempt_join(WRONG_SECRET_PORT, "not-the-secret", ROOM).await;
    assert_eq!(code.as_deref(), Some("too_many_attempts"), "the limit should now be refusing attempts");

    // The real secret is refused too. If it were not, the limiter would be a
    // speed bump in front of the guess rather than a limit on it.
    let code = attempt_join(WRONG_SECRET_PORT, SECRET, ROOM).await;
    assert_eq!(code.as_deref(), Some("too_many_attempts"), "the limit must apply before the secret is compared");
}

/// The case the design is actually shaped around: a device that joins
/// correctly, over and over, the way one on a flapping connection does. It must
/// never be locked out of its own room.
#[tokio::test(flavor = "multi_thread")]
async fn a_device_rejoining_correctly_is_never_limited() {
    let _coordinator = start_coordinator(HONEST_DEVICE_PORT).await;

    for attempt in 1..=(MAX_FAILURES * 3) {
        let code = attempt_join(HONEST_DEVICE_PORT, SECRET, ROOM).await;
        assert_eq!(code, None, "rejoin {attempt} should have been allowed");
    }
}

/// A wrong room code is charged the same as a wrong secret. Charging only for
/// the secret would leave "does this code exist?" free to ask.
#[tokio::test(flavor = "multi_thread")]
async fn a_wrong_room_code_is_charged_too() {
    let _coordinator = start_coordinator(18133).await;

    for _ in 0..MAX_FAILURES {
        let code = attempt_join(18133, SECRET, "NOSUCH").await;
        assert_eq!(code.as_deref(), Some("no_such_room"));
    }
    let code = attempt_join(18133, SECRET, "NOSUCH").await;
    assert_eq!(code.as_deref(), Some("too_many_attempts"));
}
