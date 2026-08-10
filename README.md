# HomeSync

Self-hosted synchronised audio for a home network. A single Rust binary serves
a browser client to every device on the LAN, measures each device's clock
against its own, and schedules audio to be *heard* at one agreed instant.

The full design lives in [`HomeSync_Technical_Specification.md`](HomeSync_Technical_Specification.md).
All six milestones from that document are now implemented. How thoroughly each
one has been *verified* varies enormously — see [Status](#status), which is the
most important section in this file.

## Quick start

```sh
cargo run --release
```

The coordinator prints a LAN URL, a room code, an invite link and a QR code.
Open the link on two devices, press **Enable audio & join** on each, pick
**Click track (built-in, 60 s)** and press **Play**.

```sh
cargo run --release -- --tls --media-dir ~/Music
```

Any `wav/mp3/m4a/aac/ogg/opus/flac/webm` file in `--media-dir` joins the
catalogue. The built-in click track is always present, so the timing
checkpoints are runnable on a fresh checkout with no audio files at all.

**`--tls` is required for acoustic calibration.** Browsers refuse microphone
access on a plain-HTTP LAN address, so without it no device can be the
calibration microphone. HomeSync signs its own certificate and each device
shows a warning once. See [`docs/self-hosting.md`](docs/self-hosting.md).

Open `/probe.html` on any device to find out whether it can hold a schedule
before trusting it as a receiver.

## Source modes

| Mode | What it does | Timing story |
| --- | --- | --- |
| **Music** | Every receiver preloads, verifies and schedules the same file, and follows a queue | Guaranteed: one timeline, sample-scheduled |
| **YouTube together** | Every device runs its own YouTube player; HomeSync distributes a position and an instant | Best effort: learned per-device start latency, drift re-convergence |

Music takes a queue: tracks play in order and the coordinator advances on its
own. Receivers decode the next track while the current one plays, so the gap
between them is the ordinary scheduling lead rather than a download.

Each device also has its own five-band equaliser, which shapes only that
device's output — the point being that a boomy speaker in the kitchen can be
tamed without touching anything else in the room. It applies to Music alone: a
YouTube player's audio never reaches the page, so nothing in the client can
filter it. Calibration chirps bypass it deliberately, so an acoustic
measurement still hears the speaker rather than the filters.

Music is the reference mode and the only one with a guaranteed timing story.
YouTube is best-effort *by construction*, not by omission — the reasons are in
[`docs/protocol.md`](docs/protocol.md).

A third mode, **live system audio**, exists in the protocol and the
coordinator: the host captures its own output and streams timestamped PCM,
which receivers still know how to play. The interface offers no way to start
one, because the Windows capture path has never been run against real
hardware and an unverified mode does not belong next to two that work.

## What it does

- **Clock synchronisation.** Four-timestamp exchange with median-absolute-
  deviation outlier rejection, a lowest-round-trip offset estimate, drift by
  linear regression, and confirmation before a jump is believed to be a real
  clock step.
- **Scheduled playback.** One authoritative timeline; every receiver translates
  the anchor instant into its own `AudioContext` clock. Join, resume, seek and
  late arrival all follow that single path.
- **Acoustic calibration.** Coded chirps, match filtering through an in-house
  FFT, first-arrival detection that survives a reflection louder than the
  direct sound, repetition with outlier rejection, and a solver that will not
  let a device with wandering latency drag the whole room. This is the
  differentiator; see [`docs/calibration.md`](docs/calibration.md).
- **Live PCM streaming.** Binary frames on the control socket, an `AudioWorklet`
  playout buffer with gap concealment and loss/reorder/duplicate handling, and
  three latency profiles.
- **A readiness barrier.** Playback is refused until every receiver is ready
  and holds a stable clock — with an explicit best-effort override.
- **Diagnostics that distinguish three different things:** network agreement,
  player-timeline agreement, and physically-measured alignment. Only the third
  is real, and only after a calibration run.
- **Single binary.** The web client is embedded; no bundler, no npm dependency,
  no build step.
- **Compensation that survives a restart.** Values found by ear or by
  calibration are saved per device and restored when it rejoins — losing them
  to a restart would make the feature feel unreliable even when it works.
- **`homesync.local` over mDNS**, so devices can be pointed at a name instead
  of an address read off a terminal. Android does not resolve `.local`, and the
  banner says so rather than pretending.
- **A diagnostics export**, so a problem is a JSON file rather than a
  description of a sound.

## Testing

```sh
./scripts/check.sh
```

Runs formatting, clippy, the Rust suite, the browser unit tests, a
two-headless-browser end-to-end run, and the checkpoint-1 clock simulation.

- **150 Rust tests.** Clock estimation against synthetic latency, jitter, drift
  and step discontinuities; calibration DSP against noise, reflections and
  differing sample rates; frame codec against every malformed input; playout
  buffer against loss, reordering, duplication and clock skew; room state
  machine.
- **Four integration tests** drive the real coordinator binary over a socket
  with fake devices:
  - *Calibration loop* — a fake microphone uploads recordings in which the
    chirp sits at a **known** delay, so the test asserts against ground truth:
    40 ms and 180 ms are measured, solved to −140 ms of compensation, and
    applied to the room. A third device nobody heard is reported as
    unmeasured rather than guessed.
  - *Live stream* — a receiver decodes 400 consecutive frames and checks
    contiguous sequence numbers, exactly 10 ms presentation spacing, no
    re-anchoring, and a lead over real time that does not shrink. Reverting
    the capture-pacing fix makes it fail, so it has teeth.
  - *Diagnostics access* — the export is gated on the room secret, and public
    endpoints never carry it.
- **47 browser tests.** `web/test/clock.test.mjs` mirrors the Rust clock tests
  case for case, and `web/test/live.test.mjs` mirrors the playout buffer tests,
  because both algorithms exist twice and must not drift apart.
- **End-to-end** (`node web/test/e2e.mjs`) drives two headless Chromium
  receivers through join, clock warm-up, hash verification, decode, the
  readiness barrier, play/pause/resume, compensation, a live PCM stream, and a
  YouTube rendezvous — failing on any uncaught JS error in our own code.
- **Windows capture** is type-checked with
  `cargo check --target x86_64-pc-windows-msvc -p homesync-audio`.

## Repository layout

```text
crates/homesync-protocol   Control protocol v1 types, shared and tested
crates/homesync-clock      Clock estimator: the tested reference implementation
crates/homesync-dsp        Chirps, FFT, correlation, alignment solving
crates/homesync-audio      PCM framing, playout buffer, capture, WAV
crates/homesync-server     Coordinator: HTTP, WebSocket, rooms, streaming, calibration
web/src                    Browser client, plain ES modules, embedded in the binary
web/test                   Browser tests (node --test, no dependencies)
webos/receiver-app         LG webOS receiver shell (never run on a TV)
docs/                      Protocol, calibration, checkpoints, compatibility
```

## Status

This is the part to read before trusting anything.

### Verified here

- Clock exchange and estimator, in Rust and in the browser.
- Controlled-audio scheduling: two headless browsers join, verify, and schedule
  against one instant with zero JS errors.
- Live PCM: 400 consecutive frames arrive contiguous and exactly 10 ms apart,
  holding a 456 ms lead against an expected 460 ms with +11 ms of drift across
  the run. Buffers prime and underruns settle to zero.
- YouTube: the rendezvous reaches every device and the transport converges.
- Checkpoint 1 passes headlessly with ~0.01 ms of cross-client disagreement.
- HTTPS: a browser reaches the coordinator over `wss`, reports
  `isSecureContext`, and exposes `getUserMedia` — which is what makes
  calibration reachable on a real phone at all.
- Persistence: a device whose browser storage was cleared rejoins and recovers
  its compensation from the coordinator.

The **Devices** panel says in one line whether the room is actually together —
"2 devices playing together", or "Kitchen TV is 2.4 s behind the room". It is
computed by the coordinator, which is the only party that sees every device's
telemetry, and it travels in the diagnostics export unchanged.

### Implemented but never run against reality

- **Acoustic calibration has never heard a real microphone.** The DSP and the
  whole coordinator loop are tested against synthetic recordings with known
  ground truth — that is not the same as a speaker, a room and a phone.
- **WASAPI loopback capture has never been executed.** It compiles for Windows
  and that is all anyone knows. This is why live system audio no longer has a
  button: the integration test still exercises the streaming path against a
  synthetic source, but nothing has captured real audio.
- **The webOS receiver has never been packaged or installed on a television.**
- **Nothing has been heard by a human.** Headless Chromium renders into a null
  audio sink: it can prove the client schedules correctly, never that a room
  sounds synchronised. Live-mode buffer depth in particular is not meaningful
  without real audio hardware.

Checkpoints 2 through 6 in [`docs/checkpoints.md`](docs/checkpoints.md) are the
procedures for closing that gap, and `docs/compatibility.md` is where the
results belong — including the failures.

### Not implemented

- Opus compression. PCM only; the format code is reserved and rejected.
- Multiple simultaneous rooms. One room is created at startup.
- Rate limiting on join attempts (spec section 17).
- Controlled video (mode D), so no lip-sync with HomeSync-owned video.
- Bounded resampling for slow drift correction; drift over threshold causes a
  coordinated restart instead.

### Deliberate deviations from the specification

- **Any room member may issue transport commands**, not only the owner. Spec
  section 15.3 wants owner-approved controllers; on a trusted LAN, requiring
  approval before a phone can press pause is friction without a threat model.
  The owner is still shown in the UI.
- **The browser client is plain ES modules**, not TypeScript with Vite. This
  keeps the "one executable, no build step" property. If the client grows
  enough to need types, revisit the trade.
- **`stable` clock quality is 5 ms of uncertainty, not 2 ms.** The uncertainty
  figure includes a half-round-trip bound that a healthy LAN already spends;
  2 ms would mark good networks degraded. The estimator still meets the 2 ms
  accuracy target — there is a test.
- **Live system-audio capture is Windows-only.** cpal on Linux needs ALSA
  development headers, which would burden every build for a feature the
  specification scopes to WASAPI. The synthetic source covers the rest.

### What will not work, ever, in software alone

Capturing audio from Netflix, YouTube or Spotify running as their own apps on
an LG television. webOS does not give one application another application's
decoded audio, and only one foreground app owns the media resources. This is an
operating-system boundary, not a performance problem — see specification
section 4.1.
