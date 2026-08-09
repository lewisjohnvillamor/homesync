# Acoustic calibration

Every other measurement in HomeSync is software reporting on itself: clock
offsets, scheduled instants, latencies the browser claims. Calibration is the
one number that comes from the room — when sound actually arrived where you
are sitting.

## How it works

1. You choose one device as the microphone. Put it where you will listen from.
2. The coordinator measures each other device in turn. For each repetition it
   tells the microphone to record a window, and tells the target to emit its
   assigned chirp at a coordinator instant a second and a half away.
3. The target schedules the chirp through **exactly the same path as ordinary
   playback** — same clock mapping, same compensation. Measuring any other path
   would measure something nothing else uses.
4. The microphone records, and reports in coordinator time when its *first
   recorded sample* entered the microphone. It uploads raw samples over HTTP,
   not the control socket, so a megabyte of audio cannot delay a clock exchange
   queued behind it.
5. The coordinator match-filters the recording against the chirp, takes the
   first substantial arrival, and repeats.
6. Repetitions are aggregated with outlier rejection; the result is a median
   delay and a spread.
7. Compensation is solved so every device is heard at the same instant, and
   applied as each device's *acoustic offset*.

## The chirp

A 200 ms exponential sweep, roughly 600 Hz to 6 kHz, with a 5 ms raised-cosine
fade at each end.

- **Exponential**, not linear: equal time per octave, which matches both how
  room noise is distributed and how small speakers behave, while still
  auto-correlating to a sharp peak.
- **Faded**, because an abrupt start is a click, and clicks correlate against
  everything.
- **Coded per device**: alternate codes sweep in opposite directions and
  successive codes sit in slightly different bands. Devices are measured one at
  a time, but coding means a reflected or mistimed chirp from one device cannot
  be mistaken for another's arrival.

## First arrival, not loudest arrival

In a reflective room a wall can return more energy to the microphone than the
direct path. Taking the strongest correlation peak would report the
reflection's delay — which is longer, so the device would be compensated as if
it were slower than it is.

The direct path is always the *first* substantial arrival. HomeSync takes the
earliest peak above 40 % of the maximum, provided it is separated from the
maximum by more than 2 ms. The separation matters: without it the search finds
the rising flank of the same peak a few samples early, and every clean
measurement comes back biased. Two milliseconds is also roughly the point below
which two paths are physically indistinguishable — it is 70 cm of extra path.

When an earlier arrival is chosen, the result is flagged as a reflective room,
because that is worth knowing.

## What the numbers mean

- **Measured delay** — arrival relative to the instant the device was scheduled
  to be heard. Includes the microphone's own input latency.
- **Spread** — how much repetitions disagreed. Above 5 ms the device's latency
  is called unstable.
- **Intrinsic latency** — what the device would exhibit with no compensation.
- **Applied** — the compensation the coordinator set.

### The microphone's latency cancels

Every absolute number is inflated by the recording device's own input latency,
which HomeSync cannot measure. It does not matter, because alignment uses only
the *differences* between devices, and that constant appears in all of them.

Read the absolute figures as "relative to this microphone", not as ground
truth. The differences are real.

## Unstable devices do not set the target

Alignment can only ever hold everyone to the slowest device — no scheduling
makes a speaker emit sound before its hardware does — so faster devices are
delayed and most solved compensations are negative.

A device whose repetitions disagree is excluded from choosing that target.
Delaying an entire room by 300 ms to match a number that will not hold is worse
than leaving one device slightly out. It still receives its own best-effort
compensation, and it is flagged.

## Calibration does not overwrite your slider

Manual and acoustic compensation are tracked separately and added. A
calibration run sets the acoustic part and leaves whatever you set by ear
intact.

The reported timeline drift deliberately *excludes* both. They exist precisely
because software could not derive them, so counting them would show a device as
perfectly aligned merely because someone moved a slider.

## Requirements and limits

- **Microphone access needs a secure context.** On a plain-HTTP LAN address
  `getUserMedia` is usually unavailable. Serve over HTTPS, or use `localhost`,
  or accept that only some devices can be the microphone.
- **Calibration measures one listening position.** Move the microphone and the
  distance compensation changes with it.
- **Bluetooth output invalidates a profile.** Latency changes across
  reconnections; re-calibrate after switching output.
- **A quiet room helps.** The estimator rejects measurements it cannot trust
  rather than guessing, so a noisy room produces fewer usable repetitions, not
  wrong answers.

## Status

The DSP is thoroughly tested against synthetic signals: known delays, heavy
noise, reflections stronger than the direct path, DC offsets, differing
microphone sample rates, and a full two-device pipeline. **It has never been
run against a real microphone in a real room.** Checkpoint 4 in
`docs/checkpoints.md` is how you find out whether it works.
