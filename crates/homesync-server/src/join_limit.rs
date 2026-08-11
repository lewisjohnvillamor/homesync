//! A bound on how fast one address can get join attempts wrong.
//!
//! The room secret is a 26-character ULID, so this is not what stops it being
//! guessed — nothing is going to enumerate 80 bits over a LAN socket. What it
//! stops is a client, or a script, spending the coordinator's time: each
//! attempt costs a socket, a frame parse and a lock on the room table, and
//! there was previously no ceiling on how many of those one peer could ask for.
//!
//! **Only failures count.** A device that reconnects fifty times in a minute
//! because the wifi is flapping is the ordinary case on a home network, and
//! locking it out would turn a bad signal into a room it can never rejoin. A
//! device that gets the *secret* wrong fifty times is not doing that by
//! accident. Success clears the record, so one fat-fingered code followed by
//! the right one leaves nothing behind.

use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Failed attempts from one address before it is asked to wait.
pub const MAX_FAILURES: u32 = 10;

/// How long a run of failures has to happen within to count as a run.
pub const FAILURE_WINDOW: Duration = Duration::from_secs(60);

/// How long an address waits once it has spent its attempts.
pub const BLOCK_DURATION: Duration = Duration::from_secs(60);

/// Entries older than this are dropped, so the table cannot grow forever on a
/// network where addresses come and go.
const FORGET_AFTER: Duration = Duration::from_secs(600);

#[derive(Debug, Clone, Copy)]
struct Record {
    failures: u32,
    /// When the current run of failures began.
    window_start: Instant,
    /// Last time this address did anything, for pruning.
    last_seen: Instant,
    blocked_until: Option<Instant>,
}

/// Per-address join failure accounting.
#[derive(Debug, Default)]
pub struct JoinLimiter {
    records: Mutex<HashMap<IpAddr, Record>>,
}

impl JoinLimiter {
    /// How long this address must wait, if it must.
    ///
    /// Checked before the secret is compared, so a blocked address costs a map
    /// lookup rather than the work it was trying to provoke.
    pub fn retry_after(&self, ip: IpAddr, now: Instant) -> Option<Duration> {
        let records = self.records.lock().unwrap_or_else(|p| p.into_inner());
        let record = records.get(&ip)?;
        let until = record.blocked_until?;
        // `checked_duration_since` rather than subtraction: a block that has
        // already expired must read as "not blocked", not panic on a negative.
        until.checked_duration_since(now).filter(|left| !left.is_zero())
    }

    /// Records a failed attempt and reports the wait it earned, if any.
    pub fn record_failure(&self, ip: IpAddr, now: Instant) -> Option<Duration> {
        let mut records = self.records.lock().unwrap_or_else(|p| p.into_inner());
        prune(&mut records, now);

        let record = records.entry(ip).or_insert_with(|| Record::fresh(now));
        // A run that has gone quiet for longer than the window is over, and the
        // next failure starts a fresh one. Without this an address that fails
        // once an hour would eventually be blocked for it.
        if now.duration_since(record.window_start) > FAILURE_WINDOW {
            record.failures = 0;
            record.window_start = now;
        }
        record.failures += 1;
        record.last_seen = now;

        if record.failures >= MAX_FAILURES {
            let until = now + BLOCK_DURATION;
            record.blocked_until = Some(until);
            // The count resets with the block, so serving the wait does not
            // leave the address one mistake from being blocked again.
            record.failures = 0;
            record.window_start = now;
            return Some(BLOCK_DURATION);
        }
        None
    }

    /// Clears an address's record after a successful join.
    pub fn record_success(&self, ip: IpAddr, now: Instant) {
        let mut records = self.records.lock().unwrap_or_else(|p| p.into_inner());
        prune(&mut records, now);
        records.remove(&ip);
    }

    /// Addresses currently being tracked. Exists so the pruning test can see
    /// the table, which is otherwise entirely private.
    #[cfg(test)]
    pub fn tracked(&self) -> usize {
        self.records.lock().unwrap_or_else(|p| p.into_inner()).len()
    }
}

fn prune(records: &mut HashMap<IpAddr, Record>, now: Instant) {
    records.retain(|_, record| {
        let fresh = now.duration_since(record.last_seen) < FORGET_AFTER;
        let blocked = record.blocked_until.is_some_and(|until| until > now);
        fresh || blocked
    });
}

impl Record {
    fn fresh(now: Instant) -> Self {
        Self { failures: 0, window_start: now, last_seen: now, blocked_until: None }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ip(raw: &str) -> IpAddr {
        raw.parse().expect("address")
    }

    #[test]
    fn a_fresh_address_is_never_asked_to_wait() {
        let limiter = JoinLimiter::default();
        assert_eq!(limiter.retry_after(ip("192.168.1.5"), Instant::now()), None);
    }

    #[test]
    fn failures_short_of_the_limit_do_not_block() {
        let limiter = JoinLimiter::default();
        let now = Instant::now();
        let peer = ip("192.168.1.5");
        for _ in 0..MAX_FAILURES - 1 {
            assert_eq!(limiter.record_failure(peer, now), None);
        }
        assert_eq!(limiter.retry_after(peer, now), None);
    }

    #[test]
    fn the_limit_earns_a_wait() {
        let limiter = JoinLimiter::default();
        let now = Instant::now();
        let peer = ip("192.168.1.5");
        for _ in 0..MAX_FAILURES - 1 {
            limiter.record_failure(peer, now);
        }
        assert_eq!(limiter.record_failure(peer, now), Some(BLOCK_DURATION));
        assert!(limiter.retry_after(peer, now).is_some());
    }

    /// The whole point of counting failures rather than attempts. A device on a
    /// flapping connection rejoins over and over with the *right* secret, and
    /// must never be locked out of its own room for it.
    #[test]
    fn a_device_that_keeps_reconnecting_successfully_is_never_blocked() {
        let limiter = JoinLimiter::default();
        let now = Instant::now();
        let peer = ip("192.168.1.5");
        for _ in 0..500 {
            limiter.record_success(peer, now);
            assert_eq!(limiter.retry_after(peer, now), None);
        }
    }

    /// One wrong code then the right one leaves nothing behind.
    #[test]
    fn success_clears_earlier_failures() {
        let limiter = JoinLimiter::default();
        let now = Instant::now();
        let peer = ip("192.168.1.5");
        for _ in 0..MAX_FAILURES - 1 {
            limiter.record_failure(peer, now);
        }
        limiter.record_success(peer, now);
        for _ in 0..MAX_FAILURES - 1 {
            assert_eq!(limiter.record_failure(peer, now), None, "the count should have restarted");
        }
    }

    #[test]
    fn a_block_expires() {
        let limiter = JoinLimiter::default();
        let now = Instant::now();
        let peer = ip("192.168.1.5");
        for _ in 0..MAX_FAILURES {
            limiter.record_failure(peer, now);
        }
        assert!(limiter.retry_after(peer, now).is_some());
        assert_eq!(limiter.retry_after(peer, now + BLOCK_DURATION), None);
    }

    /// Failures spread thinly are not a run. Without this an address that got
    /// it wrong once a day would eventually be blocked for it.
    #[test]
    fn failures_outside_the_window_do_not_accumulate() {
        let limiter = JoinLimiter::default();
        let mut now = Instant::now();
        let peer = ip("192.168.1.5");
        for _ in 0..MAX_FAILURES * 3 {
            assert_eq!(limiter.record_failure(peer, now), None);
            now += FAILURE_WINDOW + Duration::from_secs(1);
        }
    }

    #[test]
    fn one_address_being_blocked_does_not_touch_another() {
        let limiter = JoinLimiter::default();
        let now = Instant::now();
        let noisy = ip("192.168.1.5");
        let quiet = ip("192.168.1.6");
        for _ in 0..MAX_FAILURES {
            limiter.record_failure(noisy, now);
        }
        assert!(limiter.retry_after(noisy, now).is_some());
        assert_eq!(limiter.retry_after(quiet, now), None);
    }

    /// A network where addresses come and go must not grow the table forever.
    #[test]
    fn stale_records_are_forgotten() {
        let limiter = JoinLimiter::default();
        let start = Instant::now();
        for n in 0..50 {
            limiter.record_failure(ip(&format!("192.168.1.{n}")), start);
        }
        assert_eq!(limiter.tracked(), 50);
        limiter.record_failure(ip("10.0.0.1"), start + FORGET_AFTER + Duration::from_secs(1));
        assert_eq!(limiter.tracked(), 1, "everything older than the horizon should be gone");
    }
}
