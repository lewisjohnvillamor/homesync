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

/// On-disk shape. Versioned so a future format change can be recognised
/// rather than silently misread.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredProfiles {
    version: u32,
    devices: HashMap<String, DeviceProfile>,
}

impl Default for StoredProfiles {
    fn default() -> Self {
        Self { version: 1, devices: HashMap::new() }
    }
}

/// Current on-disk format version.
const FORMAT_VERSION: u32 = 1;

/// Profiles held in memory and mirrored to disk.
#[derive(Debug)]
pub struct ProfileStore {
    path: Option<PathBuf>,
    profiles: Mutex<HashMap<String, DeviceProfile>>,
}

impl ProfileStore {
    /// Loads profiles from `path`, or starts empty when the file is absent.
    ///
    /// A corrupt or future-versioned file is reported and ignored rather than
    /// being allowed to stop the coordinator: losing saved compensation is a
    /// nuisance, refusing to start is worse.
    pub fn load(path: Option<PathBuf>) -> Self {
        let Some(path) = path else {
            return Self { path: None, profiles: Mutex::new(HashMap::new()) };
        };

        let profiles = match std::fs::read_to_string(&path) {
            Ok(text) => match serde_json::from_str::<StoredProfiles>(&text) {
                Ok(stored) if stored.version == FORMAT_VERSION => {
                    tracing::info!(count = stored.devices.len(), path = %path.display(), "loaded device profiles");
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

        Self { path: Some(path), profiles: Mutex::new(profiles) }
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
        self.save();
    }

    /// Writes the file, replacing it atomically.
    ///
    /// A half-written profile file read at the next start would be worse than
    /// no file at all, so the write goes to a temporary path and is renamed
    /// over the target.
    fn save(&self) {
        let Some(path) = &self.path else { return };
        let stored = StoredProfiles {
            version: FORMAT_VERSION,
            devices: self.profiles.lock().unwrap_or_else(|e| e.into_inner()).clone(),
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
