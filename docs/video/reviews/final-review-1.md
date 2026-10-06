# Final review: HomeSync film, whole piece, both formats

Files judged: `work/final/homesync-16x9.mp4` (1920×1080, 60 fps, 1800 frames, 30.000 s), `work/final/homesync-9x16.mp4` (1080×1920, same timing), `work/final/homesync-music-only.m4a`. All sheets, cuts and scripts are in `work/critic-final/`.

## Ranked problems (most harmful first)

**1. 17.68–17.82 s, the hand-over from composition 8 to 9 (diagram to house) is the one place where picture, beat and sound disagree. It is also the way into the film's main shot.** (Rules: "cut every scene change on a beat", "one whoosh per real scene change", motion rule 1.)
- The whoosh starts at 17.40 s, peaks at **17.51 s** (on beat 17.5) and is gone by 17.65 s.
- The picture does not move until **17.68 s**. The lane plane then disappears and the house fades in, fully there by 17.82 s. The visual change lands at about **17.75 s, half a beat off the grid**: 0.25 s after the beat and the whoosh, and 0.375 s before the storyboard's 18.125 s.
- The "lift towards the camera, house waiting underneath" lasts about 6 frames. In real time it reads as a soft cut more than a lift. The dot is carried at the same pixels, so it isn't a broken cut, but it is the hastiest transition in the film, and it leads into the signature shot.
- This is the only hand-over where the whoosh and the picture don't line up. Every other one is within 0.15 s.
- **Fix:** start the lane lift at about 17.30 s and run it for about 0.35 s, so the plane clears and the house is fully revealed on **17.50 s**, under the whoosh peak that is already there. That keeps comp 8 at 3 beats and comp 9 at 7. Also fade the "EXAMPLE VALUES" tag with the lanes (see 6). The audio needs no change.

**2. 18.7–21.6 s, the house bars are the least legible of the three signature moments.** (Rule: "a first-time viewer understands it with the sound off"; storyboard signature moment 3.)
- With the sound off, comp 9 reads as three blue cylinders hanging from a glass sheet marked T. The phone's bar sits about a room-height above the phone, joined only by a thin dashed leader. The laptop's bar is a stub.
- The idea "each device starts earlier by its own delay, all reaching one instant" was already said clearly in comp 8. Here it is restated less clearly.
- The shot is still the most premium-looking in the film: architectural model, plinth, wood floor, key light from the left. The headline "Play the same music, in time, on every device in your house." carries the meaning anyway. The harm is that the signature moment lands as decoration rather than as a payoff.
- **Fix (optional, cheap):** make the leaders solid accent lines at about 40 % opacity rather than dashed, and widen the device rings so each bar visibly belongs to its device.

**3. 10–30 s, the music's energy is flat after the lift.** (Rule: "match the music's energy to the picture".)
- Per-bar RMS of the music-only file: −18.7, −17.9, −17.2 dB over the problem section (0–7.5 s). Then −14.6, −13.5, −13.7, −14.9, −14.3, −13.8, −14.9, −14.3 and −15.3 dB.
- The lift at 7.5 s under the HomeSync reveal is right. But the house (18–22 s), which is meant to be the peak, gets no more energy than the diagram (10–15 s). The end card settles only through the fade in the last 0.5 s (−24.8 dB, then −49.6 dB in the final 50 ms).
- Not wrong, and the cue is clean and unobtrusive. A premium edit would usually let the peak breathe.
- **Fix (optional):** about +1.5 dB of music from 18.125 to 21.875 s, and about −2 dB easing from 26.875 s under the end card.

**4. 9.00–9.30 s, a whip push in comp 5.**
- The camera jumps from the laptop-and-QR framing to the close-up in about 0.25 s, just before the tap at 9.375 s. It is the single largest frame-to-frame change in the 16:9 film (mean 30 levels per frame at 9.133 s, against ≤ 25 at every real scene change).
- It is continuous (the QR and phone stay matched), but at full speed it reads close to a jump cut inside one composition.
- **Fix:** start the push at about 8.90 s and spread it over about 0.45 s, easing into 9.35 s.

**5. 9:16, 0.00–0.60 s: an unexplained line in frame one.**
- A faint diagonal accent line, the pre-drawn "pressed" line, sits in the empty left third before anything has happened. The devices sit in the right half.
- Frame one is still a finished picture, but the line is unexplained until 0.6 s.
- **Fix:** fade the line in with the press at 0.625 s, as the 16:9 cut does.

**6. 17.72–17.80 s: a stray tag over the house.** The small "EXAMPLE VALUES" tag from comp 8 drifts across the incoming house for about 5 frames after its lanes have gone. Fade it with the lanes; this is covered if fix 1 is done.

**7. Trivial: whooshes on the two camera moves are inconsistent.** The camera rush at 13.125 s gets a whoosh; the pull-back and tilt at 15.625 s (comp 7→8) gets none. Either choice is defensible. No action needed.

**8. Trivial: 8.125 s hand-over is slightly early.**
- The QR screen is visible from about 7.95 s, 150–175 ms ahead of the beat.
- The whoosh (peak 8.141 s) and the phone's entrance (8.2 s) land on the beat, so it reads on time.

Nothing else was found:
- No text collision or text flying through other text. Every word slide in comp 10 was checked frame by frame in both formats.
- No flicker. No frozen stretch.
- No unlabelled example values. No claim outside facts.md.

## Sound off: what a first-time viewer understands

> If you press play on a laptop, a phone and a TV at once, you still get an echo, because each one starts at its own moment and nothing tells them when "now" is. HomeSync fixes that. A phone joins by scanning a code from the laptop. Every device is told one shared instant and starts early by its own delay, so the sound is scheduled to be heard at that instant, across the whole house. It runs on your own LAN and machine (`cargo run --release`), is free and MIT-licensed, and you try it on two devices from GitHub.

That matches facts.md: F2, F3b, F4, F5, F6, F8 (as example), F11, F12, F19–F21, F23–F25, F28, F29. No step is unclear without sound. The weakest link is the house bars (problem 2), but the headline over them carries the meaning.

## Cuts on beats (96 BPM, beat = 0.625 s)

Each hand-over was measured from the frame-difference spikes and the dense sheets (20–30 fps sampling).

| Hand-over | Beat | Picture changes | Whoosh peak | Verdict |
| --- | --- | --- | --- | --- |
| 1→2 (camera rise, caption swap) | 1.875 | caption 1.75–1.80 | none (not a scene change) | OK |
| 2→3 markers lift → type | 3.750 | 3.70–3.80 | 3.746 | on beat |
| 3→4 type rushes → dot → mark | 6.250 | dot alone 6.20–6.30 | 6.276 | on beat |
| 4→5 mark breaks → QR/phone | 8.125 | 7.95–8.20 | 8.141 | on beat (picture ~150 ms early) |
| 5→6 phone → lane icon | 10.625 | 10.575–10.70 | 10.645 | on beat |
| 6→7 rush in on phone lane | 13.125 | 12.95–13.05 | 13.123 | on beat |
| 7→8 pull back and tilt | 15.625 | 15.45–15.65 | none | on beat |
| **8→9 lanes → house** | 17.5 / 18.125 | **17.68–17.82** | **17.512** | **off beat; picture 0.25 s after the whoosh** |
| 9→10 dot rises → "Your LAN." | 21.875 | 21.70–21.90 | 21.878 | on beat |
| 10→11 words clear → terminal | 24.375 | 24.30–24.40 | 24.397 | on beat |
| 11→12 terminal collapses → mark | 26.875 | 26.80–26.90 | 26.881 | on beat |

The word entries inside comp 10 also land on beats: 22.5 and 23.125.

## Sound

The effects track was isolated by subtracting the music-only file from `homesync-16x9-mix.wav`. They line up at zero lag, and the residual from the m4a encoding sits at about −45 dB or lower.

- **Whooshes:** nine, at 3.75, 6.28, 8.14, 10.65, 13.12, 17.51, 21.88, 24.40 and 26.88 s. Each lasts about 0.25 s. Spectral centroid is about 4.0–4.5 kHz, above the music's centroid of about 2.1–2.8 kHz at the same moments, so each sits in its own band (`spectrum_fx.png`, `spectrum_music.png`). Peak level is 5–8 dB **below** the music in the same 50 ms window. One per real scene change, except that comp 7→8 has none (problem 7).
- **Clicks and pops, on real actions only:**
  - 0.6 s: the three play buttons sink.
  - 8.75 s: the join button appears after the scan.
  - 9.35 s: the dot taps "Enable audio & join".
  - 10.0 s: "this device" appears.
  - 20.3–20.7 s: the dot pulses once. This is a soft three-partial chime at about 1.75, 2.6 and 3.5 kHz, 13 dB under the music.
  - 25.0 s: Enter.

  None is louder than the music; the loudest is 9.6 dB under it.
- **Loudness:**

  | File | Integrated | LRA | True peak |
  | --- | --- | --- | --- |
  | 16:9 film | −16.0 LUFS | 2.8 LU | −3.3 dBTP |
  | 9:16 film | −16.0 LUFS | 2.8 LU | −3.3 dBTP |
  | Music only | −16.0 LUFS | 2.8 LU | −3.2 dBTP |

  Steady, comfortable for web, no clipping. The effects add nothing measurable to the integrated loudness, so they sit under the music. The waveform (`waves.png`) shows a steady bed with small isolated effect blips.
- **Energy:** rises at 7.5 s with the product reveal, then stays flat to the end (problem 3).

## The whole

- **One continuous piece:** yes. One dot carries the story without a break:
  - 3.4–3.8 s: the three "now" markers merge into the full stop.
  - It becomes the centre of the mark, then the tapping finger and the instant T.
  - It drops into the house, becomes the full stop of "Your machine." and the terminal cursor.
  - It ends as the centre of the mark again.

  The phone also carries from comp 5 into the lane diagram. This is the film's strongest quality.
- **Scale varies:** close (the phone and QR, the single lane), wide (the 3D floor, the three-lane plan), tilted overhead (the lanes, the house) and full-frame type (comps 3, 4 and 10, the end card). No layout repeats.
- **Three signature moments:**
  1. The three "nows" merge into the full stop, and the full stop becomes the logo. This lands well.
  2. The lag bars return as the cure. This lands clearly (13.6–17.5 s).
  3. The house. Beautiful, but the least legible (problem 2).
- **Next to premium product films:** the craft is there in almost every frame:
  - Restrained palette.
  - Background measured at (9, 13, 19) against the brand ground (11, 14, 19).
  - Crisp Inter and JetBrains Mono type, all at ≥ 6.8:1 contrast.
  - Lit 3D with a model-like house.
  - Honest labelling.

  The one moment that would look weaker beside a reference film is the rushed, off-sync reveal into the house (problem 1).
- **What I would change first:** problem 1. Then, optionally, 2 and 3.

## Honesty

Every on-screen string traces to facts.md:

| On screen | Fact |
| --- | --- |
| "Press play on all three." / "…and you still get an echo." | F3b |
| "Nothing tells them when "now" is." | F4 |
| HomeSync | F1 |
| QR code, "Enable audio & join" | F11, F25 |
| "this device" | F29 |
| "Every device is told one instant…" / "…and works out how early to start." | F6 |
| 40 / 90 / 210 ms | F8, always with "EXAMPLE VALUES" or "EXAMPLE" (13.4 s, 15.6–17.7 s, 20.2–21.4 s) |
| "Scheduled to be heard at one agreed instant." | F5 |
| "Play the same music, in time, on every device in your house." | F2 |
| "Your LAN. Your files. Your machine." | F12 |
| `cargo run --release` | F19 |
| "a few minutes later" | F28 |
| "Open on the LAN : http://192.168.1.50:8080" | F21, tagged EXAMPLE. In 9:16 it is reflowed onto two lines, which is still the README's string. |
| "Try it on two devices." | F25 |
| github.com/lewisjohnvillamor/homesync | F24 |
| "Free and open source · MIT licence" | F23 |

- The remaining labels ("pressed", "starts", "laptop", "phone", "TV", "T") are diagram labels, not claims.
- There is no claim about how it sounds; nothing turns green. There are no testimonials, ratings, prices or results.
- Nothing generated.

## Measurements

- **Frozen time, windowed `--window 0.25` (the measured bar):**
  - 16:9: 0.117 s per 30 s; longest still 0.117 s (24.65–24.75 s).
  - 9:16: 0.05 s per 30 s; longest still 0.05 s.
  - No stretch over 0.3 s. **Pass.**
- **Frozen time, plain frame-to-frame (for reference):** 17.65 s (16:9) and 16.8 s (9:16), longest 2.2 s at 24.42–26.6 s (the terminal). These are slow pushes below the per-frame threshold; the windowed test confirms they move.
- **Flicker:** 0 frames in 16:9, 0 in 9:16. **Pass.**
- **Contrast** (from the critic kit):

  | Text | Ratio |
  | --- | --- |
  | "pressed" | 6.83:1 |
  | "starts" | 7.30:1 |
  | "EXAMPLE VALUES" | 7.48:1 |
  | lane label "laptop · 40 ms" | 12.8:1 |
  | house labels | 7.4–7.45:1 |
  | "a few minutes later" | 7.47:1 |
  | "Open on the LAN" | 7.01:1 |
  | terminal "EXAMPLE" | 7.13:1 |
  | "Free and open source · MIT licence" | 7.48:1 |

  All **pass** 4.5:1.
- **Brand ground:** measured background (9, 13, 19) against `#0b0e13` (11, 14, 19), in both the 3D shots and the flat shots.
- **Loudness:** see the Sound section. Integrated −16.0 LUFS, LRA 2.8 LU, true peak −3.3 dBTP. Music only: −16.0 LUFS, −3.2 dBTP.
- **Files:**
  - Contact sheets: `work/critic-final/sheet169_{0,6,12,18,24}.png` and `sheet916_*.png`.
  - Dense sheets: `dense169_*.png`, `dense916_22.5.png` and `dense916_23.2.png`.
  - Frames: `full169_*.png`, `full916_*.png` and `jump_9133.png`.
  - Audio: `fx.wav` (the isolated effects), `waves.png`, `spectrum_fx.png` and `spectrum_music.png`.
  - Scripts: `diffs.py` and `fx.py`.

**one more pass.** Only problem 1 is required: retime the lane lift so the house is revealed on 17.5 s under the existing whoosh. Problems 2–8 are optional polish. With 1 fixed, this ships.
