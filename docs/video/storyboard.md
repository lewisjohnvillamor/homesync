# HomeSync — brief and storyboard

## Brief (the blanks in the commission, filled in)

The commission arrived with its brief fields as placeholders and an
instruction to make the calls without asking. These are the calls.

| Field | Decision | Why |
| --- | --- | --- |
| What it is for | **HomeSync**, the self-hosted coordinator that plays the same audio, in time, on every device in a house. | The product this repository is. |
| Who is watching | Self-hosters and home-lab tinkerers meeting it on GitHub, r/selfhosted or Hacker News. Technical, allergic to hype and to cloud accounts. They care that it runs on their own network, uses devices they already own, installs as one thing, and is honest. | Where the project's audience actually is. |
| What they do at the end | Open the repository and try it on two devices. | The README's own quick start. |
| Length and sizes | **30.0 s**, 16:9 (1920×1080) and 9:16 (1080×1920), 60 fps. | The commission's example sizes; vertical for social. |
| Brand | Name *HomeSync*. Mark: a dot with two pairs of arcs (from `web/src/index.html`). Colours from the app's dark tokens: ground `#0b0e13`, surface `#12171f`, line `#232c38`, text `#e9eef5`, dim `#94a3b4`, accent `#5aa9ff`, in-sync `#3ddc97`. Type: the app uses `system-ui`, which is not a file; **Inter** stands in as the closest open equivalent, with JetBrains Mono for the app's monospace. | Taken from the product, not invented. |
| Facts file | `docs/video/facts.md` | The only source for on-screen claims. |
| Assets | The app's own interface, rebuilt in code from its stylesheet; nothing generated. | "Prefer building shots in code." |
| References | None supplied, and the commission's kit repository is not reachable from this environment, so the motion rules in `rules.md` are the reference. | Stated rather than worked around. |

## Tone

Calm, exact, a little dry. The product's whole personality is "measure
things and say what is true", so the film explains a mechanism rather than
promising an outcome. No result claims about sound — the README itself says
nothing has been heard by a human yet.

## The one idea

**One instant.** A single accent dot is the agreed instant. It is born as the
full stop of the sentence that names the problem — *nothing tells them when
"now" is* — becomes the centre of the HomeSync mark, is the tap that lets a
phone join, becomes the instant **T** every device aims at, drops into a model
house and reaches every device in it at once, is the full stop under "Your
machine.", the cursor in the terminal, and the centre of the mark again at the
end. It is on screen from 3.75 s to the last frame.

## Beat grid

Music at **96 BPM**: one beat is **0.625 s**, one bar of four is **2.5 s**,
and 30 s is exactly 48 beats. Every composition is a whole number of beats,
so every scene change falls on a beat.

## Storyboard v6 (16:9 / 9:16)

Changed after storyboard critics rounds 1–5 — see `ledger.md`.

The argument: *press all three together — and each still starts at its own
moment* (1–2) → *because nothing tells them when "now" is* (3) → *HomeSync*
(4) → *how a device gets in* (5) → *how it agrees on "now"* (6–8) → *the
promise, across the whole house* (9) → *it is yours* (10–11) → *try it* (12).

**The lag is an object.** At the shared press, a short accent bar grows on
the floor in front of each device until that device's sound actually starts —
laptop short, phone longer, TV longest, in the ratio 40 : 90 : 210 (shown 8×
slowed: 0.32, 0.72, 1.68 s, so the growth runs 0.625–2.305 s, during the
camera's rise, where it can be read). Each bar ends in a small marker: that device's
own "now". Those three markers merge into the full stop in composition 3; the
same three bars are the delay bars of compositions 6–8, and rise again inside
the house in composition 9 — vertically, as time, never across the floor as
distance (distance would mean sound travelling to a listener, which is
acoustic calibration — excluded).

**Never still.** Every hold has a slow push (2–3 % scale) and a drift of the
ground; no stretch is still for more than half a second.

3D is used twice, both for placement in a real space, with the same three
device models lit like a product shoot (soft key from the left, rim behind),
camera between 35° and 55°: devices on a floor (1–2), and devices in a model
house (9). No text is drawn inside the 3D; labels are HTML.

| # | Time (s) | Beats | On screen (16:9) | 9:16 framing | For | Type backing | Leaves by | Carries |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 0.000–1.875 | 3 | **3D, ~35°. Frame one, finished:** laptop, phone and TV on a dark floor, filling the width; each screen shows a dim paused player — a title line, a progress line, a play button; "Press play on all three." set top-left. The camera is easing in. At 0.625 s all three play buttons press down together (visibly sink, then the screens come up). | Same floor in depth: TV at the back, laptop middle, phone in front; line at top. | The situation everybody has tried — done right. | Clear ground above the devices. | The camera rises over the same floor — no cut. | The three devices |
| 2 | 1.875–3.750 | 3 | **3D, ~52°:** in front of each device, the accent lag bar has grown from the shared press line and stopped at its own marker — short, longer, longest; rings spread from each device only from its own marker's moment. "…and you still get an echo." set as the TV's bar lands, by 2.35 s. | Same. | Show the cause the README names: pressed together, each starts at its own moment. | A dark band behind the line. | The three markers lift off the floor; the words of the next line ease in on a solid ground. | **The three markers** |
| 3 | 3.750–6.250 | 4 | **Full-frame type:** *Nothing tells them* from the left, *when "now" is* from the right; the three markers fly in and merge into one round dot as the line's full stop. Set by 4.40 s, held to 5.90 s with a slow push. | Lines enter from top and bottom. | Name the cause — and the three "nows" become one. | Plain ground. | The words rush past the camera; only the full stop stays (≤ 0.3 s, still drifting). | **The dot** |
| 4 | 6.250–8.125 | 3 | The HomeSync mark grows out of the dot and settles **large on the left, filling most of the frame height**, "HomeSync" to its right, set by 6.95 s. Slow push. | Mark large in the upper half, wordmark below. | Who fixes it. | Plain ground. | The dot drops out of the mark; the rest lifts away fast. | **The dot** |
| 5 | 8.125–10.625 | 4 | **Close, no line:** a laptop screen filled by the invite QR code on the left; a phone filling the frame height passes over the code with the code in its viewfinder, then settles to the right (8.30–8.90 s) → **Enable audio & join** on its screen, which the dot presses (9.375 s) → the room, with **this device** and the dot beside it (10.00 s); the camera pushes in so both labels are at least 48 px tall. The QR code encodes the repository URL. The dot falls out of the mark and rides in with the phone, waiting where the button will appear. | QR in the top 40 %; the phone ~75 % of the width, cropped by the bottom edge. | How a device gets in. Action, not reading. | — | The phone shrinks into the phone-lane icon of the next diagram. | **The phone, and the dot** |
| 6 | 10.625–13.125 | 4 | **Wide, flat diagram:** three lanes — laptop, phone, TV — the phone's icon being the phone that just shrank in; the dot lands at the top as the instant **T** and a line falls from it through all three lanes. "Every device is told one instant…" set by 11.30 s. Framed as a true plan view. | Lanes stacked, narrower; T full height. | How it agrees on "now", step one. | Clear ground above the lanes. | The camera rushes in on the phone lane. | T and the phone lane |
| 7 | 13.125–15.625 | 4 | **Close on the phone lane:** the phone's lag bar from composition 2 returns, ending at T — "90 ms · example" — and the phone's start marker slides left by exactly its length. "…and works out how early to start." set by 13.80 s. | Same, the lane filling the width. | Step two. | Clear ground above the lane. | Camera pulls back and tilts over all three lanes. | T and the bars |
| 8 | 15.625–18.125 | 4 | **Tilted to exactly the house camera's angle:** all three lanes, each start earlier by its own bar (40 / 90 / 210 ms, one **example** tag) — the same three bars from composition 2 — all ending exactly on T, which brightens in accent blue. "Scheduled to be heard at one agreed instant." set by 16.00 s; held while the plane drifts. The ms labels are small and dim, each fading in with its bar. | Same, tilted. | The fix, without claiming how it sounds. | A band behind the line. | From 17.25 s the caption and the lane plane push towards the camera and past it, revealing the house waking underneath at the same angle; the change is centred on the beat at 17.5 s, under its whoosh. *(Moved from 17.85 s in the final review, so the change lands on the beat.)* | **The dot** |
| 9 | 18.125–21.875 | 6 | **3D, ~45°:** a premium architectural model of a small two-room house on a plinth, roof off, soft key from the left, rim light behind; inside, the same three device models. The dot drops and hovers above the house; beneath it, a level plane of light at its height is the instant **T** (a small HTML label). "Play the same music, in time, on every device in your house." is set with the drop, by 18.80 s, and held to 21.60 s. From about 18.7 s each device's delay appears as a bar hanging from the plane straight above that device, growing up into the plane — the TV's first, then the phone's, then the laptop's, the reverse of composition 2 — and all three tops touch the plane together; the dot pulses once. Each device carries a small accent ring marking it, and each bar's label names its device ("TV · 210 ms", as in composition 8). *(Changed in component round 23: in a real room every device sits about the same distance below the plane, so bars standing on the devices would be equal columns; the bars carry the 210 : 90 : 40 lengths and the ring and name tie each to its device.)* | Camera closer, ≤ 55°; the line at the top, three lines. | The promise, whole, at the peak — shown as the cure replayed in space. | A band behind the line. | The dot rises out of the house towards the camera. | **The dot** |
| 10 | 21.875–24.375 | 4 | The dot sits at centre-right; one per beat, "Your LAN." (from the left), "Your files." (from the right, travelling below the dot's line and rising into place, so it never crosses it), "Your machine." (from the left) slide in and stop with the dot as their full stop, each easing the last one up and out; "Your machine." held to 24.30 s. Slow push. | Same, the dot centred low. | The self-hoster's reasons to care. | Plain ground. | The words clear; the dot slides into a terminal. | **The dot** |
| 11 | 24.375–26.875 | 4 | A terminal filling most of the frame. `$ cargo run --release` is already typed with the dot as the cursor. Enter on 25.000 s; a caption *over* the terminal, in the film's type not the terminal's, says *a few minutes later*; then **Open on the LAN      : http://192.168.1.50:8080** (the README's own padding) at 25.625 s with one **example** tag beside it, held to 26.60 s. No headline. | Terminal fills the width. | How little it takes to run, honestly. | — (inside the terminal) | The printed line collapses into the dot. | **The dot** |
| 12 | 26.875–30.000 | 5 | **End card, centred stack:** the dot becomes the centre of a large mark, arcs breathing; "HomeSync"; "Try it on two devices."; **github.com/lewisjohnvillamor/homesync**, set by 27.60 s; a dim "Free and open source · MIT licence" under it from 28.10 s. Never still. | Stacked, centred; URL fits 1080 px with gutters. | The call to action. | Plain ground. | — | — |

12 compositions of 1.875–3.75 s; lengths of 3, 4, 5 and 6 beats.

## Three signature moments

1. **Three "nows" become one, and become the logo.** The three small markers where each device's sound began fly up and merge into the full stop of "Nothing tells them when "now" is." — and when the sentence rushes away, that single dot becomes the centre of the HomeSync mark.
2. **The echo's own delays become the cure.** The three bars that showed how late each device started come back in the diagram, and each device moves its start earlier by exactly its own bar, so all three point at one instant.
3. **The cure, replayed in a real house.** Inside a small, crafted model of a home, the same three devices raise their bars towards one level of light — the longest first — and all three touch it together.

## Sound off

Press play on all three. / …and you still get an echo. / Nothing tells them
when "now" is. / HomeSync / *(the join, in the interface's own words)* /
Every device is told one instant… / …and works out how early to start. /
Scheduled to be heard at one agreed instant. / Play the same music, in time,
on every device in your house. / Your LAN. Your files. Your machine. /
*(cargo run --release … Open on the LAN)* / Try it on two devices.
github.com/lewisjohnvillamor/homesync — Free and open source · MIT licence

## Honesty

- On-screen claims trace to facts.md rows F1, F2, F3b, F4, F5, F6, F8, F11,
  F12, F19, F20, F21, F23, F24, F25, F28, F29. Nothing on screen lacks a row.
- Delay figures and terminal output carry an **example** tag.
- The phone, not the TV, is the device compensated in close-up.
- No claim that the result *sounds* in sync: lanes stay three lanes; the line
  says *scheduled to be heard* (F5); the house shows *start times* rising to
  one level, never sound travelling or merging; nothing turns green.
- Interface screens show abstract bars only; the only legible interface
  strings are F25 "Enable audio & join" and F29 "this device".
