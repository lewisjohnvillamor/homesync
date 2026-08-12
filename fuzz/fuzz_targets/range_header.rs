//! `Range:` header parsing against arbitrary text.
//!
//! Reached by any unauthenticated request for media bytes, so it is the parser
//! with the shortest path from the network.
//!
//!     cargo +nightly fuzz run range_header
#![no_main]

use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    let Ok(header) = std::str::from_utf8(data) else { return };
    for len in [0u64, 1, 1024, u64::MAX] {
        if let Some(Ok(range)) = homesync_media::parse_range(Some(header), len) {
            assert!(range.start <= range.end, "inverted range {}..{}", range.start, range.end);
            assert!(range.end < len, "range {}..{} is outside a {len} byte body", range.start, range.end);
        }
    }
});
