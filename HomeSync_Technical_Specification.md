# HomeSync Technical Specification

Status: Draft v0.1  
Date: 2026-08-09  
Purpose: Educational, local-first, self-hosted synchronized audio system  
Working title: **HomeSync**

## 1. Executive Summary

HomeSync is a self-hosted application that synchronizes audio playback across phones, laptops, tablets, and—where supported—LG webOS televisions on the same home network.

The system will use a Rust coordinator for room management, clock synchronization, media distribution, Windows system-audio capture, diagnostics, and optional digital signal processing. Browser receivers will use TypeScript, the Web Audio API, and an `AudioWorklet` because browser media and audio controls are exposed through Web APIs rather than native Rust APIs.

The project is primarily educational. It should teach and demonstrate:

- Real-time networking in Rust
- Network clock synchronization
- Audio buffering and sample scheduling
- Browser audio playback
- Windows loopback audio capture
- Device drift measurement
- Acoustic latency calibration
- Local-network service discovery
- Practical limitations of third-party and DRM-protected players

The first release will not promise that it can capture audio from the normal Netflix, YouTube, Spotify, or other protected application running directly on an LG TV. A separate webOS application does not receive another application's decoded audio, and it cannot delay the other application's video. This is an operating-system access boundary, not a Rust performance problem.

## 2. Product Principles

1. **Local first:** Core synchronization traffic stays on the home LAN.
2. **Self-hosted:** No required account, cloud database, analytics service, or hosted signaling service.
3. **Transparent:** Show clock offset, network latency, buffer health, player drift, and compensation for every receiver.
4. **Progressive accuracy:** Begin with clock synchronization, then add playback calibration and finally acoustic calibration.
5. **Honest capability labels:** Distinguish guaranteed controlled-media synchronization from best-effort third-party-player synchronization.
6. **Rust where it matters:** Use Rust for native capture, timing, networking, processing, and deployment; use browser-native technology for browser playback.
7. **Open protocol:** Keep the synchronization protocol documented so alternative clients can be implemented later.

## 3. Scope

### 3.1 MVP scope

The MVP shall provide:

- A single self-hosted Rust executable
- A local web interface served by the executable
- Room creation and joining through a QR code or short code
- Support for one host/controller and at least four receivers
- Local audio-file playback
- NTP-style server/client clock synchronization
- Scheduled, synchronized playback of preloaded audio
- Play, pause, seek, stop, volume, and mute controls
- Manual per-device timing adjustment
- A live synchronization diagnostics page
- Chrome/Edge desktop support
- Android Chrome support
- Best-effort Safari/iOS support
- Operation without an external cloud service

### 3.2 Post-MVP scope

- Automatic acoustic calibration using a microphone and test chirps
- Official YouTube IFrame Player integration
- Windows WASAPI system-audio capture
- Live PCM streaming over the LAN
- Optional Opus compression
- Dedicated LG webOS receiver application
- Persistent device profiles
- Speaker roles: stereo, left, right, subwoofer, and silent controller
- Movie, Music, and Live latency profiles
- Optional Tauri desktop interface
- Raspberry Pi, Linux, and macOS host support

### 3.3 Explicit non-goals for the initial releases

- Circumventing DRM
- Downloading or extracting protected YouTube, Netflix, or Spotify streams
- Capturing audio from another application running directly on an LG TV
- Guaranteed lip-sync with arbitrary third-party applications
- Internet-wide rooms
- Commercial rebroadcasting of copyrighted content
- Dolby Atmos, DTS, or protected multichannel passthrough
- Replacing professional home-theater audio equipment

## 4. Software-Only Feasibility Boundary

| Scenario | Software-only status | Planned handling |
| --- | --- | --- |
| Local audio file loaded through HomeSync | Fully controllable | Guaranteed synchronization target |
| Local video played inside a future HomeSync player | Fully controllable | Audio and video can share one presentation clock |
| YouTube embedded inside HomeSync on every device | Controllable only through IFrame API | Best-effort rendezvous, calibration, and drift correction |
| Windows Spotify, VLC, browser, or game audio | Capturable through WASAPI | Synchronized audio; source-video lip-sync not guaranteed |
| Netflix running on Windows and displayed on TV over HDMI | Audio can be loopback-captured | Remote speakers can sync with each other; video may lead audio |
| Normal Netflix app running directly on LG TV | Audio not exposed to our app | Unsupported by software-only mode |
| Normal YouTube app running directly on LG TV | Audio not exposed to our app | Unsupported by software-only mode |
| LG TV running the HomeSync webOS app | HomeSync controls only its own playback | Supported as a receiver/controller after device validation |

### 4.1 Why the native LG Netflix case is not software-solvable by HomeSync alone

For synchronization, HomeSync needs at least one of the following:

1. Decoded audio samples to timestamp and distribute
2. Playback-position control on every player
3. Control over the source video's presentation delay

When the normal Netflix application runs on an LG TV, HomeSync has none of these. webOS does not provide an ordinary third-party application with another application's decoded audio stream, and only one foreground media application may own critical media resources. Rust cannot process audio bytes that the operating system never supplies.

A future external audio-capture device could add this capability, but that would no longer be a software-only solution and would still require video-delay management for reliable lip-sync.

## 5. User Experience

### 5.1 Start a local room

1. User runs `homesync` on a Windows PC, Linux machine, Raspberry Pi, or NAS.
2. HomeSync starts a local HTTP/WebSocket service.
3. The terminal or desktop UI displays:
   - Local URL, for example `http://homesync.local:8080`
   - Local IP fallback, for example `http://192.168.1.50:8080`
   - QR code
   - Six-character room code
4. User opens the URL on phones, laptops, or the television browser.
5. Each device chooses a role:
   - Controller only
   - Center/stereo speaker
   - Left speaker
   - Right speaker
   - Subwoofer
6. The host selects a source mode and starts playback.

### 5.2 Source modes

#### Mode A: Controlled Audio

The host uploads or selects a local audio file. Each receiver downloads and decodes the same file before playback. The coordinator announces a future server presentation time. This is the reference mode and shall provide the best synchronization.

#### Mode B: YouTube Together

Each device loads its own official YouTube iframe. The coordinator distributes the video ID, intended playback position, player state, and future rendezvous time. This mode does not redistribute YouTube audio.

#### Mode C: Windows System Audio

The Rust host captures the Windows render endpoint through WASAPI loopback and distributes timestamped live audio blocks. It supports general Windows audio sources but does not guarantee lip-sync with video owned by an external application.

#### Mode D: Controlled Video

Deferred until after the audio MVP. HomeSync owns both the video and audio presentation clocks, allowing video to be delayed to match the receiver audio buffer.

## 6. High-Level Architecture

```text
                            Home Wi-Fi / Ethernet

  +--------------------+      WebSocket/HTTP      +---------------------+
  | Rust Coordinator   |<------------------------>| Browser Receiver    |
  |                    |                           | Phone / Laptop      |
  | - Room state       |<------------------------>|                     |
  | - Clock service    |                           +---------------------+
  | - Media server     |
  | - Audio capture    |      WebSocket/HTTP      +---------------------+
  | - Diagnostics      |<------------------------>| LG webOS Receiver   |
  | - Calibration      |                           | Best effort / app   |
  +--------------------+                           +---------------------+
            ^
            |
            +---- Local file / WASAPI / controlled media source
```

### 6.1 Logical roles

- **Coordinator:** Rust process that owns authoritative room state and time.
- **Controller:** Any UI authorized to issue play, pause, seek, source, and room commands.
- **Media source:** Component that provides controlled file data, YouTube metadata, or captured system audio.
- **Receiver:** Device that renders audio according to presentation timestamps.
- **Calibration microphone:** Optional browser device used to measure physical sound arrival.

The controller and coordinator are separate concepts. An LG TV can appear to be the room host/controller while the actual Rust coordinator runs on a PC or Raspberry Pi.

## 7. Technology Stack

### 7.1 Rust coordinator

Recommended Rust edition: 2024  
Minimum supported Rust version: to be pinned in `rust-toolchain.toml`

| Concern | Initial choice | Notes |
| --- | --- | --- |
| Async runtime | Tokio | Timers, tasks, sockets, graceful shutdown |
| HTTP/WebSocket | Axum | Static app, REST API, control socket |
| Serialization | Serde + serde_json | JSON control messages |
| Binary buffers | Bytes | Audio frame construction |
| Logging | tracing + tracing-subscriber | Structured diagnostics |
| Identifiers | ULID or UUID | Rooms, clients, streams, sessions |
| Service discovery | mdns-sd | `homesync.local` discovery where supported |
| Static assets | rust-embed or include_dir | Single-binary packaging |
| Audio capture | Windows crate/WASAPI wrapper | Windows loopback in Phase 3 |
| Resampling | Rubato | Convert host formats to 48 kHz |
| Compression | audiopus or equivalent | Optional after PCM mode is stable |
| Configuration | Figment or config | File, environment, and CLI settings |
| CLI | clap | Bind address, port, latency mode, diagnostics |

### 7.2 Browser receiver

| Concern | Choice |
| --- | --- |
| Language | TypeScript |
| Build system | Vite |
| UI | Lightweight DOM components initially |
| Audio scheduling | Web Audio API |
| Real-time renderer | AudioWorklet |
| Control transport | WebSocket |
| Binary audio transport | WebSocket for MVP |
| Persistent profile | IndexedDB/localStorage |
| YouTube mode | Official YouTube IFrame Player API |
| Testing | Vitest + Playwright |

### 7.3 Why not pure Rust in the browser

Rust/WASM may be introduced for resampling, Opus decoding, signal correlation, or DSP. It should not replace the small TypeScript integration layer because browser permissions, `AudioContext`, `AudioWorklet`, autoplay unlocking, document visibility, and YouTube iframe control are JavaScript Web APIs.

## 8. Networking Model

### 8.1 Local deployment

- Default bind: `0.0.0.0:8080`
- Browser URL: `http://homesync.local:8080`
- IP fallback shown at startup
- No inbound Internet exposure by default
- No UPnP port forwarding
- No cloud signaling required
- All receivers must be on the same routable LAN for the MVP

### 8.2 Transport selection

#### Control channel

Use one WebSocket per receiver for:

- Clock requests and responses
- Room state
- Playback commands
- Readiness reports
- Buffer status
- Drift reports
- Diagnostics
- Calibration control

#### File delivery

Use HTTP with range support, content hashing, and cache headers. Receivers must verify the media hash before declaring readiness.

#### Live audio delivery

Start with PCM over binary WebSocket frames because it is simple to inspect and gives HomeSync explicit playout-buffer control.

At 48 kHz, stereo, signed 16-bit PCM:

`48,000 samples × 2 channels × 2 bytes = 192,000 bytes/second`, approximately 1.54 Mbit/s per receiver before overhead.

This is acceptable for a small home LAN. Opus compression can be added after correctness is proven.

WebRTC may be evaluated later for NAT traversal or remote rooms, but its internal jitter buffer provides less deterministic application-level presentation control and is unnecessary for the first LAN-only build.

## 9. Clock Synchronization

### 9.1 Clock model

The Rust coordinator owns a monotonic session clock expressed as nanoseconds since coordinator startup. Wall-clock time is never used for media scheduling.

Each browser maintains an estimate mapping:

`server_time_ns <-> performance.now() <-> AudioContext.currentTime`

### 9.2 Four-timestamp exchange

For each sample:

- `t0`: client send time
- `t1`: server receive time
- `t2`: server send time
- `t3`: client receive time

Estimated round-trip delay:

`rtt = (t3 - t0) - (t2 - t1)`

Estimated client/server offset:

`offset = ((t1 - t0) + (t2 - t3)) / 2`

Because client and server timestamps originate in different monotonic domains, the implementation shall normalize each side into a common numeric unit and apply the calculated mapping rather than compare raw epoch values.

### 9.3 Sampling policy

- Collect 20 samples during initial join.
- Prefer the sample with the lowest RTT as the baseline.
- Maintain a rolling window of the most recent 60 samples.
- Reject RTT and offset outliers using median absolute deviation.
- Refresh at least once every 2 seconds during playback.
- Reinitialize after sleep, network change, or large discontinuity.
- Track clock drift as parts per million using linear regression over accepted samples.

### 9.4 Clock-quality states

- `warming_up`
- `stable`
- `degraded`
- `resync_required`
- `suspended`

Playback must not start until required receivers are `stable`, unless the controller explicitly chooses best-effort start.

## 10. Controlled-File Playback Algorithm

1. Coordinator hashes the selected media.
2. Receiver downloads and decodes it.
3. Receiver reports:
   - Hash verified
   - Duration
   - Sample rate
   - Audio context state
   - Decode completed
4. Coordinator chooses a future presentation time, initially at least 2 seconds ahead.
5. Coordinator broadcasts `prepare_play` with media ID, offset, and server presentation time.
6. Receiver translates server presentation time into local `AudioContext` time.
7. Receiver schedules `AudioBufferSourceNode.start(local_time, media_offset)`.
8. Receiver reports actual callback/scheduling observations.
9. Coordinator compares estimated positions and issues a resynchronization only when drift exceeds the configured threshold.

### 10.1 Drift correction

- Under 5 ms: observe only.
- 5–15 ms: slowly correct using bounded resampling in a future release.
- Over 15 ms: schedule a coordinated restart at a near-future frame boundary.
- After background/sleep: stop, remeasure clock, and rejoin at the current host position.

Hard seeks should be minimized because they are audible.

## 11. Live System-Audio Algorithm

### 11.1 Host pipeline

1. Capture the Windows default render endpoint through WASAPI loopback.
2. Convert input into 48 kHz stereo float or signed 16-bit PCM.
3. Divide audio into fixed-duration frames, initially 10 ms.
4. Assign a monotonically increasing sequence number.
5. Assign a server presentation timestamp sufficiently ahead of capture time.
6. Send frames to each receiver.

### 11.2 Receiver pipeline

1. Validate frame header and sequence number.
2. Place samples into an `AudioWorklet` ring buffer.
3. Map presentation timestamp to local audio time.
4. Start rendering only after target buffer depth is reached.
5. Insert silence or conceal loss if a frame is missing.
6. Apply small bounded resampling corrections for drift.
7. Report underruns, overruns, late frames, buffer depth, and output estimate.

### 11.3 Latency profiles

| Profile | Initial target buffer | Intended use |
| --- | ---: | --- |
| Live | 80 ms | Experiments, calls, games; higher dropout risk |
| Movie | 200 ms | General video where source delay is controllable |
| Music | 400 ms | Strong synchronization and Wi-Fi resilience |

The final target will adapt based on measured RTT variance and underrun history.

### 11.4 Binary PCM frame v1

All integer fields use network byte order.

| Field | Type | Description |
| --- | --- | --- |
| Magic | 4 bytes | `HSYN` |
| Version | `u8` | Protocol version `1` |
| Flags | `u8` | Discontinuity, silence, calibration |
| Format | `u8` | `1 = s16le`, `2 = f32le`, later `3 = Opus` |
| Channels | `u8` | Initially `1` or `2` |
| Sample rate | `u32` | Normally `48000` |
| Sequence | `u64` | Monotonic stream frame number |
| Presentation time | `u64` | Coordinator monotonic nanoseconds |
| Frame samples | `u16` | Samples per channel |
| Payload length | `u32` | Payload bytes |
| Payload | bytes | Interleaved samples or encoded packet |

## 12. YouTube Together Mode

### 12.1 Architecture

Every participant uses its own official YouTube iframe. HomeSync distributes control and timing data only.

### 12.2 Rendezvous sequence

1. Controller selects a YouTube video ID.
2. All clients load/cue the same ID.
3. Clients report player ready, duration, state, and buffer status.
4. Coordinator selects a target video position and a future server time.
5. Clients pause and seek to the target.
6. Clients wait for a ready/cued/paused state.
7. Each client calls `playVideo()` early by its learned start-latency estimate.
8. After playback begins, clients report `getCurrentTime()`.
9. HomeSync updates a bounded exponential-moving-average estimate for that device's playback-start latency.
10. Large drift causes a new coordinated rendezvous.

### 12.3 Expected limitations

- Ads may differ across devices.
- Some videos prohibit embedding.
- Independent buffering may interrupt a client.
- The IFrame API does not provide sample-accurate audio scheduling.
- Unsupported arbitrary playback rates cannot be relied upon.
- Autoplay requires a user interaction on many devices.
- Hidden/background pages may be throttled or suspended.
- This mode is experimental until validated acoustically on each target platform.

## 13. Acoustic Calibration

### 13.1 Goal

Measure when sound physically reaches a chosen listening position, not merely when software reports that playback started.

### 13.2 Procedure

1. User chooses a calibration microphone, normally a phone.
2. Microphone access is granted.
3. Coordinator schedules a calibration sequence.
4. Each receiver plays a unique coded chirp individually.
5. Microphone captures the room response.
6. Client or Rust/WASM DSP performs cross-correlation against the source chirp.
7. Repeat at least five times per receiver.
8. Reject noisy/outlier measurements.
9. Calculate median acoustic arrival latency.
10. Add delay to faster receivers to match the slowest receiver.
11. Save calibration by device ID, browser, OS, and selected output route where detectable.

### 13.3 Calibration caveats

- Bluetooth output changes must invalidate or separate the profile.
- Moving the calibration microphone changes distance compensation.
- Echo and reverberation require robust correlation and outlier rejection.
- Browser microphone capture requires HTTPS or another secure-context deployment.
- Calibration measures the chosen listening position, not every point in a room.

## 14. LG webOS Strategy

### 14.1 Phase 1

Test the normal LG browser as a receiver for controlled file mode. Detect missing APIs and display a compatibility report.

### 14.2 Phase 2

Package a dedicated webOS application containing:

- Persistent receiver identity
- QR/room-code entry
- Remote-friendly navigation
- Screen burn-in prevention
- Reconnection handling
- HTML audio playback fallback
- Device and firmware diagnostics

### 14.3 Required caution

LG documents meaningful Web Audio limitations, including high latency on some webOS versions. The implementation shall prefer the simplest reliable playback path and must not claim uniform support across LG model years without physical testing.

### 14.4 Controller versus source

The TV may be the visible room controller while the Rust coordinator runs elsewhere. Opening HomeSync on the TV does not grant access to audio from the separate Netflix or YouTube TV applications.

## 15. Control Protocol

### 15.1 Envelope

```json
{
  "v": 1,
  "type": "message_type",
  "request_id": "01J...",
  "room_id": "ABC123",
  "client_id": "01J...",
  "sent_server_ns": 1234567890,
  "payload": {}
}
```

### 15.2 Initial messages

- `hello`
- `welcome`
- `join_room`
- `leave_room`
- `room_snapshot`
- `client_update`
- `clock_ping`
- `clock_pong`
- `select_source`
- `media_manifest`
- `receiver_ready`
- `prepare_play`
- `play`
- `pause`
- `seek`
- `stop`
- `volume`
- `mute`
- `buffer_report`
- `drift_report`
- `diagnostic_report`
- `calibration_start`
- `calibration_result`
- `youtube_state`
- `youtube_rendezvous`
- `error`

### 15.3 Authority model

- The coordinator is authoritative for room and playback state.
- The initial room creator becomes owner/controller.
- Additional controllers require owner approval.
- Receiver messages are validated by type and state transition.
- Stale session IDs and sequence numbers are rejected.

## 16. HTTP API

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/` | Receiver/controller web app |
| `GET` | `/health` | Basic process health |
| `GET` | `/api/v1/info` | Version and capabilities |
| `POST` | `/api/v1/rooms` | Create room |
| `GET` | `/api/v1/rooms/{id}` | Room metadata for authorized client |
| `GET` | `/api/v1/media/{id}` | Media delivery with range support |
| `GET` | `/api/v1/media/{id}/manifest` | Hash, format, duration, metadata |
| `GET` | `/api/v1/diagnostics` | Local diagnostics, authorization required |
| `GET` | `/ws` | Control and binary-stream WebSocket |

The API shall not expose local files by arbitrary path.

## 17. Security and Privacy

- Bind only to private/local interfaces by default.
- Generate a random room secret in addition to the short display code.
- Put the secret in the QR invitation fragment or a one-time exchange.
- Rate-limit join attempts and room creation.
- Validate all JSON sizes and binary frame lengths.
- Set a maximum receiver count.
- Prevent arbitrary filesystem access.
- Do not log media contents, auth secrets, or full invitation URLs.
- Do not upload audio or diagnostics externally.
- Provide a visible indicator when system audio or microphone capture is active.
- Require explicit user interaction for capture.
- Treat all LAN clients as untrusted.
- Document that HTTP LAN mode is suitable only for trusted home networks.
- Require HTTPS for microphone calibration and installable PWA features.

## 18. Persistent Data

No database is required for the MVP.

Local coordinator configuration may use TOML or SQLite for:

- Known device IDs and friendly names
- Saved timing compensation
- Calibration profiles
- Preferred speaker roles
- Output-route notes
- Room defaults
- Diagnostic history, if explicitly enabled

Media files are not copied permanently unless the user requests caching.

## 19. Diagnostics

Each receiver should report:

- Client and protocol version
- Browser and operating-system family
- Audio sample rate
- `AudioContext` state
- Clock offset estimate
- RTT minimum, median, p95, and jitter
- Clock-drift estimate
- Scheduled versus observed play time
- Reported media position
- Estimated player drift
- Buffer target and current depth
- Underrun and overrun counts
- Dropped and late frames
- Manual compensation
- Acoustic compensation
- Output route when available
- Page visibility and wake/suspension events

The UI shall distinguish:

- Network synchronization
- Player timeline synchronization
- Estimated physical output synchronization

## 20. Performance and Quality Targets

### 20.1 Controlled-file mode

- Median clock-offset error: under 2 ms on a stable LAN
- Speaker-to-speaker software schedule difference: under 5 ms
- Acoustic difference after calibration: target under 10 ms
- Thirty-minute drift without hard resync: target under 10 ms
- Room join time: under 15 seconds after page load

### 20.2 Live PCM mode

- Four stereo receivers on normal 5 GHz Wi-Fi
- No underruns for 30 minutes in Music profile
- Stable end-to-end latency under 500 ms in Music profile
- Stable end-to-end latency under 250 ms in Movie profile where network permits
- Graceful degradation rather than uncontrolled buffer growth

### 20.3 YouTube mode

- Target watch-party difference: under 100 ms
- Stretch target acoustic difference: under 20 ms on validated devices
- Automatic recovery after buffering
- No claim of guaranteed sample accuracy

## 21. Project Structure

```text
homesync/
├── Cargo.toml
├── rust-toolchain.toml
├── README.md
├── LICENSE
├── docs/
│   ├── architecture.md
│   ├── protocol.md
│   ├── calibration.md
│   ├── compatibility.md
│   └── self-hosting.md
├── crates/
│   ├── homesync-server/
│   │   ├── src/http/
│   │   ├── src/ws/
│   │   ├── src/rooms/
│   │   ├── src/media/
│   │   └── src/main.rs
│   ├── homesync-protocol/
│   │   └── src/lib.rs
│   ├── homesync-clock/
│   │   └── src/lib.rs
│   ├── homesync-audio/
│   │   ├── src/capture/
│   │   ├── src/resample/
│   │   ├── src/frame.rs
│   │   └── src/lib.rs
│   └── homesync-dsp/
│       └── src/lib.rs
├── web/
│   ├── src/audio-worklet/
│   ├── src/clock/
│   ├── src/network/
│   ├── src/player/
│   ├── src/youtube/
│   ├── src/calibration/
│   ├── src/diagnostics/
│   └── src/main.ts
├── webos/
│   └── receiver-app/
├── tests/
│   ├── network-simulation/
│   ├── protocol-fixtures/
│   └── device-matrix.md
└── scripts/
    ├── build-release.*
    └── run-lan-test.*
```

## 22. Testing Strategy

### 22.1 Rust tests

- Clock formula and mapping tests
- Simulated asymmetric latency
- Clock drift and discontinuity tests
- Room-state transition tests
- Protocol validation and fuzzing
- Binary audio-frame round-trip tests
- Ring-buffer model tests
- Loss/reordering simulation
- WASAPI format conversion tests
- Graceful shutdown and reconnect tests

### 22.2 Browser tests

- Audio unlock and suspended-context recovery
- File download, hashing, and decode readiness
- Scheduled playback with mocked clocks
- Background/foreground recovery
- YouTube iframe fake-player state tests
- AudioWorklet buffer underrun/overrun behavior
- Manual compensation sign and persistence

### 22.3 Physical device matrix

Minimum initial matrix:

- Windows 11 + Chrome
- Windows 11 + Edge
- Android + Chrome
- iPhone + Safari
- macOS + Safari or Chrome
- At least one recent LG webOS TV
- One older LG webOS TV if available
- Wired host with Wi-Fi receivers
- All-Wi-Fi configuration
- Optional Bluetooth output on one receiver

### 22.4 Network impairment tests

Simulate:

- Fixed latency
- Variable jitter
- Packet loss
- Packet duplication
- Reordering
- Temporary disconnection
- Receiver sleep and wake
- Coordinator restart

## 23. Development Milestones

### Milestone 0: Timing laboratory

- Rust Axum server
- Browser WebSocket client
- Four-timestamp clock exchange
- Live offset/RTT dashboard
- Simulated clients and automated clock tests

Exit criterion: Stable clock mapping across two browsers for 30 minutes.

### Milestone 1: Controlled audio MVP

- Local file selection
- HTTP media delivery
- Client decode/readiness barrier
- Scheduled play/pause/seek
- Manual compensation
- Four receivers

Exit criterion: Two nearby laptops/phones play without an obvious echo.

### Milestone 2: Measurement and calibration

- Diagnostic event stream
- Calibration chirps
- Microphone recording
- Cross-correlation
- Saved device compensation

Exit criterion: Acoustic difference under 10 ms in a repeatable two-device test.

### Milestone 3: YouTube Together

- Official iframe integration
- Ready/buffer barrier
- Future-position rendezvous
- Learned start-latency estimate
- Drift detection and recovery

Exit criterion: Three validated devices remain acceptably aligned for a 30-minute video.

### Milestone 4: Windows system audio

- WASAPI loopback
- PCM framing
- AudioWorklet ring buffer
- Adaptive buffer
- Live/Movie/Music profiles

Exit criterion: Four receivers play Windows audio for 30 minutes without underruns in Music mode.

### Milestone 5: LG webOS receiver

- Compatibility probe
- Dedicated app packaging
- Persistent device profile
- TV remote UI
- HTML audio/Web Audio strategy

Exit criterion: At least one documented LG model operates reliably as a HomeSync receiver.

## 24. Differentiation

HomeSync should not differentiate itself merely by replacing a TypeScript coordinator with Rust. Its defensible technical focus is:

1. **Automatic acoustic calibration**, measuring sound in the room rather than only software clocks.
2. **Transparent synchronization diagnostics** for learning and troubleshooting.
3. **Local-only single-binary self-hosting** with no mandatory cloud services.
4. **Universal Windows audio capture** for personal LAN use.
5. **First-class LG webOS investigation and documented compatibility.**
6. **Open, versioned synchronization protocol.**
7. **Adaptive latency profiles** for music, movies, and low-latency experiments.
8. **Honest separation of controlled, best-effort, and unsupported media modes.**

## 25. Major Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Browser timer throttling | Receiver drifts after backgrounding | Wake lock where available; visibility detection; full resync on resume |
| Autoplay restrictions | Silent receiver | Require explicit Join/Enable Audio interaction |
| LG Web Audio latency | TV cannot align reliably | Dedicated app; HTML audio fallback; measured compensation; compatibility list |
| Independent YouTube ads/buffering | Iframe players diverge | Detect state mismatch; pause room or exclude affected receiver |
| Wi-Fi jitter | Underruns and echo | Adaptive buffer; wired coordinator; diagnostics |
| Bluetooth latency changes | Saved profile becomes wrong | Separate/invalidate profiles when output changes |
| PCM bandwidth | Congestion with many devices | Limit room size; add Opus after MVP |
| Microphone echo/reverb | Incorrect acoustic measurement | Coded chirps, repetition, cross-correlation, outlier rejection |
| External-player video leads audio | Poor Netflix/VLC lip-sync | Label as audio-only/best-effort unless video is controlled |
| HTTPS setup on LAN | Calibration unavailable over HTTP | Document local certificate/Caddy option; defer microphone mode until configured |

## 26. Initial Decisions

- Rust is approved for the coordinator and native host.
- TypeScript is approved for browser integration.
- LAN-only operation comes before remote Internet rooms.
- Controlled local audio comes before YouTube and system audio.
- PCM comes before Opus for easier debugging.
- WebSocket comes before WebRTC for deterministic local control.
- Acoustic calibration is the primary differentiator.
- The LG TV is initially a receiver/controller, not a source of other applications' audio.
- Native LG Netflix/YouTube application capture is outside the software-only product boundary.
- Performance claims require physical-device measurements, not only simulated tests.

## 27. Immediate Next Steps

1. Create the Rust workspace and web application skeleton.
2. Define protocol v1 types in Rust and TypeScript.
3. Implement the four-timestamp clock exchange.
4. Build a live clock-quality dashboard.
5. Test two browsers on the same LAN for 30 minutes.
6. Implement controlled local-file preload and scheduled playback.
7. Measure actual acoustic difference with an external recording before building YouTube mode.

## 28. Success Definition

The educational project succeeds when it can demonstrate and explain the difference between:

- Network clock synchronization
- Browser player synchronization
- Physical speaker synchronization
- Audio-to-video lip synchronization

The product prototype succeeds when controlled audio can be played across multiple ordinary devices on a home network without an audible echo, with measurements showing how and why synchronization was achieved.
