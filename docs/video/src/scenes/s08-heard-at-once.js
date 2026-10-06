/**
 * Composition 8's line. The diagram is tilted to the house camera's angle,
 * its lanes rising to the right, which leaves the lower right of the frame
 * open: the line is set there, right-aligned on plain ground, and only after
 * the tilt has settled, so no line of the diagram ever passes through it.
 * At the hand-over it is the front object and leaves towards the camera on
 * its own, ahead of the sheet (s06's lift): from 17.15, while still at full
 * brightness, it grows 1.0 → ~1.15× about its own centre and drifts ~55 px up,
 * both with an ease-in, so it is plainly moving before it fades. Its opacity
 * holds near full for the first half of the move and is 0 by 17.30, before the
 * house coming up underneath is past ~12 % — so it is never left over the
 * picture. In 9:16 the growth is capped so the line stays inside the frame
 * (with a margin) while it is above ~30 % opacity. It never comes near the dot.
 */

/** The line's exit towards the camera: it starts here, while bright, and is gone at OUT[1]. */
const OUT = [17.15, 17.3];
/** Its growth and rise (design px) over OUT, both with progress k^EASE (an ease-in). */
const GROW = 0.15;
const RISE = 55;
const EASE = 1.6;
/** Its opacity holds at full to HOLD of the way through, then falls (cosine) to 0 at OUT[1]. */
const HOLD = 0.5;
/** 9:16: the line stays this far (design px) inside each side of the frame while above 30 % opacity. */
const EDGE = 24;

const clamp01 = (x) => Math.min(1, Math.max(0, x));

export function build({ el, tl, u, W, portrait, t0, onFrame }) {
  const right = portrait ? 70 * u : 110 * u;
  el.innerHTML = `
    <div class="lift" style="position:absolute;inset:0">
      <div class="line" style="position:absolute;right:${right}px;top:${portrait ? 1480 * u : 860 * u}px;text-align:right;
           font:700 ${portrait ? 86 * u : 80 * u}px/1.08 var(--sans);letter-spacing:-0.03em;color:var(--text);white-space:nowrap">Scheduled to be heard<br>at one agreed instant.</div>
    </div>`;
  const line = el.querySelector('.line');
  const lift = el.querySelector('.lift');
  // In from the right on the cut, as the plane starts to tilt (the lower
  // right stays clear of the diagram throughout the pull back), so the frame
  // keeps a line through it; set by ~16.0 s; drifts until the sheet lifts.
  tl.fromTo(line, { x: 140 * u, opacity: 0 }, { x: 0, opacity: 1, duration: 0.5, ease: 'expo.out' }, t0);
  tl.to(line, { x: -30 * u, duration: 17.2 - (t0 + 0.5), ease: 'sine.inOut' }, t0 + 0.5);
  // The exit: its own push towards the camera from 17.15 (see the header).
  /** Progress through the fade at which the opacity is 0.3 (cosine fall). */
  const k30 = HOLD + (1 - HOLD) * (Math.acos(2 * 0.3 - 1) / Math.PI);
  onFrame((t) => {
    const k = clamp01((t - OUT[0]) / (OUT[1] - OUT[0]));
    const f = clamp01((k - HOLD) / (1 - HOLD));
    const o = 0.5 + 0.5 * Math.cos(Math.PI * f);
    lift.style.visibility = k >= 1 ? 'hidden' : '';
    if (k <= 0) {
      lift.style.transform = 'none';
      lift.style.opacity = '1';
      return;
    }
    // Its box on screen before the push (the push is set after this read),
    // including its own drift in x; the frame's layer starts at 0, 0.
    lift.style.transform = 'none';
    const r = line.getBoundingClientRect();
    const w = r.width;
    const cx = r.left + w / 2;
    const cy = r.top + r.height / 2;
    let grow = GROW;
    if (portrait) {
      // Largest growth (about cx) that keeps both ends EDGE inside the frame,
      // reached no later than the point the line is at 30 % opacity.
      const room = Math.min(cx, W - cx) - EDGE * u;
      const gMax = Math.max(1, room / (w / 2));
      grow = Math.min(GROW, (gMax - 1) / k30 ** EASE);
    }
    const m = k ** EASE;
    lift.style.transformOrigin = `${cx}px ${cy}px`;
    lift.style.transform = `translateY(${-RISE * u * m}px) scale(${1 + grow * m})`;
    lift.style.opacity = String(o);
  });
  void W;
}
