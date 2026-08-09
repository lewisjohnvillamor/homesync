# HomeSync webOS receiver

A minimal webOS application that points an LG television at a HomeSync
coordinator on the same network.

**Nobody has run this on a television.** It is written from LG's published
webOS documentation and has never been packaged, installed or tested on real
hardware. Treat every claim here as unverified until someone does.

## What it is

A launcher shell. It collects the coordinator address, room code and secret
with a remote-control-friendly form, remembers them, and navigates to the
coordinator's own web client. The receiver logic is the ordinary HomeSync
browser client — there is no TV-specific audio path.

It exists rather than "just use the TV browser" because:

- The TV browser forgets the address every time, and typing a URL with a remote
  is genuinely unpleasant.
- An installed app gets a persistent identity, so its saved timing
  compensation survives a reboot.
- It gives somewhere to put webOS-specific handling (back key, screen saver)
  that has no place in the shared client.

## What it cannot do

It cannot capture or synchronise audio from Netflix, YouTube, or any other
application on the television. webOS does not give one application another
application's decoded audio, and only one foreground application owns the media
resources. This is an operating-system boundary, not something a better
implementation would solve. See specification section 4.1.

## Building

Requires LG's [webOS CLI tools](https://webostv.developer.lge.com/develop/tools/cli-introduction).

```sh
./scripts/package-webos.sh          # produces webos/build/*.ipk
ares-install --device <tv> webos/build/com.homesync.receiver_0.1.0_all.ipk
ares-launch --device <tv> com.homesync.receiver
```

`icon.png` is not in the repository — supply a 80×80 PNG before packaging, or
`ares-package` will warn and the app will show a default icon.

## Before trusting a television as a receiver

Run the device probe first: **Check this TV first** in the app, or open
`http://<coordinator>:8080/probe.html` in the TV browser. It measures whether
the audio clock tracks real time and whether a scheduled start happens when it
was asked to — the two things that decide whether a device can hold
synchronisation at all.

LG documents substantial Web Audio latency on some webOS versions. Latency that
is large but *stable* is fine: acoustic calibration measures it and compensates.
Latency that varies during playback cannot be compensated by any fixed value,
and a television that behaves that way should be recorded as unsupported in
`docs/compatibility.md` rather than worked around.
