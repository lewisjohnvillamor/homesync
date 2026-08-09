//! End-to-end test of the live PCM path against the real binary.
//!
//! A browser cannot answer the question that matters here. Headless Chromium
//! renders into a null audio sink, so its buffer depth means nothing. This test
//! attaches a receiver that decodes every frame the coordinator sends and
//! checks the properties the framer is supposed to guarantee: contiguous
//! sequence numbers, exactly evenly spaced presentation times, and — most
//! importantly — a *lead over real time that does not shrink*.
//!
//! That last one is a regression test for a real defect: the synthetic capture
//! source used to sleep a fixed interval per block, so it ran slightly slower
//! than real time, and every receiver's buffer drained until the stream
//! re-anchored.

use futures_util::{SinkExt, StreamExt};
use homesync_audio::frame::{decode, flags};
use homesync_clock::ClockEstimator;
use homesync_protocol::{ClockPing, Envelope, Hello, JoinRoom, Payload, Role, StreamStart, PROTOCOL_VERSION};
use std::time::{Duration, Instant};
use tokio::net::TcpStream;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message;

const PORT: u16 = 18124;
const ROOM: &str = "LIVETS";
const SECRET: &str = "live-secret";

/// Frames to collect before judging. At 100 frames a second this is ~4 s.
const FRAMES_WANTED: usize = 400;

/// Music profile: 400 ms target depth plus the coordinator's 60 ms network
/// lead.
const EXPECTED_LEAD_MS: f64 = 460.0;

struct Coordinator(std::process::Child);

impl Drop for Coordinator {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

async fn start_coordinator() -> Coordinator {
    let child = std::process::Command::new(env!("CARGO_BIN_EXE_homesync"))
        .args(["--bind", "127.0.0.1", "--port", &PORT.to_string(), "--room-code", ROOM, "--room-secret", SECRET])
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

#[tokio::test(flavor = "multi_thread")]
async fn live_stream_holds_its_timeline() {
    let _coordinator = start_coordinator().await;
    let base = Instant::now();

    let (mut socket, _) = connect_async(format!("ws://127.0.0.1:{PORT}/ws")).await.expect("connect");
    socket
        .send(frame(Payload::Hello(Hello {
            client_version: "live-test".into(),
            user_agent: "test".into(),
            device_id: None,
        })))
        .await
        .expect("hello");
    socket
        .send(frame(Payload::JoinRoom(JoinRoom {
            room_code: ROOM.into(),
            secret: SECRET.into(),
            name: "receiver".into(),
            // A speaker, because controllers are deliberately not sent audio.
            role: Role::Speaker,
        })))
        .await
        .expect("join");

    // Enough of a clock exchange to convert arrival times into coordinator
    // time, which is what makes the lead measurement meaningful.
    let mut clock = ClockEstimator::new();
    for seq in 0..24u64 {
        let t0 = base.elapsed().as_nanos() as f64;
        socket.send(frame(Payload::ClockPing(ClockPing { t0, seq }))).await.expect("ping");
        let deadline = Instant::now() + Duration::from_secs(2);
        while Instant::now() < deadline {
            let Ok(Some(Ok(message))) = tokio::time::timeout(Duration::from_secs(2), socket.next()).await else {
                panic!("socket closed during the clock exchange");
            };
            let t3 = base.elapsed().as_nanos() as f64;
            if let Message::Text(text) = message {
                if let Ok(envelope) = serde_json::from_str::<Envelope>(&text) {
                    if let Payload::ClockPong(pong) = envelope.payload {
                        clock.push(pong.t0, pong.t1 as f64, pong.t2 as f64, t3);
                        break;
                    }
                }
            }
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert!(clock.has_estimate(), "the clock exchange produced no estimate");

    socket
        .send(frame(Payload::StreamStart(StreamStart { profile: "music".into(), synthetic: true })))
        .await
        .expect("stream start");

    // Collect frames, recording the coordinator time at which each arrived.
    let mut sequences = Vec::new();
    let mut presentations = Vec::new();
    let mut leads_ms = Vec::new();
    let mut discontinuities = 0usize;
    let mut decode_failures = 0usize;
    let started = Instant::now();

    while presentations.len() < FRAMES_WANTED && started.elapsed() < Duration::from_secs(20) {
        let Ok(Some(Ok(message))) = tokio::time::timeout(Duration::from_secs(5), socket.next()).await else {
            break;
        };
        let Message::Binary(bytes) = message else { continue };

        let arrival_server_ns = clock.to_server_ns(base.elapsed().as_nanos() as f64);
        match decode(&bytes) {
            Ok((header, _payload)) => {
                if header.flags & flags::DISCONTINUITY != 0 {
                    discontinuities += 1;
                }
                leads_ms.push((header.presentation_ns as f64 - arrival_server_ns) / 1e6);
                sequences.push(header.sequence);
                presentations.push(header.presentation_ns);
            }
            Err(_) => decode_failures += 1,
        }
    }

    assert_eq!(decode_failures, 0, "the coordinator sent frames the receiver could not decode");
    assert!(
        presentations.len() >= FRAMES_WANTED,
        "only {} frames arrived in 20 s; the stream is not running at 100 frames a second",
        presentations.len()
    );

    // Sequence numbers are contiguous: nothing dropped between framer and
    // socket.
    for pair in sequences.windows(2) {
        assert_eq!(pair[1], pair[0] + 1, "sequence jumped from {} to {}", pair[0], pair[1]);
    }

    // Presentation times are exactly 10 ms apart. This is what stops receivers
    // inheriting the host's capture jitter.
    for pair in presentations.windows(2) {
        assert_eq!(pair[1] - pair[0], 10_000_000, "presentation spacing was {} ns, not 10 ms", pair[1] - pair[0]);
    }

    assert_eq!(discontinuities, 0, "the stream re-anchored mid-run, which means the capture timeline drifted");

    // The lead is the receiver's whole budget for delivery and buffering. It
    // should sit near the profile depth plus the network lead.
    let mean = |values: &[f64]| values.iter().sum::<f64>() / values.len() as f64;
    let overall = mean(&leads_ms);
    assert!(
        (overall - EXPECTED_LEAD_MS).abs() < 120.0,
        "mean lead {overall:.1} ms, expected about {EXPECTED_LEAD_MS} ms"
    );

    // And it must not shrink. A source running slower than real time loses
    // lead steadily until receivers starve — which is exactly the bug this
    // guards against.
    let quarter = leads_ms.len() / 4;
    let first = mean(&leads_ms[..quarter]);
    let last = mean(&leads_ms[leads_ms.len() - quarter..]);
    assert!(
        (last - first).abs() < 40.0,
        "lead drifted from {first:.1} ms to {last:.1} ms across the run; \
         the capture source is not keeping up with real time"
    );

    println!(
        "  {} frames, mean lead {:.1} ms, drift {:+.1} ms across the run",
        presentations.len(),
        overall,
        last - first
    );
}
