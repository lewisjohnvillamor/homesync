# HomeSync control protocol v1

Implemented by `crates/homesync-protocol` (Rust) and `web/src/net.js` (browser).
Every message is one JSON text frame on the `/ws` WebSocket. Binary frames are
reserved for live PCM streaming and are rejected by this build.

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
| `error` | ← | Failure notice; never closes the socket |

Server-originated types sent by a client are rejected with
`error: unexpected_type`.

### Readiness barrier

`play` is refused with `error: not_ready` unless every audio-rendering client
has verified the selected media *and* holds a `stable` clock. The error message
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
| `GET` | `/ws` | Control socket |

Media ids are content hashes and only resolve to files already in the
catalogue, so no request can name an arbitrary path on disk.
