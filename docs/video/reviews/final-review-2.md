# Final review (second pass): HomeSync film, whole piece, both formats

Files judged: `work/final/homesync-16x9.mp4` (1920×1080, 60 fps, 30.000 s), `work/final/homesync-9x16.mp4` (1080×1920, same timing), `work/final/homesync-music-only.m4a`. All sheets, frames, cuts and scripts are in `work/critic-final2/`.

## Status of the previous review's findings (`work/final-review-r29.md`)

| # | Finding | Status | What I see |
| --- | --- | --- | --- |
| 1 | The diagram-to-house hand-over lands at about 17.75 s, off the beat and after its whoosh (**required**) | **fixed** | The lane plane now starts lifting at 17.28 s, moves fastest at 17.43–17.48 s and has cleared by 17.60 s. The house is fully lit by 17.63 s. The frame-difference peak is at **17.45 s (−50 ms from beat 17.5)** in 16:9 and 17.53 s (+33 ms) in 9:16. The whoosh runs 17.33–17.68 s with its peak at **17.51 s**, so picture and sound now share the beat. In 9:16 the TV and its lane visibly come towards the camera as they go, so it reads as a lift, not a dissolve. The dot holds the same pixels across the hand-over. |
| 2 | The house bars are the least legible signature moment | **still there** | The frame at 20.9 s is identical to the last version: the leaders are still dashed, the phone's bar still hangs about a room-height above the phone, and the laptop's bar is still a stub. |
| 3 | The music's energy is flat after 7.5 s | **still there** | Per-bar music RMS is unchanged: −18.7, −17.9, −17.2, then −14.6, −13.5, −13.7, −14.9, −14.3, −13.8, −14.9, −14.3 and −15.3 dB. |
| 4 | A whip push at 9.00–9.30 s | **still there** | It is the same move. The largest frame-to-frame change in the film is 30.0 levels at 9.133 s, eased in and out over 9.0–9.27 s. |
| 5 | In 9:16, an unexplained diagonal line in frame one | **still there** | A faint accent line with three ticks sits in the left third from 0.0 s and brightens at 0.6 s. The 16:9 frame one is clean. |
| 6 | The "EXAMPLE VALUES" tag drifts over the house | **fixed** | The tag now rides out with the lane plane. It scales up and leaves frame left by 17.60 s, over empty ground, and never crosses the house in either format. |
| 7 | No whoosh on the 15.625 s camera move | **still there** | Unchanged. It is defensible, because that move is a camera move, not a new composition. |
| 8 | The QR screen appears about 150 ms before the 8.125 s beat | **still there** | The QR shows from 7.96 s. The whoosh peak (8.137 s) and the phone's entrance (8.2 s) are on the beat, so it still reads as on time. |

## Ranked problems (most harmful first)

None of these would make a first-time viewer or a premium-film critic think noticeably less of the film. All of them are optional.

**1. 18.7–21.6 s, the house bars are the weakest payoff of the three signature moments.** (Storyboard signature moment 3; "understood with the sound off".)
- The shot is still the most premium-looking in the film.
- The headline "Play the same music, in time, on every device in your house." carries the meaning.
- The labels now name each device ("TV · 210 ms EXAMPLE"), and rings mark the devices.
- The problem is that the phone's bar floats high above its device on a thin dashed leader, so the idea "each one starts early by its own amount" reads more clearly in comp 8 than here.
- **Fix (optional):** make the leaders solid accent lines at about 40 % opacity, or bring the plane down so the phone's bar is visibly attached to the phone.

**2. 9:16, 0.00–0.60 s: a faint diagonal "pressed" line in frame one before anything has happened.** It is low-contrast, and frame one is still a finished picture. A careful viewer would see an unexplained mark for 0.6 s.
- **Fix (optional):** fade the line in with the press at 0.625 s, as the 16:9 cut does.

**3. 9.00–9.27 s, a fast push in comp 5.** It is eased and continuous: the QR and the phone stay matched, and the dot reappears before the tap at 9.375 s. At full speed it reads as a deliberate snap-zoom, not an error.
- **Fix (optional):** start it at about 8.90 s and spread it over about 0.45 s.

**4. 10–30 s, the music's energy is flat.** The house section (17.5–21.9 s) gets no lift over the diagram. The waveform shows a slight section change around 16.5 s but no real build. The end card settles only in the final 0.5 s fade.
- **Fix (optional):** about +1.5 dB of music over 17.5–21.875 s.

**5. Trivial: the house rests for 0.35 s before the headline arrives.** From 17.68 to 18.00 s the house sits with only its slow push and no text arrives (plain frame difference 0.1). The windowed test still measures motion, and it gives the reveal room to land. I note it only as something to leave alone.

**6. Trivial: the comp 8 storyboard timing is now out of date.** The storyboard says the lift starts at 17.85 s and comp 9 starts at 18.125 s. The film now hands over on 17.5 s (comp 8 is 3 beats, comp 9 is 7). That is still on the grid and within the 1.4–3.5 s length rule for comp 8. Comp 9 is now about 4.4 s, which is over the "about 3.5 s" guide, but it is the peak shot and holds attention. Update the storyboard table if it is kept as a record.

No new defects were found:
- No text collision or text flying through other text. I checked "Your LAN / files / machine" in both formats, the house labels, the terminal and the end card.
- No flicker. No frozen stretch.
- No unlabelled example values.

## Sound off: what a first-time viewer understands

> Press play on a laptop, a phone and a TV at the same moment and each one still starts at its own time, so you get an echo; nothing tells them when "now" is. HomeSync fixes that: a phone joins by scanning a code shown on the laptop, every device is told one shared instant and starts early by its own (example) delay so the sound is scheduled to be heard at that instant, across every device in the house. It runs on your own LAN and your own machine with `cargo run --release`, it's free and MIT-licensed, and you try it on two devices from the GitHub link.

That matches facts.md: F1, F2, F3b, F4, F5, F6, F8 (as example), F11, F12, F19, F21, F23–F25, F28 and F29. No step is unclear without sound. The weakest link is the house bars (problem 1), and the headline carries it.

## Cuts on beats (96 BPM, beat = 0.625 s)

Each hand-over was measured from the frame-difference spikes (`diffs.py`) and from 30 or 60 fps dense sheets.

| Hand-over | Beat | Picture changes | Whoosh peak | Verdict |
| --- | --- | --- | --- | --- |
| 1→2 camera rise, caption swap | 1.875 | caption 1.75–1.80 | none (not a scene change) | OK |
| 2→3 markers lift → type | 3.750 | 3.55–3.93 | 3.738 | on beat |
| 3→4 type rushes, dot → mark | 6.250 | 6.12–6.30 | 6.288 | on beat |
| 4→5 mark breaks → QR/phone | 8.125 | 7.85–8.20 | 8.137 | on beat (QR ~160 ms early) |
| 5→6 phone → lane icon | 10.625 | 10.40–10.60 | 10.637 | on beat |
| 6→7 rush in on phone lane | 13.125 | 12.6–13.05 | 13.112 | on beat |
| 7→8 pull back and tilt | 15.625 | 15.4–15.6 | none | on beat |
| **8→9 lanes → house** | **17.500** | **17.28–17.63, peak 17.45** | **17.512** | **on beat (fixed)** |
| 9→10 house rushes away, dot → "Your LAN" | 21.875 | 21.58–21.88 | 21.887 | on beat (exit leads, arrival on beat) |
| 10→11 words clear → terminal | 24.375 | 24.17–24.38 | 24.363 | on beat |
| 11→12 terminal collapses → mark | 26.875 | 26.78–26.90 | 26.887 | on beat |

The word entries inside comp 10 land at 22.47 s and 23.05 s, against beats at 22.5 s and 23.125 s.

## Sound

I isolated the effects by subtracting the music-only file from `homesync-16x9-mix.wav`. They line up at zero lag. The m4a residual sits at −40 dB or lower.

- **Whooshes:** nine, at 3.74, 6.29, 8.14, 10.64, 13.11, 17.51, 21.89, 24.36 and 26.89 s, each about 0.3 s long.
  - Every one is within 40 ms of its beat.
  - Every one is 4.4–11 dB **below** the music in the same 25 ms window.
  - Their energy sits at about 1–12 kHz, peaking at 2–7 kHz (`spectrum_fx.png`), above the music's low-mid body (`spectrum_music.png`).
  - There is one per real scene change, and none on the 15.625 s camera move.
- **Clicks and pops, all on real actions:**
  - 0.64 s: the play buttons press.
  - 8.76 s: the join button appears.
  - 9.39 s: the dot taps "Enable audio & join".
  - 10.01 s: "this device" appears.
  - 20.34 s: the dot's single pulse, a three-partial chime at about 1.75, 2.6 and 3.5 kHz, 11.5 dB under the music.
  - 25.01 s: Enter.
  - All are 7–14 dB under the music.
- **Loudness:**

  | File | Integrated | LRA | True peak |
  | --- | --- | --- | --- |
  | 16:9 film | −16.0 LUFS | 2.8 LU | −3.3 dBTP |
  | 9:16 film | −16.0 LUFS | 2.8 LU | −3.3 dBTP |
  | Music only | −16.0 LUFS | 2.8 LU | −3.2 dBTP |

  Loudness is steady and comfortable for web, with no clipping. The effects add nothing to the integrated loudness: the mix RMS is −15.00 dB against −14.98 dB for the music. The waveform (`waves.png`) is a steady bed with small transients.
- **Energy:** quiet for the problem (0–7.5 s), then lifts with the HomeSync reveal and stays level to the end (problem 4).

## The whole

- **One continuous piece:** yes, and it is the film's strongest quality. The dot is born from the three "now" markers. It becomes the full stop, then the centre of the mark, then the tapping finger, then T. It drops over the house, becomes the full stop of "Your machine." and the terminal cursor, and ends as the centre of the mark again.
- **The weak link is gone.** The hand-over that leads into the main shot, flagged last time, now lifts on the beat under its whoosh.
- **Scale varies:**
  - 3D floor, wide.
  - Full-frame type.
  - Large mark.
  - Close phone and QR.
  - Flat plan.
  - Close single lane.
  - Tilted plan.
  - 3D architectural model.
  - Full-frame type again.
  - Terminal.
  - End card.

  No layout repeats.
- **Three signature moments:**
  1. The three "nows" become one full stop and then the logo. This lands.
  2. The echo's own delays come back as the cure. This lands.
  3. The cure replayed in the model house. It is handsome, and it is now entered cleanly, but it is less legible than moment 2.
- **Next to premium product films:**
  - Restrained palette; the brand ground measures (9, 13, 19) against `#0b0e13`.
  - Crisp Inter and JetBrains Mono type.
  - Product-lit 3D.
  - Exact on-beat editing.
  - Honest labelling.

  It would not look weaker beside a reference film.
- **What I would change first, if anything:** solid leaders on the house bars (problem 1), then the 9:16 frame-one line (problem 2).

## Honesty

Every on-screen string traces to facts.md:

| On screen | Fact |
| --- | --- |
| "Press play on all three." / "…and you still get an echo." | F3b |
| "Nothing tells them when "now" is." | F4 |
| HomeSync | F1 |
| QR, "Enable audio & join" | F11, F25 |
| "this device" | F29 |
| "Every device is told one instant…" / "…and works out how early to start." | F6 |
| 40 / 90 / 210 ms | F8, always tagged "EXAMPLE VALUES" or "EXAMPLE" |
| "Scheduled to be heard at one agreed instant." | F5 |
| "Play the same music, in time, on every device in your house." | F2 |
| "Your LAN. Your files. Your machine." | F12 |
| `cargo run --release` | F19 |
| "a few minutes later" | F28 |
| "Open on the LAN : http://192.168.1.50:8080" | F21, tagged EXAMPLE; reflowed in 9:16 |
| "Try it on two devices." | F25 |
| github.com/lewisjohnvillamor/homesync | F24 |
| "Free and open source · MIT licence" | F23 |

- The remaining labels ("pressed", "starts", device names, "T") are diagram labels, not claims.
- There is no claim about how it sounds, and nothing turns green.
- There are no testimonials, ratings, prices or results. Nothing is generated.

## Measurements

- **Frozen time, windowed `--window 0.25` (the measured bar):**
  - 16:9: 0.117 s per 30 s, longest still 0.117 s (24.65–24.75 s).
  - 9:16: 0.05 s per 30 s, longest still 0.05 s.
  - No stretch over 0.3 s. **Pass.**
- **Frozen time, plain frame-to-frame (for reference):** 17.3 s (16:9) and 16.6 s (9:16), longest 2.2 s at 24.42–26.6 s (the terminal). These are slow pushes below the per-frame threshold, and the windowed test confirms they move.
- **Flicker:** 0 frames in 16:9, 0 in 9:16. **Pass.**
- **Contrast (spot checks this pass):**

  | Text | Ratio |
  | --- | --- |
  | 9:16 "Free and open source · MIT licence" | 7.48:1 |
  | 9:16 "a few minutes later" | 7.45:1 |
  | house label "phone" | 7.37:1 |
  | house "EXAMPLE" | 7.42:1 |

  All **pass** 4.5:1. The other labels are unchanged from the last pass (6.83:1 or higher).
- **Loudness:** integrated −16.0 LUFS, LRA 2.8 LU, true peak −3.3 dBTP for both films and −3.2 dBTP for the music. Effects are 4.4 dB or more under the music.
- **Files in `work/critic-final2/`:**
  - Contact sheets: `sheet169_{0,6,12,18,24}.png` and `sheet916_*.png`.
  - Dense sheets: `dense169_*.png` (every hand-over, plus `dense169_9.15.png` at 60 fps) and `dense916_{0.6,3.75,17.5}.png`.
  - Frames: `full169_*.png` and `full916_*.png`.
  - Audio: `fx.wav` (isolated effects), `waves.png`, `spectrum_fx.png` and `spectrum_music.png`.
  - Measurement outputs: `frozen*.txt`, `flicker*.txt` and `loud.txt`.
  - Scripts: `fx.py` and `diffs.py`.

**ship.** The one required fix (the hand-over on 17.5 s under its whoosh) is done, and the stray tag went with it. What remains is optional polish that would not lower a first-time viewer's or a critic's opinion of the film.
