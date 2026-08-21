//! The byte endpoint streams a file from disk rather than reading it into
//! memory, which means the bytes now travel through a seek, a chunked reader
//! and a `Content-Length` the handler sets itself. Any of those can be off by
//! one without the response looking wrong, so the bytes are compared against
//! the file instead of the status being trusted.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

/// Each test gets its own port; `cargo test` runs them in parallel.
const WHOLE_FILE_PORT: u16 = 18131;
const RANGE_PORT: u16 = 18132;

/// Bigger than the endpoint's chunk size, so a whole-file fetch has to span
/// several reads. A single-chunk file would pass even if the loop were wrong.
const TRACK_BYTES: usize = 200_000;

struct Coordinator(std::process::Child);

impl Drop for Coordinator {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

/// Writes a WAV of `TRACK_BYTES` with a non-repeating body, so a chunk served
/// twice or in the wrong order shows up as a mismatch rather than matching by
/// luck.
fn media_with_track(name: &str) -> (PathBuf, Vec<u8>) {
    let mut dir = std::env::temp_dir();
    dir.push(format!("homesync-stream-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("media dir");

    let samples = TRACK_BYTES - 44;
    let mut bytes = Vec::with_capacity(TRACK_BYTES);
    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&((samples + 36) as u32).to_le_bytes());
    bytes.extend_from_slice(b"WAVEfmt ");
    bytes.extend_from_slice(&16u32.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes()); // PCM.
    bytes.extend_from_slice(&2u16.to_le_bytes()); // Stereo.
    bytes.extend_from_slice(&48_000u32.to_le_bytes());
    bytes.extend_from_slice(&192_000u32.to_le_bytes()); // Byte rate.
    bytes.extend_from_slice(&4u16.to_le_bytes());
    bytes.extend_from_slice(&16u16.to_le_bytes());
    bytes.extend_from_slice(b"data");
    bytes.extend_from_slice(&(samples as u32).to_le_bytes());
    for i in 0..samples {
        bytes.push((i % 251) as u8);
    }

    let mut file = std::fs::File::create(dir.join("track.wav")).expect("create");
    file.write_all(&bytes).expect("write");

    (dir, bytes)
}

async fn start_coordinator(port: u16, media: &Path) -> Coordinator {
    let child = std::process::Command::new(env!("CARGO_BIN_EXE_homesync"))
        .args([
            "--bind",
            "127.0.0.1",
            "--port",
            &port.to_string(),
            "--room-code",
            "STREAM",
            "--room-secret",
            "stream-secret",
            "--media-dir",
            &media.to_string_lossy(),
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

/// Issues a GET and returns the headers as text and the body as bytes.
async fn get(port: u16, path: &str, extra: &str) -> (String, Vec<u8>) {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).await.expect("connect");
    let request = format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n{extra}Connection: close\r\n\r\n");
    stream.write_all(request.as_bytes()).await.expect("write");
    let mut response = Vec::new();
    stream.read_to_end(&mut response).await.expect("read");

    let split = response.windows(4).position(|w| w == b"\r\n\r\n").expect("headers end");
    let headers = String::from_utf8_lossy(&response[..split]).to_string();
    (headers, response[split + 4..].to_vec())
}

/// The catalogue keys a track by the first 16 hex characters of its content
/// hash, so the test can name the file it wrote without asking the server.
fn track_id(bytes: &[u8]) -> String {
    homesync_media::sha256_hex(bytes)[..16].to_string()
}

#[tokio::test(flavor = "multi_thread")]
async fn a_whole_track_arrives_byte_for_byte() {
    let (dir, expected) = media_with_track("whole");
    let port = WHOLE_FILE_PORT;
    let _coordinator = start_coordinator(port, &dir).await;

    let id = track_id(&expected);
    let (headers, body) = get(port, &format!("/api/v1/media/{id}"), "").await;

    assert!(headers.starts_with("HTTP/1.1 200"), "{headers}");
    assert!(headers.to_lowercase().contains(&format!("content-length: {}", expected.len())), "{headers}");
    assert_eq!(body.len(), expected.len(), "a streamed body should be the length of the file");
    assert_eq!(body, expected, "the streamed bytes should be the file's bytes");

    let _ = std::fs::remove_dir_all(&dir);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_range_is_seeked_to_rather_than_sliced_out_of_a_buffer() {
    let (dir, expected) = media_with_track("range");
    let port = RANGE_PORT;
    let _coordinator = start_coordinator(port, &dir).await;

    let id = track_id(&expected);
    let path = format!("/api/v1/media/{id}");

    // A range that starts past the first chunk, so the seek is exercised, and
    // ends inside the file rather than at it, so an off-by-one at either end
    // shows up.
    let start = 100_000usize;
    let end = 150_000usize;
    let (headers, body) = get(port, &path, &format!("Range: bytes={start}-{end}\r\n")).await;

    assert!(headers.starts_with("HTTP/1.1 206"), "{headers}");
    let lower = headers.to_lowercase();
    assert!(lower.contains(&format!("content-range: bytes {start}-{end}/{}", expected.len())), "{headers}");
    assert!(lower.contains(&format!("content-length: {}", end - start + 1)), "{headers}");
    assert_eq!(body, expected[start..=end], "a range should be the file's bytes at that offset");

    // The last byte is the case an exclusive-vs-inclusive mistake gets wrong.
    let last = expected.len() - 1;
    let (headers, body) = get(port, &path, &format!("Range: bytes={last}-{last}\r\n")).await;
    assert!(headers.starts_with("HTTP/1.1 206"), "{headers}");
    assert_eq!(body, vec![expected[last]]);

    // A range beyond the file is a 416, not a short read.
    let past = expected.len();
    let (headers, _) = get(port, &path, &format!("Range: bytes={past}-\r\n")).await;
    assert!(headers.starts_with("HTTP/1.1 416"), "{headers}");

    let _ = std::fs::remove_dir_all(&dir);
}
