//! Process-wide shared state.

use crate::clock::ServerClock;
use crate::config::Config;
use crate::media::MediaLibrary;
use crate::room::Room;
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
}

impl App {
    /// Builds the shared state and creates the default room.
    pub fn new(config: Config, media: MediaLibrary, room: Room) -> Self {
        let mut rooms = HashMap::new();
        rooms.insert(room.code.clone(), room);
        Self { clock: ServerClock::new(), media, rooms: Mutex::new(rooms), config, version: env!("CARGO_PKG_VERSION") }
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
}
