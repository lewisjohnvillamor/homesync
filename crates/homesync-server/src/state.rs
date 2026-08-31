//! Process-wide shared state.

use crate::calibration::CalibrationRegistry;
use crate::clock::ServerClock;
use crate::config::Config;
use crate::join_limit::JoinLimiter;
use crate::profiles::ProfileStore;
use crate::room::Room;
use crate::stream::StreamHandle;
use homesync_media::MediaLibrary;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard, RwLock};
use tokio::sync::Semaphore;

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
    /// A ceiling on how fast one address can get join attempts wrong.
    pub join_limiter: JoinLimiter,
    /// A ceiling on how many media responses may be streaming at once.
    ///
    /// A streamed response holds an open file for as long as the client takes
    /// to read it, which is what a reader that never finishes can exhaust. The
    /// old code read the file into memory and closed it immediately, so this
    /// only became worth bounding when serving started streaming.
    pub media_streams: Arc<Semaphore>,
    /// The room created at startup, which is never reaped.
    default_room: String,
}

/// How long a room with nobody in it is kept before it is dropped.
///
/// Long enough that everyone leaving to reload a page finds their room still
/// there; short enough that a house does not accumulate abandoned rooms.
pub const EMPTY_ROOM_TTL_NS: u64 = 30 * 60 * 1_000_000_000;

/// Six Crockford base-32 characters from a fresh ULID's random section.
fn random_room_code() -> String {
    ulid::Ulid::new().to_string().chars().rev().take(6).collect::<String>().to_uppercase()
}

/// How many media responses may stream at once.
///
/// Every device in a room fetches the track it is about to play, and may fetch
/// the one after it as well, so the ceiling is drawn from the room size rather
/// than guessed. The floor covers a coordinator configured for a very small
/// room that still has several rooms running.
///
/// Past the ceiling a request is refused rather than queued: queueing would
/// hold the connection *and* the memory behind it, which is the thing being
/// rationed.
fn media_stream_limit(config: &Config) -> usize {
    config.max_clients.saturating_mul(4).max(32)
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

    /// Where one item's bytes live. `None` when the id is not in the
    /// catalogue. A location rather than the bytes, so the byte endpoint can
    /// stream a range instead of holding the whole track in memory.
    pub fn media_source(&self, id: &str) -> Option<homesync_media::ItemSource> {
        self.media.read().expect("media lock").source(id)
    }

    /// Reads one item's embedded cover picture, if it has one.
    pub fn media_artwork(&self, id: &str) -> Option<(String, Vec<u8>)> {
        self.media.read().expect("media lock").read_artwork(id)
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
        let name = homesync_media::safe_download_name(&name);
        if !homesync_media::has_audio_extension(std::path::Path::new(&name)) {
            return Err("that URL does not end in an audio file this build can decode".into());
        }

        let response = fetch_public_url(parsed).await?;
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
        let stream_limit = media_stream_limit(&config);
        let mut rooms = HashMap::new();
        let default_room = room.code.clone();
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
            join_limiter: JoinLimiter::default(),
            media_streams: Arc::new(Semaphore::new(stream_limit)),
            default_room,
        }
    }

    /// The default room's code — the one the banner printed.
    ///
    /// Never reaped, however empty it gets: its invite link is saved on every
    /// device and printed on a terminal somebody may still be looking at.
    pub fn default_room_code(&self) -> String {
        self.default_room.clone()
    }

    /// Creates a room with a fresh code and secret, and remembers it.
    ///
    /// Returns the code and secret. Rooms are cheap — a state machine and a
    /// client map — so the cost of one is a map entry, not a process.
    pub fn create_room(&self, name: Option<String>) -> (String, String) {
        let secret = ulid::Ulid::new().to_string();
        let mut rooms = self.rooms();
        // A six-character code has 32^6 values and a house has a handful of
        // rooms, but a collision would hand two groups the same code, so it is
        // retried rather than hoped against.
        let code = std::iter::repeat_with(random_room_code)
            .find(|candidate| !rooms.contains_key(candidate))
            .expect("an infinite iterator always yields");

        let mut room = Room::new(code.clone(), secret.clone(), self.config.start_lead_ns(), self.config.max_clients);
        let saved_name = name.clone();
        room.name = name;
        // A room created and not yet joined gets its full grace period rather
        // than being eligible for reaping on the very next tick.
        room.last_occupied_ns = self.clock.now_ns();
        rooms.insert(code.clone(), room);
        drop(rooms);

        self.profiles.add_room_identity(crate::profiles::RoomIdentity {
            code: code.clone(),
            secret: secret.clone(),
            name: saved_name,
        });
        tracing::info!(room = %code, "room created");
        (code, secret)
    }

    /// Recreates rooms remembered from a previous run, other than the default.
    ///
    /// Returns how many were restored. Without this a restart answers
    /// `no_such_room` to every device holding an invite for a room that is not
    /// the default one — the same silent-invalidation problem the default room
    /// already avoids, just one level down.
    pub fn restore_saved_rooms(&self) -> usize {
        let saved = self.profiles.room_identities();
        let mut rooms = self.rooms();
        let mut restored = 0;
        let now = self.clock.now_ns();
        for identity in saved {
            if rooms.contains_key(&identity.code) {
                continue;
            }
            let mut room =
                Room::new(identity.code.clone(), identity.secret, self.config.start_lead_ns(), self.config.max_clients);
            room.name = identity.name;
            room.last_occupied_ns = now;
            rooms.insert(identity.code, room);
            restored += 1;
        }
        restored
    }

    /// Drops rooms that nobody is in and nobody has been in for a while.
    ///
    /// Without this the room table grows for the life of the process: every
    /// room ever created stays, holding a code that can never be reissued. The
    /// default room is exempt.
    ///
    /// Returns the codes that were dropped.
    pub fn reap_empty_rooms(&self, now_ns: u64) -> Vec<String> {
        let mut dropped = Vec::new();
        {
            let mut rooms = self.rooms();
            rooms.retain(|code, room| {
                if code == &self.default_room || !room.clients.is_empty() {
                    return true;
                }
                // `saturating_sub` because a room created after the last
                // snapshot reads as being in the future for a few nanoseconds.
                let idle_ns = now_ns.saturating_sub(room.last_occupied_ns);
                if idle_ns < EMPTY_ROOM_TTL_NS {
                    return true;
                }
                dropped.push(code.clone());
                false
            });
        }
        for code in &dropped {
            self.profiles.forget_room(code);
            self.stop_stream(code);
            tracing::info!(room = %code, "empty room reaped");
        }
        dropped
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

/// How many redirects a fetch will follow before giving up.
const MAX_FETCH_REDIRECTS: usize = 5;

/// Whether an address belongs to this machine or to the network it sits on.
///
/// The fetch feature exists to pull a track off the public internet. Pointed
/// inward instead it becomes a way to make the coordinator talk to things the
/// person asking cannot reach themselves: a router's admin page, a cloud
/// provider's metadata service on 169.254.169.254, a database that trusts
/// anything originating on the LAN. The reply lands in the library and is then
/// served to anyone holding a media id, so this is an exfiltration path and not
/// only a scanning one.
///
/// The room secret already gates the feature, but that secret is handed out in
/// a QR code to whoever is invited into the room. It is not a credential that
/// should carry the power to make the host machine issue arbitrary internal
/// requests.
fn is_internal_address(ip: std::net::IpAddr) -> bool {
    use std::net::IpAddr;
    match ip {
        IpAddr::V4(v4) => {
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_unspecified()
                || v4.is_broadcast()
                || v4.is_multicast()
                || v4.is_documentation()
                // 100.64.0.0/10, carrier-grade NAT.
                || (v4.octets()[0] == 100 && (64..128).contains(&v4.octets()[1]))
                // 198.18.0.0/15, benchmarking.
                || (v4.octets()[0] == 198 && (18..20).contains(&v4.octets()[1]))
                // 192.0.0.0/24, IETF protocol assignments.
                || v4.octets()[..3] == [192, 0, 0]
                // 240.0.0.0/4, reserved.
                || v4.octets()[0] >= 240
        }
        IpAddr::V6(v6) => {
            // A v4 address wearing a v6 costume reaches the same host, so it is
            // judged as what it is rather than as what it looks like.
            if let Some(v4) = v6.to_ipv4_mapped() {
                return is_internal_address(IpAddr::V4(v4));
            }
            v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                // fc00::/7, unique local.
                || (v6.segments()[0] & 0xfe00) == 0xfc00
                // fe80::/10, link-local.
                || (v6.segments()[0] & 0xffc0) == 0xfe80
        }
    }
}

/// Resolves a URL's host and refuses anything that points back inside.
///
/// Returns the vetted addresses so the request can be pinned to them. Resolving
/// here and connecting somewhere else would leave the check decorative: a name
/// that answers with a public address once and a private one a moment later —
/// DNS rebinding — is the ordinary way this control is defeated.
async fn vetted_addresses(url: &reqwest::Url) -> Result<Vec<std::net::SocketAddr>, String> {
    use std::net::{IpAddr, SocketAddr};

    let host = url.host_str().ok_or_else(|| "that URL has no host".to_string())?;
    let port = url.port_or_known_default().unwrap_or(80);

    // An address written out in the URL is taken as one rather than sent to a
    // resolver. `host_str` hands back an IPv6 literal still wrapped in its
    // brackets, which no resolver accepts — so `http://[::1]/` would be refused
    // for being unresolvable rather than for being the loopback address, and
    // the person reading the message would be told the wrong thing about their
    // own URL. A domain never contains brackets, so trimming them is safe.
    let literal = host.trim_start_matches('[').trim_end_matches(']').parse::<IpAddr>().ok();
    let addresses: Vec<SocketAddr> = match literal {
        Some(ip) => vec![SocketAddr::new(ip, port)],
        None => {
            tokio::net::lookup_host((host, port)).await.map_err(|_| format!("{host} could not be looked up"))?.collect()
        }
    };

    if addresses.is_empty() {
        return Err(format!("{host} could not be looked up"));
    }
    // Every answer has to be acceptable, not just the first: a name that
    // resolves to both a public and a private address must not be reachable by
    // retrying until the connection lands on the one that is wanted.
    if addresses.iter().any(|addr| is_internal_address(addr.ip())) {
        return Err(format!(
            "{host} is on this machine or this network. Fetching is for public URLs; \
             copy a local file into a library folder instead"
        ));
    }
    Ok(addresses)
}

/// Fetches a URL, following redirects by hand so every hop is vetted.
///
/// `reqwest` follows redirects itself, but its policy runs before the next hop
/// is resolved and so cannot see where it actually leads. A public URL that
/// answers `302 Location: http://169.254.169.254/...` would otherwise walk
/// straight past the check on the URL that was typed.
async fn fetch_public_url(url: reqwest::Url) -> Result<reqwest::Response, String> {
    let mut next = url;
    for _ in 0..=MAX_FETCH_REDIRECTS {
        if !matches!(next.scheme(), "http" | "https") {
            return Err("only http and https URLs can be fetched".into());
        }
        let addresses = vetted_addresses(&next).await?;
        let host = next.host_str().unwrap_or_default().to_string();

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(180))
            .redirect(reqwest::redirect::Policy::none())
            .resolve_to_addrs(&host, &addresses)
            .build()
            .map_err(|e| e.to_string())?;

        let response = client.get(next.clone()).send().await.map_err(|e| e.to_string())?;
        if !response.status().is_redirection() {
            return Ok(response);
        }

        let location = response
            .headers()
            .get(reqwest::header::LOCATION)
            .and_then(|value| value.to_str().ok())
            .ok_or_else(|| "that server redirected without saying where".to_string())?;
        next = next.join(location).map_err(|_| "that server redirected somewhere unreadable".to_string())?;
    }
    Err(format!("that URL redirected more than {MAX_FETCH_REDIRECTS} times"))
}

#[cfg(test)]
mod tests {
    use super::is_internal_address;
    use std::net::IpAddr;

    fn internal(raw: &str) -> bool {
        is_internal_address(raw.parse::<IpAddr>().expect("address"))
    }

    #[test]
    fn loopback_and_lan_addresses_are_internal() {
        assert!(internal("127.0.0.1"));
        assert!(internal("192.168.1.10"));
        assert!(internal("10.0.0.5"));
        assert!(internal("172.16.4.4"));
        assert!(internal("0.0.0.0"));
    }

    /// The address a cloud provider answers instance credentials on. It is the
    /// single most valuable target this feature could otherwise be aimed at.
    #[test]
    fn the_metadata_service_is_internal() {
        assert!(internal("169.254.169.254"));
    }

    #[test]
    fn public_addresses_are_reachable() {
        assert!(!internal("1.1.1.1"));
        assert!(!internal("8.8.8.8"));
        assert!(!internal("93.184.216.34"));
        assert!(!internal("2606:4700:4700::1111"));
    }

    #[test]
    fn ipv6_loopback_and_local_ranges_are_internal() {
        assert!(internal("::1"));
        assert!(internal("::"));
        assert!(internal("fd00::1"));
        assert!(internal("fe80::1"));
        assert!(internal("ff02::1"));
    }

    /// `::ffff:127.0.0.1` reaches the loopback interface. Judging it by its v6
    /// shape rather than the v4 address inside it would wave it through.
    #[test]
    fn a_v4_address_mapped_into_v6_is_judged_as_v4() {
        assert!(internal("::ffff:127.0.0.1"));
        assert!(internal("::ffff:192.168.0.1"));
        assert!(!internal("::ffff:8.8.8.8"));
    }

    #[test]
    fn carrier_grade_nat_and_reserved_ranges_are_internal() {
        assert!(internal("100.64.0.1"));
        assert!(internal("198.18.0.1"));
        assert!(internal("240.0.0.1"));
        assert!(!internal("100.128.0.1"));
        assert!(!internal("198.20.0.1"));
    }
}

#[cfg(test)]
mod room_table_tests {
    use super::*;
    use crate::config::Config;
    use clap::Parser;

    fn app() -> App {
        // `--no-state` keeps the profile file out of it: these tests are about
        // the room table, and a test that writes to the working directory would
        // collide with every other test run in parallel.
        let config = Config::parse_from(["homesync", "--no-state", "--room-code", "DEFALT", "--room-secret", "s"]);
        let room = Room::new("DEFALT".into(), "s".into(), config.start_lead_ns(), config.max_clients);
        App::new(config, MediaLibrary::load(&[]), Vec::new(), room, ProfileStore::load(None))
    }

    #[test]
    fn a_created_room_has_its_own_code_and_secret() {
        let app = app();
        let (code, secret) = app.create_room(Some("Kitchen".into()));
        assert_ne!(code, "DEFALT");
        assert_ne!(secret, "s");
        assert_eq!(code.len(), 6);

        let rooms = app.rooms();
        assert_eq!(rooms.len(), 2);
        assert_eq!(rooms[&code].name.as_deref(), Some("Kitchen"));
    }

    #[test]
    fn every_created_room_gets_a_distinct_code() {
        let app = app();
        let codes: std::collections::HashSet<String> = (0..50).map(|_| app.create_room(None).0).collect();
        assert_eq!(codes.len(), 50, "a code was reused");
    }

    /// Rooms are separate timelines. The whole point is the kitchen playing one
    /// thing while the bedroom plays another, so a transport change in one must
    /// not be visible in the other.
    #[test]
    fn rooms_hold_separate_transports() {
        let app = app();
        let (code, _) = app.create_room(None);
        {
            let mut rooms = app.rooms();
            rooms.get_mut("DEFALT").expect("default").transport.epoch = 7;
            assert_eq!(rooms[&code].transport.epoch, 0, "the new room should not have moved");
        }
    }

    #[test]
    fn an_empty_room_is_reaped_once_its_grace_period_is_over() {
        let app = app();
        let (code, _) = app.create_room(None);
        let created = app.rooms()[&code].last_occupied_ns;

        assert!(app.reap_empty_rooms(created + EMPTY_ROOM_TTL_NS / 2).is_empty(), "still inside the grace period");
        assert!(app.rooms().contains_key(&code));

        let dropped = app.reap_empty_rooms(created + EMPTY_ROOM_TTL_NS + 1);
        assert_eq!(dropped, vec![code.clone()]);
        assert!(!app.rooms().contains_key(&code));
    }

    /// The banner printed the default room's invite link and somebody may still
    /// be looking at that terminal. It is never reaped, however empty it gets.
    #[test]
    fn the_default_room_is_never_reaped() {
        let app = app();
        let dropped = app.reap_empty_rooms(u64::MAX / 2);
        assert!(dropped.is_empty());
        assert!(app.rooms().contains_key("DEFALT"));
    }

    /// Reaping is about abandonment, not emptiness at one instant. A room being
    /// used must survive however long it has existed.
    #[test]
    fn an_occupied_room_is_never_reaped() {
        let app = app();
        let (code, _) = app.create_room(None);
        {
            let mut rooms = app.rooms();
            let room = rooms.get_mut(&code).expect("the new room");
            let (tx, _rx) = tokio::sync::mpsc::unbounded_channel();
            room.join("client".into(), "device".into(), "Kitchen speaker".into(), Default::default(), tx)
                .expect("join");
        }
        assert!(app.reap_empty_rooms(u64::MAX / 2).is_empty(), "an occupied room must survive");
        assert!(app.rooms().contains_key(&code));
    }
}
