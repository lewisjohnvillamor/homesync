//! Per-device profiles that survive a coordinator restart.
//!
//! Compensation is expensive to obtain: manual values are found by ear, and
//! acoustic values cost a full calibration run with everyone in the room being
//! quiet. Losing them to a restart — which happens constantly while testing —
//! makes the whole feature feel unreliable even when it works.
//!
//! Profiles are keyed by the device id the browser persists in local storage,
//! so a device keeps its compensation across reloads, reconnects and
//! coordinator restarts. They are not keyed by client id, which changes with
//! every socket.

use homesync_protocol::Role;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

/// What is remembered about one device.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct DeviceProfile {
    /// Friendly name last used.
    #[serde(default)]
    pub name: String,
    /// Role last used.
    #[serde(default)]
    pub role: Role,
    /// Manual compensation in milliseconds, found by ear.
    #[serde(default)]
    pub manual_offset_ms: f64,
    /// Compensation in milliseconds derived from acoustic calibration.
    #[serde(default)]
    pub acoustic_offset_ms: f64,
    /// Output route the compensation was measured against, when the browser
    /// could tell us. Bluetooth latency changes between reconnections, so a
    /// profile measured on one route is meaningless on another.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output_route: Option<String>,
}

/// The room's identity, kept so it survives a restart.
///
/// Without this, every restart mints a new code and secret, which silently
/// invalidates the invite link saved on every device. The devices then fail to
/// join for a reason nobody can see, which is a miserable way to lose an
/// evening.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RoomIdentity {
    /// Six-character display code.
    pub code: String,
    /// Shared secret required to join.
    pub secret: String,
    /// What somebody called it. Absent in files written before rooms had names,
    /// and absent for a room nobody named.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

/// A queue somebody saved and named.
///
/// Media ids rather than filenames, because an id is a content hash: a saved
/// playlist survives the files being renamed or moved between folders, and
/// quietly loses only the tracks that are genuinely no longer there.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Playlist {
    /// What somebody called it.
    pub name: String,
    /// Media ids, in play order.
    pub media_ids: Vec<String>,
}

/// On-disk shape. Versioned so a future format change can be recognised
/// rather than silently misread.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredProfiles {
    version: u32,
    #[serde(default)]
    devices: HashMap<String, DeviceProfile>,
    /// The default room, duplicated from the head of `rooms`.
    ///
    /// Written for the benefit of an older binary, which knows only this field
    /// and would otherwise mint a fresh room and silently invalidate every
    /// saved invite link. Read only when `rooms` is absent, which is what a
    /// file written before multiple rooms existed looks like.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    room: Option<RoomIdentity>,
    /// Every room, default first.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    rooms: Vec<RoomIdentity>,
    /// Saved queues, by name. Absent in files written before playlists existed,
    /// which is why it defaults rather than being required.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    playlists: Vec<Playlist>,
}

impl Default for StoredProfiles {
    fn default() -> Self {
        Self { version: 1, devices: HashMap::new(), room: None, rooms: Vec::new(), playlists: Vec::new() }
    }
}

/// Current on-disk format version.
const FORMAT_VERSION: u32 = 1;

/// Profiles held in memory and mirrored to disk.
#[derive(Debug)]
pub struct ProfileStore {
    path: Option<PathBuf>,
    profiles: Mutex<HashMap<String, DeviceProfile>>,
    /// Every room, default first. The default is the one whose invite link the
    /// banner prints, so it keeps its place across restarts.
    rooms: Mutex<Vec<RoomIdentity>>,
    /// Saved queues, kept sorted by name so the list does not reorder itself
    /// between snapshots.
    playlists: Mutex<Vec<Playlist>>,
}

impl ProfileStore {
    /// Loads profiles from `path`, or starts empty when the file is absent.
    ///
    /// A corrupt or future-versioned file is reported and ignored rather than
    /// being allowed to stop the coordinator: losing saved compensation is a
    /// nuisance, refusing to start is worse.
    pub fn load(path: Option<PathBuf>) -> Self {
        let Some(path) = path else {
            return Self {
                path: None,
                profiles: Mutex::new(HashMap::new()),
                rooms: Mutex::new(Vec::new()),
                playlists: Mutex::new(Vec::new()),
            };
        };

        let mut rooms = Vec::new();
        let mut playlists = Vec::new();
        let profiles = match std::fs::read_to_string(&path) {
            Ok(text) => match serde_json::from_str::<StoredProfiles>(&text) {
                Ok(stored) if stored.version == FORMAT_VERSION => {
                    tracing::info!(count = stored.devices.len(), path = %path.display(), "loaded device profiles");
                    // `rooms` wins when present; `room` is what a file written
                    // before multiple rooms existed carries instead.
                    rooms = if stored.rooms.is_empty() { stored.room.into_iter().collect() } else { stored.rooms };
                    playlists = stored.playlists;
                    stored.devices
                }
                Ok(stored) => {
                    tracing::warn!(
                        found = stored.version,
                        expected = FORMAT_VERSION,
                        "device profile file is a different format version; ignoring it"
                    );
                    HashMap::new()
                }
                Err(error) => {
                    tracing::warn!(%error, path = %path.display(), "could not parse device profiles; starting empty");
                    HashMap::new()
                }
            },
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => HashMap::new(),
            Err(error) => {
                tracing::warn!(%error, path = %path.display(), "could not read device profiles");
                HashMap::new()
            }
        };

        Self {
            path: Some(path),
            profiles: Mutex::new(profiles),
            rooms: Mutex::new(rooms),
            playlists: Mutex::new(playlists),
        }
    }

    /// The default room remembered from a previous run, if any.
    pub fn room_identity(&self) -> Option<RoomIdentity> {
        self.rooms.lock().unwrap_or_else(|e| e.into_inner()).first().cloned()
    }

    /// Every remembered room, default first.
    pub fn room_identities(&self) -> Vec<RoomIdentity> {
        self.rooms.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    /// Remembers the default room so saved invite links keep working.
    ///
    /// Takes the head of the list rather than appending: the banner prints this
    /// room, and a restart that promoted a different one would hand out an
    /// invite for a room nobody is in.
    pub fn set_room_identity(&self, identity: RoomIdentity) {
        {
            let mut rooms = self.rooms.lock().unwrap_or_else(|e| e.into_inner());
            rooms.retain(|room| room.code != identity.code);
            rooms.insert(0, identity);
        }
        self.save();
    }

    /// Remembers an additional room.
    pub fn add_room_identity(&self, identity: RoomIdentity) {
        {
            let mut rooms = self.rooms.lock().unwrap_or_else(|e| e.into_inner());
            if rooms.iter().any(|room| room.code == identity.code) {
                return;
            }
            rooms.push(identity);
        }
        self.save();
    }

    /// Forgets a room. The default is never forgotten.
    pub fn forget_room(&self, code: &str) {
        {
            let mut rooms = self.rooms.lock().unwrap_or_else(|e| e.into_inner());
            if rooms.first().is_some_and(|room| room.code == code) {
                return;
            }
            rooms.retain(|room| room.code != code);
        }
        self.save();
    }

    /// The profile for one device, if it has one.
    pub fn get(&self, device_id: &str) -> Option<DeviceProfile> {
        self.profiles.lock().unwrap_or_else(|e| e.into_inner()).get(device_id).cloned()
    }

    /// Number of remembered devices.
    pub fn len(&self) -> usize {
        self.profiles.lock().unwrap_or_else(|e| e.into_inner()).len()
    }

    /// Whether anything is remembered. Kept alongside `len` because clippy and
    /// readers both expect the pair on a collection-like type.
    #[allow(dead_code)]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Applies `update` to a device's profile and writes the file.
    pub fn update(&self, device_id: &str, update: impl FnOnce(&mut DeviceProfile)) {
        {
            let mut profiles = self.profiles.lock().unwrap_or_else(|e| e.into_inner());
            let profile = profiles.entry(device_id.to_string()).or_default();
            update(profile);
        }
        self.save();
    }

    /// Forgets every profile, for a user who wants to start clean.
    pub fn clear(&self) {
        self.profiles.lock().unwrap_or_else(|e| e.into_inner()).clear();
        self.rooms.lock().unwrap_or_else(|e| e.into_inner()).clear();
        self.playlists.lock().unwrap_or_else(|e| e.into_inner()).clear();
        self.save();
    }

    /// Names of every saved queue, alphabetically.
    pub fn playlist_names(&self) -> Vec<String> {
        self.playlists.lock().unwrap_or_else(|e| e.into_inner()).iter().map(|p| p.name.clone()).collect()
    }

    /// The media ids saved under `name`, if anything is.
    pub fn playlist(&self, name: &str) -> Option<Vec<String>> {
        let playlists = self.playlists.lock().unwrap_or_else(|e| e.into_inner());
        playlists.iter().find(|p| p.name == name).map(|p| p.media_ids.clone())
    }

    /// Saves `media_ids` under `name`, replacing anything already saved there.
    ///
    /// Kept sorted, so the list a room is shown does not reorder itself between
    /// snapshots for no reason a person could see.
    pub fn save_playlist(&self, name: String, media_ids: Vec<String>) {
        {
            let mut playlists = self.playlists.lock().unwrap_or_else(|e| e.into_inner());
            match playlists.iter_mut().find(|p| p.name == name) {
                Some(existing) => existing.media_ids = media_ids,
                None => playlists.push(Playlist { name, media_ids }),
            }
            playlists.sort_by(|a, b| a.name.cmp(&b.name));
        }
        self.save();
    }

    /// Forgets the queue saved under `name`. Returns whether there was one.
    pub fn delete_playlist(&self, name: &str) -> bool {
        let removed = {
            let mut playlists = self.playlists.lock().unwrap_or_else(|e| e.into_inner());
            let before = playlists.len();
            playlists.retain(|p| p.name != name);
            playlists.len() != before
        };
        if removed {
            self.save();
        }
        removed
    }

    /// Writes the file, replacing it atomically.
    ///
    /// A half-written profile file read at the next start would be worse than
    /// no file at all, so the write goes to a temporary path and is renamed
    /// over the target.
    fn save(&self) {
        let Some(path) = &self.path else { return };
        let rooms = self.rooms.lock().unwrap_or_else(|e| e.into_inner()).clone();
        let stored = StoredProfiles {
            version: FORMAT_VERSION,
            devices: self.profiles.lock().unwrap_or_else(|e| e.into_inner()).clone(),
            // Both fields, deliberately. An older binary reads only `room`, and
            // writing just `rooms` would leave it minting a fresh default room
            // and invalidating every saved invite link.
            room: rooms.first().cloned(),
            rooms: rooms.clone(),
            playlists: self.playlists.lock().unwrap_or_else(|e| e.into_inner()).clone(),
        };
        let Ok(text) = serde_json::to_string_pretty(&stored) else {
            tracing::error!("could not serialise device profiles");
            return;
        };

        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() {
                let _ = std::fs::create_dir_all(parent);
            }
        }
        let temporary = path.with_extension("json.tmp");
        if let Err(error) = std::fs::write(&temporary, text) {
            tracing::warn!(%error, path = %temporary.display(), "could not write device profiles");
            return;
        }
        if let Err(error) = std::fs::rename(&temporary, path) {
            tracing::warn!(%error, path = %path.display(), "could not replace the device profile file");
            let _ = std::fs::remove_file(&temporary);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A unique temporary path per test, without a temp-file dependency.
    fn temp_path(name: &str) -> PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!("homesync-profiles-{name}-{}.json", std::process::id()));
        let _ = std::fs::remove_file(&path);
        path
    }

    #[test]
    fn remembers_compensation_across_a_restart() {
        let path = temp_path("restart");

        let store = ProfileStore::load(Some(path.clone()));
        assert!(store.is_empty());
        store.update("device-1", |profile| {
            profile.name = "Kitchen".into();
            profile.manual_offset_ms = 15.0;
            profile.acoustic_offset_ms = -140.0;
        });

        // A fresh coordinator process.
        let reloaded = ProfileStore::load(Some(path.clone()));
        let profile = reloaded.get("device-1").expect("profile survived");
        assert_eq!(profile.name, "Kitchen");
        assert_eq!(profile.manual_offset_ms, 15.0);
        assert_eq!(profile.acoustic_offset_ms, -140.0);

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn updates_merge_rather_than_replace() {
        let path = temp_path("merge");
        let store = ProfileStore::load(Some(path.clone()));

        store.update("d", |p| p.manual_offset_ms = 20.0);
        // A calibration run touches only the acoustic value, and must not
        // discard what somebody set by ear.
        store.update("d", |p| p.acoustic_offset_ms = -100.0);

        let profile = store.get("d").expect("profile");
        assert_eq!(profile.manual_offset_ms, 20.0);
        assert_eq!(profile.acoustic_offset_ms, -100.0);

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn the_room_identity_survives_a_restart() {
        // Otherwise every restart invalidates the invite link saved on every
        // device, and they fail to join for a reason nobody can see.
        let path = temp_path("room");
        let store = ProfileStore::load(Some(path.clone()));
        assert!(store.room_identity().is_none());

        store.set_room_identity(RoomIdentity { code: "ABC123".into(), secret: "s3cret".into(), name: None });
        store.update("d", |p| p.acoustic_offset_ms = -10.0);

        let reloaded = ProfileStore::load(Some(path.clone()));
        let identity = reloaded.room_identity().expect("identity survived");
        assert_eq!(identity.code, "ABC123");
        assert_eq!(identity.secret, "s3cret");
        // And the devices are still there beside it.
        assert_eq!(reloaded.get("d").expect("profile").acoustic_offset_ms, -10.0);

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn resetting_forgets_the_room_as_well_as_the_devices() {
        let path = temp_path("room-clear");
        let store = ProfileStore::load(Some(path.clone()));
        store.set_room_identity(RoomIdentity { code: "ABC123".into(), secret: "s".into(), name: None });
        store.clear();

        assert!(ProfileStore::load(Some(path.clone())).room_identity().is_none());
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn a_file_written_before_rooms_were_persisted_still_loads() {
        let path = temp_path("legacy");
        std::fs::write(&path, r#"{"version":1,"devices":{"d":{"manual_offset_ms":7.0}}}"#).expect("write");

        let store = ProfileStore::load(Some(path.clone()));
        assert!(store.room_identity().is_none(), "no room recorded, so a fresh one is minted");
        assert_eq!(store.get("d").expect("profile").manual_offset_ms, 7.0);

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn an_absent_file_is_not_an_error() {
        let store = ProfileStore::load(Some(temp_path("absent")));
        assert!(store.is_empty());
        assert!(store.get("nobody").is_none());
    }

    #[test]
    fn a_corrupt_file_is_ignored_rather_than_fatal() {
        // Losing saved compensation is a nuisance; refusing to start is worse.
        let path = temp_path("corrupt");
        std::fs::write(&path, "{ this is not json").expect("write");

        let store = ProfileStore::load(Some(path.clone()));
        assert!(store.is_empty());

        // And it recovers: the next write replaces the bad file.
        store.update("d", |p| p.acoustic_offset_ms = -5.0);
        let reloaded = ProfileStore::load(Some(path.clone()));
        assert_eq!(reloaded.get("d").expect("profile").acoustic_offset_ms, -5.0);

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn a_future_format_version_is_ignored_rather_than_misread() {
        let path = temp_path("future");
        std::fs::write(&path, r#"{"version":99,"devices":{"d":{"acoustic_offset_ms":-1.0}}}"#).expect("write");

        let store = ProfileStore::load(Some(path.clone()));
        assert!(store.is_empty(), "a format we do not understand must not be interpreted");

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn no_path_means_nothing_is_written() {
        // Used by tests and by anyone who wants a stateless coordinator.
        let store = ProfileStore::load(None);
        store.update("d", |p| p.acoustic_offset_ms = -1.0);
        assert_eq!(store.get("d").expect("held in memory").acoustic_offset_ms, -1.0);
    }

    #[test]
    fn clearing_forgets_everything() {
        let path = temp_path("clear");
        let store = ProfileStore::load(Some(path.clone()));
        store.update("a", |p| p.acoustic_offset_ms = -1.0);
        store.update("b", |p| p.acoustic_offset_ms = -2.0);
        assert_eq!(store.len(), 2);

        store.clear();
        assert!(ProfileStore::load(Some(path.clone())).is_empty());

        let _ = std::fs::remove_file(&path);
    }
}
