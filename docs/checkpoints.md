# Checkpoint procedures

The point of these is to find out whether the synchronisation idea works before
building anything on top of it. Run them in order. If checkpoint 2 fails, no
amount of YouTube or Windows-capture work will help.

Record results in `docs/compatibility.md` as you go, including the failures — a
device that could not hold alignment is the most useful thing this project can
learn.

When something looks wrong, press **Download diagnostics** in the log panel
before changing anything. It saves every device's clock, telemetry, buffer
health and the last calibration, which is far more useful than a description of
what you heard.

---

## Checkpoint 1 — clock agreement

*Two clients maintain an estimated server-clock difference below roughly 2–5 ms
for 30 minutes.*

### Automated (proves the maths)

```sh
cargo run --release -- --simulate 3 --simulate-seconds 1800 --simulate-then-exit
```

Passes when every client reports `stable` and the worst pairwise offset
disagreement is under 5 ms. Exits non-zero on failure, so it can gate CI.

These clients share one machine's clock and the loopback interface. A pass
proves the exchange and the estimator are correct. It proves nothing about
Wi-Fi or browsers.

### Real (proves the deployment)

1. Start the coordinator on the machine you intend to use as the host,
   preferably wired.
2. Open the invite link on two devices. Join as **Controller only** if you just
   want the clock, so no audio is required.
3. Leave both pages in the foreground for 30 minutes.
4. Watch the diagnostics table: `Clock` should reach `stable` within a few
   seconds and stay there; `±` (offset uncertainty) should sit in the low
   milliseconds; `Drift ppm` should settle to a small constant per device.

Expect to see: uncertainty roughly tracking half the round trip; a phone on
Wi-Fi noticeably worse than a wired laptop; drift of a few tens of ppm between
independent devices, which is normal crystal tolerance.

Fails if quality oscillates between `stable` and `degraded`, or if
`resync_required` appears without the device having slept.

---

## Checkpoint 2 — scheduled playback

*Two laptops play the same preloaded click track without obvious echo.*

1. Put both laptops in the same room, roughly equidistant from where you will
   stand, at similar volume.
2. Join both as **Speaker**. Wait for both to show `Ready`.
3. Select **Click track (built-in, 60 s)** and press **Play**.
4. Listen. The click track is deliberately transient-heavy: a few milliseconds
   of misalignment is audible as a flam, where the same error on sustained
   music would not be.

Pass: one click, not two. A slight widening of the sound is acceptable; a
distinct double-tap is not.

If you hear a flam, this is what checkpoint 3 is for — do not conclude the
system is broken until you have tried compensating.

Record: both devices' `Timeline drift`, `Reported output latency`, and which
`Latency source` each used (`getOutputTimestamp()` or reported latency). A
device on the reported-latency path is the more likely offender.

---

## Checkpoint 3 — mixed devices

*A Windows laptop and an Android phone stay within roughly 10–20 ms after
manual compensation.*

1. Join both. Start the click track.
2. On whichever device sounds *late*, raise **Manual compensation** until the
   flam collapses. Positive values start that device earlier.
3. Adjust in 5 ms steps first, then 1 ms. The value persists per device.

Pass: with compensation applied, no audible flam, and it stays that way for at
least ten minutes without further adjustment.

The number you land on is worth writing down. It is that device's real output
latency minus whatever the browser reported — the gap that only a microphone
can measure, and the reason checkpoint 4 exists.

Watch for: a Bluetooth speaker or headset changing latency when it re-connects,
which invalidates the saved value. A device that needs a *different* value on
each run has unstable output latency and is a poor receiver.

---

## Checkpoint 4 — automatic calibration

*A microphone detects the actual delay and HomeSync aligns the devices.*

Implemented; never run against a real microphone. Do not start it until
checkpoints 2 and 3 have passed — if the schedule cannot be held, measuring it
more precisely will not help.

**Start the coordinator with `--tls`.** Microphone access needs a secure
context, and `http://192.168.x.x` is not one. HomeSync generates its own
certificate; each device shows a warning the first time, which you accept once.
Without this, no device can be the calibration microphone and this checkpoint
cannot start. The calibration panel shows which devices reported a usable
microphone.

1. Get two devices audibly misaligned — undo any manual compensation.
2. Choose a microphone device and put it where you will actually listen.
3. Quiet the room. Press **Calibrate**. Each device chirps five times.
4. Read the results table.

Pass: the flam disappears without anyone touching a slider, and re-running
produces roughly the same numbers.

Read the table honestly:

- **Spread** above 5 ms means that device's latency wanders; no fixed
  compensation will hold it, and it is excluded from setting the room's target.
- **Reflective room** means an earlier, quieter arrival was preferred over a
  louder later one. Expected in a hard-surfaced room; worth knowing.
- Absolute delays include the microphone's own input latency and are inflated
  by it. The *differences* are the real result. See `docs/calibration.md`.

If nothing is measured at all: check the microphone permission, raise the
volume, move the microphone closer, and confirm the devices are actually
audible where it is sitting.

---

## Checkpoint 5 — YouTube Together

*Three independent players stay acceptably synchronised for 30 minutes,
including pause, seek and a buffering event.*

Implemented. Verified only in headless browsers, which proves the rendezvous
messages flow — not that anything sounded right.

1. Switch the source to **YouTube** and load a video.
2. Press Play. Each device seeks to the target and starts early by its own
   learned latency; the first attempt is the worst, since the estimate has not
   been measured yet.
3. Watch the diagnostics. Let it run, then pause, seek, and let one device
   buffer (throttle its network) to see it re-converge.

Pass: under 100 ms apart on the watch-party target, recovering automatically
after buffering.

**"Video unavailable — Watch on YouTube" is not a HomeSync failure.** The
video's owner has disallowed playback outside youtube.com (IFrame error 101 or
150), and the refusal happens inside YouTube's own player. Most major-label
music videos are published that way. Nothing in this project can change it —
pick a different video. HomeSync now says so explicitly instead of showing a
raw error code.

Videos that reliably embed: official channels that want to be shared,
conference talks, Creative Commons material, and most independent uploads. If
you want a known-good one for testing, `aqz-KE-bpKQ` (Big Buck Bunny) is what
the automated end-to-end run uses.

Expect ads to break it outright on some accounts — they are inserted per
viewer, so two devices are watching different content and no scheduling fixes
that. Record it as an observation, not a bug.

---

## Checkpoint 6 — LG webOS

*At least one real LG TV maintains stable output latency.*

1. Open `http://<coordinator>:8080/probe.html` in the TV browser, or install
   the receiver app (`webos/receiver-app`) and use **Check this TV first**.
2. Record the results in `docs/compatibility.md` — including the failures.
3. If the probe looks usable, join the TV as a receiver and run checkpoints 2
   and 3 with it.

The decisive question is not how *large* the TV's latency is. Latency that is
large but stable is compensable, by calibration or by hand. Latency that varies
during playback cannot be compensated by any fixed value, and a TV that behaves
that way should be recorded as unsupported rather than worked around.

---

## Live system audio

*Four receivers play host audio for 30 minutes without underruns in Music
profile.*

The synthetic source makes this runnable anywhere, and is the right place to
start because it removes capture from the equation:

**The interface no longer offers this mode.** The coordinator and the receivers
still implement it, and `crates/homesync-server/tests/live_stream.rs` still
covers the whole path — capture, framing, binary distribution, worklet
buffering — against the synthetic source. What was removed is the button, on
the grounds that the Windows capture path has never been run against real
hardware and an unverified mode does not belong beside two that work.

Restoring it is a matter of putting the controls back: send `stream_start` with
a profile and the `synthetic` flag, and `stream_stop` to end it.

Remember that video on the host will lead the room by the whole buffer depth.
This mode is for music.

---

## Interpreting the numbers

The UI keeps three things separate on purpose:

- **Clock** — network agreement with the coordinator. Small here means the
  timeline is shared.
- **Timeline drift** — how far a receiver's playing position is from where the
  coordinator says it should be. Small here means the schedule is being held.
- **Physical alignment** — what a microphone would measure. **Nothing in this
  build reports it.** Manual compensation exists precisely because software
  cannot see it, which is why the reported drift deliberately excludes the
  manual value: otherwise moving a slider would make a device look aligned
  merely because someone moved a slider.
