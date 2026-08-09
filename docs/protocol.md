# HomeSync control protocol v1

Implemented by `crates/homesync-protocol` (Rust) and `web/src/net.js` (browser).
Control messages are JSON text frames on the `/ws` WebSocket. Live audio uses
binary frames on the same socket, coordinator to receiver only.

## Envelope

```json
{
  "v": 1,
  "type": "clock_ping",
  "request_id": "optional, echoed on the reply",
  "sent_server_ns": 1234567890,
  "payload": { }
}
```

- `v` must be `1`. Anything else is answered with `error: bad_version`.
- `sent_server_ns` is present on server-originated frames only.
- `payload` is omitted for messages that carry no data (`pause`, `stop`,
  `leave_room`).
- Frames larger than 64 KiB are rejected.

## Time

All coordinator timestamps are **nanoseconds since coordinator startup**, taken
from a monotonic clock. Wall-clock time is never used for scheduling, so an NTP
correction on the host cannot move a scheduled playback start.

Clients keep their own monotonic domain (`performance.now()` in the browser)
and an estimated offset between the two.

## Clock exchange

```text
client                              coordinator
  |  clock_ping { t0, seq }  ------->  t1 = now (stamped before parsing)
  |                                    t2 = now (stamped before sending)
  |  <------- clock_pong { t0, t1, t2, seq }
  t3 = now (stamped on arrival)
```

```text
rtt    = (t3 - t0) - (t2 - t1)
offset = ((t1 - t0) + (t2 - t3)) / 2      // server minus client
```

The estimator (identical in `homesync-clock` and `web/src/clock.js`):

1. Reject samples with a negative round trip outright.
2. A sample disagreeing with the current estimate by more than 100 ms is a
   *candidate* discontinuity. Three consecutive candidates clear the window and
   force a resync; fewer are discarded. One stalled reply shifts the computed
   offset by half the stall, which is indistinguishable from a clock step until
   the next sample disagrees with it.
3. Keep a rolling window of 60 samples.
4. Reject round-trip outliers using median absolute deviation, with a 0.25 ms
   floor so a quiet network does not reject everything.
5. Take the offset as the median of the lowest-round-trip quarter of the
   accepted window — those carry the least path asymmetry.
6. Uncertainty is the half-spread of that quarter, floored by half the best
   round trip. A symmetric-path assumption can never beat that bound.
7. Drift is the least-squares slope of offset against client time, in ppm.

Quality states: `warming_up`, `stable` (≥ 8 accepted samples and ≤ 5 ms
uncertainty), `degraded`, `resync_required`, `suspended`.

A client publishes `clock_report` on a two-second timer *and* immediately on
any quality transition. The coordinator gates playback on quality, so it must
learn about a change at once rather than up to one interval later.

**Known limit.** A fixed one-way asymmetry is invisible to this method and
biases the offset by exactly half of it. There is a test asserting that
(`asymmetric_paths_bias_the_estimate_by_half_the_asymmetry`). Only an acoustic
measurement can find the remaining error, which is why manual compensation
exists and why checkpoint 4 matters.

## Transport

One message carries the whole playback timeline:

```json
{
  "epoch": 7,
  "state": "playing",
  "mode": "controlled_audio",
  "media_id": "builtin-click",
  "anchor_server_ns": 42000000000,
  "anchor_media_ns": 3000000000
}
```

```text
position(now) = anchor_media_ns + (now - anchor_server_ns)   // playing
position(now) = anchor_media_ns                              // otherwise
```

When playing, `anchor_server_ns` is normally ~2 s in the future
(`--start-lead-ms`). Receivers reschedule only when `epoch` changes, so
duplicate snapshots cost nothing.

A receiver whose anchor has already passed moves its start forward to the
earliest instant it can schedule and skips the same amount into the media, so a
late joiner lands on the room's timeline rather than trailing it.

States: `idle` → `loading` → `ready` → `playing` ⇄ `paused`.

## Source modes

`select_source` carries a `mode`, and the mode decides what the rest of the
protocol means:

| Mode | What plays | Timeline | Readiness barrier |
| --- | --- | --- | --- |
| `controlled_audio` | A file every receiver preloads | `transport` | Yes: hash verified and decoded |
| `youtube` | Each device's own YouTube player | `transport` + `youtube_rendezvous` | No: nothing to preload |
| `system_audio` | Live PCM from the host | Per-frame presentation times | No |

`controlled_audio` is the reference mode and the only one with a guaranteed
timing story. The other two are best-effort by construction; the reasons are
below.

## Binary PCM frames (mode C)

Live audio travels as binary WebSocket messages, coordinator to receiver only.
A client sending a binary frame gets `error: unsupported`.

All integer fields are network byte order. Header is 34 bytes:

| Field | Type | Notes |
| --- | --- | --- |
| Magic | 4 bytes | `HSYN` |
| Version | `u8` | `1` |
| Flags | `u8` | `1` discontinuity, `2` silence, `4` calibration |
| Format | `u8` | `1` s16le, `2` f32le, `3` Opus (not implemented) |
| Channels | `u8` | 1–8 |
| Sample rate | `u32` | 8 000–192 000 |
| Sequence | `u64` | Monotonic |
| Presentation time | `u64` | Coordinator monotonic nanoseconds |
| Frame samples | `u16` | Per channel; 480 at 48 kHz, so 10 ms |
| Payload length | `u32` | Must match the sample count exactly |

A frame flagged `silence` may carry no payload at all: it still occupies its
place on the timeline, but costs one header instead of two kilobytes. Since a
host is silent most of the time, this is most of the traffic.

Every field is validated before the payload is touched. Receivers render
straight into an audio callback, so a malformed frame must be dropped, not
turned into a burst of noise at full volume.

Frames are laid on a timeline derived from one anchor and a sample count, not
from the moment each capture callback happened to fire — otherwise every
receiver inherits the host's callback jitter. When the sound card's clock has
drifted far enough from the coordinator's, the stream re-anchors and marks the
frame as a discontinuity rather than pretending nothing happened.

## YouTube rendezvous (mode B)

The coordinator distributes a video id, a target position and an instant. No
YouTube audio or video passes through it.

Each device is told its own `start_latency_ms` and calls `playVideo()` that far
ahead of the rendezvous instant. The device measures how long the player
actually took to begin — a position that has advanced, not merely a "playing"
state — and reports it; the coordinator folds it into a bounded moving average.
A single pathological observation cannot poison the estimate.

A device whose reported position drifts more than 250 ms from the room timeline
triggers a fresh rendezvous.

Structural limits, which no amount of coordinator work removes:

- **Ads are inserted per viewer.** Two devices can be watching genuinely
  different content.
- The IFrame API offers `seekTo` and `playVideo`, not sample-accurate
  scheduling.
- Independent buffering interrupts one device and not another.
- Some videos prohibit embedding.

## Calibration

Chirps are served from `GET /api/v1/calibration/chirp/{code}` and are **not**
in the media catalogue — they are measurement signals, not something anyone
should be able to select and play to a room.

Recordings are uploaded to `POST /api/v1/calibration/recording` as raw
little-endian `f32` mono samples, with `session`, `target`, `repetition`,
`rate` and `first_sample_server_ns` as query parameters. This goes over HTTP
rather than the control socket so a megabyte of audio cannot delay a clock
exchange queued behind it.

See `docs/calibration.md` for what the measurements mean.

## Messages

| Type | Direction | Purpose |
| --- | --- | --- |
| `hello` | → | Announce client version and persisted device id |
| `welcome` | ← | Assign `client_id`, confirm `device_id` |
| `join_room` | → | Enter a room with code and secret |
| `leave_room` | → | Leave voluntarily |
| `room_snapshot` | ← | Full authoritative room state |
| `client_update` | → | Change own name, role, compensation, volume, mute |
| `clock_ping` / `clock_pong` | → / ← | Four-timestamp exchange |
| `clock_report` | → | Publish own clock estimate for diagnostics |
| `select_source` | → | Choose the media everyone preloads |
| `receiver_ready` | → | Hash verified and decoded |
| `transport` | ← | Authoritative timeline |
| `play` / `pause` / `seek` / `stop` | → | Transport commands |
| `volume` / `mute` | → | Per-device output |
| `diagnostic_report` | → | Periodic telemetry |
| `stream_start` / `stream_stop` | → | Begin or end live system audio |
| `stream_info` | ← | Format and buffering parameters of the live stream |
| `buffer_report` | → | Receiver playout buffer health |
| `youtube_state` | → | This device's player state and measured start latency |
| `youtube_rendezvous` | ← | Converge on a position at an instant |
| `calibration_start` / `calibration_cancel` | → | Run control |
| `calibration_play` | ← | Emit a chirp at an instant |
| `calibration_record` | ← | Record a window |
| `calibration_progress` | ← | Narration during a run |
| `calibration_result` | ← | Measurements and applied compensation |
| `error` | ← | Failure notice; never closes the socket |

Server-originated types sent by a client are rejected with
`error: unexpected_type`.

### Readiness barrier

`play` is refused with `error: not_ready` unless every audio-rendering client
holds a `stable` clock, and — in `controlled_audio` mode only — has verified
the selected media. The error message
names the blocking devices. `play` with `{"force": true}` overrides it, which
is the "best-effort start" of spec section 9.4. A room with no receivers is not
ready — there would be nothing to hear.

`receiver_ready` with `hash_verified: false` is refused. The browser always
verifies: on a plain-HTTP LAN address `crypto.subtle` does not exist, so the
client falls back to a JS SHA-256 implementation rather than skipping the check.

## Authority

The first client to join becomes the owner, and ownership passes on if they
leave. **In this build any room member may issue transport commands**, not only
the owner — see the deviation note in the README.

Secrets travel in the invite URL's fragment, which browsers never send to the
server. Treat every LAN client as untrusted; this is plain HTTP on a home
network, not an authenticated system.

## HTTP

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/` | Browser client |
| `GET` | `/health` | Liveness |
| `GET` | `/api/v1/info` | Version, protocol, implemented modes |
| `GET` | `/api/v1/rooms/{code}` | Room metadata, never the secret |
| `GET` | `/api/v1/media/{id}` | Media bytes, single-range support |
| `GET` | `/api/v1/media/{id}/manifest` | Hash, size, type, duration |
| `GET` | `/api/v1/calibration/chirp/{code}` | Chirp audio for one device |
| `POST` | `/api/v1/calibration/recording` | Raw recorded samples |
| `GET` | `/probe.html` | Device capability probe |
| `GET` | `/ws` | Control socket and binary PCM |

Media ids are content hashes and only resolve to files already in the
catalogue, so no request can name an arbitrary path on disk.
