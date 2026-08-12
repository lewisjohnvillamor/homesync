# Device compatibility

This file records what has actually been observed on real devices. It is the
project's honesty ledger: a device is listed here only after someone ran it,
and "untested" is a legitimate and common entry.

Run `http://<coordinator>:8080/probe.html` on a device to fill in a row.

## What each column means

- **Clock rate** — how fast `AudioContext.currentTime` runs against real time.
  Anything other than ~1.000000 means the device cannot hold a schedule at all.
- **Output latency** — what the browser *reports*. Often wrong; it is a
  starting point, not an answer.
- **Measured latency** — what acoustic calibration measured. This is the real
  number.
- **Stability** — whether repeated calibrations agree. A device with unstable
  latency cannot be compensated by any fixed value, however good the software.

## Formats, measured

Real encoded files — downloaded, not synthesised — selected in the interface and
played, on Chromium 141 (the Playwright build, which is **open-source**
Chromium).

| Format | File | Decoded | Played |
| --- | --- | --- | --- |
| MP3 | `sample-6s.mp3`, ID3v2.4 | yes | yes |
| WAV | `sample-6s.wav`, RIFF | yes | yes |
| FLAC | `sample3.flac` | yes | yes |
| Ogg Vorbis | `Example.ogg` | yes | yes |
| Opus | `sample3.opus`, Ogg container | yes | yes |
| **AAC / M4A** | `sample3.m4a`, `ftypM4A` | **no** | — |

**The AAC result is a property of that browser, not of HomeSync.** Open-source
Chromium ships without the AAC decoder; `canPlayType('audio/mp4;
codecs="mp4a.40.2"')` returns `""` on this build and `"probably"` on Google
Chrome, Edge and Safari, which license it. So `.m4a` files are expected to work
on the browsers most people actually use, and to fail on a distro-built
Chromium — and that is worth knowing before blaming the file.

HomeSync names the file when this happens rather than leaving the room waiting.
A control file — an HTML error page a CDN had served with a `.ogg` extension —
was refused the same way, by name.

Untested here: AAC on a browser that licenses it. That needs Chrome, Edge or
Safari, none of which are on this machine.

## Results

| Device | Browser | Clock rate | Output latency | Measured latency | Stability | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| _(none recorded yet)_ | | | | | | |

## Expected results, to be confirmed

These are predictions from documentation and general behaviour, not
measurements. They are written down so they can be proved wrong.

| Device class | Expectation | Reasoning |
| --- | --- | --- |
| Windows/macOS + Chrome or Edge | Works well; `getOutputTimestamp()` usable, so output latency compensates itself | Full Web Audio implementation |
| Android + Chrome | Works; output latency higher and more variable than desktop | Audio path varies by vendor |
| iPhone/iPad + Safari | Works after an explicit tap; `getOutputTimestamp()` may be absent, so compensation falls back to reported latency | Strict autoplay policy |
| Any device on Bluetooth output | Large latency; **profile invalidated whenever the output route changes** | Bluetooth adds 100–300 ms and it is not constant across reconnections |
| LG webOS, recent | Plausible as a receiver; latency likely high but possibly stable | LG documents high Web Audio latency |
| LG webOS, older | Uncertain; may need the HTML audio fallback path | Older Chromium, less complete Web Audio |

## Known-unsupported

| Scenario | Why |
| --- | --- |
| Capturing Netflix, YouTube or Spotify audio from an LG TV | webOS does not give one app another app's decoded audio (spec 4.1) |
| Lip-sync with video owned by another application | HomeSync cannot delay video it does not control |
| Live system audio on Linux or macOS hosts | Only WASAPI loopback is implemented; use the synthetic source to test the path |
