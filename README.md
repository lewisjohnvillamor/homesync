# HomeSync

Self-hosted synchronised audio for a home network. A single Rust binary serves
a browser client to every device on the LAN, measures each device's clock
against its own, and schedules the same preloaded audio file to start at one
agreed instant.

The full design lives in [`HomeSync_Technical_Specification.md`](HomeSync_Technical_Specification.md).
This repository currently implements **Milestone 0 (timing laboratory)** and
**Milestone 1 (controlled audio MVP)** from that document — deliberately, and
in that order. Live PCM streaming, YouTube Together, Windows capture and webOS
are not built yet; see [Status](#status).

## Quick start

```sh
cargo run --release
```

The coordinator prints a LAN URL, a room code, an invite link and a QR code.
Open the link on two devices, press **Enable audio & join** on each, pick
**Click track (built-in, 60 s)** and press **Play**.

```sh
cargo run --release -- --port 8080 --media-dir ~/Music
```

Any `wav/mp3/m4a/aac/ogg/opus/flac/webm` file in `--media-dir` joins the
catalogue. The built-in click track is always present, so the timing
checkpoints are runnable on a fresh checkout with no audio files at all.

## What it does

- **Clock synchronisation.** Four-timestamp exchange over the control
  WebSocket, with median-absolute-deviation outlier rejection, a
  lowest-round-trip offset estimate, drift measured by linear regression, and
  confirmation before a jump is believed to be a real clock step.
- **Scheduled playback.** The coordinator publishes one authoritative timeline
  (`epoch`, `state`, `anchor_server_ns`, `anchor_media_ns`). Every receiver
  translates the anchor instant into its own `AudioContext` clock and calls
  `AudioBufferSourceNode.start` against it. Join, resume, seek and late arrival
  all follow that single path.
- **A readiness barrier.** Playback is refused until every receiver has
  verified the media hash and holds a `stable` clock — with an explicit
  best-effort override.
- **Per-device compensation.** A manual millisecond adjustment, persisted per
  device, applied to the scheduled start and reported to the room.
- **Diagnostics.** Per device: clock quality, offset, round-trip time, offset
  uncertainty, drift in ppm, readiness, and timeline drift. The UI keeps
  network agreement and player agreement visibly separate, and says plainly
  that neither is an acoustic measurement.
- **Single binary.** The web client is embedded with `rust-embed`; there is no
  build step, no bundler and no npm dependency.

## Checkpoints

The project is judged by the checkpoints in
[`docs/checkpoints.md`](docs/checkpoints.md), which also gives the exact
procedure for each.

| # | Checkpoint | Status |
| --- | --- | --- |
| 1 | Clock agreement within a few ms | **Automated.** `cargo run -- --simulate 3 --simulate-seconds 60 --simulate-then-exit` |
| 2 | Two laptops, no obvious echo | **Ready to run.** Needs two real machines |
| 3 | Mixed devices within 10–20 ms after compensation | **Ready to run.** Needs real devices |
| 4 | Automatic acoustic calibration | Not implemented |
| 5 | YouTube Together | Not implemented |
| 6 | LG webOS receiver | Not implemented |

Checkpoint 1 passes on loopback with roughly 0.01 ms of cross-client
disagreement. That proves the exchange and the estimator; it says nothing about
Wi-Fi, browser throttling or what a microphone in the room would hear.
Checkpoints 2 and 3 cannot be automated here — they need two physical devices
in one room and a pair of ears.

## Testing

```sh
./scripts/check.sh
```

Runs `cargo fmt --check`, `cargo clippy -D warnings`, `cargo test`, the browser
unit tests, a headless two-browser end-to-end run, and the checkpoint-1
simulation.

- **Browser unit tests** (`node --test 'web/test/*.test.mjs'`) need Node 18+ and
  no packages. `web/test/clock.test.mjs` mirrors the Rust clock tests case for
  case, because the two implementations of the estimator must not drift apart.
- **End-to-end** (`node web/test/e2e.mjs`) starts a real coordinator and drives
  two headless Chromium receivers through join, clock warm-up, hash
  verification, decode, the readiness barrier, play, pause, resume and
  compensation, failing on any uncaught JS error. Skips cleanly without
  Playwright. Headless Chromium renders to a null sink, so this proves the
  client schedules correctly — not that a room sounds synchronised.

## Repository layout

```text
crates/homesync-protocol   Control protocol v1 types, shared and tested
crates/homesync-clock      Clock estimator: the tested reference implementation
crates/homesync-server     Coordinator: HTTP, WebSocket, rooms, media
web/src                    Browser client, plain ES modules, embedded in the binary
web/test                   Browser tests (node --test, no dependencies)
docs/                      Protocol reference and checkpoint procedures
```

## Status

Built and working:

- Controlled local audio, preloaded and scheduled (Mode A in the specification)
- Clock service, room service, media delivery with range support, diagnostics

Not built, and not claimed:

- **Live PCM streaming and Windows WASAPI capture.** The binary frame format is
  specified but the socket rejects binary frames today.
- **YouTube Together.** Nothing in this build touches the IFrame API.
- **Acoustic calibration.** No chirps, no microphone, no cross-correlation.
  Every latency number in the UI comes from software reports, not from sound.
- **LG webOS.** Untested. The ordinary TV browser may work as a receiver;
  nobody has tried it.
- **Multiple simultaneous rooms.** One room is created at startup.

Known deviations from the specification, made deliberately:

- Any room member may issue transport commands, not only the owner. Spec
  section 15.3 wants owner-approved controllers; on a trusted LAN, requiring
  approval before a phone can press pause is friction without a threat model to
  justify it. The owner is still shown in the UI.
- The browser client is plain ES modules rather than TypeScript with Vite. This
  keeps the "one executable, no build step" property. If the client grows
  enough to need types, that trade should be revisited.
- `stable` clock quality is defined at 5 ms of uncertainty rather than 2 ms,
  because the uncertainty figure includes a half-round-trip bound that a
  healthy LAN already spends. The 2 ms figure in spec section 20.1 is an
  accuracy target, which the estimator meets; it is not a usable gate.
