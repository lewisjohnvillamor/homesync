# Changelog

All notable changes to HomeSync. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[semantic versioning](https://semver.org/spec/v2.0.0.html).

Entries say what changed and, where it matters, what has and has not been
verified. A feature that exists but has never run against real hardware is
listed as such rather than as done — see [Status](README.md#status).

## [Unreleased]

### Security

- **A crafted MP4 could stall a rescan.** The walk that finds a `moov` atom past
  the scan window costs a seek and a read per top-level atom, and an atom may
  declare itself the minimum eight bytes long — so a file of nothing but those
  asks for one syscall pair per eight bytes of it. Measured: a 30 MB file of
  minimum-size atoms took 2.0 s to index against 0.5 s for an ordinary file of
  the same size, and the fetch limit allows ten times that. It is reachable by
  anyone who can drop a file in a media folder or call the library fetch. The
  walk now gives up after 4096 top-level atoms, which no real file approaches;
  the same crafted file now costs exactly what its size says it should.

- **`h2` updated to 0.4.18** for RUSTSEC-2026-0258, unbounded empty DATA frames.
  It arrives under `reqwest` and `axum`, so it sits on both the outbound fetch
  path and the coordinator's own listener.

### Fixed

- **Timing compensation did nothing audible during a YouTube video.** A device
  playing its own audio applies a new compensation itself, by rescheduling the
  buffer it holds. A YouTube receiver cannot: its start instant was fixed by the
  last rendezvous, and the compensation only enters the arithmetic when a new
  one is issued — which a `client_update` did not do. So moving the slider
  changed the number on screen and the number the coordinator reported, and
  nothing a listener could hear, until the next play, seek or drift correction
  happened to arrive. Exactly the case the panel exists for — a television that
  emits sound late — was the case it could not fix. Changing compensation now
  re-converges that one device, leaving the room's timeline and every other
  device alone.

- **Dragging the compensation slider restarted the audio at every step.** The
  value was applied on each `input` event, and applying it stops and restarts
  this device's source, so a drag across the range was a burst of restarts — and
  so was holding an arrow key on it. The number now follows the slider
  immediately and the value is applied once it settles; typing into the box
  beside it still applies at once. Setting a compensation the device already has
  no longer reschedules at all, which also stops a reconnect or a restored
  profile interrupting playback.

- **The coordinator read a whole track into memory to serve any part of it.**
  `GET /api/v1/media/{id}` read the entire file and then, for a range request,
  copied the range out of it — so a 1 MB range of a 40 MB FLAC cost 41 MB, and
  range support cost more memory than not having it. Nothing was shared between
  requests either, so five devices pulling the same track cost five copies. The
  endpoint now seeks to the range and streams it in 64 kB chunks: peak memory is
  a chunk, whatever the size of the track or the number of listeners. Measured
  on a 100 MB file with four devices fetching it at once, peak resident memory
  went from 429 MB to 43 MB, and serving no longer raises the high-water mark
  the startup scan set. This is the server-side half of the memory problem whose
  client-side half was the duplicated decode buffer below.

- **Every media load held two copies of the compressed file.** The decoder was
  handed `bytes.slice(0)` to keep the original "for any retry" — but nothing
  retries, so the copy only ever doubled the compressed footprint. Measured on a
  12 MB FLAC: the original was still resident after decoding the copy. FLAC felt
  it worst because its compressed size is five to ten times an MP3's, which is
  why a television ran out of memory on FLAC and nowhere else.

### Changed

- **The startup scan no longer buffers whole files to hash them.** Each file was
  read entirely into memory so it could be hashed and its tags read, which made
  indexing a long recording or an audiobook cost as much memory as the file. The
  scan now streams the hash in chunks and keeps a bounded 16 MiB window for the
  tag parsers, sized up front rather than grown — a window reached by doubling
  holds the old buffer and the new one at the moment it reallocates, which cost
  a further 8 MB of peak that the bound did not describe. Indexing now costs the
  same whatever the length of the track. An
  MP4 that writes its tags after its audio — the usual shape for a long
  recording — has its `moov` atom located by seeking the top-level boxes rather
  than by reading the audio in between, so covers past the window are still
  found. Indexing that same 100 MB file went from 120 MB of peak memory to
  43 MB.

- **The equaliser is out of the signal path until a slider moves.** Five biquad
  filters sat in front of the output permanently, filtering every sample on
  every device whether or not anyone had touched them. At flat — the default
  nobody changes — they altered nothing audible and still cost the arithmetic,
  worst on a television running one filter pass per band per sample. The chain
  is now built on the first non-flat setting and taken out again on Flat, and a
  playing source follows the change.
- **Volume moved into the transport**, beside the scrubber, as a popover with
  mute. It is where every media player has kept it for thirty years, and it
  leaves the device panel to the two settings that are actually about this
  device. The speaker icon shows silence whether it came from mute or from
  zero, because those sound identical and a control claiming to be on while
  nothing plays is how somebody ends up checking their cables.
- **The equaliser moved into Advanced.** Still per-device, still saved, but a
  five-band filter bank is not what the main view is for.

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
