# Security

## Reporting a vulnerability

Open a [private security advisory](https://github.com/lewisjohnvillamor/homesync/security/advisories/new)
on this repository. Please do not open a public issue for something exploitable.

There is no bounty and no formal response-time commitment — this is a personal
project. Expect a reply, not a schedule.

## What HomeSync assumes

**HomeSync is built for one home network, where everyone who can reach the
coordinator is already trusted.** That assumption is not incidental; several
deliberate design choices rest on it, and they are wrong choices anywhere else.

- **The room secret is the only credential.** It is printed in the terminal,
  encoded into a QR code, and carried in the invite link's fragment. Anyone
  holding it is a full member of the room.
- **Any member may control the transport.** Play, pause, seek and queue changes
  are not restricted to the owner. Requiring approval before a phone can press
  pause is friction without a threat model on a home LAN. This is a documented
  deviation from section 15.3 of the specification.
- **Any member may change the library**, which means adding a folder on the
  host machine to be scanned, and fetching a URL into it. The secret you hand a
  guest therefore carries more than playback control. See below.
- **There is no rate limiting on join attempts.** The room secret is a ULID, so
  guessing it is not realistic, but nothing slows an attempt down.

Put another way: the room secret is a house key, not a user account. Give it to
people you would give a house key to.

## Running it on a public address

Don't, without something in front of it.

The coordinator binds `0.0.0.0` by default so phones on the LAN can reach it.
On a home router that is safe — every address behind it is private. On a hosted
machine the same default puts the room on the open internet, where the
assumptions above stop holding. HomeSync prints a warning at startup when it
detects a routable address, but a warning is not a control.

If you need it reachable from outside your house, put it behind a VPN
(WireGuard, Tailscale) or a reverse proxy that does its own authentication.
Exposing the port directly is not a supported configuration.

## What is defended anyway

Some things are guarded even though the trusted-LAN model would excuse them,
because the cost of the guard is low and the cost of being wrong is not.

- **The room secret never travels in a request.** It sits in the URL fragment,
  which browsers do not put on the wire, and public endpoints never echo it.
  There is a test.
- **Diagnostics are gated on the secret.** The export carries device names and
  telemetry, so it is not something a passer-by reads.
- **Fetch-by-URL cannot be aimed inward.** The host is resolved before the
  request and refused if it lands on a loopback, private, link-local,
  carrier-grade-NAT or reserved address, in v4 or v6, including a v4 address
  mapped into v6. The request is then pinned to the vetted addresses, so a name
  that answers publicly once and privately a moment later — DNS rebinding —
  does not get a second chance. Redirects are followed by hand, up to five, and
  every hop is vetted the same way, because a policy that runs before the next
  hop is resolved cannot see where it leads.

  Without this, the room secret would be enough to make the host machine talk
  to a router's admin page or a cloud metadata service on 169.254.169.254 — and
  because a fetched file is served back out of the library, that is an
  exfiltration path, not only a scanning one.
- **Downloaded filenames are sanitised** — path separators stripped, leading
  dots trimmed, everything outside a safe set replaced — so a hostile
  `Content-Disposition` or URL path cannot write outside the download folder.
- **Fetched files are size-capped** at 300 MB, checked against the declared
  `content-length` and again against what actually arrived, because a chunked
  response declares nothing.
- **Media ranges are bounds-checked**, and every artwork offset and length read
  out of a file's own metadata is validated against the file before it is used.
  Those parsers read untrusted bytes from disk.
- **No `unsafe` anywhere in the workspace**, and no `unwrap`, `expect` or
  `panic!` on any request path outside test code.

## Dependencies

`cargo audit` reports no known vulnerabilities across the dependency tree. It is
not run automatically; run it yourself before cutting a release.

## Known gaps

These are real, and listed rather than fixed:

- No rate limiting on join attempts.
- No fuzzing of the media metadata parsers, which are the code most exposed to
  untrusted input.
- The self-signed TLS certificate is trusted on first use by each device. There
  is nothing to detect a substituted one.
- A member who can add a media root can cause any directory the host user can
  read to be scanned for audio files, and the folder list discloses host
  filesystem paths to other members.
