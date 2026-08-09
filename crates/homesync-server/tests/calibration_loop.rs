//! End-to-end test of the acoustic calibration loop against the real binary.
//!
//! A real microphone in a real room cannot be tested in CI, but everything
//! between the chirp and the applied compensation can be: the coordinator
//! sequences devices and repetitions, the microphone uploads recordings, the
//! coordinator match-filters them, aggregates, solves and applies.
//!
//! The fake microphone synthesises recordings in which the chirp sits at a
//! *known* delay after the scheduled instant, so the test asserts against
//! ground truth rather than against whatever the code happens to produce.
//!
//! What this does not prove: that a speaker emits the chirp when told to, that
//! a microphone hears it, or that the numbers correspond to a room. Checkpoint
//! 4 in `docs/checkpoints.md` is the only way to find that out.

use futures_util::{SinkExt, StreamExt};
use homesync_dsp::ChirpSpec;
use homesync_protocol::{CalibrationStart, Envelope, Hello, JoinRoom, Payload, Role, RoomSnapshot, PROTOCOL_VERSION};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};

const PORT: u16 = 18123;
const ROOM: &str = "CALTST";
const SECRET: &str = "cal-secret";
const CHIRP_RATE: u32 = 48_000;

/// Recording pre-roll used by the coordinator, in nanoseconds. The recording
/// window opens this far before the scheduled instant.
const PRE_ROLL_NS: u64 = 250_000_000;

/// Ground truth: the delay each fake device's sound "arrives" at.
const LAPTOP_DELAY_MS: f64 = 40.0;
const TELEVISION_DELAY_MS: f64 = 180.0;

type Socket = WebSocketStream<MaybeTlsStream<TcpStream>>;

/// Kills the coordinator when the test ends, however it ends.
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

/// Connects one client and joins the room, returning its socket and client id.
async fn join(name: &str, role: Role) -> (Socket, String) {
    let (mut socket, _) = connect_async(format!("ws://127.0.0.1:{PORT}/ws")).await.expect("connect");

    socket
        .send(frame(Payload::Hello(Hello {
            client_version: "calibration-test".into(),
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

    // The welcome carries our identity; everything else is skipped.
    loop {
        let message = socket.next().await.expect("a frame").expect("no socket error");
        if let Message::Text(text) = message {
            if let Ok(envelope) = serde_json::from_str::<Envelope>(&text) {
                if let Payload::Welcome(welcome) = envelope.payload {
                    return (socket, welcome.client_id);
                }
            }
        }
    }
}

/// A recording in which chirp `code` arrives `delay_ms` after the scheduled
/// instant, with the window opening `PRE_ROLL_NS` early.
fn synthetic_recording(code: u32, delay_ms: f64) -> Vec<f32> {
    let chirp = ChirpSpec::for_code(code, CHIRP_RATE).render();
    // 1.2 s window plus the client's own tail.
    let mut recording = vec![0.0f32; (CHIRP_RATE as f64 * 1.3) as usize];
    let pre_roll_ms = PRE_ROLL_NS as f64 / 1e6;
    let offset = (((pre_roll_ms + delay_ms) / 1000.0) * CHIRP_RATE as f64) as usize;
    for (i, sample) in chirp.iter().enumerate() {
        if offset + i < recording.len() {
            // A realistic level, well below full scale.
            recording[offset + i] = sample * 0.35;
        }
    }
    recording
}

/// Uploads a recording over raw HTTP, avoiding an HTTP client dependency for
/// one request.
async fn upload(query: &str, samples: &[f32]) {
    let mut body = Vec::with_capacity(samples.len() * 4);
    for sample in samples {
        body.extend_from_slice(&sample.to_le_bytes());
    }

    let mut stream = TcpStream::connect(("127.0.0.1", PORT)).await.expect("connect for upload");
    let head = format!(
        "POST /api/v1/calibration/recording?{query} HTTP/1.1\r\n\
         Host: 127.0.0.1:{PORT}\r\n\
         Content-Type: application/octet-stream\r\n\
         Content-Length: {}\r\n\
         Connection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(head.as_bytes()).await.expect("write head");
    stream.write_all(&body).await.expect("write body");
    stream.flush().await.expect("flush");

    let mut response = Vec::new();
    stream.read_to_end(&mut response).await.expect("read response");
    let text = String::from_utf8_lossy(&response);
    assert!(text.starts_with("HTTP/1.1 202"), "upload was rejected: {}", &text[..text.len().min(120)]);
}

#[tokio::test(flavor = "multi_thread")]
async fn calibration_measures_and_applies_compensation() {
    let _coordinator = start_coordinator().await;

    // The microphone joins as a controller so it is not measured against
    // itself, and three speakers are the targets.
    let (mut mic, mic_id) = join("phone", Role::Controller).await;
    let (laptop, laptop_id) = join("laptop", Role::Speaker).await;
    let (television, television_id) = join("television", Role::Speaker).await;
    let (silent, silent_id) = join("silent speaker", Role::Speaker).await;

    // Speakers must keep reading or their socket buffers fill with broadcasts.
    for socket in [laptop, television, silent] {
        tokio::spawn(async move {
            let mut socket = socket;
            while socket.next().await.is_some() {}
        });
    }

    mic.send(frame(Payload::CalibrationStart(CalibrationStart {
        microphone_client_id: mic_id.clone(),
        repetitions: 3,
    })))
    .await
    .expect("start calibration");

    // Ground truth per device. The third is never heard at all.
    let delay_for = |client_id: &str| -> Option<f64> {
        if client_id == laptop_id {
            Some(LAPTOP_DELAY_MS)
        } else if client_id == television_id {
            Some(TELEVISION_DELAY_MS)
        } else {
            None
        }
    };

    let mut result = None;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(60);

    while tokio::time::Instant::now() < deadline {
        let Ok(Some(Ok(message))) = tokio::time::timeout(Duration::from_secs(20), mic.next()).await else {
            break;
        };
        let Message::Text(text) = message else { continue };
        let Ok(envelope) = serde_json::from_str::<Envelope>(&text) else { continue };

        match envelope.payload {
            Payload::CalibrationRecord(record) => {
                let samples = match delay_for(&record.target_client_id) {
                    Some(delay_ms) => synthetic_recording(record.chirp_code, delay_ms),
                    // A device the microphone could not hear: silence, which
                    // must be reported as "no measurement" rather than guessed.
                    None => vec![0.0f32; (CHIRP_RATE as f64 * 1.3) as usize],
                };
                let query = format!(
                    "session={}&target={}&repetition={}&rate={}&first_sample_server_ns={}",
                    record.session_id, record.target_client_id, record.repetition, CHIRP_RATE, record.start_server_ns,
                );
                upload(&query, &samples).await;
            }
            Payload::CalibrationResult(outcome) => {
                result = Some(outcome);
                break;
            }
            _ => {}
        }
    }

    let result = result.expect("calibration never produced a result");
    assert!(result.applied, "compensation should have been applied: {}", result.detail);
    assert_eq!(result.measurements.len(), 3, "every target should be reported");

    let find = |id: &str| {
        result.measurements.iter().find(|m| m.client_id == id).unwrap_or_else(|| panic!("no measurement for {id}"))
    };

    // Measured delays should match the ground truth closely. The tolerance is
    // the sub-sample interpolation and the aggregation, not a fudge factor.
    let laptop = find(&laptop_id);
    let measured = laptop.measured_delay_ms.expect("laptop was heard");
    assert!((measured - LAPTOP_DELAY_MS).abs() < 2.0, "laptop measured {measured} ms, expected {LAPTOP_DELAY_MS} ms");
    assert!(laptop.stable, "identical repetitions must aggregate as stable");
    assert_eq!(laptop.accepted, 3);

    let television = find(&television_id);
    let measured = television.measured_delay_ms.expect("television was heard");
    assert!(
        (measured - TELEVISION_DELAY_MS).abs() < 2.0,
        "television measured {measured} ms, expected {TELEVISION_DELAY_MS} ms"
    );

    // The device nobody heard is reported, not silently dropped, and it does
    // not prevent the others from being calibrated.
    let silent = find(&silent_id);
    assert!(silent.measured_delay_ms.is_none(), "silence must not produce a measurement");
    assert!(!silent.stable);
    assert_eq!(silent.accepted, 0);

    // The solved alignment: the room is held to its slowest device, so the
    // faster one is delayed by the difference and the slower one is untouched.
    let expected_laptop = -(TELEVISION_DELAY_MS - LAPTOP_DELAY_MS);
    assert!(
        (laptop.applied_compensation_ms - expected_laptop).abs() < 3.0,
        "laptop compensation {} ms, expected about {expected_laptop} ms",
        laptop.applied_compensation_ms
    );
    assert!(
        television.applied_compensation_ms.abs() < 3.0,
        "the slowest device cannot be helped, so its compensation should be ~0, got {}",
        television.applied_compensation_ms
    );

    // And the compensation must actually reach the room state, not just the
    // result message.
    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
    let mut applied = None;
    while tokio::time::Instant::now() < deadline && applied.is_none() {
        let Ok(Some(Ok(message))) = tokio::time::timeout(Duration::from_secs(5), mic.next()).await else {
            break;
        };
        let Message::Text(text) = message else { continue };
        let Ok(envelope) = serde_json::from_str::<Envelope>(&text) else { continue };
        if let Payload::RoomSnapshot(snapshot) = envelope.payload {
            let snapshot: RoomSnapshot = *snapshot;
            if let Some(client) = snapshot.clients.iter().find(|c| c.client_id == laptop_id) {
                if client.acoustic_offset_ms != 0.0 {
                    applied = Some(client.acoustic_offset_ms);
                }
            }
        }
    }

    let applied = applied.expect("the acoustic offset never reached the room snapshot");
    assert!(
        (applied - expected_laptop).abs() < 3.0,
        "room snapshot shows {applied} ms, expected about {expected_laptop} ms"
    );
}
