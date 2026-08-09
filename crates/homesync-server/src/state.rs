//! Process-wide shared state.

use crate::calibration::CalibrationRegistry;
use crate::clock::ServerClock;
use crate::config::Config;
use crate::media::MediaLibrary;
use crate::profiles::ProfileStore;
use crate::room::Room;
use crate::stream::StreamHandle;
use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard};

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
    pub media: MediaLibrary,
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

impl App {
    /// Builds the shared state and creates the default room.
    pub fn new(config: Config, media: MediaLibrary, room: Room, profiles: ProfileStore) -> Self {
        let mut rooms = HashMap::new();
        rooms.insert(room.code.clone(), room);
        Self {
            clock: ServerClock::new(),
            media,
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
