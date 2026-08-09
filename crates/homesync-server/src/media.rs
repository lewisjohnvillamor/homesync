//! Media catalogue and byte delivery.
//!
//! The coordinator serves two kinds of media: files found in the configured
//! media directory, and media it synthesises itself. Exactly one synthesised
//! item exists today — a click track — and it is deliberately not optional.
//! Checkpoint 2 ("two laptops play the same preloaded click track without
//! obvious echo") has to be runnable on a fresh checkout with no audio files
//! on disk, because a transient sound with a sharp attack is the only signal
//! where a human ear reliably hears a few milliseconds of misalignment.

use homesync_protocol::{MediaItem, MediaManifest};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// Identifier of the synthesised click track.
pub const BUILTIN_CLICK_ID: &str = "builtin-click";

/// File extensions the scanner accepts. Decoding happens in the browser, so
/// this list only needs to match what `AudioContext.decodeAudioData` handles.
const AUDIO_EXTENSIONS: &[&str] = &["wav", "mp3", "m4a", "aac", "ogg", "oga", "opus", "flac", "webm"];

/// Where the bytes of one media item live.
#[derive(Debug, Clone)]
enum Source {
    /// Synthesised at startup and held in memory.
    Memory(Arc<Vec<u8>>),
    /// A file inside the configured media directory.
    File(PathBuf),
}

/// One catalogue entry.
#[derive(Debug, Clone)]
struct Entry {
    item: MediaItem,
    source: Source,
}

/// Immutable catalogue built once at startup.
#[derive(Debug, Clone, Default)]
pub struct MediaLibrary {
    entries: BTreeMap<String, Entry>,
    order: Vec<String>,
}

impl MediaLibrary {
    /// Builds the catalogue: the synthesised click track first, then any
    /// readable audio files in `media_dir` sorted by name.
    ///
    /// A missing or unreadable media directory is not an error — the click
    /// track alone is enough to run the timing checkpoints.
    pub fn load(media_dir: &Path) -> Self {
        let mut library = MediaLibrary::default();

        let click = click_track_wav();
        library.insert(Entry {
            item: MediaItem {
                id: BUILTIN_CLICK_ID.to_string(),
                title: "Click track (built-in, 60 s)".to_string(),
                bytes: click.len() as u64,
                sha256: sha256_hex(&click),
                content_type: "audio/wav".to_string(),
                duration_ns: Some(CLICK_SECONDS * 1_000_000_000),
                builtin: true,
            },
            source: Source::Memory(Arc::new(click)),
        });

        let Ok(dir) = std::fs::read_dir(media_dir) else {
            tracing::info!(dir = %media_dir.display(), "no media directory; serving built-in media only");
            return library;
        };

        let mut paths: Vec<PathBuf> =
            dir.filter_map(Result::ok).map(|e| e.path()).filter(|p| p.is_file() && has_audio_extension(p)).collect();
        paths.sort();

        for path in paths {
            match std::fs::read(&path) {
                Ok(bytes) => {
                    let digest = sha256_hex(&bytes);
                    let title = path
                        .file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_else(|| "unnamed".to_string());
                    library.insert(Entry {
                        item: MediaItem {
                            // The content hash is the identifier, so the same
                            // file keeps its id across restarts and renames.
                            id: digest[..16].to_string(),
                            title,
                            bytes: bytes.len() as u64,
                            sha256: digest,
                            content_type: content_type_for(&path),
                            duration_ns: wav_duration_ns(&bytes),
                            builtin: false,
                        },
                        // Held as a path, not as bytes: a media directory of
                        // albums should not be resident in memory.
                        source: Source::File(path.clone()),
                    });
                }
                Err(error) => {
                    tracing::warn!(path = %path.display(), %error, "skipping unreadable media file");
                }
            }
        }

        tracing::info!(count = library.order.len(), "media catalogue ready");
        library
    }

    fn insert(&mut self, entry: Entry) {
        let id = entry.item.id.clone();
        if self.entries.insert(id.clone(), entry).is_none() {
            self.order.push(id);
        }
    }

    /// Catalogue as published to clients, in display order.
    pub fn manifest(&self) -> MediaManifest {
        MediaManifest {
            items: self.order.iter().filter_map(|id| self.entries.get(id)).map(|e| e.item.clone()).collect(),
        }
    }

    /// Metadata for one item.
    pub fn item(&self, id: &str) -> Option<&MediaItem> {
        self.entries.get(id).map(|e| &e.item)
    }

    /// Whether the catalogue contains `id`.
    pub fn contains(&self, id: &str) -> bool {
        self.entries.contains_key(id)
    }

    /// Reads the bytes of one item.
    ///
    /// Only ids already in the catalogue resolve to a path, so no request can
    /// name an arbitrary file on disk (spec section 16).
    pub fn read(&self, id: &str) -> Option<std::io::Result<Vec<u8>>> {
        match &self.entries.get(id)?.source {
            Source::Memory(bytes) => Some(Ok(bytes.as_ref().clone())),
            Source::File(path) => Some(std::fs::read(path)),
        }
    }
}

/// Lowercase hex SHA-256.
pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

fn has_audio_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| AUDIO_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

fn content_type_for(path: &Path) -> String {
    mime_guess::from_path(path).first_or_octet_stream().to_string()
}

/// A single satisfiable byte range parsed from a `Range` header.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ByteRange {
    /// First byte index, inclusive.
    pub start: u64,
    /// Last byte index, inclusive.
    pub end: u64,
}

impl ByteRange {
    /// Number of bytes covered.
    pub fn len(&self) -> u64 {
        self.end - self.start + 1
    }
}

/// Parses a single-range `Range: bytes=...` header against a known length.
///
/// Returns `None` when the header is absent or not a form we support, in which
/// case the caller serves the whole body. Returns `Some(Err(()))` when the
/// range is syntactically fine but unsatisfiable, which must become a 416.
#[allow(clippy::result_unit_err)]
pub fn parse_range(header: Option<&str>, len: u64) -> Option<Result<ByteRange, ()>> {
    let raw = header?.trim();
    let spec = raw.strip_prefix("bytes=")?;
    // Multi-range requests are legal but pointless for our access pattern;
    // falling back to the full body is a valid response to them.
    if spec.contains(',') {
        return None;
    }
    let (start_txt, end_txt) = spec.split_once('-')?;
    let (start, end) = match (start_txt.trim(), end_txt.trim()) {
        ("", "") => return None,
        // Suffix range: the last N bytes.
        ("", n) => {
            let n: u64 = n.parse().ok()?;
            if n == 0 || len == 0 {
                return Some(Err(()));
            }
            (len.saturating_sub(n), len - 1)
        }
        (s, "") => {
            let s: u64 = s.parse().ok()?;
            (s, len.saturating_sub(1))
        }
        (s, e) => {
            let s: u64 = s.parse().ok()?;
            let e: u64 = e.parse().ok()?;
            (s, e.min(len.saturating_sub(1)))
        }
    };
    if len == 0 || start >= len || start > end {
        return Some(Err(()));
    }
    Some(Ok(ByteRange { start, end }))
}

/// Duration of a PCM WAV file, or `None` if the bytes are not a WAV we can
/// read. Receivers report their own decoded duration, so this is only a
/// convenience for the controller UI.
fn wav_duration_ns(bytes: &[u8]) -> Option<u64> {
    if bytes.len() < 12 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
        return None;
    }
    let mut pos = 12usize;
    let mut byte_rate: Option<u32> = None;
    while pos + 8 <= bytes.len() {
        let id = &bytes[pos..pos + 4];
        let size = u32::from_le_bytes(bytes[pos + 4..pos + 8].try_into().ok()?) as usize;
        let body = pos + 8;
        if id == b"fmt " && body + 16 <= bytes.len() {
            byte_rate = Some(u32::from_le_bytes(bytes[body + 8..body + 12].try_into().ok()?));
        } else if id == b"data" {
            let rate = byte_rate? as u64;
            if rate == 0 {
                return None;
            }
            let data_len = size.min(bytes.len().saturating_sub(body)) as u64;
            return Some(data_len * 1_000_000_000 / rate);
        }
        // Chunks are word aligned.
        pos = body + size + (size % 2);
    }
    None
}

/// Length of the synthesised click track, in seconds.
const CLICK_SECONDS: u64 = 60;
const CLICK_RATE: u32 = 48_000;
const CLICK_CHANNELS: u16 = 2;

/// Synthesises the click track: one transient every 500 ms, with every fourth
/// click pitched up so a listener can tell which beat they are hearing.
///
/// Each click is a fast-decaying sine. The sharp attack is the point — two
/// devices a few milliseconds apart produce an audible flam on a transient,
/// while the same error on sustained music is inaudible.
fn click_track_wav() -> Vec<u8> {
    let total_frames = (CLICK_RATE as u64 * CLICK_SECONDS) as usize;
    let mut samples = vec![0i16; total_frames * CLICK_CHANNELS as usize];

    let interval_frames = (CLICK_RATE / 2) as usize; // 500 ms
    let click_frames = (CLICK_RATE / 50) as usize; // 20 ms envelope tail
    let mut beat = 0usize;
    let mut start = 0usize;

    while start < total_frames {
        let frequency = if beat.is_multiple_of(4) { 1_760.0f64 } else { 880.0f64 };
        for i in 0..click_frames.min(total_frames - start) {
            let t = i as f64 / CLICK_RATE as f64;
            // ~60 dB of decay across the 20 ms tail.
            let envelope = (-t * 350.0).exp();
            let value = (t * frequency * std::f64::consts::TAU).sin() * envelope * 0.6;
            let pcm = (value * i16::MAX as f64) as i16;
            let frame = (start + i) * CLICK_CHANNELS as usize;
            samples[frame] = pcm;
            samples[frame + 1] = pcm;
        }
        beat += 1;
        start += interval_frames;
    }

    write_wav_s16(&samples, CLICK_RATE, CLICK_CHANNELS)
}

/// Serialises interleaved signed 16-bit samples as a canonical 44-byte-header
/// PCM WAV file.
fn write_wav_s16(samples: &[i16], sample_rate: u32, channels: u16) -> Vec<u8> {
    let bits_per_sample: u16 = 16;
    let block_align = channels * bits_per_sample / 8;
    let byte_rate = sample_rate * block_align as u32;
    let data_len = (samples.len() * 2) as u32;

    let mut out = Vec::with_capacity(44 + data_len as usize);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_len).to_le_bytes());
    out.extend_from_slice(b"WAVE");
    out.extend_from_slice(b"fmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes()); // PCM
    out.extend_from_slice(&channels.to_le_bytes());
    out.extend_from_slice(&sample_rate.to_le_bytes());
    out.extend_from_slice(&byte_rate.to_le_bytes());
    out.extend_from_slice(&block_align.to_le_bytes());
    out.extend_from_slice(&bits_per_sample.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    for s in samples {
        out.extend_from_slice(&s.to_le_bytes());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_click_track_is_a_readable_wav_of_the_right_length() {
        let wav = click_track_wav();
        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(&wav[8..12], b"WAVE");
        let duration = wav_duration_ns(&wav).expect("duration");
        let expected = CLICK_SECONDS * 1_000_000_000;
        assert_eq!(duration, expected, "click track should be exactly {CLICK_SECONDS}s");
    }

    #[test]
    fn click_track_actually_contains_transients() {
        let wav = click_track_wav();
        let pcm = &wav[44..];
        let peak = pcm.chunks_exact(2).map(|c| i16::from_le_bytes([c[0], c[1]]).unsigned_abs()).max().unwrap_or(0);
        assert!(peak > 10_000, "click track is too quiet to hear a flam: peak {peak}");
    }

    #[test]
    fn library_always_offers_the_builtin_even_without_a_media_directory() {
        let library = MediaLibrary::load(Path::new("/nonexistent/homesync/media"));
        let manifest = library.manifest();
        assert_eq!(manifest.items.len(), 1);
        assert_eq!(manifest.items[0].id, BUILTIN_CLICK_ID);
        assert!(manifest.items[0].builtin);
        assert!(library.contains(BUILTIN_CLICK_ID));
    }

    #[test]
    fn builtin_bytes_match_the_advertised_hash_and_length() {
        let library = MediaLibrary::load(Path::new("/nonexistent/homesync/media"));
        let item = library.item(BUILTIN_CLICK_ID).expect("item").clone();
        let bytes = library.read(BUILTIN_CLICK_ID).expect("present").expect("read");
        assert_eq!(bytes.len() as u64, item.bytes);
        assert_eq!(sha256_hex(&bytes), item.sha256);
    }

    #[test]
    fn unknown_ids_never_resolve_to_a_path() {
        let library = MediaLibrary::load(Path::new("/nonexistent/homesync/media"));
        assert!(library.read("../../etc/passwd").is_none());
        assert!(library.read("/etc/passwd").is_none());
    }

    #[test]
    fn range_header_parsing() {
        assert_eq!(parse_range(None, 100), None);
        assert_eq!(parse_range(Some("bytes=0-9"), 100), Some(Ok(ByteRange { start: 0, end: 9 })));
        assert_eq!(parse_range(Some("bytes=10-"), 100), Some(Ok(ByteRange { start: 10, end: 99 })));
        assert_eq!(parse_range(Some("bytes=-20"), 100), Some(Ok(ByteRange { start: 80, end: 99 })));
        // An end past the body is clamped rather than rejected.
        assert_eq!(parse_range(Some("bytes=90-500"), 100), Some(Ok(ByteRange { start: 90, end: 99 })));
        // Unsatisfiable.
        assert_eq!(parse_range(Some("bytes=100-200"), 100), Some(Err(())));
        assert_eq!(parse_range(Some("bytes=0-0"), 0), Some(Err(())));
        // Not a form we handle: serve the whole body instead.
        assert_eq!(parse_range(Some("items=0-9"), 100), None);
        assert_eq!(parse_range(Some("bytes=0-9,20-29"), 100), None);
        assert_eq!(parse_range(Some("bytes=abc-def"), 100), None);
    }

    #[test]
    fn range_length_is_inclusive() {
        assert_eq!(ByteRange { start: 0, end: 9 }.len(), 10);
    }
}
