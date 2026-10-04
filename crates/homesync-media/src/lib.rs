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

/// Extensions the scanner picks up. Decoding happens in the browser, so this
/// list only needs to match what `AudioContext.decodeAudioData` handles.
///
/// The list is what browsers can actually decode, not everything that is
/// music. `mp4` and `m4b` join `m4a` because all three are the same container
/// and people's libraries use all three; `aif`/`aiff` because uncompressed
/// Apple files are common on a Mac.
///
/// Deliberately absent: `wma`, which no browser outside Edge on Windows will
/// decode, and `ape`, `wv` and `dsf`, which none will. Listing a file the room
/// cannot play is worse than not listing it — it puts a track in the queue
/// that stops the room instead of playing.
const AUDIO_EXTENSIONS: &[&str] =
    &["wav", "mp3", "m4a", "m4b", "mp4", "aac", "ogg", "oga", "opus", "flac", "webm", "aif", "aiff"];

/// Where the bytes of one media item live.
///
/// Public because it is what the byte-serving endpoint is handed: a location
/// rather than the bytes, so it can seek to the range it was asked for and
/// stream it instead of holding the whole track in memory.
#[derive(Debug, Clone)]
pub enum ItemSource {
    /// Synthesised at startup and held in memory. Shared, not copied.
    Memory(Arc<Vec<u8>>),
    /// A file inside the configured media directory.
    File(PathBuf),
}

/// Where a track's embedded cover art sits inside its file.
///
/// A range rather than the picture itself. The scan already has the file's
/// opening bytes in hand to hash them, so finding the art costs nothing extra —
/// but a folder of albums with a 400 kB cover each would be tens of megabytes
/// of coordinator memory for something almost nobody looks at twice. The
/// endpoint re-reads the range on demand.
#[derive(Debug, Clone)]
pub struct ArtworkRef {
    /// MIME type, always beginning `image/`.
    pub content_type: String,
    /// Where the picture starts in the file.
    pub offset: u64,
    /// How many bytes it runs for. Never zero.
    pub len: u32,
}

/// Largest embedded picture served. Beyond this the file is more likely to be
/// malformed than to hold a cover worth showing.
const MAX_ARTWORK_BYTES: u32 = 8 * 1024 * 1024;

/// Longest tag value kept, in characters.
///
/// Tags are attacker-controlled: a file can declare a title a megabyte long,
/// and every one of those bytes would then ride in every catalogue sent to
/// every device. No real title is close to this.
const MAX_TAG_CHARS: usize = 200;

/// What a file's tags say about it.
///
/// Every field is optional because every field is routinely missing, and a
/// guess would be worse than a blank: an album column filled with filenames
/// cannot be sorted, grouped or trusted.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Tags {
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    /// Track number within the album, where the file says so.
    pub track: Option<u32>,
}

impl Tags {
    /// Whether nothing at all was found.
    pub fn is_empty(&self) -> bool {
        *self == Self::default()
    }

    /// Stores `value` under `key` unless that field is already filled.
    ///
    /// First writer wins, so a file carrying both an ID3 tag and a Vorbis
    /// comment — or simply a duplicate frame — keeps the earlier one rather
    /// than whichever happens to be parsed last.
    fn set(&mut self, field: TagField, value: &str) {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            return;
        }
        let slot = match field {
            TagField::Title => &mut self.title,
            TagField::Artist => &mut self.artist,
            TagField::Album => &mut self.album,
            TagField::Track => {
                if self.track.is_none() {
                    // "4/12" is how a track number is usually written, and the
                    // total is not what this field is.
                    let head = trimmed.split(['/', '-']).next().unwrap_or(trimmed);
                    self.track = head.trim().parse::<u32>().ok().filter(|n| *n > 0);
                }
                return;
            }
        };
        if slot.is_none() {
            *slot = Some(trimmed.chars().take(MAX_TAG_CHARS).collect());
        }
    }
}

/// The four tag fields read, named so the three container parsers can share
/// one setter rather than each reimplementing the limits.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TagField {
    Title,
    Artist,
    Album,
    Track,
}

/// One catalogue entry.
#[derive(Debug, Clone)]
struct Entry {
    item: MediaItem,
    source: ItemSource,
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
                artist: None,
                album: None,
                track: None,
                bytes: click.len() as u64,
                sha256: sha256_hex(&click),
                content_type: "audio/wav".to_string(),
                duration_ns: Some(CLICK_SECONDS * 1_000_000_000),
                has_artwork: false,
                builtin: true,
            },
            source: ItemSource::Memory(Arc::new(click)),
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
            match scan_file(&path, SCAN_WINDOW) {
                Ok(scanned) => {
                    let filename = path
                        .file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_else(|| "unnamed".to_string());
                    // The tag wins where there is one, and the filename is the
                    // fallback rather than the other way round: a library of
                    // "04 - track.mp3" is not a library you can read.
                    let title = scanned.tags.title.clone().unwrap_or(filename);
                    library.insert(Entry {
                        item: MediaItem {
                            // The content hash is the identifier, so the same
                            // file keeps its id across restarts and renames.
                            id: scanned.digest[..16].to_string(),
                            title,
                            artist: scanned.tags.artist.clone(),
                            album: scanned.tags.album.clone(),
                            track: scanned.tags.track,
                            bytes: scanned.len,
                            sha256: scanned.digest,
                            content_type: content_type_for(&path),
                            duration_ns: scanned.duration_ns,
                            has_artwork: scanned.artwork.is_some(),
                            builtin: false,
                        },
                        // Held as a path, not as bytes: a media directory of
                        // albums should not be resident in memory.
                        source: ItemSource::File(path.clone()),
                        artwork: scanned.artwork,
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
            ItemSource::Memory(bytes) => Some((art.content_type.clone(), bytes.get(from..to)?.to_vec())),
            ItemSource::File(path) => {
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

    /// Whether the catalogue contains `id`.
    pub fn contains(&self, id: &str) -> bool {
        self.entries.contains_key(id)
    }

    /// Where one item's bytes live.
    ///
    /// Only ids already in the catalogue resolve to a path, so no request can
    /// name an arbitrary file on disk (spec section 16).
    pub fn source(&self, id: &str) -> Option<ItemSource> {
        self.entries.get(id).map(|entry| entry.source.clone())
    }
}

/// How much of a file the scan keeps in memory to read metadata out of.
///
/// The scan needs two things from a file: its hash, which streams, and its
/// tags, which do not — the parsers below index into a slice. Keeping a bounded
/// window rather than the whole file caps the scan's memory at this size
/// however long the track is, which is what makes an audiobook or a live set
/// cost the same to index as a three-minute song.
///
/// 16 MiB because a picture can be up to `MAX_ARTWORK_BYTES` (8 MiB) and the
/// tag carrying it sits ahead of it, so this holds any cover we would accept
/// plus a generous amount of tag in front. Every ordinary music file is smaller
/// than the window and so is read whole, exactly as before.
const SCAN_WINDOW: usize = 16 * 1024 * 1024;

/// What one pass over a media file yields.
struct ScannedFile {
    len: u64,
    digest: String,
    artwork: Option<ArtworkRef>,
    duration_ns: Option<u64>,
    tags: Tags,
}

/// Reads a media file once, in chunks, and returns everything the catalogue
/// needs from it.
///
/// One sequential pass: every byte goes through the hasher, and the first
/// `window` bytes are also kept so the tag parsers have something to index
/// into. Peak memory is `window` plus one chunk, not the size of the file.
///
/// `window` is a parameter rather than the constant so tests can exercise the
/// windowed path without writing a 16 MiB file.
fn scan_file(path: &Path, window: usize) -> std::io::Result<ScannedFile> {
    use std::io::Read;

    let mut file = std::fs::File::open(path)?;
    let mut hasher = Sha256::new();
    // Sized up front rather than grown. A `Vec` that reaches the window by
    // doubling holds the old buffer and the new one at the moment it reallocs,
    // so the scan's true peak was half again what the window claims. The file's
    // own length caps it, so a short file does not reserve for a long one.
    let reserve = file.metadata()?.len().min(window as u64) as usize;
    let mut head: Vec<u8> = Vec::with_capacity(reserve);
    let mut chunk = vec![0u8; 64 * 1024];
    let mut len: u64 = 0;

    loop {
        let read = file.read(&mut chunk)?;
        if read == 0 {
            break;
        }
        hasher.update(&chunk[..read]);
        len += read as u64;
        if head.len() < window {
            let want = (window - head.len()).min(read);
            head.extend_from_slice(&chunk[..want]);
        }
    }

    let digest = hex::encode(hasher.finalize());
    let truncated = len > head.len() as u64;

    // The parsers bound themselves by the slice they are given, so on a
    // truncated window they refuse a picture that runs past its end rather
    // than returning a range that is really there. For an MP4 that is the
    // common case and not an edge one: `moov` is often written after the audio,
    // which puts the cover at the far end of the file. So look for it.
    let mut artwork = embedded_artwork(&head);
    if artwork.is_none() && truncated && looks_like_mp4(&head) {
        artwork = mp4_artwork_far(&mut file, len, window);
    }
    // A range the window could not see the end of would be a promise the
    // artwork endpoint cannot keep.
    if let Some(art) = &artwork {
        if art.offset.saturating_add(art.len as u64) > len {
            artwork = None;
        }
    }

    let duration_ns = wav_duration_ns(&head, len);
    // Read from the same window the artwork is, and for the same reason: tags
    // live near the front of every container here. A tag the window could not
    // see the end of simply is not found, which is a missing field rather than
    // a wrong one.
    let tags = embedded_tags(&head);
    Ok(ScannedFile { len, digest, artwork, duration_ns, tags })
}

/// Whether these opening bytes are an MP4 family container: a size, then the
/// `ftyp` brand at offset 4.
fn looks_like_mp4(bytes: &[u8]) -> bool {
    bytes.len() > 8 && &bytes[4..8] == b"ftyp"
}

/// Top-level atoms the walk will visit before giving up.
///
/// A real MP4 has a handful — `ftyp`, `moov`, `mdat`, perhaps `free`. The cap
/// exists because the walk costs a seek and a read per atom, and an atom may
/// declare itself the minimum eight bytes long: a file of nothing but those
/// asks for one syscall pair per eight bytes of it, turning a 300 MB download
/// into tens of millions of them. Bounding the walk costs nothing a real file
/// will ever notice.
const MAX_TOP_LEVEL_ATOMS: usize = 4096;

/// Finds a cover in an MP4 whose `moov` atom sits beyond the scan window.
///
/// Top-level MP4 atoms are a flat list of length-prefixed boxes, so `moov` can
/// be found with a handful of seeks and no reading of the audio in between.
/// Only that one atom is then read — it holds the tags, and is small next to
/// the file it describes. Offsets inside it are rebased to the file so the
/// artwork endpoint can seek straight to the picture.
fn mp4_artwork_far(file: &mut std::fs::File, len: u64, window: usize) -> Option<ArtworkRef> {
    use std::io::{Read, Seek, SeekFrom};

    let mut at: u64 = 0;
    for _ in 0..MAX_TOP_LEVEL_ATOMS {
        if at + 8 > len {
            return None;
        }
        file.seek(SeekFrom::Start(at)).ok()?;
        let mut header = [0u8; 8];
        file.read_exact(&mut header).ok()?;
        let size = u32::from_be_bytes(header[0..4].try_into().ok()?) as u64;
        let name = &header[4..8];
        // 0 means "runs to the end of the file"; 1 means a 64-bit size follows
        // the header. Anything under the header itself is malformed, and
        // walking it would not terminate.
        let size = match size {
            0 => len - at,
            1 => {
                let mut wide = [0u8; 8];
                file.read_exact(&mut wide).ok()?;
                u64::from_be_bytes(wide)
            }
            other => other,
        };
        if size < 8 || at.checked_add(size)? > len {
            return None;
        }
        if name == b"moov" {
            // A `moov` larger than the window is not a tag block, it is a
            // malformed file — refuse it rather than let a size field in the
            // file decide how much memory to allocate.
            if size > window as u64 {
                return None;
            }
            let mut buffer = vec![0u8; size as usize];
            file.seek(SeekFrom::Start(at)).ok()?;
            file.read_exact(&mut buffer).ok()?;
            // The buffer begins at the `moov` header, which is exactly what
            // `mp4_artwork` expects to walk from.
            let found = mp4_artwork(&buffer)?;
            return Some(ArtworkRef { offset: found.offset.checked_add(at)?, ..found });
        }
        at += size;
    }
    None
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

/// Finds a cover picture in arbitrary bytes, for fuzzing and for callers who
/// have a file in hand rather than a catalogue entry.
///
/// The parsers underneath read lengths and offsets out of the file itself, so
/// this is the widest attack surface in the crate — public so `cargo fuzz` can
/// reach it, and so the invariant it promises can be stated: any range returned
/// lies inside `bytes`, is non-empty, and describes an image.
pub fn probe_artwork(bytes: &[u8]) -> Option<ArtworkRef> {
    embedded_artwork(bytes)
}

/// Reads a file's title, artist, album and track number, where it carries them.
///
/// Exposed for the fuzz targets, which drive it against mutated files: this
/// reads lengths and counts out of a stranger's file, which is the only kind of
/// arithmetic in this crate worth being nervous about.
pub fn probe_tags(bytes: &[u8]) -> Tags {
    embedded_tags(bytes)
}

/// Finds a file's tags, choosing a parser from its first bytes.
///
/// The same three containers as the artwork, carrying the same information in
/// three unrelated ways: a FLAC `VORBIS_COMMENT` block, ID3v2 text frames, and
/// MP4 `ilst` atoms. A WAV has nowhere to put any of this, so it gets nothing
/// and falls back to its filename.
fn embedded_tags(bytes: &[u8]) -> Tags {
    if bytes.starts_with(b"fLaC") {
        return flac_tags(bytes);
    }
    if bytes.starts_with(b"ID3") {
        return id3_tags(bytes);
    }
    if looks_like_mp4(bytes) {
        return mp4_tags(bytes);
    }
    Tags::default()
}

/// Finds an embedded cover picture and returns where it sits in the file.
///
/// Three containers, three completely unrelated ways of carrying the same
/// picture: a FLAC `PICTURE` metadata block, an ID3v2 `APIC` frame, and an MP4
/// `covr` atom. Each is walked by its own function below; this one only decides
/// which, from the file's first bytes rather than from its extension, because a
/// `.m4a` and a `.mp4` are the same container and a mistagged file is common.
///
/// Anything else returns `None`. An honest "no artwork" is better than a
/// half-finished parser that returns the wrong bytes.
fn embedded_artwork(bytes: &[u8]) -> Option<ArtworkRef> {
    if bytes.starts_with(b"fLaC") {
        return flac_artwork(bytes);
    }
    if bytes.starts_with(b"ID3") {
        return id3_artwork(bytes);
    }
    // An MP4/M4A begins with a size then "ftyp"; the size is at 0, the brand
    // at 4, which is why this looks at an offset rather than a prefix.
    if bytes.len() > 8 && &bytes[4..8] == b"ftyp" {
        return mp4_artwork(bytes);
    }
    None
}

/// Walks FLAC metadata blocks for a PICTURE.
fn flac_artwork(bytes: &[u8]) -> Option<ArtworkRef> {
    let mut found = None;
    flac_blocks(bytes, |block_type, body, block_len| {
        // 6 is PICTURE.
        if block_type != 6 {
            return true;
        }
        found = flac_picture(bytes, body, block_len);
        found.is_none()
    });
    found
}

/// Walks FLAC metadata blocks, handing each one's type and body range to
/// `visit`. Stops when `visit` returns `false`, at the block marked last, or at
/// the first length that runs past the end of what we hold.
fn flac_blocks(bytes: &[u8], mut visit: impl FnMut(u8, usize, usize) -> bool) -> Option<()> {
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

        if !visit(block_type, body, block_len) {
            return Some(());
        }
        if last {
            return Some(());
        }
        pos = body + block_len;
    }
}

/// Comment fields read from a Vorbis comment block before giving up.
///
/// The block declares its own count, so a file can claim four billion
/// comments. A real one has a dozen, and the four fields wanted are always
/// near the front.
const MAX_VORBIS_COMMENTS: u32 = 512;

/// Reads a FLAC file's VORBIS_COMMENT block.
fn flac_tags(bytes: &[u8]) -> Tags {
    let mut tags = Tags::default();
    flac_blocks(bytes, |block_type, body, block_len| {
        // 4 is VORBIS_COMMENT.
        if block_type != 4 {
            return true;
        }
        if let Some(found) = vorbis_comments(bytes, body, block_len) {
            tags = found;
        }
        false
    });
    tags
}

/// Parses a Vorbis comment block body: a vendor string, a count, then that
/// many `KEY=value` strings. Every length is little-endian, which is the one
/// thing in a FLAC file that is.
fn vorbis_comments(bytes: &[u8], body: usize, block_len: usize) -> Option<Tags> {
    let end = body.checked_add(block_len)?;
    let mut at = body;

    let vendor_len = read_u32_le(bytes, at)? as usize;
    at = at.checked_add(4)?.checked_add(vendor_len)?;
    if at > end {
        return None;
    }

    let count = read_u32_le(bytes, at)?.min(MAX_VORBIS_COMMENTS);
    at = at.checked_add(4)?;

    let mut tags = Tags::default();
    for _ in 0..count {
        // Every way of running out returns what was read rather than
        // discarding it. The count comes out of the file, so a tagger that
        // wrote one too many — or a truncated block — would otherwise throw
        // away the title it had already parsed correctly.
        let Some(len) = read_u32_le(bytes, at).map(|len| len as usize) else { return Some(tags) };
        let Some(start) = at.checked_add(4) else { return Some(tags) };
        let Some(stop) = start.checked_add(len) else { return Some(tags) };
        if stop > end {
            return Some(tags);
        }
        let Some(raw) = bytes.get(start..stop) else { return Some(tags) };
        let comment = String::from_utf8_lossy(raw);
        if let Some((key, value)) = comment.split_once('=') {
            let field = match key.to_ascii_uppercase().as_str() {
                "TITLE" => Some(TagField::Title),
                "ARTIST" => Some(TagField::Artist),
                "ALBUM" => Some(TagField::Album),
                "TRACKNUMBER" => Some(TagField::Track),
                _ => None,
            };
            if let Some(field) = field {
                tags.set(field, value);
            }
        }
        at = stop;
    }
    Some(tags)
}

/// Little-endian `u32` at `at`, or `None` if four bytes are not there.
fn read_u32_le(bytes: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes(bytes.get(at..at.checked_add(4)?)?.try_into().ok()?))
}

/// Finds an `APIC` frame in an ID3v2 tag, as MP3 files carry cover art.
///
/// v2.3 and v2.4 only. v2.2 used three-character frame ids and three-byte
/// sizes, and files old enough to have one are rare enough that guessing at
/// them would add a second parser for almost nobody.
fn id3_artwork(bytes: &[u8]) -> Option<ArtworkRef> {
    let mut found = None;
    id3_frames(bytes, |id, body, size| {
        if id != b"APIC" {
            return true;
        }
        found = apic_picture(bytes, body, size);
        // Keep walking only while nothing usable has been found: a file can
        // carry several APIC frames and the first may be one this refuses.
        found.is_none()
    });
    found
}

/// Walks the frames of an ID3v2 tag, handing each frame's id and body range to
/// `visit`. Walking stops when `visit` returns `false`, or at the first thing
/// that does not look like a frame.
///
/// One walk shared by the picture parser and the text-tag parser. The delicate
/// parts — the synchsafe sizes, the version difference in how they are
/// written, the extended header, the padding that ends a tag — are the kind
/// that would drift apart if there were two copies.
fn id3_frames(bytes: &[u8], mut visit: impl FnMut(&[u8], usize, usize) -> bool) -> Option<()> {
    let header = bytes.get(0..10)?;
    let major = header[3];
    if !(3..=4).contains(&major) {
        return None;
    }
    // The tag size is "synchsafe": seven bits per byte, so a size can never
    // contain a byte that looks like the start of an audio frame.
    let tag_size = synchsafe(&header[6..10])? as usize;
    let tag_end = 10usize.checked_add(tag_size)?.min(bytes.len());

    let mut at = 10usize;
    // An extended header sits between the tag header and the first frame.
    if header[5] & 0x40 != 0 {
        let ext = bytes.get(at..at + 4)?;
        let ext_size =
            if major == 4 { synchsafe(ext)? as usize } else { u32::from_be_bytes(ext.try_into().ok()?) as usize + 4 };
        at = at.checked_add(ext_size)?;
    }

    while at + 10 <= tag_end {
        let frame = bytes.get(at..at + 10)?;
        // Padding: the rest of the tag is zeroes, not another frame.
        if frame[0] == 0 {
            return None;
        }
        // v2.4 made frame sizes synchsafe too; v2.3 left them plain. Reading
        // one as the other silently walks into the middle of a frame.
        let size = if major == 4 {
            synchsafe(&frame[4..8])? as usize
        } else {
            u32::from_be_bytes([frame[4], frame[5], frame[6], frame[7]]) as usize
        };
        let body = at + 10;
        if body.checked_add(size)? > tag_end {
            return None;
        }
        if !visit(&frame[0..4], body, size) {
            return Some(());
        }
        at = body + size;
    }
    Some(())
}

/// Reads the text frames of an ID3v2 tag: title, artist, album, track number.
fn id3_tags(bytes: &[u8]) -> Tags {
    let mut tags = Tags::default();
    id3_frames(bytes, |id, body, size| {
        let field = match id {
            b"TIT2" => TagField::Title,
            b"TPE1" => TagField::Artist,
            b"TALB" => TagField::Album,
            b"TRCK" => TagField::Track,
            _ => return true,
        };
        if let Some(text) = id3_text(bytes, body, size) {
            tags.set(field, &text);
        }
        true
    });
    tags
}

/// Decodes an ID3v2 text frame body: one encoding byte, then the string.
///
/// Four encodings, and reading one as another is not a cosmetic error — a
/// UTF-16 title read as Latin-1 comes out as every other character separated by
/// nulls. The read is capped well above any real title, so a frame declaring a
/// megabyte of text costs a bounded amount of work rather than a megabyte of
/// allocation per track in the library.
fn id3_text(bytes: &[u8], body: usize, size: usize) -> Option<String> {
    let encoding = *bytes.get(body)?;
    let end = body.checked_add(size)?;
    let text_start = body + 1;
    // Four bytes per character is the worst case of any encoding here.
    let capped = end.min(text_start.saturating_add(MAX_TAG_CHARS.saturating_mul(4)));
    let raw = bytes.get(text_start..capped)?;

    let decoded = match encoding {
        // UTF-16 with a byte-order mark, then UTF-16 big-endian without one.
        1 | 2 => {
            let (raw, big_endian) = match (encoding, raw.get(0..2)) {
                (1, Some([0xff, 0xfe])) => (&raw[2..], false),
                (1, Some([0xfe, 0xff])) => (&raw[2..], true),
                // A declared BOM that is not there. Big-endian is what the
                // specification says to assume.
                (1, _) => (raw, true),
                _ => (raw, true),
            };
            let units: Vec<u16> = raw
                .chunks_exact(2)
                .map(|pair| {
                    if big_endian {
                        u16::from_be_bytes([pair[0], pair[1]])
                    } else {
                        u16::from_le_bytes([pair[0], pair[1]])
                    }
                })
                .collect();
            String::from_utf16_lossy(&units)
        }
        3 => String::from_utf8_lossy(raw).into_owned(),
        // Latin-1. Every byte is its own code point, which is the one encoding
        // where that is true and the reason it cannot fail.
        _ => raw.iter().map(|b| *b as char).collect(),
    };

    // A frame is null-terminated, and v2.4 separates multiple values with
    // nulls. The first value is the one that belongs in a single field.
    let first = decoded.split('\0').next().unwrap_or("").trim().to_string();
    (!first.is_empty()).then_some(first)
}

/// Reads an `APIC` frame body: text encoding, MIME, picture type, description,
/// then the image.
fn apic_picture(bytes: &[u8], body: usize, size: usize) -> Option<ArtworkRef> {
    let end = body + size;
    let encoding = *bytes.get(body)?;
    let mut at = body + 1;

    // MIME is always Latin-1 and null-terminated, whatever the text encoding.
    let mime_end = bytes.get(at..end)?.iter().position(|b| *b == 0)? + at;
    let mime = std::str::from_utf8(bytes.get(at..mime_end)?).ok()?.to_ascii_lowercase();
    at = mime_end + 1;

    at = at.checked_add(1)?; // Picture type.

    // The description uses the frame's encoding, and the two UTF-16 encodings
    // terminate on a *pair* of zero bytes — stopping at the first one lands
    // inside the terminator and shifts every following byte.
    at = match encoding {
        1 | 2 => {
            let mut scan = at;
            loop {
                let pair = bytes.get(scan..scan + 2)?;
                if pair == [0, 0] {
                    break scan + 2;
                }
                scan += 2;
            }
        }
        _ => bytes.get(at..end)?.iter().position(|b| *b == 0)? + at + 1,
    };

    let len = end.checked_sub(at)?;
    artwork_ref(&normalise_mime(&mime), at, len)
}

/// Finds the `covr` atom an MP4, M4A or M4B keeps its cover in.
fn mp4_artwork(bytes: &[u8]) -> Option<ArtworkRef> {
    let ilst = find_atom(bytes, 0, bytes.len(), &[b"moov", b"udta", b"meta", b"ilst"])?;
    let covr = find_atom(bytes, ilst.0, ilst.1, &[b"covr"])?;
    // Inside `covr` is a `data` atom: size, "data", four flag bytes whose low
    // byte is the image format, four reserved bytes, then the image.
    let data = find_atom(bytes, covr.0, covr.1, &[b"data"])?;
    let flags = bytes.get(data.0..data.0 + 4)?;
    let content_type = match flags[3] {
        13 => "image/jpeg",
        14 => "image/png",
        _ => return None,
    };
    let start = data.0 + 8;
    let len = data.1.checked_sub(start)?;
    artwork_ref(content_type, start, len)
}

/// Reads the `ilst` metadata an MP4, M4A or M4B keeps its tags in.
fn mp4_tags(bytes: &[u8]) -> Tags {
    let mut tags = Tags::default();
    let Some(ilst) = find_atom(bytes, 0, bytes.len(), &[b"moov", b"udta", b"meta", b"ilst"]) else {
        return tags;
    };

    // The atom names are the iTunes convention: a copyright sign, which is
    // 0xa9 in the single byte MP4 uses for it, then three letters.
    for (name, field) in [(b"\xa9nam", TagField::Title), (b"\xa9ART", TagField::Artist), (b"\xa9alb", TagField::Album)]
    {
        if let Some(text) = mp4_text(bytes, ilst, name) {
            tags.set(field, &text);
        }
    }
    if let Some(track) = mp4_track_number(bytes, ilst) {
        tags.set(TagField::Track, &track.to_string());
    }
    tags
}

/// Reads one text atom out of an `ilst`.
///
/// Inside the named atom is a `data` atom: four flag bytes whose low byte says
/// what the payload is, four reserved bytes, then the payload. Only the UTF-8
/// and Latin-1 types are read; anything else is a type this does not
/// understand, and guessing would put mojibake in the library.
fn mp4_text(bytes: &[u8], ilst: (usize, usize), name: &[u8; 4]) -> Option<String> {
    let atom = find_atom(bytes, ilst.0, ilst.1, &[name])?;
    let data = find_atom(bytes, atom.0, atom.1, &[b"data"])?;
    let kind = *bytes.get(data.0 + 3)?;
    let start = data.0.checked_add(8)?;
    let capped = data.1.min(start.saturating_add(MAX_TAG_CHARS.saturating_mul(4)));
    let raw = bytes.get(start..capped)?;
    match kind {
        1 => Some(String::from_utf8_lossy(raw).into_owned()),
        // 0 is "binary", which some taggers use for plain Latin-1 text.
        0 => Some(raw.iter().map(|b| *b as char).collect()),
        _ => None,
    }
}

/// Reads the track number out of an `ilst`'s `trkn` atom.
///
/// `trkn` is binary rather than text: eight bytes, of which the track number
/// is the big-endian pair at offset two. The pair after it is the album's
/// total, which is not what this field is.
fn mp4_track_number(bytes: &[u8], ilst: (usize, usize)) -> Option<u32> {
    let atom = find_atom(bytes, ilst.0, ilst.1, &[b"trkn"])?;
    let data = find_atom(bytes, atom.0, atom.1, &[b"data"])?;
    let payload = bytes.get(data.0 + 8..data.1)?;
    let number = u16::from_be_bytes(payload.get(2..4)?.try_into().ok()?);
    (number > 0).then_some(u32::from(number))
}

/// Walks a path of MP4 atoms and returns the body range of the last one.
fn find_atom(bytes: &[u8], mut from: usize, mut to: usize, path: &[&[u8; 4]]) -> Option<(usize, usize)> {
    for (depth, want) in path.iter().enumerate() {
        let mut at = from;
        let mut found = None;
        while at + 8 <= to {
            let size = u32::from_be_bytes(bytes.get(at..at + 4)?.try_into().ok()?) as usize;
            let name = bytes.get(at + 4..at + 8)?;
            // A zero size means "to the end of the file"; anything under the
            // header is a malformed atom and walking it would not terminate.
            let size = if size == 0 { to - at } else { size };
            if size < 8 || at + size > to {
                return None;
            }
            if name == *want {
                // `meta` is a full atom: four bytes of version and flags sit
                // between its header and its children. Missing this is why a
                // naive walker finds `ilst` in some files and not others.
                let skip = if *want == b"meta" { 12 } else { 8 };
                found = Some((at + skip, at + size));
                break;
            }
            at += size;
        }
        let (start, end) = found?;
        from = start;
        to = end;
        let _ = depth;
    }
    Some((from, to))
}

/// Seven-bit-per-byte integer, as ID3 uses for sizes.
fn synchsafe(raw: &[u8]) -> Option<u32> {
    if raw.len() != 4 || raw.iter().any(|b| b & 0x80 != 0) {
        return None;
    }
    Some(((raw[0] as u32) << 21) | ((raw[1] as u32) << 14) | ((raw[2] as u32) << 7) | raw[3] as u32)
}

/// Some taggers write `image/jpg` or a bare `JPG` where a MIME type belongs.
fn normalise_mime(mime: &str) -> String {
    match mime {
        "image/jpg" | "jpg" | "jpeg" => "image/jpeg".to_string(),
        "png" => "image/png".to_string(),
        other => other.to_string(),
    }
}

/// The one place a picture is accepted, so every parser gets the same limits.
fn artwork_ref(content_type: &str, offset: usize, len: usize) -> Option<ArtworkRef> {
    if len == 0 || len > MAX_ARTWORK_BYTES as usize || !content_type.starts_with("image/") {
        return None;
    }
    Some(ArtworkRef { content_type: content_type.to_string(), offset: offset as u64, len: len as u32 })
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

    if at.checked_add(data_len as usize)? > end {
        return None;
    }
    artwork_ref(&normalise_mime(&mime.to_ascii_lowercase()), at, data_len as usize)
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

    /// Always false, and present because a public `len` without one reads as an
    /// oversight. Both ends are inclusive, so the smallest range this type can
    /// express is one byte — an empty range is not representable rather than
    /// merely unusual, and `parse_range` refuses the headers that would ask for
    /// one.
    pub fn is_empty(&self) -> bool {
        false
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
///
/// `total_len` is the length of the whole file, which may be longer than
/// `bytes` when only a window of it was read. A `data` chunk that claims more
/// than the file holds is clamped to the file, not to the window — otherwise a
/// long WAV would report the duration of the part that happened to be read.
fn wav_duration_ns(bytes: &[u8], total_len: u64) -> Option<u64> {
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
            let data_len = (size as u64).min(total_len.saturating_sub(body as u64));
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
        let duration = wav_duration_ns(&wav, wav.len() as u64).expect("duration");
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
        let ItemSource::Memory(bytes) = library.source(BUILTIN_CLICK_ID).expect("present") else {
            panic!("the built-in click track is synthesised, so it lives in memory");
        };
        assert_eq!(bytes.len() as u64, item.bytes);
        assert_eq!(sha256_hex(&bytes), item.sha256);
    }

    #[test]
    fn unknown_ids_never_resolve_to_a_path() {
        let library = MediaLibrary::load(&[PathBuf::from("/nonexistent/homesync/media")]);
        assert!(library.source("../../etc/passwd").is_none());
        assert!(library.source("/etc/passwd").is_none());
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
    pub(super) fn flac_with_picture(mime: &str, data: &[u8], declared_len: Option<u32>) -> Vec<u8> {
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

    /// An ID3v2 tag holding one APIC frame, in either major version.
    pub(super) fn mp3_with_cover(major: u8, encoding: u8, mime: &[u8], description: &[u8], data: &[u8]) -> Vec<u8> {
        let mut body = vec![encoding];
        body.extend_from_slice(mime);
        body.push(0);
        body.push(3); // Front cover.
        body.extend_from_slice(description);
        // UTF-16 descriptions terminate on a pair of zero bytes, not one.
        body.push(0);
        if encoding == 1 || encoding == 2 {
            body.push(0);
        }
        body.extend_from_slice(data);

        let mut frame = Vec::from(*b"APIC");
        let size = body.len() as u32;
        if major == 4 {
            frame.extend_from_slice(&[
                (size >> 21) as u8 & 0x7f,
                (size >> 14) as u8 & 0x7f,
                (size >> 7) as u8 & 0x7f,
                size as u8 & 0x7f,
            ]);
        } else {
            frame.extend_from_slice(&size.to_be_bytes());
        }
        frame.extend_from_slice(&[0, 0]);
        frame.extend_from_slice(&body);

        let mut out = Vec::from(*b"ID3");
        out.extend_from_slice(&[major, 0, 0]);
        let tag = frame.len() as u32;
        out.extend_from_slice(&[
            (tag >> 21) as u8 & 0x7f,
            (tag >> 14) as u8 & 0x7f,
            (tag >> 7) as u8 & 0x7f,
            tag as u8 & 0x7f,
        ]);
        out.extend_from_slice(&frame);
        out
    }

    pub(super) fn atom(name: &[u8; 4], body: &[u8]) -> Vec<u8> {
        let mut out = ((body.len() + 8) as u32).to_be_bytes().to_vec();
        out.extend_from_slice(name);
        out.extend_from_slice(body);
        out
    }

    /// An M4A: `ftyp`, then moov > udta > meta > ilst > covr > data.
    pub(super) fn m4a_with_cover(format: u8, data: &[u8]) -> Vec<u8> {
        let mut data_body = vec![0, 0, 0, format, 0, 0, 0, 0];
        data_body.extend_from_slice(data);
        let covr = atom(b"covr", &atom(b"data", &data_body));
        let ilst = atom(b"ilst", &covr);
        // `meta` is a full atom: four bytes of version and flags before its
        // children, which is the trap this fixture exists to set.
        let mut meta_body = vec![0, 0, 0, 0];
        meta_body.extend_from_slice(&ilst);
        let meta = atom(b"meta", &meta_body);
        let udta = atom(b"udta", &meta);
        let moov = atom(b"moov", &udta);

        let mut out = atom(b"ftyp", b"M4A ");
        out.extend_from_slice(&moov);
        out
    }

    /// An ID3v2 tag holding the given text frames, in either major version.
    pub(super) fn mp3_with_text(major: u8, frames: &[(&[u8; 4], u8, &[u8])]) -> Vec<u8> {
        let mut body = Vec::new();
        for (id, encoding, text) in frames {
            let mut frame_body = vec![*encoding];
            frame_body.extend_from_slice(text);
            let size = frame_body.len() as u32;
            body.extend_from_slice(*id);
            if major == 4 {
                body.extend_from_slice(&[
                    (size >> 21) as u8 & 0x7f,
                    (size >> 14) as u8 & 0x7f,
                    (size >> 7) as u8 & 0x7f,
                    size as u8 & 0x7f,
                ]);
            } else {
                body.extend_from_slice(&size.to_be_bytes());
            }
            body.extend_from_slice(&[0, 0]);
            body.extend_from_slice(&frame_body);
        }

        let mut out = Vec::from(*b"ID3");
        out.extend_from_slice(&[major, 0, 0]);
        let tag = body.len() as u32;
        out.extend_from_slice(&[
            (tag >> 21) as u8 & 0x7f,
            (tag >> 14) as u8 & 0x7f,
            (tag >> 7) as u8 & 0x7f,
            tag as u8 & 0x7f,
        ]);
        out.extend_from_slice(&body);
        out
    }

    /// A FLAC file whose VORBIS_COMMENT block holds `comments`.
    pub(super) fn flac_with_comments(comments: &[&str]) -> Vec<u8> {
        let mut block = Vec::new();
        let vendor = "homesync-test";
        block.extend_from_slice(&(vendor.len() as u32).to_le_bytes());
        block.extend_from_slice(vendor.as_bytes());
        block.extend_from_slice(&(comments.len() as u32).to_le_bytes());
        for comment in comments {
            block.extend_from_slice(&(comment.len() as u32).to_le_bytes());
            block.extend_from_slice(comment.as_bytes());
        }

        let mut out = Vec::from(*b"fLaC");
        // A stand-in STREAMINFO, then the comment block marked last.
        out.push(0);
        out.extend_from_slice(&[0, 0, 4]);
        out.extend_from_slice(&[0, 0, 0, 0]);
        out.push(0x80 | 4);
        let len = block.len() as u32;
        out.extend_from_slice(&[(len >> 16) as u8, (len >> 8) as u8, len as u8]);
        out.extend_from_slice(&block);
        out
    }

    /// An M4A whose `ilst` holds the given text atoms, plus a `trkn`.
    pub(super) fn m4a_with_tags(text: &[(&[u8; 4], u8, &[u8])], track: Option<u16>) -> Vec<u8> {
        let mut ilst_body = Vec::new();
        for (name, kind, value) in text {
            let mut data_body = vec![0, 0, 0, *kind, 0, 0, 0, 0];
            data_body.extend_from_slice(value);
            ilst_body.extend_from_slice(&atom(name, &atom(b"data", &data_body)));
        }
        if let Some(track) = track {
            let mut data_body = vec![0, 0, 0, 0, 0, 0, 0, 0];
            // Eight bytes of payload: a leading pair, the track, then the total.
            data_body.extend_from_slice(&[0, 0]);
            data_body.extend_from_slice(&track.to_be_bytes());
            data_body.extend_from_slice(&[0, 12, 0, 0]);
            ilst_body.extend_from_slice(&atom(b"trkn", &atom(b"data", &data_body)));
        }

        let ilst = atom(b"ilst", &ilst_body);
        let mut meta_body = vec![0, 0, 0, 0];
        meta_body.extend_from_slice(&ilst);
        let moov = atom(b"moov", &atom(b"udta", &atom(b"meta", &meta_body)));

        let mut out = atom(b"ftyp", b"M4A ");
        out.extend_from_slice(&moov);
        out
    }

    #[test]
    fn id3_text_frames_are_read_in_both_versions() {
        for major in [3u8, 4] {
            let file = mp3_with_text(
                major,
                &[
                    (b"TIT2", 3, "Clair de Lune".as_bytes()),
                    (b"TPE1", 3, "Debussy".as_bytes()),
                    (b"TALB", 3, "Suite bergamasque".as_bytes()),
                    (b"TRCK", 3, "3/4".as_bytes()),
                ],
            );
            let tags = embedded_tags(&file);
            assert_eq!(tags.title.as_deref(), Some("Clair de Lune"), "major {major}");
            assert_eq!(tags.artist.as_deref(), Some("Debussy"));
            assert_eq!(tags.album.as_deref(), Some("Suite bergamasque"));
            // "3/4" is a track number and a total, not a fraction.
            assert_eq!(tags.track, Some(3));
        }
    }

    #[test]
    fn id3_utf16_text_is_not_read_as_latin1() {
        // The failure this prevents is visible rather than subtle: a UTF-16
        // title read a byte at a time comes out with a null between every
        // character.
        let mut utf16 = vec![0xff, 0xfe];
        for unit in "Grüße".encode_utf16() {
            utf16.extend_from_slice(&unit.to_le_bytes());
        }
        let file = mp3_with_text(4, &[(b"TIT2", 1, &utf16)]);
        assert_eq!(embedded_tags(&file).title.as_deref(), Some("Grüße"));

        // Big-endian, no byte-order mark: encoding 2.
        let mut be = Vec::new();
        for unit in "Grüße".encode_utf16() {
            be.extend_from_slice(&unit.to_be_bytes());
        }
        let file = mp3_with_text(4, &[(b"TIT2", 2, &be)]);
        assert_eq!(embedded_tags(&file).title.as_deref(), Some("Grüße"));
    }

    #[test]
    fn id3_latin1_text_is_decoded_as_latin1_not_utf8() {
        // 0xe9 is "é" in Latin-1 and an incomplete sequence in UTF-8. Reading
        // it as UTF-8 would replace it with a question mark.
        let file = mp3_with_text(4, &[(b"TIT2", 0, &[b'C', b'a', b'f', 0xe9])]);
        assert_eq!(embedded_tags(&file).title.as_deref(), Some("Café"));
    }

    #[test]
    fn a_v24_frame_with_several_values_keeps_the_first() {
        // v2.4 separates multiple values with nulls. A single field can hold
        // one of them, and the first is the one that belongs there.
        let file = mp3_with_text(4, &[(b"TPE1", 3, b"Lennon\0McCartney")]);
        assert_eq!(embedded_tags(&file).artist.as_deref(), Some("Lennon"));
    }

    #[test]
    fn vorbis_comments_are_read_whatever_case_the_keys_are_in() {
        let file = flac_with_comments(&["TITLE=Spiegel im Spiegel", "artist=Pärt", "Album=Alina", "TRACKNUMBER=2"]);
        let tags = embedded_tags(&file);
        assert_eq!(tags.title.as_deref(), Some("Spiegel im Spiegel"));
        assert_eq!(tags.artist.as_deref(), Some("Pärt"));
        assert_eq!(tags.album.as_deref(), Some("Alina"));
        assert_eq!(tags.track, Some(2));
    }

    #[test]
    fn a_comment_without_an_equals_sign_is_skipped_rather_than_fatal() {
        let file = flac_with_comments(&["this is not a key-value pair", "TITLE=Found anyway"]);
        assert_eq!(embedded_tags(&file).title.as_deref(), Some("Found anyway"));
    }

    #[test]
    fn a_vorbis_block_claiming_more_comments_than_it_holds_is_bounded() {
        // The count comes out of the file. A lying one must stop at the end of
        // the block rather than reading whatever follows it.
        let mut file = flac_with_comments(&["TITLE=Real"]);
        // Overwrite the comment count with a claim of four billion.
        let count_at = file.len() - 4 - "TITLE=Real".len() - 4;
        file[count_at..count_at + 4].copy_from_slice(&u32::MAX.to_le_bytes());
        // The point is that this returns at all, with what it did manage to read.
        assert_eq!(embedded_tags(&file).title.as_deref(), Some("Real"));
    }

    #[test]
    fn mp4_tags_are_read_from_ilst() {
        let file = m4a_with_tags(
            &[
                (b"\xa9nam", 1, "Teardrop".as_bytes()),
                (b"\xa9ART", 1, "Massive Attack".as_bytes()),
                (b"\xa9alb", 1, "Mezzanine".as_bytes()),
            ],
            Some(4),
        );
        let tags = embedded_tags(&file);
        assert_eq!(tags.title.as_deref(), Some("Teardrop"));
        assert_eq!(tags.artist.as_deref(), Some("Massive Attack"));
        assert_eq!(tags.album.as_deref(), Some("Mezzanine"));
        // Not 12, which is the album total sitting right beside it.
        assert_eq!(tags.track, Some(4));
    }

    #[test]
    fn a_file_with_no_tags_reports_none_rather_than_guessing() {
        // A WAV has nowhere to carry any of this, and a guess would be worse
        // than a blank: an album column full of filenames cannot be grouped.
        let wav = write_wav_s16(&[0i16; 32], 48_000, 2);
        assert!(embedded_tags(&wav).is_empty());
        assert!(embedded_tags(b"").is_empty());
        assert!(embedded_tags(b"ID3").is_empty());
    }

    #[test]
    fn an_absurdly_long_tag_is_truncated_rather_than_carried() {
        // Every byte of a title rides in every catalogue sent to every device.
        let long = "x".repeat(10_000);
        let file = flac_with_comments(&[&format!("TITLE={long}")]);
        let title = embedded_tags(&file).title.expect("a title");
        assert_eq!(title.chars().count(), MAX_TAG_CHARS);
    }

    #[test]
    fn a_track_number_of_zero_is_treated_as_absent() {
        // Taggers write 0 for "no track number". Showing it as track zero
        // would sort an album's first song after its last.
        let file = flac_with_comments(&["TRACKNUMBER=0"]);
        assert_eq!(embedded_tags(&file).track, None);
        let file = m4a_with_tags(&[], Some(0));
        assert_eq!(embedded_tags(&file).track, None);
    }

    #[test]
    fn finding_tags_does_not_stop_the_cover_being_found() {
        // Both parsers walk the same blocks. Sharing the walk is how they stay
        // in agreement, and this is the test that they do.
        let file = flac_with_picture("image/png", PNG, None);
        assert!(embedded_artwork(&file).is_some(), "the picture must still be found");
        assert!(embedded_tags(&file).is_empty(), "and a file with no comment block has no tags");
    }

    #[test]
    fn an_mp3_cover_is_found_in_both_id3_versions() {
        // v2.3 sizes are plain big-endian and v2.4 sizes are synchsafe.
        // Reading one as the other walks into the middle of a frame.
        for major in [3u8, 4] {
            let file = mp3_with_cover(major, 0, b"image/jpeg", b"cover", PNG);
            let art = embedded_artwork(&file).unwrap_or_else(|| panic!("v2.{major}"));
            assert_eq!(art.content_type, "image/jpeg");
            assert_eq!(&file[art.offset as usize..art.offset as usize + PNG.len()], PNG);
        }
    }

    #[test]
    fn a_utf16_description_does_not_shift_the_picture() {
        // Encoding 1 terminates the description with two zero bytes. Stopping
        // at the first leaves a stray byte on the front of the image.
        let file = mp3_with_cover(4, 1, b"image/png", &[0x41, 0x00], PNG);
        let art = embedded_artwork(&file).expect("a picture");
        assert_eq!(&file[art.offset as usize..art.offset as usize + PNG.len()], PNG);
    }

    #[test]
    fn a_tagger_writing_image_slash_jpg_still_works() {
        // Not a real MIME type, and common in the wild.
        let file = mp3_with_cover(3, 0, b"image/jpg", b"", PNG);
        assert_eq!(embedded_artwork(&file).expect("a picture").content_type, "image/jpeg");
    }

    #[test]
    fn an_m4a_cover_is_found_past_the_meta_version_bytes() {
        for (format, expected) in [(13u8, "image/jpeg"), (14, "image/png")] {
            let file = m4a_with_cover(format, PNG);
            let art = embedded_artwork(&file).expect("a picture");
            assert_eq!(art.content_type, expected);
            assert_eq!(&file[art.offset as usize..art.offset as usize + PNG.len()], PNG);
        }
    }

    fn scratch(name: &str) -> PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!("homesync-scan-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&path);
        std::fs::create_dir_all(&path).expect("scratch dir");
        path
    }

    /// An M4A with the tags written after the audio, as a recorder that cannot
    /// know the audio's length in advance has to do.
    fn m4a_with_trailing_moov(audio_bytes: usize, cover: &[u8]) -> Vec<u8> {
        let front = m4a_with_cover(14, cover);
        // Split the fixture back into its two top-level atoms so the moov can
        // be moved behind a slab of audio.
        let ftyp_len = u32::from_be_bytes(front[0..4].try_into().unwrap()) as usize;
        let (ftyp, moov) = front.split_at(ftyp_len);

        let mut out = ftyp.to_vec();
        out.extend_from_slice(&atom(b"mdat", &vec![0x5au8; audio_bytes]));
        out.extend_from_slice(moov);
        out
    }

    #[test]
    fn a_file_larger_than_the_window_still_hashes_whole() {
        // The scan reads in chunks and keeps only a window, so the hash it
        // reports has to be the hash of the file and not of the window.
        let dir = scratch("hash");
        let path = dir.join("long.flac");
        let bytes: Vec<u8> = (0..300_000u32).map(|i| (i % 251) as u8).collect();
        std::fs::write(&path, &bytes).expect("write");

        let scanned = scan_file(&path, 4096).expect("scan");
        assert_eq!(scanned.len, bytes.len() as u64);
        assert_eq!(scanned.digest, sha256_hex(&bytes));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_cover_inside_the_window_survives_a_windowed_scan() {
        let dir = scratch("window-cover");
        let path = dir.join("song.mp3");
        let file = mp3_with_cover(4, 0, b"image/png", b"", PNG);
        // Pad well past the window so the scan takes the streaming path.
        let mut bytes = file.clone();
        bytes.extend_from_slice(&vec![0u8; 200_000]);
        std::fs::write(&path, &bytes).expect("write");

        let scanned = scan_file(&path, 8192).expect("scan");
        let art = scanned.artwork.expect("a picture");
        assert_eq!(&bytes[art.offset as usize..art.offset as usize + PNG.len()], PNG);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_cover_past_the_window_is_found_by_seeking_to_moov() {
        // An audiobook or a long recording puts `moov` at the end, far beyond
        // anything the scan keeps in memory. Walking the top-level atoms by
        // seek finds it without reading the audio in between.
        let dir = scratch("far-cover");
        let path = dir.join("book.m4b");
        let bytes = m4a_with_trailing_moov(200_000, PNG);
        std::fs::write(&path, &bytes).expect("write");

        let scanned = scan_file(&path, 4096).expect("scan");
        let art = scanned.artwork.expect("a picture");
        assert_eq!(art.content_type, "image/png");
        // The offset has to be into the file, not into the moov buffer that
        // was parsed — getting the rebase wrong serves the wrong bytes.
        assert_eq!(&bytes[art.offset as usize..art.offset as usize + PNG.len()], PNG);
        assert!(art.offset > 4096, "the picture is past the window at {}", art.offset);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_windowed_scan_agrees_with_reading_the_whole_file() {
        // The window is an optimisation, so a file small enough to fit and the
        // same file scanned through a keyhole have to describe it identically.
        let dir = scratch("agree");
        let path = dir.join("song.mp3");
        let tagged = mp3_with_cover(3, 0, b"image/jpeg", b"cover", PNG);
        let mut bytes = tagged.clone();
        bytes.extend_from_slice(&vec![0u8; 100_000]);
        std::fs::write(&path, &bytes).expect("write");

        let whole = scan_file(&path, SCAN_WINDOW).expect("scan");
        let windowed = scan_file(&path, tagged.len() + 16).expect("scan");
        assert_eq!(whole.digest, windowed.digest);
        assert_eq!(whole.len, windowed.len);
        assert_eq!(whole.artwork.map(|a| a.offset), windowed.artwork.map(|a| a.offset));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_long_wav_reports_its_whole_duration_from_a_window() {
        // The `data` chunk header is at the front, but its length has to be
        // clamped against the file rather than against the bytes that were
        // read, or a long recording reports the window's duration.
        let dir = scratch("wav-duration");
        let path = dir.join("click.wav");
        let bytes = click_track_wav();
        std::fs::write(&path, &bytes).expect("write");

        let scanned = scan_file(&path, 1024).expect("scan");
        assert_eq!(scanned.duration_ns, Some(CLICK_SECONDS * 1_000_000_000));

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_file_of_minimum_size_atoms_does_not_walk_forever() {
        // The walk costs a seek and a read per atom, and an atom may declare
        // itself the minimum eight bytes long. A file of nothing but those is a
        // request for one syscall pair per eight bytes of it, which is a way to
        // make a rescan take minutes over a file that plays nothing.
        let dir = scratch("atom-flood");
        let path = dir.join("flood.m4a");
        let mut bytes = atom(b"ftyp", b"M4A ");
        while bytes.len() < 8 * (MAX_TOP_LEVEL_ATOMS + 5_000) {
            bytes.extend_from_slice(&atom(b"free", b""));
        }
        std::fs::write(&path, &bytes).expect("write");

        let started = std::time::Instant::now();
        let scanned = scan_file(&path, 4096).expect("scan");
        assert!(scanned.artwork.is_none(), "there is no cover in this file to find");
        // Generous: the point is that the walk stops, not that it is quick.
        assert!(started.elapsed() < std::time::Duration::from_secs(5), "the walk should give up, not grind");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_cover_within_the_atom_budget_is_still_found() {
        // The cap must not be so tight that an ordinary file trips it. This one
        // carries a realistic handful of leading atoms before its `moov`.
        let dir = scratch("atom-budget");
        let path = dir.join("ok.m4b");
        let front = m4a_with_cover(14, PNG);
        let ftyp_len = u32::from_be_bytes(front[0..4].try_into().unwrap()) as usize;
        let (ftyp, moov) = front.split_at(ftyp_len);
        let mut bytes = ftyp.to_vec();
        for _ in 0..8 {
            bytes.extend_from_slice(&atom(b"free", &[0u8; 64]));
        }
        bytes.extend_from_slice(&atom(b"mdat", &vec![0x5au8; 100_000]));
        bytes.extend_from_slice(moov);
        std::fs::write(&path, &bytes).expect("write");

        let scanned = scan_file(&path, 4096).expect("scan");
        let art = scanned.artwork.expect("a picture");
        assert_eq!(&bytes[art.offset as usize..art.offset as usize + PNG.len()], PNG);

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_moov_bigger_than_the_window_is_refused() {
        // The size comes out of the file, so honouring it would let a
        // malformed file choose how much memory the scan allocates.
        let dir = scratch("huge-moov");
        let path = dir.join("bad.m4a");
        let bytes = m4a_with_trailing_moov(100_000, &vec![0u8; 50_000]);
        std::fs::write(&path, &bytes).expect("write");

        let scanned = scan_file(&path, 4096).expect("scan");
        assert!(scanned.artwork.is_none(), "a moov past the window budget should not be read");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_m4a_with_an_unknown_picture_format_is_refused() {
        // Only 13 and 14 are defined. Serving anything else would hand the
        // browser bytes it cannot render with a MIME type that lies.
        assert!(embedded_artwork(&m4a_with_cover(1, PNG)).is_none());
    }

    #[test]
    fn an_atom_smaller_than_its_own_header_does_not_hang_the_walk() {
        // Straight off disk, so it can say anything. A size under 8 would
        // advance the cursor by nothing and loop forever.
        let mut file = atom(b"ftyp", b"M4A ");
        file.extend_from_slice(&[0, 0, 0, 2]);
        file.extend_from_slice(b"moov");
        assert!(embedded_artwork(&file).is_none());
    }

    #[test]
    fn the_newly_accepted_extensions_are_picked_up() {
        for name in ["a.mp4", "b.m4b", "c.aiff", "d.aif", "e.MP3"] {
            assert!(has_audio_extension(Path::new(name)), "{name}");
        }
        // No browser outside Edge decodes these, and a track that stops the
        // room is worse than a track that is not offered.
        for name in ["a.wma", "b.ape", "c.dsf", "d.txt"] {
            assert!(!has_audio_extension(Path::new(name)), "{name}");
        }
    }
}

/// Randomised robustness testing for the metadata parsers.
///
/// These parsers are the only code here that walks structures whose lengths and
/// offsets come from a file somebody else wrote. Every other test in this file
/// checks a case someone thought of; this one checks the cases nobody did.
///
/// Deterministic on purpose. A fuzzer that seeds itself from the clock finds a
/// crash once, in CI, and then cannot reproduce it — so the generator is a
/// plain xorshift and the seed is printed in every failure message.
///
/// A separate `cargo fuzz` target under `fuzz/` does the coverage-guided
/// version. This one runs on stable, on every `cargo test`, forever.
#[cfg(test)]
mod fuzz {
    use super::*;

    /// xorshift64*. Not cryptographic, and does not need to be — it needs to be
    /// reproducible and dependency-free.
    struct Rng(u64);

    impl Rng {
        fn next(&mut self) -> u64 {
            self.0 ^= self.0 >> 12;
            self.0 ^= self.0 << 25;
            self.0 ^= self.0 >> 27;
            self.0.wrapping_mul(0x2545_f491_4f6c_dd1d)
        }

        fn below(&mut self, bound: usize) -> usize {
            if bound == 0 {
                0
            } else {
                (self.next() % bound as u64) as usize
            }
        }

        fn byte(&mut self) -> u8 {
            (self.next() & 0xff) as u8
        }
    }

    /// A valid file of each kind, to be mutated.
    ///
    /// Mutating something valid reaches far deeper than random bytes do: random
    /// input is rejected by the magic-number check in the first line and never
    /// exercises a single length calculation.
    fn seeds() -> Vec<Vec<u8>> {
        let png = b"\x89PNG\r\n\x1a\nsome pixels here to make it worth reading";
        vec![
            super::tests::flac_with_picture("image/png", png, None),
            super::tests::mp3_with_cover(3, 0, b"image/jpeg", b"cover", png),
            super::tests::mp3_with_cover(4, 1, b"image/png", &[0x41, 0x00], png),
            super::tests::m4a_with_cover(13, png),
            // Tag-bearing seeds, so mutation reaches the text walkers rather
            // than only the picture ones.
            super::tests::flac_with_comments(&["TITLE=Seed", "ARTIST=Nobody", "ALBUM=None", "TRACKNUMBER=7/9"]),
            super::tests::mp3_with_text(
                4,
                &[(b"TIT2", 3, b"Seed"), (b"TPE1", 1, &[0xff, 0xfe, b'N', 0]), (b"TRCK", 0, b"7/9")],
            ),
            super::tests::mp3_with_text(3, &[(b"TALB", 0, b"Latin-1 \xe9"), (b"TIT2", 2, &[0, b'A', 0, b'B'])]),
            super::tests::m4a_with_tags(&[(b"\xa9nam", 1, b"Seed"), (b"\xa9ART", 0, b"Nobody")], Some(7)),
            b"fLaC".to_vec(),
            b"ID3\x04\x00\x00\x00\x00\x00\x00".to_vec(),
        ]
    }

    /// The invariant that matters.
    ///
    /// A returned range is later re-read from the file on disk, so a parser
    /// that hands back an offset past the end has misread the structure. It is
    /// not a memory-safety problem — the read is checked and degrades to "no
    /// artwork" — but it means the parse was wrong, and a wrong parse is how a
    /// parser ends up returning somebody else's bytes.
    fn check(bytes: &[u8], seed: u64, what: &str) {
        check_tags(bytes, seed, what);
        let Some(art) = embedded_artwork(bytes) else { return };
        let offset = art.offset as usize;
        let end = offset
            .checked_add(art.len as usize)
            .unwrap_or_else(|| panic!("{what} seed {seed}: offset + length overflowed"));
        assert!(
            end <= bytes.len(),
            "{what} seed {seed}: picture at {offset}..{end} runs past the {} byte file",
            bytes.len()
        );
        assert!(art.len > 0, "{what} seed {seed}: a zero-length picture was accepted");
        assert!(
            art.content_type.starts_with("image/"),
            "{what} seed {seed}: accepted content type {:?}",
            art.content_type
        );
    }

    /// What the tag parsers promise.
    ///
    /// Not a byte range, so there is no offset to check. What there is instead
    /// is a bound: every string that comes back rides in every catalogue sent
    /// to every device, so a file must not be able to make one unbounded, and
    /// a track number read out of a stranger's bytes must not be zero — which
    /// would sort an album's first song after its last.
    fn check_tags(bytes: &[u8], seed: u64, what: &str) {
        let tags = embedded_tags(bytes);
        for (field, value) in [("title", &tags.title), ("artist", &tags.artist), ("album", &tags.album)] {
            let Some(value) = value else { continue };
            assert!(
                value.chars().count() <= MAX_TAG_CHARS,
                "{what} seed {seed}: {field} came back {} characters long",
                value.chars().count()
            );
            assert!(!value.is_empty(), "{what} seed {seed}: an empty {field} was accepted");
            assert_eq!(value.trim(), value, "{what} seed {seed}: {field} was not trimmed");
        }
        if let Some(track) = tags.track {
            assert!(track > 0, "{what} seed {seed}: a track number of zero was accepted");
        }
    }

    #[test]
    fn random_bytes_are_never_fatal() {
        let mut rng = Rng(0x1234_5678_9abc_def0);
        for round in 0..2_000 {
            let len = rng.below(512);
            let bytes: Vec<u8> = (0..len).map(|_| rng.byte()).collect();
            check(&bytes, round, "random");
        }
    }

    /// Random bytes behind a real magic number, so the walkers actually run.
    #[test]
    fn random_bodies_behind_a_valid_magic_number_are_never_fatal() {
        let mut rng = Rng(0xfeed_face_dead_beef);
        let magics: [&[u8]; 3] = [b"fLaC", b"ID3\x04\x00\x00", b"\x00\x00\x00\x18ftyp"];
        for round in 0..3_000 {
            let magic = magics[rng.below(magics.len())];
            let mut bytes = magic.to_vec();
            for _ in 0..rng.below(400) {
                bytes.push(rng.byte());
            }
            check(&bytes, round, "magic-prefixed");
        }
    }

    /// Truncation is the commonest real corruption: an interrupted copy, a full
    /// disk, a download that stopped. Every prefix of a good file must be
    /// refused rather than misread.
    #[test]
    fn every_truncation_of_a_valid_file_is_survived() {
        for (index, seed) in seeds().into_iter().enumerate() {
            for cut in 0..seed.len() {
                check(&seed[..cut], index as u64, "truncated");
            }
        }
    }

    /// One flipped byte, which is what a failing drive or a bad cable produces.
    /// Length fields are the interesting targets and this finds them by
    /// accident often enough.
    #[test]
    fn single_byte_mutations_are_survived() {
        let mut rng = Rng(0x0bad_c0de_0bad_c0de);
        for (index, seed) in seeds().into_iter().enumerate() {
            for round in 0..4_000 {
                let mut bytes = seed.clone();
                if bytes.is_empty() {
                    continue;
                }
                let at = rng.below(bytes.len());
                bytes[at] = rng.byte();
                check(&bytes, (index * 10_000 + round) as u64, "one-byte mutation");
            }
        }
    }

    /// Several mutations at once, which gets past structures that survive one.
    #[test]
    fn multi_byte_mutations_are_survived() {
        let mut rng = Rng(0xdefe_c8ed_defe_c8ed);
        for (index, seed) in seeds().into_iter().enumerate() {
            for round in 0..2_000 {
                let mut bytes = seed.clone();
                if bytes.is_empty() {
                    continue;
                }
                for _ in 0..1 + rng.below(8) {
                    let at = rng.below(bytes.len());
                    bytes[at] = rng.byte();
                }
                check(&bytes, (index * 10_000 + round) as u64, "multi-byte mutation");
            }
        }
    }

    /// Lengths at their extremes, which is where an addition overflows or a
    /// subtraction wraps. Written deliberately rather than waited for.
    #[test]
    fn extreme_length_fields_are_survived() {
        let png = b"\x89PNG\r\n\x1a\npixels";
        for declared in [0u32, 1, u32::MAX, u32::MAX - 1, i32::MAX as u32, MAX_ARTWORK_BYTES, MAX_ARTWORK_BYTES + 1] {
            let file = super::tests::flac_with_picture("image/png", png, Some(declared));
            check(&file, declared as u64, "declared flac length");
        }
    }

    /// The other parsers that read numbers out of a file.
    #[test]
    fn the_range_header_parser_survives_anything() {
        let mut rng = Rng(0xa5a5_5a5a_a5a5_5a5a);
        let shapes = ["bytes=", "bytes=-", "bytes=0-", "bytes=-0", "bytes=9999999999999999999-", "", "bytes=1-2-3"];
        for _ in 0..3_000 {
            let mut header = shapes[rng.below(shapes.len())].to_string();
            for _ in 0..rng.below(12) {
                header.push(rng.byte() as char);
            }
            // Must not panic; any answer is acceptable.
            let _ = parse_range(Some(&header), rng.next() % 1_000_000);
            let _ = parse_range(Some(&header), 0);
        }
    }

    /// WAV duration is read from the header of a file the coordinator did not
    /// write, so it gets the same treatment.
    #[test]
    fn the_wav_header_reader_survives_anything() {
        let mut rng = Rng(0x5eed_5eed_5eed_5eed);
        for _ in 0..3_000 {
            let mut bytes = Vec::from(*b"RIFF");
            for _ in 0..rng.below(200) {
                bytes.push(rng.byte());
            }
            let _ = wav_duration_ns(&bytes, bytes.len() as u64);
        }
    }

    /// Names taken from a URL end up as paths on disk.
    #[test]
    fn a_download_name_never_escapes_its_folder() {
        let mut rng = Rng(0xc0ff_eec0_ffee_c0ff);
        for _ in 0..3_000 {
            let raw: String = (0..rng.below(40)).map(|_| rng.byte() as char).collect();
            let name = safe_download_name(&raw);
            assert!(!name.contains('/'), "{raw:?} produced {name:?}");
            assert!(!name.contains('\\'), "{raw:?} produced {name:?}");
            assert!(!name.starts_with('.'), "{raw:?} produced {name:?}");
            assert!(!name.is_empty(), "{raw:?} produced an empty name");
        }
    }
}
