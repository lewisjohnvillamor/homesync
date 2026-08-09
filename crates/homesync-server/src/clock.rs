//! The coordinator's session clock.
//!
//! Every timestamp on the wire is nanoseconds elapsed since this struct was
//! created. Using a monotonic source means NTP steps, daylight-saving changes
//! and manual clock edits on the host cannot move a scheduled playback start
//! (spec section 9.1).

use std::time::Instant;

/// Monotonic clock shared by the whole process.
#[derive(Debug, Clone)]
pub struct ServerClock {
    start: Instant,
}

impl ServerClock {
    /// Starts the session clock at zero.
    pub fn new() -> Self {
        Self { start: Instant::now() }
    }

    /// Nanoseconds elapsed since startup.
    pub fn now_ns(&self) -> u64 {
        // u64 nanoseconds covers 584 years of uptime, so the cast is safe.
        self.start.elapsed().as_nanos() as u64
    }
}

impl Default for ServerClock {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn advances_monotonically() {
        let clock = ServerClock::new();
        let a = clock.now_ns();
        let b = clock.now_ns();
        assert!(b >= a);
    }
}
