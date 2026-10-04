//! Title, artist, album and track number against arbitrary bytes.
//!
//! The tag parsers read string lengths and a comment count out of the file
//! itself, which is the same class of arithmetic as the cover-art walk and the
//! same reason to be nervous about it. `cargo test` runs a deterministic
//! mutation harness over this; here is the coverage-guided version.
//!
//!     cargo +nightly fuzz run tags
#![no_main]

use libfuzzer_sys::fuzz_target;

/// Must match `MAX_TAG_CHARS` in the media crate.
const MAX_TAG_CHARS: usize = 200;

fuzz_target!(|data: &[u8]| {
    let tags = homesync_media::probe_tags(data);

    // Every string here is sent to every device in every catalogue, so the
    // bound is the invariant: a file must not be able to make one unbounded.
    for (field, value) in [("title", &tags.title), ("artist", &tags.artist), ("album", &tags.album)] {
        let Some(value) = value else { continue };
        assert!(
            value.chars().count() <= MAX_TAG_CHARS,
            "{field} came back {} characters long from a {} byte input",
            value.chars().count(),
            data.len()
        );
        assert!(!value.is_empty(), "an empty {field} was accepted");
        assert_eq!(value.trim(), value, "{field} was not trimmed: {value:?}");
    }

    // Zero means "no track number" to every tagger that writes it. Accepting
    // it would sort an album's first song after its last.
    if let Some(track) = tags.track {
        assert!(track > 0, "a track number of zero was accepted");
    }
});
