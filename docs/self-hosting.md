# Self-hosting

One binary, no services, no accounts.

```sh
cargo run --release
```

It prints the LAN address, a room code, an invite link and a QR code. Open the
link on each device and press **Enable audio & join**.

## The one thing worth deciding up front: HTTPS

```sh
cargo run --release -- --tls
```

**Acoustic calibration does not work without this.** Browsers refuse microphone
access on `http://192.168.1.50:8080` — it is not a secure context — so no
device can be the calibration microphone over plain HTTP. It also disables the
browser's fast `crypto.subtle` digest, so media verification falls back to a
slower JavaScript implementation.

The cost: HomeSync signs its own certificate, because no certificate authority
will vouch for a private address. **Every device shows a warning the first
time**, which somebody has to accept once per device. That is why HTTPS is
opt-in rather than the default — for a room that only plays local audio, plain
HTTP is simpler and works fine.

The certificate is written next to the binary (`--tls-dir` to move it) and
reused, so the warning is a one-time cost rather than a per-restart one. It
covers `localhost`, `homesync.local`, and this machine's addresses; if the LAN
address changes — a new DHCP lease — a new certificate is generated
automatically and devices will ask again.

## Finding the coordinator

The banner prints, in order of reliability:

1. **The LAN address**, e.g. `http://192.168.1.50:8080`. Always works.
2. **`homesync.local`**, advertised over mDNS. Resolves on macOS, iOS and
   Windows 10 or later, and on Linux with Avahi installed. **Android does not
   resolve `.local` names**, so phones need the address. Disable with
   `--mdns false`.

The room secret travels in the URL fragment, which browsers never send to the
server, so the invite link is what actually grants access — the room code alone
is not enough.

## What survives a restart

**The room keeps its code and secret.** Without that, every restart would mint a
new room and silently invalidate the invite link saved on every device — and
because those credentials live in per-browser storage, one browser can keep
working while another suddenly cannot. If the coordinator does mint a new room,
the banner says so under the room code.

Compensation is expensive to obtain, so it is saved to
`homesync-devices.json` (`--state-file` to move it) against each device's
identity, and restored when that device rejoins. That covers both the value you
found by ear and the one calibration measured.

- `--no-state` runs without touching the filesystem.
- `--reset-state` forgets every device and starts clean.

A device is recognised by an identifier its browser stores. Clearing a
browser's site data makes it a new device.

## A device cannot reach the coordinator

If some devices connect and one does not, the coordinator is fine — it is
listening, and the firewall is letting others in. The fault is between that
device and the host.

The banner lists **every** private address the host has, because a machine with
both Wi-Fi and Ethernet is reachable at either and a device can only use one it
shares a network with. Try each of them.

Then, on the device that cannot connect:

1. **Check its own address.** `ipconfig` on Windows, `ifconfig`/`ip addr`
   elsewhere. If it is not on the same subnet as the coordinator —
   `192.168.254.x` versus `192.168.1.x`, say — there is no route, and that is
   the whole answer. Common causes: a guest SSID, a 2.4/5 GHz pair bridged to
   different subnets, an Ethernet dock, or a phone hotspot.
2. **Turn off any VPN.** A VPN client routinely captures all traffic including
   private addresses, and this is the single most common cause on laptops.
3. **Try a ping.** If ping fails too, it is not HomeSync — it is the network.
   If ping succeeds but the browser does not load, suspect a proxy setting or
   a local firewall on the device.
4. **Suspect client isolation.** Many routers isolate clients on guest
   networks, and some on the main one. Devices can each reach the internet but
   not each other. Move everything onto the same SSID.

## One browser works and another does not

Room credentials are stored per browser, so Safari and Chrome on the same
machine hold different ones. A browser that opened the current invite link
works; one that was pointed at the bare address reuses whatever it saved
earlier.

If a browser is refused, it now says so plainly and returns to the join screen,
having forgotten the credentials that failed. Open the invite link the
coordinator is printing, or scan its QR code.

## Media

```sh
cargo run --release -- --media-dir ~/Music
```

Anything with a `wav/mp3/m4a/aac/ogg/opus/flac/webm` extension is offered. The
built-in click track is always present, so timing can be checked with no files
at all. Files are served by content hash and verified by every receiver before
playback.

## Useful flags

| Flag | Why you would use it |
| --- | --- |
| `--tls` | Enable calibration. See above. |
| `--port` | Something else already has 8080. |
| `--bind 127.0.0.1` | Keep the coordinator off the network entirely. |
| `--start-lead-ms` | Raise it if slow devices report a large "start moved by" figure. |
| `--room-code` / `--room-secret` | Fixed credentials, for scripting. |
| `--media-dir` | Where your audio lives. |
| `--simulate 3 --simulate-seconds 1800` | Run the checkpoint-1 clock test headlessly. |

## Security posture

This is a home-network tool and it assumes a trusted network.

- Binds to all interfaces so phones can reach it. `--bind 127.0.0.1` if you do
  not want that.
- The room secret is required to join and to read diagnostics.
- Media is served only by content hash; no request can name a path on disk.
- Frame sizes and recording uploads are bounded.
- The self-signed certificate encrypts the connection but proves nothing about
  identity — anyone on your LAN who can reach the port sees the same
  certificate you do.

There is no rate limiting on join attempts and no protection against a hostile
device already on your network. Treat it accordingly.

## Diagnostics

The **Download diagnostics** button in the log panel saves a JSON snapshot of
every device's clock, telemetry, buffer health and the last calibration.
Equivalent to:

```sh
curl -k "https://<coordinator>/api/v1/diagnostics?secret=<room secret>" > report.json
```

If something sounds wrong, that file is far more useful than a description of
the sound.
