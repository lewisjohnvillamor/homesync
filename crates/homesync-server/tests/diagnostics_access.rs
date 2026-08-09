//! The diagnostics export carries device names, telemetry and calibration
//! measurements for everyone in the room. Reaching the port must not be enough
//! to read it, so the gate is tested rather than assumed.

use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

const PORT: u16 = 18125;
const ROOM: &str = "DIAGTS";
const SECRET: &str = "diag-secret";

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
            // No profile file and no mDNS: this test should touch neither the
            // filesystem nor the network beyond its own socket.
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

/// Issues a bare GET and returns the whole response.
async fn get(path: &str) -> String {
    let mut stream = TcpStream::connect(("127.0.0.1", PORT)).await.expect("connect");
    let request = format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{PORT}\r\nConnection: close\r\n\r\n");
    stream.write_all(request.as_bytes()).await.expect("write");
    let mut response = Vec::new();
    stream.read_to_end(&mut response).await.expect("read");
    String::from_utf8_lossy(&response).to_string()
}

#[tokio::test(flavor = "multi_thread")]
async fn diagnostics_require_the_room_secret() {
    let _coordinator = start_coordinator().await;

    let without = get("/api/v1/diagnostics").await;
    assert!(
        without.starts_with("HTTP/1.1 400"),
        "a request with no secret should be rejected: {}",
        &without[..without.len().min(80)]
    );

    let wrong = get("/api/v1/diagnostics?secret=not-the-secret").await;
    assert!(wrong.starts_with("HTTP/1.1 403"), "a wrong secret should be forbidden: {}", &wrong[..wrong.len().min(80)]);
    assert!(!wrong.contains(ROOM), "a rejected response must not leak room state");

    let correct = get(&format!("/api/v1/diagnostics?secret={SECRET}")).await;
    assert!(correct.starts_with("HTTP/1.1 200"), "the room secret should be accepted");
    assert!(correct.contains(ROOM), "the report should describe the room");
    assert!(correct.contains("homesync-diagnostics.json"), "the report should download as a named file");

    // The report must be valid JSON, not merely a 200: it exists to be read by
    // whoever is debugging, and by tooling.
    let body = correct.split("\r\n\r\n").nth(1).expect("a body");
    let parsed: serde_json::Value = serde_json::from_str(body).expect("the report should be JSON");
    assert_eq!(parsed["rooms"].as_array().expect("rooms").len(), 1);
    assert!(parsed["server_version"].is_string());
    assert!(parsed["config"]["start_lead_ms"].is_number());
    // Persistence was disabled for this run, and the report should say so
    // rather than naming a file that is not being written.
    assert!(parsed["config"]["state_file"].is_null());
}

#[tokio::test(flavor = "multi_thread")]
async fn public_endpoints_do_not_leak_the_secret() {
    // Knowing a room exists must not be enough to join it.
    let _coordinator = start_coordinator().await;

    let info = get("/api/v1/info").await;
    assert!(info.starts_with("HTTP/1.1 200"));
    assert!(!info.contains(SECRET), "/api/v1/info must not carry the room secret");

    let room = get(&format!("/api/v1/rooms/{ROOM}")).await;
    assert!(room.starts_with("HTTP/1.1 200"));
    assert!(room.contains(ROOM));
    assert!(!room.contains(SECRET), "room metadata must not carry the room secret");
}
