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

/// Where a track's embedded cover art sits inside its file.
///
/// A range rather than the picture itself. The scan already holds every file's
/// bytes long enough to hash them, so finding the art costs nothing extra —
/// but a folder of albums with a 400 kB cover each would be tens of megabytes
/// of coordinator memory for something almost nobody looks at twice. The
/// endpoint re-reads the range on demand.
#[derive(Debug, Clone)]
struct ArtworkRef {
    content_type: String,
    offset: u64,
    len: u32,
}

/// Largest embedded picture served. Beyond this the file is more likely to be
/// malformed than to hold a cover worth showing.
const MAX_ARTWORK_BYTES: u32 = 8 * 1024 * 1024;

/// One catalogue entry.
#[derive(Debug, Clone)]
struct Entry {
    item: MediaItem,
    source: Source,
    artwork: Option<ArtworkRef>,
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
    pub fn load(media_dirs: &[PathBuf]) -> Self {
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
                has_artwork: false,
                builtin: true,
            },
            source: Source::Memory(Arc::new(click)),
            artwork: None,
        });

        // Several roots rather than one, so a USB drive can be added beside the
        // music folder without either becoming "the" directory. Each is scanned
        // in the order given and a root that is not there is skipped: an
        // unplugged drive is a normal state, not a failure.
        let mut paths: Vec<PathBuf> = Vec::new();
        for root in media_dirs {
            let Ok(dir) = std::fs::read_dir(root) else {
                tracing::info!(dir = %root.display(), "media root is not readable; skipping it");
                continue;
            };
            let mut found: Vec<PathBuf> = dir
                .filter_map(Result::ok)
                .map(|e| e.path())
                .filter(|p| p.is_file() && has_audio_extension(p))
                .collect();
            found.sort();
            paths.extend(found);
        }

        for path in paths {
            match std::fs::read(&path) {
                Ok(bytes) => {
                    let digest = sha256_hex(&bytes);
                    let artwork = embedded_artwork(&bytes);
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
                            has_artwork: artwork.is_some(),
                            builtin: false,
                        },
                        // Held as a path, not as bytes: a media directory of
                        // albums should not be resident in memory.
                        source: Source::File(path.clone()),
                        artwork,
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
    /// Reads one item's embedded cover picture, with its MIME type.
    ///
    /// Re-read from the file rather than held in memory: the catalogue keeps
    /// only where the picture sits, so a folder of albums costs a few dozen
    /// bytes per track instead of a few hundred kilobytes.
    pub fn read_artwork(&self, id: &str) -> Option<(String, Vec<u8>)> {
        let entry = self.entries.get(id)?;
        let art = entry.artwork.as_ref()?;
        let from = art.offset as usize;
        let to = from + art.len as usize;
        match &entry.source {
            Source::Memory(bytes) => Some((art.content_type.clone(), bytes.get(from..to)?.to_vec())),
            Source::File(path) => {
                use std::io::{Read, Seek, SeekFrom};
                let mut file = std::fs::File::open(path).ok()?;
                file.seek(SeekFrom::Start(art.offset)).ok()?;
                let mut buffer = vec![0u8; art.len as usize];
                // The file may have been replaced since the scan, in which case
                // the range is meaningless — a short read is the signal.
                file.read_exact(&mut buffer).ok()?;
                Some((art.content_type.clone(), buffer))
            }
        }
    }

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

/// Strips a downloaded name back to something safe to write.
///
/// The name comes from a URL, so it can contain path separators, `..`, query
/// leftovers and percent escapes. Only the final component matters and only
/// plain characters survive.
pub fn safe_download_name(raw: &str) -> String {
    let decoded = raw.replace("%20", " ");
    let base = decoded.rsplit(['/', '\\']).next().unwrap_or("download");
    let cleaned: String = base
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | ' ') { c } else { '_' })
        .collect();
    let cleaned = cleaned.trim_matches(['.', ' ']).to_string();
    if cleaned.is_empty() {
        "download".to_string()
    } else {
        cleaned
    }
}

pub fn has_audio_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| AUDIO_EXTENSIONS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

/// Finds an embedded cover picture and returns where it sits in the file.
///
/// FLAC only, and deliberately so: every file in the library that prompted
/// this was FLAC, and a half-finished ID3 parser that mostly works is worse
/// than an honest `None`. MP3 keeps its art in an ID3v2 `APIC` frame whose
/// text encodings and two incompatible size formats are a separate piece of
/// work; when someone needs it, it belongs beside this function.
fn embedded_artwork(bytes: &[u8]) -> Option<ArtworkRef> {
    // "fLaC", then a chain of metadata blocks before any audio.
    if bytes.len() < 4 || &bytes[0..4] != b"fLaC" {
        return None;
    }
    let mut pos = 4usize;

    loop {
        let header = bytes.get(pos..pos + 4)?;
        let last = header[0] & 0x80 != 0;
        let block_type = header[0] & 0x7f;
        let block_len = u32::from_be_bytes([0, header[1], header[2], header[3]]) as usize;
        let body = pos + 4;
        // A length that runs past the end means a truncated or lying file.
        if body.checked_add(block_len)? > bytes.len() {
            return None;
        }

        // 6 is PICTURE.
        if block_type == 6 {
            if let Some(found) = flac_picture(bytes, body, block_len) {
                return Some(found);
            }
        }
        if last {
            return None;
        }
        pos = body + block_len;
    }
}

/// Reads one FLAC PICTURE block body.
///
/// Layout, all lengths big-endian u32: picture type, MIME length and string,
/// description length and string, then width, height, depth and colour count,
/// then the data length and the data itself. Every read is bounds-checked
/// against the block, because these lengths come out of a file on disk.
fn flac_picture(bytes: &[u8], body: usize, block_len: usize) -> Option<ArtworkRef> {
    let end = body + block_len;
    let u32_at = |at: usize| -> Option<u32> {
        let raw = bytes.get(at..at + 4)?;
        Some(u32::from_be_bytes([raw[0], raw[1], raw[2], raw[3]]))
    };

    let mut at = body + 4; // Skip the picture type.
    let mime_len = u32_at(at)? as usize;
    at += 4;
    let mime = std::str::from_utf8(bytes.get(at..at.checked_add(mime_len)?)?).ok()?;
    at += mime_len;

    let desc_len = u32_at(at)? as usize;
    at += 4 + desc_len;

    at = at.checked_add(16)?; // Width, height, depth, colours.
    let data_len = u32_at(at)?;
    at += 4;

    if at.checked_add(data_len as usize)? > end || data_len == 0 || data_len > MAX_ARTWORK_BYTES {
        return None;
    }
    // A picture the browser cannot render is not worth advertising.
    if !mime.starts_with("image/") {
        return None;
    }
    Some(ArtworkRef { content_type: mime.to_string(), offset: at as u64, len: data_len })
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
        let library = MediaLibrary::load(&[PathBuf::from("/nonexistent/homesync/media")]);
        let manifest = library.manifest();
        assert_eq!(manifest.items.len(), 1);
        assert_eq!(manifest.items[0].id, BUILTIN_CLICK_ID);
        assert!(manifest.items[0].builtin);
        assert!(library.contains(BUILTIN_CLICK_ID));
    }

    #[test]
    fn builtin_bytes_match_the_advertised_hash_and_length() {
        let library = MediaLibrary::load(&[PathBuf::from("/nonexistent/homesync/media")]);
        let item = library.item(BUILTIN_CLICK_ID).expect("item").clone();
        let bytes = library.read(BUILTIN_CLICK_ID).expect("present").expect("read");
        assert_eq!(bytes.len() as u64, item.bytes);
        assert_eq!(sha256_hex(&bytes), item.sha256);
    }

    #[test]
    fn unknown_ids_never_resolve_to_a_path() {
        let library = MediaLibrary::load(&[PathBuf::from("/nonexistent/homesync/media")]);
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

    #[test]
    fn several_roots_are_scanned_and_a_missing_one_is_skipped() {
        // A drive that is not plugged in is a normal state for a media root,
        // not a failure — the rest of the library must still load.
        let library = MediaLibrary::load(&[
            PathBuf::from("/nonexistent/homesync/one"),
            PathBuf::from("/nonexistent/homesync/two"),
        ]);
        assert_eq!(library.manifest().items.len(), 1, "the built-in click track survives");
        assert!(library.contains(BUILTIN_CLICK_ID));
    }

    #[test]
    fn a_downloaded_name_cannot_escape_its_folder() {
        // The name comes out of a URL, so it can carry separators, parent
        // traversal, and anything else that survived percent-decoding. Only the
        // last component may survive, and only as plain characters.
        assert_eq!(safe_download_name("../../etc/passwd.mp3"), "passwd.mp3");
        assert_eq!(safe_download_name("/absolute/path/song.flac"), "song.flac");
        assert_eq!(safe_download_name("..\\..\\windows\\evil.wav"), "evil.wav");
        assert_eq!(safe_download_name("My%20Track.mp3"), "My Track.mp3");
        assert_eq!(safe_download_name("we;ird|name?.flac"), "we_ird_name_.flac");
        assert_eq!(safe_download_name(""), "download");
        assert_eq!(safe_download_name("..."), "download");
        // A name that survives must still be recognisably the file asked for.
        assert_eq!(safe_download_name("02. This Love.flac"), "02. This Love.flac");
    }

    #[test]
    fn only_decodable_extensions_are_accepted_from_a_url() {
        // A URL ending in .zip or .exe is not something any receiver could
        // decode, and writing it would just leave rubbish in the folder.
        for name in ["song.mp3", "song.flac", "song.wav", "song.m4a"] {
            assert!(has_audio_extension(Path::new(name)), "{name}");
        }
        for name in ["payload.exe", "archive.zip", "page.html", "noextension"] {
            assert!(!has_audio_extension(Path::new(name)), "{name}");
        }
    }

    /// Builds a FLAC metadata chain: a stand-in STREAMINFO, then one PICTURE.
    ///
    /// Written out by hand rather than shipping a binary fixture, so the thing
    /// under test — the lengths — is visible in the test itself.
    fn flac_with_picture(mime: &str, data: &[u8], declared_len: Option<u32>) -> Vec<u8> {
        let mut picture = Vec::new();
        picture.extend_from_slice(&3u32.to_be_bytes()); // Picture type: front cover.
        picture.extend_from_slice(&(mime.len() as u32).to_be_bytes());
        picture.extend_from_slice(mime.as_bytes());
        let description = "cover";
        picture.extend_from_slice(&(description.len() as u32).to_be_bytes());
        picture.extend_from_slice(description.as_bytes());
        for value in [600u32, 600, 24, 0] {
            picture.extend_from_slice(&value.to_be_bytes());
        }
        picture.extend_from_slice(&declared_len.unwrap_or(data.len() as u32).to_be_bytes());
        picture.extend_from_slice(data);

        let mut out = Vec::from(*b"fLaC");
        // STREAMINFO, not the last block: the parser has to walk past it.
        out.push(0);
        out.extend_from_slice(&[0, 0, 8]);
        out.extend_from_slice(&[0u8; 8]);
        // PICTURE, last block.
        out.push(0x80 | 6);
        let len = picture.len() as u32;
        out.extend_from_slice(&[(len >> 16) as u8, (len >> 8) as u8, len as u8]);
        out.extend_from_slice(&picture);
        out
    }

    const PNG: &[u8] = b"\x89PNG\r\n\x1a\nsome pixels";

    #[test]
    fn a_cover_is_found_past_the_blocks_in_front_of_it() {
        let file = flac_with_picture("image/png", PNG, None);
        let art = embedded_artwork(&file).expect("a picture");
        assert_eq!(art.content_type, "image/png");
        assert_eq!(art.len as usize, PNG.len());
        // The offset must land exactly on the picture, not near it.
        assert_eq!(&file[art.offset as usize..art.offset as usize + PNG.len()], PNG);
    }

    #[test]
    fn a_file_that_is_not_flac_has_no_cover() {
        // An MP3 keeps its art in an ID3 frame this parser does not read, and
        // saying so honestly is better than a half-right guess.
        assert!(embedded_artwork(b"ID3\x03\x00\x00\x00\x00\x00\x00").is_none());
        assert!(embedded_artwork(b"").is_none());
        assert!(embedded_artwork(b"fLaC").is_none());
    }

    #[test]
    fn a_flac_without_a_picture_block_reports_none() {
        let mut out = Vec::from(*b"fLaC");
        out.push(0x80); // STREAMINFO, and the last block.
        out.extend_from_slice(&[0, 0, 4]);
        out.extend_from_slice(&[0u8; 4]);
        assert!(embedded_artwork(&out).is_none());
    }

    #[test]
    fn a_length_that_runs_past_the_block_is_refused() {
        // These lengths come from a file on disk. Trusting one would mean
        // serving whatever happened to follow it in memory.
        let file = flac_with_picture("image/png", PNG, Some(50_000));
        assert!(embedded_artwork(&file).is_none());
    }

    #[test]
    fn a_picture_the_browser_cannot_render_is_not_advertised() {
        let file = flac_with_picture("application/octet-stream", PNG, None);
        assert!(embedded_artwork(&file).is_none());
        // "-->" is the FLAC convention for a URL instead of image data.
        let linked = flac_with_picture("-->", b"https://example.com/cover.jpg", None);
        assert!(embedded_artwork(&linked).is_none());
    }

    #[test]
    fn an_absurdly_large_picture_is_refused() {
        let file = flac_with_picture("image/jpeg", PNG, Some(MAX_ARTWORK_BYTES + 1));
        assert!(embedded_artwork(&file).is_none());
    }
}
