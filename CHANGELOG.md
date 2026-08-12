# Changelog

All notable changes to HomeSync. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[semantic versioning](https://semver.org/spec/v2.0.0.html).

Entries say what changed and, where it matters, what has and has not been
verified. A feature that exists but has never run against real hardware is
listed as such rather than as done — see [Status](README.md#status).

## [Unreleased]

### Fixed

- **Every media load held two copies of the compressed file.** The decoder was
  handed `bytes.slice(0)` to keep the original "for any retry" — but nothing
  retries, so the copy only ever doubled the compressed footprint. Measured on a
  12 MB FLAC: the original was still resident after decoding the copy. FLAC felt
  it worst because its compressed size is five to ten times an MP3's, which is
  why a television ran out of memory on FLAC and nowhere else.

### Changed

- **Advanced no longer offers acoustic calibration on a room that cannot run
  it.** It needs a microphone, browsers refuse one outside a secure context, and
  on a plain-HTTP room that made the largest block in the panel a control that
  could never work. One line now says why, and points at the thing that does the
  same job less precisely. `--tls` brings the whole section back.
- `log()` no longer assumes the activity panel exists, so the markup can be
  trimmed without breaking the client on the first line it tries to write.
- Four constants that nothing imported are no longer exported.

- **The release binary is 35% smaller** — 13.0 MB to 8.5 MB — from a release
  profile that strips symbols and links with LTO across one codegen unit.
  `cargo build` is untouched, and `--profile release-debug` keeps the symbols
  for when a release-only problem needs a readable backtrace.
- Fewer crates compiled. `sha2` and `hex` stayed listed as dependencies of the
  server after the catalogue moved out to `homesync-media` and were never used
  there again; `tokio-tungstenite` was pinned a version behind the one axum
  already pulls, so a second copy of the whole WebSocket stack was compiled; and
  `sha2` was two versions behind the one `rust-embed` pulls. 333 crates to 329,
  and four fewer duplicated.

  SHA-256 output is checked against published vectors, because that digest is
  every media id and every browser-side integrity check.

- **A device that cannot afford them no longer preloads or resamples.**
  Preloading the next track holds a second decoded buffer — decoded audio is
  uncompressed float PCM whatever it arrived as, about 23 MB per minute — and
  correcting drift by resampling makes the audio thread interpolate
  continuously. Both were added without asking whether the device could spare
  the memory or the processor. A television can spare neither.

  Televisions and devices reporting 2 GB or less now start with both off. An
  unknown device is assumed capable, because `deviceMemory` is Chromium-only and
  guessing "weak" would take features from every Mac and iPhone.

- **"Go easy on this device"**, a per-device setting, so the guess can be
  overridden either way. Ticking it frees the preloaded track immediately rather
  than at the next track change.

## [0.1.0] — 2026-08-12

First tagged release. Every milestone in the technical specification is
implemented; how thoroughly each has been *verified* varies enormously, and the
Status section of the README is the honest account of that.

### Playback and timing

- Clock synchronisation over a four-timestamp exchange, with
  median-absolute-deviation outlier rejection, a lowest-round-trip offset
  estimate, drift by linear regression, and confirmation before a jump is
  believed to be a real clock step.
- One authoritative timeline. Every receiver translates the coordinator's anchor
  instant into its own `AudioContext` clock; join, resume, seek and late arrival
  all take the same path.
- A readiness barrier. Playback is held — not refused — until every receiver
  holds the verified file and a stable clock, with an explicit override.
- **Drift corrected by resampling.** Playback rate is trimmed by up to 0.2%
  (about 3.5 cents of pitch, under the 5–10 cents a listener can detect) until a
  drifting device is back in position. Beyond a quarter-second the room falls
  back to a coordinated restart, which is audible and now rare.
- A queue, with preloading of the next track so the gap between tracks is the
  scheduling lead rather than a download.

### Sources

- **Music**: every device downloads the same file, verifies its SHA-256, and
  schedules it off the shared timeline.
- **YouTube together**: each device runs its own player; the coordinator
  distributes a position and an instant and corrects players that fall behind.
  Best-effort by construction.
- **Live system audio** exists in the protocol and the coordinator but has no
  button, because the Windows capture path has never run against real hardware.

### Library

- Formats: `wav`, `mp3`, `m4a`, `m4b`, `mp4`, `aac`, `ogg`, `oga`, `opus`,
  `flac`, `webm`, `aif`, `aiff`. MP3, WAV, FLAC, Ogg Vorbis and Opus are
  confirmed decoding and playing from real encoded files.
- Embedded cover art from FLAC, MP3 (ID3v2 `APIC`) and MP4 (`covr`).
- Several media folders, addable while running, so a drive plugged in later does
  not need a restart.
- Fetch a track from a URL. Public addresses only.
- A file this browser cannot decode is named in the interface instead of leaving
  the room waiting, and formats with no decoder are marked in the library list
  *before* anyone queues one.

### Rooms

- Any number of rooms on one coordinator, sharing its clock service and library
  and nothing else — separate timelines, devices and secrets.
- Rooms persist across restarts; empty ones are dropped after thirty minutes.
  The room printed in the startup banner is never dropped.

### Devices

- Per-device manual compensation and a five-band equaliser, both saved and
  restored when a device rejoins.
- Acoustic calibration: coded chirps, match filtering through an in-house FFT,
  first-arrival detection that survives a reflection louder than the direct
  sound, and a solver that will not let one wandering device drag the room.
- One machine holds one seat however many tabs it opens.
- A room-health line that says whether the room is actually together, and names
  the device when it is not.

### Operating it

- Single binary; the web client is embedded, with no build step.
- HTTPS with a self-signed certificate (`--tls`), required for calibration.
- `homesync.local` over mDNS.
- Invitations as a link and a QR code, with the secret in the URL fragment.
- A diagnostics export, so a problem is a JSON file rather than a description of
  a sound.

### Security

- Fetch-by-URL cannot be aimed at the local network: hosts are resolved and
  refused if they land on loopback, private, link-local, carrier-grade-NAT or
  reserved addresses, in v4 or v6 including v4-mapped. Requests are pinned to
  the vetted addresses, and redirects are followed by hand with every hop
  checked.
- A bound on failed joins: ten failures from one address in a minute earns a
  minute's wait. Only failures count and success clears the record.
- A warning at startup when the coordinator finds itself on a routable address.
- See [`SECURITY.md`](SECURITY.md) for the threat model and the known gaps.

### Testing

- 253 Rust unit tests, 7 integration tests driving the real binary over a
  socket, and 85 browser tests.
- A deterministic mutation-fuzzing harness over the metadata parsers, run on
  every `cargo test`, plus `cargo fuzz` targets for coverage-guided runs.
- A headless two-browser end-to-end run and a clock-agreement simulation.

### Not implemented

- Opus compression for live streaming; PCM only.
- Controlled video, so no lip-sync with HomeSync-owned video.

### Known to be unverified

Listed because it is the most important thing about this release:

- Acoustic calibration has never heard a real microphone.
- WASAPI loopback capture has never been executed.
- The webOS receiver has never been installed on a television.
- Drift correction has never corrected real drift.
- **Nothing has been heard by a human.**

[0.1.0]: https://github.com/lewisjohnvillamor/homesync/releases/tag/v0.1.0
