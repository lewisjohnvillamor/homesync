//! The media endpoint hands out a bounded number of streams.
//!
//! A streamed response holds an open file for as long as the client takes to
//! read it. That is a good trade for memory and a bad one for file descriptors,
//! so the number in flight is capped — and the cap is only worth having if a
//! finished response gives its slot back. Both halves are checked here against
//! the real binary.
//!
//! What is deliberately not claimed: that a client which stops reading loses
//! its slot. It does not, until its connection ends. See `MediaReader`.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

const PORT: u16 = 18151;
const ROOM: &str = "LIMITS";
const SECRET: &str = "limit-secret";

/// The coordinator is started with the smallest room it allows, which puts the
/// stream limit on its floor. Saturating a limit derived from a large room
/// would mean opening hundreds of sockets to prove a property that does not
/// depend on the number.
const MAX_CLIENTS: usize = 2;
const LIMIT: usize = 32;

/// Larger than the socket buffer, by a wide margin and on purpose.
///
/// A first attempt used 4 MB and every request succeeded, which read as the cap
/// not working. It was working: on loopback the kernel absorbed the whole 4 MB
/// response, so each one *finished* and gave its slot straight back. A track
/// has to be well beyond what the buffer will swallow before an unread response
/// is genuinely still in flight — which is also the only case the cap is for.
const TRACK_BYTES: usize = 64 * 1024 * 1024;

struct Coordinator(std::process::Child);

impl Drop for Coordinator {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn media_with_track() -> (PathBuf, String) {
    let mut dir = std::env::temp_dir();
    dir.push(format!("homesync-limit-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("media dir");

    let samples = TRACK_BYTES - 44;
    let mut bytes = Vec::with_capacity(TRACK_BYTES);
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
    bytes.resize(TRACK_BYTES, 0x5a);

    std::fs::File::create(dir.join("track.wav")).expect("create").write_all(&bytes).expect("write");
    (dir, homesync_media::sha256_hex(&bytes)[..16].to_string())
}

async fn start_coordinator(media: &Path) -> Coordinator {
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
            &media.to_string_lossy(),
            "--max-clients",
            &MAX_CLIENTS.to_string(),
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

/// Opens a request and reads only its status line, leaving the body unread and
/// the socket open — a client that has asked for a track and is taking its
/// time, which is exactly what holds a slot.
async fn begin_request(path: &str) -> (TcpStream, String) {
    let mut stream = TcpStream::connect(("127.0.0.1", PORT)).await.expect("connect");
    let request = format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{PORT}\r\n\r\n");
    stream.write_all(request.as_bytes()).await.expect("write");

    let mut status = Vec::new();
    let mut byte = [0u8; 1];
    while !status.ends_with(b"\r\n") {
        match stream.read(&mut byte).await {
            Ok(0) => break,
            Ok(_) => status.push(byte[0]),
            Err(error) => panic!("reading the status line: {error}"),
        }
    }
    (stream, String::from_utf8_lossy(&status).trim().to_string())
}

#[tokio::test(flavor = "multi_thread")]
async fn a_flood_of_slow_readers_cannot_take_every_slot() {
    let (dir, id) = media_with_track();
    let _coordinator = start_coordinator(&dir).await;
    let path = format!("/api/v1/media/{id}");

    // Hold every slot open, reading nothing.
    let mut held = Vec::new();
    for i in 0..LIMIT {
        let (stream, status) = begin_request(&path).await;
        assert!(status.starts_with("HTTP/1.1 200"), "request {i} should have been served: {status}");
        held.push(stream);
    }

    // One more than the cap allows. It is refused rather than queued, and told
    // when to come back, because a queued request would hold the connection
    // that the limit exists to ration.
    let (_refused, status) = begin_request(&path).await;
    assert!(status.starts_with("HTTP/1.1 503"), "past the cap the answer should be 503: {status}");

    // The built-in click track lives in memory and holds no file open, so it is
    // not rationed and must still be served with every file slot taken.
    let (_builtin, status) = begin_request(&format!("/api/v1/media/{}", homesync_media::BUILTIN_CLICK_ID)).await;
    assert!(status.starts_with("HTTP/1.1 200"), "the in-memory track should not be rationed: {status}");

    // A slot is released by the response ending, however it ends. Hanging up is
    // the common way — a device that navigates away mid-download.
    drop(held);
    let mut recovered = None;
    for _ in 0..50 {
        tokio::time::sleep(Duration::from_millis(100)).await;
        let (stream, status) = begin_request(&path).await;
        if status.starts_with("HTTP/1.1 200") {
            recovered = Some(stream);
            break;
        }
    }
    assert!(recovered.is_some(), "closing the held responses should give their slots back");

    let _ = std::fs::remove_dir_all(&dir);
}
