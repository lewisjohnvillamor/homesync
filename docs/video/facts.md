# Facts file — the HomeSync film

The only source for any number, name or claim that appears on screen. Every
entry cites the line of `README.md` it comes from (line numbers as of commit
`075b0f3`). If it is not here, it does not go on screen.

## Rules this file enforces

- **No result claims about sound.** The README's Status section says plainly
  that almost none of HomeSync has been heard by a human. So the film describes
  what HomeSync *does* — the mechanism — and never claims an outcome like "no
  echo", "perfect sync" or "sounds like one speaker".
- **Example numbers are labelled as examples.** The millisecond figures below
  come from the README's explanatory diagram, not from a measurement. On screen
  they carry the word "example".
- **Interface text is shown as interface.** A recreated panel may show a string
  the app itself produces; that is a depiction of the interface, not a
  measured result.

## Facts

| ID | Allowed on-screen wording | Source |
| --- | --- | --- |
| F1 | HomeSync | README throughout |
| F2 | Play the same music, in time, on every device in your house. | README:2 (banner alt text) |
| F3 | Press play on a laptop, a phone and a TV, and you get an echo. | README:30–31 ("Put a laptop, a phone and a TV in the same room and press play on all three, and you get an echo.") |
| F3b | On screen: "Press play on all three." / "…and you still get an echo." — *still*, because the picture shows all three pressed at once; README:30–31 says pressing play on all three gives an echo | README:30–31 |
| F4 | Nothing tells them when "now" is. *(also: the devices don't share a clock)* | README:31–32 |
| F4b | Their audio hardware adds different amounts of delay. *(depicted, not written: the rings in composition 2 start at offsets in the F8 ratio)* | README:31 |
| F5 | Audio is scheduled to be **heard** at one agreed instant. | README:35–37 |
| F6 | Every device is told one instant, and works out how early to start so the sound lands on it. | README:401–402 |
| ~~F7~~ | **Excluded.** "A device with a 210 ms speaker starts 210 ms before a device with a 40 ms one" — the arithmetic is off (they start 170 ms apart). Reported to the owner as a README error. | README:402–403 |
| F8 | *(example)* speaker / output delays of 40 ms, 90 ms and 210 ms | README:419 (diagram; **example values**). The diagram's T−42/T−83/T−211 also include clock offset, which the film does not explain, so those are **not** used. |
| F9 | You run it on one machine on your network. | README:39 |
| F10 | Everything else joins by opening a link. | README:39–40 |
| F11 | Invite a device: a QR code and a copyable link. On screen: "Scan the code, or open the link." | README:266, 101 |
| F12 | No internet needed — your LAN, your files, your machine. | README:51 |
| F13 | One self-contained binary — no Node, no bundler, no database. | README:132, 144 |
| F14 | Several rooms — the kitchen plays one thing while the bedroom plays another. | README:53 |
| F15 | One volume for the house. | README:44 |
| F16 | Your phone's lock screen is the remote. | README:49 |
| F17 | Search the library by title, artist or album. | README:236 |
| F18 | Sleep timer: 15, 30, 45, 60 or 90 minutes. | README:344 |
| F19 | `cargo run --release` | README:63 |
| F20 | The coordinator prints a LAN address, a room code, an invite link and a QR code. | README:66–67, 72–76 |
| F21 | *(example, from the README)* `Open on the LAN : http://192.168.1.50:8080` · `Room code : K7M2QX` | README:72, 75 |
| F22 | Interface string: "N devices playing together" | README:111 (devices.png alt text) |
| F23 | Free and open source · MIT licence | README:7, 698, 712 |
| F24 | github.com/lewisjohnvillamor/homesync | README:61 (clone URL) |
| F25 | Try it on two devices. / "Enable audio & join" (the join button's label) | README:79 ("Open the invite link on two devices") |
| F28 | The release build takes a few minutes. | README:147 ("links with LTO, which takes a few minutes") |
| F29 | Interface string: "this device" (how the app labels the device you are holding) | web/src/app.js device card; seen in the e2e run as "★this device" |
| ~~F27~~ | *(unused since storyboard v2)* Interface counts describe only the example on screen: a library of nine visible tracks, "2 of 9" after a search | not a claim; the number is the visible rows |
| ~~F26~~ | *(unused since storyboard v2)* Example library contents: public-domain works only (Debussy, Satie, Bach) — illustrative, never a claim | not a claim; chosen so no real artist's catalogue is implied |

## Deliberately excluded

Each of these is in the README but marked unverified there, so it stays off
screen however good it would look: drift correction by resampling, the
gapless handover between tracks, acoustic calibration, the clock agreement
figure from simulated clients, live system-audio capture, and the webOS
receiver.
