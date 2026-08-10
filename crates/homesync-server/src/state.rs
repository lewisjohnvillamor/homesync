//! Process-wide shared state.

use crate::calibration::CalibrationRegistry;
use crate::clock::ServerClock;
use crate::config::Config;
use crate::media::MediaLibrary;
use crate::profiles::ProfileStore;
use crate::room::Room;
use crate::stream::StreamHandle;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard, RwLock};

/// Everything an HTTP or WebSocket handler needs.
///
/// Rooms sit behind a plain blocking mutex. Every critical section is a few
/// map operations plus non-blocking channel sends, and the guard is never held
/// across an `.await`, so an async mutex would add cost without adding safety.
#[derive(Debug)]
pub struct App {
    /// Coordinator session clock.
    pub clock: ServerClock,
    /// Media catalogue, built once at startup.
    /// Catalogue. Behind a lock because folders can be added and rescanned
    /// while the coordinator is running: a drive that was plugged in after
    /// startup is the ordinary case, not an exotic one, and restarting to see
    /// it would drop every device out of the room.
    media: RwLock<MediaLibrary>,
    /// Roots the catalogue is built from, in scan order.
    media_roots: Mutex<Vec<PathBuf>>,
    /// Rooms keyed by their display code.
    rooms: Mutex<HashMap<String, Room>>,
    /// Effective configuration.
    pub config: Config,
    /// Coordinator build version.
    pub version: &'static str,
    /// Running live streams, keyed by room code.
    streams: Mutex<HashMap<String, StreamHandle>>,
    /// In-flight calibration runs.
    pub calibration: CalibrationRegistry,
    /// Per-device compensation that survives a restart.
    pub profiles: ProfileStore,
}

/// Ceiling on a fetched file.
///
/// Every receiver decodes the whole thing into memory — roughly 23 MB per
/// minute of audio at 48 kHz stereo — so the limit is really about what a
/// television browser can hold, not about disk.
pub const MAX_FETCH_BYTES: u64 = 300_000_000;

impl App {
    /// The catalogue as published to clients.
    pub fn media_manifest(&self) -> homesync_protocol::MediaManifest {
        self.media.read().expect("media lock").manifest()
    }

    /// One catalogue entry, cloned so no lock is held while it is used.
    pub fn media_item(&self, id: &str) -> Option<homesync_protocol::MediaItem> {
        self.media.read().expect("media lock").item(id).cloned()
    }

    /// Whether an id is in the catalogue.
    pub fn media_contains(&self, id: &str) -> bool {
        self.media.read().expect("media lock").contains(id)
    }

    /// Reads one item's bytes. `None` when the id is not in the catalogue.
    pub fn media_read(&self, id: &str) -> Option<std::io::Result<Vec<u8>>> {
        self.media.read().expect("media lock").read(id)
    }

    /// Folders the catalogue is built from.
    pub fn media_roots(&self) -> Vec<PathBuf> {
        self.media_roots.lock().expect("media roots").clone()
    }

    /// Adds a folder and rebuilds. Returns false if it is not a readable
    /// directory, which is worth saying out loud rather than silently adding a
    /// root that will never yield anything.
    pub fn add_media_root(&self, root: PathBuf) -> bool {
        if !root.is_dir() {
            return false;
        }
        {
            let mut roots = self.media_roots.lock().expect("media roots");
            if !roots.contains(&root) {
                roots.push(root);
            }
        }
        self.rescan_media();
        true
    }

    /// Removes a folder and rebuilds.
    pub fn remove_media_root(&self, root: &std::path::Path) {
        self.media_roots.lock().expect("media roots").retain(|r| r != root);
        self.rescan_media();
    }

    /// Downloads a track from a URL into the library.
    ///
    /// Fetched once, by the coordinator, and then served like any local file.
    /// That is the point: every receiver preloads the same verified bytes from
    /// here, so the guaranteed-timing path is unchanged and the remote host is
    /// asked for the file once instead of once per device.
    ///
    /// An endless stream is deliberately not supported. Music mode rests on
    /// every device holding the same decoded buffer and starting it at an
    /// agreed instant; a stream has no length, no hash and nothing to preload,
    /// so there is nothing to schedule. The size cap is what stops one being
    /// pulled forever.
    pub async fn fetch_media(&self, url: &str, dir: &std::path::Path) -> Result<String, String> {
        let parsed = reqwest::Url::parse(url).map_err(|_| "that is not a URL".to_string())?;
        if !matches!(parsed.scheme(), "http" | "https") {
            return Err("only http and https URLs can be fetched".into());
        }

        let name = parsed
            .path_segments()
            .and_then(|mut s| s.next_back())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .unwrap_or_else(|| "download".to_string());
        let name = crate::media::safe_download_name(&name);
        if !crate::media::has_audio_extension(std::path::Path::new(&name)) {
            return Err("that URL does not end in an audio file this build can decode".into());
        }

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(180))
            .build()
            .map_err(|e| e.to_string())?;
        let response = client.get(parsed).send().await.map_err(|e| e.to_string())?;
        if !response.status().is_success() {
            return Err(format!("the server answered {}", response.status()));
        }
        if let Some(len) = response.content_length() {
            if len > MAX_FETCH_BYTES {
                return Err(format!(
                    "that file is {} MB; the limit is {} MB",
                    len / 1_000_000,
                    MAX_FETCH_BYTES / 1_000_000
                ));
            }
        }
        let bytes = response.bytes().await.map_err(|e| e.to_string())?;
        // Checked again after the fact: `content-length` is a claim, and a
        // chunked response does not make one at all.
        if bytes.len() as u64 > MAX_FETCH_BYTES {
            return Err(format!("that file is larger than the {} MB limit", MAX_FETCH_BYTES / 1_000_000));
        }

        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        let path = dir.join(&name);
        std::fs::write(&path, &bytes).map_err(|e| e.to_string())?;

        // The download folder becomes a root the first time it is used, so the
        // file appears in the catalogue like anything else on disk.
        self.add_media_root(dir.to_path_buf());
        self.rescan_media();
        Ok(name)
    }

    /// Rebuilds the catalogue from the current roots.
    ///
    /// Ids are content hashes, so a file that has not changed keeps its id and
    /// anything already queued or playing survives a rescan.
    pub fn rescan_media(&self) -> usize {
        let roots = self.media_roots();
        let library = MediaLibrary::load(&roots);
        let count = library.manifest().items.len();
        *self.media.write().expect("media lock") = library;
        count
    }

    /// Builds the shared state and creates the default room.
    pub fn new(
        config: Config,
        media: MediaLibrary,
        media_roots: Vec<PathBuf>,
        room: Room,
        profiles: ProfileStore,
    ) -> Self {
        let mut rooms = HashMap::new();
        rooms.insert(room.code.clone(), room);
        Self {
            clock: ServerClock::new(),
            media: RwLock::new(media),
            media_roots: Mutex::new(media_roots),
            rooms: Mutex::new(rooms),
            config,
            version: env!("CARGO_PKG_VERSION"),
            streams: Mutex::new(HashMap::new()),
            calibration: CalibrationRegistry::default(),
            profiles,
        }
    }

    /// Locks the room table.
    ///
    /// A poisoned lock means a handler panicked mid-update. The room state is
    /// a plain data structure with no partially-applied invariants, so
    /// recovering the guard keeps the coordinator serving instead of turning
    /// one bad frame into a permanently dead process.
    pub fn rooms(&self) -> MutexGuard<'_, HashMap<String, Room>> {
        self.rooms.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Coordinator monotonic nanoseconds.
    pub fn now_ns(&self) -> u64 {
        self.clock.now_ns()
    }

    /// Registers a running stream, stopping any previous one for that room.
    pub fn set_stream(&self, room_code: &str, handle: StreamHandle) {
        let mut streams = self.streams.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(previous) = streams.insert(room_code.to_string(), handle) {
            previous.stop();
        }
    }

    /// Stops and forgets a room's stream. Returns whether one was running.
    pub fn stop_stream(&self, room_code: &str) -> bool {
        let mut streams = self.streams.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        match streams.remove(room_code) {
            Some(handle) => {
                handle.stop();
                true
            }
            None => false,
        }
    }

    /// Stops every running stream, for shutdown.
    pub fn stop_all_streams(&self) {
        let mut streams = self.streams.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        for (_, handle) in streams.drain() {
            handle.stop();
        }
    }
}
