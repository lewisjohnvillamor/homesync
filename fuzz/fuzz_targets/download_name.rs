//! Filenames derived from a fetched URL.
//!
//! Whatever comes out of this is joined onto the download folder and written,
//! so "cannot escape the folder" is the property that matters.
//!
//!     cargo +nightly fuzz run download_name
#![no_main]

use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    let Ok(raw) = std::str::from_utf8(data) else { return };
    let name = homesync_media::safe_download_name(raw);

    assert!(!name.is_empty(), "{raw:?} produced an empty name");
    assert!(!name.contains('/'), "{raw:?} produced {name:?}");
    assert!(!name.contains('\\'), "{raw:?} produced {name:?}");
    assert!(!name.starts_with('.'), "{raw:?} produced {name:?}");
    assert_ne!(name, "..", "{raw:?} produced a parent-directory reference");

    // The whole point: joined onto a folder, it must stay inside it.
    let joined = std::path::Path::new("/downloads").join(&name);
    assert_eq!(joined.parent(), Some(std::path::Path::new("/downloads")), "{raw:?} escaped via {name:?}");
});
