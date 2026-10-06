# What a person still needs to check

Everything below was either impossible to verify without a person, or was
judged and recorded as a known limit rather than fixed. The machine-measured
results are in `out/measurements.json` and at the end of `ledger.md`.

## Needs a person

1. **Listen to it.** No human has heard the sound. Everything about it was
   measured, not heard: −16.0 LUFS integrated, 2.8 LU range, true peak
   about −3.3 dBTP, no clipping; every effect at least 4.4 dB under the music and in
   its own (higher) frequency range; one whoosh per real scene change, clicks
   only on real on-screen actions (the play press, the join button, the tap,
   "this device", Enter). Listen once on laptop speakers and once on
   headphones, at a normal volume, for harshness, for anything that sounds
   cheap or synthetic, and for whether the music's energy suits the picture.
2. **Scan the QR code with a phone.** At about 8.6 s (both formats) the
   laptop shows a QR code. It was decoded from the rendered frames
   (OpenCV) as `https://github.com/lewisjohnvillamor/homesync`, but it has
   not been scanned off a screen by a real phone.
3. **README error (F7).** `README.md` lines 402–403 say a device with a
   210 ms speaker starts 210 ms before a device with a 40 ms one. They start
   170 ms apart. The film does not use that sentence (facts.md marks F7
   excluded); the README should be corrected by its owner.
4. **Watch it at full size once, both formats**, as a first-time viewer.
   Critics judged it from contact sheets, dense frame sheets and stills;
   none watched it play in real time.

## Known limits (judged, recorded, not fixed)

- **Ground colour after encoding.** The brand ground #0b0e13 (11, 14, 19)
  decodes as (9, 13, 19) in 8-bit limited-range BT.709 video, which every
  player uses. No input colour decodes closer to it on all three channels
  (the nearest alternative decodes as (13, 14, 19)). The difference is
  invisible, but a pixel-picker will show it.
- **The house landing in 16:9** (from 18.0 s): the model sits right of centre
  and the plinth's front corner touches the bottom edge, leaving the lower
  left darker and emptier than the rest. Critics ranked this low to moderate
  by the end; reframing it collided with the headline and the labels in
  every attempt (rounds 12–25).
- **The house in 3D:** no rim light on the wall tops; the laptop's short
  (40 ms) bar sits visually over the back wall's top (16:9) and the foot of
  the bed (9:16), tied to the laptop by a dashed line; the plane's lit edge
  crosses the TV stand. All three are about how premium the model looks,
  not about what it says.
- **Short laptop bar.** The three example bars are drawn to 210 : 90 : 40;
  the 40 ms bar is only about 36–41 px tall, so its measured ratio wanders
  ±10 % with the measuring method.
- **Labels near the plane's edges.** The device labels in the house scene
  sit close to the edges of the translucent plane in places (the 210 ms
  label near its back-left corner in 16:9).
- **The house bars are the weakest of the three signature moments** (18.7–21.6 s):
  the phone's bar hangs about a room-height above the phone, tied to it by a
  thin dashed line, so "each device starts early by its own amount" reads
  more clearly in the flat diagram (8–17.5 s) than in the house. The final
  critic's suggested fix, if wanted: solid leader lines at about 40 %
  opacity. The headline carries the meaning either way.
- **The music is level from about 10 s to the end;** the house gets no lift.
  Suggested if wanted: about +1.5 dB of music over 17.5–21.9 s.
- **Small motion notes from the final critic, left as they are:** a fast
  push-in at 9.0–9.3 s in the join scene; a faint accent line in the empty
  left third of the 9:16 opening; no whoosh on the pull-back at 15.6 s (it
  is one continuous camera move, not a new scene); the laptop's QR screen
  shows about 150 ms before the 8.125 s beat (the whoosh and the phone land
  on it); the house rests 0.35 s under its slow push before the headline.

## Where things are

- `out/`: both films, the music-only version, contact sheets (a frame every
  0.5 s), `measurements.json`.
- `ledger.md`: every critic round and what was done, ending with the final
  quality-bar results.
- `reviews/`: the two whole-film reviews.
