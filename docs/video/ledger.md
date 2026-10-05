# Critic ledger

Every round: what a fresh critic found, what changed, and the numbers before
and after. Critics are new each round, are never told what the builder thinks
it fixed, and pull their own frames and measurements.

## Round 1 — storyboard v1 → v2

Critic verdict: **one more pass** (13 findings).

| # | Finding (ranked) | Change in v2 |
| --- | --- | --- |
| 1 | Comp 7 merged three waves into one and put a green status line under it: a "sounds in sync" claim the README does not support. | Waves are never merged. Three lanes keep their own starts; their delay bars *end* on T, under F5 "scheduled to be heard at one agreed instant". Status line removed. Signature 2 rewritten. |
| 2 | End card unreadable: ~15 words plus URL in 1.875 s, URL on screen ~0.7 s. | End card 5 beats (3.125 s); URL fully set by 27.6 s, so on screen ≥ 2.4 s. "Free and open source · MIT" dropped. |
| 3 | Terminal comp overloaded; QR repeats comp 8. | Command already typed; the only action is Enter; prints one line. No QR. Banner text, not a QR, becomes the dot. |
| 4 | Mechanism comp too dense, and T−42/T−211 contradict "starts early by its own delay" (the README figures fold in clock offset; F7's own arithmetic is off). | No T-values on screen. Speaker delays only, labelled "example". F7 excluded in facts.md; the README sentence is reported to the owner as an error. Mechanism split across three compositions. |
| 5 | The dot stops carrying the story after comp 7. | The accent dot is now in every composition from 3 to 12: full stop → mark → joining phone's indicator → instant T → travels through the house → full stop of "Your machine." → terminal cursor → mark. |
| 6 | House comp: too much text; "speakers" misdescribes the product; green muddles "in sync"; ends tight on a flat screen; lights unspecified. | Devices are the film's own (laptop + TV in the kitchen, phone in the bedroom). Both rooms in accent colour, different rhythms. Line cut to "Kitchen plays one thing. Bedroom, another." 5 beats. Exit by the dot rising, not by a dive. Key light from the left, rim light behind. |
| 7 | F2 promise readable for ~1.2 s. | Brand comp 6 beats (3.75 s); promise set by 7.6 s, on screen ~2.2 s before it leaves. |
| 8 | Search comp overloaded, off-idea, illustrative library unlabelled. | Cut. F26/F27 no longer used. |
| 9 | Join comp: phone too small in 16:9; line contradicts the scan; result unclear; join shown after "playing together". | Join moved before the mechanism. Tight framing: the invite QR fills the left of frame, the phone fills the right. Line "Scan the code, or open the link." Result is on the scanning phone: it shows the room with itself in the device list. |
| 10 | Comps 5–7 one layout for 7.5 s, repeating comp 2. | Three distinct scales: wide flat diagram, close on one lane, tilted overview. |
| 11 | No backing specified for type over picture. | Backing stated for every line that sits over picture. |
| 12 | Ten comps of exactly 2.5 s; nothing moves 0–0.6 s. | Lengths 3–6 beats. Comp 1 pushes in and glows from frame one. |
| 13 | Fact-ID list wrong. | Corrected. |

## Round 2 — storyboard v2 → v3

Critic verdict: **one more pass**. Of round 1's 13 findings: 7 fixed, 5 partly fixed, 1 mostly fixed. 15 new findings.

| # | Finding (ranked) | Change in v3 |
| --- | --- | --- |
| 1 | The argument doesn't add up: comp 3 names "no shared clock" as the cause, comps 7–8 fix speaker delay, which was never introduced. | Comp 3 uses F4's other half: *Nothing tells them when "now" is.* — which "every device is told one instant" answers directly. Still ends on a full stop. |
| 2 | The house contradicts the one idea (one dot hopping between rooms that have separate timelines) and its different rhythm looks like the echo. | House is about F2: the dot drops in and reaches *every* device in every room at once. Rooms-as-independent dropped (F14 unused). |
| 3 | "Laptop and TV pulse together" is a sync claim in pictures. | Devices are shown *receiving* the instant (a tick on each screen), never playing in unison. |
| 4 | Join comp overloaded; band over the phone. | Room screen cut: scan → tap → "this device", one step per beat. Line on the laptop side. |
| 5 | Dot vanishes in comp 5 and at the start of comp 10. | The dot is the tap on "Enable audio & join" in 5, and sits on screen from comp 10's first frame as every word's full stop. |
| 6 | Comp 8's payoff line has the least time. | Comp 8 is 4 beats; line set before the tilt ends. |
| 7 | Terminal implies instant install; "self-contained binary" over a compile; too much text. | Visible *Compiling…* and *(a few minutes later)* lines (F28); headline is "No Node, no bundler, no database."; "example output" moved into the title bar; 4 beats. |
| 8 | Repeated layouts (three lanes ×3, logo card ×2, sides-type ×2); no overhead. | Comp 2 is a high-angle view of the devices with rings, not lanes. Comp 4 is mark-small + large line; the end card is mark-large + CTA. Comp 10's words land on the dot instead of entering from both sides. |
| 9 | "This phone" is not an interface string. | "this device" (F29). |
| 10 | Comp 1→2 waveform carry geometrically unplanned. | No waveform carry: the camera rises over the same floor, so the devices themselves carry. |
| 11 | Comp 10's small line has no time. | Set from 22.6 s and held. |
| 12 | 9:16 not storyboarded. | A 9:16 framing column for every composition. |
| 13 | The hero device is the TV, whose latency the README says is reported wrongly. | Labelled "TV output · 210 ms" with a large **example** tag. |
| 14 | Comp 3 too short to read. | Set by 5.000 s, held to 5.900 s. |
| 15 | Presses and Enter off the beat. | Presses at 0.625, 1.250, 1.875 s; Enter at 25.000 s. |
| — | Round 1 #7: promise readable ~2.1 s for 12 words. | F2 split word for word across comps 4 and 9; each half has ≥ 2 s. |

## Round 3 — storyboard v3 → v4

Critic verdict: **one more pass** (4 blockers, 4 moderate, 5 build-time). Round 1: 9 fixed, 3 partly, 1 still there. Round 2: 6 fixed, 7 partly, 2 still there.

| # | Finding | Change in v4 |
| --- | --- | --- |
| 1 | Blocker: presses a beat apart make the echo look like user error, the opposite of F3; and the delay bars of 7–8 are never set up. | All three pressed together at 0.625 s. Comp 2's rings start late by offsets in the 40 : 90 : 210 ratio — the same offsets that return as delay bars in comp 8. Line: "…and you still get an echo." |
| 2 | Blocker: the key line fully set for 0.9 s. | Comp 3 is 4 beats; set by 4.40 s, held to 5.90 s (1.5 s). Comps 1 and 2 are 3 beats each. |
| 3 | Blocker (honesty): the TV is still the device compensated in close-up. | The phone — already "this device" from comp 5 — is the close-up, at 90 ms. |
| 4 | Blocker: 3D for line-drawn devices can't be product-lit; comp 8's tilt explains nothing; the move into the house is unplanned. | Comps 1–2 and 9 use the same three lit 3D device models. Comp 8 tilts to exactly the house camera's angle and lifts away to reveal the house waiting underneath. |
| 5 | Unsourced "Compiling homesync …"; wrong fact list. | Removed. Terminal prints F21's "Open on the LAN" line, echoing the join. List corrected. |
| 6 | The house's ticks read as a sync claim. | Threads reach devices at slightly different moments; each then shows the same T, in accent blue. Nothing turns green anywhere. |
| 7 | 9:16 framings impossible or incomplete. | Devices in depth, perspective-stacked; comp 5 has no line; comp 9 ≤ 55°; URL width to be checked at build. |
| 8 | Comps 4 and 12 are the same card. | Comp 4: mark large on the left filling the frame height, words to its right. Comp 12: centred stack. |
| 9 | Reading-led film. | Comp 5's line cut — the interface's own labels carry it. "No internet needed." replaced by F23, which this audience values more. |
| 10–13 | Build-time: small line order in 10; ≤ 0.3 s hold in 4; ease words in on 2→3; set times for 6–8. | Written into the table. |

## Round 4 — storyboard v4 → v5

Critic verdict: **one more pass** (6 blockers, 5 build-time). Prior findings: most fixed; R3.9 (reading-led) still there.

| # | Finding | Change in v5 |
| --- | --- | --- |
| N1 | Blocker: rings from three places never line up anyway, so "out of step" is invisible; signature 2 depends on memory. | The lag is an object: an accent bar on the floor per device, from the shared press to its own marker (40:90:210, shown 4× slowed). The same bars return in 6–8 and 9. |
| N2 | Blocker: the picture shows one shared press, contradicting "nothing tells them when now is". | Each bar ends in its own marker — three separate "nows" — and in comp 3 the three markers merge into the one full stop. |
| N3 | Blocker: comp 10 has four lines in 1.875 s. | Comp 10 is 4 beats with three words only; the free/MIT line moved to a dim line under the URL. |
| N4 | Blocker: F2 split across 4 and 9 never reads as one sentence. | Comp 4 is mark + "HomeSync" only (4 beats). Comp 9 carries the whole F2 line, set by 19.30 s, held to 21.60 s. |
| N5 | Blocker: the peak repeats the stagger, its result is flat, and a T on screens is text in 3D. | The cure replayed in space: bars grow towards one point, longest first (reverse of comp 2), all meeting it together; T is one HTML label. |
| N6 | Blocker: terminal ~20 words in 2.5 s; headline pops. | Headline dropped; one example tag on the LAN line, held 25.625–26.60 s. |
| N7 | Blocker: labels compete with lines in 7 and 8. | "90 ms · example"; one example tag in 8; comp 8 line set by 16.60 s, lift from 18.50 s. |
| N8–N12 | Build-time: phone → lane handoff, 9:16 comp 5, holds never still, comp 1 at ≥ 35° with a dim paused player and a visible press, alternate sides in 10, set times, "still" in F3, F20, full stop as a brand circle. | Written into v5 and facts (F3b). The dot is the brand circle, never Inter's glyph. |

## Round 5 — storyboard v5 → v6 (build)

Critic verdict: **one more pass** (3 blockers, 10 build-time). Of 51 prior findings: 35 fixed, 15 partly fixed, 1 still there (R3.9, word count ~95).

| # | Finding | Change in v6 |
| --- | --- | --- |
| 1 | Blocker (honesty): bars growing across the house floor to one point read as sound travelling to a listener — acoustic calibration, excluded; and "the middle" of a two-room house is a wall. | Bars rise **vertically** from each device to a level plane of light at T; the dot hovers above. Time, never distance. |
| 2 | Blocker: at 4× slow the bars finish inside comp 1 at a grazing angle. | 8× slow (0.32 / 0.72 / 1.68 s): growth spans 0.625–2.305 s, the camera's rise. The comp 2 line lands with the TV's bar. |
| 3 | Blocker: F2's 12 words in ~2.3 s while the signature moment plays. | Comp 9 is 6 beats (beat taken from comp 4); line set with the drop by 18.80 s, bars start 0.5 s later, line held to 21.60 s. |
| 4–13 | Build-time: dot's path through comp 5; physically possible scan with a real QR (repo URL); label times in 5; dim ms labels in 8; comp 2 line time; "Your files." crossing the dot; "(a few minutes later)" as a caption not output, README padding; 9:16 comps 4/12 differ; abstract player UI only; comp 6 as a true plan view. | Written into v6; checked at component stage. |

**Decision:** after five storyboard rounds the blockers are fixed in the plan and the remaining items are build-time, so building starts on v6. The component critics are told nothing about this list and check the built work for themselves.

## Component round 1 — full render r0 (16:9)

Four fresh critics, one per range, each given only `work/critic-component.md`. Full findings: `work/round1/a.md`–`d.md` (A and B saved for the builders; C and D summarised here). All four: **one more pass**. Honesty passed in every range; every settled line ≥ 4.5:1 (most ≥ 7:1).

**Frozen-time measure.** The plain adjacent-frame test reports ~20 s frozen per 30 s; at 60 fps a slow drift moves a fraction of a pixel per frame, so it cannot see it. A `--window 0.25` mode was added to the kit (each frame against the one 0.25 s earlier): 0.58 s per 30 s, longest 0.30 s. Critics were told to run both and judge by eye where they disagree. They agreed the windowed test is right about drift but named the holds that still *feel* paused — those are findings below, not passes.

| Range | Top findings | Fixed by |
| --- | --- | --- |
| A 0–8.1 | Comp 4→5 one-frame pop with "omeSync" left behind; comp 2 closes on a hard slit cutting the caption; wordmark fades in over the arcs; dead dot frame at 6.25; opening shot floats in a void; markers overshoot and bounce; holds feel paused; press doesn't sink; bars leave the safe area; bar lengths not comparable. | Builder A (s01–s04) |
| B 8.1–18.1 | Phone vanishes at 10.41 instead of becoming the lane icon; lines cut through "instant." at 15.75; 8→9 double exposure with ms labels over the house; comp 5 entry over the wordmark; diagram holds feel paused; comps 6–8 same layout; no phone on the comp 7 lane; comp 6 sparse; band cuts T; half-empty scan frame; press reads as a bump. | Builder B (s05–s08); the lift's iris by the lead |
| C 18.1–21.9 | Exit: "Your LAN" over the fading house; entry: double exposure; climax doesn't read (floating stubs on hairlines, no ms values, payoff on screen 0.2–0.35 s); 18.55–19.40 feels paused; T plane reads as a lid; flat light; base cropped at the bottom. | Lead |
| D 21.9–30 | Cursor dot crosses "--release" on Enter and covers the "O" of the output; "Your machine" ghosts over the terminal; house leaves by dissolve; end-card arcs show stray round caps and build off-centre; terminal doesn't fill the frame and the cursor is a blob; end card near-still 2.6 s; "a few minutes later" 0.35 s at 34 px; three dissolves in a row. | Lead |

**Lead's changes (C, D):**
- `HOUSE_TOUCH` 21.25 → **20.625** (beat 33) and the score's chime with it: the bars now start at 18.945 (TV), 19.905, 20.305, filling the 18.55–19.40 pause, and the payoff holds ~0.7 s before the dot rises (21.3).
- Bars stand on **solid dim stems** from their devices; each carries its **ms value** (F8) with one EXAMPLE tag; a **ring** crosses the plane at the touch; the plane is a faint fill with a glowing edge; T label 30 → 44 px; stronger rim light.
- Framing: 16:9 base clear of the bottom edge; 9:16 pulled back so the model fits the width.
- Exit is a **push-through** (camera rushes in, layer gone by 21.86) and "Your LAN" waits until it is gone; the headline leaves at 21.2 (was 21.6) so the rising dot never crosses it — a 0.4 s deviation from the storyboard's "held to 21.60", taken for the collision rule.
- Comp 8→9: the lanes fly off first and the ground opens as an iris; no double exposure. (Tilt match left to builder B.)
- Terminal: window sized to its content (740 → 560 px), stronger push, cursor at cap height one character after the text, **down-then-left** on Enter, drops before the output prints, blinks on the beat while waiting; caption 34 → 48 px, below the output, held from Enter to the collapse (~1.6 s); exit is a 1.6× push-through.
- End card: the dot reaches the centre line before the mark and name build; arcs drawn as one centred dash (no stray caps); breathing 2.2 % → 5 % with the outer arcs' opacity breathing; push 3.5 → 6 %.
- Comp 10: "Your files" reaches its baseline sooner; "Your machine" clears in 0.08 s before the terminal text; stronger push; the full stop pulses on each beat.

## Component round 2 — full render r1 (16:9; 9:16 rendered alongside)

Four fresh critics, each given only the brief and the previous critic's findings for its range (`work/round1/prior-*.md`, with the lead's notes stripped so nothing says what was fixed). Findings: `work/round2/a.md`, `b.md`; C and D summarised here. All four: **one more pass**. Windowed frozen test: 0.017 s per 30 s over the whole film (bar: ~1 s; no stretch over 0.3 s).

**Prior findings:** A — 7 of 11 fixed, 4 partly. B — 7 fixed, 2 mostly, 4 partly. C — 1 fixed, 3 mostly/partly, 1 still there (premium look). D — 5 fixed, 6 partly, 1 still there.

| Range | New or remaining findings | Fixed by |
| --- | --- | --- |
| A 0–8.1 | Dot inside the "s" of "is" on the word exit; TV slides under the fading first line; merging dot crosses the "s"; comp 4 exit dot shrinks in 4 frames into a hard-edged circle reveal; comp 2 under-fills; near-empty frames at 3.6; lockup edge to edge; press ring over the TV's UI; bars could read as distance. | Builder A — all nine. Comp 2 reaches 65 % width (devices), 77 % with the caption: wider pushes the TV off the top edge. |
| B 8.1–18.1 | **Honesty:** the ms counters counted through values not in facts.md ("59 ms", "134 ms"). 8→9 dips to black, pops a hard iris and loses the dot; 4→5 hard iris; comp 6's pills travel the time lanes as distance and leave bar-like trails; comp 6 hold and framing; comp 8 lands small and late; phone icon off-frame at 13.15; comp 5 framing; press ring spills. | Builder B — all ten. Counters removed: only fixed "40 / 90 / 210 ms" labels, faded in as each bar lands. The diagram now lifts off the house as one card. Also found and fixed a stray-lane bug (s06's plane showing through a hidden layer, 8.3–9.6). |
| C 18.1–21.9 | Entry dip and iris; exit dot swoops sideways and the house dissolves; phone/laptop bars still read as pins on hairlines; "210 ms" chip on the TV; the pulse ring spreads through every room — leans towards a sound-outcome claim; payoff ~0.65 s; 18.5–18.95 near-hold; band edge, no rim, slab props. | Lead: the dot is hosted from 17.95 dropping only 0.35; stems thicker and brighter; labels arrive with their bars and keep clear of the TV; the ring is now a small swell inside the dot's room (honesty); payoff held to 21.4; the T plane slides down into place; **exit:** the model lifts up past the camera with no dissolve while the dot swells forward and lands on composition 10's exact pixels (shared via `handoff.lanDotAt`). Not done: rim on the walls and bevelled props (premium look) — left for the next critic to judge. |
| D 21.9–30 | Dot over the "Op" of the output as it collapses; "Your machine." hold flat; faint ghost over the terminal; terminal mostly empty; exits are fades. | Lead: the output fades before it reaches the cursor; the sentence's push accelerates (5 % across the last hold); words gone before the terminal frame shows; the window starts around the command and grows as the output prints, with the caption pinned inside its lower edge; the terminal leaves by a 2.8× push-through with only a 75 ms fade. 9:16: the address wraps to its own line so the type is 50 px (was 32). |

## Component round 3 — full render r2 (16:9 and 9:16)

From this round every critic judges **both** formats. Findings: `work/round3/a.md`–`d.md`. All four: **one more pass**. Windowed frozen: 0.03 s per 30 s (16:9), 0.23 s (9:16); no stretch over 0.1 s. Contrast passes everywhere; honesty passes everywhere (round 2's counter values are gone).

**Prior findings:** A — 3 fixed, 6 partly. B — 3 fixed, 1 fixed in 16:9 only, 1 mostly, 4 partly, 1 still there (comp 6 hold). C — 1 fixed, 1 mostly, 4 partly, 3 still there. D — 3 fixed, 3 partly, 2 still there.

| Range | Main findings | Fixed by |
| --- | --- | --- |
| A 0–8.1 | 16:9: TV bar hidden behind the laptop lid. 9:16: comp 3 text pushed off the left edge; the mark born off the right edge; lockup edge to edge. Both: the press happens in one frame; bars can still read as distance (all screens light together); full stop above the baseline; comp 1 under-fills; press rings touch the progress lines. | Builder A — all ten. The press line draws in over 7 frames; each screen stays dark until its own marker lands, so picture-on matches sound-on; the baseline is measured from the type. Shortfall: comp 1 in 16:9 fills ~69 % of the height. |
| B 8.1–18.1 | Comp 6 hold feels paused (1.2 s); press ring crosses "join"; 8→9 plane slides instead of lifting, and in 9:16 the dot lands on the "TV" label; comp 8 cropped in 9:16; comp 5 dominated by the cropped QR; comp 7 T unlabelled and the marker reads as T moving; end of comp 7 reads as a pause; 9:16 label on the phone icon, orphaned "instant…". | Builder B — all eleven, checked on clips in both formats. |
| C 18.1–21.9 | 9:16 label chips hide the laptop's bar and the TV; 9:16 house small (~38 % height); tops don't visibly meet one level; exit swoops and shrinks; entry flashes and lands early; chip early and touching the TV; band edge; payoff ~0.8 s; linear drift. | Lead: touch moved to **20.3125** (half-beat, chime with it) for a ~1.2 s hold; stems at the bars' weight; larger contact marks; the dot hovers over open bedroom floor (clear of every bar and chip in both formats); 9:16 chips at the bar tops; chips fade in after their bars start; the house is dimmed to 40 % under the diagram and lit fully exactly on 18.125; band feathered; eased drift; the exit drops the house away beneath a dot that grows monotonically into composition 10's. **Not done:** 9:16 house still ~40 % of the height (the model's width limits it); rim light and bevelled props. |
| D 21.9–30 | 16:9 dot drops on the caption pill on Enter; one-frame overlap of "files" and "LAN"; 9:16 comp 10 edge to edge; 9:16 terminal short with the colon orphaned; the output doesn't collapse into the dot; pause before Enter; fades in place; 9:16 end card tight. | Lead: the small window is taller so the caption sits below the cursor's row; "Your LAN." lifts before "files" rises; 9:16 words 150 → 124 u; 9:16 terminal 800 u tall with 2.0 line height; the output shrinks evenly down on to the cursor's row before fading; the cursor blinks on the beat from 24.45; "Your machine." rushes past the camera about its full stop; 9:16 end-card wordmark 184 → 168 u and the stack lowered. **Not done:** the dot still meets "Your files" by the word rising to it. |

## Component round 4 — full render r3 (16:9 and 9:16)

Findings: `work/round4/a.md`–`d.md`. All four: **one more pass**. Windowed frozen: 0.0 s per 30 s (16:9), 0.13 s (9:16). Contrast passes everywhere.

**Two honesty findings this round**, both fixed:
- **A1 — the opening's lag bars read as distance.** Each bar ended at its device, so bar length equalled the device's distance from the press line: "the farthest device hears last", contradicting F4b (the delay is in the hardware). Builder A restaged comp 1–2: the devices stand in a column clear of the bars, the laptop (shortest bar) farthest from the line, every marker stopping short of its device by a different amount. The 40:90:210 lengths, the shared press, each screen lighting as its own marker lands, and the marker hand-off into comp 3 are unchanged.
- **B4 / B10 — one EXAMPLE tag for three figures, and a white capsule travelling along each bar.** The capsule could read as sound travelling. Builder B: every ms figure in comps 7–8 carries its own EXAMPLE tag; the capsule is gone, and the bar itself fills from the device's start to T.

**Prior findings:** A — 7 fixed, 2 partly, 1 still there. B — 5 fixed, 1 mostly, 4 partly, 1 still there. C — 2 fixed, 5 partly, 4 still there. D — 3 fixed, 5 partly, 2 still there.

| Range | Other main findings | Fixed by |
| --- | --- | --- |
| A 0–8.1 | 9:16 comp 3 type not full-frame; comp 1 fill and floating laptop; phone touching the laptop; logo hold paused; echo caption 0.3 s early; press ring on the progress line. | Builder A. Shortfalls: 9:16 comp 3 is four lines at 150u, ~31 % of the height (the widest line limits it); 16:9 comp 1 keeps empty floor left of the devices until the press. |
| B 8.1–18.1 | Comp 5 framing (16:9); comp 6 pause; 8→9 plane must lift and grow; the press turned the dot into a hollow spinner; hard-edged reveal; 9:16 comp 5 and comp 7 under-filled; TV label crowding. | Builder B. Self-reported weak spots: a few dark frames at 17.90–17.97; comp 5 16:9 right side still bare; comp 8 9:16 diagram small. |
| C 18.1–21.9 | Bars and stems indistinguishable, so the ratio and the touch don't read; 9:16 house small; exit swoop; house fades up from black; the dot looks laid on the bed; band edge; held payoff; labels detached. | Lead: bars full-weight and bright on thin dim stems; a ring on the plane at each touch that holds to the exit; the plane steps up in brightness at the touch; labels ride each bar's top; a plumb line and floor spot under the hovering dot; no dimming under the lifting diagram; an eased 3.5° orbit through the hold; band feathered over 120u; bevelled walls; the exit arcs up and over into composition 10; 9:16 house closer and lowered with a view offset (x 40–1019). **Not done:** rim light on the wall tops; modelled furniture. |
| D 21.9–30 | The dot on the output text as the terminal leaves; 9:16 terminal 4 px margins and stranded colon; dot drifting on bare ground after the house; 9:16 words small; end card fades in place; terminal fades in empty; output read time; dot gap on arrival. | Lead: the output line shrinks about the cursor's centre and is swallowed; 9:16 window 900u wide (≥ 50 px gutters at full push), 700u tall, 46 px type; **9:16 trims the README's run of padding spaces before the colon** (`Open on the LAN :`) so the wrapped colon isn't stranded — the only deviation from F21's exact text, and only in 9:16; "Your LAN" starts sliding in at 21.795 while the house drops away; the dot arrives 2.6× and settles; 9:16 words 140u; the window and its typed command appear together; collapse 26.64, exit 26.74 (output ~1.1 s); end-card lines enter from alternating sides with the arcs. |

## Component round 5 — full render r4 (16:9 and 9:16)

Findings: `work/round5/a.md`–`d.md`. All four: **one more pass**. Windowed frozen: 0.0 s (16:9), 0.32 s (9:16) per 30 s. Contrast and honesty pass, except A1 below.

**Prior findings:** A — 2 fixed, 5 partly, 1 still there. B — 5 fixed, 1 mostly, 4 partly, 1 still there. C — 1 fixed, 5 partly, 4 still there. D — 1 fixed, 5 partly, 3 still there.

| Range | Main findings | Fixed by |
| --- | --- | --- |
| A 0–8.1 | **Honesty (again):** the TV's marker still ended at the TV, so "farthest hears last" survived, and nothing tied the rows to their devices. Comp 1 fill; 16:9 mark small; flag under the caption band; 9:16 type hold paused; logo hold borderline; press ring; TV foot on the lid; dark 2→3 gap. | Builder A: each row now starts with its device's icon and every marker stops short of every device (laptop/phone 300+ px; TV ~100 px in 16:9 at 3.3 s, ~160 px in 9:16 — **the 16:9 TV gap is under the 150 px asked**); the strip is on the floor from frame one; flag removed; type 172u with a 6 % push; arcs breathe; "Nothing tells them" on the beat. Shortfalls: 16:9 mark ~540 px (asked 700); ~3 dark frames remain at 3.70–3.74. |
| B 8.1–18.1 | Comp 6 pause (third round); the dot turned into a radio button at the press; 8→9 a diagonal wedge wipe; "TV" near the heading; 210 ms label/tag failing contrast mid-fade; 9:16 comps 6 and 8 under-filled; card over the button; half-dark markers; the white fill on every bar. | Builder B: devices answer T in turn (pop, screen floods, ring) with the push starting at 11.9; the dot stays solid; the plane's own crisp edge uncovers the lit house; labels fade in with their bars (210 ms 7.41:1, tag 6.65:1 at 16.6); the white fill runs once, on the phone only. Shortfalls: 9:16 comp 8 at 0.76 scale with ~450 px empty above (it is wider than tall); 9:16 comp 6 rings clipped at the left edge. |
| C 18.1–21.9 | Exit swoops and backs away; 9:16 TV chip over its bar; rings into labels; plane barely visible before the touch; disc "hockey puck" before each bar; band shadow dimming the bars; 9:16 house small. | Lead: the dot glides on one eased line at ~constant size (composition 10 now takes it at 1.15×, not 2.6×) while the house is pushed back, up and away (scale 0.25, lifted half a frame), fading only at the end; rings smaller and every label beyond them; a 9:16 TV label with no room on its left sits above its bar; the plane at 65 % from 18.6; bars grow straight from their base; the band's edges fade by mask instead of a shadow; the camera is moving on frame one; 9:16 push 10 %. **Disputed:** "both headline lines enter from the left" — line 2 enters from the right in code; most of its travel happens while it is still faint. **Not done:** 9:16 house ~41 % of the height (its diagonal is wider than the frame); rim light; furniture. |
| D 21.9–30 | 9:16 EXAMPLE tag into the terminal edge; 9:16 terminal short; output read time; end-card text fading in place; bare ground after the house; one-frame pop at the terminal exit; minor others. | Lead: 9:16 tag on the label's row; 9:16 type 54 px, window 920u growing from 62 %; **output prints at 25.3125** (half-beat) for ~1.3 s; the caption gives way 0.7 s after the output lands; the surface fades over 0.1 s; cursor blink 3× stronger; end-card lines slide 280u from alternate sides; "Your LAN." starts sliding at 21.715. |

## Component round 6 — full render r5 (16:9 and 9:16)

Findings: `work/round6/a.md`–`d.md`. All four: **one more pass**. Critic A: "no text, collision or honesty problems remain in this range". Windowed frozen: 0.0 s (16:9), 0.2 s (9:16) per 30 s. Contrast passes everywhere.

| Range | Main findings | Fixed by |
| --- | --- | --- |
| A 0–8.1 | 16:9 logo small; 9:16 opening loose; comp 5 arrives 0.17 s before the 8.125 beat; opening reads as a held still; TV foot on the laptop lid; 2→3 fade to black; the strip unlabelled (could read as distance); paused buttons lingering. | Builder A: mark ~690 px (asked 720 — wider won't fit with the word); the exit now runs 7.98–8.11 and the dot reaches its 36u pickup exactly at 8.125; ~6–7 % opening move; TV moved clear; the floor only darkens to ~40 % and the words sweep it away on the beat; small dim labels **"pressed"** at the line and **"starts"** at each marker (interface words, not claims); buttons clear on their marker's frame. Partly: 9:16 opening ~12 % closer, could be bigger. |
| B 8.1–18.1 | **Meaning:** the new staggered ring pulses in comp 6 read as the echo again (rings mean "a device's sound started"). The dot dropped into the bedroom at 8→9; a 3-frame rush at 13.1; 9:16 comp 6 clipped left; button over the QR; a white sliver at 17.85; 9:16 comp 8 pause; a dead beat after the press. | Builder B: every ring in comp 6 removed — T's crossing ticks glow and all three devices acknowledge **together** at 12.1; rings now only ever mean sound; the rush runs 12.98–13.42; the reveal into comp 5 now opens on 8.125; plane edge softened; the card overlaps the button's exit. Comp 8 in 9:16 now matches the new house view. Lead: the house's dot starts 1.4 units above its hover point from 17.92, so it visibly drops from where comp 8 leaves it. |
| C 18.1–21.9 | Hand-over fast then dead; exit backs the house away and the dot never grows; house crosses the fading headline; phone/laptop bars float on hairline stems, discs pop; dot reads as on the bed; 9:16 house ~42 %; band edge; held payoff. | Lead: **9:16 house view turned** (`HOUSE_VIEW_PORTRAIT`, azimuth −70°, elevation 54°) so the model's long side runs up the frame, screens still facing camera, with a view offset — now ~x 76–1012, down to y≈1700 (was ~42 % of the height); the camera moves from 17.8, so no dead stop; each column is a solid dim stem at the bar's width with the delay bright; discs scale in; the exit shrinks the house in place behind the dot, which grows into the full stop of "Your LAN." (now larger than the house's dot); orbit 6° through the hold; band mask 90u/50u with matching padding; the headline slides 36u within its band, unclipped. **Geometric limit:** any point on T's plane projects over a room, so the dot's hover is carried by the plumb line and floor spot. **Not done:** rim light; furniture. |
| D 21.9–30 | Comp 10 type small; end-card text fades in place; 9:16 terminal short; caption under the output; minor dot/blink/CTA items. | Lead: each comp 10 line is set as large as the frame allows (16:9 ~80 % width, 9:16 W−210u), all right-aligned to the one full stop; lines from the left enter from off the frame's edge; "Your files" rises faster (no apostrophe moment); end-card lines visible early with a gentler ease so the travel is seen; "Try it on two devices." 48→68u (42→58u in 9:16); the caption sits on the row the output will take and is pushed to the foot when it prints; one clear cursor blink on 24.6875. Not done: 9:16 terminal still ~half the height (the 24-character URL limits the type size). |

## Component round 7 — full render r6 (16:9 and 9:16)

Findings: `work/round7/a.md`–`d.md`. All four: **one more pass**.

**A serious bug, found by three critics independently:** the comp 4 logo and wordmark strobed at 15 Hz (two frames on, two off) over comps 5–11 — over text (contrast down to 4.04:1), over the terminal, and a photosensitivity risk. **Cause:** the harness hid off-slot layers with `visibility: hidden`, but a child element set to `visibility: visible` (comp 4's mark) shows through a hidden parent; whether it was set on a given frame depended on which of the four render workers had last drawn comp 4. **Fix (lead, `src/film.js`):** hidden layers also get `display: none`. Checked on a 24.3–24.5 s render: zero logo pixels in every frame. The windowed frozen measures of r6 were unreliable across the strobe (the 15-frame window always paired opposite phases) and are re-measured on r7.

| Range | Other main findings | Fixed by |
| --- | --- | --- |
| A 0–8.1 | "starts" labels collided with the markers and rings (TV label 4.14:1 as its ring passed); comp 1 under-fills (16:9) and loose (9:16, phone icon clipped); lockup crowds the edges and doesn't move; opening still reads held; a one-frame QR blob at 8.133. | Builder A: each "starts" label on its own small band, up-right of its marker, in after the ring has passed (settled 7.34:1); devices ~14 % larger and nearer the strip; 9:16 strip in from the edge; lockup 84 % with ≥ 147 px gutters and a 3 % push; ease-in over 1.2 s. Not done: 9:16 floor below the phone still largely empty. |
| B 8.1–18.1 | Dot lost at 8→9; 9:16 T label off-frame in the rush; rush ~0.1 s; 9:16 comp 8 pause; plane-edge sliver; button label off-centre; weak press; empty phone screen. Critic noted three EXAMPLE tags where the storyboard says one — **kept**, because round 4 required each figure to carry its own. | Builder B: the dot sinks with the lifting plane and is released moving down into the house's drop (9:16: it glides to the house dot's start); rush over 12.88–13.42 zooming about T; T clamped in frame; plane feather 240 px; press = 3 % scale, 3 px sink and a clipped ring; two more device rows. |
| C 18.1–21.9 | Exit wrong (house shrinks and drifts, "Your LAN" through it); dot reads as on the duvet (16:9); phone/laptop stems pale; plane under "house." as the headline fades; band rectangle; 210 ms label early. | Lead: the house's exit waits for the headline (21.56–21.74) and its layer fades to nothing by 21.72, before "Your LAN" crosses; a stray `opacity = '1'` that had cancelled the fade removed; dot hovers over the doorway floor (−0.05, 0.85); stems 0.4; the 16:9 model shifted right clear of the band; the label waits for its bar; the dot drops 1.6 units on a smoothstep from 17.92. |
| D 21.9–30 | Strobe (above); house under "Your LAN"; 9:16 comp 10 one line in a tall frame; terminal fill; caption position. | Lead: as C; stronger push on the sentence (14 %). **Not done:** 9:16 comp 10 stays one line per beat (stacking would change the storyboard's one-full-stop design); the 9:16 terminal is width-limited by the 24-character URL. |

## Component round 8 — full render r7 (16:9 and 9:16)

Findings: `work/round8/a.md`–`d.md`. All four: **one more pass**. Flicker 0 in both formats (the round-7 strobe is gone; a `flicker` check was added to the kit and confirmed on r6, where it flags 202 frames). Windowed frozen 0.0 s in both. Contrast passes everywhere once lines have faded in.

**Encode colour fix (lead, `render.mjs`):** critic C traced a film-wide accent offset (#50a4ff for #5aa9ff) to the encode: frames were converted to YUV with swscale's default BT.601 matrix but tagged BT.709. The encode now converts with `scale=out_color_matrix=bt709:out_range=tv`; a test frame decodes the accent as (89,168,253) against the token (90,169,255) (was (80,164,255)).

**Carried-dot hand-offs (lead, `src/shared/handoff.js`):** critics A and B measured the dot jumping 218–283 px at the 4→5 cut and 173 px at 8→9. Two shared points were added: `joinDotAt` (comp 5 publishes its dot; comp 4 lands on it — now 0 px / 0 % across the cut in 16:9) and `liftDotAt` (comp 8 publishes its release; comp 9 starts there and eases to its own path over 0.35 s — no jumps at 60 fps with 4 workers). `liftDotAt` was first written reading the page layout per frame, which would return zeros once the layer is hidden; it is now a constant computed at build time.

| Range | Main findings | Fixed by |
| --- | --- | --- |
| A 0–8.1 | Dot jump at the 4→5 cut; one-frame noisy QR circle; 16:9 split subject, TV into the top edge; 9:16 devices hugging the right edge; lockup gap 38–53 px; 0.65 s with no line. | Builder A: lands on `joinDotAt(8.125)`; devices grouped with the strip and TV ≥ 54 px from the top; 9:16 gutters ~61–72 px; gap 77–103 px and one shared push; caption gap 0.2 s. Not done: 9:16 floor below the phone still empty. |
| B 8.1–18.1 | 9:16 comp 8 labels sideways after the 9:16 house view turned; comp 5 entry glitch (pixelated QR); dot overshoot; 9:16 dot over the bedroom; T off the top in the 16:9 tilt; press doesn't sink. | Builder B: labels counter-turned to read horizontally, the plane held at −30° and turned to the house's −70° only after the labels have gone; the iris removed — laptop and code sit dimmed under the leaving mark and ease up from 85 %; one eased arc; T clamped ≥ 125 px inside. Also fixed its own bug: 9:16 lane-name transforms accumulated across frames (not a pure function of t). |
| C 18.1–21.9 | Exit (dot not rising); hand-over a wipe; dot on the bed (16:9); band shadow smear; pale stems; plane under the headline; premium. | Lead: 16:9 hover over open kitchen floor with a stronger floor spot and the T label on the left; stems opaque at 42 % of the accent; plane fades in at rest; band tight (24u/18u fade); exit: the dot rises (~180u arc) and grows while the camera pushes through the house. |
| D 21.9–30 | 9:16 comp 10 one line in a tall frame; terminal fill; caption under the URL; "Your machine." smaller than the others. | Lead: **9:16 stacks the three lines**, the dot stepping down as each new line's full stop; one size for all three (set by "Your machine."); the caption sits above the terminal window; cursor a hair further from the "e"; the rush's fade ends over 0.14 s. Not done: terminal fill (width-limited by the URL). |

## Component round 9 — full render r8 (16:9 and 9:16)

Findings: `work/round9/a.md`–`d.md`. All four: **one more pass**. Flicker 0, windowed frozen 0.0, contrast passes everywhere. The encode fix is confirmed: the accent decodes as #59a8fd (token #5aa9ff); the dot hand-offs at 8.125 and 17.90 are continuous.

**A meaning regression, caught and fixed (C1):** round 8's opaque stems made each house bar run device-to-plane, so the 40 ms and 210 ms columns were the same height — the picture contradicted its labels. The stems are now thin neutral stalks (`--line-strong`), and only the accent part — the delay — reads as the bar (TV long, phone shorter, laptop short).

**A clarity/honesty item (B2):** with comp 8's 9:16 labels turned horizontal, "phone" and "210 ms" shared a baseline and read as one. Builder B put each device's name and its figure on the same side of the same lane.

| Range | Main findings | Fixed by |
| --- | --- | --- |
| A 0–8.1 | 16:9 split subject (five rounds running); wordmark over the incoming QR; bottom row against the edge; logo halves breathing apart; 9:16 small and right; opening near-still; markers stopping; lone "when". | Builder A: **16:9 restaged** — the three devices stand side by side and the strip lies on the same 3D floor directly in front of them, in perspective (shared press line, icon per lane, "pressed"/"starts", every marker ≥ 170 px short of every device); wordmark gone by 7.92; one push for the whole lockup (mark 637–647 px); markers drift into the merge; 9:16 type "Nothing tells / them when / "now" is.". Shortfalls: mark short of 650–700 px; 9:16 right gutter 22–42 px. |
| B 8.1–18.1 | Lift reads as a wipe; labels pair with the wrong device (9:16); press doesn't sink; dot stops dead at the release; dot dives through the QR (9:16); tilt runs off the edges; rough rush-in; comp 6 hold. | Builder B: the lift is a 1.7× scale-up and fast fade with **no mask** over the lit house; name and figure share one lane side; the push holds still through the press; the dot eases to rest at the release and s09 eases it away; the 9:16 dot goes across then down beside the viewfinder; zoom-out before the tilt keeps everything inside; comp 6 acknowledgement kept simultaneous (staggered would repeat the echo). Not done: 9:16 comp 8 can't grow without leaving the frame. |
| C 18.1–21.9 | Bars lost the ratio (above); entry wipe; band edge and labels on the plane; dot path over furniture; two-tone bars; ghost block and slab rug; pulse snaps; floor disc reads as a lamp. | Lead: neutral thin stalks; the counter and rug removed; the floor disc removed (the plumb line carries the hover); the pulse eases in over 0.12 s; the 16:9 model lower and right so the plane clears the band; the drop goes across at the top first, then down; the exit's rise kept small (from this high camera, "towards the lens" reads as down-screen and larger). Not done: rim light; furniture modelling. |
| D 21.9–30 | Words over the terminal text at 24.27; 9:16 dot through "machine"; 9:16 terminal small; 9:16 stack tight to the sides; near-empty frame before the end card; caption before Enter. | Lead: the terminal's text fades in from 24.31, after the words have cleared (the window may wait underneath); in 9:16 the dot drops to the third row before "Your machine" arrives; 9:16 terminal 900u with its text centred and 2.5 line spacing; stack target W−220u, rows 1.38× apart, centred low, push 4 %; the cursor glides towards the frame's centre as the window rushes past; caption from 25.05. |

## Component round 10 — full render r9 (16:9 and 9:16)

Findings: `work/round10/a.md`–`d.md`. **Critic D (21.9–30): ship** — the first range to pass; remaining items minor. A, B, C: one more pass. Flicker 0, windowed frozen 0.0 (9:16 0.25 s, under the bar), contrast passes everywhere. The container restarted mid-round; no files were lost; the interrupted critic B was re-run and builder A resumed.

| Range | Main findings | Fixed by |
| --- | --- | --- |
| A 0–8.1 | **Rule break:** the lifting markers flew through a still-visible "starts" label (3.47–3.57). 9:16 subject small and split; 16:9 still two subjects; markers hang 0.2 s; words over the fading 3D; 9:16 lines should enter top/bottom; a one-frame press. | Builder A: all labels out by 3.36, before any marker moves; 9:16 devices in a centred column with each lane on the floor in front of its own device, bars ~2.5× longer; 16:9 icons laid flat on the floor in the strip's perspective and the strip-marker rings removed (device rings kept — those are the sound); markers drift into the sweep; 4-frame press. Not done: the 16:9 frame-one floor is still fairly empty; the 9:16 caption's band overlaps the TV's top ~40 px. |
| B 8.1–18.1 | House popped in one frame after a dip to black (17.833) — **caused by the house layer only appearing at 17.825** (lead's bug); 9:16 names paired with the wrong ms (again); "90 ms" into the phone; "TV" label collisions; rough rush; comp 6 half-second; phone dims mid-shrink; dot halts at the release. | Lead: the house is drawn from 17.40 underneath the diagram. Builder B: plane and ground fade together over 0.3 s (brightness only rises, max 3.2/frame); each ms centred over its own bar with its name above the lane start, same side; names 66 px above lanes; lanes brighten at 11.75; the phone keeps a blue glow through the shrink; the dot keeps moving through 17.90 and the house picks it up in motion (`liftDotAt(t)`; tracked at 60 fps: no stop, no jump). Not done: 9:16 comp 8 can't grow (moved down instead). |
| C 18.1–21.9 | **Honesty vs F8:** the 40 ms bar measured too long (3.2 : 1.6 : 1 against 5.25 : 2.25 : 1) — the fixed-size start disc added length. Entry near-cut; band/labels on the plane; dot over furniture; the dot reads as a lamp; ghost block; plane washes the materials; rings snap on. | Lead: **start discs removed** — each bar's length is its delay alone; the dot hovers over the partition with no pole; touch rings grow in over 0.25 s; the doorway lintel (the "ghost block") removed; plane fill 38 %; labels sit wholly above the plane's edge; a warm grazing light from behind-right; the 16:9 model lower; the headline slides 70u from its sides. |
| D 21.9–30 | Ship. Minor: a ghost of "chine" over the empty terminal window for ~3 frames; the dot's exit from the house; 9:16 wrapped output. | Lead: the terminal window appears from 24.30, after the words. |

## Component round 11 — full render r10 (16:9 and 9:16)

Findings: `work/round11/a.md`–`d.md`. **Critic D (21.9–30): ship** for the second round running. A, B, C: one more pass. Flicker 0, windowed frozen 0.0 (9:16 0.25 s), contrast passes everywhere. Renders now run through `work/lead/render-both.sh` (resumable, retrying) after three container restarts interrupted long renders; builder B noted that `--resume` reuses stale frames after a code change, so every version gets a fresh output name and a cleared frame cache.

| Range | Main findings | Fixed by |
| --- | --- | --- |
| A 0–8.1 | **Two rule breaks in the new 9:16 type entry:** lines overlapping each other, and '"now" is' rising through the markers. 9:16 band over the TV; 9:16 subject small; 16:9 bars read as a chart; one-frame press; markers hang; "starts" tags late and floating. | Builder A: each 9:16 line rises only 36u into its own row, one after another, so no line or marker is ever crossed; the band clears the TV by ~50 px; 4-frame press with the ring after; sweep 0.05 s sooner; each tag on its own marker. Partly: 9:16 camera ~7 % closer (more won't fit); 16:9 reframed rather than restaged. |
| B 8.1–18.1 | **Text collisions in comps 7–8:** the T line and bars cutting all three EXAMPLE tags (9:16); the "phone" label on the icon (16:9); a lane through the T label. Lift reads as a dissolve; dot holds before the hand-over; button text under "this device". | Builder B: **one "example values" tag** beside the column of ms figures replaces the three EXAMPLE tags (the lead's call: it plainly covers all three, and three tags could not sit clear of the lines); each figure joins its own device's name ("phone · 90 ms"); lanes stop at T; the plane scales 3.2× and flies out of the top, fading only at the end, the ground opening after; the dot accelerates through the release. Not done: 9:16 comp 8 can't grow. |
| C 18.1–21.9 | **Honesty vs F8:** on screen the bars still measured 3.4 : 1.6 : 1 — the 3D lengths were right, but **perspective** lengthened the bar nearest the camera; with the stalks, the phone's line looked tallest. Dot through "house."; exit a dip to black; 9:16 dot on the pillow. | Lead: **each bar's 3D length is now set so its length on screen at the touch is in the true ratio** (all three still grow for exactly their delay and meet T together); stalks thin and near-ground colour; drop height reduced so the dot stays right of the headline; the exit drops the house down out of frame while the dot rises and swells; rings ease in over 0.3 s and pulse on the beat; headline leaves the way it came; TV 1.55× / laptop 1.2×; 9:16 hover over the partition. |
| D 21.9–30 | Ship. | — |
