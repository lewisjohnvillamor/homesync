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
