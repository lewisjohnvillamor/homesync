#[test]
fn known_vectors() {
    // Published SHA-256 vectors. If the library change altered the output, the
    // media id of every file would change and every browser-side integrity
    // check would fail.
    assert_eq!(homesync_media::sha256_hex(b""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    assert_eq!(homesync_media::sha256_hex(b"abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    assert_eq!(
        homesync_media::sha256_hex(b"The quick brown fox jumps over the lazy dog"),
        "d7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592"
    );
}
