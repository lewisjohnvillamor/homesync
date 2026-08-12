//! Cover-art extraction against arbitrary bytes.
//!
//! This is the code that walks ID3 frames, MP4 atoms and FLAC metadata blocks
//! using lengths read out of the file itself. `cargo test` already runs a
//! deterministic mutation harness over it; this is the coverage-guided version,
//! which finds the inputs that harness would need luck to reach.
//!
//!     cargo +nightly fuzz run artwork
#![no_main]

use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    let Some(art) = homesync_media::probe_artwork(data) else { return };

    // A returned range is re-read from the file later, so one that runs past
    // the end means the parse was wrong even though nothing crashed.
    let end = art.offset.checked_add(art.len as u64).expect("offset + length overflowed");
    assert!(end <= data.len() as u64, "picture at {}..{end} runs past a {} byte input", art.offset, data.len());
    assert!(art.len > 0, "a zero-length picture was accepted");
    assert!(art.content_type.starts_with("image/"), "accepted content type {:?}", art.content_type);
});
