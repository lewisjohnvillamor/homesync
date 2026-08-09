# Checkpoint procedures

The point of these is to find out whether the synchronisation idea works before
building anything on top of it. Run them in order. If checkpoint 2 fails, no
amount of YouTube or Windows-capture work will help.

Record results in `docs/results.md` as you go, including the failures — a
device that could not hold alignment is the most useful thing this project can
learn.

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

Not implemented. Requires chirps, microphone capture, cross-correlation and a
secure context for `getUserMedia`. Do not start it until checkpoints 2 and 3
have passed on real hardware — if the schedule cannot be held, measuring it
more precisely will not help.

---

## Checkpoints 5 and 6 — YouTube and LG webOS

Not implemented. Both depend on the controlled-audio path being trustworthy
first, and both carry device-specific risk that no amount of coordinator work
removes:

- YouTube: ads and buffering diverge per device, and the IFrame API offers no
  sample-accurate scheduling.
- webOS: documented Web Audio latency that may not be stable during playback.
  Stable latency can be compensated; varying latency cannot.

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
